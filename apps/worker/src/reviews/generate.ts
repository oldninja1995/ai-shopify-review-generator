import { prisma, findAiSettingsSafe } from "@ai-shopify/db";
import {
  decryptSecret,
  detectAudienceGender,
  pickGiftRecipient,
  pickPositiveRating,
  pickWeightedLength,
  pickWeightedRating,
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
  /** When every configured AI provider fails, skip the review (produceReview returns null)
   * instead of falling back to the phrase-bank generator. Off by default (AiSettings.aiOnlyMode). */
  aiOnlyMode: boolean;
  /** Called (at most once per generateReviewsForProduct call — see the caller) when every
   * configured provider failed, so the dashboard can surface that AI generation is currently
   * degraded — regardless of whether this review fell back to the phrase bank or was skipped. */
  onAiFallback?: (error: unknown) => void;
  /** Called after every provider call attempt so the dashboard can show live remaining/limit
   * numbers instead of a guess. */
  onQuotaInfo?: (event: ProviderQuotaEvent) => void;
  /** Set when the reviewer's own gender doesn't match the product's detected audience. */
  giftRecipient?: string;
};

/** Tries real AI generation first when configured; falls back to the phrase-bank assembler on any
 * failure (missing/invalid key, rate limit, network error) so a job never hard-fails over this —
 * unless `aiOnlyMode` is on, in which case a failure returns null (skip this review) instead. */
async function produceReview(params: ProduceReviewParams): Promise<AssembledReview | null> {
  const { ai, aiOnlyMode, productTitle, reviewer, onAiFallback, onQuotaInfo, ...assembleParams } = params;

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
      onAiFallback?.(error);
      if (aiOnlyMode) {
        console.error(`[review-generation] AI generation failed for all models, skipping review (AI-only mode):`, error);
        return null;
      }
      console.error(`[review-generation] AI generation failed for all models, falling back to phrase bank:`, error);
    }
  }

  return assembleReview(assembleParams);
}

