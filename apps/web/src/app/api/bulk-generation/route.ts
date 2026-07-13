import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import {
  apiFailure,
  apiSuccess,
  bulkGenerateReviewsSchema,
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

  const jobs = await prisma.bulkGenerationJob.findMany({
    where: { storeId: store.id },
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
  const { scope, targetIds, countMode, maleCount, femaleCount, minPerProduct, maxPerProduct, length } =
    parsed.data;

  let products: { id: string }[];
  if (scope === "STORE") {
    products = await prisma.product.findMany({
      where: { storeId: store.id },
      select: { id: true },
    });
  } else if (scope === "COLLECTION") {
    const collectionId = targetIds[0];
    const rows = await prisma.productCollection.findMany({
      where: { collectionId, product: { storeId: store.id } },
      select: { productId: true },
    });
    products = rows.map((row) => ({ id: row.productId }));
  } else {
    products = await prisma.product.findMany({
      where: { id: { in: targetIds }, storeId: store.id },
      select: { id: true },
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

  function countsForProduct(): { maleCount: number; femaleCount: number } {
    if (countMode === "RANDOM") {
      const total =
        (minPerProduct as number) +
        Math.floor(Math.random() * ((maxPerProduct as number) - (minPerProduct as number) + 1));
      const male = Math.round(Math.random() * total);
      return { maleCount: male, femaleCount: total - male };
    }
    return { maleCount: maleCount ?? 0, femaleCount: femaleCount ?? 0 };
  }

  await reviewGenerationQueue.addBulk(
    products.map((product) => ({
      name: "generate",
      data: {
        productId: product.id,
        ...countsForProduct(),
        length,
        bulkJobId: bulkJob.id,
      } satisfies ReviewGenerationJobPayload,
    })),
  );

  return NextResponse.json(apiSuccess({ bulkJobId: bulkJob.id, totalCount: products.length }));
}
