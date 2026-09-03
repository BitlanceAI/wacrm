// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
 current: number
 previous: number
}

export interface MetricsBundle {
 activeConversations: MetricDelta
 newContactsToday: MetricDelta
 openDealsValue: number
 openDealsCount: number
 messagesSentToday: MetricDelta
}

export interface ConversationsSeriesPoint {
 day: string // YYYY-MM-DD local
 incoming: number
 outgoing: number
}

export interface PipelineStageSlice {
 id: string
 name: string
 color: string
 dealCount: number
 totalValue: number
}

export interface PipelineDonutData {
 stages: PipelineStageSlice[]
 totalValue: number
}

export interface ResponseTimeBucket {
 /** 0 = Mon … 6 = Sun (Monday-first). */
 dow: number
 /** Average first-response time in minutes. Null means no samples. */
 avgMinutes: number | null
 samples: number
}

export interface ResponseTimeSummary {
 buckets: ResponseTimeBucket[]
 thisWeekAvg: number | null
 lastWeekAvg: number | null
}

/**
 * Support-desk health, derived from the conversation response clocks
 * added in migration 015. Distinct from ResponseTimeSummary, which
 * charts historical first-response speed: this describes the queue as
 * it stands right now, plus how long resolutions are taking.
 */
export interface SupportHealth {
 /** Open/pending threads with an unanswered customer message. */
 waitingCount: number
 /** Longest current wait, in seconds. Null when nothing is waiting. */
 oldestWaitSeconds: number | null
 /** Waiting threads that have been unanswered for over four hours. */
 breachedCount: number
 /** Mean resolution time over the trailing window, in seconds. */
 avgResolutionSeconds: number | null
 /** Threads resolved inside the trailing window. */
 resolvedCount: number
 /** How many days the resolution figures cover. */
 windowDays: number
 /** Mean CSAT score (1-5) over the window; null with no responses. */
 csatAverage: number | null
 /** Percent of responses scoring 4 or 5; null with no responses. */
 csatSatisfaction: number | null
 csatResponses: number
}

export type ActivityKind =
 | 'message'
 | 'deal'
 | 'broadcast'
 | 'automation'
 | 'contact'

export interface ActivityItem {
 id: string
 kind: ActivityKind
 /** Primary line of text rendered in the feed. Pre-formatted. */
 text: string
 /** ISO timestamp the item happened at, drives relative-time + sort. */
 at: string
 /** Optional deep-link for the whole row (not all items have a target). */
 href?: string
}
