import { prisma } from "@ai-shopify/db";
import {
  decryptSecret,
  type PublishedReview,
  type ReviewProviderCredentials,
  type UploadedScanJobPayload,
} from "@ai-shopify/shared";
import { reviewProviders } from "../review-providers/index.js";
import { env } from "../env.js";
import { logSystemEvent } from "../logging.js";

const PAGE_SIZE = 100;
/** Hard ceiling so a misbehaving provider (one that never reports the last page) can't page
 * forever. At 100 per page this covers 500k published reviews. */
const MAX_PAGES = 5_000;

function normaliseContent(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function normaliseName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

type Flag = {
  review: PublishedReview;
  reason: "CONTENT" | "REVIEWER";
  keptExternalId: string;
};

async function loadCredentials(storeId: string, provider: string): Promise<ReviewProviderCredentials> {
  const config = await prisma.reviewProviderConfig.findFirstOrThrow({
    where: { storeId, provider: provider as never },
    include: { store: true },
  });
  return {
    ...(JSON.parse(decryptSecret(config.credentialsEncrypted, env.ENCRYPTION_KEY)) as Record<string, string>),
    shopDomain: config.store.shopDomain,
  };
}

export async function runUploadedScanJob(payload: UploadedScanJobPayload): Promise<void> {
  const { scanId, storeId } = payload;

  // Only a freshly queued scan may start — mirrors runDuplicateCheckJob, so a BullMQ retry can't
  // resurrect a scan that was already cancelled or is awaiting confirmation.
  const existing = await prisma.uploadedReviewScan.findUniqueOrThrow({
    where: { id: scanId },
    select: { status: true, provider: true },
  });
  // PENDING is a fresh scan; RUNNING means a previous attempt died mid-flight — a worker restart or
  // a deploy — and BullMQ has re-delivered the job. Refusing RUNNING (as this did) left such a scan
  // stuck at RUNNING forever with no error and no way to recover, which is exactly what happened to
  // a scan frozen at 42,500 reviews across three worker deploys.
  //
  // Restarting from page 1 is correct rather than merely convenient: paging position isn't stored,
  // and duplicate detection needs the full set to be meaningful. Previously-written flags are
  // cleared first so a resumed scan can't double-report.
  if (existing.status !== "PENDING" && existing.status !== "RUNNING") return;
  if (existing.status === "RUNNING") {
    await prisma.uploadedReviewFlag.deleteMany({ where: { scanId } });
    await prisma.uploadedReviewScan.update({
      where: { id: scanId },
      data: { scannedCount: 0, flaggedCount: 0 },
    });
  }

  await prisma.uploadedReviewScan.update({ where: { id: scanId }, data: { status: "RUNNING" } });

  try {
    const provider = reviewProviders[existing.provider];
    if (!provider?.fetchReviews) {
      throw new Error(`${existing.provider} has no read API — uploaded reviews can't be scanned`);
    }
    const credentials = await loadCredentials(storeId, existing.provider);

    // Detection runs per page rather than over an accumulated array. Holding every published review
    // in memory would mean ~300,000 objects for this store, which is a real risk of exhausting the
    // worker container; only the normalised keys needed to spot a repeat are retained.
    //
    // Consequence worth knowing: the first copy *encountered* is kept, not the oldest. Judge.me
    // returns newest first, so of a duplicate pair the newer survives. Which copy survives matters
    // far less than the duplicate being removed, and the alternative needs the whole set in memory.
    const seenByProduct = new Map<string, { names: Map<string, string>; contents: Map<string, string> }>();
    const flags: Flag[] = [];
    let scanned = 0;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const current = await prisma.uploadedReviewScan.findUnique({
        where: { id: scanId },
        select: { status: true },
      });
      if (current?.status !== "RUNNING") return;

      const { reviews, hasMore } = await provider.fetchReviews(credentials, { page, perPage: PAGE_SIZE });
      scanned += reviews.length;

      for (const review of reviews) {
        if (!review.productExternalId) continue;
        let seen = seenByProduct.get(review.productExternalId);
        if (!seen) {
          seen = { names: new Map(), contents: new Map() };
          seenByProduct.set(review.productExternalId, seen);
        }

        const contentKey = normaliseContent(review.content);
        const nameKey = normaliseName(review.reviewerName);

        // Content first: an identical body is the more damaging duplicate, and reporting one reason
        // per review keeps the confirm list unambiguous.
        const contentMatch = contentKey ? seen.contents.get(contentKey) : undefined;
        if (contentMatch) {
          flags.push({ review, reason: "CONTENT", keptExternalId: contentMatch });
          continue;
        }
        const nameMatch = nameKey ? seen.names.get(nameKey) : undefined;
        if (nameMatch) {
          flags.push({ review, reason: "REVIEWER", keptExternalId: nameMatch });
          continue;
        }

        if (contentKey) seen.contents.set(contentKey, review.externalId);
        if (nameKey) seen.names.set(nameKey, review.externalId);
      }

      await prisma.uploadedReviewScan.update({
        where: { id: scanId },
        data: { scannedCount: scanned, totalCount: scanned, flaggedCount: flags.length },
      });
      if (!hasMore) break;
    }



    if (flags.length > 0) {
      await prisma.uploadedReviewFlag.createMany({
        data: flags.map((f) => ({
          scanId,
          externalReviewId: f.review.externalId,
          productExternalId: f.review.productExternalId,
          productTitle: f.review.productTitle,
          reviewerName: f.review.reviewerName,
          reason: f.reason,
          keptExternalId: f.keptExternalId,
          contentPreview: f.review.content.slice(0, 500),
          reviewCreatedAt: f.review.createdAt ? new Date(f.review.createdAt) : null,
        })),
      });
    }

    // Nothing is deleted here. These are live reviews on the storefront and removal is
    // irreversible, so the scan always stops for an explicit confirmation.
    await prisma.uploadedReviewScan.update({
      where: { id: scanId },
      data: {
        status: flags.length > 0 ? "AWAITING_CONFIRMATION" : "COMPLETED",
        flaggedCount: flags.length,
      },
    });

    const store = await prisma.shopifyStore.findUnique({ where: { id: storeId }, select: { userId: true } });
    await logSystemEvent(
      "INFO",
      `Scanned ${scanned} published reviews on ${existing.provider}: ${flags.length} duplicate${flags.length === 1 ? "" : "s"} flagged`,
      { userId: store?.userId, metadata: { scanId } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.uploadedReviewScan.update({
      where: { id: scanId },
      data: { status: "FAILED", errorMessage: message },
    });
    const store = await prisma.shopifyStore.findUnique({ where: { id: storeId }, select: { userId: true } });
    await logSystemEvent("ERROR", `Uploaded-review scan failed: ${message}`, {
      userId: store?.userId,
      metadata: { scanId },
    });
    throw error;
  }
}

/** Deletes the flagged reviews from the provider after the user has confirmed. Failures per review
 * are tolerated: one un-deletable review must not strand the rest of the batch. */
export async function confirmUploadedScanDeletion(scanId: string): Promise<void> {
  const scan = await prisma.uploadedReviewScan.findUniqueOrThrow({
    where: { id: scanId },
    include: { flags: true },
  });
  if (scan.status !== "AWAITING_CONFIRMATION") return;

  await prisma.uploadedReviewScan.update({ where: { id: scanId }, data: { status: "RUNNING" } });

  const provider = reviewProviders[scan.provider];
  const credentials = await loadCredentials(scan.storeId, scan.provider);
  let deleted = 0;

  for (const flag of scan.flags) {
    if (!provider?.deleteReview) break;
    try {
      await provider.deleteReview(credentials, flag.externalReviewId);
      deleted++;
      if (deleted % 25 === 0) {
        await prisma.uploadedReviewScan.update({ where: { id: scanId }, data: { deletedCount: deleted } });
      }
    } catch (error) {
      console.error(`[uploaded-scan] failed to delete ${flag.externalReviewId}:`, error);
    }
  }

  await prisma.uploadedReviewScan.update({
    where: { id: scanId },
    data: { status: "COMPLETED", deletedCount: deleted },
  });
}
