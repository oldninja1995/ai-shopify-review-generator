-- CreateEnum
CREATE TYPE "AiProviderHealth" AS ENUM ('OK', 'BLOCKED');

-- CreateTable
CREATE TABLE "ai_provider_status" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AiProviderHealth" NOT NULL DEFAULT 'OK',
    "blockedSince" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_status_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_provider_status_storeId_idx" ON "ai_provider_status"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_status_storeId_provider_model_key" ON "ai_provider_status"("storeId", "provider", "model");

-- AddForeignKey
ALTER TABLE "ai_provider_status" ADD CONSTRAINT "ai_provider_status_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "shopify_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropTable
DROP TABLE "ai_provider_quotas";
