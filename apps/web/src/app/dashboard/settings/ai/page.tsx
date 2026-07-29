import { redirect } from "next/navigation";
import { prisma, findAiSettingsSafe } from "@ai-shopify/db";
import { GROQ_MODEL_OPTIONS } from "@ai-shopify/shared";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchOpenRouterModels } from "@/lib/openrouter";
import { AiSettingsForm } from "@/components/dashboard/ai-settings-form";
import { AiStatusBanner } from "@/components/dashboard/ai-status-banner";
import { AiProvidersForm } from "@/components/dashboard/ai-providers-form";

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

  const [aiSettings, models] = await Promise.all([findAiSettingsSafe(store.id), fetchOpenRouterModels()]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">AI Generation</h1>

      <AiStatusBanner userId={user.id} />

      <AiSettingsForm
        initialValues={{
          enabled: aiSettings?.enabled ?? false,
          models: aiSettings?.models ?? [],
          hasApiKey: Boolean(aiSettings?.apiKeyEncrypted),
          visionAudienceEnabled: aiSettings?.visionAudienceEnabled ?? false,
          aiOnlyMode: aiSettings?.aiOnlyMode ?? false,
          groqModels: aiSettings?.groqModels ?? [],
          hasGroqApiKey: Boolean(aiSettings?.groqApiKeyEncrypted),
        }}
        models={models}
        groqModelOptions={GROQ_MODEL_OPTIONS}
      />

      <AiProvidersForm />
    </div>
  );
}
