import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { loginSchema, apiSuccess, apiFailure } from "@ai-shopify/shared";
import { verifyPassword } from "@/lib/auth/password";
import { issueSession } from "@/lib/auth/issue-session";
import { zodErrorToFieldErrors } from "@/lib/validation";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      apiFailure("Invalid input", { fieldErrors: zodErrorToFieldErrors(parsed.error) }),
      { status: 400 },
    );
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordValid = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!user || !passwordValid) {
    return NextResponse.json(apiFailure("Invalid email or password", { code: "INVALID_CREDENTIALS" }), {
      status: 401,
    });
  }

  await issueSession(user.id);

  return NextResponse.json(
    apiSuccess({ user: { id: user.id, email: user.email, name: user.name } }),
  );
}
