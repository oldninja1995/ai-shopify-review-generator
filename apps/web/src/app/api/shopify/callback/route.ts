import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { encryptSecret, type ShopifySyncJobPayload } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { shopifySyncQueue } from "@/lib/queue";
import {
  exchangeCodeForToken,
  isValidShopDomain,
  OAUTH_SHOP_COOKIE,
  OAUTH_STATE_COOKIE,
  verifyHmac,
} from "@/lib/shopify/oauth";

function redirectWithError(request: NextRequest, error: string) {
  const url = new URL("/dashboard/products", request.url);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

function requireEncryptionKey(): string {
  const value = process.env.ENCRYPTION_KEY;
  if (!value) throw new Error("Missing required environment variable: ENCRYPTION_KEY");
  return value;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { searchParams } = request.nextUrl;
  const shop = searchParams.get("shop");
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!shop || !code || !state || !isValidShopDomain(shop) || !verifyHmac(searchParams)) {
    return redirectWithError(request, "invalid_callback");
  }

  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const expectedShop = request.cookies.get(OAUTH_SHOP_COOKIE)?.value;
  if (state !== expectedState || shop !== expectedShop) {
    return redirectWithError(request, "state_mismatch");
  }

  const existing = await prisma.shopifyStore.findUnique({ where: { shopDomain: shop } });
  if (existing && existing.userId !== user.id) {
    return redirectWithError(request, "already_connected");
  }

  let accessToken: string;
  let scope: string;
  let accessTokenEncrypted: string;
  try {
    ({ accessToken, scope } = await exchangeCodeForToken(shop, code));
    accessTokenEncrypted = encryptSecret(accessToken, requireEncryptionKey());
  } catch {
    return redirectWithError(request, "shopify_not_configured");
  }

  const store = await prisma.shopifyStore.upsert({
    where: { shopDomain: shop },
    create: { userId: user.id, shopDomain: shop, accessTokenEncrypted, scopes: scope },
    update: { accessTokenEncrypted, scopes: scope },
  });

  await shopifySyncQueue.add("sync", { storeId: store.id } satisfies ShopifySyncJobPayload);

  const response = NextResponse.redirect(new URL("/dashboard/products?connected=1", request.url));
  response.cookies.delete(OAUTH_STATE_COOKIE);
  response.cookies.delete(OAUTH_SHOP_COOKIE);
  return response;
}
