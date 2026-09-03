import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateApiKey } from '@/lib/developer/keys'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

/**
 * API-key management for the Developers panel (session-authenticated,
 * RLS-scoped). Creation lives server-side because only the server may
 * see the plaintext long enough to return it once; listing happens
 * client-side straight from Supabase.
 */

const MAX_ACTIVE_KEYS = 10

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limit = checkRateLimit(`devkeys:${user.id}`, {
      limit: 10,
      windowMs: 60_000,
    })
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => ({}))
    const name = String(body.name ?? '').trim().slice(0, 60) || 'API key'

    const { count } = await supabase
      .from('api_keys')
      .select('id', { count: 'exact', head: true })
      .is('revoked_at', null)
    if ((count ?? 0) >= MAX_ACTIVE_KEYS) {
      return NextResponse.json(
        { error: `Limit of ${MAX_ACTIVE_KEYS} active keys reached — revoke one first.` },
        { status: 400 }
      )
    }

    const key = generateApiKey()
    const { data: row, error } = await supabase
      .from('api_keys')
      .insert({
        user_id: user.id,
        name,
        key_hash: key.hash,
        key_prefix: key.prefix,
      })
      .select('id, name, key_prefix, created_at')
      .single()

    if (error) {
      console.error('[developer/keys] insert failed:', error)
      return NextResponse.json({ error: 'Failed to create key' }, { status: 500 })
    }

    // The one and only time the plaintext leaves the server.
    return NextResponse.json({ ...row, key: key.plaintext })
  } catch (err) {
    console.error('[developer/keys] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    // Revoke rather than delete: keeps the audit trail (name, last
    // used) visible in the panel, and a revoked hash can never match.
    const { error } = await supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json({ error: 'Failed to revoke key' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[developer/keys] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
