import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { PlanManager, type PlanRow } from "./plan-manager";

const ADMIN_EMAIL = "bitlanceai@gmail.com";

export default async function AdminPricingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    redirect("/dashboard");
  }

  // Service role: the admin sees inactive plans too (the public RLS
  // policy only exposes active ones).
  const { data: plans, error } = await getAdminClient()
    .from("plans")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[admin/pricing] failed to load plans:", error.message);
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <h1 className="text-3xl font-bold tracking-tight">Pricing</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Plans shown on the public pricing page. Changes go live
            immediately.
          </p>
        </div>
        <Link
          href="/pricing"
          target="_blank"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
        >
          View public page
          <ExternalLink className="size-3.5" />
        </Link>
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-muted-foreground">
          Plans unavailable — has migration 023 (plans) been applied to the
          database?
        </div>
      ) : (
        <PlanManager initialPlans={(plans ?? []) as PlanRow[]} />
      )}
    </div>
  );
}
