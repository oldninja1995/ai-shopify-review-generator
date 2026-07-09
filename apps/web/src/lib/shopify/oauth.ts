import crypto from "node:crypto";

export const OAUTH_STATE_COOKIE = "shopify_oauth_state";
export const OAUTH_SHOP_COOKIE = "shopify_oauth_shop";

function requireEnv(name: "SHOPIFY_API_KEY" | "SHOPIFY_API_SECRET" | "SHOPIFY_SCOPES" | "SHOPIFY_APP_URL") {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function generateOAuthState(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function buildAuthorizeUrl(shop: string, state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("SHOPIFY_API_KEY"),
    scope: requireEnv("SHOPIFY_SCOPES"),
    redirect_uri: `${requireEnv("SHOPIFY_APP_URL")}/api/shopify/callback`,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

/** Verifies the HMAC Shopify signs onto every OAuth redirect/callback query string. */
export function verifyHmac(searchParams: URLSearchParams): boolean {
  const hmac = searchParams.get("hmac");
  if (!hmac) return false;

  const message = [...searchParams.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const digest = crypto
    .createHmac("sha256", requireEnv("SHOPIFY_API_SECRET"))
    .update(message)
    .digest("hex");

  const digestBuffer = Buffer.from(digest, "utf8");
  const hmacBuffer = Buffer.from(hmac, "utf8");
  return digestBuffer.length === hmacBuffer.length && crypto.timingSafeEqual(digestBuffer, hmacBuffer);
}

export function isValidShopDomain(shop: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
}

export async function exchangeCodeForToken(
  shop: string,
  code: string,
): Promise<{ accessToken: string; scope: string }> {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: requireEnv("SHOPIFY_API_KEY"),
      client_secret: requireEnv("SHOPIFY_API_SECRET"),
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`Shopify token exchange failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { access_token: string; scope: string };
  return { accessToken: body.access_token, scope: body.scope };
}
