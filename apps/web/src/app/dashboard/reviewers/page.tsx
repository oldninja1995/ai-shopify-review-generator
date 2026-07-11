import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@ai-shopify/db";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { ReviewersTable, type ReviewerRow } from "@/components/dashboard/reviewers-table";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

export default async function ReviewersPage({
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
        <h1 className="text-2xl font-semibold tracking-tight">Reviewer Database</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No store connected</CardTitle>
            <CardDescription>
              Connect a Shopify store from the Products page to start generating reviewer profiles.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const [totalCount, maleCount, verifiedCount, topOccupations, topCountries, rows] = await Promise.all([
    prisma.reviewerProfile.count({ where: { storeId: store.id } }),
    prisma.reviewerProfile.count({ where: { storeId: store.id, gender: "MALE" } }),
    prisma.reviewerProfile.count({ where: { storeId: store.id, isVerifiedPurchase: true } }),
    prisma.reviewerProfile.groupBy({
      by: ["occupation"],
      where: { storeId: store.id },
      _count: true,
      orderBy: { _count: { occupation: "desc" } },
      take: 5,
    }),
    prisma.reviewerProfile.groupBy({
      by: ["country"],
      where: { storeId: store.id },
      _count: true,
      orderBy: { _count: { country: "desc" } },
      take: 5,
    }),
    prisma.reviewerProfile.findMany({
      where: { storeId: store.id },
      include: { _count: { select: { reviews: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const femaleCount = totalCount - maleCount;

  const reviewers: ReviewerRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    gender: r.gender,
    country: r.country,
    ageGroup: r.ageGroup,
    occupation: r.occupation,
    isVerifiedPurchase: r.isVerifiedPurchase,
    reviewCount: r._count.reviews,
    createdAt: r.createdAt.toISOString(),
  }));

  function percent(n: number): string {
    return totalCount > 0 ? `${Math.round((n / totalCount) * 100)}%` : "—";
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Reviewer Database</h1>

      {totalCount === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No reviewer profiles yet</CardTitle>
            <CardDescription>
              Reviewer profiles are created automatically the first time you generate reviews for a
              product.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-2xl font-semibold">{totalCount}</p>
                <p className="text-sm text-muted-foreground">Total reviewers</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-2xl font-semibold">
                  {percent(maleCount)} / {percent(femaleCount)}
                </p>
                <p className="text-sm text-muted-foreground">Male / Female</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-2xl font-semibold">{percent(verifiedCount)}</p>
                <p className="text-sm text-muted-foreground">Verified purchase</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-sm">
                <p className="font-medium">Top occupations</p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {topOccupations.map((o) => (
                    <li key={o.occupation}>
                      {o.occupation} ({o._count})
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          {topCountries.length > 1 && (
            <Card>
              <CardContent className="pt-6 text-sm">
                <p className="font-medium">Top countries</p>
                <p className="mt-1 text-muted-foreground">
                  {topCountries.map((c) => `${c.country} (${c._count})`).join(" · ")}
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-0">
              <ReviewersTable reviewers={reviewers} />
            </CardContent>
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
                <span>
                  Page {currentPage} of {totalPages} — {totalCount} reviewers
                </span>
                <div className="flex gap-2">
                  <Link
                    href={`/dashboard/reviewers?page=${currentPage - 1}`}
                    aria-disabled={currentPage <= 1}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      currentPage <= 1 && "pointer-events-none opacity-50",
                    )}
                  >
                    Previous
                  </Link>
                  <Link
                    href={`/dashboard/reviewers?page=${currentPage + 1}`}
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
        </>
      )}
    </div>
  );
}
