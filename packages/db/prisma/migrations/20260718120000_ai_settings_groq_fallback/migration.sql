-- AlterTable
ALTER TABLE "ai_settings" ADD COLUMN     "groqApiKeyEncrypted" TEXT,
ADD COLUMN     "groqModels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
