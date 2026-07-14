import { Worker } from "bullmq";
import { prisma } from "@ai-shopify/db";
import { QUEUE_NAMES, type ReviewGenerationJobPayload } from "@ai-shopify/shared";
import { connection } from "../redis.js";
import { generateReviewsForProduct } from "../reviews/generate.js";
import { logSystemEvent } from "../logging.js";

async function recordBulkProgress(bulkJobId: string, field: "completedCount" | "failedCount") {
  const job = await prisma.bulkGenerationJob.update({
    where: { id: bulkJobId },
    data: { [field]: { increment: 1 } },
  });
  if (job.status === "RUNNING" && job.completedCount + job.failedCount >= job.totalCount) {
    await prisma.bulkGenerationJob.update({
      where: { id: bulkJobId },
      data: { status: "COMPLETED" },
    });
  }
}

export const reviewGenerationWorker = new Worker<ReviewGenerationJobPayload>(
  QUEUE_NAMES.REVIEW_GENERATION,
  async (job) => {
    if (job.data.bulkJobId) {
      // Guards the race where this job was already dequeued before a cancel request reached the
      // queue — the cancel route removes waiting/delayed jobs, but can't stop one already picked up.
      const bulkJob = await prisma.bulkGenerationJob.findUnique({ where: { id: job.data.bulkJobId } });
      if (bulkJob?.status === "CANCELLED") return;
    }

    try {
      await generateReviewsForProduct(job.data);
      if (job.data.bulkJobId) await recordBulkProgress(job.data.bulkJobId, "completedCount");
    } catch (error) {
      if (job.data.bulkJobId) await recordBulkProgress(job.data.bulkJobId, "failedCount");
      const product = await prisma.product
        .findUnique({ where: { id: job.data.productId }, include: { store: true } })
        .catch(() => null);
      await logSystemEvent(
        "ERROR",
        `Review generation failed for ${product?.title ?? job.data.productId}: ${error instanceof Error ? error.message : String(error)}`,
        { userId: product?.store.userId, metadata: { productId: job.data.productId } },
      );
      throw error;
    }
  },
  // 35 products in flight at once. Raised from 10 after confirming (via production job timing)
  // that the real bottleneck is network wait on OpenRouter calls, not CPU or DB load — Node
  // handles many concurrent I/O-bound tasks fine. Now paired with generate.ts parallelizing a
  // product's own reviews too (previously sequential per-product), so this multiplies rather than
  // just adding more products stuck behind their own internal one-at-a-time review loop.
  { connection, concurrency: 35 },
);

reviewGenerationWorker.on("failed", (job, error) => {
  console.error(`[review-generation] job ${job?.id} failed:`, error);
});
