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

      const contentDupeIds = new Set<string>();
      const seenHash = new Map<string, string>();
      for (const review of chronological) {
        if (seenHash.has(review.contentEmbeddingHash)) {
          contentDupeIds.add(review.id);
        } else {
          seenHash.set(review.contentEmbeddingHash, review.id);
        }
      }

      const reviewerDupeIds = new Set<string>();
      const seenReviewerProduct = new Map<string, string>();
      for (const review of chronological) {
        const keptProductId = seenReviewerProduct.get(review.reviewerProfileId);
        if (keptProductId === undefined) {
          seenReviewerProduct.set(review.reviewerProfileId, review.productId);
        } else if (keptProductId !== review.productId) {
          reviewerDupeIds.add(review.id);
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
