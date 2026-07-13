export const QUEUE_NAMES = {
  SHOPIFY_SYNC: "shopify-sync",
  PRODUCT_VISION_ANALYSIS: "product-vision-analysis",
  REVIEW_GENERATION: "review-generation",
  REVIEW_UPLOAD: "review-upload",
  DUPLICATE_CHECK: "duplicate-check",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
