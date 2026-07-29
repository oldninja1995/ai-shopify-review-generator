import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import {
  apiFailure,
  apiSuccess,
  checkDuplicateReviewsSchema,
  type DuplicateCheckJobPayload,
} from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { duplicateCheckQueue } from "@/lib/queue";

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
    return NextResponse.json(apiSuccess({ jobs: [] }));
  }

  // Must match the hosting page's filter (dashboard/reviews/page.tsx): this is what the panel
  // polls every 2s, so a finished check left in here would reappear the moment it completed.
  const jobs = await prisma.duplicateCheckJob.findMany({
    where: { storeId: store.id, status: { in: ["PENDING", "RUNNING", "AWAITING_CONFIRMATION"] } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  return NextResponse.json(apiSuccess({ jobs }));
}

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
  const parsed = checkDuplicateReviewsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      apiFailure(parsed.error.issues[0]?.message ?? "Invalid input", { code: "VALIDATION_ERROR" }),
      { status: 400 },
    );
  }
  const { scope, limit, checkMode } = parsed.data;

  const job = await prisma.duplicateCheckJob.create({
    data: {
      storeId: store.id,
      scope,
      limitCount: scope === "LIMIT" ? limit : null,
      checkMode,
      status: "PENDING",
    },
  });

  await duplicateCheckQueue.add("check", {
    jobId: job.id,
    storeId: store.id,
    scope,
    limit,
    checkMode,
  } satisfies DuplicateCheckJobPayload);

  return NextResponse.json(apiSuccess({ jobId: job.id }));
}
