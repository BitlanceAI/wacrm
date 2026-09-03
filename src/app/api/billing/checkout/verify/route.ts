import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { verifyCheckoutSignature } from '@/lib/billing/razorpay'
import { activatePlatformSubscription } from '@/lib/billing/platform'

/**
 * Razorpay Checkout success callback. The signature (HMAC of
 * `order_id|payment_id` with the key secret) proves the payment is
 * real; only then does the subscription activate. The webhook covers
 * browsers that die before this call lands.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const orderId = String(body.razorpay_order_id ?? '')
  const paymentId = String(body.razorpay_payment_id ?? '')
  const signature = String(body.razorpay_signature ?? '')
  if (!orderId || !paymentId || !signature) {
    return NextResponse.json({ error: 'Missing payment fields' }, { status: 400 })
  }

  if (!verifyCheckoutSignature({ orderId, paymentId, signature })) {
    return NextResponse.json(
      { error: 'Payment verification failed' },
      { status: 400 }
    )
  }

  const admin = getAdminClient()
  // The order must be one this user started — a valid signature for
  // someone else's order shouldn't activate under this account.
  const { data: payment } = await admin
    .from('platform_payments')
    .select('user_id')
    .eq('razorpay_order_id', orderId)
    .maybeSingle()
  if (!payment || payment.user_id !== user.id) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const result = await activatePlatformSubscription(admin, { orderId, paymentId })
  if (!result.activated) {
    console.error('[billing/verify] activation failed:', result.reason)
    return NextResponse.json(
      { error: 'Payment received but activation failed — contact support.' },
      { status: 500 }
    )
  }
  return NextResponse.json({ success: true })
}
