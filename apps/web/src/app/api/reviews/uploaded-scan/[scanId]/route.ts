import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess, type UploadedScanJobPayload } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { uploadedScanQueue } from "@/lib/queue";

/** Every flagged review, so the list can be reviewed before anything is deleted. */
export async function GET(_request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), { status: 401 });
  }
  const { scanId } = await params;

  // Scoped through the store relation so one user can't read another's scan by guessing an id.
  const scan = await prisma.uploadedReviewScan.findFirst({
    where: { id: scanId, store: { userId: user.id } },
    include: { flags: { orderBy: { productTitle: "asc" }, take: 500 } },
  });
  if (!scan) {
    return NextResponse.json(apiFailure("Scan not found", { code: "NOT_FOUND" }), { status: 404 });
  }

  return NextResponse.json(
    apiSuccess({
      status: scan.status,
      flaggedCount: scan.flaggedCount,
      scannedCount: scan.scannedCount,
      flags: scan.flags.map((f) => ({
        id: f.id,
        externalReviewId: f.externalReviewId,
        productTitle: f.productTitle,
        reviewerName: f.reviewerName,
        reason: f.reason,
        contentPreview: f.contentPreview,
        reviewCreatedAt: f.reviewCreatedAt?.toISOString() ?? null,
      })),
    }),
  );
}

/** Confirm (delete the flagged reviews) or dismiss (keep everything). */
export async function POST(request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), { status: 401 });
  }
  const { scanId } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: string };

  const scan = await prisma.uploadedReviewScan.findFirst({
    where: { id: scanId, store: { userId: user.id } },
  });
  if (!scan) {
    return NextResponse.json(apiFailure("Scan not found", { code: "NOT_FOUND" }), { status: 404 });
  }

  if (body.action === "dismiss") {
    await prisma.uploadedReviewScan.updateMany({
      where: { id: scanId, status: "AWAITING_CONFIRMATION" },
      data: { status: "DISMISSED" },
    });
    return NextResponse.json(apiSuccess({ dismissed: true }));
  }

  if (body.action === "cancel") {
    // Cooperative: a scan already picked up by the worker checks this status between pages.
    await prisma.uploadedReviewScan.updateMany({
      where: { id: scanId, status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "CANCELLED" },
    });
    return NextResponse.json(apiSuccess({ cancelled: true }));
  }

  if (body.action !== "confirm") {
    return NextResponse.json(apiFailure("Unknown action", { code: "VALIDATION_ERROR" }), { status: 400 });
  }
  if (scan.status !== "AWAITING_CONFIRMATION") {
    return NextResponse.json(
      apiFailure("This scan isn't awaiting confirmation", { code: "WRONG_STATE" }),
      { status: 409 },
    );
  }

  // Queued rather than done inline: deleting thousands of reviews one API call at a time is far
  // longer than a request should live.
  await uploadedScanQueue.add("confirm", {
    scanId,
    storeId: scan.storeId,
    action: "confirm",
  } satisfies UploadedScanJobPayload);

  return NextResponse.json(apiSuccess({ queued: true }));
}
