-- Duplicate detection over reviews already published on the review provider. The existing
-- duplicate_check_jobs only see generated_reviews, which are removed once uploaded — so nothing
-- could inspect what actually sits on the storefront.
CREATE TYPE "UploadedScanStatus" AS ENUM ('PENDING', 'RUNNING', 'AWAITING_CONFIRMATION', 'COMPLETED', 'DISMISSED', 'FAILED', 'CANCELLED');

CREATE TABLE "uploaded_review_scans" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "provider" "ReviewProviderName" NOT NULL,
    "status" "UploadedScanStatus" NOT NULL DEFAULT 'PENDING',
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "flaggedCount" INTEGER NOT NULL DEFAULT 0,
    "deletedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploaded_review_scans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "uploaded_review_flags" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "externalReviewId" TEXT NOT NULL,
    "productExternalId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "reason" "DuplicateFlagReason" NOT NULL,
    "keptExternalId" TEXT,
    "contentPreview" TEXT NOT NULL,
    "reviewCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploaded_review_flags_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "uploaded_review_scans_storeId_idx" ON "uploaded_review_scans"("storeId");
CREATE INDEX "uploaded_review_flags_scanId_idx" ON "uploaded_review_flags"("scanId");

ALTER TABLE "uploaded_review_scans"
    ADD CONSTRAINT "uploaded_review_scans_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "shopify_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "uploaded_review_flags"
    ADD CONSTRAINT "uploaded_review_flags_scanId_fkey"
    FOREIGN KEY ("scanId") REFERENCES "uploaded_review_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
