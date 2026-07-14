import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";

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
        code: "NOT_DISMISSIBLE",
      }),
      { status: 400 },
    );
  }

  await prisma.duplicateCheckJob.update({ where: { id: jobId }, data: { status: "DISMISSED" } });

  return NextResponse.json(apiSuccess({ dismissed: true }));
}
