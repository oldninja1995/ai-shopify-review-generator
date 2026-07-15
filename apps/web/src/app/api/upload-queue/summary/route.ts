import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";

const RECENT_WINDOW_MS = 5 * 60 * 1000;

/** Lightweight status-only endpoint for UploadQueueProgress's poll loop — returns just the
 * aggregate counts the panel needs, not the full paginated job table the page itself renders. */
export async function GET() {
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
    return NextResponse.json(
      apiSuccess({
        summary: {
          total: 0,
          succeeded: 0,
          failed: 0,
          pending: 0,
          processing: 0,
          recentSucceededCount: 0,
          recentWindowMs: RECENT_WINDOW_MS,
        },
      }),
    );
  }

  const where = { review: { product: { storeId: store.id } } };

  const [totalCount, statusCounts, recentSucceededCount] = await Promise.all([
    prisma.uploadJob.count({ where }),
    prisma.uploadJob.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.uploadJob.count({
      where: { ...where, status: "SUCCEEDED", uploadedAt: { gte: new Date(Date.now() - RECENT_WINDOW_MS) } },
    }),
  ]);

  const countByStatus = Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all]));

  return NextResponse.json(
    apiSuccess({
      summary: {
        total: totalCount,
        succeeded: countByStatus.SUCCEEDED ?? 0,
        failed: countByStatus.FAILED ?? 0,
        pending: countByStatus.PENDING ?? 0,
        processing: countByStatus.PROCESSING ?? 0,
        recentSucceededCount,
        recentWindowMs: RECENT_WINDOW_MS,
      },
    }),
  );
}
