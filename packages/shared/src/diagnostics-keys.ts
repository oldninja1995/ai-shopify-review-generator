/** Redis keys and channels the web app and worker use to talk about worker health.
 *
 * The two processes share only Redis and Postgres — there is no HTTP path from Vercel to the
 * Railway worker, and adding one would mean exposing the worker publicly plus a shared secret.
 * Redis is already a hard dependency of both, so worker-local state that the dashboard needs to
 * see (and clear) travels through it instead.
 *
 * This matters because the most confusing failure this app has is invisible from the database:
 * model cooldowns live in the worker's memory, so a store can have every model reporting OK in
 * `ai_provider_status` while the worker refuses to call any of them. */

/** Worker's current in-process model cooldown map, as DiagnosticsSnapshot JSON. Written by the
 * worker on change; read by the dashboard. Expires so a dead worker's snapshot doesn't linger and
 * read as current. */
export const WORKER_SNAPSHOT_KEY = "worker:diagnostics:snapshot";

/** Seconds the snapshot survives without a refresh. Comfortably longer than the write interval,
 * so a healthy but idle worker never looks absent, and short enough that a stopped worker stops
 * answering quickly. */
export const WORKER_SNAPSHOT_TTL_S = 90;

/** How often the worker republishes, even when nothing changed — this doubles as the heartbeat
 * that tells the dashboard the worker process is alive at all. */
export const WORKER_SNAPSHOT_INTERVAL_MS = 30_000;

/** Published to by the dashboard to clear every worker's in-process cooldown map. Pub/sub rather
 * than a key so that all replicas act on it, not whichever one happens to poll first. */
export const CLEAR_COOLDOWNS_CHANNEL = "worker:diagnostics:clear-cooldowns";

/** One blocked provider/model entry as the dashboard sees it. */
export type CooldownEntry = {
  provider: string;
  model: string;
  /** Epoch ms the block lifts. */
  until: number;
  /** HTTP status that caused the block; 0 for a network error or timeout. */
  status: number;
};

export type DiagnosticsSnapshot = {
  /** Epoch ms this snapshot was written — the worker's heartbeat. */
  at: number;
  /** Total models the worker currently refuses to call. */
  blockedCount: number;
  entries: CooldownEntry[];
  /** Reviews attempted per provider/model since this worker process started. Distinguishes "never
   * tried" from "tried and failing", which the cooldown list alone cannot. */
  usage: { provider: string; model: string; total: number; calls: number }[];
};
