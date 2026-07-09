import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { updateProfileSchema, apiSuccess, apiFailure } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { zodErrorToFieldErrors } from "@/lib/validation";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }
  return NextResponse.json(apiSuccess({ user }));
}

export async function PATCH(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateProfileSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      apiFailure("Invalid input", { fieldErrors: zodErrorToFieldErrors(parsed.error) }),
      { status: 400 },
    );
  }

  const user = await prisma.user.update({
    where: { id: currentUser.id },
    data: { name: parsed.data.name },
    select: { id: true, email: true, name: true },
  });

  return NextResponse.json(apiSuccess({ user }));
}
