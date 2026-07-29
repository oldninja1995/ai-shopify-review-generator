import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { QUEUE_NAMES } from "@ai-shopify/shared";

declare global {
  var __redisConnection: Redis | undefined;
  var __shopifySyncQueue: Queue | undefined;
  var __reviewGenerationQueue: Queue | undefined;
  var __reviewUploadQueue: Queue | undefined;
  var __duplicateCheckQueue: Queue | undefined;
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
  globalThis.__reviewGenerationQueue ??
  new Queue(QUEUE_NAMES.REVIEW_GENERATION, {
    connection,
    // Without this a product got exactly one attempt, so any transient failure — most importantly
    // a Prisma "timed out fetching a connection from the pool" under Supabase's free-tier cap —
    // permanently cost that product every one of its reviews, with no way to revisit it. The
    // backoff is deliberately long: pool starvation clears by other work finishing, so retrying a
    // second later just re-enters the same contention.
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 10_000 } },
  });

export const reviewUploadQueue =
  globalThis.__reviewUploadQueue ??
  new Queue(QUEUE_NAMES.REVIEW_UPLOAD, {
    connection,
    // Judge.me (and other providers) can return a transient 429/5xx under bursts — retry with
    // growing backoff instead of a single hit-or-miss attempt. Applies to every job added via
    // this queue instance (bulk upload, single retry) without each call site needing to remember it.
    defaultJobOptions: { attempts: 4, backoff: { type: "exponential", delay: 3000 } },
  });

export const duplicateCheckQueue =
  globalThis.__duplicateCheckQueue ?? new Queue(QUEUE_NAMES.DUPLICATE_CHECK, { connection });

if (process.env.NODE_ENV !== "production") {
  globalThis.__redisConnection = connection;
  globalThis.__shopifySyncQueue = shopifySyncQueue;
  globalThis.__reviewGenerationQueue = reviewGenerationQueue;
  globalThis.__reviewUploadQueue = reviewUploadQueue;
  globalThis.__duplicateCheckQueue = duplicateCheckQueue;
}
