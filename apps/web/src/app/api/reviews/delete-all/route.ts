import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveReviewStatusFilter } from "@/lib/review-status-filter";

export async function POST(request: Request) {
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

  const body = await request.json().catch(() => null);
  const status = typeof body?.status === "string" ? body.status : undefined;

  const result = await prisma.generatedReview.deleteMany({
    where: { product: { storeId: store.id }, ...resolveReviewStatusFilter(status) },
  });

  // Feeds the dashboard's "Reviews cleared" stat — the deleted rows themselves are gone, so this is
  // the only record that a deletion of this size happened at all.
  if (result.count > 0) {
    await prisma.systemLog.create({
      data: {
        level: "INFO",
        userId: user.id,
        message: `Deleted ${result.count} review${result.count === 1 ? "" : "s"}`,
        metadata: { type: "reviews_deleted", count: result.count, status: status ?? null },
      },
    });
  }

  return NextResponse.json(apiSuccess({ deletedCount: result.count }));
}
