import { NextResponse } from "next/server";
import { prisma, findAiSettingsSafe } from "@ai-shopify/db";
import { aiSettingsSchema, apiFailure, apiSuccess, encryptSecret } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { zodErrorToFieldErrors } from "@/lib/validation";

function requireEncryptionKey(): string {
  const value = process.env.ENCRYPTION_KEY;
  if (!value) throw new Error("Missing required environment variable: ENCRYPTION_KEY");
  return value;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });
  if (!store) {
    return NextResponse.json(
      apiSuccess({
        enabled: false,
        models: [],
        hasApiKey: false,
        visionAudienceEnabled: false,
        aiOnlyMode: false,
        groqModels: [],
        hasGroqApiKey: false,
      }),
    );
  }

  const aiSettings = await findAiSettingsSafe(store.id);
  return NextResponse.json(
    apiSuccess({
      enabled: aiSettings?.enabled ?? false,
      models: aiSettings?.models ?? [],
      hasApiKey: Boolean(aiSettings?.apiKeyEncrypted),
      visionAudienceEnabled: aiSettings?.visionAudienceEnabled ?? false,
      aiOnlyMode: aiSettings?.aiOnlyMode ?? false,
      groqModels: aiSettings?.groqModels ?? [],
      hasGroqApiKey: Boolean(aiSettings?.groqApiKeyEncrypted),
    }),
  );
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });
  if (!store) {
    return NextResponse.json(apiFailure("No Shopify store connected", { code: "NOT_CONNECTED" }), {
      status: 400,
    });
  }

  const body = await request.json().catch(() => null);
  const parsed = aiSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      apiFailure("Invalid input", { fieldErrors: zodErrorToFieldErrors(parsed.error) }),
      { status: 400 },
    );
  }
  const { apiKey, models, enabled, visionAudienceEnabled, aiOnlyMode, groqApiKey, groqModels } = parsed.data;

  const existing = await findAiSettingsSafe(store.id);
  if (enabled && !apiKey && !existing?.apiKeyEncrypted) {
    return NextResponse.json(
      apiFailure("Enter an API key before enabling AI generation", { code: "MISSING_API_KEY" }),
      { status: 400 },
    );
  }
  if ((groqApiKey || groqModels.length > 0) && existing && !existing.groqColumnsAvailable) {
    return NextResponse.json(
      apiFailure("Groq support isn't available on this deployment yet — try again shortly.", {
        code: "GROQ_NOT_MIGRATED",
      }),
      { status: 503 },
    );
  }

  const apiKeyEncrypted = apiKey ? encryptSecret(apiKey, requireEncryptionKey()) : existing?.apiKeyEncrypted;
  const groqApiKeyEncrypted = groqApiKey
    ? encryptSecret(groqApiKey, requireEncryptionKey())
    : existing?.groqApiKeyEncrypted;

  const coreData = { storeId: store.id, apiKeyEncrypted, models, enabled, visionAudienceEnabled, aiOnlyMode };
  const groqData = { groqApiKeyEncrypted, groqModels };
  // Explicit `select` matters here, not just the create/update payload — Prisma returns every
  // scalar model field by default regardless of what was written, so without this the "core-only"
  // fallback would still try to read back the (possibly nonexistent) Groq columns and throw anyway.
  const coreSelect = {
    enabled: true,
    models: true,
    apiKeyEncrypted: true,
    visionAudienceEnabled: true,
    aiOnlyMode: true,
  } as const;

  let result: { enabled: boolean; models: string[]; hasApiKey: boolean; visionAudienceEnabled: boolean; aiOnlyMode: boolean; groqModels: string[]; hasGroqApiKey: boolean };
  if (existing?.groqColumnsAvailable === false) {
    const aiSettings = await prisma.aiSettings.upsert({
      where: { storeId: store.id },
      create: coreData,
      update: coreData,
      select: coreSelect,
    });
    result = { ...aiSettings, hasApiKey: Boolean(aiSettings.apiKeyEncrypted), groqModels: [], hasGroqApiKey: false };
  } else {
    try {
      const aiSettings = await prisma.aiSettings.upsert({
        where: { storeId: store.id },
        create: { ...coreData, ...groqData },
        update: { ...coreData, ...groqData },
      });
      result = {
        ...aiSettings,
        hasApiKey: Boolean(aiSettings.apiKeyEncrypted),
        hasGroqApiKey: Boolean(aiSettings.groqApiKeyEncrypted),
      };
    } catch {
      // Covers the one case findAiSettingsSafe can't detect up front: no row existed yet for this
      // store (so `existing` was null) and the Groq columns also aren't migrated into this
      // database yet.
      const aiSettings = await prisma.aiSettings.upsert({
        where: { storeId: store.id },
        create: coreData,
        update: coreData,
        select: coreSelect,
      });
      result = { ...aiSettings, hasApiKey: Boolean(aiSettings.apiKeyEncrypted), groqModels: [], hasGroqApiKey: false };
    }
  }

  return NextResponse.json(apiSuccess(result));
}
