/**
 * First-response and resolution bookkeeping for conversations
 * (migration 015).
 *
 * These are pure functions that return the column patch to apply — the
 * webhook, the send route and the inbox all write the same fields, and
 * getting "first" wrong in one of them would silently corrupt every
 * response-time figure. Keeping the rules in one tested place is the
 * point.
 *
 * Two clocks, deliberately separate:
 *
 *   LIFETIME  first_inbound_at -> first_response_at, set once each.
 *             Answers "how fast do we answer a new customer?"
 *   CYCLE     awaiting_reply_since, set on an inbound that has no reply
 *             outstanding and cleared on every agent reply.
 *             Answers "what is waiting on us right now?"
 */

/** The subset of `conversations` these helpers read. */
export interface ConversationTiming {
  created_at?: string | null
  first_inbound_at?: string | null
  first_response_at?: string | null
  first_response_seconds?: number | null
  awaiting_reply_since?: string | null
  resolved_at?: string | null
  resolution_seconds?: number | null
}

/** A partial `conversations` UPDATE. Empty object = nothing to write. */
export type TimingPatch = Record<string, string | number | null>

function seconds(fromIso: string, toIso: string): number {
  const delta =
    (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000
  // Clock skew between Meta's message timestamp and our server can put
  // the reply marginally "before" the question; a negative response
  // time is never the truth, so floor at zero.
  return Math.max(0, Math.round(delta))
}

/**
 * Columns to set when a customer message arrives.
 *
 * `awaiting_reply_since` is only started when the ball isn't already in
 * our court — three messages in a row from the customer must not reset
 * the wait clock to the newest one, or a thread ignored all morning
 * would look freshly arrived.
 */
export function inboundPatch(
  conv: ConversationTiming,
  atIso: string
): TimingPatch {
  const patch: TimingPatch = {}
  if (!conv.first_inbound_at) patch.first_inbound_at = atIso
  if (!conv.awaiting_reply_since) patch.awaiting_reply_since = atIso
  return patch
}

/**
 * Columns to set when an agent (or an automation acting as one) sends
 * an outbound message.
 *
 * A reply that precedes any inbound message isn't a response to
 * anything — outbound-first threads simply have no first-response time.
 */
export function outboundPatch(
  conv: ConversationTiming,
  atIso: string
): TimingPatch {
  const patch: TimingPatch = {}

  if (conv.awaiting_reply_since) patch.awaiting_reply_since = null

  if (!conv.first_response_at && conv.first_inbound_at) {
    patch.first_response_at = atIso
    patch.first_response_seconds = seconds(conv.first_inbound_at, atIso)
  }
  return patch
}

/**
 * Columns to set when a conversation's status changes.
 *
 * Closing stamps the resolution; reopening clears it, so `resolved_at`
 * always describes a thread that is closed right now rather than one
 * that was closed once in the past. Closing also stops the wait clock —
 * a resolved thread isn't "waiting on us".
 */
export function statusChangePatch(
  conv: ConversationTiming,
  nextStatus: 'open' | 'pending' | 'closed',
  atIso: string,
  resolvedByUserId: string | null
): TimingPatch {
  if (nextStatus === 'closed') {
    const from = conv.first_inbound_at ?? conv.created_at ?? null
    return {
      resolved_at: atIso,
      resolved_by: resolvedByUserId,
      resolution_seconds: from ? seconds(from, atIso) : null,
      awaiting_reply_since: null,
    }
  }

  // Reopened (or moved to pending) — any prior resolution no longer
  // describes the thread.
  if (conv.resolved_at) {
    return { resolved_at: null, resolved_by: null, resolution_seconds: null }
  }
  return {}
}

/**
 * Columns to set when an AUTOMATION or FLOW sends the outbound message.
 *
 * A bot reply does answer the customer, so it stops the wait clock and
 * the thread drops out of the "waiting on us" queue. It deliberately
 * does NOT set first_response_at: that figure exists to measure how
 * quickly a person gets involved, and an instant auto-reply would
 * flatter it into meaninglessness.
 *
 * Needs no current row — the write is unconditional — so the engines
 * can apply it without an extra SELECT.
 */
export function botOutboundPatch(): TimingPatch {
  return { awaiting_reply_since: null }
}

/** Seconds elapsed since an ISO timestamp; 0 when absent. */
export function elapsedSeconds(
  sinceIso: string | null | undefined,
  nowIso: string
): number {
  if (!sinceIso) return 0
  return seconds(sinceIso, nowIso)
}

/**
 * Compact duration for inbox badges and metric tiles: "45s", "12m",
 * "3h 5m", "2d 4h". Deliberately at most two units — an inbox badge is
 * read at a glance, not audited.
 */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return '—'
  const s = Math.max(0, Math.round(totalSeconds))
  if (s < 60) return `${s}s`

  const minutes = Math.floor(s / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  if (hours < 24) return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`

  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours ? `${days}d ${remHours}h` : `${days}d`
}

/**
 * How urgent an unanswered thread is. Thresholds are deliberately
 * coarse — under an hour is normal, over four hours is a thread
 * somebody has forgotten.
 */
export type WaitSeverity = 'none' | 'normal' | 'warning' | 'critical'

export function waitSeverity(waitingSeconds: number): WaitSeverity {
  if (waitingSeconds <= 0) return 'none'
  if (waitingSeconds < 3600) return 'normal'
  if (waitingSeconds < 4 * 3600) return 'warning'
  return 'critical'
}
