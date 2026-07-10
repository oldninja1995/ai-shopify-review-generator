import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import {
  apiFailure,
  apiSuccess,
  generateReviewsSchema,
  type ReviewGenerationJobPayload,
} from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { reviewGenerationQueue } from "@/lib/queue";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const body = await request.json();
  const parsed = generateReviewsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      apiFailure(parsed.error.issues[0]?.message ?? "Invalid request", {
        code: "VALIDATION_ERROR",
      }),
      { status: 400 },
    );
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

  const product = await prisma.product.findFirst({
    where: { id: parsed.data.productId, storeId: store.id },
  });
  if (!product) {
    return NextResponse.json(apiFailure("Product not found", { code: "NOT_FOUND" }), {
      status: 404,
    });
  }

  await reviewGenerationQueue.add("generate", parsed.data satisfies ReviewGenerationJobPayload);

  return NextResponse.json(apiSuccess({ queued: true }));
}
