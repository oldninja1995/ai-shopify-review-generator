import { Queue } from "bullmq";
import { QUEUE_NAMES } from "@ai-shopify/shared";
import { connection } from "../redis.js";

/**
 * Queue producers. Each queue gets its consumer (BullMQ `Worker`) wired
 * up in the phase that implements the corresponding job:
 *   SHOPIFY_SYNC            -> done (see ./shopify-sync.worker.ts)
 *   PRODUCT_VISION_ANALYSIS -> Phase 7 (Claude Vision analysis)
 *   REVIEW_GENERATION       -> Phase 9 (review generator) / Phase 12 (bulk)
 *   REVIEW_UPLOAD           -> done (see ./review-upload.worker.ts)
 */
export const shopifySyncQueue = new Queue(QUEUE_NAMES.SHOPIFY_SYNC, { connection });
export const productVisionAnalysisQueue = new Queue(QUEUE_NAMES.PRODUCT_VISION_ANALYSIS, {
  connection,
});
export const reviewGenerationQueue = new Queue(QUEUE_NAMES.REVIEW_GENERATION, { connection });
export const reviewUploadQueue = new Queue(QUEUE_NAMES.REVIEW_UPLOAD, { connection });

export const queues = [
  shopifySyncQueue,
  productVisionAnalysisQueue,
  reviewGenerationQueue,
  reviewUploadQueue,
];
