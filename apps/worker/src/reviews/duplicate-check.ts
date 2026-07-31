import { prisma } from "@ai-shopify/db";
import { decryptSecret, type DuplicateCheckJobPayload } from "@ai-shopify/shared";
import { detectAiDuplicates } from "./ai-duplicate-detect.js";
import { env } from "../env.js";

const DELETE_CHUNK_SIZE = 200;
// Lowered from 40 (a Neon-era tuning) after migrating to Supabase — the free-tier pooler caps out
// around 15 connections total, and each concurrent product here does several DB queries alongside
// its OpenRouter call, so 40 in flight was enough to exhaust the pool on its own. See the matching
// fix/comment on review-generation.worker.ts's concurrency.
const AI_PRODUCT_CONCURRENCY = 10;

type ReviewRow = {
  id: string;
  contentEmbeddingHash: string;
  reviewerProfileId: string;
  productId: string;
  createdAt: Date;
  content: string;
};

export function groupByProduct(reviews: ReviewRow[]): Map<string, ReviewRow[]> {
  const byProduct = new Map<string, ReviewRow[]>();
  for (const review of reviews) {
    const arr = byProduct.get(review.productId);
    if (arr) arr.push(review);
    else byProduct.set(review.productId, [review]);
  }
  return byProduct;
}

/** Exact-match content dedup — same logic the app has always used. Used directly for EXACT-mode
 * jobs, and as the per-product fallback for AI-mode jobs when AI is unavailable or fails. */
export function findExactContentDupes(productReviews: ReviewRow[]): Set<string> {
  const contentDupeIds = new Set<string>();
  const seenHash = new Set<string>();
  for (const review of productReviews) {
    if (seenHash.has(review.contentEmbeddingHash)) contentDupeIds.add(review.id);
    else seenHash.add(review.contentEmbeddingHash);
  }
  return contentDupeIds;
}

/** Same exact-hash logic as `findExactContentDupes`, but also reports which earlier review each
 * duplicate actually matches (the first review that hash was seen on) — needed anywhere the match
 * is shown to a user, since a product can contain more than one distinct duplicate group. */
export function findExactContentDupePairs(
  productReviews: ReviewRow[],
): { reviewId: string; matchedReviewId: string }[] {
  const firstSeenByHash = new Map<string, string>();
  const pairs: { reviewId: string; matchedReviewId: string }[] = [];
  for (const review of productReviews) {
    const original = firstSeenByHash.get(review.contentEmbeddingHash);
    if (original) pairs.push({ reviewId: review.id, matchedReviewId: original });
    else firstSeenByHash.set(review.contentEmbeddingHash, review.id);
  }
  return pairs;
}

export function findReviewerDupes(productReviews: ReviewRow[]): Set<string> {
  const reviewerDupeIds = new Set<string>();
  const seenReviewer = new Set<string>();
  for (const review of productReviews) {
    if (seenReviewer.has(review.reviewerProfileId)) reviewerDupeIds.add(review.id);
    else seenReviewer.add(review.reviewerProfileId);
  }
  return reviewerDupeIds;
}

export async function runExactCheck(jobId: string, reviews: ReviewRow[]): Promise<void> {
  const byProduct = groupByProduct(reviews);

  const contentDupeIds = new Set<string>();
  const reviewerDupeIds = new Set<string>();
  for (const productReviews of byProduct.values()) {
    for (const id of findExactContentDupes(productReviews)) contentDupeIds.add(id);
    for (const id of findReviewerDupes(productReviews)) reviewerDupeIds.add(id);
  }

  const toDelete = Array.from(new Set([...contentDupeIds, ...reviewerDupeIds]));

  await prisma.duplicateCheckJob.update({
    where: { id: jobId },
    data: {
      totalToDelete: toDelete.length,
      contentDuplicatesRemoved: contentDupeIds.size,
      reviewerDuplicatesRemoved: reviewerDupeIds.size,
    },
  });

  for (let i = 0; i < toDelete.length; i += DELETE_CHUNK_SIZE) {
    const current = await prisma.duplicateCheckJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (current?.status !== "RUNNING") return;

    const chunk = toDelete.slice(i, i + DELETE_CHUNK_SIZE);
    await prisma.generatedReview.deleteMany({ where: { id: { in: chunk } } });
    await prisma.duplicateCheckJob.update({
      where: { id: jobId },
      data: { deletedCount: { increment: chunk.length } },
    });
  }

  await prisma.duplicateCheckJob.update({ where: { id: jobId }, data: { status: "COMPLETED" } });
}

/** AI-mode: detects likely duplicates (content via AI judgment, reviewer via exact match, same as
 * always) and deletes them immediately, same as EXACT mode — the only difference from EXACT is
 * which detection logic decides what counts as a duplicate. */
