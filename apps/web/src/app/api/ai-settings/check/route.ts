import { NextResponse } from "next/server";
import { prisma, findAiSettingsSafe } from "@ai-shopify/db";
import { apiFailure, apiSuccess, decryptSecret } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";

/** Long enough that a slow-but-alive free model isn't reported as dead, short enough that checking
 * a dozen models can't hang the request. Each model is probed in parallel, so this is the ceiling
 * for the whole check, not per model. */
const PROBE_TIMEOUT_MS = 12_000;

function requireEncryptionKey(): string {
  const value = process.env.ENCRYPTION_KEY;
  if (!value) throw new Error("Missing required environment variable: ENCRYPTION_KEY");
  return value;
}

export type CheckReason =
  | "ok"
  | "rate_limited"
  | "out_of_credit"
  | "auth"
  | "model_unavailable"
  | "provider_error"
  | "network";

export type ModelCheckResult = {
  provider: "openrouter" | "groq";
  model: string;
  ok: boolean;
  reason: CheckReason;
  httpStatus?: number;
  /** One human-readable sentence — what's actually wrong and, where the provider says so, when it
   * will clear. This is what the UI shows; the raw body is deliberately not surfaced. */
  detail: string;
  retryAfterSeconds?: number;
  remainingRequests?: string;
  remainingTokens?: string;
  resetsIn?: string;
};

export type AccountInfo = {
  label: string;
  usage?: number;
  limit?: number | null;
  limitRemaining?: number | null;
  isFreeTier?: boolean;
};

/** Maps an HTTP status to what it actually means for this app, so the UI can say "rate limited"
 * or "key rejected" instead of making you read a status code. The distinction matters: only
 * rate_limited and out_of_credit are quota problems that clear on their own — auth and
 * model_unavailable need you to change something in settings. */
function classify(status: number, body: string): { reason: CheckReason; detail: string } {
  const snippet = body.replace(/\s+/g, " ").slice(0, 160);
  if (status === 429) return { reason: "rate_limited", detail: "Rate limited — quota exhausted for now" };
  if (status === 402) return { reason: "out_of_credit", detail: "Out of credits on this account" };
  if (status === 401 || status === 403) {
    return { reason: "auth", detail: "API key rejected — wrong, revoked or expired" };
  }
  if (status === 404) {
    return { reason: "model_unavailable", detail: "Model not found — the id may have been retired" };
  }
  if (status >= 500) return { reason: "provider_error", detail: `Provider error ${status}` };
  return { reason: "provider_error", detail: `Unexpected ${status}${snippet ? `: ${snippet}` : ""}` };
}

