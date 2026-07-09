import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { QUEUE_NAMES } from "@ai-shopify/shared";

declare global {
  var __redisConnection: Redis | undefined;
  var __shopifySyncQueue: Queue | undefined;
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

if (process.env.NODE_ENV !== "production") {
  globalThis.__redisConnection = connection;
  globalThis.__shopifySyncQueue = shopifySyncQueue;
}
