import {
  ProviderUploadError,
  type ReviewProvider,
  type ReviewProviderCredentials,
  type ReviewUploadPayload,
  type ReviewUploadResult,
} from "@ai-shopify/shared";

const JUDGE_ME_REVIEWS_ENDPOINT = "https://judge.me/api/v1/reviews";

/** Deterministic placeholder email — Judge.me requires one, but synthetic reviewers don't have it. */
function syntheticEmail(reviewerName: string): string {
  const slug = reviewerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return `${slug || "reviewer"}@generated.local`;
}

export const judgeMeProvider: ReviewProvider = {
  name: "JUDGE_ME",

  // Judge.me's create-review endpoint has no separate token to verify against (confirmed via
  // their own docs — only their read endpoints require an api_token), so there's nothing to
  // check here beyond the shop domain being present, which the caller already guarantees.
  async verifyCredentials(): Promise<boolean> {
    return true;
  },

  async uploadReview(
    credentials: ReviewProviderCredentials,
    payload: ReviewUploadPayload,
  ): Promise<ReviewUploadResult> {
    const shopDomain = credentials.shopDomain;
    if (!shopDomain) {
      throw new Error("Missing shopDomain for Judge.me upload");
    }

    const response = await fetch(JUDGE_ME_REVIEWS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shop_domain: shopDomain,
        platform: "shopify",
        id: payload.productExternalId,
        name: payload.reviewerName,
        email: syntheticEmail(payload.reviewerName),
        rating: payload.rating,
        title: payload.title,
        body: payload.content,
      }),
    });

    if (!response.ok) {
      // 429 (rate limited) and 5xx (Judge.me having a bad moment) are transient — worth retrying.
      // Anything else (bad request, auth, etc.) is a real problem that won't fix itself on retry.
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderUploadError(`Judge.me API error ${response.status}: ${await response.text()}`, {
        status: response.status,
        retryable,
      });
    }

    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const externalReviewId =
      typeof body?.id === "string" || typeof body?.id === "number"
        ? String(body.id)
        : typeof (body?.review as { id?: unknown } | undefined)?.id === "number"
          ? String((body?.review as { id: number }).id)
          : "unknown";

    return { externalReviewId };
  },
};
