import { Worker } from "bullmq";
import { QUEUE_NAMES, type DuplicateCheckJobPayload } from "@ai-shopify/shared";
import { connection } from "../redis.js";
import { runDuplicateCheckJob } from "../reviews/duplicate-check.js";

export const duplicateCheckWorker = new Worker<DuplicateCheckJobPayload>(
  QUEUE_NAMES.DUPLICATE_CHECK,
  async (job) => {
    await runDuplicateCheckJob(job.data);
  },
  { connection },
);

duplicateCheckWorker.on("failed", (job, error) => {
  console.error(`[duplicate-check] job ${job?.id} failed:`, error);
});
