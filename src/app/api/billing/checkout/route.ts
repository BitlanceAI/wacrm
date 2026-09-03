import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { resolveTenantUserId } from '@/lib/team/tenant'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  razorpayKeyId,
} from '@/lib/billing/razorpay'

/**
 * Start a plan purchase: create a Razorpay Order for the chosen tier
 * and record it as a `created` platform_payment. The client opens
 * Razorpay Checkout with the returned order id; nothing activates
 * until a signature-verified confirmation (verify route or webhook).
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantId = await resolveTenantUserId(supabase, user.id)
  if (tenantId !== user.id) {
    return NextResponse.json(
      { error: 'Only the workspace owner can manage the subscription.' },
      { status: 403 }
    )
  }

  if (!isRazorpayConfigured()) {
    return NextResponse.json(
      { error: 'Payments are not configured yet. Contact support.' },
      { status: 503 }
    )
  }

  const limit = checkRateLimit(`plan-checkout:${user.id}`, {
    limit: 10,
    windowMs: 60_000,
  })
  if (!limit.success) return rateLimitResponse(limit)

  const body = await request.json().catch(() => ({}))
  const planSlug = String(body.plan_slug ?? '').trim()
  const interval = body.interval === 'yearly' ? 'yearly' : 'monthly'

  const admin = getAdminClient()
  const { data: plan } = await admin
    .from('plans')
    .select('slug, name, price_monthly_minor, price_yearly_minor, currency')
    .eq('slug', planSlug)
    .eq('active', true)
    .maybeSingle()
  if (!plan) {
    return NextResponse.json({ error: 'Unknown plan' }, { status: 400 })
  }

  const amountMinor =
    interval === 'yearly' ? plan.price_yearly_minor : plan.price_monthly_minor
  if (!amountMinor || amountMinor <= 0) {
    return NextResponse.json(
      { error: `The ${plan.name} plan has no ${interval} price.` },
      { status: 400 }
    )
  }

  try {
    const order = await createRazorpayOrder({
      amountMinor,
      currency: plan.currency,
      receipt: `plan_${planSlug}_${Date.now()}`,
      notes: { user_id: user.id, plan_slug: planSlug, interval },
    })

    const { error: insertErr } = await admin.from('platform_payments').insert({
      user_id: user.id,
      plan_slug: planSlug,
      interval,
      amount_minor: amountMinor,
      currency: plan.currency,
      razorpay_order_id: order.id,
      status: 'created',
    })
    if (insertErr) {
      console.error('[billing/checkout] payment insert failed:', insertErr.message)
      return NextResponse.json(
        { error: 'Failed to start the payment. Try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      order_id: order.id,
      key_id: razorpayKeyId(),
      amount: amountMinor,
      currency: plan.currency,
      plan_name: plan.name,
      email: user.email,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment setup failed'
    console.error('[billing/checkout] order creation failed:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
