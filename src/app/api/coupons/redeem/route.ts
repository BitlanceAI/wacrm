import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  couponRejection,
  couponRejectionMessage,
  discountForOrder,
  normalizeCouponCode,
} from '@/lib/retention/loyalty'
import { resolveTenantUserId } from '@/lib/team/tenant'

/**
 * Redeem a coupon, optionally against an order.
 *
 * Validation happens against live state — active flag, window,
 * remaining redemptions, and whether this contact has used it before —
 * and every rejection names its specific reason. "Invalid code" is the
 * answer that generates a support message; "that code expired on the
 * 3rd" is the answer that doesn't.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = await resolveTenantUserId(supabase, user.id)

    const body = await request.json()
    const code = normalizeCouponCode(body.code ?? '')
    if (!code) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 })
    }

    const { data: coupon, error: findError } = await supabase
      .from('coupons')
      .select('*')
      .eq('user_id', tenantId)
      .eq('code', code)
      .maybeSingle()
    if (findError || !coupon) {
      return NextResponse.json(
        { error: `No coupon found with the code ${code}` },
        { status: 404 }
      )
    }

    const rejection = couponRejection(coupon)
    if (rejection) {
      return NextResponse.json(
        { error: couponRejectionMessage(rejection, coupon), reason: rejection },
        { status: 400 }
      )
    }

    // Order lookup first: a percentage discount is meaningless without
    // the total it applies to.
    let orderTotalMinor = Number(body.order_total_minor ?? 0)
    let orderId: string | null = body.order_id ?? null
    if (orderId) {
      const { data: order } = await supabase
        .from('orders')
        .select('id, total_minor')
        .eq('id', orderId)
        .maybeSingle()
      if (!order) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }
      orderTotalMinor = order.total_minor
      orderId = order.id
    }

    const discount = discountForOrder(coupon, orderTotalMinor)

    const { data: redemption, error: insertError } = await supabase
      .from('coupon_redemptions')
      .insert({
        coupon_id: coupon.id,
        user_id: tenantId,
        contact_id: body.contact_id ?? null,
        order_id: orderId,
        discount_applied_minor: discount,
      })
      .select()
      .single()

    if (insertError) {
      // 23505 is the once-per-contact unique index.
      return NextResponse.json(
        {
          error:
            insertError.code === '23505'
              ? `This contact has already used ${code}.`
              : insertError.message,
          reason: insertError.code === '23505' ? 'already_used' : undefined,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      redemption,
      discount_applied_minor: discount,
    })
  } catch (error) {
    console.error('[coupons/redeem] unhandled exception:', error)
    return NextResponse.json({ error: 'Failed to redeem coupon' }, { status: 500 })
  }
}
