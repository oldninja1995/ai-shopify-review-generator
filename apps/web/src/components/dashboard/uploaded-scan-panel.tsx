"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getJson, postJson } from "@/lib/api-client";

type ScanRow = {
  id: string;
  provider: string;
  status: string;
  scannedCount: number;
  flaggedCount: number;
  deletedCount: number;
  errorMessage: string | null;
  updatedAt?: string;
  createdAt: string;
};

type FlagRow = {
  id: string;
  externalReviewId: string;
  productTitle: string;
  reviewerName: string;
  reason: "CONTENT" | "REVIEWER";
  contentPreview: string;
  reviewCreatedAt: string | null;
};

/** A finished scan stays listed so its result is readable, which means an old failure can sit there
 * looking current. An explicit age makes it obvious at a glance which one you are looking at. */
function relativeAge(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
  PENDING: "outline",
  RUNNING: "secondary",
  AWAITING_CONFIRMATION: "outline",
  COMPLETED: "secondary",
  DISMISSED: "outline",
  FAILED: "destructive",
  CANCELLED: "destructive",
};

/** Duplicate detection over reviews already live on the provider.
 *
 * The existing duplicate checker only sees locally-stored reviews, and those are removed once
 * uploaded — so nothing could tell you what shoppers are actually looking at. This scans the
 * provider's own API and always stops for confirmation: these are published reviews and deleting
 * them is irreversible. */
