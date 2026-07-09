import Link from "next/link";
import { ChevronRight, User } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
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
        <CardHeader>
          <CardTitle className="text-base">More settings</CardTitle>
          <CardDescription>
            Shopify connection management and workspace preferences land alongside the Shopify
            integration phase.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
