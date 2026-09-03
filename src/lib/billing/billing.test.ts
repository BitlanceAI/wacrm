import { describe, it, expect } from 'vitest'
import {
  parseAmountToMinor,
  minorToMajor,
  formatMoney,
  amountForUpi,
} from './money'
import {
  buildUpiLink,
  isOverdue,
  planInvoiceReminders,
  invoiceMessage,
  nextRenewalDate,
  isRenewalDue,
  DEFAULT_DUNNING_OFFSETS_DAYS,
} from './invoice'

describe('parseAmountToMinor', () => {
  it('parses plain and formatted input', () => {
    expect(parseAmountToMinor('1250')).toBe(125000)
    expect(parseAmountToMinor('1,250.50')).toBe(125050)
    expect(parseAmountToMinor('₹99')).toBe(9900)
    expect(parseAmountToMinor(' 12.34 ')).toBe(1234)
    expect(parseAmountToMinor(45.6)).toBe(4560)
  })

  it('rounds to the nearest minor unit rather than truncating', () => {
    expect(parseAmountToMinor('10.005')).toBe(1001)
    expect(parseAmountToMinor('10.004')).toBe(1000)
  })

  it('rejects zero, negatives and junk instead of guessing', () => {
    expect(parseAmountToMinor('0')).toBeNull()
    expect(parseAmountToMinor('-5')).toBeNull()
    expect(parseAmountToMinor('abc')).toBeNull()
    expect(parseAmountToMinor('')).toBeNull()
    expect(parseAmountToMinor('1.2.3')).toBeNull()
    expect(parseAmountToMinor(Number.NaN)).toBeNull()
  })
})

describe('money formatting', () => {
  it('round-trips minor units', () => {
    expect(minorToMajor(125050)).toBe(1250.5)
  })

  it('formats with the currency symbol', () => {
    expect(formatMoney(125050, 'INR')).toContain('1,250.50')
  })

  it('renders an unknown currency without throwing', () => {
    // Intl emits a non-breaking space between code and amount; the
    // point of the assertion is that nothing throws and the number
    // survives, not which flavour of space is used.
    expect(formatMoney(1000, 'XYZ').replace(/\s/g, ' ')).toBe('XYZ 10.00')
  })

  it('renders UPI amounts as a bare two-decimal string', () => {
    expect(amountForUpi(125050)).toBe('1250.50')
    expect(amountForUpi(9900)).toBe('99.00')
  })
})

describe('buildUpiLink', () => {
  it('builds a link with payee, amount and note', () => {
    const link = buildUpiLink({
      vpa: 'shop@upi',
      payeeName: 'Bitlance',
      amountMinor: 125000,
      note: 'INV-0001',
    })
    expect(link).toContain('upi://pay?')
    expect(link).toContain('pa=shop%40upi')
    expect(link).toContain('am=1250.00')
    expect(link).toContain('pn=Bitlance')
    expect(link).toContain('tn=INV-0001')
  })

  it('returns null without a VPA rather than an unusable link', () => {
    expect(buildUpiLink({ vpa: null, payeeName: 'X', amountMinor: 100 })).toBeNull()
    expect(buildUpiLink({ vpa: '  ', payeeName: 'X', amountMinor: 100 })).toBeNull()
  })

  it('truncates long notes to what UPI apps accept', () => {
    const link = buildUpiLink({
      vpa: 'shop@upi',
      payeeName: 'X',
      amountMinor: 100,
      note: 'y'.repeat(120),
    })
    const note = new URL(link!.replace('upi://', 'https://')).searchParams.get('tn')
    expect(note).toHaveLength(50)
  })
})

describe('isOverdue', () => {
  const now = new Date('2026-08-25T12:00:00Z')

  it('is not overdue on the due date itself', () => {
    expect(isOverdue({ status: 'sent', due_date: '2026-08-25' }, now)).toBe(false)
  })

  it('is overdue the day after', () => {
    expect(isOverdue({ status: 'sent', due_date: '2026-08-24' }, now)).toBe(true)
  })

  it('never marks a draft, paid or void invoice overdue', () => {
    expect(isOverdue({ status: 'draft', due_date: '2020-01-01' }, now)).toBe(false)
    expect(isOverdue({ status: 'paid', due_date: '2020-01-01' }, now)).toBe(false)
    expect(isOverdue({ status: 'void', due_date: '2020-01-01' }, now)).toBe(false)
  })

  it('is not overdue without a due date', () => {
    expect(isOverdue({ status: 'sent', due_date: null }, now)).toBe(false)
  })
})

