"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { GROQ_MODEL_OPTIONS } from "@ai-shopify/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { postJson } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export type ProviderStatusRow = {
  provider: string;
  model: string;
  status: "OK" | "BLOCKED";
  blockedSince: string | null;
  lastError: string | null;
  /** Groq only: whether this model is actually in the fallback chain. An unselected model can be
   * perfectly healthy and still never be called during generation. */
  selected?: boolean;
  /** No stored status row exists, so "OK" here is a default rather than an observation. */
  neverChecked?: boolean;
};

type ModelCheckResult = {
  provider: "openrouter" | "groq";
  model: string;
  ok: boolean;
  reason: string;
  detail: string;
  limitRequests?: string;
  remainingRequests?: string;
  limitTokens?: string;
  remainingTokens?: string;
  resetAt?: string;
  resetsIn?: string;
};

type CheckResponse = {
  checkedAt: string;
  results: ModelCheckResult[];
  account: {
    label: string;
    usage?: number;
    limit?: number | null;
    limitRemaining?: number | null;
    isFreeTier?: boolean;
  } | null;
  workingCount: number;
  totalCount: number;
  selectedGroqModels?: string[];
};

const PROVIDER_ORDER = ["openrouter", "groq"] as const;
type ProviderKey = (typeof PROVIDER_ORDER)[number];

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  openrouter: "OpenRouter",
  groq: "Groq (fallback)",
};

// The provider name is now the group header, so repeating it per row would just be noise.
function modelLabel(provider: string, model: string): string {
  if (provider === "groq") return GROQ_MODEL_OPTIONS.find((m) => m.id === model)?.name ?? model;
  return model;
}

