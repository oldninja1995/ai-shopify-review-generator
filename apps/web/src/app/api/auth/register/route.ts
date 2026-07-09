import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { registerSchema, apiSuccess, apiFailure } from "@ai-shopify/shared";
import { hashPassword } from "@/lib/auth/password";
import { issueSession } from "@/lib/auth/issue-session";
import { zodErrorToFieldErrors } from "@/lib/validation";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      apiFailure("Invalid input", { fieldErrors: zodErrorToFieldErrors(parsed.error) }),
      { status: 400 },
    );
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(apiFailure("An account with this email already exists", { code: "EMAIL_TAKEN" }), {
      status: 409,
    });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { name, email, passwordHash },
    select: { id: true, email: true, name: true },
  });

  await issueSession(user.id);

  return NextResponse.json(apiSuccess({ user }), { status: 201 });
}
