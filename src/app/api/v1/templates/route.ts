import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateApiKey } from '@/lib/developer/auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

/**
 * Developer API v1 — list sendable templates.
 *
 * GET /api/v1/templates
 * Authorization: Bearer wak_live_…
 *
 * Returns Approved templates only — the ones POST /api/v1/messages
 * will actually accept.
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

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request)
  if (!auth) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 })
  }

  const limit = checkRateLimit(`v1read:${auth.userId}`, {
    limit: 120,
    windowMs: 60_000,
  })
  if (!limit.success) return rateLimitResponse(limit)

  const { data, error } = await admin()
    .from('message_templates')
    .select('name, language, category, header_type, header_content, body_text, footer_text, status')
    .eq('user_id', auth.userId)
    .eq('status', 'Approved')
    .order('name')

  if (error) {
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 })
  }
  return NextResponse.json({ templates: data ?? [] })
}
