import { Worker } from "bullmq";
import { QUEUE_NAMES } from "@ai-shopify/shared";
import { connection } from "../redis.js";
import { processUploadJob } from "../review-providers/process-upload.js";

export const reviewUploadWorker = new Worker<{ uploadJobId: string }>(
  QUEUE_NAMES.REVIEW_UPLOAD,
  async (job) => {
    const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
    await processUploadJob(job.data.uploadJobId, isFinalAttempt);
  },
  {
    connection,
    concurrency: 5,
    // Discovered in production: 5 concurrent uploads firing at once was enough to trip Judge.me's
    // rate limit (429 "Retry later") on a real bulk-upload burst. Concurrency alone doesn't
    // control the *rate* jobs start, just how many run at once — this limiter caps starts to 2/sec
    // regardless of concurrency, which smooths the burst without giving up the parallelism.
    limiter: { max: 2, duration: 1000 },
  },
);

reviewUploadWorker.on("failed", (job, error) => {
  console.error(`[review-upload] job ${job?.id} failed:`, error);
});
