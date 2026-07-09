const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * Parses simple durations like "15m", "30d", "1h" into milliseconds.
 * Used for token TTL env vars, which are also passed as-is to jose
 * (which accepts the same relative-time string format for JWT expiry).
 */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration string: "${value}" (expected e.g. "15m", "30d")`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_MS[unit as keyof typeof UNIT_MS];
}
