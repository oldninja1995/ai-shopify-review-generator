"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getJson, postJson } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type CheckStatus = "FAIL" | "WARN" | "OK" | "INFO" | "UNKNOWN";
type FixAction = "clear-cooldowns" | "retry-failed-generation";

type DiagnosticCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: { action: FixAction; label: string };
};

type DiagnosticsResponse = { checkedAt: string; checks: DiagnosticCheck[] };

/** Zero-chroma everywhere except the two states that mean something is wrong — the rest of this
 * dashboard is deliberately monochrome, so colour here reads as signal rather than decoration. */
const DOT: Record<CheckStatus, string> = {
  FAIL: "bg-destructive",
  WARN: "bg-amber-500",
  OK: "bg-emerald-500",
  INFO: "bg-muted-foreground/40",
  UNKNOWN: "bg-muted-foreground/40",
};

const LABEL: Record<CheckStatus, string> = {
  FAIL: "Problem",
  WARN: "Needs attention",
  OK: "OK",
  INFO: "Info",
  UNKNOWN: "Unknown",
};

export function DiagnosticsPanel({ initial }: { initial: DiagnosticsResponse | null }) {
  const [data, setData] = useState<DiagnosticsResponse | null>(initial);
  // Starts true because the mount effect below fetches immediately — the button is never the first
  // thing that runs a check.
  const [loading, setLoading] = useState(true);
  const [fixing, setFixing] = useState<FixAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Reported rather than swallowed: a diagnostics page that silently shows stale results is the
   * exact failure mode it exists to catch. */
  const apply = useCallback((result: Awaited<ReturnType<typeof getJson<DiagnosticsResponse>>>) => {
    if (result.success) {
      setData(result.data);
      setError(null);
    } else {
      setError(result.error.message);
    }
  }, []);

  const run = useCallback(async () => {
    setLoading(true);
    const result = await getJson<DiagnosticsResponse>("/api/diagnostics");
    setLoading(false);
    apply(result);
  }, [apply]);

  // Checked on mount so the page never shows figures from an earlier visit, then left alone — this
  // is a page you come to deliberately, not a live monitor. Inlined rather than calling run() so
  // no state is set synchronously during the effect body.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await getJson<DiagnosticsResponse>("/api/diagnostics");
      if (cancelled) return;
      setLoading(false);
      apply(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  async function applyFix(action: FixAction) {
    setFixing(action);
    const result = await postJson<{ message: string }>("/api/diagnostics", { action });
    setFixing(null);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success(result.data.message);
    void run();
  }

  const problems = data?.checks.filter((c) => c.status === "FAIL" || c.status === "WARN").length ?? 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle className="text-base">System check</CardTitle>
            <CardDescription>
              {data
                ? problems === 0
                  ? "Everything needed to generate reviews is working."
                  : `${problems} thing${problems === 1 ? "" : "s"} need attention — most severe first.`
                : "Checking..."}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" disabled={loading} onClick={run}>
            {loading ? "Checking..." : "Re-check"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            Could not run diagnostics: {error}
          </div>
        )}

        {data?.checks.map((check) => (
          <div key={check.id} className="rounded-lg border p-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-medium">{check.label}</span>
              <span className="flex items-center text-xs text-muted-foreground">
                <span className={cn("mr-1.5 inline-block size-2 rounded-full", DOT[check.status])} />
                {LABEL[check.status]}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{check.detail}</p>
            {check.fix && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={fixing !== null}
                onClick={() => applyFix(check.fix!.action)}
              >
                {fixing === check.fix.action ? "Working..." : check.fix.label}
              </Button>
            )}
          </div>
        ))}

        {data && data.checks.length === 0 && (
          <p className="text-sm text-muted-foreground">No checks ran.</p>
        )}

        {data && (
          <p className="pt-1 text-xs text-muted-foreground">
            Last checked {new Date(data.checkedAt).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
