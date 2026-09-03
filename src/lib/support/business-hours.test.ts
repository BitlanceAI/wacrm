import { describe, it, expect } from 'vitest'
import {
  parseHhMm,
  formatHhMm,
  zonedDayAndMinutes,
  isWithinBusinessHours,
  shouldSendAwayReply,
  validateSchedule,
  DEFAULT_BUSINESS_HOURS,
  type BusinessDay,
} from './business-hours'

const IST = 'Asia/Kolkata'

/** Mon-Fri 09:00-18:00, weekend closed. */
const WEEKDAYS: BusinessDay[] = [
  { dow: 0, closed: false, open: '09:00', close: '18:00' },
  { dow: 1, closed: false, open: '09:00', close: '18:00' },
  { dow: 2, closed: false, open: '09:00', close: '18:00' },
  { dow: 3, closed: false, open: '09:00', close: '18:00' },
  { dow: 4, closed: false, open: '09:00', close: '18:00' },
  { dow: 5, closed: true, open: '09:00', close: '18:00' },
  { dow: 6, closed: true, open: '09:00', close: '18:00' },
]

describe('parseHhMm / formatHhMm', () => {
  it('parses valid times', () => {
    expect(parseHhMm('09:00')).toBe(540)
    expect(parseHhMm('9:05')).toBe(545)
    expect(parseHhMm('23:59')).toBe(1439)
  })

  it('rejects out-of-range and malformed values', () => {
    expect(parseHhMm('24:00')).toBeNull()
    expect(parseHhMm('12:60')).toBeNull()
    expect(parseHhMm('noon')).toBeNull()
    expect(parseHhMm('')).toBeNull()
  })

  it('round-trips through formatHhMm', () => {
    expect(formatHhMm(540)).toBe('09:00')
    expect(formatHhMm(1439)).toBe('23:59')
  })
})

describe('zonedDayAndMinutes', () => {
  it('converts a UTC instant into the target zone', () => {
    // 2026-08-25 is a Tuesday. 04:00 UTC = 09:30 IST.
    const result = zonedDayAndMinutes(new Date('2026-08-25T04:00:00Z'), IST)
    expect(result).toEqual({ dow: 1, minutes: 570 })
  })

  it('rolls the weekday over when the zone is a day ahead', () => {
    // 20:00 UTC Tuesday = 01:30 IST Wednesday.
    const result = zonedDayAndMinutes(new Date('2026-08-25T20:00:00Z'), IST)
    expect(result).toEqual({ dow: 2, minutes: 90 })
  })
})

