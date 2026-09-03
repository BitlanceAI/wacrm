/**
 * Slash-command matching for canned replies (migration 016).
 *
 * Pure string handling, kept out of the composer so the trigger rules
 * are testable — an over-eager trigger that hijacks the composer every
 * time an agent types a URL would be worse than no feature at all.
 */
import type { CannedReply } from '@/types'

/**
 * Canonical form of a shortcut: lowercase, no leading slash, no spaces.
 * Applied on save AND on lookup so "/Hours" and "hours" are the same
 * snippet rather than two rows the CHECK constraint can't tell apart.
 */
export function normalizeShortcut(raw: string): string {
  return raw
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32)
}

/** True when a normalized shortcut satisfies the DB CHECK constraint. */
export function isValidShortcut(shortcut: string): boolean {
  return /^[a-z0-9_-]{1,32}$/.test(shortcut)
}

/**
 * The active slash query in the composer, or null when the picker
 * shouldn't be open.
 *
 * Deliberately narrow: the text must be a lone token starting with "/"
 * at the very beginning of the draft. Mid-sentence slashes ("9/10",
 * "https://…", "and/or") must never open the picker, and once the
 * agent types a space they've moved on to writing a real message.
 */
export function extractSlashQuery(text: string): string | null {
  const match = /^\/(\S*)$/.exec(text)
  return match ? match[1].toLowerCase() : null
}

/**
 * Snippets matching the query, best first.
 *
 * Ranking: exact shortcut, then shortcut prefix, then title/body
 * substring — an agent who types the shortcut they know should never
 * have to scroll past a fuzzy body match to reach it. Ties break on
 * usage, so a desk's workhorse snippets rise to the top on their own.
 */
export function filterCannedReplies(
  replies: CannedReply[],
  query: string,
  limit = 8
): CannedReply[] {
  const q = query.toLowerCase().trim()

  const scored = replies
    .map((reply) => {
      const shortcut = reply.shortcut.toLowerCase()
      if (!q) return { reply, rank: 3 }
      if (shortcut === q) return { reply, rank: 0 }
      if (shortcut.startsWith(q)) return { reply, rank: 1 }
      const haystack = `${reply.title} ${reply.body}`.toLowerCase()
      if (haystack.includes(q)) return { reply, rank: 2 }
      return null
    })
    .filter((x): x is { reply: CannedReply; rank: number } => x !== null)

  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      (b.reply.usage_count ?? 0) - (a.reply.usage_count ?? 0) ||
      a.reply.shortcut.localeCompare(b.reply.shortcut)
  )

  return scored.slice(0, limit).map((x) => x.reply)
}

/**
 * Fill a snippet's placeholders. Supports {{name}} / {{phone}} etc. by
 * key rather than {{1}} position — canned replies are local text, so
 * there's no Meta template shape to conform to and a readable key is
 * far less error-prone for the person writing the snippet.
 *
 * Unknown placeholders are left as-is: silently blanking one would let
 * a half-filled sentence reach the customer, whereas a visible
 * {{order_id}} in the composer is caught before Send.
 */
export function renderCannedBody(
  body: string,
  values: Record<string, string | null | undefined>
): string {
  return body.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const value = values[key.toLowerCase()]
    return value != null && value !== '' ? value : whole
  })
}
