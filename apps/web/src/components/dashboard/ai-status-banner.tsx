import Link from "next/link";
import { prisma, findAiSettingsSafe } from "@ai-shopify/db";
import { GROQ_MODEL_OPTIONS } from "@ai-shopify/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// How far back to look for an AI-fallback warning before considering it stale — generation runs
// happen in bursts (bulk jobs, individual requests), not continuously, so this is a "still likely
// rate-limited right now" window rather than a strict rolling average.
const FALLBACK_WARNING_LOOKBACK_MS = 3 * 60 * 60 * 1000;

// OpenRouter's own default free-tier cap before any credits have ever been purchased — used only
// as a display fallback until we've actually observed the real limit from a live response.
const OPENROUTER_DEFAULT_FREE_LIMIT = 50;

function groqModelName(id: string): string {
  return GROQ_MODEL_OPTIONS.find((m) => m.id === id)?.name ?? id;
}

function formatResetAt(date: Date | null): string | null {
  if (!date) return null;
  const msLeft = date.getTime() - Date.now();
  if (msLeft <= 0) return "resets shortly";
  const hours = Math.floor(msLeft / (60 * 60 * 1000));
  const minutes = Math.round((msLeft % (60 * 60 * 1000)) / (60 * 1000));
  const relative = hours > 0 ? `in ${hours}h ${minutes}m` : `in ${minutes}m`;
  return `resets ${relative} (${date.toLocaleString()})`;
}

/** Fetches this store's AI generation health — configured providers' live daily capacity plus
 * whether generation has recently been falling back to the phrase-bank generator — for display on
 * any dashboard page that triggers or shows generated reviews. Self-contained: does its own
 * queries, so it can be dropped into any page without threading data through props.
 *
 * Purely informational, so on any failure (most notably: the aiProviderQuota table or the Groq
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

  const [aiSettings, quotas, recentFallback, fallbackCount] = await Promise.all([
    findAiSettingsSafe(store.id),
    prisma.aiProviderQuota.findMany({ where: { storeId: store.id } }).catch(() => []),
    prisma.systemLog.findFirst({
      where: {
        userId,
        level: "WARN",
        message: { contains: "fell back to the phrase-bank generator" },
        createdAt: { gte: new Date(Date.now() - FALLBACK_WARNING_LOOKBACK_MS) },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.systemLog.count({
      where: {
        userId,
        level: "WARN",
        message: { contains: "fell back to the phrase-bank generator" },
        createdAt: { gte: new Date(Date.now() - FALLBACK_WARNING_LOOKBACK_MS) },
      },
    }),
  ]);

  if (!aiSettings?.enabled) return null;

  const today = new Date().toISOString().slice(0, 10);

  type Row = { label: string; limit: number | null; remaining: number | null; isEstimate: boolean; resetAt: Date | null };
  const rows: Row[] = [];

  if (aiSettings.apiKeyEncrypted && aiSettings.models.length > 0) {
    const quota = quotas.find((q) => q.provider === "openrouter" && q.model === "account");
    if (quota?.remainingRequests !== null && quota?.remainingRequests !== undefined) {
      // Authoritative — we've actually seen OpenRouter report this (only happens once rate-limited).
      rows.push({
        label: "OpenRouter (account-wide, shared across all selected models)",
        limit: quota.limitRequests,
        remaining: quota.remainingRequests,
        isEstimate: false,
        resetAt: quota.requestsResetAt,
      });
    } else {
      // OpenRouter never reports anything on success, so this is a best-effort estimate from our
      // own attempt count against the known free-tier default (50/day, or 1000/day with credits —
      // the real limit only becomes known once actually rate-limited, at which point it flips to
      // the authoritative branch above).
      const limit = quota?.limitRequests ?? OPENROUTER_DEFAULT_FREE_LIMIT;
      const usedToday = quota?.selfTrackedDay === today ? quota.selfTrackedCount : 0;
      rows.push({
        label: "OpenRouter (account-wide, shared across all selected models)",
        limit,
        remaining: Math.max(0, limit - usedToday),
        isEstimate: true,
        resetAt: null,
      });
    }
  }

  for (const modelId of aiSettings.groqModels) {
    const quota = quotas.find((q) => q.provider === "groq" && q.model === modelId);
    rows.push({
      label: `Groq — ${groqModelName(modelId)}`,
      limit: quota?.limitRequests ?? null,
      remaining: quota?.remainingRequests ?? null,
      isEstimate: false,
      resetAt: quota?.requestsResetAt ?? null,
    });
  }

  if (rows.length === 0 && !recentFallback) return null;

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI generation capacity today</CardTitle>
            <CardDescription>
              Live limits reported by each provider. OpenRouter only reports its real numbers once
              you&apos;ve actually hit the limit — until then its figure is an estimate based on
              requests this app has made.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows.map((row) => (
              <div key={row.label} className="flex flex-col gap-0.5 rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{row.label}</span>
                  <span className="text-muted-foreground">
                    {row.remaining !== null ? row.remaining.toLocaleString() : "?"} /{" "}
                    {row.limit !== null ? row.limit.toLocaleString() : "?"} remaining today
                    {row.isEstimate ? " (estimate)" : ""}
                  </span>
                </div>
                {row.resetAt && <span className="text-xs text-muted-foreground">{formatResetAt(row.resetAt)}</span>}
                {row.remaining === 0 && (
                  <span className="text-xs font-medium text-destructive">
                    Exhausted — new reviews will use the phrase-bank generator until this resets{" "}
                    {row.remaining === 0 && row.isEstimate ? "(or you add OpenRouter credits)" : ""}.
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
              {fallbackCount === 1 ? "" : "s"} since then) — likely a rate limit. Reviews generated
              during this time used the phrase-bank generator instead of real AI content.{" "}
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
