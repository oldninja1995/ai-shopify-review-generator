import { Worker } from "bullmq";
import { QUEUE_NAMES } from "@ai-shopify/shared";
import { connection } from "../redis.js";
import { processUploadJob } from "../review-providers/process-upload.js";

export const reviewUploadWorker = new Worker<{ uploadJobId: string }>(
  QUEUE_NAMES.REVIEW_UPLOAD,
  async (job) => {
    await processUploadJob(job.data.uploadJobId);
  },
  { connection },
);

reviewUploadWorker.on("failed", (job, error) => {
  console.error(`[review-upload] job ${job?.id} failed:`, error);
});
