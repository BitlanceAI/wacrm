"use server";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

const ADMIN_EMAIL = "bitlanceai@gmail.com";

/** Same gate as the main admin actions — server-side, per action. */
async function verifyAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== ADMIN_EMAIL) {
    throw new Error("Unauthorized");
  }
}

export interface PlanInput {
  slug: string;
  name: string;
  description: string;
  /** Rupees as typed by the admin, e.g. "2499". */
  price_monthly: string;
  /** Rupees; empty string = no yearly price. */
  price_yearly: string;
  /** One feature per line. */
  features_text: string;
  highlight: boolean;
  active: boolean;
  sort_order: number;
}

function toMinor(rupees: string): number | null {
  const trimmed = rupees.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid amount: ${rupees}`);
  return Math.round(n * 100);
}

function toRow(input: PlanInput) {
  const monthly = toMinor(input.price_monthly);
  if (monthly === null) throw new Error("Monthly price is required");
  const slug = input.slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("Slug is required");
  return {
    slug,
    name: input.name.trim() || slug,
    description: input.description.trim() || null,
    price_monthly_minor: monthly,
    price_yearly_minor: toMinor(input.price_yearly),
    features: input.features_text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    highlight: input.highlight,
    active: input.active,
    sort_order: Number.isFinite(input.sort_order) ? input.sort_order : 0,
  };
}

export async function savePlan(id: string | null, input: PlanInput) {
  await verifyAdmin();
  const row = toRow(input);
  const admin = getAdminClient();

  const { error } = id
    ? await admin.from("plans").update(row).eq("id", id)
    : await admin.from("plans").insert(row);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/pricing");
  revalidatePath("/pricing");
}

export async function setPlanActive(id: string, active: boolean) {
  await verifyAdmin();
  const { error } = await getAdminClient()
    .from("plans")
    .update({ active })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pricing");
  revalidatePath("/pricing");
}
