import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
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
    return NextResponse.json(apiSuccess({ enabled: false, models: [], hasApiKey: false }));
  }

  const aiSettings = await prisma.aiSettings.findUnique({ where: { storeId: store.id } });
  return NextResponse.json(
    apiSuccess({
      enabled: aiSettings?.enabled ?? false,
      models: aiSettings?.models ?? [],
      hasApiKey: Boolean(aiSettings?.apiKeyEncrypted),
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
  const { apiKey, models, enabled } = parsed.data;

  const existing = await prisma.aiSettings.findUnique({ where: { storeId: store.id } });
  if (enabled && !apiKey && !existing?.apiKeyEncrypted) {
    return NextResponse.json(
      apiFailure("Enter an API key before enabling AI generation", { code: "MISSING_API_KEY" }),
      { status: 400 },
    );
  }

  const apiKeyEncrypted = apiKey ? encryptSecret(apiKey, requireEncryptionKey()) : existing?.apiKeyEncrypted;

  const aiSettings = await prisma.aiSettings.upsert({
    where: { storeId: store.id },
    create: { storeId: store.id, apiKeyEncrypted, models, enabled },
    update: { apiKeyEncrypted, models, enabled },
  });

  return NextResponse.json(
    apiSuccess({
      enabled: aiSettings.enabled,
      models: aiSettings.models,
      hasApiKey: Boolean(aiSettings.apiKeyEncrypted),
    }),
  );
}
