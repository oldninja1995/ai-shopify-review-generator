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

  // Postgres caps a single prepared statement at 32767 bind variables — both the createMany
  // (one placeholder set per row) and a later `reviewId: { in: reviewIds }` lookup can blow past
  // that once a store has 30k+ eligible reviews in one go, so every step here is chunked.
  const CHUNK_SIZE = 3000;
  for (let i = 0; i < reviewIds.length; i += CHUNK_SIZE) {
    const chunk = reviewIds.slice(i, i + CHUNK_SIZE);
    await prisma.uploadJob.createMany({
      data: chunk.map((reviewId) => ({ reviewId, providerConfigId: providerConfig.id })),
    });
  }

  // Identified by providerConfigId + createdAt window instead of `reviewId: { in: reviewIds } }`
  // — the latter re-introduces the same bind-variable ceiling this function is chunking around.
  const createdJobs = await prisma.uploadJob.findMany({
    where: { providerConfigId: providerConfig.id, createdAt: { gte: batchStart } },
    select: { id: true },
  });

  for (let i = 0; i < reviewIds.length; i += CHUNK_SIZE) {
    const chunk = reviewIds.slice(i, i + CHUNK_SIZE);
    await prisma.generatedReview.updateMany({
      where: { id: { in: chunk } },
      data: { status: "QUEUED" },
    });
  }

  for (let i = 0; i < createdJobs.length; i += CHUNK_SIZE) {
    const chunk = createdJobs.slice(i, i + CHUNK_SIZE);
    await reviewUploadQueue.addBulk(chunk.map((job) => ({ name: "upload", data: { uploadJobId: job.id } })));
  }

  return NextResponse.json(apiSuccess({ queued: createdJobs.length }));
}
