import { redirect } from "next/navigation";
import { prisma } from "@ai-shopify/db";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DiagnosticsPanel } from "@/components/dashboard/diagnostics-panel";

/** Answers one question: why is generation not doing what I asked?
 *
 * The checks are deliberately gathered client-side on mount rather than server-rendered here. Two
 * of them (the worker heartbeat and its in-memory model cooldowns) are live values that go stale
 * within seconds, and a server-rendered snapshot of those is exactly the sort of frozen figure
 * this page exists to expose. */
export default async function DiagnosticsPage() {
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
        <h1 className="text-2xl font-semibold tracking-tight">Diagnostics</h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No store connected</CardTitle>
            <CardDescription>
              Connect a Shopify store from the Products page — there is nothing to diagnose yet.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Diagnostics</h1>
        <p className="text-sm text-muted-foreground">
          Checks everything a generation run depends on, and repairs what it can.
        </p>
      </div>
      <DiagnosticsPanel initial={null} />
    </div>
  );
}
