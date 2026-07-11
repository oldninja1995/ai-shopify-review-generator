import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { reviewUploadQueue } from "@/lib/queue";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const { id } = await params;

  const uploadJob = await prisma.uploadJob.findFirst({
    where: { id, review: { product: { store: { userId: user.id } } } },
  });
  if (!uploadJob) {
    return NextResponse.json(apiFailure("Upload job not found", { code: "NOT_FOUND" }), { status: 404 });
  }
  if (uploadJob.status !== "FAILED") {
    return NextResponse.json(
      apiFailure(`Only failed jobs can be retried (current status: ${uploadJob.status})`, {
        code: "NOT_RETRYABLE",
      }),
      { status: 400 },
    );
  }

  await prisma.uploadJob.update({
    where: { id },
    data: { status: "PENDING", lastError: null },
  });
  await prisma.generatedReview.update({
    where: { id: uploadJob.reviewId },
    data: { status: "QUEUED" },
  });
  await reviewUploadQueue.add("upload", { uploadJobId: id });

  return NextResponse.json(apiSuccess({ retried: true }));
}
