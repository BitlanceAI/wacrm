/**
 * Appointment reminder scheduling (migration 018).
 *
 * Pure functions: given a booking and a set of lead times, work out
 * which reminder rows should exist. The API route and any future
 * bulk-reschedule tool share these rules so a booking moved from the
 * UI and one moved by a script end up with the same reminders.
 */

/** Lead times offered in the UI, in minutes before the start. */
export const REMINDER_PRESETS = [
  { minutes: 24 * 60, label: '24 hours before' },
  { minutes: 3 * 60, label: '3 hours before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 15, label: '15 minutes before' },
] as const

export interface PlannedReminder {
  offset_minutes: number
  /** ISO instant the reminder should go out. */
  send_at: string
}

/**
 * Turn lead times into absolute send instants, dropping any that would
 * already be in the past.
 *
 * Booking something for an hour from now must not immediately fire the
 * "24 hours before" reminder — the customer would get a nudge about an
 * appointment they just made, which reads as a system glitch.
 * Duplicate offsets collapse; the result is sorted earliest-first.
 */
export function planReminders(
  startsAtIso: string,
  offsetsMinutes: number[],
  now: Date = new Date()
): PlannedReminder[] {
  const startMs = new Date(startsAtIso).getTime()
  if (!Number.isFinite(startMs)) return []

  const seen = new Set<number>()
  const planned: PlannedReminder[] = []

  for (const offset of offsetsMinutes) {
    if (!Number.isFinite(offset) || offset < 0) continue
    if (seen.has(offset)) continue
    seen.add(offset)

    const sendMs = startMs - offset * 60_000
    if (sendMs <= now.getTime()) continue
    planned.push({
      offset_minutes: offset,
      send_at: new Date(sendMs).toISOString(),
    })
  }

  return planned.sort(
    (a, b) => new Date(a.send_at).getTime() - new Date(b.send_at).getTime()
  )
}

/**
 * Render the booking time in the appointment's own timezone.
 *
 * A reminder saying "your appointment is at 09:30" must mean the
 * customer's 09:30, not the server's UTC rendering of it.
 */
export function formatAppointmentTime(
  startsAtIso: string,
  timeZone: string
): string {
  const date = new Date(startsAtIso)
  if (Number.isNaN(date.getTime())) return startsAtIso
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date)
  } catch {
    // An invalid zone must not take the reminder down with it.
    return date.toISOString()
  }
}

/**
 * Default reminder body. Kept here rather than inline in the route so
 * the UI can preview exactly what the customer will receive.
 */
export function defaultReminderText(args: {
  contactName?: string | null
  title: string
  startsAtIso: string
  timeZone: string
  location?: string | null
}): string {
  const who = args.contactName?.trim() ? ` ${args.contactName.trim()}` : ''
  const when = formatAppointmentTime(args.startsAtIso, args.timeZone)
  const where = args.location?.trim() ? ` at ${args.location.trim()}` : ''
  return `Hi${who}, this is a reminder for your ${args.title} on ${when}${where}. Reply here if you need to reschedule.`
}

/**
 * Is this booking still in a state where reminders should fire?
 * Cancelled/completed bookings keep their history but stop nudging —
 * the DB trigger enforces this too; this is the read-side counterpart.
 */
export function remindersActiveForStatus(status: string): boolean {
  return status === 'scheduled' || status === 'confirmed'
}
