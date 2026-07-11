import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { QUEUE_NAMES } from "@ai-shopify/shared";

declare global {
  var __redisConnection: Redis | undefined;
  var __shopifySyncQueue: Queue | undefined;
  var __reviewGenerationQueue: Queue | undefined;
  var __reviewUploadQueue: Queue | undefined;
}

function requireEnv(name: "REDIS_URL"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const connection =
  globalThis.__redisConnection ??
  new Redis(requireEnv("REDIS_URL"), { maxRetriesPerRequest: null });

export const shopifySyncQueue =
  globalThis.__shopifySyncQueue ?? new Queue(QUEUE_NAMES.SHOPIFY_SYNC, { connection });

export const reviewGenerationQueue =
  globalThis.__reviewGenerationQueue ?? new Queue(QUEUE_NAMES.REVIEW_GENERATION, { connection });

export const reviewUploadQueue =
  globalThis.__reviewUploadQueue ?? new Queue(QUEUE_NAMES.REVIEW_UPLOAD, { connection });

if (process.env.NODE_ENV !== "production") {
  globalThis.__redisConnection = connection;
  globalThis.__shopifySyncQueue = shopifySyncQueue;
  globalThis.__reviewGenerationQueue = reviewGenerationQueue;
  globalThis.__reviewUploadQueue = reviewUploadQueue;
}
