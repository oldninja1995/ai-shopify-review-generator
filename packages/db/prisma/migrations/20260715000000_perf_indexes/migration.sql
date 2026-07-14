-- CreateIndex
CREATE INDEX "generated_reviews_status_idx" ON "generated_reviews"("status");

-- CreateIndex
CREATE INDEX "generated_reviews_createdAt_idx" ON "generated_reviews"("createdAt");

-- CreateIndex
CREATE INDEX "system_logs_createdAt_idx" ON "system_logs"("createdAt");

-- Trigram index for product title search (products/page.tsx uses `contains`/ILIKE, which a plain
-- btree index can't accelerate for a leading-wildcard match). Not modeled in schema.prisma since
-- Prisma has no first-class GIN/trgm support without a preview feature; this project only ever
-- runs `prisma migrate deploy` (never `migrate dev`), so this raw-SQL-only index won't cause drift
-- issues in practice.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "products_title_trgm_idx" ON "products" USING GIN ("title" gin_trgm_ops);