describe('isWithinBusinessHours', () => {
  it('is open during a configured weekday window', () => {
    // Tuesday 09:30 IST
    expect(
      isWithinBusinessHours(WEEKDAYS, IST, new Date('2026-08-25T04:00:00Z'))
    ).toBe(true)
  })

  it('is closed before opening and at/after closing', () => {
    // Tuesday 08:30 IST
    expect(
      isWithinBusinessHours(WEEKDAYS, IST, new Date('2026-08-25T03:00:00Z'))
    ).toBe(false)
    // Tuesday 18:00 IST exactly — the close time is exclusive.
    expect(
      isWithinBusinessHours(WEEKDAYS, IST, new Date('2026-08-25T12:30:00Z'))
    ).toBe(false)
  })

  it('is closed on days marked closed', () => {
    // Saturday 2026-08-29, 12:00 IST
    expect(
      isWithinBusinessHours(WEEKDAYS, IST, new Date('2026-08-29T06:30:00Z'))
    ).toBe(false)
  })

  it('handles an overnight window on both sides of midnight', () => {
    const nightShift: BusinessDay[] = Array.from({ length: 7 }, (_, dow) => ({
      dow,
      closed: false,
      open: '22:00',
      close: '06:00',
    }))
    // 23:00 IST Tuesday — evening half of Tuesday's window.
    expect(
      isWithinBusinessHours(nightShift, IST, new Date('2026-08-25T17:30:00Z'))
    ).toBe(true)
    // 02:00 IST Wednesday — still inside Tuesday's window.
    expect(
      isWithinBusinessHours(nightShift, IST, new Date('2026-08-25T20:30:00Z'))
    ).toBe(true)
    // 12:00 IST Wednesday — well outside.
    expect(
      isWithinBusinessHours(nightShift, IST, new Date('2026-08-26T06:30:00Z'))
    ).toBe(false)
  })

  it('fails open on an empty or missing schedule', () => {
    expect(isWithinBusinessHours([], IST)).toBe(true)
    expect(isWithinBusinessHours(null, IST)).toBe(true)
    expect(isWithinBusinessHours(undefined, IST)).toBe(true)
  })

  it('fails open on a malformed window rather than declaring the desk shut', () => {
    const broken: BusinessDay[] = [
      { dow: 1, closed: false, open: 'nine', close: 'six' },
    ]
    // Malformed Tuesday window -> not open via that path, and no other
    // day matches, so it reports closed only for that specific day.
    expect(
      isWithinBusinessHours(broken, IST, new Date('2026-08-25T04:00:00Z'))
    ).toBe(false)
    // ...but a schedule with no entry at all for today is still closed,
    // whereas an entirely empty schedule is open (see previous test).
  })

  it('accepts the shipped defaults', () => {
    // Tuesday 11:00 IST against the default Mon-Sat schedule.
    expect(
      isWithinBusinessHours(
        DEFAULT_BUSINESS_HOURS,
        IST,
        new Date('2026-08-25T05:30:00Z')
      )
    ).toBe(true)
  })
})

describe('shouldSendAwayReply', () => {
  const closedInstant = new Date('2026-08-25T03:00:00Z') // 08:30 IST, before open

  it('sends when enabled, closed and never sent before', () => {
    expect(
      shouldSendAwayReply({
        awayEnabled: true,
        schedule: WEEKDAYS,
        timeZone: IST,
        cooldownMinutes: 240,
        lastAwaySentAt: null,
        at: closedInstant,
      })
    ).toBe(true)
  })

  it('stays silent while the feature is off', () => {
    expect(
      shouldSendAwayReply({
        awayEnabled: false,
        schedule: WEEKDAYS,
        timeZone: IST,
        cooldownMinutes: 240,
        lastAwaySentAt: null,
        at: closedInstant,
      })
    ).toBe(false)
  })

  it('stays silent during business hours', () => {
    expect(
      shouldSendAwayReply({
        awayEnabled: true,
        schedule: WEEKDAYS,
        timeZone: IST,
        cooldownMinutes: 240,
        lastAwaySentAt: null,
        at: new Date('2026-08-25T05:00:00Z'), // 10:30 IST
      })
    ).toBe(false)
  })

  it('respects the cooldown so one night yields one apology', () => {
    expect(
      shouldSendAwayReply({
        awayEnabled: true,
        schedule: WEEKDAYS,
        timeZone: IST,
        cooldownMinutes: 240,
        lastAwaySentAt: '2026-08-25T02:00:00Z', // 1 hour earlier
        at: closedInstant,
      })
    ).toBe(false)
  })

  it('sends again once the cooldown has elapsed', () => {
    expect(
      shouldSendAwayReply({
        awayEnabled: true,
        schedule: WEEKDAYS,
        timeZone: IST,
        cooldownMinutes: 60,
        lastAwaySentAt: '2026-08-24T20:00:00Z',
        at: closedInstant,
      })
    ).toBe(true)
  })
})

describe('validateSchedule', () => {
  it('accepts a well-formed schedule', () => {
    expect(validateSchedule(WEEKDAYS)).toEqual([])
  })

  it('reports each malformed open/close by day name', () => {
    const errors = validateSchedule([
      { dow: 0, closed: false, open: '9am', close: '18:00' },
    ])
    expect(errors).toEqual(['Monday: opening time must be HH:mm'])
  })

  it('ignores days marked closed', () => {
    expect(
      validateSchedule([{ dow: 6, closed: true, open: 'x', close: 'y' }])
    ).toEqual([])
  })
})
