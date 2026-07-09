import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { changePasswordSchema, apiSuccess, apiFailure } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { zodErrorToFieldErrors } from "@/lib/validation";

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const body = await request.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      apiFailure("Invalid input", { fieldErrors: zodErrorToFieldErrors(parsed.error) }),
      { status: 400 },
    );
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser.id } });
  const currentPasswordValid = await verifyPassword(parsed.data.currentPassword, user.passwordHash);

  if (!currentPasswordValid) {
    return NextResponse.json(
      apiFailure("Current password is incorrect", { code: "INVALID_CURRENT_PASSWORD" }),
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({ where: { id: currentUser.id }, data: { passwordHash } });

  return NextResponse.json(apiSuccess({ changed: true }));
}
