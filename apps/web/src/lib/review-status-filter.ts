import type { Prisma, ReviewStatus } from "@ai-shopify/db";

export const REVIEW_STATUSES: ReviewStatus[] = [
  "DRAFT",
  "APPROVED",
  "QUEUED",
  "UPLOADED",
  "FAILED",
  "DUPLICATE_REGENERATED",
];

export function toReviewStatus(value: string | undefined): ReviewStatus | undefined {
  return REVIEW_STATUSES.find((s) => s === value);
}

/** Mirrors the Generated Reviews page's filter dropdown: "ALL" means no filter, an unrecognized
 * or absent value falls back to the default DRAFT/APPROVED view, otherwise filters to that status. */
export function resolveReviewStatusFilter(status: string | undefined): Prisma.GeneratedReviewWhereInput {
  return status === "ALL" ? {} : { status: toReviewStatus(status) ?? { in: ["DRAFT", "APPROVED"] } };
}
