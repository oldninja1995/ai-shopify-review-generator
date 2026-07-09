import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { resetPasswordSchema, apiSuccess, apiFailure } from "@ai-shopify/shared";
import { hashPassword } from "@/lib/auth/password";
import { hashOpaqueToken } from "@/lib/auth/refresh-token";
import { zodErrorToFieldErrors } from "@/lib/validation";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = resetPasswordSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      apiFailure("Invalid input", { fieldErrors: zodErrorToFieldErrors(parsed.error) }),
      { status: 400 },
    );
  }

  const { token, password } = parsed.data;

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { hashedToken: hashOpaqueToken(token) },
  });

  const isValid = resetToken && !resetToken.usedAt && resetToken.expiresAt > new Date();

  if (!resetToken || !isValid) {
    return NextResponse.json(
      apiFailure("This reset link is invalid or has expired", { code: "INVALID_TOKEN" }),
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction([
    prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
    prisma.refreshSession.updateMany({
      where: { userId: resetToken.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return NextResponse.json(apiSuccess({ reset: true }));
}
