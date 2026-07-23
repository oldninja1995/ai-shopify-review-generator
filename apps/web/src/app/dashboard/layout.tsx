import { Suspense } from "react";
import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/auth/session";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { UserMenuServer } from "@/components/dashboard/user-menu-server";
import { Skeleton } from "@/components/ui/skeleton";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // JWT-only check (no DB call) — the actual per-page user object (needed for real queries) is
  // fetched by each page itself, so this only needs to answer "is there a valid session," not
  // fetch profile fields. Keeps the redirect gate off the request's critical path to the DB.
  const authed = await hasValidSession();
  if (!authed) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen w-full">
      <DashboardSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-card px-4">
          <span className="text-sm font-medium md:hidden">AI Review Generator</span>
          <div className="ml-auto">
            <Suspense fallback={<Skeleton className="h-9 w-24 rounded-lg" />}>
              <UserMenuServer />
            </Suspense>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto bg-muted/20 p-6">{children}</main>
      </div>
    </div>
  );
}
