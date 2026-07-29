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
      // BullMQ retries while `attemptsMade + 1 < opts.attempts`, and attemptsMade counts *finished*
      // attempts (so it is 0 during the first run) — this is exactly that condition negated.
      //
      // The counter must only move on the final attempt. Incrementing per attempt would report
      // several failures for one product, and because recordBulkProgress marks the whole run
      // COMPLETED once completedCount + failedCount reaches totalCount, an over-count would also
      // declare the bulk job finished while thousands of products were still queued.
      // BullMQ writes `attempts: 0` (not undefined) when a job is queued without the option, so
      // `?? 1` alone still yields 0 — hence the floor. Behaviour was already correct either way,
      // but the log line read "after 0 attempts".
      const maxAttempts = Math.max(1, job.opts.attempts ?? 1);
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
      if (job.data.bulkJobId && isFinalAttempt) {
        await recordBulkProgress(job.data.bulkJobId, "failedCount");
      }

      const product = await prisma.product
        .findUnique({ where: { id: job.data.productId }, include: { store: true } })
        .catch(() => null);
      const message = error instanceof Error ? error.message : String(error);
      const label = product?.title ?? job.data.productId;

      // A retryable hiccup is logged at INFO, not ERROR: with retries on, an ERROR line per attempt
      // would bury the failures that actually stuck, which are the ones worth acting on.
      await logSystemEvent(
        isFinalAttempt ? "ERROR" : "INFO",
        isFinalAttempt
          ? `Review generation failed for ${label} after ${maxAttempts} attempt${maxAttempts === 1 ? "" : "s"}: ${message}`
          : `Review generation for ${label} hit an error, will retry: ${message}`,
        { userId: product?.store.userId, metadata: { productId: job.data.productId } },
      );
      throw error;
    }
  },
  // Lowered from 60 (a Neon-era tuning) after migrating to Supabase — the free-tier pooler caps
  // out around 15 connections total. First attempt (concurrency 10 + connection_limit 10, see
  // DATABASE_URL) still starved: each in-flight product can issue more than one query at once
  // (e.g. the AiProviderStatus write alongside the main generation query), so a 1:1 concurrency-
  // to-connection_limit ratio left no headroom and completions stalled entirely. Dropped further
  // to 5, against a connection_limit of 15 (3x headroom per concurrent product) — don't raise
  // this again without first confirming the Supabase project's actual pool_size.
  { connection, concurrency: 5 },
);

reviewGenerationWorker.on("failed", (job, error) => {
  console.error(`[review-generation] job ${job?.id} failed:`, error);
});
