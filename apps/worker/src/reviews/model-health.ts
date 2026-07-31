/** In-process memory of which provider/model pairs are currently unusable, so a batch stops
 * re-discovering the same dead models on every single review.
 *
 * Without this, each review walks the whole configured model list and pays a real HTTP round trip
 * per model — even for models that returned "insufficient credits" or "no longer free" seconds
 * earlier and cannot possibly have recovered. With 28 configured models that is ~56 doomed requests
 * per review (each model is tried twice, see generateReviewWithModel), tripled again by the content
 * -hash retry loop. That was the dominant cost of a bulk run, not generation itself.
 *
 * Deliberately in-process and not persisted: it is a latency optimisation, not a source of truth.
 * The AiProviderStatus table remains the durable record. A worker restart re-probes everything,
 * which is the behaviour we want after a credit top-up or a plan change. */

import type { CooldownEntry } from "@ai-shopify/shared";

type Block = {
  /** Epoch ms after which this model may be tried again. */
  until: number;
  status: number;
};

const blocked = new Map<string, Block>();

const keyFor = (provider: string, model: string) => `${provider}:${model}`;

// A model whose id no longer exists, or a key that was rejected, will not fix itself inside one
// run — but the block is still time-boxed rather than permanent so a long-lived worker recovers on
// its own once settings change.
const COOLDOWN_MS: Record<"gone" | "quota" | "server", number> = {
  gone: 60 * 60 * 1000,
  quota: 10 * 60 * 1000,
  server: 60 * 1000,
};

function cooldownFor(status: number): number {
  if (status === 401 || status === 403 || status === 404) return COOLDOWN_MS.gone;
  if (status === 402) return COOLDOWN_MS.gone;
  if (status === 429) return COOLDOWN_MS.quota;
  return COOLDOWN_MS.server;
}

/** Records a failed call. `retryAfterSeconds`, when the provider sends it, always wins over the
 * default cooldown — it is the provider telling us exactly when to come back. */
export function noteModelFailure(
  provider: string,
  model: string,
  status: number,
  retryAfterSeconds?: number,
): void {
  const ms =
    retryAfterSeconds && Number.isFinite(retryAfterSeconds)
      ? retryAfterSeconds * 1000
      : cooldownFor(status);
  blocked.set(keyFor(provider, model), { until: Date.now() + ms, status });
}

export function noteModelSuccess(provider: string, model: string): void {
  blocked.delete(keyFor(provider, model));
}

export function isModelBlocked(provider: string, model: string): boolean {
  const entry = blocked.get(keyFor(provider, model));
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    blocked.delete(keyFor(provider, model));
    return false;
  }
  return true;
}

/** Used for logging — how much of the configured fleet is currently being skipped. */
export function blockedCount(): number {
  return blocked.size;
}

/** The live block list, for the diagnostics snapshot. Expired entries are filtered rather than
 * deleted: this is a read, and a read that mutates would make the same call return different
 * counts depending on who ran it first. */
export function cooldownEntries(): CooldownEntry[] {
  const now = Date.now();
  return [...blocked.entries()]
    .filter(([, entry]) => entry.until > now)
    .map(([key, entry]) => {
      const idx = key.indexOf(":");
      return {
        provider: key.slice(0, idx),
        model: key.slice(idx + 1),
        until: entry.until,
        status: entry.status,
      };
    });
}

/** Drops every cooldown so the next review re-probes the full fleet immediately.
 *
 * This exists because the cooldowns are the one piece of state a user cannot otherwise clear
 * without restarting the worker: a 402 blocks a model for an hour (see cooldownFor), so topping up
 * credits or fixing a key has no effect until that hour elapses. Returns how many were cleared so
 * the dashboard can report what it actually did. */
export function clearAllCooldowns(): number {
  const cleared = blocked.size;
  blocked.clear();
  return cleared;
}

/** Rolling token spend per provider+model for this worker process.
 *
 * Tracked because the binding constraint on a bulk run is tokens, not requests: a free tier with
 * 14,400 requests/day but 500k tokens/day runs dry after roughly 700 reviews at ~700 tokens each.
 * Requests-remaining headers therefore give a badly optimistic picture of how far a run can get. */
type Usage = { prompt: number; completion: number; calls: number };
const usage = new Map<string, Usage>();

export function noteTokenUsage(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): void {
  const key = keyFor(provider, model);
  const current = usage.get(key) ?? { prompt: 0, completion: 0, calls: 0 };
  current.prompt += Number.isFinite(promptTokens) ? promptTokens : 0;
  current.completion += Number.isFinite(completionTokens) ? completionTokens : 0;
  current.calls += 1;
  usage.set(key, current);
}

export function usageSnapshot(): { provider: string; model: string; total: number; calls: number }[] {
  return [...usage.entries()].map(([key, u]) => {
    const idx = key.indexOf(":");
    return {
      provider: key.slice(0, idx),
      model: key.slice(idx + 1),
      total: u.prompt + u.completion,
      calls: u.calls,
    };
  });
}
