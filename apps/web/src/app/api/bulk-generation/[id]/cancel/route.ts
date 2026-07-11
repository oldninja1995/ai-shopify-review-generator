import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { reviewGenerationQueue } from "@/lib/queue";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const { id } = await params;

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });
  if (!store) {
    return NextResponse.json(apiFailure("No Shopify store connected", { code: "NOT_CONNECTED" }), {
      status: 400,
    });
  }

  const bulkJob = await prisma.bulkGenerationJob.findFirst({
    where: { id, storeId: store.id },
  });
  if (!bulkJob) {
    return NextResponse.json(apiFailure("Bulk job not found", { code: "NOT_FOUND" }), { status: 404 });
  }
  if (bulkJob.status !== "PENDING" && bulkJob.status !== "RUNNING") {
    return NextResponse.json(
      apiFailure(`Job is already ${bulkJob.status.toLowerCase()}`, { code: "NOT_CANCELLABLE" }),
      { status: 400 },
    );
  }

  const queuedJobs = await reviewGenerationQueue.getJobs(["waiting", "delayed"]);
  const toRemove = queuedJobs.filter((job) => job.data.bulkJobId === id);
  await Promise.all(toRemove.map((job) => job.remove()));

  await prisma.bulkGenerationJob.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  return NextResponse.json(apiSuccess({ cancelledQueuedJobs: toRemove.length }));
}
