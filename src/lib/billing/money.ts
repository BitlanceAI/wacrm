/**
 * Money handling for invoices and subscriptions (migration 019).
 *
 * Amounts live as integer minor units (paise, cents) everywhere except
 * the moment a human types or reads one. Every conversion between the
 * two forms goes through here, because a rounding rule applied
 * inconsistently is how an invoice ends up a paisa short of what was
 * agreed.
 */

/** Minor units per major unit. Currencies here are all 100-based. */
const MINOR_PER_MAJOR = 100

export const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'] as const
export type Currency = (typeof SUPPORTED_CURRENCIES)[number]

/**
 * Parse what a person typed ("1,250.50", "₹1250", " 99 ") into minor
 * units. Returns null for anything that isn't a positive amount —
 * callers must reject rather than guess, since a silently-zeroed
 * invoice is worse than a validation error.
 */
export function parseAmountToMinor(input: string | number): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return null
    return Math.round(input * MINOR_PER_MAJOR)
  }

  // Check for a minus BEFORE stripping symbols: the strip would turn
  // "-5" into "5" and quietly invert a negative amount into a valid
  // invoice, which is the worst possible way to handle bad input.
  if (/-/.test(input)) return null

  const cleaned = input.replace(/[^0-9.]/g, '')
  if (!cleaned || (cleaned.match(/\./g) ?? []).length > 1) return null

  const value = Number(cleaned)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * MINOR_PER_MAJOR)
}

/** Minor units back to a plain major-unit number (for form inputs). */
export function minorToMajor(minor: number): number {
  return Math.round(minor) / MINOR_PER_MAJOR
}

/**
 * Display string with the currency symbol, e.g. "₹1,250.50".
 * Falls back to a bare formatted number if the runtime doesn't know
 * the currency — an unformatted amount still reads correctly, whereas
 * a thrown error takes the whole invoice list down.
 */
export function formatMoney(minor: number, currency: string = 'INR'): string {
  const major = minorToMajor(minor)
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major)
  } catch {
    return `${currency} ${major.toFixed(2)}`
  }
}

/**
 * The amount as a plain decimal string, no symbol or separators —
 * what a UPI deep link's `am` parameter requires.
 */
export function amountForUpi(minor: number): string {
  return minorToMajor(minor).toFixed(2)
}
