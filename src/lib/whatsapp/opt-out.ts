/**
 * Marketing opt-out / opt-in keyword detection for inbound messages.
 *
 * WhatsApp Business Policy requires an easy way out of marketing
 * messages, and Meta's own quality signals punish accounts that keep
 * messaging people who asked to stop. The webhook runs every inbound
 * text through here before anything else touches the message.
 *
 * Deliberately conservative: only a message whose ENTIRE text is an
 * opt-out phrase counts. "stop sending me the wrong invoice" is a
 * support request, not an unsubscribe, and silently muting that
 * customer would be worse than missing the keyword.
 */

/** Phrases that switch marketing off. Compared after normalization. */
const OPT_OUT_PHRASES = [
  'stop',
  'stop promotions',
  'stop all',
  'unsubscribe',
  'unsub',
  'opt out',
  'optout',
  'cancel subscription',
  'no more messages',
  'do not message me',
  'dont message me',
  'remove me',
] as const

/** Phrases that switch marketing back on. */
const OPT_IN_PHRASES = [
  'start',
  'unstop',
  'subscribe',
  'resubscribe',
  'opt in',
  'optin',
  'yes subscribe',
] as const

export type OptKeyword = 'opt_out' | 'opt_in' | null

/**
 * Strip punctuation/emoji and collapse whitespace so "STOP." ,
 * "  stop  " and "Stop!" all reduce to "stop". Keeps letters, digits
 * and spaces only — every phrase above is expressible in that subset.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Classify an inbound message body. Returns null for anything that
 * isn't an exact opt-out / opt-in phrase.
 */
export function detectOptKeyword(text: string | null | undefined): OptKeyword {
  if (!text) return null
  const normalized = normalize(text)
  if (!normalized) return null
  // Longest real phrase is 4 words; anything longer is a sentence that
  // happens to contain the word, not a command.
  if (normalized.split(' ').length > 4) return null
  if ((OPT_OUT_PHRASES as readonly string[]).includes(normalized)) return 'opt_out'
  if ((OPT_IN_PHRASES as readonly string[]).includes(normalized)) return 'opt_in'
  return null
}

/** Exposed for the settings UI so the list stays in one place. */
export const OPT_OUT_KEYWORD_LIST: readonly string[] = OPT_OUT_PHRASES
export const OPT_IN_KEYWORD_LIST: readonly string[] = OPT_IN_PHRASES
