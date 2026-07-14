import { redirect } from "next/navigation";
import { prisma } from "@ai-shopify/db";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  StatusBreakdown,
  RatingDistribution,
  GenderSplit,
  CategoryBreakdown,
  TopProducts,
} from "@/components/dashboard/analytics-charts";

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });

  if (!store) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
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

  const reviewWhere = { product: { storeId: store.id } };

  const [statusGroups, ratingGroups, failedUploadCount, totalReviewers, maleReviewerCount, productReviewCounts] =
    await Promise.all([
      prisma.generatedReview.groupBy({ by: ["status"], where: reviewWhere, _count: true }),
      prisma.generatedReview.groupBy({ by: ["rating"], where: reviewWhere, _count: true }),
      prisma.uploadJob.count({ where: { status: "FAILED", review: reviewWhere } }),
      prisma.reviewerProfile.count({ where: { storeId: store.id } }),
      prisma.reviewerProfile.count({ where: { storeId: store.id, gender: "MALE" } }),
      prisma.product.findMany({
        where: { storeId: store.id },
        select: { id: true, title: true, productType: true, _count: { select: { reviews: true } } },
      }),
    ]);

  const statusCounts = Object.fromEntries(statusGroups.map((g) => [g.status, g._count]));
  const ratingCounts = Object.fromEntries(ratingGroups.map((g) => [g.rating, g._count]));
  const totalGenerated = statusGroups.reduce((sum, g) => sum + g._count, 0);
  const uploadedCount = statusCounts.UPLOADED ?? 0;
  const duplicateCount = statusCounts.DUPLICATE_REGENERATED ?? 0;
  const femaleReviewerCount = totalReviewers - maleReviewerCount;

  const totalProducts = productReviewCounts.length;
  const avgReviewsPerProduct = totalProducts > 0 ? totalGenerated / totalProducts : 0;

  const reviewsByCategory = new Map<string, number>();
  for (const product of productReviewCounts) {
    const category = product.productType.trim() || "Uncategorized";
    reviewsByCategory.set(category, (reviewsByCategory.get(category) ?? 0) + product._count.reviews);
  }
  const topCategories = Array.from(reviewsByCategory.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const topProducts = [...productReviewCounts]
    .sort((a, b) => b._count.reviews - a._count.reviews)
    .slice(0, 10)
    .map((p) => ({ id: p.id, title: p.title, count: p._count.reviews }));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-semibold">{totalGenerated}</p>
            <p className="text-sm text-muted-foreground">Reviews generated</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-semibold">{uploadedCount}</p>
            <p className="text-sm text-muted-foreground">Uploaded</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-semibold">{failedUploadCount}</p>
            <p className="text-sm text-muted-foreground">Failed uploads</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-semibold">{duplicateCount}</p>
            <p className="text-sm text-muted-foreground">Duplicate content detected</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-semibold">{avgReviewsPerProduct.toFixed(1)}</p>
            <p className="text-sm text-muted-foreground">Avg reviews / product</p>
          </CardContent>
        </Card>
      </div>

      {totalGenerated === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No reviews yet</CardTitle>
            <CardDescription>
              Generate reviews from the Products page to see analytics here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reviews by status</CardTitle>
              <CardDescription>Where every generated review currently stands.</CardDescription>
            </CardHeader>
            <CardContent>
              <StatusBreakdown counts={statusCounts} />
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rating distribution</CardTitle>
                <CardDescription>Count of generated reviews by star rating.</CardDescription>
              </CardHeader>
              <CardContent>
                <RatingDistribution counts={ratingCounts} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Reviewer gender split</CardTitle>
                <CardDescription>Across all {totalReviewers} reviewer profiles.</CardDescription>
              </CardHeader>
              <CardContent>
                {totalReviewers === 0 ? (
                  <p className="text-sm text-muted-foreground">No reviewer profiles yet.</p>
                ) : (
                  <GenderSplit male={maleReviewerCount} female={femaleReviewerCount} />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top categories by reviews</CardTitle>
                <CardDescription>Which product types have the most generated reviews.</CardDescription>
              </CardHeader>
              <CardContent>
                <CategoryBreakdown entries={topCategories} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top 10 products by reviews</CardTitle>
                <CardDescription>Individual products with the most generated reviews.</CardDescription>
              </CardHeader>
              <CardContent>
                <TopProducts entries={topProducts} />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
