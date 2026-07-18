/** A hung upstream response otherwise holds a BullMQ job's concurrency slot open forever — the
 * worker process stays alive and BullMQ's lock-renewal keeps ticking while merely awaiting a
 * pending fetch, so the job never stalls, fails, or frees its slot on its own. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
