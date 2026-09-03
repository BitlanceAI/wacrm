import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Path-B multi-user: a team member operates INSIDE the owner's tenant.
 * Everywhere server code previously used `user.id` as the tenant key
 * (config lookups, template queries, rate-limit buckets, row inserts)
 * it must use the resolved tenant id instead — the owner's id for
 * members, their own id for owners.
 *
 * RLS mirrors this via has_team_access()/tenant_id() (migration 024),
 * so even unpatched queries fail safe: a member can never *see* another
 * tenant, at worst they see nothing.
 */
export async function resolveTenantUserId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  authUserId: string
): Promise<string> {
  const { data } = await supabase
    .from('team_members')
    .select('owner_user_id')
    .eq('member_user_id', authUserId)
    .eq('status', 'active')
    .maybeSingle()
  return (data?.owner_user_id as string | undefined) ?? authUserId
}