export async function runAiCheck(jobId: string, storeId: string, reviews: ReviewRow[]): Promise<void> {
  const byProduct = groupByProduct(reviews);
  // Chronological within each product, oldest first, so "duplicateOfIndex" always points at the
  // earlier (kept) review — matches the EXACT-mode convention of keeping the earliest.
  for (const productReviews of byProduct.values()) {
    productReviews.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  const store = await prisma.shopifyStore.findUniqueOrThrow({
    where: { id: storeId },
    include: { aiSettings: true },
  });
  const aiSettings = store.aiSettings;
  const ai =
    aiSettings?.enabled && aiSettings.apiKeyEncrypted && aiSettings.models.length > 0
      ? { apiKey: decryptSecret(aiSettings.apiKeyEncrypted, env.ENCRYPTION_KEY), models: aiSettings.models }
      : undefined;

  const productEntries = Array.from(byProduct.entries());
  let scanned = 0;
  let flaggedTotal = 0;
  let contentFlagged = 0;
  let reviewerFlagged = 0;
  let deleted = 0;

  for (let i = 0; i < productEntries.length; i += AI_PRODUCT_CONCURRENCY) {
    // Cooperative cancellation: the cancel endpoint can't force-remove a BullMQ job that's already
    // active (locked by this worker), so it just flips the DB status instead — check for that
    // between batches and bail out rather than clobbering it back to AWAITING_CONFIRMATION.
    const current = await prisma.duplicateCheckJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (current?.status !== "RUNNING") return;

    const batch = productEntries.slice(i, i + AI_PRODUCT_CONCURRENCY);
    await Promise.all(
      batch.map(async ([, productReviews]) => {
        const reviewerDupeIds = findReviewerDupes(productReviews);

        let contentPairs: { reviewId: string; matchedReviewId: string }[] = [];
        if (productReviews.length >= 2) {
          const aiResult = ai
            ? await detectAiDuplicates(
                ai.apiKey,
                ai.models,
                productReviews.map((r) => ({ id: r.id, content: r.content })),
              )
            : null;

          if (aiResult !== null) {
            contentPairs = aiResult;
          } else {
            // AI unavailable or failed for this product — fall back to exact-hash matching, same
            // logic EXACT mode uses, so this product still gets a real (if less thorough) check.
            contentPairs = findExactContentDupePairs(productReviews);
          }
        }

        const contentDupeIds = new Set(contentPairs.map((p) => p.reviewId));
        const toDelete = Array.from(new Set([...contentDupeIds, ...reviewerDupeIds]));

        if (toDelete.length > 0) {
          await prisma.generatedReview.deleteMany({ where: { id: { in: toDelete } } });
        }

        scanned += productReviews.length;
        flaggedTotal += toDelete.length;
        contentFlagged += contentDupeIds.size;
        reviewerFlagged += toDelete.length - contentDupeIds.size;
        deleted += toDelete.length;
      }),
    );

    await prisma.duplicateCheckJob.update({
      where: { id: jobId },
      data: {
        scannedCount: scanned,
        totalToDelete: flaggedTotal,
        deletedCount: deleted,
        contentDuplicatesRemoved: contentFlagged,
        reviewerDuplicatesRemoved: reviewerFlagged,
      },
    });
  }

  await prisma.duplicateCheckJob.update({
    where: { id: jobId },
    data: { status: "COMPLETED" },
  });
}

export async function runDuplicateCheckJob(payload: DuplicateCheckJobPayload): Promise<void> {
  const { jobId, storeId, scope, limit, checkMode } = payload;

  // Guards the same race the upload processor already guards against: if a worker redeploy stalls
  // this job mid-run and BullMQ retries it later, don't resurrect it unless it's genuinely still
  // fresh. Allowlisting PENDING (rather than denylisting terminal statuses) also blocks retrying
  // into an already-RUNNING job (duplicate concurrent processing) or a legacy AWAITING_CONFIRMATION
  // job (would silently auto-delete reviews a user might still be reviewing via the confirm UI).
  const existing = await prisma.duplicateCheckJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true } });
  if (existing.status !== "PENDING") return;

  await prisma.duplicateCheckJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });

  try {
    const reviews = await prisma.generatedReview.findMany({
      where: { product: { storeId } },
      select: {
        id: true,
        contentEmbeddingHash: true,
        reviewerProfileId: true,
        productId: true,
        createdAt: true,
        content: true,
      },
      orderBy: { createdAt: "desc" },
      take: scope === "LIMIT" ? limit : undefined,
    });

    await prisma.duplicateCheckJob.update({
      where: { id: jobId },
      data: {
        totalCount: reviews.length,
        scannedCount: checkMode === "EXACT" ? reviews.length : 0,
      },
    });

    if (checkMode === "AI") {
      await runAiCheck(jobId, storeId, reviews);
    } else {
      // Oldest first, so the earliest review of a set is always the one kept.
      const chronological = [...reviews].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      await runExactCheck(jobId, chronological);
    }
  } catch (error) {
    await prisma.duplicateCheckJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
