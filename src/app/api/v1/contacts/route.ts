import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateApiKey } from '@/lib/developer/auth'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

/**
 * Developer API v1 — contacts.
 *
 * GET  /api/v1/contacts?phone=919876543210   — look up one contact
 * POST /api/v1/contacts { phone, name? }     — create (idempotent by phone)
 * Authorization: Bearer wak_live_…
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

const FIELDS = 'id, phone, name, email, company, created_at'

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request)
  if (!auth) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 })
  }
  const limit = checkRateLimit(`v1read:${auth.userId}`, { limit: 120, windowMs: 60_000 })
  if (!limit.success) return rateLimitResponse(limit)

  const { searchParams } = new URL(request.url)
  const phone = normalizePhone(searchParams.get('phone') ?? '')
  if (!phone) {
    return NextResponse.json({ error: '`phone` query param is required' }, { status: 400 })
  }

  const { data } = await admin()
    .from('contacts')
    .select(FIELDS)
    .eq('user_id', auth.userId)
    .eq('phone', phone)
    .maybeSingle()

  if (!data) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }
  return NextResponse.json({ contact: data })
}

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request)
  if (!auth) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 })
  }
  const limit = checkRateLimit(`v1write:${auth.userId}`, { limit: 60, windowMs: 60_000 })
  if (!limit.success) return rateLimitResponse(limit)

  const body = await request.json().catch(() => ({}))
  const phone = normalizePhone(String(body.phone ?? ''))
  if (!phone || phone.length < 7) {
    return NextResponse.json(
      { error: '`phone` must be a phone number with country code' },
      { status: 400 }
    )
  }

  const db = admin()
  const { data: existing } = await db
    .from('contacts')
    .select(FIELDS)
    .eq('user_id', auth.userId)
    .eq('phone', phone)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ contact: existing, created: false })
  }

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      user_id: auth.userId,
      phone,
      name: String(body.name ?? '').trim() || phone,
    })
    .select(FIELDS)
    .single()

  if (error) {
    return NextResponse.json({ error: 'Failed to create contact' }, { status: 500 })
  }
  return NextResponse.json({ contact: created, created: true })
}
