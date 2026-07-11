import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const { id } = await params;

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });
  if (!store) {
    return NextResponse.json(apiFailure("No Shopify store connected", { code: "NOT_CONNECTED" }), {
      status: 400,
    });
  }

  const profile = await prisma.reviewerProfile.findFirst({ where: { id, storeId: store.id } });
  if (!profile) {
    return NextResponse.json(apiFailure("Reviewer not found", { code: "NOT_FOUND" }), { status: 404 });
  }

  await prisma.reviewerProfile.delete({ where: { id } });

  return NextResponse.json(apiSuccess({ deleted: true }));
}
