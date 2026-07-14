import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";

const PAGE_SIZE = 50;

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
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

  const page = Math.max(1, Number(new URL(request.url).searchParams.get("page")) || 1);

  const [totalCount, flags] = await Promise.all([
    prisma.duplicateCheckFlag.count({ where: { jobId } }),
    prisma.duplicateCheckFlag.findMany({
      where: { jobId },
      include: { review: { include: { product: true, reviewerProfile: true } } },
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  return NextResponse.json(
    apiSuccess({
      job: { id: job.id, status: job.status, totalToDelete: job.totalToDelete },
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
      page,
      flags: flags.map((flag) => ({
        id: flag.id,
        reason: flag.reason,
        productTitle: flag.review.product.title,
        reviewerName: flag.review.reviewerProfile.name,
        title: flag.review.title,
        content: flag.review.content,
        rating: flag.review.rating,
      })),
    }),
  );
}
