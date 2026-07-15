-- CreateEnum
CREATE TYPE "ProductAudience" AS ENUM ('MALE', 'FEMALE', 'UNISEX');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "detectedAudience" "ProductAudience";

-- NOTE: `prisma migrate dev`'s auto-diff wanted to DROP INDEX "products_title_trgm_idx" here,
-- since that GIN/trgm index isn't (and can't be) modeled in schema.prisma. Removed deliberately —
-- see the 20260715000000_perf_indexes migration's own comment on why this project normally only
-- ever runs `migrate deploy`, not `migrate dev`, for exactly this reason.
