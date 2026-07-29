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

/** Applies the store's rule — no repeated reviewer name and no repeated content under the same
 * product — to the reviews as they actually exist on the provider.
 *
 * Scoped per product deliberately: a name appearing on many *different* products is a separate
 * concern (and unavoidable historically), whereas the same name twice on one product is what a
 * shopper sees on a single page. The earliest review of each set is kept. */
function findDuplicates(reviews: PublishedReview[]): Flag[] {
  const byProduct = new Map<string, PublishedReview[]>();
  for (const review of reviews) {
    if (!review.productExternalId) continue;
    const list = byProduct.get(review.productExternalId) ?? [];
    list.push(review);
    byProduct.set(review.productExternalId, list);
  }

  const flags: Flag[] = [];
  for (const group of byProduct.values()) {
    // Oldest first, so the review that is kept is the one that has been live longest.
    const ordered = [...group].sort((a, b) => {
      const at = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
      return at - bt;
    });

    const seenName = new Map<string, string>();
    const seenContent = new Map<string, string>();

    for (const review of ordered) {
      const nameKey = normaliseName(review.reviewerName);
      const contentKey = normaliseContent(review.content);

      // Content is checked first: an identical review body is the more damaging duplicate, and
      // reporting one reason per review keeps the confirm list unambiguous.
      const contentMatch = contentKey ? seenContent.get(contentKey) : undefined;
      if (contentMatch) {
        flags.push({ review, reason: "CONTENT", keptExternalId: contentMatch });
        continue;
      }
      const nameMatch = nameKey ? seenName.get(nameKey) : undefined;
      if (nameMatch) {
        flags.push({ review, reason: "REVIEWER", keptExternalId: nameMatch });
        continue;
      }

      if (contentKey) seenContent.set(contentKey, review.externalId);
      if (nameKey) seenName.set(nameKey, review.externalId);
    }
  }
  return flags;
}

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
  if (existing.status !== "PENDING") return;

  await prisma.uploadedReviewScan.update({ where: { id: scanId }, data: { status: "RUNNING" } });

  try {
    const provider = reviewProviders[existing.provider];
    if (!provider?.fetchReviews) {
      throw new Error(`${existing.provider} has no read API — uploaded reviews can't be scanned`);
    }
    const credentials = await loadCredentials(storeId, existing.provider);

    const all: PublishedReview[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const current = await prisma.uploadedReviewScan.findUnique({
        where: { id: scanId },
        select: { status: true },
      });
      if (current?.status !== "RUNNING") return;

      const { reviews, hasMore } = await provider.fetchReviews(credentials, { page, perPage: PAGE_SIZE });
      all.push(...reviews);
      await prisma.uploadedReviewScan.update({
        where: { id: scanId },
        data: { scannedCount: all.length, totalCount: all.length },
      });
      if (!hasMore) break;
    }

    const flags = findDuplicates(all);

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
      `Scanned ${all.length} published reviews on ${existing.provider}: ${flags.length} duplicate${flags.length === 1 ? "" : "s"} flagged`,
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
