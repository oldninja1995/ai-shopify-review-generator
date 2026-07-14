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
import { postJson } from "@/lib/api-client";

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
  scannedCount: number;
  totalToDelete: number;
  deletedCount: number;
  contentDuplicatesRemoved: number;
  reviewerDuplicatesRemoved: number;
  createdAt: string;
};

export function DuplicateCheckPanel({ jobs }: { jobs: DuplicateCheckJobRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<DuplicateCheckScope>("ALL");
  const [limit, setLimit] = useState(200);
  const [checkMode, setCheckMode] = useState<DuplicateCheckMode>("EXACT");
  const [starting, setStarting] = useState(false);
  const [reviewingJobId, setReviewingJobId] = useState<string | null>(null);

  const hasActiveJob = jobs.some((job) => job.status === "PENDING" || job.status === "RUNNING");

  useEffect(() => {
    if (!hasActiveJob) return;
    const interval = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(interval);
  }, [hasActiveJob, router]);

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
                  {job.status === "PENDING" && "Waiting to start..."}
                  {job.status === "RUNNING" &&
                    (isAiMode
                      ? `Scanning: ${job.totalToDelete} likely duplicate${job.totalToDelete === 1 ? "" : "s"} found so far (scanned ${job.scannedCount})`
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
