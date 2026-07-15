"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getJson, postJson } from "@/lib/api-client";

export type UploadQueueSummary = {
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  processing: number;
  /** How many succeeded in the last `recentWindowMs` — a live throughput sample, since uploads
   * are a continuous stream (new UploadJob rows keep arriving) with no single "batch start" time
   * to measure elapsed-since, unlike BulkGenerationJob/DuplicateCheckJob. */
  recentSucceededCount: number;
  recentWindowMs: number;
};

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return "under a minute";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function estimateRemaining(summary: UploadQueueSummary, inFlight: number): string | null {
  if (inFlight === 0 || summary.recentSucceededCount === 0) return null;
  const perUploadMs = summary.recentWindowMs / summary.recentSucceededCount;
  return `~${formatDuration(inFlight * perUploadMs)} remaining`;
}

/** Aggregate progress across every UploadJob for the store — there's no single "batch" entity
 * for uploads (unlike BulkGenerationJob), so this is computed live from job status counts rather
 * than tracked on one row. Auto-polls while anything is still pending/processing, same pattern as
 * DuplicateCheckPanel, since this is a server-rendered page with no other way to reflect
 * background progress. */
export function UploadQueueProgress({ summary: initialSummary }: { summary: UploadQueueSummary }) {
  const router = useRouter();
  const [summary, setSummary] = useState(initialSummary);
  const [prevInitialSummary, setPrevInitialSummary] = useState(initialSummary);
  const [cancelling, setCancelling] = useState(false);

  // Adjusting state during render (React's documented pattern) rather than in an effect, to avoid
  // an extra render pass whenever the server re-renders this page with a fresh summary.
  if (initialSummary !== prevInitialSummary) {
    setPrevInitialSummary(initialSummary);
    setSummary(initialSummary);
  }

  const inFlight = summary.pending + summary.processing;
  const processed = summary.succeeded + summary.failed;
  const percent = summary.total > 0 ? Math.round((processed / summary.total) * 100) : 0;
  const eta = estimateRemaining(summary, inFlight);

  // Polls a lightweight status-only endpoint rather than router.refresh(), which would re-run
  // every query on the whole hosting page every 2s for as long as anything is in flight.
  useEffect(() => {
    if (inFlight === 0) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      const result = await getJson<{ summary: UploadQueueSummary }>("/api/upload-queue/summary");
      if (!cancelled && result.success) setSummary(result.data.summary);
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [inFlight]);

  async function cancelRemaining() {
    setCancelling(true);
    const result = await postJson<{ cancelled: number }>("/api/upload-queue/cancel", {});
    setCancelling(false);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`Cancelled ${result.data.cancelled} pending upload${result.data.cancelled === 1 ? "" : "s"}`);
    router.refresh();
  }

  if (summary.total === 0) return null;

  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {inFlight > 0 ? `Uploading — ${processed} / ${summary.total}` : `${processed} / ${summary.total} processed`}
          {eta ? ` — ${eta}` : ""}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {summary.succeeded} succeeded
            {summary.failed > 0 ? `, ${summary.failed} failed` : ""}
            {inFlight > 0 ? `, ${inFlight} in progress` : ""}
          </span>
          {summary.pending > 0 && (
            <Button variant="ghost" size="xs" disabled={cancelling} onClick={cancelRemaining}>
              {cancelling ? "Cancelling..." : "Cancel remaining"}
            </Button>
          )}
        </div>
      </div>
      <Progress value={percent} />
    </div>
  );
}
