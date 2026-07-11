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

export const bulkGenerateReviewsSchema = z
  .object({
    scope: z.enum(BULK_GENERATION_SCOPES),
    targetIds: z.array(z.string()).default([]),
    maleCount: z.number().int().min(0).max(110),
    femaleCount: z.number().int().min(0).max(110),
    length: z.enum(REVIEW_LENGTHS).default("MEDIUM"),
  })
  .refine((value) => value.maleCount + value.femaleCount > 0, {
    message: "Request at least 1 review per product",
    path: ["maleCount"],
  })
  .refine((value) => value.scope === "STORE" || value.targetIds.length > 0, {
    message: "Select at least one target",
    path: ["targetIds"],
  });
export type BulkGenerateReviewsInput = z.infer<typeof bulkGenerateReviewsSchema>;
