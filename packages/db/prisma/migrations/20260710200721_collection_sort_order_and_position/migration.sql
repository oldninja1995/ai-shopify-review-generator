-- AlterTable
ALTER TABLE "collections" ADD COLUMN "sortOrder" TEXT;

-- AlterTable
ALTER TABLE "product_collections" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
