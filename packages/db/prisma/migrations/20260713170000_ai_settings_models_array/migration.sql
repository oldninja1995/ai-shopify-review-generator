-- AlterTable
ALTER TABLE "ai_settings" ADD COLUMN "models" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Migrate any existing single-model rows into the new array column
UPDATE "ai_settings" SET "models" = ARRAY["model"] WHERE "model" IS NOT NULL;

-- AlterTable
ALTER TABLE "ai_settings" DROP COLUMN "model";
