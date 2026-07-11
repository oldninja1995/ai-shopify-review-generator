import { prisma } from "@ai-shopify/db";
import type { ReviewGenerationJobPayload } from "@ai-shopify/shared";
import { assembleReview } from "./assemble-review.js";
import { hashReviewContent } from "./content-hash.js";
import { getOrCreateReviewer } from "./reviewer-pool.js";

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

export async function generateReviewsForProduct(payload: ReviewGenerationJobPayload): Promise<void> {
  const { productId, maleCount, femaleCount, length } = payload;

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    include: { store: { include: { brandSettings: true } } },
  });
  const effectiveProductType = payload.productType?.trim() || product.productType;
  const brand = product.store.brandSettings
    ? { name: product.store.brandSettings.brandName, category: product.store.brandSettings.brandCategory }
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
      let assembled = assembleReview({
        productType: effectiveProductType,
        rating,
        length,
        brand,
        excludeCombos: usedCombos,
      });
      let hash = hashReviewContent(assembled.content);
      let status: "DRAFT" | "DUPLICATE_REGENERATED" = "DRAFT";

      let retries = 0;
      while (usedHashes.has(hash) && retries < MAX_HASH_RETRIES) {
        usedCombos.add(assembled.comboKey);
        assembled = assembleReview({
          productType: effectiveProductType,
          rating,
          length,
          brand,
          excludeCombos: usedCombos,
        });
        hash = hashReviewContent(assembled.content);
        retries++;
      }
      if (usedHashes.has(hash)) {
        status = "DUPLICATE_REGENERATED";
      }

      usedCombos.add(assembled.comboKey);
      usedHashes.add(hash);

      await prisma.generatedReview.create({
        data: {
          productId,
          reviewerProfileId: reviewer.id,
          rating,
          title: assembled.title,
          content: assembled.content,
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
