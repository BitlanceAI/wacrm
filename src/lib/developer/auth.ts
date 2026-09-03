import { createClient } from '@supabase/supabase-js'
import { hashApiKey, looksLikeApiKey } from '@/lib/developer/keys'

/**
 * Bearer-key authentication for the public /api/v1/* endpoints.
 *
 * Uses the service-role client: these requests carry no Supabase
 * session, so RLS can't scope them — the key row itself provides the
 * tenant (user_id), and every downstream query in v1 routes must
 * filter by that id explicitly.
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

export interface ApiKeyAuth {
  userId: string
  keyId: string
}

/**
 * Resolve the Authorization: Bearer wak_live_… header to a tenant.
 * Returns null for missing/invalid/revoked keys — callers respond 401.
 */
export async function authenticateApiKey(
  request: Request
): Promise<ApiKeyAuth | null> {
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const candidate = match[1].trim()
  if (!looksLikeApiKey(candidate)) return null

  const { data: key, error } = await admin()
    .from('api_keys')
    .select('id, user_id, revoked_at')
    .eq('key_hash', hashApiKey(candidate))
    .maybeSingle()

  if (error || !key || key.revoked_at) return null

  // Best-effort usage stamp — never block the request on it.
  admin()
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id)
    .then(({ error: e }: { error: unknown }) => {
      if (e) console.warn('[v1] last_used_at update failed:', e)
    })

  return { userId: key.user_id, keyId: key.id }
}
