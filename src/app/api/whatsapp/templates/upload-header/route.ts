import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import { uploadTemplateHeaderMedia } from '@/lib/whatsapp/meta-api'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { resolveTenantUserId } from '@/lib/team/tenant'

/**
 * Upload a header media file for template creation, returning Meta's
 * resumable-upload handle (`h:…`). Template creation requires this
 * handle for image/video/document header examples — a phone-number
 * media id will NOT work there.
 *
 * Needs NEXT_PUBLIC_META_APP_ID: the Resumable Upload API is scoped to
 * the app, not the phone number.
 */

const MAX_BYTES = 16 * 1024 * 1024 // matches Meta's video cap; images/pdfs are smaller anyway

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'video/mp4',
  'application/pdf',
])

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

    const limit = checkRateLimit(`template-upload:${tenantId}`, {
      limit: 10,
      windowMs: 60_000,
    })
    if (!limit.success) return rateLimitResponse(limit)

    const appId = process.env.NEXT_PUBLIC_META_APP_ID
    if (!appId) {
      return NextResponse.json(
        {
          error:
            'Media headers need NEXT_PUBLIC_META_APP_ID configured on the server (the upload API is app-scoped). Create this template in WhatsApp Manager instead.',
        },
        { status: 500 }
      )
    }

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Attach the media as `file`.' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported type ${file.type || '(unknown)'} — use JPEG/PNG, MP4, or PDF.` },
        { status: 400 }
      )
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (${Math.round(file.size / 1024 / 1024)} MB, max 16 MB).` },
        { status: 400 }
      )
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('access_token')
      .eq('user_id', tenantId)
      .maybeSingle()
    if (!config?.access_token) {
      return NextResponse.json(
        { error: 'Connect your WhatsApp Business account first.' },
        { status: 400 }
      )
    }
    const accessToken = decrypt(config.access_token)

    const { handle } = await uploadTemplateHeaderMedia({
      appId,
      accessToken,
      fileName: file.name || 'header',
      fileType: file.type,
      data: await file.arrayBuffer(),
    })

    return NextResponse.json({ success: true, handle })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed'
    console.error('[templates/upload-header] error:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
