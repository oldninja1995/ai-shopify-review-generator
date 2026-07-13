import { redirect } from "next/navigation";
import { prisma } from "@ai-shopify/db";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandSettingsForm } from "@/components/dashboard/brand-settings-form";

const EMPTY_VALUES = {
  brandName: "",
  brandDescription: "",
  brandCategory: "",
  brandPositioning: "",
  brandPersonality: "",
  brandVoice: "",
  targetAudience: "",
  usp: "",
  country: "",
  language: "",
};

export default async function BrandSettingsPage() {
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
        <h1 className="text-2xl font-semibold tracking-tight">Brand Settings</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No store connected</CardTitle>
            <CardDescription>
              Connect a Shopify store from the Products page before setting up brand details.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const brandSettings = await prisma.brandSettings.findUnique({ where: { storeId: store.id } });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Brand Settings</h1>
      <BrandSettingsForm
        initialValues={brandSettings ? { ...brandSettings, usp: brandSettings.usp ?? "" } : EMPTY_VALUES}
      />
    </div>
  );
}
