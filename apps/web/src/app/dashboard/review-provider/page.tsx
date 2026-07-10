import { redirect } from "next/navigation";
import { prisma } from "@ai-shopify/db";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReviewProviderForm } from "@/components/dashboard/review-provider-form";

export default async function ReviewProviderPage() {
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
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Review Provider</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No store connected</CardTitle>
            <CardDescription>
              Connect a Shopify store from the Products page before choosing a review provider.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const config = await prisma.reviewProviderConfig.findFirst({
    where: { storeId: store.id, isActive: true },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Review Provider</h1>
      <ReviewProviderForm initialProvider={config?.provider ?? null} />
    </div>
  );
}
