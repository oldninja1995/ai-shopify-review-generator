import { prisma } from "./client";

/** Full AiSettings row, but Groq fields are guaranteed present even if their migration hasn't
 * run against this database yet — in that case they come back as empty/disabled rather than
 * throwing, and `groqColumnsAvailable` is false so callers can tell the difference from "configured
 * but empty" if it matters. Core fields (OpenRouter config, enabled, vision toggle) are fetched
 * with an explicit `select` that never touches the Groq columns, so this always succeeds
 * regardless of migration state — only the Groq-specific fetch is best-effort. */
export async function findAiSettingsSafe(storeId: string) {
  const core = await prisma.aiSettings.findUnique({
    where: { storeId },
    select: {
      id: true,
      storeId: true,
      apiKeyEncrypted: true,
      models: true,
      enabled: true,
      visionAudienceEnabled: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!core) return null;

  let groqApiKeyEncrypted: string | null = null;
  let groqModels: string[] = [];
  let groqColumnsAvailable = true;
  try {
    const groq = await prisma.aiSettings.findUnique({
      where: { storeId },
      select: { groqApiKeyEncrypted: true, groqModels: true },
    });
    groqApiKeyEncrypted = groq?.groqApiKeyEncrypted ?? null;
    groqModels = groq?.groqModels ?? [];
  } catch {
    // Groq columns not migrated into this database yet.
    groqColumnsAvailable = false;
  }

  return { ...core, groqApiKeyEncrypted, groqModels, groqColumnsAvailable };
}
