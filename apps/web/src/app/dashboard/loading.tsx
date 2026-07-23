import { Skeleton } from "@/components/ui/skeleton";

// Next.js renders this instantly (no data dependency) for every nested /dashboard/* route while
// that page's own Server Component data fetch is in flight — without it, the browser shows
// nothing at all until the full round-trip to the DB completes, which is especially noticeable
// on this app's cross-region network path.
export default function DashboardLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}
