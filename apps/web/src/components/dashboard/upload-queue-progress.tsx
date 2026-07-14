"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Progress } from "@/components/ui/progress";

export type UploadQueueSummary = {
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  processing: number;
};

/** Aggregate progress across every UploadJob for the store — there's no single "batch" entity
 * for uploads (unlike BulkGenerationJob), so this is computed live from job status counts rather
 * than tracked on one row. Auto-polls while anything is still pending/processing, same pattern as
 * DuplicateCheckPanel, since this is a server-rendered page with no other way to reflect
 * background progress. */
export function UploadQueueProgress({ summary }: { summary: UploadQueueSummary }) {
  const router = useRouter();
  const inFlight = summary.pending + summary.processing;
  const processed = summary.succeeded + summary.failed;
  const percent = summary.total > 0 ? Math.round((processed / summary.total) * 100) : 0;

  useEffect(() => {
    if (inFlight === 0) return;
    const interval = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(interval);
  }, [inFlight, router]);

  if (summary.total === 0) return null;

  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {inFlight > 0 ? `Uploading — ${processed} / ${summary.total}` : `${processed} / ${summary.total} processed`}
        </span>
        <span className="text-xs text-muted-foreground">
          {summary.succeeded} succeeded
          {summary.failed > 0 ? `, ${summary.failed} failed` : ""}
          {inFlight > 0 ? `, ${inFlight} in progress` : ""}
        </span>
      </div>
      <Progress value={percent} />
    </div>
  );
}
