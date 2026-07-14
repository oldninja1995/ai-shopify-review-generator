"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { BulkGenerateDialog, type BulkGenerateTarget } from "@/components/dashboard/bulk-generate-dialog";
import { postJson } from "@/lib/api-client";

export type BulkJobRow = {
  id: string;
  scope: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  status: string;
  createdAt: string;
};

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
  PENDING: "outline",
  RUNNING: "secondary",
  COMPLETED: "secondary",
  FAILED: "destructive",
  CANCELLED: "destructive",
};

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return "under a minute";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** Estimates remaining time from this job's own observed throughput so far (elapsed time /
 * processed count) rather than a fixed assumption — AI-heavy stores run far slower than
 * phrase-bank-only ones, so a static estimate would be wrong for most jobs either way. */
function estimateRemaining(job: BulkJobRow): string | null {
  if (job.status !== "RUNNING") return null;
  const processed = job.completedCount + job.failedCount;
  const remaining = job.totalCount - processed;
  if (remaining <= 0) return null;
  if (processed === 0) return "Estimating...";

  const elapsedMs = Date.now() - new Date(job.createdAt).getTime();
  const msPerProduct = elapsedMs / processed;
  return `~${formatDuration(remaining * msPerProduct)} remaining`;
}

export function BulkGenerationPanel({
  collections,
  jobs,
  storeProductCount,
}: {
  collections: { value: string; label: string; productCount: number }[];
  jobs: BulkJobRow[];
  storeProductCount: number;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<BulkGenerateTarget | null>(null);
  const [collectionId, setCollectionId] = useState(collections[0]?.value ?? "");
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const hasActiveJob = jobs.some((job) => job.status === "PENDING" || job.status === "RUNNING");

  // Bulk jobs can run for hours on AI-heavy stores — without this, the panel only ever showed
  // whatever counts were on the page at last load, making a genuinely-progressing job look stuck.
  useEffect(() => {
    if (!hasActiveJob) return;
    const interval = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(interval);
  }, [hasActiveJob, router]);

  async function cancelJob(id: string) {
    setCancellingId(id);
    const result = await postJson<{ cancelledQueuedJobs: number }>(`/api/bulk-generation/${id}/cancel`, {});
    setCancellingId(null);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Bulk job cancelled");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bulk generation</CardTitle>
        <CardDescription>
          Generate reviews across many products at once — the whole store, or a single collection.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setTarget({
                scope: "STORE",
                label: `Entire store (${storeProductCount} product${storeProductCount === 1 ? "" : "s"})`,
                productCount: storeProductCount,
              })
            }
          >
            <Sparkles />
            Generate for entire store
          </Button>

          {collections.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                {collections.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const collection = collections.find((c) => c.value === collectionId);
                  if (!collection) return;
                  setTarget({
                    scope: "COLLECTION",
                    collectionId: collection.value,
                    label: `${collection.label} (${collection.productCount} product${collection.productCount === 1 ? "" : "s"})`,
                    productCount: collection.productCount,
                  });
                }}
              >
                <Sparkles />
                Generate for collection
              </Button>
            </div>
          )}
        </div>

        {jobs.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Recent bulk jobs</p>
              <Button variant="ghost" size="sm" onClick={() => router.refresh()}>
                Refresh
              </Button>
            </div>
            <div className="space-y-2">
              {jobs.map((job) => {
                const processed = job.completedCount + job.failedCount;
                const percent = job.totalCount > 0 ? Math.round((processed / job.totalCount) * 100) : 0;
                const cancellable = job.status === "PENDING" || job.status === "RUNNING";
                const eta = estimateRemaining(job);
                return (
                  <div key={job.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{job.scope}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={STATUS_VARIANT[job.status] ?? "outline"}>{job.status}</Badge>
                        {cancellable && (
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={cancellingId === job.id}
                            onClick={() => cancelJob(job.id)}
                          >
                            {cancellingId === job.id ? "Cancelling..." : "Cancel"}
                          </Button>
                        )}
                      </div>
                    </div>
                    <Progress value={percent} className="mt-2" />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {processed} / {job.totalCount} products
                      {job.failedCount > 0 ? ` (${job.failedCount} failed)` : ""} —{" "}
                      {new Date(job.createdAt).toLocaleString()}
                      {eta ? ` — ${eta}` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>

      <BulkGenerateDialog target={target} onOpenChange={(open) => !open && setTarget(null)} />
    </Card>
  );
}
