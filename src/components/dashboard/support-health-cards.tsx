'use client'

import { Clock, AlarmClock, CheckCircle2, Smile } from 'lucide-react'
import { MetricCard } from './metric-card'
import { SkeletonCard } from './skeleton'
import { formatDuration } from '@/lib/conversations/response-metrics'
import type { SupportHealth } from '@/lib/dashboard/types'

interface SupportHealthCardsProps {
    data: SupportHealth | null
    loading: boolean
}

/**
 * Three support-desk figures the other dashboard widgets can't give:
 * what's waiting on us right now, how badly, and how long resolutions
 * are taking. Reads the conversation clocks from migration 015 —
 * unlike the response-time chart, which re-derives history from the
 * message log.
 */
export function SupportHealthCards({ data, loading }: SupportHealthCardsProps) {
    if (loading || !data) {
        return (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <SkeletonCard key={i} />
                ))}
            </div>
        )
    }

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
                title="Awaiting Reply"
                value={data.waitingCount.toLocaleString()}
                icon={Clock}
                subtitle={
                    data.oldestWaitSeconds
                        ? `Oldest waiting ${formatDuration(data.oldestWaitSeconds)}`
                        : 'Nothing waiting on us'
                }
            />
            <MetricCard
                title="Over 4 Hours"
                value={data.breachedCount.toLocaleString()}
                icon={AlarmClock}
                subtitle={
                    data.breachedCount === 0
                        ? 'No threads left hanging'
                        : 'Unanswered for more than four hours'
                }
            />
            <MetricCard
                title="Avg Resolution"
                value={formatDuration(data.avgResolutionSeconds)}
                icon={CheckCircle2}
                subtitle={
                    data.resolvedCount === 0
                        ? `No conversations closed in ${data.windowDays} days`
                        : `${data.resolvedCount.toLocaleString()} resolved in ${data.windowDays} days`
                }
            />
            <MetricCard
                title="Satisfaction"
                value={
                    data.csatSatisfaction === null
                        ? '—'
                        : `${data.csatSatisfaction}%`
                }
                icon={Smile}
                subtitle={
                    data.csatResponses === 0
                        ? 'No survey responses yet'
                        : `${data.csatAverage}/5 across ${data.csatResponses} response${data.csatResponses === 1 ? '' : 's'}`
                }
            />
        </div>
    )
}
