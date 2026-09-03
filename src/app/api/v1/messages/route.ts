import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateApiKey } from '@/lib/developer/auth'
import { engineSendText, engineSendTemplate } from '@/lib/automations/meta-send'
import {
  getTemplateSendBlocker,
  getTemplateHeaderRequirement,
} from '@/lib/whatsapp/template-capabilities'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

/**
 * Developer API v1 — send a message.
 *
 * POST /api/v1/messages
 * Authorization: Bearer wak_live_…
 *
 * Text (inside the 24-hour customer service window):
 *   { "to": "919876543210", "type": "text", "text": "Hello!" }
 *
 * Template (any time):
 *   { "to": "919876543210", "type": "template",
 *     "template_name": "order_update", "language": "en_US",
 *     "params": ["John", "#1042"], "header_value": "https://…jpg" }
 *
 * The contact and conversation are created if they don't exist, and
 * the sent message appears in the inbox thread (sender_type 'bot'),
 * so bot and human agents share one view of the conversation.
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

export async function POST(request: Request) {
  try {
    const auth = await authenticateApiKey(request)
    if (!auth) {
      return NextResponse.json(
        { error: 'Invalid or missing API key' },
        { status: 401 }
      )
    }

    const limit = checkRateLimit(`v1send:${auth.userId}`, {
      limit: 60,
      windowMs: 60_000,
    })
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const to = normalizePhone(String(body.to ?? ''))
    const type = body.type === 'template' ? 'template' : 'text'
    if (!to || to.length < 7) {
      return NextResponse.json(
        { error: '`to` must be a phone number with country code' },
        { status: 400 }
      )
    }
    if (type === 'text' && !String(body.text ?? '').trim()) {
      return NextResponse.json({ error: '`text` is required' }, { status: 400 })
    }
    if (type === 'template' && !String(body.template_name ?? '').trim()) {
      return NextResponse.json(
        { error: '`template_name` is required' },
        { status: 400 }
      )
    }

    const db = admin()

    // Find-or-create contact + conversation, scoped to the key's tenant.
    let { data: contact } = await db
      .from('contacts')
      .select('id, phone, name')
      .eq('user_id', auth.userId)
      .eq('phone', to)
      .maybeSingle()
    if (!contact) {
      const { data: created, error: contactErr } = await db
        .from('contacts')
        .insert({ user_id: auth.userId, phone: to, name: to })
        .select('id, phone, name')
        .single()
      if (contactErr || !created) {
        return NextResponse.json(
          { error: 'Failed to create contact' },
          { status: 500 }
        )
      }
      contact = created
    }

    let { data: conversation } = await db
      .from('conversations')
      .select('id')
      .eq('user_id', auth.userId)
      .eq('contact_id', contact.id)
      .maybeSingle()
    if (!conversation) {
      const { data: created, error: convErr } = await db
        .from('conversations')
        .insert({ user_id: auth.userId, contact_id: contact.id })
        .select('id')
        .single()
      if (convErr || !created) {
        return NextResponse.json(
          { error: 'Failed to create conversation' },
          { status: 500 }
        )
      }
      conversation = created
    }

    let result: { whatsapp_message_id: string }
    if (type === 'text') {
      result = await engineSendText({
        userId: auth.userId,
        conversationId: conversation.id,
        contactId: contact.id,
        text: String(body.text).trim(),
      })
    } else {
      const templateName = String(body.template_name).trim()
      const language = String(body.language ?? 'en_US').trim()

      // Same preflight the broadcast pipeline runs: fail with a
      // reason instead of letting Meta reject with #132012.
      const { data: templateRows } = await db
        .from('message_templates')
        .select('body_text, header_type, header_content')
        .eq('user_id', auth.userId)
        .eq('name', templateName)
        .eq('language', language)
        .limit(1)
      const templateRow = templateRows?.[0] ?? null

      let header
      if (templateRow) {
        const blocker = getTemplateSendBlocker(templateRow)
        if (blocker) {
          return NextResponse.json(
            { error: blocker, code: 'TEMPLATE_SHAPE_UNSUPPORTED' },
            { status: 400 }
          )
        }
        const requirement = getTemplateHeaderRequirement(templateRow)
        if (requirement) {
          const value = String(body.header_value ?? '').trim()
          if (!value) {
            return NextResponse.json(
              {
                error:
                  requirement.kind === 'media'
                    ? `Template "${templateName}" needs \`header_value\`: a public https URL for its ${requirement.mediaType} header.`
                    : `Template "${templateName}" needs \`header_value\`: the value for the {{N}} variable in its header.`,
                code: 'TEMPLATE_HEADER_REQUIRED',
              },
              { status: 400 }
            )
          }
          header =
            requirement.kind === 'media'
              ? { type: requirement.mediaType, value }
              : { type: 'text' as const, value }
        }
      }

      result = await engineSendTemplate({
        userId: auth.userId,
        conversationId: conversation.id,
        contactId: contact.id,
        templateName,
        language,
        params: Array.isArray(body.params) ? body.params.map(String) : [],
        header,
      })
    }

    return NextResponse.json({
      success: true,
      message_id: result.whatsapp_message_id,
      contact_id: contact.id,
      conversation_id: conversation.id,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Send failed'
    // Meta-side rejections come through as thrown errors with the
    // upstream reason — surface them as 502 so callers can tell "my
    // request was bad" (400) from "Meta refused" (502).
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