export async function generateReviewsForProduct(payload: ReviewGenerationJobPayload): Promise<void> {
  const { productId, maleCount, femaleCount, lengthMode, length, lengthWeights, ratingWeights } =
    payload;

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
  // Any number of additional OpenAI-compatible providers, tried after the two built-ins. Each is a
  // separate account with its own quota, which is the only thing that actually raises throughput —
  // OpenRouter's free models all share one account-wide daily allowance, so adding more of those
  // buys nothing. Best-effort: a missing table (migration not yet applied) must not stop generation.
  const customProviders = await prisma.aiProviderCredential
    .findMany({
      where: { storeId: product.storeId, enabled: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })
    .catch(() => []);

  const customAi: AiProviderConfig[] = aiSettings?.enabled
    ? customProviders
        .filter((row) => row.models.length > 0)
        .map((row) => ({
          name: row.slug,
          baseUrl: row.baseUrl.replace(/\/+$/, ""),
          apiKey: decryptSecret(row.apiKeyEncrypted, env.ENCRYPTION_KEY),
          models: row.models,
        }))
    : [];

  const ai: AiProviderConfig[] = [openRouterAi, groqAi, ...customAi].filter(
    (config): config is AiProviderConfig => Boolean(config),
  );
  const aiOnlyMode = aiSettings?.aiOnlyMode ?? false;

  // Persists a plain, universal health signal per provider+model so the dashboard can show
  // whether it's actually working right now — derived only from real call outcomes, not a
  // guessed daily cap or free/paid heuristic (see AiProviderStatus's schema doc comment).
  function persistQuotaEvent(event: ProviderQuotaEvent) {
    void (async () => {
      try {
        const existing = await prisma.aiProviderStatus.findUnique({
          where: { storeId_provider_model: { storeId: product.storeId, provider: event.provider, model: event.model } },
        });

        const data = {
          status: (event.ok ? "OK" : "BLOCKED") as "OK" | "BLOCKED",
          // Preserve the original blocked-since timestamp across consecutive failures; clear it
          // the moment a call succeeds again.
          blockedSince: event.ok ? null : (existing?.status === "BLOCKED" ? existing.blockedSince : new Date()),
          lastError: event.ok ? null : (event.error ?? null),
        };

        await prisma.aiProviderStatus.upsert({
          where: { storeId_provider_model: { storeId: product.storeId, provider: event.provider, model: event.model } },
          create: { storeId: product.storeId, provider: event.provider, model: event.model, ...data },
          update: data,
        });
      } catch (error) {
        console.error("[review-generation] failed to persist AI provider status:", error);
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
    const reviewer = await getOrCreateReviewer(product.storeId, gender);
    usedReviewerIds.add(reviewer.id);
    slots.push({
      gender,
      reviewer,
      giftRecipient: audience !== "UNISEX" && audience !== gender ? pickGiftRecipient(gender) : undefined,
      reviewLength: lengthMode === "MIXED" && lengthWeights ? pickWeightedLength(lengthWeights) : length,
      // Jobs queued before the rating mix was configurable carry no weights — fall back to the
      // old fixed ~69/31 split rather than skewing an in-flight batch.
      rating: ratingWeights ? pickWeightedRating(ratingWeights) : pickPositiveRating(),
    });
  }

  // Surfaces AI-provider exhaustion on the dashboard (Logs page) instead of it only ever showing
  // up as a console.error — logged at most once per product per job, since a full batch can
  // trigger this dozens of times and flooding the log would bury everything else. Only used for
  // the classic (non-aiOnlyMode) fallback path — aiOnlyMode logs its own single stop-and-warn
  // message below instead, once the batch is done. Both messages share the "every configured AI
  // provider" phrase that ai-status-banner.tsx matches on to show the "degraded" warning.
  let aiFallbackWarned = false;
  function warnAiFallbackOnce(error: unknown) {
    if (aiOnlyMode || aiFallbackWarned || ai.length === 0) return;
    aiFallbackWarned = true;
    const providerList = `${openRouterAi ? "OpenRouter" : ""}${openRouterAi && groqAi ? " + " : ""}${groqAi ? "Groq" : ""}`;
    void logSystemEvent(
      "WARN",
      `AI review generation fell back to the phrase-bank generator for "${product.title}" — every configured AI provider (${providerList}) failed, likely rate-limited.`,
      {
        userId: product.store.userId,
        metadata: { productId, error: error instanceof Error ? error.message : String(error) },
      },
    );
  }

  // Counts reviews AI could not produce (AI-only mode skips them rather than falling back to the
  // phrase bank). Purely for reporting.
  //
  // This used to also set an `aiExhausted` flag on the FIRST failure, after which every remaining
  // slot for the product was abandoned. The intent was to avoid burning requests against a spent
  // provider — but it meant one transient 429 on the second review discarded the other fourteen,
  // and in practice produced 1.0 reviews per product against 16 requested. The per-model cooldown
  // in model-health.ts now provides that protection properly: once models are in cooldown a further
  // attempt costs no network calls at all and throws immediately, so every slot can safely try.
  let skippedCount = 0;

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
          aiOnlyMode,
          onAiFallback: warnAiFallbackOnce,
          onQuotaInfo: persistQuotaEvent,
          giftRecipient,
        });
        if (produced === null) {
          skippedCount++;
          return;
        }
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
            aiOnlyMode,
            onAiFallback: warnAiFallbackOnce,
            onQuotaInfo: persistQuotaEvent,
            giftRecipient,
          });
          if (produced === null) {
            skippedCount++;
            return;
          }
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

  if (skippedCount > 0) {
    void logSystemEvent(
      "WARN",
      `AI could not produce ${skippedCount} of ${slots.length} review(s) for "${product.title}" — every configured provider failed or is in cooldown. AI-only mode is on, so those were skipped rather than phrase-bank generated.`,
      { userId: product.store.userId, metadata: { productId, skippedCount, requestedCount: slots.length } },
    );
  }
}
