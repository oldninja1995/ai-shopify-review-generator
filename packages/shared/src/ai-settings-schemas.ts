import { z } from "zod";

export const aiSettingsSchema = z.object({
  apiKey: z.string().trim().min(1).optional(),
  models: z.array(z.string().trim().min(1)).min(1, "Select at least one model"),
  enabled: z.boolean(),
  visionAudienceEnabled: z.boolean().optional().default(false),
});
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;

export type OpenRouterModelOption = {
  id: string;
  name: string;
  isFree: boolean;
};
