import { NextResponse } from "next/server";
import { apiSuccess, apiFailure } from "@ai-shopify/shared";
import { clearAuthCookies, getRefreshTokenCookie, setAuthCookies } from "@/lib/auth/cookies";
import { rotateRefreshSession } from "@/lib/auth/refresh-session";

export async function POST() {
  const refreshToken = await getRefreshTokenCookie();

  if (!refreshToken) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NO_SESSION" }), { status: 401 });
  }

  const result = await rotateRefreshSession(refreshToken);

  if (!result) {
    await clearAuthCookies();
    return NextResponse.json(apiFailure("Session expired", { code: "SESSION_EXPIRED" }), { status: 401 });
  }

  await setAuthCookies(result.accessToken, result.refreshToken);

  return NextResponse.json(apiSuccess({ user: result.user }));
}
