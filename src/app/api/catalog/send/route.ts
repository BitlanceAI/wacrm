import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sendCatalogMessage,
  sendProductMessage,
  sendProductList,
} from '@/lib/whatsapp/meta-api'
import {
  sanitizePhoneForMeta,
  isValidE164,
} from '@/lib/whatsapp/phone-utils'
import { botOutboundPatch } from '@/lib/conversations/response-metrics'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { resolveTenantUserId } from '@/lib/team/tenant'

/**
 * Send a catalog card, a single product, or a curated product list into
 * a conversation.
 *
 * One route for all three because they differ only in payload shape —
 * the auth, the config lookup, the phone sanitisation and the message
 * persistence are identical, and three near-identical routes would
 * drift apart the first time one of them was fixed.
 *
 * These are interactive messages, so like any non-template send they
 * only reach customers inside the 24-hour service window.
 */

type SendKind = 'catalog' | 'product' | 'product_list'

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

    const limit = checkRateLimit(`catalog-send:${tenantId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json()
    const kind: SendKind = body.kind ?? 'catalog'
    const conversationId: string = body.conversation_id

    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 }
      )
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, contact_id, contact:contacts(id, phone)')
      .eq('id', conversationId)
      .maybeSingle()
    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const contact = (
      Array.isArray(conversation.contact)
        ? conversation.contact[0]
        : conversation.contact
    ) as { id: string; phone: string } | null
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact has no phone number' },
        { status: 400 }
      )
    }

    const to = sanitizePhoneForMeta(contact.phone)
    if (!isValidE164(to)) {
      return NextResponse.json(
        { error: 'Contact phone is not a valid E.164 number' },
        { status: 400 }
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', tenantId)
      .single()
    if (configError || !config) {
      return NextResponse.json(
        { error: 'WhatsApp is not configured for this account' },
        { status: 400 }
      )
    }

    const catalogId: string | null = body.catalog_id ?? config.catalog_id ?? null
    if (kind !== 'catalog' && !catalogId) {
      return NextResponse.json(
        {
          error:
            'No catalog id configured. Set it in Settings → WhatsApp Configuration, or pass catalog_id.',
        },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)
    const bodyText: string = body.body_text ?? 'Here’s our catalog.'

    let messageId: string
    let preview: string
    try {
      if (kind === 'product') {
        if (!body.retailer_id) {
          return NextResponse.json(
            { error: 'retailer_id is required to send a product' },
            { status: 400 }
          )
        }
        const result = await sendProductMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to,
          catalogId: catalogId!,
          retailerId: body.retailer_id,
          bodyText,
          footerText: body.footer_text,
        })
        messageId = result.messageId
        preview = `[product] ${body.retailer_id}`
      } else if (kind === 'product_list') {
        const result = await sendProductList({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to,
          catalogId: catalogId!,
          headerText: body.header_text ?? 'Our products',
          bodyText,
          footerText: body.footer_text,
          sections: body.sections ?? [],
        })
        messageId = result.messageId
        const count = (body.sections ?? []).reduce(
          (sum: number, s: { retailerIds: string[] }) => sum + s.retailerIds.length,
          0
        )
        preview = `[product list] ${count} items`
      } else {
        const result = await sendCatalogMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to,
          bodyText,
          footerText: body.footer_text,
          thumbnailRetailerId: body.thumbnail_retailer_id,
        })
        messageId = result.messageId
        preview = '[catalog]'
      }
    } catch (sendError) {
      const message =
        sendError instanceof Error ? sendError.message : 'Unknown error'
      console.error('[catalog/send] failed:', message)
      return NextResponse.json({ error: message }, { status: 502 })
    }

    // Persisted as `interactive` so the thread shows it and the 24-hour
    // window bookkeeping stays consistent with every other send.
    const admin = supabaseAdmin()
    await admin.from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: 'interactive',
      content_text: preview,
      message_id: messageId,
      status: 'sent',
    })
    await admin
      .from('conversations')
      .update({
        last_message_text: preview,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...botOutboundPatch(),
      })
      .eq('id', conversationId)

    return NextResponse.json({ sent: true, message_id: messageId })
  } catch (error) {
    console.error('[catalog/send] unhandled exception:', error)
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 })
  }
}
