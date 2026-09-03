import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Platform-subscription state transitions (WACRM's own plans, paid via
 * Razorpay). Shared by the checkout-verify route and the webhook so a
 * payment activates identically whichever confirmation lands first.
 * All writes run on the service-role client — the tables have no
 * client write policies (migration 025).
 */

export type PlanInterval = 'monthly' | 'yearly'

export function nextPeriodEnd(from: Date, interval: PlanInterval): Date {
  const end = new Date(from)
  if (interval === 'yearly') end.setFullYear(end.getFullYear() + 1)
  else end.setMonth(end.getMonth() + 1)
  return end
}

/**
 * Mark the payment row paid and upsert the subscription. Idempotent on
 * the order id: a payment already recorded as `paid` is a no-op, so
 * the checkout callback and the webhook can both fire safely.
 *
 * A renewal/upgrade extends from the later of "now" and the current
 * period end — paying early never loses remaining days.
 */
export async function activatePlatformSubscription(
  admin: SupabaseClient,
  params: {
    orderId: string
    paymentId: string
  }
): Promise<{ activated: boolean; reason?: string }> {
  const { data: payment } = await admin
    .from('platform_payments')
    .select('*')
    .eq('razorpay_order_id', params.orderId)
    .maybeSingle()
  if (!payment) return { activated: false, reason: 'unknown order' }
  if (payment.status === 'paid') return { activated: true } // already handled

  const { error: payErr } = await admin
    .from('platform_payments')
    .update({
      status: 'paid',
      razorpay_payment_id: params.paymentId,
      error_message: null,
    })
    .eq('id', payment.id)
  if (payErr) return { activated: false, reason: payErr.message }

  const now = new Date()
  const { data: existing } = await admin
    .from('platform_subscriptions')
    .select('id, current_period_end, status')
    .eq('user_id', payment.user_id)
    .maybeSingle()

  const base =
    existing && existing.status === 'active'
      ? new Date(
          Math.max(now.getTime(), new Date(existing.current_period_end).getTime())
        )
      : now
  const periodEnd = nextPeriodEnd(base, payment.interval as PlanInterval)

  const { error: subErr } = await admin.from('platform_subscriptions').upsert(
    {
      user_id: payment.user_id,
      plan_slug: payment.plan_slug,
      interval: payment.interval,
      status: 'active',
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      razorpay_order_id: params.orderId,
      razorpay_payment_id: params.paymentId,
      updated_at: now.toISOString(),
    },
    { onConflict: 'user_id' }
  )
  if (subErr) return { activated: false, reason: subErr.message }
  return { activated: true }
}

/**
 * Seat limit for a tenant owner. With an active paid subscription the
 * plan decides (plans.max_seats; NULL = unlimited). Without one the
 * pre-payments flat cap of 25 stays, so nobody who signed up before
 * billing existed gets locked out of their team.
 */
export async function resolveSeatLimit(
  admin: SupabaseClient,
  ownerUserId: string
): Promise<number> {
  const FALLBACK = 25
  const { data: sub } = await admin
    .from('platform_subscriptions')
    .select('plan_slug, status, current_period_end')
    .eq('user_id', ownerUserId)
    .maybeSingle()
  if (
    !sub ||
    sub.status !== 'active' ||
    new Date(sub.current_period_end).getTime() < Date.now()
  ) {
    return FALLBACK
  }
  const { data: plan } = await admin
    .from('plans')
    .select('max_seats')
    .eq('slug', sub.plan_slug)
    .maybeSingle()
  if (!plan) return FALLBACK
  // NULL max_seats = unlimited. Seats count members; the owner is free.
  return plan.max_seats == null ? Number.POSITIVE_INFINITY : Math.max(0, plan.max_seats - 1)
}
