import { prisma } from "@ai-shopify/db";
import { decryptSecret, type ReviewProviderCredentials, type ReviewUploadPayload } from "@ai-shopify/shared";
import { env } from "../env.js";
import { reviewProviders } from "./index.js";

export async function processUploadJob(uploadJobId: string): Promise<void> {
  const uploadJob = await prisma.uploadJob.findUniqueOrThrow({
    where: { id: uploadJobId },
    include: {
      review: { include: { product: { include: { store: true } }, reviewerProfile: true } },
      providerConfig: true,
    },
  });

  await prisma.uploadJob.update({
    where: { id: uploadJobId },
    data: { status: "PROCESSING", attempts: { increment: 1 } },
  });

  const provider = reviewProviders[uploadJob.providerConfig.provider];
  if (!provider) {
    await failUploadJob(uploadJobId, uploadJob.reviewId, "Provider does not support automatic upload");
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failUploadJob(uploadJobId, uploadJob.reviewId, message);
    throw error;
  }
}

async function failUploadJob(uploadJobId: string, reviewId: string, message: string): Promise<void> {
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
}
