import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma, type Prisma, type ReviewStatus } from "@ai-shopify/db";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import {
  ReviewsManagementTable,
  type ManagedReview,
} from "@/components/dashboard/reviews-management-table";
import { ReviewsStatusFilter } from "@/components/dashboard/reviews-status-filter";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

const REVIEW_STATUSES: ReviewStatus[] = [
  "DRAFT",
  "APPROVED",
  "QUEUED",
  "UPLOADED",
  "FAILED",
  "DUPLICATE_REGENERATED",
];

function toReviewStatus(value: string | undefined): ReviewStatus | undefined {
  return REVIEW_STATUSES.find((s) => s === value);
}

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { page: pageParam, status } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });

  if (!store) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Generated Reviews</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No store connected</CardTitle>
            <CardDescription>
              Connect a Shopify store from the Products page to start generating reviews.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const statusFilter: Prisma.GeneratedReviewWhereInput =
    status === "ALL" ? {} : { status: toReviewStatus(status) ?? { in: ["DRAFT", "APPROVED"] } };

  const where: Prisma.GeneratedReviewWhereInput = { product: { storeId: store.id }, ...statusFilter };

  const [totalCount, rows] = await Promise.all([
    prisma.generatedReview.count({ where }),
    prisma.generatedReview.findMany({
      where,
      include: { product: true, reviewerProfile: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const reviews: ManagedReview[] = rows.map((review) => ({
    id: review.id,
    productTitle: review.product.title,
    reviewerName: review.reviewerProfile.name,
    rating: review.rating,
    status: review.status,
    title: review.title,
    content: review.content,
    createdAt: review.createdAt.toISOString(),
  }));

  function pageHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    params.set("page", String(targetPage));
    return `/dashboard/reviews?${params.toString()}`;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Generated Reviews</h1>

      <Card>
        <div className="flex items-center justify-between border-b p-3">
          <ReviewsStatusFilter />
        </div>
        <CardContent className="p-0">
          {reviews.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No reviews match this filter.
            </p>
          ) : (
            <ReviewsManagementTable reviews={reviews} />
          )}
        </CardContent>
        {totalCount > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
            <span>
              Page {currentPage} of {totalPages} — {totalCount} reviews
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
