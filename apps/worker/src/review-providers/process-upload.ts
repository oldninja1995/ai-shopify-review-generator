import { prisma } from "@ai-shopify/db";
import {
  decryptSecret,
  ProviderUploadError,
  type ReviewProviderCredentials,
  type ReviewUploadPayload,
} from "@ai-shopify/shared";
import { env } from "../env.js";
import { reviewProviders } from "./index.js";
import { logSystemEvent } from "../logging.js";

/** `isFinalAttempt` comes from BullMQ's own retry bookkeeping (job.attemptsMade vs job.opts.attempts)
 * — only permanently mark a review FAILED once retries are genuinely exhausted, not on the first
 * transient hiccup (e.g. a 429 from the provider), which BullMQ will retry with backoff on its own. */
export async function processUploadJob(uploadJobId: string, isFinalAttempt: boolean): Promise<void> {
  const uploadJob = await prisma.uploadJob.findUniqueOrThrow({
    where: { id: uploadJobId },
    include: {
      review: { include: { product: { include: { store: true } }, reviewerProfile: true } },
      providerConfig: true,
    },
  });

  // Guards the race where this job was already dequeued before a cancel request reached the
  // queue — same pattern as review-generation.worker.ts's bulk-job cancel check. Also guards
  // against actually re-posting to the provider if this uploadJobId ever ends up enqueued twice
  // (e.g. a double-submitted upload request) — without this, a second processing pass would post
  // the same review to the provider (e.g. Judge.me) a second time, visible to real customers.
  if (uploadJob.status === "CANCELLED" || uploadJob.status === "SUCCEEDED") return;

  await prisma.uploadJob.update({
    where: { id: uploadJobId },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
  });

  const provider = reviewProviders[uploadJob.providerConfig.provider];
  if (!provider) {
    await failUploadJob(
      uploadJobId,
      uploadJob.reviewId,
      "Provider does not support automatic upload",
      uploadJob.review.product.store.userId,
      uploadJob.review.product.title,
    );
    return;
  }

  try {
    const credentials: ReviewProviderCredentials = {
      ...JSON.parse(decryptSecret(uploadJob.providerConfig.credentialsEncrypted, env.ENCRYPTION_KEY)),
      shopDomain: uploadJob.review.product.store.shopDomain,
    };

    const payload: ReviewUploadPayload = {
      productExternalId: uploadJob.review.product.shopifyProductId,
      reviewerName: uploadJob.review.reviewerProfile.name,
      title: uploadJob.review.title,
      content: uploadJob.review.content,
      rating: uploadJob.review.rating,
      reviewDate: uploadJob.review.reviewDate.toISOString(),
      verifiedPurchase: uploadJob.review.reviewerProfile.isVerifiedPurchase,
    };

    await provider.uploadReview(credentials, payload);

    await prisma.$transaction([
      prisma.uploadJob.update({
        where: { id: uploadJobId },
        data: { status: "SUCCEEDED", uploadedAt: new Date(), lastError: null },
      }),
      prisma.generatedReview.update({
        where: { id: uploadJob.reviewId },
        data: { status: "UPLOADED" },
      }),
    ]);
    await logSystemEvent(
      "INFO",
      `Uploaded review for ${uploadJob.review.product.title} to ${uploadJob.providerConfig.provider}`,
      { userId: uploadJob.review.product.store.userId, metadata: { uploadJobId } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = error instanceof ProviderUploadError && error.retryable;

    if (retryable && !isFinalAttempt) {
      // Leave status as PROCESSING (not FAILED) — BullMQ will retry this job with backoff, and a
      // permanent-looking FAILED status here would be misleading for something about to self-heal.
      await prisma.uploadJob.update({ where: { id: uploadJobId }, data: { lastError: message } });
      await logSystemEvent(
        "INFO",
        `Upload for ${uploadJob.review.product.title} hit a transient error, will retry: ${message}`,
        { userId: uploadJob.review.product.store.userId, metadata: { uploadJobId } },
      );
    } else {
      await failUploadJob(
        uploadJobId,
        uploadJob.reviewId,
        message,
        uploadJob.review.product.store.userId,
        uploadJob.review.product.title,
      );
    }
    throw error;
  }
}

async function failUploadJob(
  uploadJobId: string,
  reviewId: string,
  message: string,
  userId: string,
  productTitle: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.uploadJob.update({
      where: { id: uploadJobId },
      data: { status: "FAILED", lastError: message },
    }),
    prisma.generatedReview.update({
      where: { id: reviewId },
      data: { status: "FAILED" },
    }),
  ]);
  await logSystemEvent("ERROR", `Upload failed for ${productTitle}: ${message}`, {
    userId,
    metadata: { uploadJobId },
  });
}
