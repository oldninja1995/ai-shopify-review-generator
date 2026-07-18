import { cookies } from "next/headers";
import { parseDurationMs } from "./duration";

export const ACCESS_TOKEN_COOKIE = "access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";

const isProduction = process.env.NODE_ENV === "production";

export async function baseCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

export async function setAuthCookies(accessToken: string, refreshToken: string) {
  const store = await cookies();
  store.set(
    ACCESS_TOKEN_COOKIE,
    accessToken,
    await baseCookieOptions(parseDurationMs(process.env.JWT_ACCESS_TTL ?? "15m")),
  );
  store.set(
    REFRESH_TOKEN_COOKIE,
    refreshToken,
    await baseCookieOptions(parseDurationMs(process.env.JWT_REFRESH_TTL ?? "30d")),
  );
}

export async function clearAuthCookies() {
  const store = await cookies();
  store.delete(ACCESS_TOKEN_COOKIE);
  store.delete(REFRESH_TOKEN_COOKIE);
}

export async function getAccessTokenCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(ACCESS_TOKEN_COOKIE)?.value;
}

export async function getRefreshTokenCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(REFRESH_TOKEN_COOKIE)?.value;
}
