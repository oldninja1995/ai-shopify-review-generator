import { prisma } from "@ai-shopify/db";
import { decryptSecret, type ReviewGenerationJobPayload, type ReviewLength } from "@ai-shopify/shared";
import { assembleReview, type AssembledReview } from "./assemble-review.js";
import { generateReviewWithAI } from "./ai-generate.js";
import { hashReviewContent } from "./content-hash.js";
import { getOrCreateReviewer } from "./reviewer-pool.js";
import { env } from "../env.js";

const MAX_HASH_RETRIES = 2;
const MAX_REVIEW_AGE_DAYS = 180;

/** Skewed toward positive ratings, matching typical real-world review distributions. */
function randomRating(): number {
  const roll = Math.random();
  if (roll < 0.55) return 5;
  if (roll < 0.8) return 4;
  if (roll < 0.92) return 3;
  if (roll < 0.97) return 2;
  return 1;
}

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
      });
      return { title, content, comboKey: `ai:${hashReviewContent(content)}` };
    } catch (error) {
      console.error(`[review-generation] AI generation failed for all models, falling back to phrase bank:`, error);
    }
  }

  return assembleReview(assembleParams);
}

export async function generateReviewsForProduct(payload: ReviewGenerationJobPayload): Promise<void> {
  const { productId, maleCount, femaleCount, length } = payload;

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    include: { store: { include: { brandSettings: true, aiSettings: true } } },
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

  for (const gender of genderQueue) {
    try {
      const reviewer = await getOrCreateReviewer(product.storeId, gender, usedReviewerIds);
      usedReviewerIds.add(reviewer.id);

      const rating = randomRating();
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
        length,
        brand,
        reviewer: reviewerPersona,
        excludeCombos: usedCombos,
        ai,
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
          length,
          brand,
          reviewer: reviewerPersona,
          excludeCombos: usedCombos,
          ai,
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
  }
}
