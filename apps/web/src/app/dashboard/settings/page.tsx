import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Sparkles, Store, User } from "lucide-react";
import { prisma } from "@ai-shopify/db";
import { getCurrentUser } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { DisconnectStoreButton } from "@/components/dashboard/disconnect-store-button";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const store = await prisma.shopifyStore.findFirst({
    where: { userId: user.id },
    orderBy: { connectedAt: "desc" },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Link href="/dashboard/settings/profile">
        <Card className="transition-colors hover:bg-muted/50">
          <CardContent className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-3">
              <User className="size-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">Profile</CardTitle>
                <CardDescription>Your name, email, and password</CardDescription>
              </div>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>
      <Card>
        <CardContent className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            <Store className="size-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Shopify connection</CardTitle>
              <CardDescription>{store ? store.shopDomain : "No store connected yet"}</CardDescription>
            </div>
          </div>
          {store ? (
            <div className="flex items-center gap-3">
              <Badge variant={store.lastSyncedAt ? "secondary" : "outline"}>
                {store.lastSyncedAt ? "Synced" : "Syncing"}
              </Badge>
              <DisconnectStoreButton />
            </div>
          ) : (
            <Link
              href="/dashboard/products"
              className="text-sm font-medium text-primary hover:underline"
            >
              Connect store →
            </Link>
          )}
        </CardContent>
      </Card>
      <Link href="/dashboard/settings/ai">
        <Card className="transition-colors hover:bg-muted/50">
          <CardContent className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-3">
              <Sparkles className="size-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">AI Generation</CardTitle>
                <CardDescription>Use a real AI model instead of the phrase-bank generator</CardDescription>
              </div>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
