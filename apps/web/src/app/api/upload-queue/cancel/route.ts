import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { reviewUploadQueue } from "@/lib/queue";

const CHUNK_SIZE = 5000;

/** Cancels every PENDING UploadJob for the store — there's no "batch" entity for uploads (unlike
 * BulkGenerationJob), so this cancels everything currently queued and not yet picked up, matching
 * the scope of the aggregate progress bar it's triggered from. */
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

  const pendingJobs = await prisma.uploadJob.findMany({
    where: { status: "PENDING", review: { product: { storeId: store.id } } },
    select: { id: true, reviewId: true },
  });
  if (pendingJobs.length === 0) {
    return NextResponse.json(apiSuccess({ cancelled: 0 }));
  }

  const pendingJobIds = new Set(pendingJobs.map((j) => j.id));
  const queuedJobs = await reviewUploadQueue.getJobs(["waiting", "delayed"]);
  const toRemove = queuedJobs.filter((job) => pendingJobIds.has(job.data.uploadJobId));
  await Promise.all(toRemove.map((job) => job.remove()));

  for (let i = 0; i < pendingJobs.length; i += CHUNK_SIZE) {
    const chunk = pendingJobs.slice(i, i + CHUNK_SIZE);
    await prisma.uploadJob.updateMany({
      where: { id: { in: chunk.map((j) => j.id) } },
      data: { status: "CANCELLED" },
    });
    // Revert to DRAFT so these reviews are eligible to be queued again later, rather than stuck
    // showing QUEUED forever with no job actually working on them.
    await prisma.generatedReview.updateMany({
      where: { id: { in: chunk.map((j) => j.reviewId) }, status: "QUEUED" },
      data: { status: "DRAFT" },
    });
  }

  return NextResponse.json(apiSuccess({ cancelled: pendingJobs.length }));
}
