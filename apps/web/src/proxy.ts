import { NextResponse, type NextRequest } from "next/server";
import { verifyAccessToken } from "@/lib/auth/access-token";
import { rotateRefreshSession } from "@/lib/auth/refresh-session";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, baseCookieOptions } from "@/lib/auth/cookies";
import { parseDurationMs } from "@/lib/auth/duration";

/**
 * The access token is short-lived (15m default) and expires many times within a
 * single 30-day refresh-token session. Previously any expiry hard-redirected to
 * /login even though the refresh token was still valid — rotate it here instead.
 */
export async function proxy(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (accessToken && (await verifyAccessToken(accessToken))) {
    return NextResponse.next();
  }

  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (refreshToken) {
    const result = await rotateRefreshSession(refreshToken);
    if (result) {
      request.cookies.set(ACCESS_TOKEN_COOKIE, result.accessToken);
      request.cookies.set(REFRESH_TOKEN_COOKIE, result.refreshToken);

      const response = NextResponse.next({ request });
      response.cookies.set(
        ACCESS_TOKEN_COOKIE,
        result.accessToken,
        await baseCookieOptions(parseDurationMs(process.env.JWT_ACCESS_TTL ?? "15m")),
      );
      response.cookies.set(
        REFRESH_TOKEN_COOKIE,
        result.refreshToken,
        await baseCookieOptions(parseDurationMs(process.env.JWT_REFRESH_TTL ?? "30d")),
      );
      return response;
    }
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
