import { SignJWT, jwtVerify } from "jose";

function secretFor(name: "JWT_ACCESS_SECRET") {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return new TextEncoder().encode(value);
}

export type AccessTokenPayload = {
  sub: string;
};

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId } satisfies AccessTokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_ACCESS_TTL ?? "15m")
    .sign(secretFor("JWT_ACCESS_SECRET"));
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretFor("JWT_ACCESS_SECRET"));
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}
