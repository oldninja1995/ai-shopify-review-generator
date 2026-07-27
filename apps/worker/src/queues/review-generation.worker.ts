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
  // Lowered from 60 (a Neon-era tuning) after migrating to Supabase — the free-tier pooler caps
  // out around 15 connections total, and 60 concurrent products (each fanning out further per
  // reviewer slot) blew through that with `P2024: Timed out fetching a new connection from the
  // connection pool`, failing the vast majority of a bulk job. Postgres connections, not
  // OpenRouter rate limits, are the real ceiling on this DB tier — don't raise this again without
  // first confirming the Supabase project's actual pool_size.
  { connection, concurrency: 10 },
);

reviewGenerationWorker.on("failed", (job, error) => {
  console.error(`[review-generation] job ${job?.id} failed:`, error);
});
