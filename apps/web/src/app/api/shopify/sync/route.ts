import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess, type ShopifySyncJobPayload } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { shopifySyncQueue } from "@/lib/queue";

export async function POST() {
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

  await shopifySyncQueue.add("sync", { storeId: store.id } satisfies ShopifySyncJobPayload);

  return NextResponse.json(apiSuccess({ queued: true }));
}
