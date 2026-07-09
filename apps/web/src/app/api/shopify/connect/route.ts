import { NextRequest, NextResponse } from "next/server";
import { connectStoreSchema } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import {
  buildAuthorizeUrl,
  generateOAuthState,
  OAUTH_SHOP_COOKIE,
  OAUTH_STATE_COOKIE,
} from "@/lib/shopify/oauth";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const parsed = connectStoreSchema.safeParse({
    shop: request.nextUrl.searchParams.get("shop") ?? "",
  });

  if (!parsed.success) {
    const url = new URL("/dashboard/products", request.url);
    url.searchParams.set("error", "invalid_shop");
    return NextResponse.redirect(url);
  }

  const { shop } = parsed.data;
  const state = generateOAuthState();
  const response = NextResponse.redirect(buildAuthorizeUrl(shop, state));

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  response.cookies.set(OAUTH_STATE_COOKIE, state, cookieOptions);
  response.cookies.set(OAUTH_SHOP_COOKIE, shop, cookieOptions);

  return response;
}
