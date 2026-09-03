/**
 * Business-hours evaluation for the support desk (migration 017).
 *
 * Everything here is pure and timezone-explicit. The server runs in
 * UTC, the customer messages at their own hour, and the desk's "09:00"
 * belongs to the account's configured zone — conflating any two of
 * those three is how out-of-hours auto-replies end up firing at lunch.
 */

/** One day's window. `dow` is 0 = Monday … 6 = Sunday. */
export interface BusinessDay {
  dow: number
  closed: boolean
  /** "HH:mm", 24-hour, in the account's timezone. */
  open: string
  close: string
}

export const DEFAULT_BUSINESS_HOURS: BusinessDay[] = [
  { dow: 0, closed: false, open: '09:00', close: '18:00' },
  { dow: 1, closed: false, open: '09:00', close: '18:00' },
  { dow: 2, closed: false, open: '09:00', close: '18:00' },
  { dow: 3, closed: false, open: '09:00', close: '18:00' },
  { dow: 4, closed: false, open: '09:00', close: '18:00' },
  { dow: 5, closed: false, open: '10:00', close: '14:00' },
  { dow: 6, closed: true, open: '09:00', close: '18:00' },
]

export const DAY_LABELS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

/** Minutes since midnight for "HH:mm"; null when unparseable. */
export function parseHhMm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

export function formatHhMm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * The instant, expressed in a given IANA timezone, as (Monday-indexed
 * weekday, minutes since midnight).
 *
 * Uses Intl rather than manual offset arithmetic so DST transitions
 * are handled by the platform's tz database instead of by us.
 */
export function zonedDayAndMinutes(
  at: Date,
  timeZone: string
): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at)

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  // Intl's `hour` can be "24" at midnight under hour12:false.
  const hour = Number(get('hour')) % 24
  const minute = Number(get('minute'))

  const SUNDAY_FIRST = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const sundayIndex = SUNDAY_FIRST.indexOf(get('weekday'))
  // Convert to Monday-first, which is what BusinessDay.dow uses.
  const dow = (sundayIndex + 6) % 7

  return { dow, minutes: hour * 60 + minute }
}

/**
 * Is the desk open at `at`?
 *
 * An empty or malformed schedule reports OPEN. Failing open matters:
 * the only consumer that acts on `false` is the away auto-reply, and
 * telling every customer "we're closed" because a config row is
 * malformed is far worse than staying quiet.
 *
 * A window whose close time is at or before its open time is treated
 * as overnight (22:00–06:00), so a night-shift desk works without a
 * second row per day.
 */
export function isWithinBusinessHours(
  schedule: BusinessDay[] | null | undefined,
  timeZone: string,
  at: Date = new Date()
): boolean {
  if (!schedule || schedule.length === 0) return true

  const { dow, minutes } = zonedDayAndMinutes(at, timeZone)

  const today = schedule.find((d) => d.dow === dow)
  if (today && !today.closed) {
    const open = parseHhMm(today.open)
    const close = parseHhMm(today.close)
    if (open !== null && close !== null) {
      if (close > open) {
        if (minutes >= open && minutes < close) return true
      } else if (minutes >= open) {
        // Overnight window, evening half.
        return true
      }
    }
  }

  // Overnight window opened yesterday and hasn't closed yet.
  const yesterday = schedule.find((d) => d.dow === (dow + 6) % 7)
  if (yesterday && !yesterday.closed) {
    const open = parseHhMm(yesterday.open)
    const close = parseHhMm(yesterday.close)
    if (open !== null && close !== null && close <= open && minutes < close) {
      return true
    }
  }

  return false
}

/**
 * Should the away auto-reply go out for this thread right now?
 *
 * Three gates, all of which must pass: the feature is on, the desk is
 * closed, and we haven't already told this contact within the cooldown.
 * The cooldown is what stops a customer who sends five messages
 * overnight from getting five identical apologies.
 */
export function shouldSendAwayReply(args: {
  awayEnabled: boolean
  schedule: BusinessDay[] | null | undefined
  timeZone: string
  cooldownMinutes: number
  lastAwaySentAt: string | null | undefined
  at?: Date
}): boolean {
  const at = args.at ?? new Date()
  if (!args.awayEnabled) return false
  if (isWithinBusinessHours(args.schedule, args.timeZone, at)) return false

  if (args.lastAwaySentAt) {
    const elapsedMinutes =
      (at.getTime() - new Date(args.lastAwaySentAt).getTime()) / 60000
    if (elapsedMinutes < args.cooldownMinutes) return false
  }
  return true
}

/**
 * Validate a schedule coming from the settings form. Returns the list
 * of problems; empty means it's safe to save.
 */
export function validateSchedule(schedule: BusinessDay[]): string[] {
  const errors: string[] = []
  for (const day of schedule) {
    if (day.closed) continue
    const label = DAY_LABELS[day.dow] ?? `Day ${day.dow}`
    if (parseHhMm(day.open) === null) errors.push(`${label}: opening time must be HH:mm`)
    if (parseHhMm(day.close) === null) errors.push(`${label}: closing time must be HH:mm`)
  }
  return errors
}
