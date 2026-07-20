import Link from "next/link";
import { prisma, findAiSettingsSafe } from "@ai-shopify/db";
import { GROQ_MODEL_OPTIONS } from "@ai-shopify/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// How far back to look for an AI-fallback warning before considering it stale — generation runs
// happen in bursts (bulk jobs, individual requests), not continuously, so this is a "still likely
// rate-limited right now" window rather than a strict rolling average.
const FALLBACK_WARNING_LOOKBACK_MS = 3 * 60 * 60 * 1000;

function groqModelName(id: string): string {
  return GROQ_MODEL_OPTIONS.find((m) => m.id === id)?.name ?? id;
}

function formatSince(date: Date): string {
  const msAgo = Date.now() - date.getTime();
  const minutes = Math.round(msAgo / (60 * 1000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago (${date.toLocaleString()})`;
}

/** Fetches this store's AI generation health — each configured model's real working/blocked
 * status, plus whether generation has recently been falling back to the phrase-bank generator —
 * for display on any dashboard page that triggers or shows generated reviews. Self-contained: does
 * its own queries, so it can be dropped into any page without threading data through props.
 *
 * Purely informational, so on any failure (most notably: the ai_provider_status table or the Groq
 * columns not existing yet because a migration hasn't been applied to this database) it renders
 * nothing rather than taking the whole page down with it — a past incident where this crashed
 * Products/Review Generator is exactly why this exists. */
export async function AiStatusBanner({ userId }: { userId: string }) {
  try {
    return await AiStatusBannerInner({ userId });
  } catch (error) {
    console.error("[ai-status-banner] failed to render, hiding silently:", error);
    return null;
  }
}

async function AiStatusBannerInner({ userId }: { userId: string }) {
  const store = await prisma.shopifyStore.findFirst({
    where: { userId },
    orderBy: { connectedAt: "desc" },
  });
  if (!store) return null;

  const [aiSettings, statuses, recentFallback, fallbackCount] = await Promise.all([
    findAiSettingsSafe(store.id),
    prisma.aiProviderStatus.findMany({ where: { storeId: store.id } }).catch(() => []),
    prisma.systemLog.findFirst({
      where: {
        userId,
        level: "WARN",
        // Matches both the phrase-bank-fallback and AI-only-mode-skip warning messages from
        // generate.ts — they share this phrase regardless of which one fired.
        message: { contains: "every configured AI provider" },
        createdAt: { gte: new Date(Date.now() - FALLBACK_WARNING_LOOKBACK_MS) },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.systemLog.count({
      where: {
        userId,
        level: "WARN",
        // Matches both the phrase-bank-fallback and AI-only-mode-skip warning messages from
        // generate.ts — they share this phrase regardless of which one fired.
        message: { contains: "every configured AI provider" },
        createdAt: { gte: new Date(Date.now() - FALLBACK_WARNING_LOOKBACK_MS) },
      },
    }),
  ]);

  if (!aiSettings?.enabled) return null;

  type Row = { label: string; status: "OK" | "BLOCKED"; blockedSince: Date | null; lastError: string | null };
  const rows: Row[] = [];

  if (aiSettings.apiKeyEncrypted && aiSettings.models.length > 0) {
    for (const modelId of aiSettings.models) {
      const s = statuses.find((row) => row.provider === "openrouter" && row.model === modelId);
      rows.push({
        label: `OpenRouter — ${modelId}`,
        status: s?.status ?? "OK",
        blockedSince: s?.blockedSince ?? null,
        lastError: s?.lastError ?? null,
      });
    }
  }

  for (const modelId of aiSettings.groqModels) {
    const s = statuses.find((row) => row.provider === "groq" && row.model === modelId);
    rows.push({
      label: `Groq — ${groqModelName(modelId)}`,
      status: s?.status ?? "OK",
      blockedSince: s?.blockedSince ?? null,
      lastError: s?.lastError ?? null,
    });
  }

  if (rows.length === 0 && !recentFallback) return null;

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI provider status</CardTitle>
            <CardDescription>
              Reflects only what the last real call to each model actually did — not an estimate of
              remaining quota.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex flex-col gap-1 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="font-medium">{row.label}</span>
                {row.status === "OK" ? (
                  <span className="text-muted-foreground">
                    <span className="mr-1.5 inline-block size-2 rounded-full bg-emerald-500" />
                    Working
                  </span>
                ) : (
                  <span className="text-destructive" title={row.lastError ?? undefined}>
                    <span className="mr-1.5 inline-block size-2 rounded-full bg-destructive" />
                    Blocked{row.blockedSince ? ` (since ${formatSince(row.blockedSince)})` : ""}
                    {row.lastError ? ` — ${row.lastError}` : ""}
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {recentFallback && (
        <Card className="border-amber-500/50 bg-amber-500/10 dark:border-amber-400/40 dark:bg-amber-400/10">
          <CardHeader>
            <CardTitle className="text-base text-amber-900 dark:text-amber-200">
              AI generation is currently degraded
            </CardTitle>
            <CardDescription className="text-amber-900/80 dark:text-amber-200/80">
              Every configured AI provider failed at least once in the last few hours (most
              recently {new Date(recentFallback.createdAt).toLocaleString()}, {fallbackCount} time
              {fallbackCount === 1 ? "" : "s"} since then) — likely a rate limit.{" "}
              {aiSettings?.aiOnlyMode
                ? "Those reviews were skipped instead of generated (AI-only mode is on)."
                : "Reviews generated during this time used the phrase-bank generator instead of real AI content."}{" "}
              <Link href="/dashboard/logs?level=WARN" className="underline">
                View details in Logs
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
