import { prisma } from "@ai-shopify/db";
import { parseDurationMs } from "./duration";
import { signAccessToken } from "./access-token";
import { generateRefreshToken } from "./refresh-token";
import { setAuthCookies } from "./cookies";

/** Creates a new refresh session + access token for a user and sets both auth cookies. */
export async function issueSession(userId: string): Promise<void> {
  const accessToken = await signAccessToken(userId);
  const { raw, hashed } = generateRefreshToken();

  await prisma.refreshSession.create({
    data: {
      userId,
      hashedToken: hashed,
      expiresAt: new Date(Date.now() + parseDurationMs(process.env.JWT_REFRESH_TTL ?? "30d")),
    },
  });

  await setAuthCookies(accessToken, raw);
}
