/**
 * Post-resolution CSAT surveys (migration 017).
 *
 * The survey goes out as an interactive LIST rather than buttons:
 * Meta caps reply buttons at three, and a three-point scale collapses
 * "fine" and "excellent" into the same bucket, which makes the average
 * useless for spotting a decline.
 *
 * Reply ids are "csat:N". The webhook already stores every interactive
 * reply id, so recognising a score is a string match, not a new
 * plumbing path.
 */
import type { InteractiveListSection } from '@/lib/whatsapp/meta-api'

export const CSAT_REPLY_PREFIX = 'csat:'

/** Scale rendered in the list, worst-to-best top-to-bottom. */
export const CSAT_OPTIONS = [
  { score: 5, title: 'Excellent', description: 'Everything was sorted quickly' },
  { score: 4, title: 'Good', description: 'Happy with the help' },
  { score: 3, title: 'Okay', description: 'It was fine' },
  { score: 2, title: 'Poor', description: 'Not really resolved' },
  { score: 1, title: 'Very poor', description: 'I am unhappy with this' },
] as const

/**
 * Parse an interactive reply id into a score. Returns null for any id
 * that isn't a CSAT reply, or a score outside 1-5 — the id round-trips
 * through Meta and a customer's client, so it is never trusted blindly.
 */
export function parseCsatReply(replyId: string | null | undefined): number | null {
  if (!replyId || !replyId.startsWith(CSAT_REPLY_PREFIX)) return null
  const score = Number(replyId.slice(CSAT_REPLY_PREFIX.length))
  if (!Number.isInteger(score) || score < 1 || score > 5) return null
  return score
}

/** The single list section sent with a survey. */
export function csatSections(): InteractiveListSection[] {
  return [
    {
      title: 'Rate our support',
      rows: CSAT_OPTIONS.map((o) => ({
        id: `${CSAT_REPLY_PREFIX}${o.score}`,
        title: o.title,
        description: o.description,
      })),
    },
  ]
}

/**
 * Average of a set of scores, rounded to one decimal. Null for an
 * empty set — a desk with no responses has no score, and rendering
 * "0.0" would read as universal dissatisfaction.
 */
export function averageScore(scores: number[]): number | null {
  if (scores.length === 0) return null
  const sum = scores.reduce((a, b) => a + b, 0)
  return Math.round((sum / scores.length) * 10) / 10
}

/**
 * Percentage of responses that are 4 or 5 — the standard CSAT
 * definition, and a more honest headline than the mean, which a single
 * 1-star can drag down on a small sample.
 */
export function satisfactionRate(scores: number[]): number | null {
  if (scores.length === 0) return null
  const happy = scores.filter((s) => s >= 4).length
  return Math.round((happy / scores.length) * 100)
}
