import Link from "next/link";
import { Badge } from "@/components/ui/badge";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  QUEUED: "Queued",
  UPLOADED: "Uploaded",
  FAILED: "Failed",
  DUPLICATE_REGENERATED: "Duplicate (regenerated)",
};

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  APPROVED: "secondary",
  QUEUED: "secondary",
  UPLOADED: "secondary",
  FAILED: "destructive",
  DUPLICATE_REGENERATED: "destructive",
};

/**
 * A single flat hue for every bar — the category identity rides on the Badge + label to its
 * left, not on a per-status hue. This app's theme is intentionally grayscale (see globals.css:
 * every token is zero-chroma except --destructive), so a saturated categorical palette would be
 * inconsistent with the rest of the dashboard rather than an improvement.
 */
export function StatusBreakdown({ counts }: { counts: Record<string, number> }) {
  const statuses = Object.keys(STATUS_LABELS);
  const max = Math.max(1, ...statuses.map((s) => counts[s] ?? 0));

  return (
    <div className="space-y-2">
      {statuses.map((status) => {
        const count = counts[status] ?? 0;
        const percent = (count / max) * 100;
        return (
          <div key={status} className="flex items-center gap-3 text-sm">
            <Badge variant={STATUS_VARIANT[status]} className="w-24 shrink-0 justify-center">
              {STATUS_LABELS[status]}
            </Badge>
            <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/75"
                style={{ width: `${percent}%` }}
                title={`${STATUS_LABELS[status]}: ${count}`}
              />
            </div>
            <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Ranked bar list, one hue — same job as StatusBreakdown (magnitude by category), just with a
 * variable, sometimes-long category set (product types) instead of a fixed enum. Longest bar is
 * always full-width so relative magnitude reads correctly even when the list is truncated to a
 * top-N slice. */
export function CategoryBreakdown({ entries }: { entries: { label: string; count: number }[] }) {
  const max = Math.max(1, ...entries.map((e) => e.count));

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const percent = (entry.count / max) * 100;
        return (
          <div key={entry.label} className="flex items-center gap-3 text-sm">
            <span className="w-32 shrink-0 truncate text-muted-foreground" title={entry.label}>
              {entry.label}
            </span>
            <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/75"
                style={{ width: `${percent}%` }}
                title={`${entry.label}: ${entry.count}`}
              />
            </div>
            <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
              {entry.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Same ranked-bar-list job as CategoryBreakdown, but each row links to that product's reviews. */
export function TopProducts({
  entries,
}: {
  entries: { id: string; title: string; count: number }[];
}) {
  const max = Math.max(1, ...entries.map((e) => e.count));

  return (
    <div className="space-y-2">
      {entries.map((entry, index) => {
        const percent = (entry.count / max) * 100;
        return (
          <div key={entry.id} className="flex items-center gap-3 text-sm">
            <span className="w-4 shrink-0 tabular-nums text-muted-foreground">{index + 1}.</span>
            <Link
              href={`/dashboard/products?q=${encodeURIComponent(entry.title)}`}
              className="w-40 shrink-0 truncate hover:underline"
              title={entry.title}
            >
              {entry.title}
            </Link>
            <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/75"
                style={{ width: `${percent}%` }}
                title={`${entry.title}: ${entry.count}`}
              />
            </div>
            <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
              {entry.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Single series — one hue throughout, no legend needed (the chart title already says what's plotted). */
export function RatingDistribution({ counts }: { counts: Record<number, number> }) {
  const max = Math.max(1, ...[1, 2, 3, 4, 5].map((r) => counts[r] ?? 0));

  return (
    <div className="flex h-40 items-end gap-3">
      {[1, 2, 3, 4, 5].map((rating) => {
        const count = counts[rating] ?? 0;
        const heightPercent = (count / max) * 100;
        return (
          <div key={rating} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
            <div className="flex h-32 w-full items-end">
              <div
                className="w-full rounded-t-md bg-foreground/75"
                style={{ height: `${Math.max(heightPercent, count > 0 ? 4 : 0)}%` }}
                title={`${rating} star: ${count}`}
              />
            </div>
            <span className="text-xs text-muted-foreground">{rating}★</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Two categories → a legend is mandatory (per the method's ≥2-series rule). Two grayscale steps
 * with a large lightness delta (foreground vs. muted-foreground) plus direct value labels, so
 * identity never depends on color alone.
 */
export function GenderSplit({ male, female }: { male: number; female: number }) {
  const total = Math.max(1, male + female);
  const malePercent = (male / total) * 100;
  const femalePercent = 100 - malePercent;

  return (
    <div className="space-y-2">
      <div className="flex h-3.5 overflow-hidden rounded-full bg-muted">
        {male > 0 && (
          <div
            className="h-full bg-foreground/75"
            style={{ width: `${malePercent}%` }}
            title={`Male: ${male}`}
          />
        )}
        {male > 0 && female > 0 && <div className="h-full w-0.5 bg-muted" />}
        {female > 0 && (
          <div
            className="h-full bg-muted-foreground/60"
            style={{ width: `${femalePercent}%` }}
            title={`Female: ${female}`}
          />
        )}
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-foreground/75" /> Male ({male} ·{" "}
          {Math.round(malePercent)}%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-muted-foreground/60" /> Female ({female} ·{" "}
          {Math.round(femalePercent)}%)
        </span>
      </div>
    </div>
  );
}