describe('planInvoiceReminders', () => {
  const now = new Date('2026-08-25T12:00:00Z')

  it('schedules the default ladder around the due date', () => {
    const planned = planInvoiceReminders('2026-09-01', DEFAULT_DUNNING_OFFSETS_DAYS, now)
    expect(planned.map((p) => p.offset_days)).toEqual([-3, 1, 7])
    expect(planned[0].send_at).toBe('2026-08-29T10:00:00.000Z')
  })

  it('drops offsets that already passed', () => {
    // Due tomorrow: the "3 days before" chase is history.
    const planned = planInvoiceReminders('2026-08-26', DEFAULT_DUNNING_OFFSETS_DAYS, now)
    expect(planned.map((p) => p.offset_days)).toEqual([1, 7])
  })

  it('returns nothing without a due date', () => {
    expect(planInvoiceReminders(null, [-3], now)).toEqual([])
    expect(planInvoiceReminders('not-a-date', [-3], now)).toEqual([])
  })
})

describe('invoiceMessage', () => {
  const base = {
    contactName: 'Asha',
    number: 'INV-0007',
    description: 'August retainer',
    amountMinor: 500000,
    currency: 'INR',
    dueDate: '2026-09-01',
    paymentUrl: 'https://pay.example/abc',
  }

  it('quotes the same amount in every tone', () => {
    for (const tone of ['new', 'reminder', 'overdue'] as const) {
      const text = invoiceMessage({ ...base, tone })
      expect(text).toContain('5,000.00')
      expect(text).toContain('INV-0007')
      expect(text).toContain('https://pay.example/abc')
    }
  })

  it('changes wording with the tone', () => {
    expect(invoiceMessage({ ...base, tone: 'new' })).toContain("here's your invoice")
    expect(invoiceMessage({ ...base, tone: 'reminder' })).toContain('quick reminder')
    expect(invoiceMessage({ ...base, tone: 'overdue' })).toContain('now overdue')
    expect(invoiceMessage({ ...base, tone: 'overdue' })).toContain('Was due')
  })

  it('omits the link and instructions when absent', () => {
    const text = invoiceMessage({
      ...base,
      paymentUrl: null,
      instructions: null,
      tone: 'new',
    })
    expect(text).not.toContain('Pay here')
  })
})

describe('nextRenewalDate', () => {
  it('advances by interval', () => {
    expect(nextRenewalDate('2026-01-15', 'weekly')).toBe('2026-01-22')
    expect(nextRenewalDate('2026-01-15', 'monthly')).toBe('2026-02-15')
    expect(nextRenewalDate('2026-01-15', 'quarterly')).toBe('2026-04-15')
    expect(nextRenewalDate('2026-01-15', 'yearly')).toBe('2027-01-15')
  })

  it('clamps to the last day of a shorter month instead of skipping a cycle', () => {
    expect(nextRenewalDate('2026-01-31', 'monthly')).toBe('2026-02-28')
    expect(nextRenewalDate('2028-01-31', 'monthly')).toBe('2028-02-29')
  })

  it('rolls the year over correctly', () => {
    expect(nextRenewalDate('2026-12-10', 'monthly')).toBe('2027-01-10')
    expect(nextRenewalDate('2026-11-30', 'quarterly')).toBe('2027-02-28')
  })

  it('passes through an unparseable date rather than inventing one', () => {
    expect(nextRenewalDate('sometime', 'monthly')).toBe('sometime')
  })
})

describe('isRenewalDue', () => {
  const now = new Date('2026-08-25T12:00:00Z')

  it('is due on and before the renewal date', () => {
    expect(isRenewalDue({ status: 'active', next_renewal_date: '2026-08-25' }, now)).toBe(true)
    expect(isRenewalDue({ status: 'active', next_renewal_date: '2026-08-20' }, now)).toBe(true)
  })

  it('is not due in the future or when paused/cancelled', () => {
    expect(isRenewalDue({ status: 'active', next_renewal_date: '2026-09-01' }, now)).toBe(false)
    expect(isRenewalDue({ status: 'paused', next_renewal_date: '2026-08-01' }, now)).toBe(false)
    expect(isRenewalDue({ status: 'cancelled', next_renewal_date: '2026-08-01' }, now)).toBe(false)
  })
})
