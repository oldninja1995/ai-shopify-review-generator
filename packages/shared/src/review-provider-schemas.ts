import { z } from "zod";
import { REVIEW_PROVIDERS } from "./review-provider";

export const selectProviderSchema = z.object({
  provider: z.enum(REVIEW_PROVIDERS),
  /** Judge.me publishes without auth but its read API needs a token, so this is only required to
   * scan already-uploaded reviews -- never to upload. Omitted on save keeps any stored token. */
  // An emptied field must mean "keep the stored token", not a validation failure — min(1) rejected
  // the empty string the input produces once it has been focused, which blocked the whole save.
  apiToken: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type SelectProviderInput = z.infer<typeof selectProviderSchema>;
