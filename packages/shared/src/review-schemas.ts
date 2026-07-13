import { z } from "zod";

export const REVIEW_LENGTHS = ["SHORT", "MEDIUM", "DETAILED"] as const;
export type ReviewLength = (typeof REVIEW_LENGTHS)[number];

export const generateReviewsSchema = z
  .object({
    productId: z.string().min(1, "productId is required"),
    maleCount: z.number().int().min(0).max(110),
    femaleCount: z.number().int().min(0).max(110),
    productType: z.string().trim().max(80).optional(),
    length: z.enum(REVIEW_LENGTHS).default("MEDIUM"),
  })
  .refine((value) => value.maleCount + value.femaleCount > 0, {
    message: "Request at least 1 review",
    path: ["maleCount"],
  })
  .refine((value) => value.maleCount + value.femaleCount <= 110, {
    message: "Request at most 110 reviews at a time",
    path: ["maleCount"],
  });
export type GenerateReviewsInput = z.infer<typeof generateReviewsSchema>;

export type ReviewGenerationJobPayload = {
  productId: string;
  maleCount: number;
  femaleCount: number;
  productType?: string;
  length: ReviewLength;
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
    length: z.enum(REVIEW_LENGTHS).default("MEDIUM"),
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
