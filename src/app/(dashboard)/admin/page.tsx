import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { AdminUsersTable } from "./admin-users-table";
import { CreateUserModal } from "./create-user-modal";

const ADMIN_EMAIL = "bitlanceai@gmail.com";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    redirect("/dashboard");
  }

  const adminClient = getAdminClient();
  
  // Fetch all profiles bypassing RLS
  const { data: profiles, error } = await adminClient
    .from("profiles")
    .select("id, user_id, full_name, email, role, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch users:", error);
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
        <CreateUserModal />
      </div>
      <p className="text-muted-foreground">
        Manage all registered users in the system.
      </p>

      <div className="rounded-md border bg-card">
        <AdminUsersTable initialProfiles={profiles || []} />
      </div>
    </div>
  );
}