function formatSince(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

/** Live per-model health with an on-demand re-check.
 *
 * The stored rows this renders come from whatever the last *real generation call* did, which goes
 * stale in one specific way: generation stops at the first model that works, so every model below
 * it in the fallback order is never retried and keeps whatever status it last had, indefinitely.
 * "Check now" is the fix — it probes every configured model directly and rewrites all of them, so
 * a BLOCKED row that has since recovered can be cleared without waiting for a generation run. */
export function AiProviderStatusCard({
  initialRows,
  notice,
}: {
  initialRows: ProviderStatusRow[];
  /** Set when a provider is configured but silently inert — most importantly a saved Groq key with
   * no models selected, which renders no rows at all and so previously looked identical to "Groq
   * was never set up". */
  notice?: string | null;
}) {
  const [rows, setRows] = useState(initialRows);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<CheckResponse | null>(null);
  // Groq starts open (four entries, and it's the fallback people are usually here to verify);
  // OpenRouter starts collapsed because a configured store can easily have dozens of models.
  const [open, setOpen] = useState<Record<string, boolean>>({ openrouter: false, groq: true });

  async function runCheck() {
    setChecking(true);
    const result = await postJson<CheckResponse>("/api/ai-settings/check", {});
    setChecking(false);

    if (!result.success) {
      toast.error(result.error.message);
      return;
    }

    setChecked(result.data);
    const selectedGroq = new Set(result.data.selectedGroqModels ?? []);
    setRows(
      result.data.results.map((r) => ({
        provider: r.provider,
        model: r.model,
        status: r.ok ? ("OK" as const) : ("BLOCKED" as const),
        blockedSince: null,
        lastError: r.ok ? null : r.detail,
        selected: r.provider === "groq" ? selectedGroq.has(r.model) : undefined,
        neverChecked: false,
      })),
    );

    const { workingCount, totalCount } = result.data;
    if (workingCount === totalCount) {
      toast.success(`All ${totalCount} model${totalCount === 1 ? "" : "s"} working`);
    } else if (workingCount === 0) {
      toast.error(`Every model is blocked (${totalCount} checked)`);
    } else {
      toast.warning(`${workingCount} of ${totalCount} models working`);
    }
  }

  // Detail from a fresh probe (rate-limit numbers, retry-after) is richer than the single error
  // string persisted per model, so prefer it when this session has actually run a check.
  const freshByKey = new Map(checked?.results.map((r) => [`${r.provider}:${r.model}`, r]) ?? []);
  const account = checked?.account;

  const grouped = rows.reduce<Record<string, ProviderStatusRow[]>>((acc, row) => {
    (acc[row.provider] ??= []).push(row);
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle className="text-base">AI provider status</CardTitle>
            <CardDescription>
              {checked
                ? `Checked ${formatSince(checked.checkedAt)} — every configured model was called directly.`
                : "Reflects the last real generation call. Models below a working one in the fallback order are never retried, so run a check to see their true state."}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" disabled={checking} onClick={runCheck}>
            {checking ? "Checking..." : "Check now"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {notice && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200">
            {notice}
          </div>
        )}

        {account && (
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{account.label}</span>
            {account.isFreeTier ? " · free tier" : ""}
            {typeof account.usage === "number" ? ` · $${account.usage.toFixed(3)} used` : ""}
            {typeof account.limitRemaining === "number"
              ? ` · $${account.limitRemaining.toFixed(3)} remaining`
              : account.limit === null
                ? " · no spend limit set"
                : ""}
          </div>
        )}

        {PROVIDER_ORDER.filter((p) => grouped[p]?.length).map((provider) => {
          const group = grouped[provider] ?? [];
          const known = group.filter((r) => !r.neverChecked);
          const working = known.filter((r) => r.status === "OK").length;
          const isOpen = open[provider] ?? false;

          return (
            <div key={provider} className="rounded-lg border">
              <button
                type="button"
                onClick={() => setOpen((prev) => ({ ...prev, [provider]: !isOpen }))}
                className="flex w-full items-center justify-between gap-2 p-3 text-sm hover:bg-muted/40"
                aria-expanded={isOpen}
              >
                <span className="font-medium">{PROVIDER_LABELS[provider]}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {known.length === 0
                    ? `${group.length} model${group.length === 1 ? "" : "s"} — not checked yet`
                    : `${working} of ${group.length} working`}
                  <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} />
                </span>
              </button>

              {isOpen && (
                <div className="space-y-2 border-t p-3">
                  {group.map((row) => {
                    const fresh = freshByKey.get(`${row.provider}:${row.model}`);
                    const limitNote = [
                      fresh?.remainingRequests
                        ? `${fresh.remainingRequests}${fresh.limitRequests ? ` / ${fresh.limitRequests}` : ""} requests left`
                        : null,
                      fresh?.remainingTokens
                        ? `${fresh.remainingTokens}${fresh.limitTokens ? ` / ${fresh.limitTokens}` : ""} tokens left`
                        : null,
                      fresh?.resetsIn ? `resets in ${fresh.resetsIn}` : null,
                      fresh?.resetAt ? `(at ${new Date(fresh.resetAt).toLocaleString()})` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");

                    return (
                      <div key={`${row.provider}:${row.model}`} className="rounded-lg border p-3 text-sm">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <span className="font-medium">
                            {modelLabel(row.provider, row.model)}
                            {row.selected === false && (
                              <span className="ml-2 rounded-md border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                                not selected
                              </span>
                            )}
                          </span>
                          {row.neverChecked ? (
                            <span className="text-muted-foreground">
                              <span className="mr-1.5 inline-block size-2 rounded-full bg-muted-foreground/40" />
                              Not checked yet
                            </span>
                          ) : row.status === "OK" ? (
                            <span className="text-muted-foreground">
                              <span className="mr-1.5 inline-block size-2 rounded-full bg-emerald-500" />
                              Working
                            </span>
                          ) : (
                            <span className="text-destructive">
                              <span className="mr-1.5 inline-block size-2 rounded-full bg-destructive" />
                              {fresh?.detail ??
                                `Blocked${row.blockedSince ? ` (since ${formatSince(row.blockedSince)})` : ""}${
                                  row.lastError ? ` — ${row.lastError}` : ""
                                }`}
                            </span>
                          )}
                        </div>
                        {limitNote && <p className="mt-1 text-xs text-muted-foreground">{limitNote}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
