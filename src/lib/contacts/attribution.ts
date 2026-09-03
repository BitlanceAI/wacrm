/**
 * Display helpers for contact lead-source attribution (migration 014).
 * Kept out of the components so the contacts list, the detail sheet and
 * any future reporting page all label a source the same way.
 */
import type { ContactSource } from '@/types'

export const SOURCE_LABELS: Record<ContactSource, string> = {
  manual: 'Added manually',
  import: 'CSV import',
  whatsapp: 'Messaged us on WhatsApp',
  ctwa_ad: 'Click-to-WhatsApp ad',
  api: 'API',
  automation: 'Automation',
}

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return SOURCE_LABELS.manual
  return SOURCE_LABELS[source as ContactSource] ?? source
}

/**
 * One-line summary of where an ad-sourced lead came from — the ad's own
 * headline is far more use to a salesperson than the numeric ad id.
 */
export function attributionSummary(
  details: Record<string, unknown> | null | undefined
): string | null {
  if (!details) return null
  const headline = typeof details.headline === 'string' ? details.headline : null
  const sourceId = typeof details.source_id === 'string' ? details.source_id : null
  if (headline && sourceId) return `"${headline}" · ad ${sourceId}`
  return headline ?? (sourceId ? `Ad ${sourceId}` : null)
}
