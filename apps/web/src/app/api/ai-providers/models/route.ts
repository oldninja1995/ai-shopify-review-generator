import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess, decryptSecret } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";

const FETCH_TIMEOUT_MS = 12_000;

function requireEncryptionKey(): string {
  const value = process.env.ENCRYPTION_KEY;
  if (!value) throw new Error("Missing required environment variable: ENCRYPTION_KEY");
  return value;
}

/** Free means every price component is zero. Providers report prices as decimal *strings* ("0",
 * "0.0000001"), so Number() is needed — "0.0000001" is truthy as a string and would otherwise be
 * mistaken for free. Absent pricing means unknown, not free. */
function isFreePricing(pricing: Record<string, unknown> | undefined): boolean | undefined {
  if (!pricing) return undefined;
  const values = Object.values(pricing).filter((v) => typeof v === "string" || typeof v === "number");
  if (values.length === 0) return undefined;
  return values.every((v) => Number(v) === 0);
}

/** Lists a provider's models from its own API, so the picker reflects what the key can actually use
 * today rather than a hand-written list that goes stale as providers rename and retire ids. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    slug?: string;
    baseUrl?: string;
    apiKey?: string;
  };
  if (!body.baseUrl) {
    return NextResponse.json(apiFailure("Missing base URL", { code: "VALIDATION_ERROR" }), { status: 400 });
  }

  // A saved provider's key is reused so the field doesn't have to be re-entered just to refresh a
  // model list; an unsaved one can pass its key through directly.
  let apiKey = body.apiKey?.trim();
  if (!apiKey && body.slug) {
    const store = await prisma.shopifyStore.findFirst({
      where: { userId: user.id },
      orderBy: { connectedAt: "desc" },
    });
    if (store) {
      const saved = await prisma.aiProviderCredential
        .findUnique({ where: { storeId_slug: { storeId: store.id, slug: body.slug } } })
        .catch(() => null);
      if (saved) apiKey = decryptSecret(saved.apiKeyEncrypted, requireEncryptionKey());
    }
  }

  const url = `${body.baseUrl.replace(/\/+$/, "")}/models`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    return NextResponse.json(
      apiFailure(
        `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
        { code: "UNREACHABLE" },
      ),
      { status: 502 },
    );
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    return NextResponse.json(
      apiFailure(
        response.status === 404
          ? "This provider has no /models endpoint — enter model ids manually"
          : `Model list failed (${response.status})${detail ? `: ${detail}` : ""}`,
        { code: "MODEL_LIST_FAILED" },
      ),
      { status: 400 },
    );
  }

  const payload = (await response.json().catch(() => null)) as {
    data?: { id?: string; pricing?: Record<string, unknown> }[];
    models?: { name?: string; id?: string }[];
  } | null;

  // OpenAI-compatible providers return { data: [...] }; Cohere returns { models: [{ name }] }.
  const raw = payload?.data ?? payload?.models ?? [];
  const models = raw
    .map((m) => {
      const id = (m as { id?: string }).id ?? (m as { name?: string }).name ?? "";
      return { id, isFree: isFreePricing((m as { pricing?: Record<string, unknown> }).pricing) };
    })
    .filter((m) => m.id)
    .sort((a, b) => {
      // Free first when pricing is known — that's what matters for picking a bulk-generation model.
      if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
      return a.id.localeCompare(b.id);
    });

  return NextResponse.json(
    apiSuccess({
      models,
      freeCount: models.filter((m) => m.isFree).length,
      pricingKnown: models.some((m) => m.isFree !== undefined),
    }),
  );
}
