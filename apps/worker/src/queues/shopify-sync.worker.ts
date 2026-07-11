import { Worker } from "bullmq";
import { prisma } from "@ai-shopify/db";
import { QUEUE_NAMES, type ShopifySyncJobPayload } from "@ai-shopify/shared";
import { connection } from "../redis.js";
import { syncShopifyStore } from "../shopify/sync.js";
import { logSystemEvent } from "../logging.js";

export const shopifySyncWorker = new Worker<ShopifySyncJobPayload>(
  QUEUE_NAMES.SHOPIFY_SYNC,
  async (job) => {
    const store = await prisma.shopifyStore.findUnique({ where: { id: job.data.storeId } });
    try {
      await syncShopifyStore(job.data.storeId);
      const productCount = await prisma.product.count({ where: { storeId: job.data.storeId } });
      await logSystemEvent("INFO", `Synced ${store?.shopDomain ?? job.data.storeId} — ${productCount} products`, {
        userId: store?.userId,
        metadata: { storeId: job.data.storeId, productCount },
      });
    } catch (error) {
      await logSystemEvent(
        "ERROR",
        `Sync failed for ${store?.shopDomain ?? job.data.storeId}: ${error instanceof Error ? error.message : String(error)}`,
        { userId: store?.userId, metadata: { storeId: job.data.storeId } },
      );
      throw error;
    }
  },
  { connection },
);

shopifySyncWorker.on("failed", (job, error) => {
  console.error(`[shopify-sync] job ${job?.id} failed:`, error);
});
