/**
 * Contract every review-provider plugin (AG Product Reviews, Judge.me, Loox,
 * Fera, Ryviu, ...) must implement. The active provider is resolved at
 * runtime from `ReviewProviderConfig.provider`, so the rest of the app never
 * branches on which provider is in use.
 */

export const REVIEW_PROVIDERS = [
  "AG_PRODUCT_REVIEWS",
  "JUDGE_ME",
  "LOOX",
  "FERA",
  "RYVIU",
] as const;

export type ReviewProviderName = (typeof REVIEW_PROVIDERS)[number];

export type ReviewProviderCredentials = Record<string, string>;

export type ReviewUploadPayload = {
  productExternalId: string;
  reviewerName: string;
  title: string;
  content: string;
  rating: number;
  reviewDate: string;
  verifiedPurchase: boolean;
  images?: string[];
};

export type ReviewUploadResult = {
  externalReviewId: string;
};

export interface ReviewProvider {
  readonly name: ReviewProviderName;
  verifyCredentials(credentials: ReviewProviderCredentials): Promise<boolean>;
  uploadReview(
    credentials: ReviewProviderCredentials,
    payload: ReviewUploadPayload,
  ): Promise<ReviewUploadResult>;
}
