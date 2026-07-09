import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { forgotPasswordSchema, apiSuccess, apiFailure } from "@ai-shopify/shared";
import { generateRefreshToken } from "@/lib/auth/refresh-token";
import { sendPasswordResetEmail } from "@/lib/email";
import { zodErrorToFieldErrors } from "@/lib/validation";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = forgotPasswordSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      apiFailure("Invalid input", { fieldErrors: zodErrorToFieldErrors(parsed.error) }),
      { status: 400 },
    );
  }

  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  // Always respond success regardless of whether the account exists, to
  // avoid leaking which emails are registered.
  if (user) {
    const { raw, hashed } = generateRefreshToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        hashedToken: hashed,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const resetUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password/${raw}`;
    await sendPasswordResetEmail(user.email, resetUrl);
  }

  return NextResponse.json(apiSuccess({ sent: true }));
}
