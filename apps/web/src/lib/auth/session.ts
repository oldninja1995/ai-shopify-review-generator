import { prisma } from "@ai-shopify/db";
import { getAccessTokenCookie } from "./cookies";
import { verifyAccessToken } from "./access-token";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = await getAccessTokenCookie();
  if (!token) return null;

  const payload = await verifyAccessToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true },
  });

  return user;
}

/** JWT-only auth check (no DB call) — for gating access (e.g. the dashboard layout's redirect
 * check) where only "is this a valid session" matters, not the user's profile fields. Every page
 * under the gate calls `getCurrentUser()` itself for the actual user object it needs, so having
 * the layout *also* hit the DB just to decide whether to redirect was a fully redundant second
 * round-trip on every single navigation. */
export async function hasValidSession(): Promise<boolean> {
  const token = await getAccessTokenCookie();
  if (!token) return false;
  const payload = await verifyAccessToken(token);
  return payload !== null;
}
