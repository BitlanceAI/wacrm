/**
 * Client-side helpers for keeping the local message_templates cache in
 * step with Meta, so users don't have to remember to press "Sync".
 *
 * Meta is the source of truth; the app keeps a cached copy. These helpers
 * drive two flows:
 *   A. force a sync right after a WhatsApp account is (re)connected, and
 *   B. sync on-open when the cached copy is stale (older than STALE_MS).
 *
 * Staleness is tracked in localStorage — per browser, per user — so there
 * is no schema change and no server scheduler required.
 */

const STALE_MS = 10 * 60 * 1000 // 10 minutes

function keyFor(userId?: string): string {
  return `wacrm:tpl-sync:${userId || 'current'}`
}

export interface TemplateSyncResult {
  ok: boolean
  /** inserted + updated rows on success */
  changed: number
  error?: string
}

/**
 * Unconditionally POST the sync endpoint and normalize the response.
 * Never throws — callers get a result object either way.
 */
export async function syncTemplates(userId?: string): Promise<TemplateSyncResult> {
  try {
    const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' })
    const data = await res.json().catch(() => ({} as Record<string, unknown>))

    if (!res.ok) {
      return {
        ok: false,
        changed: 0,
        error:
          (typeof data.error === 'string' && data.error) ||
          `Sync failed (${res.status})`,
      }
    }

    const inserted = typeof data.inserted === 'number' ? data.inserted : 0
    const updated = typeof data.updated === 'number' ? data.updated : 0
    // Mark fresh so an on-open stale check won't immediately re-fire.
    stampSynced(userId)
    return { ok: true, changed: inserted + updated }
  } catch (err) {
    return {
      ok: false,
      changed: 0,
      error: err instanceof Error ? err.message : 'Sync request failed',
    }
  }
}

/** Record "synced just now" for the staleness check. */
export function stampSynced(userId?: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(keyFor(userId), String(Date.now()))
}

/**
 * Sync only when the cached copy is stale (or never synced this browser).
 * Silent by design: failures (e.g. WABA ID not set yet) are swallowed so
 * they never block a page — the manual Sync button surfaces real errors.
 *
 * Returns true only when a sync ran AND changed at least one row, so the
 * caller can decide whether to refetch the template list.
 */
export async function maybeSyncTemplates(userId?: string): Promise<boolean> {
  if (typeof window === 'undefined') return false

  const key = keyFor(userId)
  const last = Number(window.localStorage.getItem(key) || 0)
  if (Date.now() - last < STALE_MS) return false

  // Optimistically stamp now so a second mount doesn't fire a duplicate
  // sync while this one is in flight.
  stampSynced(userId)

  const result = await syncTemplates(userId)
  if (!result.ok) {
    // Roll the stamp back so a later visit can retry sooner.
    window.localStorage.removeItem(key)
    return false
  }
  return result.changed > 0
}
