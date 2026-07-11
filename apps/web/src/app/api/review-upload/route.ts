import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess, isAutoUploadProvider } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { reviewUploadQueue } from "@/lib/queue";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });
  if (!store) {
    return NextResponse.json(apiFailure("No Shopify store connected", { code: "NOT_CONNECTED" }), {
      status: 400,
    });
  }

  const providerConfig = await prisma.reviewProviderConfig.findFirst({
    where: { storeId: store.id, isActive: true },
  });
  if (!providerConfig) {
    return NextResponse.json(
      apiFailure("No review provider selected", { code: "NO_PROVIDER" }),
      { status: 400 },
    );
  }
  if (!isAutoUploadProvider(providerConfig.provider)) {
    return NextResponse.json(
      apiFailure(`${providerConfig.provider} does not support automatic upload — use CSV export instead`, {
        code: "MANUAL_PROVIDER",
      }),
      { status: 400 },
    );
  }

  const eligibleReviews = await prisma.generatedReview.findMany({
    where: { status: { in: ["DRAFT", "APPROVED"] }, product: { storeId: store.id } },
    select: { id: true },
  });
  if (eligibleReviews.length === 0) {
    return NextResponse.json(apiSuccess({ queued: 0 }));
  }

  const uploadJobIds: string[] = [];
  for (const review of eligibleReviews) {
    const uploadJob = await prisma.uploadJob.create({
      data: { reviewId: review.id, providerConfigId: providerConfig.id },
    });
    uploadJobIds.push(uploadJob.id);
  }
  await prisma.generatedReview.updateMany({
    where: { id: { in: eligibleReviews.map((r) => r.id) } },
    data: { status: "QUEUED" },
  });
  await reviewUploadQueue.addBulk(
    uploadJobIds.map((uploadJobId) => ({ name: "upload", data: { uploadJobId } })),
  );

  return NextResponse.json(apiSuccess({ queued: uploadJobIds.length }));
}
