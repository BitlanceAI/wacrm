import crypto from 'node:crypto'

/**
 * Razorpay REST client for platform plan payments — no SDK, three
 * calls: create an order, verify a checkout signature, verify a
 * webhook signature. Server-only (key secret lives here).
 *
 * Env:
 *   RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET — dashboard → API Keys
 *   RAZORPAY_WEBHOOK_SECRET — the secret set when creating the
 *     webhook (dashboard → Webhooks → https://<host>/api/razorpay/webhook)
 */

const API_BASE = 'https://api.razorpay.com/v1'

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
}

export function razorpayKeyId(): string {
  const id = process.env.RAZORPAY_KEY_ID
  if (!id) throw new Error('RAZORPAY_KEY_ID is not set')
  return id
}

function authHeader(): string {
  const id = process.env.RAZORPAY_KEY_ID
  const secret = process.env.RAZORPAY_KEY_SECRET
  if (!id || !secret) throw new Error('Razorpay keys are not configured')
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64')
}

export interface RazorpayOrder {
  id: string
  amount: number
  currency: string
  status: string
}

export async function createRazorpayOrder(params: {
  amountMinor: number
  currency: string
  receipt: string
  notes: Record<string, string>
}): Promise<RazorpayOrder> {
  const res = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: params.amountMinor,
      currency: params.currency,
      receipt: params.receipt.slice(0, 40), // Razorpay caps receipt at 40 chars
      notes: params.notes,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      (data as { error?: { description?: string } })?.error?.description ??
      `Razorpay order creation failed (HTTP ${res.status})`
    throw new Error(msg)
  }
  return data as RazorpayOrder
}

/**
 * Checkout success handler verification: Razorpay signs
 * `order_id|payment_id` with the key secret. Anything that doesn't
 * verify is treated as an unpaid order — the webhook remains the
 * backstop for payments whose browser died mid-callback.
 */
export function verifyCheckoutSignature(params: {
  orderId: string
  paymentId: string
  signature: string
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET
  if (!secret || !params.signature) return false
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${params.orderId}|${params.paymentId}`)
    .digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(params.signature)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Webhook verification: HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret || !signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
