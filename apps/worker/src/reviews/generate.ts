import { prisma, findAiSettingsSafe } from "@ai-shopify/db";
import {
  decryptSecret,
  detectAudienceGender,
  pickGiftRecipient,
  pickPositiveRating,
  pickWeightedLength,
  type ReviewGenerationJobPayload,
  type ReviewLength,
} from "@ai-shopify/shared";
import { assembleReview, type AssembledReview } from "./assemble-review.js";
import { generateReviewWithAI, type AiProviderConfig, type ProviderQuotaEvent } from "./ai-generate.js";
import { analyzeProductAudienceFromImage } from "./vision-audience.js";
import { hashReviewContent } from "./content-hash.js";
import { getOrCreateReviewer } from "./reviewer-pool.js";
import { env } from "../env.js";
import { logSystemEvent } from "../logging.js";

const MAX_HASH_RETRIES = 2;
const MAX_REVIEW_AGE_DAYS = 180;

/** Picks a uniformly random instant within the lookback window, not just a random day — otherwise
 * every review kept today's exact clock time and only the day-of-month varied, so a whole batch
 * generated in one run would show identical (or near-identical) times of day across every review. */
function randomPastDate(): Date {
  const maxMsAgo = MAX_REVIEW_AGE_DAYS * 24 * 60 * 60 * 1000;
  const msAgo = Math.floor(Math.random() * maxMsAgo);
  return new Date(Date.now() - msAgo);
}

type ProduceReviewParams = {
  productType: string;
  rating: number;
  length: ReviewLength;
  brand?: { name?: string; category?: string; usp?: string };
  reviewer: {
    name: string;
    gender: "MALE" | "FEMALE";
    ageGroup: string;
    occupation: string;
    country: string;
  };
  productTitle: string;
  excludeCombos: Set<string>;
  /** Tried in order — e.g. OpenRouter first, then Groq once every OpenRouter model fails
   * (typically its shared free-tier daily cap being exhausted). */
  ai: AiProviderConfig[];
  /** Called (at most once per generateReviewsForProduct call — see the caller) when every
   * configured provider failed and this review fell back to the phrase bank, so the dashboard can
   * surface that AI generation is currently degraded. */
  onAiFallback?: (error: unknown) => void;
  /** Called after every provider call attempt so the dashboard can show live remaining/limit
   * numbers instead of a guess. */
  onQuotaInfo?: (event: ProviderQuotaEvent) => void;
  /** Set when the reviewer's own gender doesn't match the product's detected audience. */
  giftRecipient?: string;
};

/** Tries real AI generation first when configured; falls back to the phrase-bank assembler on any
 * failure (missing/invalid key, rate limit, network error) so a job never hard-fails over this. */
async function produceReview(params: ProduceReviewParams): Promise<AssembledReview> {
  const { ai, productTitle, reviewer, onAiFallback, onQuotaInfo, ...assembleParams } = params;

  if (ai.length > 0) {
    try {
      const { title, content } = await generateReviewWithAI(
        ai,
        {
          productTitle,
          productType: assembleParams.productType,
          brand: assembleParams.brand,
          reviewer,
          rating: assembleParams.rating,
          length: assembleParams.length,
          giftRecipient: assembleParams.giftRecipient,
        },
        onQuotaInfo,
      );
      return { title, content, comboKey: `ai:${hashReviewContent(content)}` };
    } catch (error) {
      console.error(`[review-generation] AI generation failed for all models, falling back to phrase bank:`, error);
      onAiFallback?.(error);
    }
  }

  return assembleReview(assembleParams);
}

