import { NextResponse, type NextRequest } from "next/server";
import { verifyAccessToken } from "@/lib/auth/access-token";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/cookies";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const payload = token ? await verifyAccessToken(token) : null;

  if (!payload) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
