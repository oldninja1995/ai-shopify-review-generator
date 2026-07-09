import Link from "next/link";
import { Package, Sparkles, MessageSquareText, UploadCloud } from "lucide-react";
import { prisma } from "@ai-shopify/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";

export default async function DashboardHomePage() {
  const user = await getCurrentUser();

  const store = user
    ? await prisma.shopifyStore.findFirst({
        where: { userId: user.id },
        orderBy: { connectedAt: "desc" },
      })
    : null;
  const productsSynced = store ? await prisma.product.count({ where: { storeId: store.id } }) : 0;

  const STATS = [
    { label: "Products synced", value: productsSynced, icon: Package },
    { label: "Reviews generated", value: 0, icon: Sparkles },
    { label: "Reviews uploaded", value: 0, icon: MessageSquareText },
    { label: "Pending uploads", value: 0, icon: UploadCloud },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back{user ? `, ${user.name}` : ""}</h1>
        <p className="text-sm text-muted-foreground">
          Here&apos;s an overview of your store. Connect Shopify and set up your brand to get started.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center justify-between pt-1">
              <div>
                <p className="text-2xl font-semibold">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
              <stat.icon className="size-8 text-muted-foreground/50" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              1. {store ? `Connected to ${store.shopDomain}` : "Connect your Shopify store"}
            </CardTitle>
            <CardDescription>
              Import products, images, descriptions, collections, tags, and variants.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/products" className="text-sm font-medium text-primary hover:underline">
              Go to Products →
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Set up your brand</CardTitle>
            <CardDescription>
              Tell Claude about your brand voice, positioning, and audience before generating reviews.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/dashboard/brand-settings"
              className="text-sm font-medium text-primary hover:underline"
            >
              Go to Brand Settings →
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
