import { getAdminClient } from '@/lib/supabase/admin'

/**
 * Cross-tenant aggregates for the /admin panel.
 *
 * Server-only: every call runs on the service-role client and reads
 * across all tenants — the SQL functions themselves are REVOKEd from
 * anon/authenticated (migration 022), so even a leaked anon key can't
 * reach them. The admin page's ADMIN_EMAIL gate is the access control;
 * these are just the data plumbing behind it.
 */

export interface PlatformStats {
  total_users: number
  total_contacts: number
  total_messages: number
  messages_30d: number
  total_broadcasts: number
  total_conversations: number
  connected_whatsapp_count: number
}

export interface TenantStats {
  user_id: string
  full_name: string | null
  email: string
  role: string | null
  created_at: string | null
  whatsapp_status: string | null
  phone_number_id: string | null
  contacts_count: number
  messages_count: number
  messages_30d: number
  broadcasts_count: number
  last_message_at: string | null
}

export async function loadPlatformStats(): Promise<PlatformStats | null> {
  const { data, error } = await getAdminClient().rpc('admin_platform_stats')
  if (error) {
    console.error('[admin] platform stats failed:', error.message)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  return (row as PlatformStats) ?? null
}

export async function loadTenantStats(): Promise<TenantStats[]> {
  const { data, error } = await getAdminClient().rpc('admin_tenant_stats')
  if (error) {
    console.error('[admin] tenant stats failed:', error.message)
    return []
  }
  return (data as TenantStats[]) ?? []
}

export interface SignupPoint {
  /** ISO date (YYYY-MM-DD). */
  date: string
  count: number
}

/**
 * Signups per day over the trailing window. Tenant counts are small,
 * so fetching created_at values and grouping in JS beats another SQL
 * function.
 */
export async function loadSignupsSeries(days = 30): Promise<SignupPoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const { data, error } = await getAdminClient()
    .from('profiles')
    .select('created_at')
    .gte('created_at', since.toISOString())
  if (error) {
    console.error('[admin] signups series failed:', error.message)
    return []
  }

  const byDay = new Map<string, number>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    byDay.set(d.toISOString().slice(0, 10), 0)
  }
  for (const row of (data ?? []) as { created_at: string }[]) {
    const key = row.created_at.slice(0, 10)
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + 1)
  }
  return [...byDay.entries()].map(([date, count]) => ({ date, count }))
}
