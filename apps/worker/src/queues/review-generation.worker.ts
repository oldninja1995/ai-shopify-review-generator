import { Worker } from "bullmq";
import { QUEUE_NAMES, type ReviewGenerationJobPayload } from "@ai-shopify/shared";
import { connection } from "../redis.js";
import { generateReviewsForProduct } from "../reviews/generate.js";

export const reviewGenerationWorker = new Worker<ReviewGenerationJobPayload>(
  QUEUE_NAMES.REVIEW_GENERATION,
  async (job) => {
    await generateReviewsForProduct(job.data);
  },
  { connection },
);

reviewGenerationWorker.on("failed", (job, error) => {
  console.error(`[review-generation] job ${job?.id} failed:`, error);
});
