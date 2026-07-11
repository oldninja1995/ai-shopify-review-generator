import { Worker } from "bullmq";
import { prisma } from "@ai-shopify/db";
import { QUEUE_NAMES, type ReviewGenerationJobPayload } from "@ai-shopify/shared";
import { connection } from "../redis.js";
import { generateReviewsForProduct } from "../reviews/generate.js";

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
      throw error;
    }
  },
  { connection },
);

reviewGenerationWorker.on("failed", (job, error) => {
  console.error(`[review-generation] job ${job?.id} failed:`, error);
});
