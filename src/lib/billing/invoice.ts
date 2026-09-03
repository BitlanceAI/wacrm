/**
 * Invoice presentation, dunning schedule and renewal arithmetic
 * (migration 019). All pure — the routes and the cron sweep share
 * these rules so an invoice chased by the scheduler says the same
 * thing as one sent by hand.
 */
import { formatMoney, amountForUpi } from './money'

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'paid'
  | 'overdue'
  | 'void'
  | 'refunded'

export type RenewalInterval = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

/**
 * A UPI collect link. Works with every UPI app in India and needs no
 * gateway account — which is the difference between this feature being
 * usable on day one and being blocked on a provider integration.
 *
 * Returns null without a VPA: a link missing its payee silently opens
 * an empty payment screen, which looks like the business's fault.
 */
export function buildUpiLink(args: {
  vpa: string | null | undefined
  payeeName: string | null | undefined
  amountMinor: number
  note?: string | null
}): string | null {
  const vpa = args.vpa?.trim()
  if (!vpa) return null

  const params = new URLSearchParams({
    pa: vpa,
    am: amountForUpi(args.amountMinor),
    cu: 'INR',
  })
  if (args.payeeName?.trim()) params.set('pn', args.payeeName.trim())
  // Transaction notes are capped short by most UPI apps; anything
  // longer is truncated by the app itself, so trim it here where the
  // result is predictable.
  if (args.note?.trim()) params.set('tn', args.note.trim().slice(0, 50))

  return `upi://pay?${params.toString()}`
}

/**
 * Is this invoice past its due date and still unpaid?
 * `draft` is excluded on purpose — an invoice nobody has sent cannot
 * be late.
 */
export function isOverdue(
  invoice: { status: string; due_date?: string | null },
  now: Date = new Date()
): boolean {
  if (invoice.status !== 'sent' && invoice.status !== 'overdue') return false
  if (!invoice.due_date) return false
  // due_date is a DATE: a bill due "today" is not late until today ends.
  const endOfDue = new Date(`${invoice.due_date}T23:59:59.999Z`)
  return now > endOfDue
}

/**
 * Default dunning ladder in days relative to the due date: one polite
 * heads-up before, then two chases after. Deliberately short — a
 * schedule that keeps messaging weekly for a month gets the WhatsApp
 * number reported.
 */
export const DEFAULT_DUNNING_OFFSETS_DAYS = [-3, 1, 7] as const

export interface PlannedInvoiceReminder {
  offset_days: number
  send_at: string
}

/**
 * Resolve dunning offsets against a due date, dropping any that have
 * already passed. Reminders fire at 10:00 UTC rather than midnight so
 * a "3 days before" nudge lands during waking hours in the target
 * market rather than at 5:30am.
 */
export function planInvoiceReminders(
  dueDate: string | null | undefined,
  offsetsDays: readonly number[],
  now: Date = new Date()
): PlannedInvoiceReminder[] {
  if (!dueDate) return []
  const base = new Date(`${dueDate}T10:00:00.000Z`)
  if (Number.isNaN(base.getTime())) return []

  const seen = new Set<number>()
  const planned: PlannedInvoiceReminder[] = []

  for (const offset of offsetsDays) {
    if (!Number.isFinite(offset) || seen.has(offset)) continue
    seen.add(offset)
    const sendAt = new Date(base.getTime() + offset * 86_400_000)
    if (sendAt <= now) continue
    planned.push({ offset_days: offset, send_at: sendAt.toISOString() })
  }

  return planned.sort(
    (a, b) => new Date(a.send_at).getTime() - new Date(b.send_at).getTime()
  )
}

/**
 * The message body for an invoice or a chase.
 *
 * One function for both so a reminder can never quote a different
 * amount from the original — the single most damaging inconsistency
 * this feature could produce.
 */
export function invoiceMessage(args: {
  contactName?: string | null
  number: string
  description: string
  amountMinor: number
  currency: string
  dueDate?: string | null
  paymentUrl?: string | null
  instructions?: string | null
  tone: 'new' | 'reminder' | 'overdue'
}): string {
  const who = args.contactName?.trim() ? ` ${args.contactName.trim()}` : ''
  const amount = formatMoney(args.amountMinor, args.currency)

  const opener =
    args.tone === 'new'
      ? `Hi${who}, here's your invoice ${args.number} for ${args.description}.`
      : args.tone === 'reminder'
        ? `Hi${who}, a quick reminder about invoice ${args.number} for ${args.description}.`
        : `Hi${who}, invoice ${args.number} for ${args.description} is now overdue.`

  const lines = [opener, `Amount: ${amount}`]
  if (args.dueDate) {
    lines.push(args.tone === 'overdue' ? `Was due: ${args.dueDate}` : `Due: ${args.dueDate}`)
  }
  if (args.paymentUrl?.trim()) lines.push(`Pay here: ${args.paymentUrl.trim()}`)
  if (args.instructions?.trim()) lines.push(args.instructions.trim())

  return lines.join('\n')
}

/** Days per interval, used for the plain-interval renewal step. */
const INTERVAL_DAYS: Record<RenewalInterval, number> = {
  weekly: 7,
  monthly: 0, // handled by calendar arithmetic below
  quarterly: 0,
  yearly: 0,
}

/**
 * Advance a renewal date by one interval.
 *
 * Month-based intervals use calendar arithmetic, clamped to the last
 * day of the target month: a subscription renewing on the 31st must
 * fall to the 28th/30th in shorter months rather than silently
 * rolling into the following month, which would skip a billing cycle.
 */
export function nextRenewalDate(
  currentDate: string,
  interval: RenewalInterval
): string {
  const [y, m, d] = currentDate.split('-').map(Number)
  if (!y || !m || !d) return currentDate

  if (interval === 'weekly') {
    const next = new Date(Date.UTC(y, m - 1, d + INTERVAL_DAYS.weekly))
    return next.toISOString().slice(0, 10)
  }

  const monthsToAdd = interval === 'monthly' ? 1 : interval === 'quarterly' ? 3 : 12
  const targetMonthIndex = m - 1 + monthsToAdd
  const targetYear = y + Math.floor(targetMonthIndex / 12)
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12

  // Day 0 of the following month = last day of the target month.
  const daysInTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const day = Math.min(d, daysInTarget)

  return new Date(Date.UTC(targetYear, targetMonth, day)).toISOString().slice(0, 10)
}

/** Is a subscription due to renew on or before `asOf`? */
export function isRenewalDue(
  subscription: { status: string; next_renewal_date: string },
  asOf: Date = new Date()
): boolean {
  if (subscription.status !== 'active') return false
  const due = new Date(`${subscription.next_renewal_date}T00:00:00.000Z`)
  if (Number.isNaN(due.getTime())) return false
  return due <= asOf
}
