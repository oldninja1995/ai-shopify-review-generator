import { redirect } from "next/navigation";
import { prisma } from "@ai-shopify/db";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReviewList, type ReviewListItem } from "@/components/dashboard/review-list";
import { ReviewUploadPanel } from "@/components/dashboard/review-upload-panel";
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
          include: { product: true, reviewerProfile: true },
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

  const providerConfig = store
    ? await prisma.reviewProviderConfig.findFirst({ where: { storeId: store.id, isActive: true } })
    : null;
  const eligibleCount = store
    ? await prisma.generatedReview.count({
        where: { status: { in: ["DRAFT", "APPROVED"] }, product: { storeId: store.id } },
      })
    : 0;

  const collections = store
    ? await prisma.collection.findMany({ where: { storeId: store.id }, orderBy: { title: "asc" } })
    : [];
  const collectionOptions = collections.map((c) => ({ value: c.id, label: c.title }));

  const bulkJobs: BulkJobRow[] = store
    ? (
        await prisma.bulkGenerationJob.findMany({
          where: { storeId: store.id },
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
          <BulkGenerationPanel collections={collectionOptions} jobs={bulkJobs} />
          <ReviewUploadPanel provider={providerConfig?.provider ?? null} eligibleCount={eligibleCount} />
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
