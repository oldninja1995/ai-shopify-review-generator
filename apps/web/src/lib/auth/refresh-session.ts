import { prisma } from "@ai-shopify/db";
import { hashOpaqueToken, generateRefreshToken } from "./refresh-token";
import { signAccessToken } from "./access-token";
import { parseDurationMs } from "./duration";

export type RefreshResult = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string };
};

/** Validates a raw refresh token and, if valid, rotates it for a new access/refresh pair. */
export async function rotateRefreshSession(rawRefreshToken: string): Promise<RefreshResult | null> {
  const session = await prisma.refreshSession.findUnique({
    where: { hashedToken: hashOpaqueToken(rawRefreshToken) },
    include: { user: { select: { id: true, email: true, name: true } } },
  });

  const isValid = session && !session.revokedAt && session.expiresAt > new Date();
  if (!session || !isValid) return null;

  await prisma.refreshSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  const accessToken = await signAccessToken(session.user.id);
  const { raw, hashed } = generateRefreshToken();

  await prisma.refreshSession.create({
    data: {
      userId: session.user.id,
      hashedToken: hashed,
      expiresAt: new Date(Date.now() + parseDurationMs(process.env.JWT_REFRESH_TTL ?? "30d")),
    },
  });

  return { accessToken, refreshToken: raw, user: session.user };
}
