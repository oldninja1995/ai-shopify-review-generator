import { z } from "zod";

const USP_MAX_LENGTH = 100;

/** The USP field is spliced verbatim into short templates like "this brand {usp}." (see
 * USP_CLOSERS in apps/worker/src/reviews/content-bank.ts) — it must read as a single short
 * phrase continuation, not a block of marketing copy. Multi-line bullet-style USPs (e.g. pasted
 * straight from a product listing) produced garbage reviews like "Not many brands Premium
 * Build: India's only 3-5 micron gold-layered jewellery.\n22K Gold Look: ..." when substituted
 * raw, so both the save-time validation and the generation-time usage need to reject this shape. */
export function isUsableUspPhrase(usp: string): boolean {
  return usp.length > 0 && usp.length <= USP_MAX_LENGTH && !/[\n\r]/.test(usp);
}

export const brandSettingsSchema = z.object({
  brandName: z.string().trim().min(2, "Brand name must be at least 2 characters").max(120),
  brandDescription: z.string().trim().min(10, "Add a bit more detail").max(1000),
  brandCategory: z.string().trim().min(2, "Brand category is required").max(80),
  brandPositioning: z.string().trim().min(10, "Add a bit more detail").max(1000),
  brandPersonality: z.string().trim().min(10, "Add a bit more detail").max(1000),
  brandVoice: z.string().trim().min(10, "Add a bit more detail").max(1000),
  targetAudience: z.string().trim().min(10, "Add a bit more detail").max(1000),
  usp: z
    .string()
    .trim()
    .max(USP_MAX_LENGTH, `Keep this to one short phrase (under ${USP_MAX_LENGTH} characters), not a paragraph`)
    .refine((v) => !/[\n\r]/.test(v), "No line breaks — phrase it as a single continuation of \"this brand ___\"")
    .optional(),
  country: z.string().trim().min(2, "Country is required").max(56),
  language: z.string().trim().min(2, "Language is required").max(56),
});
export type BrandSettingsInput = z.infer<typeof brandSettingsSchema>;
