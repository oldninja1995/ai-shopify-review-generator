import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";

/** Receives duplicate findings from a CSV parsed in the browser.
 *
 * Detection deliberately runs client-side. A full Judge.me export for this store is ~45MB and
 * Vercel caps request bodies at 4.5MB, so uploading the file is not an option; parsing locally and
 * posting only the findings keeps the payload proportional to the number of duplicates rather than
 * the number of reviews. It also means a 300k-row file never touches the server.
 *
 * The results land in the same UploadedReviewScan/UploadedReviewFlag tables the API scan uses, so
 * the existing review-and-confirm UI and the Judge.me deletion path work unchanged — the CSV is
 * just a second way of discovering the same thing, and it has no 10,000-review API ceiling.
 */
const MAX_FLAGS_PER_REQUEST = 2_000;

type IncomingFlag = {
  externalReviewId: string;
  productExternalId: string;
  productTitle: string;
  reviewerName: string;
  reason: "CONTENT" | "REVIEWER";
  keptExternalId?: string;
  contentPreview: string;
  reviewCreatedAt?: string | null;
};

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), { status: 401 });
  }
  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });
  if (!store) {
    return NextResponse.json(apiFailure("No Shopify store connected", { code: "NOT_CONNECTED" }), { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: "start" | "flags" | "finish";
    scanId?: string;
    flags?: IncomingFlag[];
    scannedCount?: number;
  };

  if (body.action === "start") {
    const config = await prisma.reviewProviderConfig.findFirst({
      where: { storeId: store.id, isActive: true },
    });
    const scan = await prisma.uploadedReviewScan.create({
      data: { storeId: store.id, provider: config?.provider ?? "JUDGE_ME", status: "RUNNING" },
    });
    return NextResponse.json(apiSuccess({ scanId: scan.id }));
  }

  if (!body.scanId) {
    return NextResponse.json(apiFailure("Missing scanId", { code: "VALIDATION_ERROR" }), { status: 400 });
  }
  // Ownership is checked through the store relation so a scan id cannot be guessed into.
  const scan = await prisma.uploadedReviewScan.findFirst({
    where: { id: body.scanId, store: { userId: user.id } },
  });
  if (!scan) {
    return NextResponse.json(apiFailure("Scan not found", { code: "NOT_FOUND" }), { status: 404 });
  }

  if (body.action === "flags") {
    const flags = (body.flags ?? []).slice(0, MAX_FLAGS_PER_REQUEST);
    if (flags.length > 0) {
      await prisma.uploadedReviewFlag.createMany({
        data: flags.map((f) => ({
          scanId: scan.id,
          externalReviewId: f.externalReviewId,
          productExternalId: f.productExternalId,
          productTitle: f.productTitle.slice(0, 500),
          reviewerName: f.reviewerName.slice(0, 200),
          reason: f.reason,
          keptExternalId: f.keptExternalId ?? null,
          contentPreview: f.contentPreview.slice(0, 500),
          reviewCreatedAt: f.reviewCreatedAt ? new Date(f.reviewCreatedAt) : null,
        })),
      });
    }
    const total = await prisma.uploadedReviewFlag.count({ where: { scanId: scan.id } });
    await prisma.uploadedReviewScan.update({
      where: { id: scan.id },
      data: { flaggedCount: total, scannedCount: body.scannedCount ?? scan.scannedCount },
    });
    return NextResponse.json(apiSuccess({ stored: flags.length, total }));
  }

  if (body.action === "finish") {
    const total = await prisma.uploadedReviewFlag.count({ where: { scanId: scan.id } });
    await prisma.uploadedReviewScan.update({
      where: { id: scan.id },
      data: {
        // Same rule as the API scan: findings always stop for an explicit confirmation, because
        // deleting a published review cannot be undone.
        status: total > 0 ? "AWAITING_CONFIRMATION" : "COMPLETED",
        scannedCount: body.scannedCount ?? scan.scannedCount,
        totalCount: body.scannedCount ?? scan.totalCount,
        flaggedCount: total,
      },
    });
    return NextResponse.json(apiSuccess({ flaggedCount: total }));
  }

  return NextResponse.json(apiFailure("Unknown action", { code: "VALIDATION_ERROR" }), { status: 400 });
}
