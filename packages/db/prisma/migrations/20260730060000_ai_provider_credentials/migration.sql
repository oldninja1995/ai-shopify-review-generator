-- Arbitrary OpenAI-compatible providers (Cerebras, Gemini compat endpoint, SambaNova, DeepSeek...).
-- OpenRouter and Groq stay on ai_settings for backwards compatibility; these are tried after both.
CREATE TABLE "ai_provider_credentials" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_provider_credentials_storeId_slug_key" ON "ai_provider_credentials"("storeId", "slug");
CREATE INDEX "ai_provider_credentials_storeId_idx" ON "ai_provider_credentials"("storeId");

ALTER TABLE "ai_provider_credentials"
    ADD CONSTRAINT "ai_provider_credentials_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "shopify_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
