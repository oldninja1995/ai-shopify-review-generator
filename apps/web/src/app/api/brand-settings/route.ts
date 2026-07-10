import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess, brandSettingsSchema } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { zodErrorToFieldErrors } from "@/lib/validation";

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
    return NextResponse.json(apiSuccess({ brandSettings: null }));
  }

  const brandSettings = await prisma.brandSettings.findUnique({ where: { storeId: store.id } });
  return NextResponse.json(apiSuccess({ brandSettings }));
}

export async function PUT(request: Request) {
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
  const parsed = brandSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      apiFailure("Invalid input", { fieldErrors: zodErrorToFieldErrors(parsed.error) }),
      { status: 400 },
    );
  }

  const brandSettings = await prisma.brandSettings.upsert({
    where: { storeId: store.id },
    create: { storeId: store.id, ...parsed.data },
    update: parsed.data,
  });

  return NextResponse.json(apiSuccess({ brandSettings }));
}
