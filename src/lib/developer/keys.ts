import crypto from 'node:crypto'

/**
 * API key generation and hashing for the Developer API.
 *
 * Keys look like `wak_live_<64 hex chars>`. Only the SHA-256 hash is
 * stored (api_keys.key_hash); the plaintext exists exactly once, in
 * the creation response. A leaked database therefore leaks no usable
 * keys.
 */

const KEY_PREFIX = 'wak_live_'

export interface GeneratedApiKey {
  /** Full key — return to the user once, never store. */
  plaintext: string
  /** SHA-256 hex of the full key — what api_keys.key_hash stores. */
  hash: string
  /** Display fragment, e.g. "wak_live_a1b2c3d4…". */
  prefix: string
}

export function generateApiKey(): GeneratedApiKey {
  const body = crypto.randomBytes(32).toString('hex')
  const plaintext = `${KEY_PREFIX}${body}`
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    prefix: `${KEY_PREFIX}${body.slice(0, 8)}…`,
  }
}

export function hashApiKey(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex')
}

export function looksLikeApiKey(candidate: string): boolean {
  return candidate.startsWith(KEY_PREFIX) && candidate.length > KEY_PREFIX.length + 30
}

/** Webhook signing secret for developer_webhooks.secret. */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('hex')}`
}
