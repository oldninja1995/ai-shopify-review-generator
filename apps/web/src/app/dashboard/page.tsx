import Link from "next/link";
import { Package, Sparkles, MessageSquareText, UploadCloud, SearchCheck, Trash2, Eraser } from "lucide-react";
import { prisma } from "@ai-shopify/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";
import {
  StatusBreakdown,
  RatingDistribution,
  GenderSplit,
  CategoryBreakdown,
  TopProducts,
} from "@/components/dashboard/analytics-charts";

export default async function DashboardHomePage() {
  const user = await getCurrentUser();

  const store = user
    ? await prisma.shopifyStore.findFirst({
        where: { userId: user.id },
        orderBy: { connectedAt: "desc" },
      })
    : null;

  const reviewWhere = { product: { storeId: store?.id ?? "" } };

  const [
    productsSynced,
    reviewsGenerated,
    reviewsUploaded,
    pendingUploads,
    duplicateStats,
    statusGroups,
    ratingGroups,
    totalReviewers,
    maleReviewerCount,
    clearedStats,
    uploadedHistoryStats,
    topCategories,
    topProducts,
  ] = store
    ? await Promise.all([
        prisma.product.count({ where: { storeId: store.id } }),
        prisma.generatedReview.count({ where: reviewWhere }),
        prisma.generatedReview.count({ where: { ...reviewWhere, status: "UPLOADED" } }),
        prisma.uploadJob.count({
          where: { review: reviewWhere, status: { in: ["PENDING", "PROCESSING"] } },
        }),
        prisma.duplicateCheckJob.aggregate({
          where: { storeId: store.id },
          _sum: { scannedCount: true, deletedCount: true },
        }),
        prisma.generatedReview.groupBy({ by: ["status"], where: reviewWhere, _count: true }),
        prisma.generatedReview.groupBy({ by: ["rating"], where: reviewWhere, _count: true }),
        prisma.reviewerProfile.count({ where: { storeId: store.id } }),
        prisma.reviewerProfile.count({ where: { storeId: store.id, gender: "MALE" } }),
        // "Delete all" removes the review rows themselves, so there's nothing left to count
        // afterward — the system_logs entry it writes is the only record a deletion happened.
        prisma.$queryRaw<{ total: number }[]>`
          SELECT COALESCE(SUM((metadata->>'count')::int), 0)::int AS total
          FROM system_logs
          WHERE "userId" = ${user!.id} AND metadata->>'type' = 'reviews_deleted'
        `,
        // Every review that was ever UPLOADED and later deleted (whether via a manual "delete all"
        // filtered to Uploaded, or the automatic post-upload delete) logged one of these — the only
        // surviving record it was uploaded at all, since the row itself is long gone. Combined with
        // the live UPLOADED count below for any reviews mid-flight that haven't been cleared yet.
        prisma.$queryRaw<{ total: number }[]>`
          SELECT COALESCE(SUM((metadata->>'count')::int), 0)::int AS total
          FROM system_logs
          WHERE "userId" = ${user!.id} AND metadata->>'type' = 'reviews_deleted' AND metadata->>'status' = 'UPLOADED'
        `,
        // Category/product rankings are aggregated in the database (GROUP BY + LIMIT 10) rather than
        // fetching every product row and reducing in JS — this store can have thousands of products,
        // and pulling them all on every dashboard load was a real source of unnecessary DB egress.
        prisma.$queryRaw<{ label: string; count: number }[]>`
          SELECT COALESCE(NULLIF(TRIM(p."productType"), ''), 'Uncategorized') AS label, COUNT(gr.id)::int AS count
          FROM products p
          LEFT JOIN generated_reviews gr ON gr."productId" = p.id
          WHERE p."storeId" = ${store.id}
          GROUP BY label
          ORDER BY count DESC
          LIMIT 10
        `,
        prisma.$queryRaw<{ id: string; title: string; count: number }[]>`
          SELECT p.id, p.title, COUNT(gr.id)::int AS count
          FROM products p
          LEFT JOIN generated_reviews gr ON gr."productId" = p.id
          WHERE p."storeId" = ${store.id}
          GROUP BY p.id, p.title
          ORDER BY count DESC
          LIMIT 10
        `,
      ])
    : [0, 0, 0, 0, null, [], [], 0, 0, [], [], [], []];

  const duplicatesChecked = duplicateStats?._sum.scannedCount ?? 0;
  const duplicatesRemoved = duplicateStats?._sum.deletedCount ?? 0;
  const reviewsCleared = clearedStats[0]?.total ?? 0;
  const reviewsUploadedTotal = reviewsUploaded + (uploadedHistoryStats[0]?.total ?? 0);

  const statusCounts = Object.fromEntries(statusGroups.map((g) => [g.status, g._count]));
  const ratingCounts = Object.fromEntries(ratingGroups.map((g) => [g.rating, g._count]));
  const femaleReviewerCount = totalReviewers - maleReviewerCount;
  const avgReviewsPerProduct = productsSynced > 0 ? reviewsGenerated / productsSynced : 0;

  const STATS = [
    { label: "Products synced", value: productsSynced, icon: Package },
    { label: "Reviews generated", value: reviewsGenerated, icon: Sparkles },
    { label: "Duplicates checked", value: duplicatesChecked, icon: SearchCheck },
    { label: "Duplicates removed", value: duplicatesRemoved, icon: Trash2 },
    { label: "Pending uploads", value: pendingUploads, icon: UploadCloud },
    { label: "Reviews uploaded", value: reviewsUploadedTotal, icon: MessageSquareText },
    { label: "Reviews cleared", value: reviewsCleared, icon: Eraser },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back{user ? `, ${user.name}` : ""}</h1>
        <p className="text-sm text-muted-foreground">
          Here&apos;s an overview of your store. Connect Shopify and set up your brand to get started.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {STATS.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center justify-between pt-1">
              <div>
                <p className="text-2xl font-semibold">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
              <stat.icon className="size-8 text-muted-foreground/50" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              1. {store ? `Connected to ${store.shopDomain}` : "Connect your Shopify store"}
            </CardTitle>
            <CardDescription>
              Import products, images, descriptions, collections, tags, and variants.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/products" className="text-sm font-medium text-primary hover:underline">
              Go to Products →
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Set up your brand</CardTitle>
            <CardDescription>
              Tell Claude about your brand voice, positioning, and audience before generating reviews.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/dashboard/brand-settings"
              className="text-sm font-medium text-primary hover:underline"
            >
              Go to Brand Settings →
            </Link>
          </CardContent>
        </Card>
      </div>

      {store && reviewsGenerated > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-6">
                <p className="text-2xl font-semibold">{totalReviewers}</p>
                <p className="text-sm text-muted-foreground">Reviewer profiles</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-2xl font-semibold">{avgReviewsPerProduct.toFixed(1)}</p>
                <p className="text-sm text-muted-foreground">Avg reviews / product</p>
              </CardContent>
            </Card>
          </div>

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
