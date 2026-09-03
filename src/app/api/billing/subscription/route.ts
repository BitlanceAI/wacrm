import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { resolveTenantUserId } from '@/lib/team/tenant'
import { isRazorpayConfigured } from '@/lib/billing/razorpay'

/**
 * Current WACRM plan for this workspace + the purchasable tiers.
 * Members may look (read-only context for the banner); only the owner
 * gets checkout from the /api/billing/checkout route.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await resolveTenantUserId(supabase, user.id)
  const admin = getAdminClient()

  const [{ data: subscription }, { data: plans }] = await Promise.all([
    admin
      .from('platform_subscriptions')
      .select('plan_slug, interval, status, current_period_start, current_period_end')
      .eq('user_id', tenantId)
      .maybeSingle(),
    admin
      .from('plans')
      .select(
        'slug, name, description, price_monthly_minor, price_yearly_minor, currency, max_seats, highlight, sort_order'
      )
      .eq('active', true)
      .order('sort_order', { ascending: true }),
  ])

  return NextResponse.json({
    configured: isRazorpayConfigured(),
    is_owner: tenantId === user.id,
    subscription: subscription ?? null,
    plans: plans ?? [],
  })
}
