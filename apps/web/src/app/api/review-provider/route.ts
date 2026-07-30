import { NextResponse } from "next/server";
import { prisma } from "@ai-shopify/db";
import { apiFailure, apiSuccess, decryptSecret, encryptSecret, selectProviderSchema } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { zodErrorToFieldErrors } from "@/lib/validation";

function requireEncryptionKey(): string {
  const value = process.env.ENCRYPTION_KEY;
  if (!value) throw new Error("Missing required environment variable: ENCRYPTION_KEY");
  return value;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });
  if (!store) {
    return NextResponse.json(apiSuccess({ config: null }));
  }

  const config = await prisma.reviewProviderConfig.findFirst({
    where: { storeId: store.id, isActive: true },
  });
  return NextResponse.json(apiSuccess({ config }));
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(apiFailure("Not authenticated", { code: "NOT_AUTHENTICATED" }), {
      status: 401,
    });
  }

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });
  if (!store) {
    return NextResponse.json(apiFailure("No Shopify store connected", { code: "NOT_CONNECTED" }), {
      status: 400,
    });
  }

  const body = await request.json().catch(() => null);
  const parsed = selectProviderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      apiFailure("Invalid input", { fieldErrors: zodErrorToFieldErrors(parsed.error) }),
      { status: 400 },
    );
  }

  await prisma.reviewProviderConfig.updateMany({
    where: { storeId: store.id, isActive: true },
    data: { isActive: false },
  });

  // Credentials are a JSON blob, so a token can be added without a schema change. An omitted token
  // must keep whatever is stored — the form sends it blank once saved, same as every other key here.
  const existing = await prisma.reviewProviderConfig.findUnique({
    where: { storeId_provider: { storeId: store.id, provider: parsed.data.provider } },
  });
  //
  // Reading the existing blob must never be able to fail the save. Before this route merged
  // credentials it only ever encrypted, so a blob that cannot be decrypted (written under a rotated
  // key, or any legacy format) was harmless; now it would 500 the whole request and make it
  // impossible to store a token at all. Falling back to an empty object means the worst case is
  // losing previously-stored keys we could not read anyway.
  let currentCredentials: Record<string, string> = {};
  if (existing) {
    try {
      const decoded = JSON.parse(decryptSecret(existing.credentialsEncrypted, requireEncryptionKey()));
      if (decoded && typeof decoded === "object") currentCredentials = decoded as Record<string, string>;
    } catch {
      console.error("[review-provider] could not decrypt stored credentials; starting a fresh blob");
    }
  }
  if (parsed.data.apiToken) currentCredentials.apiToken = parsed.data.apiToken;
  const credentialsEncrypted = encryptSecret(JSON.stringify(currentCredentials), requireEncryptionKey());

  const config = await prisma.reviewProviderConfig.upsert({
    where: { storeId_provider: { storeId: store.id, provider: parsed.data.provider } },
    create: {
      storeId: store.id,
      provider: parsed.data.provider,
      credentialsEncrypted,
      isActive: true,
    },
    update: { isActive: true, credentialsEncrypted },
  });

  return NextResponse.json(apiSuccess({ config }));
}
