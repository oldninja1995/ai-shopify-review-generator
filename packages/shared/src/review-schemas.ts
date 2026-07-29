import { z } from "zod";

export const REVIEW_LENGTHS = ["SHORT", "MEDIUM", "DETAILED"] as const;
export type ReviewLength = (typeof REVIEW_LENGTHS)[number];

export const LENGTH_MODES = ["FIXED", "MIXED"] as const;
export type LengthMode = (typeof LENGTH_MODES)[number];

/** Relative weights (need not sum to 100 — normalized at pick time), one per length tier. */
export type LengthWeights = Record<ReviewLength, number>;

// Real customer reviews skew short (often one quick sentence) — weighted toward SHORT/MEDIUM,
// DETAILED kept rare so long reviews don't dominate a batch.
export const DEFAULT_LENGTH_WEIGHTS: LengthWeights = { SHORT: 55, MEDIUM: 35, DETAILED: 10 };

const lengthWeightsSchema = z.object({
  SHORT: z.number().min(0),
  MEDIUM: z.number().min(0),
  DETAILED: z.number().min(0),
});

/** Picks a single review's length from a weighted mix instead of one fixed value for the whole
 * batch — real customers don't all write the same length review, so a uniform `length` across a
 * bulk-generated batch reads as unnaturally consistent. Falls back to MEDIUM if all weights are 0. */
export function pickWeightedLength(weights: LengthWeights): ReviewLength {
  const total = REVIEW_LENGTHS.reduce((sum, tier) => sum + Math.max(0, weights[tier] ?? 0), 0);
  if (total <= 0) return "MEDIUM";
  let roll = Math.random() * total;
  for (const tier of REVIEW_LENGTHS) {
    const weight = Math.max(0, weights[tier] ?? 0);
    if (roll < weight) return tier;
    roll -= weight;
  }
  return "MEDIUM";
}

// Only positive (4-5 star) reviews are auto-generated — this app exists to generate reviews that
// make a store look good, so neither negative nor neutral reviews serve that purpose. The 5-vs-4
// split within that positive band is configurable per batch, the same way length is.
export const RATING_TIERS = [5, 4] as const;
export type RatingTier = (typeof RATING_TIERS)[number];

/** Relative weights (need not sum to 100 — normalized at pick time), one per positive star tier. */
export type RatingWeights = Record<RatingTier, number>;

// Preserves this app's original hardcoded ~69/31 split (55/(55+25)) as the default, so a batch
// generated without touching the control looks exactly like it did before the setting existed.
export const DEFAULT_RATING_WEIGHTS: RatingWeights = { 5: 55, 4: 25 };

const ratingWeightsSchema = z.object({
  5: z.number().min(0),
  4: z.number().min(0),
});

/** Picks a single review's star rating from a weighted 5-vs-4 mix. Falls back to 5 if all weights
 * are 0. */
export function pickWeightedRating(weights: RatingWeights): number {
  const total = RATING_TIERS.reduce((sum, tier) => sum + Math.max(0, weights[tier] ?? 0), 0);
  if (total <= 0) return 5;
  let roll = Math.random() * total;
  for (const tier of RATING_TIERS) {
    const weight = Math.max(0, weights[tier] ?? 0);
    if (roll < weight) return tier;
    roll -= weight;
  }
  return 5;
}

/** The default 5-vs-4 split, for jobs queued without explicit weights (including jobs already on
 * the queue from before this setting existed). */
export function pickPositiveRating(): number {
  return pickWeightedRating(DEFAULT_RATING_WEIGHTS);
}

export const generateReviewsSchema = z
  .object({
    productId: z.string().min(1, "productId is required"),
    maleCount: z.number().int().min(0).max(110),
    femaleCount: z.number().int().min(0).max(110),
    productType: z.string().trim().max(80).optional(),
    lengthMode: z.enum(LENGTH_MODES).default("FIXED"),
    length: z.enum(REVIEW_LENGTHS).default("MEDIUM"),
    lengthWeights: lengthWeightsSchema.optional(),
    ratingWeights: ratingWeightsSchema.optional(),
  })
  .refine((value) => value.maleCount + value.femaleCount > 0, {
    message: "Request at least 1 review",
    path: ["maleCount"],
  })
  .refine((value) => value.maleCount + value.femaleCount <= 110, {
    message: "Request at most 110 reviews at a time",
    path: ["maleCount"],
  })
  .refine(
    (value) =>
      value.lengthMode !== "MIXED" ||
      (value.lengthWeights &&
        value.lengthWeights.SHORT + value.lengthWeights.MEDIUM + value.lengthWeights.DETAILED > 0),
    { message: "At least one length weight must be greater than 0", path: ["lengthWeights"] },
  )
  .refine((value) => !value.ratingWeights || value.ratingWeights[5] + value.ratingWeights[4] > 0, {
    message: "At least one rating weight must be greater than 0",
    path: ["ratingWeights"],
  });
export type GenerateReviewsInput = z.infer<typeof generateReviewsSchema>;

