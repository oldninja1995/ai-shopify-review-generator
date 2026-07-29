import { z } from "zod";
import { REVIEW_PROVIDERS } from "./review-provider";

export const selectProviderSchema = z.object({
  provider: z.enum(REVIEW_PROVIDERS),
  /** Judge.me publishes without auth but its read API needs a token, so this is only required to
   * scan already-uploaded reviews -- never to upload. Omitted on save keeps any stored token. */
  apiToken: z.string().trim().min(1).optional(),
});
export type SelectProviderInput = z.infer<typeof selectProviderSchema>;
