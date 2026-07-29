import { redirect } from "next/navigation";
import { prisma } from "@ai-shopify/db";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReviewList, type ReviewListItem } from "@/components/dashboard/review-list";
import { BulkGenerationPanel, type BulkJobRow } from "@/components/dashboard/bulk-generation-panel";

export default async function ReviewGeneratorPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });

  const reviews: ReviewListItem[] = store
    ? (
        await prisma.generatedReview.findMany({
          where: { product: { storeId: store.id } },
          include: {
            product: { select: { title: true } },
            reviewerProfile: { select: { name: true, gender: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      ).map((review) => ({
        id: review.id,
        productTitle: review.product.title,
        reviewerName: review.reviewerProfile.name,
        reviewerGender: review.reviewerProfile.gender,
        rating: review.rating,
        status: review.status,
        createdAt: review.createdAt.toISOString(),
        title: review.title,
        content: review.content,
      }))
    : [];

  const collections = store
    ? await prisma.collection.findMany({
        where: { storeId: store.id },
        orderBy: { title: "asc" },
        include: { _count: { select: { products: true } } },
      })
    : [];
  const collectionOptions = collections.map((c) => ({
    value: c.id,
    label: c.title,
    productCount: c._count.products,
  }));

  const storeProductCount = store ? await prisma.product.count({ where: { storeId: store.id } }) : 0;

  const bulkJobs: BulkJobRow[] = store
    ? (
        // COMPLETED jobs are excluded so a finished run clears itself out of the panel instead of
        // lingering forever. FAILED/CANCELLED stay visible — those are outcomes worth noticing.
        await prisma.bulkGenerationJob.findMany({
          where: { storeId: store.id, status: { not: "COMPLETED" } },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      ).map((job) => ({
        id: job.id,
        scope: job.scope,
        totalCount: job.totalCount,
        completedCount: job.completedCount,
        failedCount: job.failedCount,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
      }))
    : [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Review Generator</h1>

      {!store ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No store connected</CardTitle>
            <CardDescription>
              Connect a Shopify store from the Products page to start generating reviews.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <BulkGenerationPanel
            collections={collectionOptions}
            jobs={bulkJobs}
            storeProductCount={storeProductCount}
          />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Generated reviews</CardTitle>
              <CardDescription>
                Reviews are generated from the Products page — click &quot;Generate reviews&quot; on
                any product.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {reviews.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No reviews generated yet.
                </p>
              ) : (
                <ReviewList reviews={reviews} />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
