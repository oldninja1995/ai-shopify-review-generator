import { z } from "zod";

export const REVIEW_LENGTHS = ["SHORT", "MEDIUM", "DETAILED"] as const;
export type ReviewLength = (typeof REVIEW_LENGTHS)[number];

export const LENGTH_MODES = ["FIXED", "MIXED"] as const;
export type LengthMode = (typeof LENGTH_MODES)[number];

/** Relative weights (need not sum to 100 — normalized at pick time), one per length tier. */
export type LengthWeights = Record<ReviewLength, number>;

export const DEFAULT_LENGTH_WEIGHTS: LengthWeights = { SHORT: 30, MEDIUM: 50, DETAILED: 20 };

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

export const RATING_MODES = ["DEFAULT", "MIXED"] as const;
export type RatingMode = (typeof RATING_MODES)[number];

export const RATING_SENTIMENTS = ["POSITIVE", "NEUTRAL", "NEGATIVE"] as const;
export type RatingSentiment = (typeof RATING_SENTIMENTS)[number];

/** Relative weights (need not sum to 100 — normalized at pick time), one per sentiment bucket. */
export type RatingWeights = Record<RatingSentiment, number>;

/** Matches this app's original hardcoded distribution (55% 5-star, 25% 4-star, 12% 3-star, 5%
 * 2-star, 3% 1-star) collapsed into sentiment buckets, so DEFAULT mode is unchanged behavior. */
export const DEFAULT_RATING_WEIGHTS: RatingWeights = { POSITIVE: 80, NEUTRAL: 12, NEGATIVE: 8 };

const ratingWeightsSchema = z.object({
  POSITIVE: z.number().min(0),
  NEUTRAL: z.number().min(0),
  NEGATIVE: z.number().min(0),
});

/** Picks a star rating from a weighted sentiment mix. Within POSITIVE, splits 5-vs-4 star at the
 * same ~69/31 ratio as the original hardcoded distribution (55/(55+25)); within NEGATIVE, splits
 * 2-vs-1 star at ~62/38 (5/(5+3)). NEUTRAL is always 3 stars. Falls back to a POSITIVE 5-star
 * review if all weights are 0. */
export function pickWeightedRating(weights: RatingWeights): number {
  const total = RATING_SENTIMENTS.reduce((sum, tier) => sum + Math.max(0, weights[tier] ?? 0), 0);
  let sentiment: RatingSentiment = "POSITIVE";
  if (total > 0) {
    let roll = Math.random() * total;
    for (const tier of RATING_SENTIMENTS) {
      const weight = Math.max(0, weights[tier] ?? 0);
      if (roll < weight) {
        sentiment = tier;
        break;
      }
      roll -= weight;
    }
  }
  if (sentiment === "NEUTRAL") return 3;
  if (sentiment === "POSITIVE") return Math.random() < 0.6875 ? 5 : 4;
  return Math.random() < 0.625 ? 2 : 1;
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
    ratingMode: z.enum(RATING_MODES).default("DEFAULT"),
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
  .refine(
    (value) =>
      value.ratingMode !== "MIXED" ||
      (value.ratingWeights &&
        value.ratingWeights.POSITIVE + value.ratingWeights.NEUTRAL + value.ratingWeights.NEGATIVE > 0),
    { message: "At least one rating weight must be greater than 0", path: ["ratingWeights"] },
  );
export type GenerateReviewsInput = z.infer<typeof generateReviewsSchema>;

export type ReviewGenerationJobPayload = {
  productId: string;
  maleCount: number;
  femaleCount: number;
  productType?: string;
  lengthMode: LengthMode;
  length: ReviewLength;
  lengthWeights?: LengthWeights;
  ratingMode: RatingMode;
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
    ratingMode: z.enum(RATING_MODES).default("DEFAULT"),
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
  .refine(
    (value) =>
      value.ratingMode !== "MIXED" ||
      (value.ratingWeights &&
        value.ratingWeights.POSITIVE + value.ratingWeights.NEUTRAL + value.ratingWeights.NEGATIVE > 0),
    { message: "At least one rating weight must be greater than 0", path: ["ratingWeights"] },
  );
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

export const checkDuplicateReviewsSchema = z
  .object({
    scope: z.enum(DUPLICATE_CHECK_SCOPES),
    limit: z.number().int().min(1).max(20000).optional(),
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
};
