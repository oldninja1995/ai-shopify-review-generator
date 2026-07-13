-- CreateEnum
CREATE TYPE "DuplicateCheckStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "duplicate_check_jobs" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "limitCount" INTEGER,
    "status" "DuplicateCheckStatus" NOT NULL DEFAULT 'PENDING',
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "totalToDelete" INTEGER NOT NULL DEFAULT 0,
    "deletedCount" INTEGER NOT NULL DEFAULT 0,
    "contentDuplicatesRemoved" INTEGER NOT NULL DEFAULT 0,
    "reviewerDuplicatesRemoved" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "duplicate_check_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "duplicate_check_jobs_storeId_idx" ON "duplicate_check_jobs"("storeId");

-- AddForeignKey
ALTER TABLE "duplicate_check_jobs" ADD CONSTRAINT "duplicate_check_jobs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "shopify_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