export async function generateReviewsForProduct(payload: ReviewGenerationJobPayload): Promise<void> {
  const { productId, maleCount, femaleCount, lengthMode, length, lengthWeights } = payload;

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    include: {
      store: { include: { brandSettings: true } },
      images: { orderBy: { position: "asc" }, take: 1 },
    },
  });
  const effectiveProductType = payload.productType?.trim() || product.productType;
  const brand = product.store.brandSettings
    ? {
        name: product.store.brandSettings.brandName,
        category: product.store.brandSettings.brandCategory,
        usp: product.store.brandSettings.usp ?? undefined,
      }
    : undefined;

  // Fetched separately (not via a relational `include` above) and via the Groq-column-tolerant
  // helper — the Groq fallback migration may not have run against this database yet, and a crash
  // here would break all review generation, not just the Groq-specific fallback path.
  const aiSettings = await findAiSettingsSafe(product.storeId);
  const openRouterAi: AiProviderConfig | undefined =
    aiSettings?.enabled && aiSettings.apiKeyEncrypted && aiSettings.models.length > 0
      ? {
          name: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: decryptSecret(aiSettings.apiKeyEncrypted, env.ENCRYPTION_KEY),
          models: aiSettings.models,
        }
      : undefined;
  // Fallback provider, tried only once every OpenRouter model above has failed — separate
  // account/quota from OpenRouter's shared free-tier daily cap.
  const groqAi: AiProviderConfig | undefined =
    aiSettings?.enabled && aiSettings.groqApiKeyEncrypted && aiSettings.groqModels.length > 0
      ? {
          name: "groq",
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: decryptSecret(aiSettings.groqApiKeyEncrypted, env.ENCRYPTION_KEY),
          models: aiSettings.groqModels,
        }
      : undefined;
  const ai: AiProviderConfig[] = [openRouterAi, groqAi].filter(
    (config): config is AiProviderConfig => Boolean(config),
  );

  // Persists a live snapshot of each provider's rate-limit status so the dashboard can show real
  // remaining/limit numbers. Groq reports this on every call; OpenRouter only reports anything at
  // all once actually rate-limited, so its "account" row also self-tracks a daily attempt count
  // in the meantime as a best-effort estimate (see AiProviderQuota's schema doc comment).
  function persistQuotaEvent(event: ProviderQuotaEvent) {
    void (async () => {
      try {
        const existing = await prisma.aiProviderQuota.findUnique({
          where: { storeId_provider_model: { storeId: product.storeId, provider: event.provider, model: event.model } },
        });

        // When this call didn't return any rate-limit info at all, keep whatever we already had
        // rather than overwriting known-good data with nulls.
        const keep = <T>(fresh: T | null | undefined, prior: T | null | undefined): T | null =>
          event.snapshot ? (fresh ?? null) : (prior ?? null);

        const today = new Date().toISOString().slice(0, 10);
        const priorCount = existing?.selfTrackedDay === today ? existing.selfTrackedCount : 0;
        // Only free-tier OpenRouter calls draw against the shared free daily cap this count
        // estimates — a paid model succeeding shouldn't make the free-tier estimate look more
        // exhausted than it actually is.
        const selfTrackedCount = event.provider === "openrouter" && event.isFreeModel ? priorCount + 1 : priorCount;

        const data = {
          limitRequests: keep(event.snapshot?.limitRequests, existing?.limitRequests),
          remainingRequests: keep(event.snapshot?.remainingRequests, existing?.remainingRequests),
          requestsResetAt: keep(event.snapshot?.requestsResetAt, existing?.requestsResetAt),
          limitTokens: keep(event.snapshot?.limitTokens, existing?.limitTokens),
          remainingTokens: keep(event.snapshot?.remainingTokens, existing?.remainingTokens),
          tokensResetAt: keep(event.snapshot?.tokensResetAt, existing?.tokensResetAt),
          selfTrackedCount,
          selfTrackedDay: today,
        };

        await prisma.aiProviderQuota.upsert({
          where: { storeId_provider_model: { storeId: product.storeId, provider: event.provider, model: event.model } },
          create: { storeId: product.storeId, provider: event.provider, model: event.model, ...data },
          update: data,
        });
      } catch (error) {
        console.error("[review-generation] failed to persist AI quota snapshot:", error);
      }
    })();
  }

  const existingReviews = await prisma.generatedReview.findMany({
    where: { productId },
    select: { reviewerProfileId: true, contentEmbeddingHash: true },
  });
  const usedReviewerIds = new Set(existingReviews.map((r) => r.reviewerProfileId));
  const usedHashes = new Set(existingReviews.map((r) => r.contentEmbeddingHash));
  const usedCombos = new Set<string>();

  const genderQueue: Array<"MALE" | "FEMALE"> = [
    ...Array(maleCount).fill("MALE" as const),
    ...Array(femaleCount).fill("FEMALE" as const),
  ];

  // Vision-based audience detection catches products a text-only heuristic can't (e.g. a plain
  // "Chain" with no gendered word in the name, but styled in a clearly masculine/feminine way).
  // Opt-in per store (AiSettings.visionAudienceEnabled, defaults off) since it costs an extra AI
  // call and free vision-capable OpenRouter models are frequently rate-limited. Cached on the
  // product after the first successful analysis (detectedAudience) so this only costs one API
  // call ever per product, not one per generation request. Only persisted on a definitive vision
  // result — if vision isn't attempted (disabled, no AI configured, no image) or fails, nothing
  // is cached, so a later run can still retry it once it's enabled/AI/images are available.
  let audience = product.detectedAudience ?? detectAudienceGender(product.title, effectiveProductType);
  const primaryImage = product.images[0];
  if (!product.detectedAudience && openRouterAi && aiSettings?.visionAudienceEnabled && primaryImage) {
    try {
      const visionAudience = await analyzeProductAudienceFromImage(openRouterAi.apiKey, primaryImage.url);
      if (visionAudience) {
        audience = visionAudience;
        await prisma.$transaction([
          prisma.product.update({
            where: { id: productId },
            data: { detectedAudience: visionAudience, lastAnalyzedAt: new Date() },
          }),
          prisma.productImage.update({
            where: { id: primaryImage.id },
            data: { analysis: { audience: visionAudience }, analyzedAt: new Date() },
          }),
        ]);
      }
    } catch (error) {
      console.error(`[review-generation] vision audience analysis failed for product ${productId}:`, error);
    }
  }

  // Phase 1: reserve a reviewer per slot sequentially — this must stay sequential (not
  // parallelized with phase 2) since usedReviewerIds is mutated after each pick, and two
  // concurrent picks could otherwise land on the same reviewer for this product's batch. This
  // phase is DB-only and fast; it's not the bottleneck.
  type Slot = {
    gender: "MALE" | "FEMALE";
    reviewer: Awaited<ReturnType<typeof getOrCreateReviewer>>;
    giftRecipient?: string;
    reviewLength: ReviewLength;
    rating: number;
  };
  const slots: Slot[] = [];
  for (const gender of genderQueue) {
    const reviewer = await getOrCreateReviewer(product.storeId, gender, usedReviewerIds);
    usedReviewerIds.add(reviewer.id);
    slots.push({
      gender,
      reviewer,
      giftRecipient: audience !== "UNISEX" && audience !== gender ? pickGiftRecipient(gender) : undefined,
      reviewLength: lengthMode === "MIXED" && lengthWeights ? pickWeightedLength(lengthWeights) : length,
      rating: pickPositiveRating(),
    });
  }

  // Surfaces AI-provider exhaustion on the dashboard (Logs page) instead of it only ever showing
  // up as a console.error — logged at most once per product per job, since a full batch can
  // trigger this dozens of times and flooding the log would bury everything else.
  let aiFallbackWarned = false;
  function warnAiFallbackOnce(error: unknown) {
    if (aiFallbackWarned || ai.length === 0) return;
    aiFallbackWarned = true;
    void logSystemEvent(
      "WARN",
      `AI review generation fell back to the phrase-bank generator for "${product.title}" — every configured provider (${
        openRouterAi ? "OpenRouter" : ""
      }${openRouterAi && groqAi ? " + " : ""}${groqAi ? "Groq" : ""}) failed, likely rate-limited.`,
      {
        userId: product.store.userId,
        metadata: { productId, error: error instanceof Error ? error.message : String(error) },
      },
    );
  }

  // Phase 2: the actual slow part (AI network calls) runs in parallel across the whole batch —
  // this is what lets worker concurrency translate into real per-product throughput instead of
  // each product's reviews queueing up one at a time behind each other. usedHashes/usedCombos are
  // still shared across these concurrent tasks; a same-batch content collision is possible in the
  // (rare) case two slots finish at nearly the same instant, but that's a cosmetic risk the
  // per-product duplicate-check job (see duplicate-check.worker.ts) already catches and cleans up.
  await Promise.all(
    slots.map(async ({ reviewer, giftRecipient, reviewLength, rating }) => {
      try {
        const reviewerPersona = {
          name: reviewer.name,
          gender: reviewer.gender,
          ageGroup: reviewer.ageGroup,
          occupation: reviewer.occupation,
          country: reviewer.country,
        };

        let produced = await produceReview({
          productType: effectiveProductType,
          productTitle: product.title,
          rating,
          length: reviewLength,
          brand,
          reviewer: reviewerPersona,
          excludeCombos: usedCombos,
          ai,
          onAiFallback: warnAiFallbackOnce,
          onQuotaInfo: persistQuotaEvent,
          giftRecipient,
        });
        let hash = hashReviewContent(produced.content);
        let status: "DRAFT" | "DUPLICATE_REGENERATED" = "DRAFT";

        let retries = 0;
        while (usedHashes.has(hash) && retries < MAX_HASH_RETRIES) {
          usedCombos.add(produced.comboKey);
          produced = await produceReview({
            productType: effectiveProductType,
            productTitle: product.title,
            rating,
            length: reviewLength,
            brand,
            reviewer: reviewerPersona,
            excludeCombos: usedCombos,
            ai,
            onAiFallback: warnAiFallbackOnce,
            onQuotaInfo: persistQuotaEvent,
            giftRecipient,
          });
          hash = hashReviewContent(produced.content);
          retries++;
        }
        if (usedHashes.has(hash)) {
          status = "DUPLICATE_REGENERATED";
        }

        usedCombos.add(produced.comboKey);
        usedHashes.add(hash);

        await prisma.generatedReview.create({
          data: {
            productId,
            reviewerProfileId: reviewer.id,
            rating,
            title: produced.title,
            content: produced.content,
            contentEmbeddingHash: hash,
            status,
            reviewDate: randomPastDate(),
          },
        });
      } catch (error) {
        console.error(`[review-generation] failed to generate one review for product ${productId}:`, error);
      }
    }),
  );
}
