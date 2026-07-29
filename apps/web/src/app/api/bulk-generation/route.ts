import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import {
  apiFailure,
  apiSuccess,
  bulkGenerateReviewsSchema,
  detectAudienceGender,
  type ReviewGenerationJobPayload,
} from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { reviewGenerationQueue } from "@/lib/queue";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });
  if (!store) {
    return NextResponse.json(apiSuccess({ jobs: [] }));
  }

  // Must match the hosting page's filter (dashboard/review-generator/page.tsx): this is what the
  // panel polls every 2s, so a finished job left in here would reappear the moment it completed.
  const jobs = await prisma.bulkGenerationJob.findMany({
    where: { storeId: store.id, status: { in: ["PENDING", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json(apiSuccess({ jobs }));
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });
  if (!store) {
    return NextResponse.json(apiFailure("No Shopify store connected", { code: "NOT_CONNECTED" }), {
      status: 400,
    });
  }

  const body = await request.json().catch(() => null);
  const parsed = bulkGenerateReviewsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      apiFailure(parsed.error.issues[0]?.message ?? "Invalid request", { code: "VALIDATION_ERROR" }),
      { status: 400 },
    );
  }
  const {
    scope,
    targetIds,
    countMode,
    maleCount,
    femaleCount,
    minPerProduct,
    maxPerProduct,
    lengthMode,
    length,
    lengthWeights,
    ratingWeights,
  } = parsed.data;

  let products: { id: string; title: string; productType: string }[];
  if (scope === "STORE") {
    products = await prisma.product.findMany({
      where: { storeId: store.id },
      select: { id: true, title: true, productType: true },
    });
  } else if (scope === "COLLECTION") {
    const collectionId = targetIds[0];
    const rows = await prisma.productCollection.findMany({
      where: { collectionId, product: { storeId: store.id } },
      select: { product: { select: { id: true, title: true, productType: true } } },
    });
    products = rows.map((row) => row.product);
  } else {
    products = await prisma.product.findMany({
      where: { id: { in: targetIds }, storeId: store.id },
      select: { id: true, title: true, productType: true },
    });
  }

  if (products.length === 0) {
    return NextResponse.json(apiFailure("No products matched this selection", { code: "NO_PRODUCTS" }), {
      status: 400,
    });
  }

  const bulkJob = await prisma.bulkGenerationJob.create({
    data: { storeId: store.id, scope, targetIds, totalCount: products.length, status: "RUNNING" },
  });

  // A skewed 90/10 split when the product reads as gendered (e.g. a women's chain) instead of
  // an arbitrary 50/50 — full elimination of the minority gender would remove gift-purchase
  // reviews entirely, which are realistic in small numbers, just not at parity with the majority.
  function skewToAudience(
    total: number,
    audience: ReturnType<typeof detectAudienceGender>,
    unisexMale: number,
  ): { maleCount: number; femaleCount: number } {
    if (audience === "UNISEX") return { maleCount: unisexMale, femaleCount: total - unisexMale };
    const majorityCount = Math.round(total * 0.9);
    const minorityCount = total - majorityCount;
    return audience === "FEMALE"
      ? { maleCount: minorityCount, femaleCount: majorityCount }
      : { maleCount: majorityCount, femaleCount: minorityCount };
  }

  function countsForProduct(product: {
    title: string;
    productType: string;
  }): { maleCount: number; femaleCount: number } {
    const audience = detectAudienceGender(product.title, product.productType);

    if (countMode === "RANDOM") {
      const total =
        (minPerProduct as number) +
        Math.floor(Math.random() * ((maxPerProduct as number) - (minPerProduct as number) + 1));
      return skewToAudience(total, audience, Math.round(Math.random() * total));
    }

    const baseMale = maleCount ?? 0;
    const baseFemale = femaleCount ?? 0;
    return skewToAudience(baseMale + baseFemale, audience, baseMale);
  }

  await reviewGenerationQueue.addBulk(
    products.map((product) => ({
      name: "generate",
      data: {
        productId: product.id,
        ...countsForProduct(product),
        lengthMode,
        length,
        lengthWeights,
        ratingWeights,
        bulkJobId: bulkJob.id,
      } satisfies ReviewGenerationJobPayload,
    })),
  );

  return NextResponse.json(apiSuccess({ bulkJobId: bulkJob.id, totalCount: products.length }));
}
