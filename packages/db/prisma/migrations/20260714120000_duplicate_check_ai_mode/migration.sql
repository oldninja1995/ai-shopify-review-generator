-- AlterEnum
ALTER TYPE "DuplicateCheckStatus" ADD VALUE 'AWAITING_CONFIRMATION';
ALTER TYPE "DuplicateCheckStatus" ADD VALUE 'DISMISSED';

-- CreateEnum
CREATE TYPE "DuplicateCheckMode" AS ENUM ('EXACT', 'AI');

-- CreateEnum
CREATE TYPE "DuplicateFlagReason" AS ENUM ('CONTENT', 'REVIEWER');

-- AlterTable
ALTER TABLE "duplicate_check_jobs" ADD COLUMN "checkMode" "DuplicateCheckMode" NOT NULL DEFAULT 'EXACT';

-- CreateTable
CREATE TABLE "duplicate_check_flags" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "reason" "DuplicateFlagReason" NOT NULL,
    "matchedReviewId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_check_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "duplicate_check_flags_jobId_idx" ON "duplicate_check_flags"("jobId");

-- AddForeignKey
ALTER TABLE "duplicate_check_flags" ADD CONSTRAINT "duplicate_check_flags_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "duplicate_check_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_check_flags" ADD CONSTRAINT "duplicate_check_flags_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "generated_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
