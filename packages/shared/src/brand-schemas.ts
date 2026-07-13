import { z } from "zod";

export const brandSettingsSchema = z.object({
  brandName: z.string().trim().min(2, "Brand name must be at least 2 characters").max(120),
  brandDescription: z.string().trim().min(10, "Add a bit more detail").max(1000),
  brandCategory: z.string().trim().min(2, "Brand category is required").max(80),
  brandPositioning: z.string().trim().min(10, "Add a bit more detail").max(1000),
  brandPersonality: z.string().trim().min(10, "Add a bit more detail").max(1000),
  brandVoice: z.string().trim().min(10, "Add a bit more detail").max(1000),
  targetAudience: z.string().trim().min(10, "Add a bit more detail").max(1000),
  usp: z.string().trim().max(300).optional(),
  country: z.string().trim().min(2, "Country is required").max(56),
  language: z.string().trim().min(2, "Language is required").max(56),
});
export type BrandSettingsInput = z.infer<typeof brandSettingsSchema>;
