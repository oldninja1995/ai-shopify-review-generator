import { Worker } from "bullmq";
import { QUEUE_NAMES } from "@ai-shopify/shared";
import { connection } from "../redis.js";
import { processUploadJob } from "../review-providers/process-upload.js";

export const reviewUploadWorker = new Worker<{ uploadJobId: string }>(
  QUEUE_NAMES.REVIEW_UPLOAD,
  async (job) => {
    await processUploadJob(job.data.uploadJobId);
  },
  // 5 uploads in flight at once instead of the BullMQ default of 1 — conservative since this
  // hits Judge.me's live API directly and their rate limits for this endpoint aren't documented.
  { connection, concurrency: 5 },
);

reviewUploadWorker.on("failed", (job, error) => {
  console.error(`[review-upload] job ${job?.id} failed:`, error);
});