export type ReviewGenerationJobPayload = {
  productId: string;
  maleCount: number;
  femaleCount: number;
  productType?: string;
  lengthMode: LengthMode;
  length: ReviewLength;
  lengthWeights?: LengthWeights;
  ratingWeights?: RatingWeights;
  bulkJobId?: string;
};

export const BULK_GENERATION_SCOPES = ["SELECTED", "COLLECTION", "STORE"] as const;
export type BulkGenerationScope = (typeof BULK_GENERATION_SCOPES)[number];

export const REVIEW_COUNT_MODES = ["FIXED", "RANDOM"] as const;
export type ReviewCountMode = (typeof REVIEW_COUNT_MODES)[number];

export const bulkGenerateReviewsSchema = z
  .object({
    scope: z.enum(BULK_GENERATION_SCOPES),
    targetIds: z.array(z.string()).default([]),
    countMode: z.enum(REVIEW_COUNT_MODES).default("FIXED"),
    maleCount: z.number().int().min(0).max(110).optional(),
    femaleCount: z.number().int().min(0).max(110).optional(),
    minPerProduct: z.number().int().min(1).max(110).optional(),
    maxPerProduct: z.number().int().min(1).max(110).optional(),
    lengthMode: z.enum(LENGTH_MODES).default("FIXED"),
    length: z.enum(REVIEW_LENGTHS).default("MEDIUM"),
    lengthWeights: lengthWeightsSchema.optional(),
    ratingWeights: ratingWeightsSchema.optional(),
  })
  .refine(
    (value) => value.countMode !== "FIXED" || (value.maleCount ?? 0) + (value.femaleCount ?? 0) > 0,
    { message: "Request at least 1 review per product", path: ["maleCount"] },
  )
  .refine(
    (value) =>
      value.countMode !== "RANDOM" ||
      (value.minPerProduct !== undefined &&
        value.maxPerProduct !== undefined &&
        value.minPerProduct <= value.maxPerProduct),
    { message: "Min must be at least 1 and no greater than max", path: ["minPerProduct"] },
  )
  .refine((value) => value.scope === "STORE" || value.targetIds.length > 0, {
    message: "Select at least one target",
    path: ["targetIds"],
  })
  .refine(
    (value) =>
      value.lengthMode !== "MIXED" ||
      (value.lengthWeights &&
        value.lengthWeights.SHORT + value.lengthWeights.MEDIUM + value.lengthWeights.DETAILED > 0),
    { message: "At least one length weight must be greater than 0", path: ["lengthWeights"] },
  )
  .refine((value) => !value.ratingWeights || value.ratingWeights[5] + value.ratingWeights[4] > 0, {
    message: "At least one rating weight must be greater than 0",
    path: ["ratingWeights"],
  });
export type BulkGenerateReviewsInput = z.infer<typeof bulkGenerateReviewsSchema>;

export const updateReviewSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200).optional(),
  content: z.string().trim().min(1, "Content is required").optional(),
  rating: z.number().int().min(1).max(5).optional(),
  status: z.enum(["DRAFT", "APPROVED"]).optional(),
});
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;

export const bulkApproveReviewsSchema = z.object({
  ids: z.array(z.string()).min(1, "Select at least one review"),
});
export type BulkApproveReviewsInput = z.infer<typeof bulkApproveReviewsSchema>;

export const DUPLICATE_CHECK_SCOPES = ["ALL", "LIMIT"] as const;
export type DuplicateCheckScope = (typeof DUPLICATE_CHECK_SCOPES)[number];

/** EXACT: today's original behavior — hash/reviewer-id equality, auto-deletes immediately.
 * AI: uses the store's configured AI models to judge near-duplicate content (catches paraphrases
 * exact matching misses) — flags for review instead of auto-deleting, since an LLM's judgment is
 * less certain than exact matching. */
export const DUPLICATE_CHECK_MODES = ["EXACT", "AI"] as const;
export type DuplicateCheckMode = (typeof DUPLICATE_CHECK_MODES)[number];

export const checkDuplicateReviewsSchema = z
  .object({
    scope: z.enum(DUPLICATE_CHECK_SCOPES),
    limit: z.number().int().min(1).max(20000).optional(),
    checkMode: z.enum(DUPLICATE_CHECK_MODES).default("EXACT"),
  })
  .refine((value) => value.scope !== "LIMIT" || value.limit !== undefined, {
    message: "Enter how many recent reviews to check",
    path: ["limit"],
  });
export type CheckDuplicateReviewsInput = z.infer<typeof checkDuplicateReviewsSchema>;

export type DuplicateCheckJobPayload = {
  jobId: string;
  storeId: string;
  scope: DuplicateCheckScope;
  limit?: number;
  checkMode: DuplicateCheckMode;
};

export type UploadedScanJobPayload = {
  scanId: string;
  storeId: string;
  /** "scan" pages the provider and flags duplicates; "confirm" deletes what a completed scan
   * flagged. Both are queued rather than run in a request because each can take many minutes. */
  action?: "scan" | "confirm";
};
