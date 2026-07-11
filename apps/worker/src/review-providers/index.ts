import type { ReviewProvider, ReviewProviderName } from "@ai-shopify/shared";
import { judgeMeProvider } from "./judgeme.js";

/**
 * See AUTO_UPLOAD_PROVIDERS in packages/shared/src/review-provider.ts for why only Judge.me is
 * here. The other providers go through CSV export instead of this registry; a `null` here means
 * "not supported for auto-upload."
 */
export const reviewProviders: Record<ReviewProviderName, ReviewProvider | null> = {
  JUDGE_ME: judgeMeProvider,
  AG_PRODUCT_REVIEWS: null,
  LOOX: null,
  FERA: null,
  RYVIU: null,
};
