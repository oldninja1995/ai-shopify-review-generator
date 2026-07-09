import crypto from "node:crypto";

/** Opaque, DB-backed refresh token: a random string whose SHA-256 hash is stored server-side. */
export function generateRefreshToken(): { raw: string; hashed: string } {
  const raw = crypto.randomBytes(48).toString("hex");
  return { raw, hashed: hashOpaqueToken(raw) };
}

export function hashOpaqueToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
