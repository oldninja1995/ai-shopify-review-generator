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

/** One review as it currently exists on the provider, which is the only view of what a shopper
 * actually sees — the local GeneratedReview row is typically deleted once uploaded. */
export type PublishedReview = {
  externalId: string;
  productExternalId: string;
  productTitle: string;
  reviewerName: string;
  title: string;
  content: string;
  rating: number;
  createdAt?: string;
};

export type PublishedReviewPage = {
  reviews: PublishedReview[];
  /** False once the provider has no further pages. */
  hasMore: boolean;
};

export interface ReviewProvider {
  readonly name: ReviewProviderName;
  verifyCredentials(credentials: ReviewProviderCredentials): Promise<boolean>;
  uploadReview(
    credentials: ReviewProviderCredentials,
    payload: ReviewUploadPayload,
  ): Promise<ReviewUploadResult>;
  /** Optional: not every provider exposes a read API, and the ones that do generally need a
   * separate token from the one used to publish. Absent means "this provider can't be scanned". */
  fetchReviews?(
    credentials: ReviewProviderCredentials,
    options: { page: number; perPage: number },
  ): Promise<PublishedReviewPage>;
  /** Optional: removing a published review. Absent means duplicates can only be reported. */
  deleteReview?(credentials: ReviewProviderCredentials, externalReviewId: string): Promise<void>;
}

/** Thrown by a provider plugin's `uploadReview` so callers can tell a transient failure (rate
 * limited, provider having a bad moment) from a permanent one (bad credentials, malformed
 * request) — a 429 should be retried, not immediately surfaced to the user as a dead review. */
export class ProviderUploadError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable: boolean }) {
    super(message);
    this.name = "ProviderUploadError";
    this.status = options.status;
    this.retryable = options.retryable;
  }
}

/**
 * Providers with a real create-review API (currently just Judge.me — confirmed via research
 * that AG Product Reviews has no public API and Loox's is read-only). The rest are manual:
 * exported as CSV instead of queued for upload. Kept here (not just in the worker's provider
 * registry) so the web app can make upload/export UI decisions without importing worker code.
 */
export const AUTO_UPLOAD_PROVIDERS: readonly ReviewProviderName[] = ["JUDGE_ME"];

export function isAutoUploadProvider(provider: ReviewProviderName): boolean {
  return AUTO_UPLOAD_PROVIDERS.includes(provider);
}
