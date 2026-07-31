import { Redis } from "ioredis";
import {
  CLEAR_COOLDOWNS_CHANNEL,
  WORKER_SNAPSHOT_INTERVAL_MS,
  WORKER_SNAPSHOT_KEY,
  WORKER_SNAPSHOT_TTL_S,
  type DiagnosticsSnapshot,
} from "@ai-shopify/shared";
import { env } from "./env.js";
import { connection } from "./redis.js";
import { clearAllCooldowns, cooldownEntries, usageSnapshot } from "./reviews/model-health.js";

/** Publishes worker-local state the dashboard cannot otherwise see, and accepts the one command
 * that can repair it.
 *
 * Model cooldowns live in this process's memory (see model-health.ts). The dashboard runs on
 * Vercel, so `ai_provider_status` in Postgres is the only thing it can read — and that table can
 * say every model is OK while this worker is refusing to call all of them. That gap is what makes
 * "generation produced fewer reviews than I asked for" so hard to explain from the UI alone.
 *
 * A separate Redis client is used for the subscriber: ioredis connections in subscriber mode can
 * only issue subscribe/unsubscribe commands, so reusing the shared `connection` would break every
 * queue that depends on it. */
export function startDiagnosticsPublisher(): void {
  const publish = async () => {
    const snapshot: DiagnosticsSnapshot = {
      at: Date.now(),
      blockedCount: cooldownEntries().length,
      entries: cooldownEntries(),
      usage: usageSnapshot(),
    };
    try {
      await connection.set(
        WORKER_SNAPSHOT_KEY,
        JSON.stringify(snapshot),
        "EX",
        WORKER_SNAPSHOT_TTL_S,
      );
    } catch (error) {
      // Diagnostics must never take the worker down — a Redis blip here costs visibility, not work.
      console.error("[diagnostics] failed to publish snapshot:", error);
    }
  };

  void publish();
  // unref so a pending timer can't hold the process open during shutdown.
  setInterval(publish, WORKER_SNAPSHOT_INTERVAL_MS).unref();

  const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  subscriber.on("error", (error) => {
    console.error("[diagnostics] subscriber error:", error);
  });

  void subscriber.subscribe(CLEAR_COOLDOWNS_CHANNEL, (error) => {
    if (error) {
      console.error("[diagnostics] could not subscribe to clear-cooldowns:", error);
      return;
    }
    console.log("[diagnostics] listening for cooldown clear requests");
  });

  subscriber.on("message", (channel) => {
    if (channel !== CLEAR_COOLDOWNS_CHANNEL) return;
    const cleared = clearAllCooldowns();
    console.log(`[diagnostics] cleared ${cleared} model cooldown(s) on request`);
    // Publish straight away so the dashboard reflects the change on its next read rather than
    // after the next interval — the user is watching this happen.
    void publish();
  });
}
