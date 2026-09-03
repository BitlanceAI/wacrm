import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { verifyWebhookSignature } from '@/lib/billing/razorpay'
import { activatePlatformSubscription } from '@/lib/billing/platform'

/**
 * Razorpay webhook — the backstop confirmation path. Configure in the
 * Razorpay dashboard: URL https://<host>/api/razorpay/webhook, events
 * `payment.captured` + `payment.failed`, secret = RAZORPAY_WEBHOOK_SECRET.
 *
 * Signature is verified over the RAW body (fail-closed), so the body
 * is read as text before parsing. Always 200 after verification —
 * Razorpay retries non-2xx, and a payment for an order we don't know
 * isn't going to become known on retry.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-razorpay-signature')

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: {
    event?: string
    payload?: {
      payment?: {
        entity?: {
          id?: string
          order_id?: string
          error_description?: string | null
        }
      }
    }
  }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const payment = event.payload?.payment?.entity
  const orderId = payment?.order_id
  const paymentId = payment?.id
  const admin = getAdminClient()

  if (event.event === 'payment.captured' && orderId && paymentId) {
    const result = await activatePlatformSubscription(admin, { orderId, paymentId })
    if (!result.activated) {
      console.error(
        `[razorpay/webhook] captured but not activated (order ${orderId}): ${result.reason}`
      )
    }
  } else if (event.event === 'payment.failed' && orderId) {
    // Only downgrade rows still pending — a captured payment that
    // arrives out of order must not be overwritten as failed.
    await admin
      .from('platform_payments')
      .update({
        status: 'failed',
        razorpay_payment_id: paymentId ?? null,
        error_message: payment?.error_description ?? 'Payment failed',
      })
      .eq('razorpay_order_id', orderId)
      .eq('status', 'created')
  }

  return NextResponse.json({ received: true })
}
