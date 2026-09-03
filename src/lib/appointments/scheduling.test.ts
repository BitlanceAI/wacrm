import { describe, it, expect } from 'vitest'
import {
  planReminders,
  formatAppointmentTime,
  defaultReminderText,
  remindersActiveForStatus,
} from './scheduling'

const NOW = new Date('2026-08-25T10:00:00Z')

describe('planReminders', () => {
  it('resolves each lead time into an absolute instant', () => {
    const planned = planReminders('2026-08-27T10:00:00Z', [24 * 60, 60], NOW)
    expect(planned).toEqual([
      { offset_minutes: 24 * 60, send_at: '2026-08-26T10:00:00.000Z' },
      { offset_minutes: 60, send_at: '2026-08-27T09:00:00.000Z' },
    ])
  })

  it('drops lead times that already passed, so a same-day booking is not nudged instantly', () => {
    // Appointment in one hour: the 24h reminder is long gone.
    const planned = planReminders('2026-08-25T11:00:00Z', [24 * 60, 15], NOW)
    expect(planned.map((p) => p.offset_minutes)).toEqual([15])
  })

  it('collapses duplicate offsets', () => {
    const planned = planReminders('2026-08-27T10:00:00Z', [60, 60, 60], NOW)
    expect(planned).toHaveLength(1)
  })

  it('ignores negative and non-finite offsets', () => {
    const planned = planReminders(
      '2026-08-27T10:00:00Z',
      [-30, Number.NaN, 60],
      NOW
    )
    expect(planned.map((p) => p.offset_minutes)).toEqual([60])
  })

  it('returns nothing for an unparseable start time', () => {
    expect(planReminders('not-a-date', [60], NOW)).toEqual([])
  })

  it('returns nothing when every reminder is in the past', () => {
    expect(planReminders('2026-08-25T10:30:00Z', [60, 120], NOW)).toEqual([])
  })
})

describe('formatAppointmentTime', () => {
  it('renders in the booking’s own timezone, not UTC', () => {
    // 04:00 UTC = 09:30 IST
    const formatted = formatAppointmentTime(
      '2026-08-25T04:00:00Z',
      'Asia/Kolkata'
    )
    expect(formatted).toMatch(/09:30/)
    expect(formatted.toLowerCase()).toContain('am')
  })

  it('falls back to the raw instant rather than throwing on a bad zone', () => {
    const result = formatAppointmentTime('2026-08-25T04:00:00Z', 'Mars/Olympus')
    expect(result).toBe('2026-08-25T04:00:00.000Z')
  })

  it('passes through an unparseable input unchanged', () => {
    expect(formatAppointmentTime('tomorrow', 'Asia/Kolkata')).toBe('tomorrow')
  })
})

describe('defaultReminderText', () => {
  it('includes the name, title, local time and location', () => {
    const text = defaultReminderText({
      contactName: 'Asha',
      title: 'dental check-up',
      startsAtIso: '2026-08-25T04:00:00Z',
      timeZone: 'Asia/Kolkata',
      location: 'Clinic 2',
    })
    expect(text).toContain('Hi Asha')
    expect(text).toContain('dental check-up')
    expect(text).toContain('09:30')
    expect(text).toContain('at Clinic 2')
  })

  it('reads correctly with no name and no location', () => {
    const text = defaultReminderText({
      contactName: null,
      title: 'consultation',
      startsAtIso: '2026-08-25T04:00:00Z',
      timeZone: 'Asia/Kolkata',
    })
    expect(text.startsWith('Hi, this is a reminder')).toBe(true)
    expect(text).not.toContain(' at ')
  })
})

describe('remindersActiveForStatus', () => {
  it('nudges only for live bookings', () => {
    expect(remindersActiveForStatus('scheduled')).toBe(true)
    expect(remindersActiveForStatus('confirmed')).toBe(true)
    expect(remindersActiveForStatus('cancelled')).toBe(false)
    expect(remindersActiveForStatus('completed')).toBe(false)
    expect(remindersActiveForStatus('no_show')).toBe(false)
  })
})
