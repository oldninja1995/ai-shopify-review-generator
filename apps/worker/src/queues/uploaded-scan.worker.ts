import { Worker } from "bullmq";
import { QUEUE_NAMES, type UploadedScanJobPayload } from "@ai-shopify/shared";
import { connection } from "../redis.js";
import { confirmUploadedScanDeletion, runUploadedScanJob } from "../reviews/uploaded-scan.js";

// Concurrency 1: this pages a third-party API sequentially and there is only ever one meaningful
// scan per store, so parallelism would buy nothing and risk tripping the provider's rate limit.
export const uploadedScanWorker = new Worker<UploadedScanJobPayload>(
  QUEUE_NAMES.UPLOADED_SCAN,
  async (job) => {
    if (job.data.action === "confirm") {
      await confirmUploadedScanDeletion(job.data.scanId);
      return;
    }
    await runUploadedScanJob(job.data);
  },
  { connection, concurrency: 1 },
);

uploadedScanWorker.on("failed", (job, error) => {
  console.error(`[uploaded-scan] job ${job?.id} failed:`, error);
});
