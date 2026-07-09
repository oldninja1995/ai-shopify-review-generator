import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiSuccess } from "@ai-shopify/shared";
import { clearAuthCookies, getRefreshTokenCookie } from "@/lib/auth/cookies";
import { hashOpaqueToken } from "@/lib/auth/refresh-token";

export async function POST() {
  const refreshToken = await getRefreshTokenCookie();

  if (refreshToken) {
    await prisma.refreshSession.updateMany({
      where: { hashedToken: hashOpaqueToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  await clearAuthCookies();

  return NextResponse.json(apiSuccess({ loggedOut: true }));
}
