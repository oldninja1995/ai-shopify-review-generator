import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { duplicateCheckQueue } from "@/lib/queue";

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const { jobId } = await params;
  const job = await prisma.duplicateCheckJob.findFirst({
    where: { id: jobId, store: { userId: user.id } },
  });
  if (!job) {
    return NextResponse.json(apiFailure("Duplicate check job not found", { code: "NOT_FOUND" }), {
      status: 404,
    });
  }
  if (job.status !== "PENDING" && job.status !== "RUNNING") {
    return NextResponse.json(
      apiFailure(`Job is already ${job.status.toLowerCase()}`, { code: "NOT_CANCELLABLE" }),
      { status: 400 },
    );
  }

  const queuedJobs = await duplicateCheckQueue.getJobs(["waiting", "delayed", "active"]);
  const toRemove = queuedJobs.filter((queued) => queued.data.jobId === jobId);
  // An active job is locked by the worker currently processing it and can't be force-removed from
  // here — that's expected, not an error. The worker checks job.status cooperatively between
  // batches (see runAiCheck) and stops on its own once it sees this update.
  await Promise.all(toRemove.map((queued) => queued.remove().catch(() => {})));

  await prisma.duplicateCheckJob.update({
    where: { id: jobId },
    data: { status: "FAILED", errorMessage: "Cancelled by user" },
  });

  return NextResponse.json(apiSuccess({ cancelled: true }));
}
