import { Worker } from "bullmq";
import { QUEUE_NAMES, type ShopifySyncJobPayload } from "@ai-shopify/shared";
import { connection } from "../redis.js";
import { syncShopifyStore } from "../shopify/sync.js";

export const shopifySyncWorker = new Worker<ShopifySyncJobPayload>(
  QUEUE_NAMES.SHOPIFY_SYNC,
  async (job) => {
    await syncShopifyStore(job.data.storeId);
  },
  { connection },
);

shopifySyncWorker.on("failed", (job, error) => {
  console.error(`[shopify-sync] job ${job?.id} failed:`, error);
});
