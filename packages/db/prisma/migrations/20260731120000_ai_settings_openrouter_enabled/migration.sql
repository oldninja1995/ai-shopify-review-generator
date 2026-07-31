-- Lets a store switch OpenRouter off without clearing its configured models or turning off AI
-- generation entirely. Defaults to true so every existing row keeps its current behavior.
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "openRouterEnabled" BOOLEAN NOT NULL DEFAULT true;
