import type { ReviewProvider, ReviewProviderName } from "@ai-shopify/shared";
import { judgeMeProvider } from "./judgeme.js";

/**
 * Only Judge.me has a real create-review API (confirmed via research — AG Product Reviews has no
 * public API, Loox's API is explicitly read-only). The other providers go through CSV export
 * instead of this registry; a `null` here means "not supported for auto-upload."
 */
export const reviewProviders: Record<ReviewProviderName, ReviewProvider | null> = {
  JUDGE_ME: judgeMeProvider,
  AG_PRODUCT_REVIEWS: null,
  LOOX: null,
  FERA: null,
  RYVIU: null,
};
