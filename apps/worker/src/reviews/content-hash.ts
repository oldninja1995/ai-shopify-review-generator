import { createHash } from "node:crypto";

/** Normalizes review text and hashes it, for duplicate-content detection per product. */
export function hashReviewContent(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}
