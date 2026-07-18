-- CreateTable
CREATE TABLE "ai_provider_quotas" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "limitRequests" INTEGER,
    "remainingRequests" INTEGER,
    "requestsResetAt" TIMESTAMP(3),
    "limitTokens" INTEGER,
    "remainingTokens" INTEGER,
    "tokensResetAt" TIMESTAMP(3),
    "selfTrackedCount" INTEGER NOT NULL DEFAULT 0,
    "selfTrackedDay" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_provider_quotas_storeId_idx" ON "ai_provider_quotas"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_quotas_storeId_provider_model_key" ON "ai_provider_quotas"("storeId", "provider", "model");

-- AddForeignKey
ALTER TABLE "ai_provider_quotas" ADD CONSTRAINT "ai_provider_quotas_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "shopify_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
