import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess, type UploadedScanJobPayload } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { uploadedScanQueue } from "@/lib/queue";

async function currentStore(userId: string) {
  return prisma.shopifyStore.findFirst({ where: { userId }, orderBy: { connectedAt: "desc" } });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), { status: 401 });
  }
  const store = await currentStore(user.id);
  if (!store) return NextResponse.json(apiSuccess({ scans: [] }));

  // Unlike the generation/duplicate-check panels, finished scans are deliberately kept: the result
  // *is* the deliverable here. Hiding them meant a scan that found no duplicates completed and
  // disappeared, leaving no way to see that it had run or what it scanned. Capped at 3 so it stays
  // a recent-results list rather than accumulating.
  const scans = await prisma.uploadedReviewScan
    .findMany({ where: { storeId: store.id }, orderBy: { createdAt: "desc" }, take: 3 })
    .catch(() => []);

  return NextResponse.json(
    apiSuccess({
      scans: scans.map((s) => ({
        id: s.id,
        provider: s.provider,
        status: s.status,
        scannedCount: s.scannedCount,
        flaggedCount: s.flaggedCount,
        deletedCount: s.deletedCount,
        errorMessage: s.errorMessage,
        updatedAt: s.updatedAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
      })),
    }),
  );
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), { status: 401 });
  }
  const store = await currentStore(user.id);
  if (!store) {
    return NextResponse.json(apiFailure("No Shopify store connected", { code: "NOT_CONNECTED" }), { status: 400 });
  }

  const config = await prisma.reviewProviderConfig.findFirst({
    where: { storeId: store.id, isActive: true },
  });
  if (!config) {
    return NextResponse.json(
      apiFailure("No active review provider configured", { code: "NO_PROVIDER" }),
      { status: 400 },
    );
  }

  // A scan whose row says RUNNING is not necessarily alive. BullMQ abandons a job that stalls more
  // than maxStalledCount times — which a couple of worker deploys during a long scan will cause — and
  // the row is then left RUNNING forever with no queue entry behind it. That state used to block
  // every future scan, since the button and this check both treat it as active.
  //
  // The worker touches updatedAt on every page, so a stale timestamp is a reliable death signal.
  // Anything quiet for longer than this is retired rather than trusted.
  const STALE_AFTER_MS = 10 * 60 * 1000;
  const active = await prisma.uploadedReviewScan
    .findFirst({
      where: { storeId: store.id, status: { in: ["PENDING", "RUNNING"] } },
    })
    .catch(() => null);

  if (active) {
    const quietFor = Date.now() - active.updatedAt.getTime();
    if (quietFor < STALE_AFTER_MS) {
      return NextResponse.json(apiFailure("A scan is already running", { code: "ALREADY_RUNNING" }), {
        status: 409,
      });
    }
    await prisma.uploadedReviewScan.update({
      where: { id: active.id },
      data: {
        status: "FAILED",
        errorMessage: `No progress for ${Math.round(quietFor / 60000)} minutes — the scan was interrupted (usually a worker restart) and dropped from the queue.`,
      },
    });
  }

  const scan = await prisma.uploadedReviewScan.create({
    data: { storeId: store.id, provider: config.provider, status: "PENDING" },
  });

  await uploadedScanQueue.add("scan", {
    scanId: scan.id,
    storeId: store.id,
    action: "scan",
  } satisfies UploadedScanJobPayload);

  return NextResponse.json(apiSuccess({ scanId: scan.id }));
}
