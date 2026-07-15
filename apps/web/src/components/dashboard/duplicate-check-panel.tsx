"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { DuplicateCheckMode, DuplicateCheckScope } from "@ai-shopify/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DuplicateFlagsDialog } from "@/components/dashboard/duplicate-flags-dialog";
import { getJson, postJson } from "@/lib/api-client";

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
  PENDING: "outline",
  RUNNING: "secondary",
  AWAITING_CONFIRMATION: "outline",
  COMPLETED: "secondary",
  DISMISSED: "outline",
  FAILED: "destructive",
};

export type DuplicateCheckJobRow = {
  id: string;
  scope: string;
  checkMode: string;
  status: string;
  totalCount: number;
  scannedCount: number;
  totalToDelete: number;
  deletedCount: number;
  contentDuplicatesRemoved: number;
  reviewerDuplicatesRemoved: number;
  createdAt: string;
};

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return "under a minute";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** Estimates remaining time from this job's own observed scan rate (elapsed time / reviews
 * scanned so far) — AI-mode jobs vary hugely in speed depending on model latency/rate limits, so
 * a static estimate would be meaningless. Only meaningful once totalCount/scannedCount are
 * actually populated (both are 0 until the worker's first progress update). */
function estimateRemaining(job: DuplicateCheckJobRow): string | null {
  if (job.status !== "RUNNING") return null;
  if (job.totalCount <= 0 || job.scannedCount <= 0) return null;
  const remaining = job.totalCount - job.scannedCount;
  if (remaining <= 0) return null;

  const elapsedMs = Date.now() - new Date(job.createdAt).getTime();
  const msPerReview = elapsedMs / job.scannedCount;
  return `~${formatDuration(remaining * msPerReview)} remaining`;
}

export function DuplicateCheckPanel({ jobs: initialJobs }: { jobs: DuplicateCheckJobRow[] }) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [prevInitialJobs, setPrevInitialJobs] = useState(initialJobs);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<DuplicateCheckScope>("ALL");
  const [limit, setLimit] = useState(200);
  const [checkMode, setCheckMode] = useState<DuplicateCheckMode>("EXACT");
  const [starting, setStarting] = useState(false);
  const [reviewingJobId, setReviewingJobId] = useState<string | null>(null);

  // Adjusting state during render (React's documented pattern) rather than in an effect, to avoid
  // an extra render pass whenever the server re-renders this page with fresh job rows.
  if (initialJobs !== prevInitialJobs) {
    setPrevInitialJobs(initialJobs);
    setJobs(initialJobs);
  }

  const hasActiveJob = jobs.some((job) => job.status === "PENDING" || job.status === "RUNNING");

  // Polls a lightweight status-only endpoint rather than router.refresh(), which would re-run
  // every query on the whole hosting page every 2s for as long as a job is active.
  useEffect(() => {
    if (!hasActiveJob) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      const result = await getJson<{ jobs: DuplicateCheckJobRow[] }>("/api/reviews/check-duplicates");
      if (!cancelled && result.success) setJobs(result.data.jobs);
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hasActiveJob]);

  async function startCheck() {
    setStarting(true);
    const result = await postJson<{ jobId: string }>("/api/reviews/check-duplicates", {
      scope,
      limit: scope === "LIMIT" ? limit : undefined,
      checkMode,
    });
    setStarting(false);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Duplicate check started — see progress below");
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Check duplicates
        </Button>
        {jobs.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => router.refresh()}>
            Refresh
          </Button>
        )}
      </div>

      {jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((job) => {
            const isAiMode = job.checkMode === "AI";
            const isQueuedBehindAnother =
              job.status === "PENDING" && jobs.some((j) => j.id !== job.id && j.status === "RUNNING");
            const eta = estimateRemaining(job);
            const denominator = job.totalToDelete > 0 ? job.totalToDelete : job.scannedCount;
            const numerator = job.totalToDelete > 0 ? job.deletedCount : job.status === "COMPLETED" ? 1 : 0;
            const percent =
              job.status === "COMPLETED" || job.status === "AWAITING_CONFIRMATION" || job.status === "DISMISSED"
                ? 100
                : denominator > 0
                  ? Math.round((numerator / denominator) * 100)
                  : job.status === "RUNNING"
                    ? 5
                    : 0;
            return (
              <div key={job.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {job.scope === "LIMIT" ? "Recent reviews" : "All reviews"}
                    {isAiMode ? " (AI)" : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANT[job.status] ?? "outline"}>{job.status}</Badge>
                    {job.status === "AWAITING_CONFIRMATION" && (
                      <Button variant="ghost" size="xs" onClick={() => setReviewingJobId(job.id)}>
                        Review
                      </Button>
                    )}
                  </div>
                </div>
                <Progress value={percent} className="mt-2" />
                <p className="mt-1 text-xs text-muted-foreground">
                  {job.status === "PENDING" &&
                    (isQueuedBehindAnother
                      ? "Queued — waiting for another check to finish first..."
                      : "Waiting to start...")}
                  {job.status === "RUNNING" &&
                    (isAiMode
                      ? `Scanning: ${job.totalToDelete} likely duplicate${job.totalToDelete === 1 ? "" : "s"} found so far (scanned ${job.scannedCount}${job.totalCount > 0 ? ` / ${job.totalCount}` : ""})${eta ? ` — ${eta}` : ""}`
                      : job.totalToDelete > 0
                        ? `Removing duplicates: ${job.deletedCount} / ${job.totalToDelete}`
                        : `Scanned ${job.scannedCount} reviews...`)}
                  {job.status === "AWAITING_CONFIRMATION" &&
                    (job.totalToDelete > 0
                      ? `${job.totalToDelete} likely duplicate${job.totalToDelete === 1 ? "" : "s"} flagged — nothing deleted yet, click Review to confirm`
                      : "No duplicates found")}
                  {job.status === "DISMISSED" && "Dismissed — nothing was deleted"}
                  {job.status === "COMPLETED" &&
                    (job.deletedCount > 0
                      ? `Removed ${job.deletedCount} duplicate${job.deletedCount === 1 ? "" : "s"} — ${job.contentDuplicatesRemoved} by ${isAiMode ? "AI-judged" : "repeated"} content, ${job.reviewerDuplicatesRemoved} by reviewer reused across products (scanned ${job.scannedCount})`
                      : `No duplicates found (scanned ${job.scannedCount})`)}
                  {job.status === "FAILED" && "Check failed"}
                  {" — "}
                  {new Date(job.createdAt).toLocaleString()}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Check for duplicate reviews</DialogTitle>
            <DialogDescription>
              {checkMode === "EXACT"
                ? "Runs in the background — finds reviews with repeated content or the same reviewer reused across more than one product, and deletes the duplicates immediately (keeping the earliest one)."
                : "Uses your configured AI models to judge near-duplicate content (catches paraphrases exact matching misses) plus the same reviewer-reuse check. Flags likely duplicates for you to review — nothing is deleted until you confirm."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Detection method</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={checkMode === "EXACT" ? "default" : "outline"}
                  onClick={() => setCheckMode("EXACT")}
                >
                  Exact match
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={checkMode === "AI" ? "default" : "outline"}
                  onClick={() => setCheckMode("AI")}
                >
                  AI-powered (review before delete)
                </Button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={scope === "ALL" ? "default" : "outline"}
                onClick={() => setScope("ALL")}
              >
                All reviews
              </Button>
              <Button
                type="button"
                size="sm"
                variant={scope === "LIMIT" ? "default" : "outline"}
                onClick={() => setScope("LIMIT")}
              >
                Up to a number
              </Button>
            </div>
            {scope === "LIMIT" && (
              <Input
                type="number"
                min={1}
                max={20000}
                value={limit}
                onChange={(e) => setLimit(e.target.valueAsNumber || 1)}
                placeholder="How many most-recent reviews to check"
              />
            )}
          </div>
          <DialogFooter>
            <Button onClick={startCheck} disabled={starting}>
              {starting ? "Starting..." : "Start check"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DuplicateFlagsDialog jobId={reviewingJobId} onOpenChange={(open) => !open && setReviewingJobId(null)} />
    </div>
  );
}
