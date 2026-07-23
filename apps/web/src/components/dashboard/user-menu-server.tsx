import { getCurrentUser } from "@/lib/auth/session";
import { UserMenu } from "@/components/dashboard/user-menu";

/** Isolated in its own Suspense-able Server Component so the one DB round-trip needed to display
 * the user's name/email doesn't block the rest of the dashboard shell/page from rendering. */
export async function UserMenuServer() {
  const user = await getCurrentUser();
  if (!user) return null;
  return <UserMenu name={user.name} email={user.email} />;
}
