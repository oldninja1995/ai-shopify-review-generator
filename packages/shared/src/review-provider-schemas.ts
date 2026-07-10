import { z } from "zod";
import { REVIEW_PROVIDERS } from "./review-provider";

export const selectProviderSchema = z.object({
  provider: z.enum(REVIEW_PROVIDERS),
});
export type SelectProviderInput = z.infer<typeof selectProviderSchema>;