function formatSeconds(total: number): string {
  if (total < 60) return `${Math.round(total)}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Both providers expose rate-limit state via near-identical headers (OpenRouter follows the same
 * x-ratelimit-* convention Groq uses). Missing headers are normal — plenty of free models send
 * none at all — so every field here is optional rather than defaulted to a guess. */
function readRateLimitHeaders(headers: Headers) {
  const retryAfterRaw = headers.get("retry-after");
  const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : undefined;
  const resetRaw =
    headers.get("x-ratelimit-reset-requests") ?? headers.get("x-ratelimit-reset-tokens") ?? undefined;

  return {
    retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    remainingRequests: headers.get("x-ratelimit-remaining-requests") ?? undefined,
    remainingTokens: headers.get("x-ratelimit-remaining-tokens") ?? undefined,
    resetsIn: resetRaw ?? undefined,
  };
}

/** Deliberately a real chat-completions call rather than a metadata lookup: free models are
 * rate-limited per model, so only an actual generation request proves this key can use this model
 * right now. max_tokens is 1 to keep the cost of checking as close to nothing as possible. */
async function probeModel(
  provider: "openrouter" | "groq",
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<ModelCheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      signal: controller.signal,
    });

    const limits = readRateLimitHeaders(response.headers);
    if (response.ok) {
      return { provider, model, ok: true, reason: "ok", httpStatus: response.status, detail: "Working", ...limits };
    }

    const { reason, detail } = classify(response.status, await response.text().catch(() => ""));
    const retrySuffix = limits.retryAfterSeconds ? ` — retry in ${formatSeconds(limits.retryAfterSeconds)}` : "";
    return { provider, model, ok: false, reason, httpStatus: response.status, detail: `${detail}${retrySuffix}`, ...limits };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      provider,
      model,
      ok: false,
      reason: "network",
      detail: aborted
        ? `No response within ${PROBE_TIMEOUT_MS / 1000}s`
        : `Could not reach provider: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Account-level credit/limit, which per-model probes can't tell you — a key can be out of credit
 * while every model id is perfectly valid. Best-effort: returns null rather than failing the check
 * if OpenRouter doesn't answer. */
async function fetchOpenRouterAccount(apiKey: string): Promise<AccountInfo | null> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      data?: { usage?: number; limit?: number | null; limit_remaining?: number | null; is_free_tier?: boolean };
    };
    if (!body.data) return null;
    return {
      label: "OpenRouter account",
      usage: body.data.usage,
      limit: body.data.limit,
      limitRemaining: body.data.limit_remaining,
      isFreeTier: body.data.is_free_tier,
    };
  } catch {
    return null;
  }
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), { status: 401 });
  }

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });
  if (!store) {
    return NextResponse.json(apiFailure("No Shopify store connected", { code: "NOT_CONNECTED" }), { status: 400 });
  }

  const aiSettings = await findAiSettingsSafe(store.id);
  if (!aiSettings?.enabled) {
    return NextResponse.json(apiFailure("AI generation is turned off", { code: "AI_DISABLED" }), { status: 400 });
  }

  const encryptionKey = requireEncryptionKey();
  const targets: { provider: "openrouter" | "groq"; baseUrl: string; apiKey: string; model: string }[] = [];

  if (aiSettings.apiKeyEncrypted && aiSettings.models.length > 0) {
    const apiKey = decryptSecret(aiSettings.apiKeyEncrypted, encryptionKey);
    for (const model of aiSettings.models) {
      targets.push({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey, model });
    }
  }
  if (aiSettings.groqApiKeyEncrypted && aiSettings.groqModels.length > 0) {
    const apiKey = decryptSecret(aiSettings.groqApiKeyEncrypted, encryptionKey);
    for (const model of aiSettings.groqModels) {
      targets.push({ provider: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey, model });
    }
  }

  if (targets.length === 0) {
    return NextResponse.json(
      apiFailure("No models configured to check — add a key and pick at least one model", {
        code: "NO_MODELS",
      }),
      { status: 400 },
    );
  }

  // Every model is probed at once: checking is a user-facing action they're waiting on, and these
  // are independent network calls against (usually) two different providers.
  const openRouterKey = aiSettings.apiKeyEncrypted
    ? decryptSecret(aiSettings.apiKeyEncrypted, encryptionKey)
    : null;
  const [results, account] = await Promise.all([
    Promise.all(targets.map((t) => probeModel(t.provider, t.baseUrl, t.apiKey, t.model))),
    openRouterKey ? fetchOpenRouterAccount(openRouterKey) : Promise.resolve(null),
  ]);

  // Writes the same columns the worker maintains, with the same blockedSince semantics (preserve
  // the original timestamp across consecutive failures, clear it on success) so a check and a real
  // generation run can't disagree about what "blocked since" means.
  await Promise.all(
    results.map(async (result) => {
      const where = {
        storeId_provider_model: { storeId: store.id, provider: result.provider, model: result.model },
      };
      const existing = await prisma.aiProviderStatus.findUnique({ where });
      const data = {
        status: (result.ok ? "OK" : "BLOCKED") as "OK" | "BLOCKED",
        blockedSince: result.ok ? null : existing?.status === "BLOCKED" ? existing.blockedSince : new Date(),
        lastError: result.ok ? null : result.detail,
      };
      await prisma.aiProviderStatus.upsert({
        where,
        create: { storeId: store.id, provider: result.provider, model: result.model, ...data },
        update: data,
      });
    }),
  );

  return NextResponse.json(
    apiSuccess({
      checkedAt: new Date().toISOString(),
      results,
      account,
      workingCount: results.filter((r) => r.ok).length,
      totalCount: results.length,
    }),
  );
}
