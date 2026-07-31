-- Speeds up the dashboard's "Reviews cleared" / "Reviews uploaded" aggregates, which filter
-- system_logs on metadata->>'type' (and combined with metadata->>'status') as this table grows
-- proportionally to total review volume.
CREATE INDEX IF NOT EXISTS "system_logs_metadata_type_idx" ON "system_logs" ((metadata->>'type'));
