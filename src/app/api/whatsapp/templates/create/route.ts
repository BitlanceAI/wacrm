import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  createMessageTemplate,
  type CreateTemplateButton,
} from '@/lib/whatsapp/meta-api'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { resolveTenantUserId } from '@/lib/team/tenant'

/**
 * Create a template ON Meta (submit for review), then cache it locally.
 *
 * This replaces the old local-only "draft" creation: a draft that Meta
 * has never seen can never be sent (#132001), so the only creation
 * worth offering is the one that actually submits for approval.
 *
 * Meta rules enforced here rather than discovered as opaque API errors:
 * - name: lowercase letters/digits/underscores, ≤512 chars
 * - every {{N}} body placeholder needs a sample value (review is done
 *   against a rendered example)
 * - AUTHENTICATION templates have a fixed Meta-defined shape and must
 *   be created in WhatsApp Manager, so this route refuses them.
 */

const NAME_RE = /^[a-z0-9_]{1,512}$/
const PLACEHOLDER_RE = /\{\{(\d+)\}\}/g

interface CreateBody {
  name?: string
  language?: string
  category?: string
  body_text?: string
  body_examples?: string[]
  header_type?: 'text' | 'image' | 'video' | 'document' | null
  header_text?: string
  header_text_example?: string
  header_handle?: string
  footer_text?: string
  buttons?: CreateTemplateButton[]
}

function countPlaceholders(text: string): number {
  const seen = new Set<string>()
  for (const m of text.matchAll(PLACEHOLDER_RE)) seen.add(m[1])
  return seen.size
}

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

    // Meta caps template creation at 100/hour per WABA; a human
    // authoring templates never approaches 10/minute.
    const limit = checkRateLimit(`template-create:${tenantId}`, {
      limit: 10,
      windowMs: 60_000,
    })
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json()) as CreateBody
    const name = (body.name ?? '').trim()
    const language = (body.language ?? '').trim() || 'en_US'
    const category = (body.category ?? '').toUpperCase()
    const bodyText = (body.body_text ?? '').trim()

    if (!NAME_RE.test(name)) {
      return NextResponse.json(
        {
          error:
            'Template name must use only lowercase letters, numbers and underscores (e.g. order_update).',
        },
        { status: 400 }
      )
    }
    if (!bodyText) {
      return NextResponse.json({ error: 'Body text is required.' }, { status: 400 })
    }
    if (category !== 'MARKETING' && category !== 'UTILITY') {
      return NextResponse.json(
        {
          error:
            category === 'AUTHENTICATION'
              ? 'Authentication templates have a fixed Meta-defined format — create them in WhatsApp Manager (Manage Templates on Meta), then Sync.'
              : 'Category must be MARKETING or UTILITY.',
        },
        { status: 400 }
      )
    }

    // Every body variable needs a sample.
    const bodyVarCount = countPlaceholders(bodyText)
    const bodyExamples = (body.body_examples ?? [])
      .map((s) => String(s).trim())
      .filter(Boolean)
    if (bodyVarCount > 0 && bodyExamples.length !== bodyVarCount) {
      return NextResponse.json(
        {
          error: `Body has ${bodyVarCount} variable(s) — provide a sample value for each (got ${bodyExamples.length}). Meta reviews templates against a rendered example.`,
        },
        { status: 400 }
      )
    }

    // Header validation.
    const headerType = body.header_type ?? null
    const headerText = (body.header_text ?? '').trim()
    if (headerType === 'text') {
      if (!headerText) {
        return NextResponse.json(
          { error: 'Header text is required for a text header.' },
          { status: 400 }
        )
      }
      const headerVars = countPlaceholders(headerText)
      if (headerVars > 1) {
        return NextResponse.json(
          { error: 'A text header may contain at most one {{1}} variable.' },
          { status: 400 }
        )
      }
      if (headerVars === 1 && !(body.header_text_example ?? '').trim()) {
        return NextResponse.json(
          { error: 'Provide a sample value for the header variable.' },
          { status: 400 }
        )
      }
    }
    if (
      (headerType === 'image' || headerType === 'video' || headerType === 'document') &&
      !(body.header_handle ?? '').trim()
    ) {
      return NextResponse.json(
        { error: `Upload the ${headerType} for the header first.` },
        { status: 400 }
      )
    }

    // Buttons: light validation, Meta does the strict pass.
    const buttons = (body.buttons ?? []).slice(0, 10)
    for (const b of buttons) {
      if (b.type === 'QUICK_REPLY' && !b.text?.trim())
        return NextResponse.json({ error: 'Quick reply buttons need text.' }, { status: 400 })
      if (b.type === 'URL' && (!b.text?.trim() || !b.url?.trim()))
        return NextResponse.json({ error: 'URL buttons need text and a URL.' }, { status: 400 })
      if (b.type === 'PHONE_NUMBER' && (!b.text?.trim() || !b.phone_number?.trim()))
        return NextResponse.json({ error: 'Phone buttons need text and a phone number.' }, { status: 400 })
      if (b.type === 'COPY_CODE' && !b.example)
        return NextResponse.json({ error: 'Copy-code buttons need an example code.' }, { status: 400 })
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('waba_id, access_token')
      .eq('user_id', tenantId)
      .maybeSingle()

    if (!config?.waba_id || !config?.access_token) {
      return NextResponse.json(
        { error: 'Connect a WhatsApp Business Account (with WABA ID) first.' },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    let created
    try {
      created = await createMessageTemplate({
        wabaId: config.waba_id,
        accessToken,
        name,
        language,
        category,
        bodyText,
        bodyExamples: bodyVarCount > 0 ? bodyExamples : undefined,
        headerType,
        headerText: headerType === 'text' ? headerText : undefined,
        headerTextExample: (body.header_text_example ?? '').trim() || undefined,
        headerHandle: (body.header_handle ?? '').trim() || undefined,
        footerText: (body.footer_text ?? '').trim() || undefined,
        buttons: buttons.length > 0 ? buttons : undefined,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta error'
      return NextResponse.json({ error: `Meta rejected the template: ${message}` }, { status: 502 })
    }

    // Cache locally so it shows up immediately (status Pending until
    // approved; the periodic sync flips it). Stamped with the WABA so
    // account-switch pruning treats it like any synced row.
    const localStatus =
      created.status?.toUpperCase() === 'APPROVED' ? 'Approved' : 'Pending'
    const { error: insertErr } = await supabase.from('message_templates').insert({
      user_id: tenantId,
      waba_id: config.waba_id,
      name,
      language,
      category: category === 'UTILITY' ? 'Utility' : 'Marketing',
      header_type: headerType,
      header_content: headerType === 'text' ? headerText : null,
      body_text: bodyText,
      footer_text: (body.footer_text ?? '').trim() || null,
      buttons: buttons.length > 0 ? buttons : null,
      status: localStatus,
    })
    if (insertErr) {
      // Meta has it; the next sync will pull it in. Non-fatal.
      console.warn('[templates/create] local cache insert failed:', insertErr.message)
    }

    return NextResponse.json({
      success: true,
      id: created.id,
      status: localStatus,
    })
  } catch (error) {
    console.error('[templates/create] Unhandled error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
