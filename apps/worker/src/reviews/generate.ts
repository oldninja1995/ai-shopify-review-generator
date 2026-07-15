import { prisma } from "@ai-shopify/db";
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
import { generateReviewWithAI } from "./ai-generate.js";
import { analyzeProductAudienceFromImage } from "./vision-audience.js";
import { hashReviewContent } from "./content-hash.js";
import { getOrCreateReviewer } from "./reviewer-pool.js";
import { env } from "../env.js";

const MAX_HASH_RETRIES = 2;
const MAX_REVIEW_AGE_DAYS = 180;

function randomPastDate(): Date {
  const daysAgo = Math.floor(Math.random() * MAX_REVIEW_AGE_DAYS);
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date;
}

type AiConfig = { apiKey: string; models: string[] };

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
  ai?: AiConfig;
  /** Set when the reviewer's own gender doesn't match the product's detected audience. */
  giftRecipient?: string;
};

/** Tries real AI generation first when configured; falls back to the phrase-bank assembler on any
 * failure (missing/invalid key, rate limit, network error) so a job never hard-fails over this. */
async function produceReview(params: ProduceReviewParams): Promise<AssembledReview> {
  const { ai, productTitle, reviewer, ...assembleParams } = params;

  if (ai) {
    try {
      const { title, content } = await generateReviewWithAI(ai.apiKey, ai.models, {
        productTitle,
        productType: assembleParams.productType,
        brand: assembleParams.brand,
        reviewer,
        rating: assembleParams.rating,
        length: assembleParams.length,
        giftRecipient: assembleParams.giftRecipient,
      });
      return { title, content, comboKey: `ai:${hashReviewContent(content)}` };
    } catch (error) {
      console.error(`[review-generation] AI generation failed for all models, falling back to phrase bank:`, error);
    }
  }

  return assembleReview(assembleParams);
}

export async function generateReviewsForProduct(payload: ReviewGenerationJobPayload): Promise<void> {
  const { productId, maleCount, femaleCount, lengthMode, length, lengthWeights } = payload;

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    include: {
      store: { include: { brandSettings: true, aiSettings: true } },
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

  const aiSettings = product.store.aiSettings;
  const ai: AiConfig | undefined =
    aiSettings?.enabled && aiSettings.apiKeyEncrypted && aiSettings.models.length > 0
      ? {
          apiKey: decryptSecret(aiSettings.apiKeyEncrypted, env.ENCRYPTION_KEY),
          models: aiSettings.models,
        }
      : undefined;

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
  // Cached on the product after the first successful analysis (detectedAudience) so this only
  // costs one API call ever per product, not one per generation request. Only persisted on a
  // definitive vision result — if vision isn't attempted (no AI configured, no image) or fails,
  // nothing is cached, so a later run can still retry it once AI/images are available.
  let audience = product.detectedAudience ?? detectAudienceGender(product.title, effectiveProductType);
  const primaryImage = product.images[0];
  if (!product.detectedAudience && ai && primaryImage) {
    try {
      const visionAudience = await analyzeProductAudienceFromImage(ai.apiKey, primaryImage.url);
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
