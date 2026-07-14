import { Worker } from "bullmq";
import { prisma } from "@ai-shopify/db";
import { QUEUE_NAMES, type DuplicateCheckJobPayload } from "@ai-shopify/shared";
import { connection } from "../redis.js";

const DELETE_CHUNK_SIZE = 200;

export const duplicateCheckWorker = new Worker<DuplicateCheckJobPayload>(
  QUEUE_NAMES.DUPLICATE_CHECK,
  async (job) => {
    const { jobId, storeId, scope, limit } = job.data;

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
        },
        orderBy: { createdAt: "desc" },
        take: scope === "LIMIT" ? limit : undefined,
      });

      await prisma.duplicateCheckJob.update({
        where: { id: jobId },
        data: { scannedCount: reviews.length },
      });

      // Oldest first, so the earliest review of a set is always the one kept.
      const chronological = [...reviews].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      // Dedup is scoped per-product: with a small shared reviewer pool and a finite
      // phrase bank, the same reviewer/content hash is EXPECTED to recur across many
      // products at this app's scale. Flagging that store-wide once deleted 47,528 of
      // 47,596 reviews in one run. Only flag a reviewer or content hash repeating on
      // the SAME product as an actual duplicate.
      const byProduct = new Map<string, typeof chronological>();
      for (const review of chronological) {
        const arr = byProduct.get(review.productId);
        if (arr) {
          arr.push(review);
        } else {
          byProduct.set(review.productId, [review]);
        }
      }

      const contentDupeIds = new Set<string>();
      const reviewerDupeIds = new Set<string>();
      for (const productReviews of byProduct.values()) {
        const seenHash = new Set<string>();
        for (const review of productReviews) {
          if (seenHash.has(review.contentEmbeddingHash)) {
            contentDupeIds.add(review.id);
          } else {
            seenHash.add(review.contentEmbeddingHash);
          }
        }

        const seenReviewer = new Set<string>();
        for (const review of productReviews) {
          if (seenReviewer.has(review.reviewerProfileId)) {
            reviewerDupeIds.add(review.id);
          } else {
            seenReviewer.add(review.reviewerProfileId);
          }
        }
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
        const chunk = toDelete.slice(i, i + DELETE_CHUNK_SIZE);
        await prisma.generatedReview.deleteMany({ where: { id: { in: chunk } } });
        await prisma.duplicateCheckJob.update({
          where: { id: jobId },
          data: { deletedCount: { increment: chunk.length } },
        });
      }

      await prisma.duplicateCheckJob.update({ where: { id: jobId }, data: { status: "COMPLETED" } });
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
  },
  { connection },
);

duplicateCheckWorker.on("failed", (job, error) => {
  console.error(`[duplicate-check] job ${job?.id} failed:`, error);
});
