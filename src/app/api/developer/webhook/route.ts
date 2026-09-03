import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateWebhookSecret } from '@/lib/developer/keys'

/**
 * Developer webhook subscription management (session-authenticated,
 * one subscription per user). The signing secret is generated
 * server-side and IS returned to the owner — they need it on their
 * server to verify our X-Wacrm-Signature headers.
 */

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('developer_webhooks')
    .select('url, secret, active, last_delivery_at, last_error')
    .maybeSingle()
  return NextResponse.json({ webhook: data ?? null })
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const url = typeof body.url === 'string' ? body.url.trim() : undefined
    const active = typeof body.active === 'boolean' ? body.active : undefined
    const rotateSecret = body.rotate_secret === true

    if (url !== undefined && url !== '' && !/^https:\/\/.+/i.test(url)) {
      return NextResponse.json(
        { error: 'Webhook URL must be https://' },
        { status: 400 }
      )
    }

    const { data: existing } = await supabase
      .from('developer_webhooks')
      .select('id, url, active')
      .maybeSingle()

    if (!existing) {
      if (!url) {
        return NextResponse.json({ error: 'url is required' }, { status: 400 })
      }
      const { data: created, error } = await supabase
        .from('developer_webhooks')
        .insert({
          user_id: user.id,
          url,
          secret: generateWebhookSecret(),
          active: active ?? true,
        })
        .select('url, secret, active, last_delivery_at, last_error')
        .single()
      if (error) {
        return NextResponse.json({ error: 'Failed to save webhook' }, { status: 500 })
      }
      return NextResponse.json({ webhook: created })
    }

    const patch: Record<string, unknown> = {}
    if (url !== undefined && url !== '') patch.url = url
    if (active !== undefined) patch.active = active
    // Rotating invalidates the old secret immediately — deliberate:
    // that's the point of rotation after a suspected leak.
    if (rotateSecret) patch.secret = generateWebhookSecret()

    const { data: updated, error } = await supabase
      .from('developer_webhooks')
      .update(patch)
      .eq('id', existing.id)
      .select('url, secret, active, last_delivery_at, last_error')
      .single()
    if (error) {
      return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 })
    }
    return NextResponse.json({ webhook: updated })
  } catch (err) {
    console.error('[developer/webhook] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
