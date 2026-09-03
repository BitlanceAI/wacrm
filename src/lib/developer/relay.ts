import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

/**
 * Outbound event relay: forwards inbound WhatsApp messages to the
 * user's configured developer webhook so external chatbots can react.
 *
 * The delivery is signed exactly the way Meta signs webhooks to us —
 * `X-Wacrm-Signature: sha256=<hex HMAC-SHA256 of the raw body>` using
 * the subscription's whsec_… secret — so developers can reuse the
 * same verification pattern everywhere.
 *
 * Best-effort by design: a dead endpoint must never break inbound
 * processing. Failures are recorded on the subscription row
 * (last_error) for debugging in the Developers panel.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function admin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _admin
}

export interface InboundMessageEvent {
  contact: { id: string; phone: string; name: string | null }
  conversation_id: string
  message: {
    whatsapp_message_id: string
    type: string
    text: string | null
    media_url: string | null
    /** Button/list reply id for interactive taps, else null. */
    interactive_reply_id: string | null
    timestamp: string
  }
}

const DELIVERY_TIMEOUT_MS = 5000

export async function relayInboundToDeveloperWebhook(
  userId: string,
  event: InboundMessageEvent
): Promise<void> {
  try {
    const { data: sub } = await admin()
      .from('developer_webhooks')
      .select('id, url, secret, active')
      .eq('user_id', userId)
      .maybeSingle()

    if (!sub || !sub.active || !sub.url) return

    const body = JSON.stringify({
      event: 'message.received',
      created_at: new Date().toISOString(),
      data: event,
    })
    const signature =
      'sha256=' +
      crypto.createHmac('sha256', sub.secret).update(body).digest('hex')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)
    let deliveryError: string | null = null
    try {
      const res = await fetch(sub.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Wacrm-Signature': signature,
          'X-Wacrm-Event': 'message.received',
        },
        body,
        signal: controller.signal,
      })
      if (!res.ok) deliveryError = `Endpoint responded ${res.status}`
    } catch (err) {
      deliveryError =
        err instanceof Error ? err.message : 'Delivery request failed'
    } finally {
      clearTimeout(timer)
    }

    await admin()
      .from('developer_webhooks')
      .update(
        deliveryError
          ? { last_error: deliveryError }
          : { last_delivery_at: new Date().toISOString(), last_error: null }
      )
      .eq('id', sub.id)

    if (deliveryError) {
      console.warn(
        `[developer-webhook] delivery failed for user=${userId}: ${deliveryError}`
      )
    }
  } catch (err) {
    console.warn('[developer-webhook] relay error:', err)
  }
}
