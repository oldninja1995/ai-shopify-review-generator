import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { aiProviderCredentialSchema, apiFailure, apiSuccess, encryptSecret } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";

function requireEncryptionKey(): string {
  const value = process.env.ENCRYPTION_KEY;
  if (!value) throw new Error("Missing required environment variable: ENCRYPTION_KEY");
  return value;
}

async function currentStore(userId: string) {
  return prisma.shopifyStore.findFirst({ where: { userId }, orderBy: { connectedAt: "desc" } });
}

/** Never returns the key itself — only whether one is stored, same convention as /api/ai-settings. */
function toDto(row: {
  id: string;
  label: string;
  slug: string;
  baseUrl: string;
  apiKeyEncrypted: string;
  models: string[];
  enabled: boolean;
  sortOrder: number;
}) {
  return {
    id: row.id,
    label: row.label,
    slug: row.slug,
    baseUrl: row.baseUrl,
    hasApiKey: Boolean(row.apiKeyEncrypted),
    models: row.models,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), { status: 401 });
  }
  const store = await currentStore(user.id);
  if (!store) return NextResponse.json(apiSuccess({ providers: [] }));

  // Best-effort: if the migration hasn't reached this database yet, an empty list is far better
  // than a 500 that takes the whole AI settings page down with it.
  const providers = await prisma.aiProviderCredential
    .findMany({ where: { storeId: store.id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })
    .catch(() => []);

  return NextResponse.json(apiSuccess({ providers: providers.map(toDto) }));
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), { status: 401 });
  }
  const store = await currentStore(user.id);
  if (!store) {
    return NextResponse.json(apiFailure("No Shopify store connected", { code: "NOT_CONNECTED" }), { status: 400 });
  }

  const parsed = aiProviderCredentialSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      apiFailure(parsed.error.issues[0]?.message ?? "Invalid request", { code: "VALIDATION_ERROR" }),
      { status: 400 },
    );
  }
  const { label, slug, baseUrl, apiKey, models, enabled } = parsed.data;

  // Reserved because AiProviderStatus.provider is shared between the built-ins and these slugs;
  // colliding would make one provider's health overwrite the other's.
  if (slug === "openrouter" || slug === "groq") {
    return NextResponse.json(
      apiFailure("OpenRouter and Groq are configured above — pick a different id", { code: "RESERVED_SLUG" }),
      { status: 400 },
    );
  }

  const existing = await prisma.aiProviderCredential
    .findUnique({ where: { storeId_slug: { storeId: store.id, slug } } })
    .catch(() => null);

  if (!existing && !apiKey) {
    return NextResponse.json(apiFailure("An API key is required", { code: "MISSING_API_KEY" }), { status: 400 });
  }

  const apiKeyEncrypted = apiKey ? encryptSecret(apiKey, requireEncryptionKey()) : existing?.apiKeyEncrypted;
  const saved = await prisma.aiProviderCredential.upsert({
    where: { storeId_slug: { storeId: store.id, slug } },
    create: { storeId: store.id, label, slug, baseUrl, apiKeyEncrypted: apiKeyEncrypted!, models, enabled },
    update: { label, baseUrl, apiKeyEncrypted: apiKeyEncrypted!, models, enabled },
  });

  return NextResponse.json(apiSuccess({ provider: toDto(saved) }));
}

/** Flips a single provider on or off without touching its key or model list.
 *
 * Separate from DELETE because switching a provider off is routine — a free tier runs out for the
 * day, or a provider starts returning garbage — and re-adding a key afterwards is not. The worker
 * already filters on `enabled` when it assembles the fallback chain, so a disabled provider costs
 * no network calls at all. */
export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), { status: 401 });
  }
  const store = await currentStore(user.id);
  if (!store) {
    return NextResponse.json(apiFailure("No Shopify store connected", { code: "NOT_CONNECTED" }), { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { slug?: unknown; enabled?: unknown } | null;
  if (typeof body?.slug !== "string" || typeof body.enabled !== "boolean") {
    return NextResponse.json(apiFailure("Missing slug or enabled", { code: "VALIDATION_ERROR" }), { status: 400 });
  }

  const updated = await prisma.aiProviderCredential.updateMany({
    where: { storeId: store.id, slug: body.slug },
    data: { enabled: body.enabled },
  });
  if (updated.count === 0) {
    return NextResponse.json(apiFailure("Provider not found", { code: "NOT_FOUND" }), { status: 404 });
  }

  return NextResponse.json(apiSuccess({ slug: body.slug, enabled: body.enabled }));
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), { status: 401 });
  }
  const store = await currentStore(user.id);
  if (!store) {
    return NextResponse.json(apiFailure("No Shopify store connected", { code: "NOT_CONNECTED" }), { status: 400 });
  }

  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) {
    return NextResponse.json(apiFailure("Missing slug", { code: "VALIDATION_ERROR" }), { status: 400 });
  }

  await prisma.aiProviderCredential.deleteMany({ where: { storeId: store.id, slug } });
  // Its health rows would otherwise linger and be rendered against a provider that no longer exists.
  await prisma.aiProviderStatus.deleteMany({ where: { storeId: store.id, provider: slug } });

  return NextResponse.json(apiSuccess({ deleted: true }));
}
