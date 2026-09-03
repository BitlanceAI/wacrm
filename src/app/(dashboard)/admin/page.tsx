import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  Users,
  MessageSquare,
  Radio,
  Contact,
  Inbox,
  PhoneCall,
} from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  loadPlatformStats,
  loadTenantStats,
  loadSignupsSeries,
} from "@/lib/admin/queries";
import { AdminUsersTable } from "./admin-users-table";
import { CreateUserModal } from "./create-user-modal";

const ADMIN_EMAIL = "bitlanceai@gmail.com";

const fmt = new Intl.NumberFormat("en-IN");

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    redirect("/dashboard");
  }

  const [stats, tenants, signups] = await Promise.all([
    loadPlatformStats(),
    loadTenantStats(),
    loadSignupsSeries(30),
  ]);

  const maxSignups = Math.max(1, ...signups.map((s) => s.count));
  const signupsTotal = signups.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform overview and tenant management.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/admin/pricing"
            className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
          >
            Manage Pricing
          </a>
          <CreateUserModal />
        </div>
      </div>

      {/* ── Platform overview ─────────────────────────────────── */}
      {stats ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            title="Users"
            value={fmt.format(stats.total_users)}
            icon={Users}
          />
          <MetricCard
            title="WhatsApp connected"
            value={`${stats.connected_whatsapp_count}/${stats.total_users}`}
            icon={PhoneCall}
          />
          <MetricCard
            title="Contacts"
            value={fmt.format(stats.total_contacts)}
            icon={Contact}
          />
          <MetricCard
            title="Messages"
            value={fmt.format(stats.total_messages)}
            icon={MessageSquare}
            subtitle={`${fmt.format(stats.messages_30d)} in last 30 days`}
          />
          <MetricCard
            title="Broadcasts"
            value={fmt.format(stats.total_broadcasts)}
            icon={Radio}
          />
          <MetricCard
            title="Conversations"
            value={fmt.format(stats.total_conversations)}
            icon={Inbox}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-muted-foreground">
          Platform stats unavailable — has migration 022 (admin_stats) been
          applied to the database?
        </div>
      )}

      {/* ── Signups (30 days) ─────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-background p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <p className="text-sm font-medium text-muted-foreground">
            Signups — last 30 days
          </p>
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {fmt.format(signupsTotal)}
          </p>
        </div>
        <div className="flex h-24 items-end gap-[3px]">
          {signups.map((point) => (
            <div
              key={point.date}
              className="group relative flex-1"
              title={`${point.date}: ${point.count}`}
            >
              <div
                className={
                  point.count > 0
                    ? "w-full rounded-sm bg-primary"
                    : "w-full rounded-sm bg-accent"
                }
                style={{
                  height: `${Math.max(6, (point.count / maxSignups) * 96)}px`,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Tenants ───────────────────────────────────────────── */}
      <div className="rounded-md border bg-card">
        <AdminUsersTable initialTenants={tenants} />
      </div>
    </div>
  );
}
