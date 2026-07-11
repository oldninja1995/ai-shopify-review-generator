"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { BulkGenerateDialog, type BulkGenerateTarget } from "@/components/dashboard/bulk-generate-dialog";

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
};

export function BulkGenerationPanel({
  collections,
  jobs,
}: {
  collections: { value: string; label: string }[];
  jobs: BulkJobRow[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState<BulkGenerateTarget | null>(null);
  const [collectionId, setCollectionId] = useState(collections[0]?.value ?? "");

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
            onClick={() => setTarget({ scope: "STORE", label: "Entire store" })}
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
                  setTarget({ scope: "COLLECTION", collectionId: collection.value, label: collection.label });
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
                return (
                  <div key={job.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{job.scope}</span>
                      <Badge variant={STATUS_VARIANT[job.status] ?? "outline"}>{job.status}</Badge>
                    </div>
                    <Progress value={percent} className="mt-2" />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {processed} / {job.totalCount} products
                      {job.failedCount > 0 ? ` (${job.failedCount} failed)` : ""} —{" "}
                      {new Date(job.createdAt).toLocaleString()}
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
