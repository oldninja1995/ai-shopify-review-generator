import Link from "next/link";
import { prisma, findAiSettingsSafe } from "@ai-shopify/db";
import { GROQ_MODEL_OPTIONS } from "@ai-shopify/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

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

  type Row = {
    label: string;
    limit: number | null;
    remaining: number | null;
    isEstimate: boolean;
    resetAt: Date | null;
    /** True once this row's free-tier estimate hits zero but a paid model is also configured —
     * generation keeps working off paid capacity instead of actually being exhausted, so the
     * "exhausted, falling back to phrase-bank" warning would be wrong here. */
    hasPaidFallback?: boolean;
  };
  const rows: Row[] = [];

  if (aiSettings.apiKeyEncrypted && aiSettings.models.length > 0) {
    // OpenRouter marks its zero-cost model variants with a `:free` suffix on the model id — any
    // selected model without one is paid and isn't subject to the shared free-tier daily cap.
    const hasPaidModel = aiSettings.models.some((id) => !id.endsWith(":free"));
    const quota = quotas.find((q) => q.provider === "openrouter" && q.model === "account");
    if (quota?.remainingRequests !== null && quota?.remainingRequests !== undefined) {
      // Authoritative — we've actually seen OpenRouter report this (only happens once rate-limited).
      rows.push({
        label: "OpenRouter (account-wide, shared across all selected models)",
        limit: quota.limitRequests,
        remaining: quota.remainingRequests,
        isEstimate: false,
        resetAt: quota.requestsResetAt,
        hasPaidFallback: hasPaidModel,
      });
    } else {
      // OpenRouter never reports anything on success, so this is a best-effort estimate from our
      // own attempt count against the known free-tier default (50/day, or 1000/day with credits —
      // the real limit only becomes known once actually rate-limited, at which point it flips to
      // the authoritative branch above). Only free-model calls count toward usedToday (see
      // persistQuotaEvent in generate.ts), so a paid model succeeding doesn't make this look more
      // exhausted than it actually is.
      const limit = quota?.limitRequests ?? OPENROUTER_DEFAULT_FREE_LIMIT;
      const usedToday = quota?.selfTrackedDay === today ? quota.selfTrackedCount : 0;
      rows.push({
        label: "OpenRouter (account-wide, shared across all selected models)",
        limit,
        remaining: Math.max(0, limit - usedToday),
        isEstimate: true,
        resetAt: null,
        hasPaidFallback: hasPaidModel,
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

  // Each review is ~1 API request in the common case, occasionally 2-3 on a hash-collision retry
  // or a rejected response_format — so this total is a "how many reviews can I realistically get
  // today" figure, not a literal request count, and deliberately phrased as "up to" rather than
  // an exact promise. A row whose free tier is used up but has a paid model to fall back on is
  // excluded here — its true remaining capacity is unknown (paid, not exhausted), not zero.
  const knownRemaining = rows.filter((r) => r.remaining !== null && !(r.hasPaidFallback && r.remaining === 0));
  const totalReviewsLeft =
    knownRemaining.length > 0 ? knownRemaining.reduce((sum, r) => sum + (r.remaining ?? 0), 0) : null;

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {totalReviewsLeft !== null
                ? `Up to ~${totalReviewsLeft.toLocaleString()} AI-generated reviews left today`
                : "AI generation capacity today"}
            </CardTitle>
            <CardDescription>
              Roughly one review per AI request, so this is an estimate, not an exact count.
              OpenRouter only reports its real remaining count once you&apos;ve actually hit its
              limit — until then its figure below is a best-effort estimate from requests this app
              has made. Once every provider here is exhausted, new reviews fall back to the
              built-in phrase-bank generator instead of failing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.map((row) => {
              const percentUsed =
                row.limit && row.limit > 0 && row.remaining !== null
                  ? Math.min(100, Math.max(0, ((row.limit - row.remaining) / row.limit) * 100))
                  : null;
              return (
                <div key={row.label} className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{row.label}</span>
                    <span className="text-muted-foreground">
                      {row.remaining !== null
                        ? `~${row.remaining.toLocaleString()} reviews left today`
                        : "? reviews left today"}
                      {row.limit !== null ? ` (${row.limit.toLocaleString()}/day limit)` : ""}
                      {row.isEstimate ? " — estimate" : ""}
                    </span>
                  </div>
                  {percentUsed !== null && <Progress value={percentUsed} />}
                  {row.resetAt && <span className="text-xs text-muted-foreground">{formatResetAt(row.resetAt)}</span>}
                  {row.remaining === 0 && row.hasPaidFallback && (
                    <span className="text-xs font-medium text-muted-foreground">
                      Free tier used up for today — new reviews will use your paid OpenRouter model(s) instead.
                    </span>
                  )}
                  {row.remaining === 0 && !row.hasPaidFallback && (
                    <span className="text-xs font-medium text-destructive">
                      Exhausted — new reviews will use the phrase-bank generator until this resets{" "}
                      {row.isEstimate ? "(or you add OpenRouter credits)" : ""}.
                    </span>
                  )}
                </div>
              );
            })}
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