export function UploadedScanPanel({ initialScans }: { initialScans: ScanRow[] }) {
  const router = useRouter();
  const [scans, setScans] = useState(initialScans);
  const [starting, setStarting] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [flags, setFlags] = useState<FlagRow[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Deliberately not just "is any scan PENDING/RUNNING": a scan dropped from the queue by a worker
  // restart keeps that status forever, and treating it as active disabled this button permanently.
  // A scan that hasn't moved in 10 minutes is presumed dead; starting a new one retires it.
  const hasActive = scans.some(
    (s) =>
      (s.status === "PENDING" || s.status === "RUNNING") &&
      Date.now() - new Date(s.updatedAt ?? s.createdAt).getTime() < 10 * 60 * 1000,
  );

  useEffect(() => {
    if (!hasActive) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      const result = await getJson<{ scans: ScanRow[] }>("/api/reviews/uploaded-scan");
      if (!cancelled && result.success) setScans(result.data.scans);
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hasActive]);

  async function startScan() {
    setStarting(true);
    const result = await postJson<{ scanId: string }>("/api/reviews/uploaded-scan", {});
    setStarting(false);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Scanning published reviews — this pages the provider's API");
    router.refresh();
  }

  async function openFlags(scanId: string) {
    setReviewingId(scanId);
    setFlags(null);
    const result = await getJson<{ flags: FlagRow[] }>(`/api/reviews/uploaded-scan/${scanId}`);
    if (result.success) setFlags(result.data.flags);
    else toast.error(result.error.message);
  }

  async function clearScan(scanId: string) {
    const response = await fetch(`/api/reviews/uploaded-scan/${scanId}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error("Could not clear that scan");
      return;
    }
    setScans((prev) => prev.filter((s) => s.id !== scanId));
    router.refresh();
  }

  async function act(scanId: string, action: "confirm" | "dismiss" | "cancel") {
    setConfirming(true);
    const result = await postJson(`/api/reviews/uploaded-scan/${scanId}`, { action });
    setConfirming(false);
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success(
      action === "confirm" ? "Deleting flagged reviews" : action === "dismiss" ? "Scan dismissed" : "Scan cancelled",
    );
    setReviewingId(null);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={startScan} disabled={starting || hasActive}>
          {starting ? "Starting..." : "Scan uploaded reviews"}
        </Button>
      </div>

      {scans.map((scan) => {
        const isRunning = scan.status === "PENDING" || scan.status === "RUNNING";
        const isTerminal = scan.status === "COMPLETED" || scan.status === "DISMISSED";
        return (
        <div key={scan.id} className="rounded-lg border p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{scan.provider.replace(/_/g, " ")}</span>
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_VARIANT[scan.status] ?? "outline"}>{scan.status}</Badge>
              {scan.status === "AWAITING_CONFIRMATION" && (
                <Button variant="ghost" size="xs" onClick={() => openFlags(scan.id)}>
                  Review
                </Button>
              )}
              {isRunning && (
                <Button variant="ghost" size="xs" onClick={() => act(scan.id, "cancel")}>
                  Cancel
                </Button>
              )}
              {!isRunning && scan.status !== "AWAITING_CONFIRMATION" && (
                <Button variant="ghost" size="xs" onClick={() => clearScan(scan.id)} aria-label="Clear">
                  <X />
                </Button>
              )}
            </div>
          </div>
          {/* Judge.me's API reports no total, so genuine percentage progress is impossible — a
              moving count is the honest signal. An indeterminate bar while running says "working"
              without inventing a completion figure. */}
          {isRunning ? (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
            </div>
          ) : (
            <Progress value={isTerminal || scan.status === "AWAITING_CONFIRMATION" ? 100 : 0} className="mt-2" />
          )}

          <p className="mt-1 text-xs text-muted-foreground">
            {scan.status === "PENDING" && "Waiting to start..."}
            {scan.status === "RUNNING" &&
              (scan.scannedCount > 0
                ? `Scanned ${scan.scannedCount.toLocaleString()} published reviews so far...`
                : "Fetching the first page from the provider...")}
            {scan.status === "AWAITING_CONFIRMATION" &&
              `${scan.flaggedCount.toLocaleString()} duplicate${scan.flaggedCount === 1 ? "" : "s"} found across ${scan.scannedCount.toLocaleString()} published reviews — nothing deleted yet`}
            {scan.status === "COMPLETED" &&
              (scan.deletedCount > 0
                ? `Deleted ${scan.deletedCount.toLocaleString()} duplicate${scan.deletedCount === 1 ? "" : "s"} from the storefront (scanned ${scan.scannedCount.toLocaleString()})`
                : scan.flaggedCount > 0
                  ? `${scan.flaggedCount.toLocaleString()} flagged, none deleted (scanned ${scan.scannedCount.toLocaleString()})`
                  : `No duplicates found — scanned ${scan.scannedCount.toLocaleString()} published reviews`)}
            {scan.status === "DISMISSED" &&
              `Dismissed — ${scan.flaggedCount.toLocaleString()} flagged, nothing deleted`}
            {scan.status === "CANCELLED" && `Cancelled after ${scan.scannedCount.toLocaleString()} reviews`}
            {scan.status === "FAILED" && (scan.errorMessage ?? "Scan failed")}
            {" — "}
            <span className={isRunning ? "" : "font-medium"}>{relativeAge(scan.createdAt)}</span>
            {" · "}
            {new Date(scan.createdAt).toLocaleString()}
          </p>
        </div>
        );
      })}

      <Dialog open={reviewingId !== null} onOpenChange={(open) => !open && setReviewingId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Duplicate published reviews</DialogTitle>
            <DialogDescription>
              Same reviewer name, or same review text, appearing more than once on one product. The
              earliest review of each set is kept — only the later copies are listed here. Deleting
              removes them from your storefront and cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {flags === null && <p className="text-sm text-muted-foreground">Loading...</p>}
            {flags?.length === 0 && <p className="text-sm text-muted-foreground">No duplicates.</p>}
            {flags?.map((flag) => (
              <div key={flag.id} className="rounded-lg border p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{flag.productTitle}</span>
                  <Badge variant="outline">
                    {flag.reason === "CONTENT" ? "same text" : "same reviewer"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {flag.reviewerName}
                  {flag.reviewCreatedAt ? ` · ${new Date(flag.reviewCreatedAt).toLocaleDateString()}` : ""}
                </p>
                <p className="mt-1 line-clamp-2 text-xs">{flag.contentPreview}</p>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={confirming} onClick={() => reviewingId && act(reviewingId, "dismiss")}>
              Keep all
            </Button>
            <Button
              variant="destructive"
              disabled={confirming || !flags?.length}
              onClick={() => reviewingId && act(reviewingId, "confirm")}
            >
              {confirming ? "Working..." : `Delete ${flags?.length ?? 0} from storefront`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
