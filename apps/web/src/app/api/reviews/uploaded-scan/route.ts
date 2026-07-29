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

  // Terminal scans clear themselves from the panel, same rule as the other job panels — only work
  // that is live or still needs a decision stays listed.
  const scans = await prisma.uploadedReviewScan
    .findMany({
      where: { storeId: store.id, status: { in: ["PENDING", "RUNNING", "AWAITING_CONFIRMATION"] } },
      orderBy: { createdAt: "desc" },
      take: 5,
    })
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

  const active = await prisma.uploadedReviewScan
    .findFirst({
      where: { storeId: store.id, status: { in: ["PENDING", "RUNNING"] } },
    })
    .catch(() => null);
  if (active) {
    return NextResponse.json(apiFailure("A scan is already running", { code: "ALREADY_RUNNING" }), {
      status: 409,
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
