import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiSuccess, apiFailure } from "@ai-shopify/shared";
import { clearAuthCookies, getRefreshTokenCookie } from "@/lib/auth/cookies";
import { hashOpaqueToken } from "@/lib/auth/refresh-token";
import { issueSession } from "@/lib/auth/issue-session";

export async function POST() {
  const refreshToken = await getRefreshTokenCookie();

  if (!refreshToken) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NO_SESSION" }), { status: 401 });
  }

  const session = await prisma.refreshSession.findUnique({
    where: { hashedToken: hashOpaqueToken(refreshToken) },
    include: { user: { select: { id: true, email: true, name: true } } },
  });

  const isValid = session && !session.revokedAt && session.expiresAt > new Date();

  if (!session || !isValid) {
    await clearAuthCookies();
    return NextResponse.json(apiFailure("Session expired", { code: "SESSION_EXPIRED" }), { status: 401 });
  }

  await prisma.refreshSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  await issueSession(session.user.id);

  return NextResponse.json(apiSuccess({ user: session.user }));
}
