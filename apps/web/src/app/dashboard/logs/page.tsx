import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma, type SystemLogLevel } from "@ai-shopify/db";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { LogsLevelFilter } from "@/components/dashboard/logs-level-filter";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const LOG_LEVELS: SystemLogLevel[] = ["INFO", "WARN", "ERROR"];

const LEVEL_VARIANT: Record<SystemLogLevel, "secondary" | "outline" | "destructive"> = {
  INFO: "outline",
  WARN: "secondary",
  ERROR: "destructive",
};

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; level?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { page: pageParam, level } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const levelFilter = LOG_LEVELS.find((l) => l === level);

  const where = { userId: user.id, ...(levelFilter ? { level: levelFilter } : {}) };

  const [totalCount, logs] = await Promise.all([
    prisma.systemLog.count({ where }),
    prisma.systemLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  function pageHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (level) params.set("level", level);
    params.set("page", String(targetPage));
    return `/dashboard/logs?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>

      <Card>
        <div className="flex items-center justify-between border-b p-3">
          <LogsLevelFilter />
        </div>
        <CardContent className="space-y-2 p-4">
          {logs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No log entries yet.</p>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                <Badge variant={LEVEL_VARIANT[log.level]}>{log.level}</Badge>
                <div className="flex-1">
                  <p>{log.message}</p>
                  <p className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</p>
                </div>
              </div>
            ))
          )}
        </CardContent>
        {totalCount > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
            <span>
              Page {currentPage} of {totalPages} — {totalCount} log entries
            </span>
            <div className="flex gap-2">
              <Link
                href={pageHref(currentPage - 1)}
                aria-disabled={currentPage <= 1}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  currentPage <= 1 && "pointer-events-none opacity-50",
                )}
              >
                Previous
              </Link>
              <Link
                href={pageHref(currentPage + 1)}
                aria-disabled={currentPage >= totalPages}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  currentPage >= totalPages && "pointer-events-none opacity-50",
                )}
              >
                Next
              </Link>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
