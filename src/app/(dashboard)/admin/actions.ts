"use server";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

const ADMIN_EMAIL = "bitlanceai@gmail.com";

async function verifyAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }

  return user;
}

export async function deleteUser(userId: string) {
  await verifyAdmin();

  const adminClient = getAdminClient();
  
  // Deleting from auth.users will cascade and delete their profile, contacts, etc.
  const { error } = await adminClient.auth.admin.deleteUser(userId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin");
  return { success: true };
}
export async function createUser(data: { email: string; full_name: string; password?: string }) {
  await verifyAdmin();

  const adminClient = getAdminClient();
  
  const { error } = await adminClient.auth.admin.createUser({
    email: data.email,
    password: data.password || "TempPassword123!",
    email_confirm: true,
    user_metadata: {
      full_name: data.full_name,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin");
  return { success: true };
}

export async function updateUserPassword(userId: string, newPassword?: string) {
  await verifyAdmin();

  const adminClient = getAdminClient();
  
  const { error } = await adminClient.auth.admin.updateUserById(userId, {
    password: newPassword || "TempPassword123!",
  });

  if (error) {
    throw new Error(error.message);
  }

  return { success: true };
}
