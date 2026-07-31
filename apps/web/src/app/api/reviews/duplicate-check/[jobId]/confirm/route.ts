import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";

const DELETE_CHUNK_SIZE = 200;

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
  if (job.status !== "AWAITING_CONFIRMATION") {
    return NextResponse.json(
      apiFailure(`Job is not awaiting confirmation (current status: ${job.status})`, {
        code: "NOT_CONFIRMABLE",
      }),
      { status: 400 },
    );
  }

  const flags = await prisma.duplicateCheckFlag.findMany({ where: { jobId }, select: { reviewId: true } });
  const reviewIds = flags.map((f) => f.reviewId);

  for (let i = 0; i < reviewIds.length; i += DELETE_CHUNK_SIZE) {
    const chunk = reviewIds.slice(i, i + DELETE_CHUNK_SIZE);
    await prisma.generatedReview.deleteMany({ where: { id: { in: chunk } } });
    await prisma.duplicateCheckJob.update({
      where: { id: jobId },
      data: { deletedCount: { increment: chunk.length } },
    });
  }

  await prisma.duplicateCheckJob.update({ where: { id: jobId }, data: { status: "COMPLETED" } });

  // Feeds the dashboard's "Reviews cleared" stat, same as every other deletion path.
  if (reviewIds.length > 0) {
    await prisma.systemLog.create({
      data: {
        level: "INFO",
        userId: user.id,
        message: `Confirmed and deleted ${reviewIds.length} flagged duplicate review${reviewIds.length === 1 ? "" : "s"}`,
        metadata: { type: "reviews_deleted", count: reviewIds.length, status: "ALL" },
      },
    });
  }

  return NextResponse.json(apiSuccess({ deletedCount: reviewIds.length }));
}
