import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@ai-shopify/db";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { UploadQueueTable, type UploadQueueRow } from "@/components/dashboard/upload-queue-table";
import { UploadQueueProgress } from "@/components/dashboard/upload-queue-progress";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

export default async function UploadQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });

  if (!store) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Upload Queue</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No store connected</CardTitle>
            <CardDescription>
              Connect a Shopify store from the Products page to start uploading reviews.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const where = { review: { product: { storeId: store.id } } };

  const [totalCount, rows, statusCounts] = await Promise.all([
    prisma.uploadJob.count({ where }),
    prisma.uploadJob.findMany({
      where,
      include: { review: { include: { product: true, reviewerProfile: true } }, providerConfig: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.uploadJob.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);

  const countByStatus = Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all]));
  const uploadSummary = {
    total: totalCount,
    succeeded: countByStatus.SUCCEEDED ?? 0,
    failed: countByStatus.FAILED ?? 0,
    pending: countByStatus.PENDING ?? 0,
    processing: countByStatus.PROCESSING ?? 0,
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const jobs: UploadQueueRow[] = rows.map((job) => ({
    id: job.id,
    productTitle: job.review.product.title,
    reviewerName: job.review.reviewerProfile.name,
    provider: job.providerConfig.provider,
    status: job.status,
    attempts: job.attempts,
    lastError: job.lastError,
    createdAt: job.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Upload Queue</h1>

      <UploadQueueProgress summary={uploadSummary} />

      <Card>
        <CardContent className="p-0">
          {jobs.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No uploads yet — trigger an upload from the Review Generator page.
            </p>
          ) : (
            <UploadQueueTable jobs={jobs} />
          )}
        </CardContent>
        {totalCount > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
            <span>
              Page {currentPage} of {totalPages} — {totalCount} upload jobs
            </span>
            <div className="flex gap-2">
              <Link
                href={`/dashboard/upload-queue?page=${currentPage - 1}`}
                aria-disabled={currentPage <= 1}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  currentPage <= 1 && "pointer-events-none opacity-50",
                )}
              >
                Previous
              </Link>
              <Link
                href={`/dashboard/upload-queue?page=${currentPage + 1}`}
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
