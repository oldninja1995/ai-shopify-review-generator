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

  // A one-row-at-a-time loop here previously created UploadJob rows sequentially — at real-world
  // scale (100k+ eligible reviews) that reliably blew past the serverless function's execution
  // timeout partway through, leaving a pile of DB rows created but never actually enqueued into
  // BullMQ (the addBulk call, positioned after the loop, never ran). createMany is one query
  // instead of N.
  const reviewIds = eligibleReviews.map((r) => r.id);
  const batchStart = new Date();
  await prisma.uploadJob.createMany({
    data: reviewIds.map((reviewId) => ({ reviewId, providerConfigId: providerConfig.id })),
  });

  const createdJobs = await prisma.uploadJob.findMany({
    where: { reviewId: { in: reviewIds }, providerConfigId: providerConfig.id, createdAt: { gte: batchStart } },
    select: { id: true },
  });

  await prisma.generatedReview.updateMany({
    where: { id: { in: reviewIds } },
    data: { status: "QUEUED" },
  });

  const ENQUEUE_CHUNK_SIZE = 5000;
  for (let i = 0; i < createdJobs.length; i += ENQUEUE_CHUNK_SIZE) {
    const chunk = createdJobs.slice(i, i + ENQUEUE_CHUNK_SIZE);
    await reviewUploadQueue.addBulk(chunk.map((job) => ({ name: "upload", data: { uploadJobId: job.id } })));
  }

  return NextResponse.json(apiSuccess({ queued: createdJobs.length }));
}
