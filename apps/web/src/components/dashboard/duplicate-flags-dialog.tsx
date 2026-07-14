"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getJson, postJson } from "@/lib/api-client";

type Flag = {
  id: string;
  reason: "CONTENT" | "REVIEWER";
  productTitle: string;
  reviewerName: string;
  title: string;
  content: string;
  rating: number;
};

type FlagsResponse = {
  job: { id: string; status: string; totalToDelete: number };
  totalCount: number;
  totalPages: number;
  page: number;
  flags: Flag[];
};

/** Shows the reviews an AI-mode duplicate check flagged, so the user can confirm or dismiss the
 * deletion instead of it happening automatically — AI judgment on "is this a duplicate" is less
 * certain than exact-hash matching, so this is the safety step before anything gets removed. */
export function DuplicateFlagsDialog({
  jobId,
  onOpenChange,
}: {
  jobId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<FlagsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    if (!jobId) {
      setData(null);
      setPage(1);
      return;
    }
    setLoading(true);
    getJson<FlagsResponse>(`/api/reviews/duplicate-check/${jobId}/flags?page=${page}`).then((result) => {
      setLoading(false);
      if (result.success) setData(result.data);
      else toast.error(result.error.message);
    });
  }, [jobId, page]);

  async function confirmDelete() {
    if (!jobId) return;
    setActing(true);
    const result = await postJson<{ deletedCount: number }>(`/api/reviews/duplicate-check/${jobId}/confirm`, {});
    setActing(false);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`Deleted ${result.data.deletedCount} flagged review${result.data.deletedCount === 1 ? "" : "s"}`);
    onOpenChange(false);
    router.refresh();
  }

  async function dismiss() {
    if (!jobId) return;
    setActing(true);
    const result = await postJson(`/api/reviews/duplicate-check/${jobId}/dismiss`, {});
    setActing(false);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Dismissed — nothing was deleted");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={jobId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review flagged duplicates</DialogTitle>
          <DialogDescription>
            {data ? `${data.totalCount} review${data.totalCount === 1 ? "" : "s"} flagged` : "Loading..."} —
            nothing has been deleted yet. Review below, then delete or dismiss.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {!loading && data?.flags.length === 0 && (
            <p className="text-sm text-muted-foreground">No flags on this page.</p>
          )}
          {data?.flags.map((flag) => (
            <div key={flag.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{flag.productTitle}</span>
                <Badge variant={flag.reason === "CONTENT" ? "secondary" : "outline"}>
                  {flag.reason === "CONTENT" ? "Duplicate content" : "Reviewer reused"}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {flag.reviewerName} — {flag.rating}★ — {flag.title}
              </p>
              <p className="mt-1 line-clamp-2 text-xs">{flag.content}</p>
            </div>
          ))}
        </div>

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {data.page} of {data.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), page <= 1 && "opacity-50")}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  page >= data.totalPages && "opacity-50",
                )}
              >
                Next
              </button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={acting} onClick={dismiss}>
            Dismiss (keep all)
          </Button>
          <Button variant="destructive" disabled={acting || !data?.totalCount} onClick={confirmDelete}>
            {acting ? "Working..." : `Delete ${data?.totalCount ?? 0} flagged`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
