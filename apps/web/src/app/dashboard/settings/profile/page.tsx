import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ProfileForm } from "@/components/dashboard/profile-form";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
      <ProfileForm name={user.name} email={user.email} />
    </div>
  );
}
