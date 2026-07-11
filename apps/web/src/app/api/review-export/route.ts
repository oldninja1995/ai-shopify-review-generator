import { prisma } from "@ai-shopify/db";
import { getCurrentUser } from "@/lib/auth/session";

function csvField(value: string | number | boolean): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Not authenticated", { status: 401 });
  }

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });
  if (!store) {
    return new Response("No Shopify store connected", { status: 400 });
  }

  const reviews = await prisma.generatedReview.findMany({
    where: { status: { in: ["DRAFT", "APPROVED"] }, product: { storeId: store.id } },
    include: { product: true, reviewerProfile: true },
    orderBy: { createdAt: "asc" },
  });

  const header = [
    "product_id",
    "product_title",
    "reviewer_name",
    "rating",
    "title",
    "content",
    "review_date",
    "verified_purchase",
  ];
  const rows = reviews.map((review) =>
    [
      review.product.shopifyProductId,
      review.product.title,
      review.reviewerProfile.name,
      review.rating,
      review.title,
      review.content,
      review.reviewDate.toISOString().slice(0, 10),
      review.reviewerProfile.isVerifiedPurchase,
    ]
      .map(csvField)
      .join(","),
  );
  const csv = [header.join(","), ...rows].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="reviews-export.csv"`,
    },
  });
}
