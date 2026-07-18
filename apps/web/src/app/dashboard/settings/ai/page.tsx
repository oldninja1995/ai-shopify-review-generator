import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@ai-shopify/db";
import { GROQ_MODEL_OPTIONS } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchOpenRouterModels } from "@/lib/openrouter";
import { AiSettingsForm } from "@/components/dashboard/ai-settings-form";

// How far back to look for an AI-fallback warning before considering it stale — generation runs
// happen in bursts (bulk jobs, individual requests), not continuously, so this is a "still likely
// rate-limited right now" window rather than a strict rolling average.
const FALLBACK_WARNING_LOOKBACK_MS = 3 * 60 * 60 * 1000;

export default async function AiSettingsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });

  if (!store) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">AI Generation</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No store connected</CardTitle>
            <CardDescription>
              Connect a Shopify store from the Products page before configuring AI generation.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const [aiSettings, models, recentFallback, fallbackCount] = await Promise.all([
    prisma.aiSettings.findUnique({ where: { storeId: store.id } }),
    fetchOpenRouterModels(),
    prisma.systemLog.findFirst({
      where: {
        userId: user.id,
        level: "WARN",
        message: { contains: "fell back to the phrase-bank generator" },
        createdAt: { gte: new Date(Date.now() - FALLBACK_WARNING_LOOKBACK_MS) },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.systemLog.count({
      where: {
        userId: user.id,
        level: "WARN",
        message: { contains: "fell back to the phrase-bank generator" },
        createdAt: { gte: new Date(Date.now() - FALLBACK_WARNING_LOOKBACK_MS) },
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">AI Generation</h1>

      {recentFallback && (
        <Card className="border-amber-500/50 bg-amber-500/10 dark:border-amber-400/40 dark:bg-amber-400/10">
          <CardHeader>
            <CardTitle className="text-base text-amber-900 dark:text-amber-200">
              AI generation is currently degraded
            </CardTitle>
            <CardDescription className="text-amber-900/80 dark:text-amber-200/80">
              Every configured AI provider failed at least once in the last few hours (most
              recently {new Date(recentFallback.createdAt).toLocaleString()}, {fallbackCount} time
              {fallbackCount === 1 ? "" : "s"} since then) — likely a rate limit. Reviews generated
              during this time used the phrase-bank generator instead of real AI content.{" "}
              <Link href="/dashboard/logs?level=WARN" className="underline">
                View details in Logs
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <AiSettingsForm
        initialValues={{
          enabled: aiSettings?.enabled ?? false,
          models: aiSettings?.models ?? [],
          hasApiKey: Boolean(aiSettings?.apiKeyEncrypted),
          visionAudienceEnabled: aiSettings?.visionAudienceEnabled ?? false,
          groqModels: aiSettings?.groqModels ?? [],
          hasGroqApiKey: Boolean(aiSettings?.groqApiKeyEncrypted),
        }}
        models={models}
        groqModelOptions={GROQ_MODEL_OPTIONS}
      />
    </div>
  );
}
