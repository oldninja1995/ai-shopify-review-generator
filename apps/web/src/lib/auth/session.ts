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
