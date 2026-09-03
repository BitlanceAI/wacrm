/**
 * Loyalty tiers, points arithmetic and coupon validation
 * (migration 021).
 *
 * Pure rules, kept out of the routes so the tier a customer is told
 * they're on matches the tier the broadcast segment puts them in.
 */

export interface LoyaltyTier {
  name: string
  /** Lifetime points needed to reach this tier. */
  threshold: number
  color: string
}

/**
 * Tiers are keyed on LIFETIME points, not the current balance:
 * spending your points shouldn't demote you, which is the single most
 * common complaint about badly-built loyalty schemes.
 */
export const LOYALTY_TIERS: LoyaltyTier[] = [
  { name: 'Bronze', threshold: 0, color: '#b45309' },
  { name: 'Silver', threshold: 1000, color: '#94a3b8' },
  { name: 'Gold', threshold: 5000, color: '#eab308' },
  { name: 'Platinum', threshold: 15000, color: '#a78bfa' },
]

export function tierForPoints(lifetimePoints: number): LoyaltyTier {
  let current = LOYALTY_TIERS[0]
  for (const tier of LOYALTY_TIERS) {
    if (lifetimePoints >= tier.threshold) current = tier
  }
  return current
}

/** Points still needed for the next tier; null at the top. */
export function pointsToNextTier(lifetimePoints: number): {
  tier: LoyaltyTier
  needed: number
} | null {
  const next = LOYALTY_TIERS.find((t) => t.threshold > lifetimePoints)
  if (!next) return null
  return { tier: next, needed: next.threshold - lifetimePoints }
}

/**
 * Points earned on a purchase. One point per major currency unit by
 * default (₹1 = 1 point), floored — awarding fractional points invites
 * rounding arguments nobody wants to have.
 */
export function pointsForPurchase(
  amountMinor: number,
  pointsPerMajorUnit = 1
): number {
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return 0
  return Math.floor((amountMinor / 100) * pointsPerMajorUnit)
}

/** Can this balance cover a redemption? */
export function canRedeem(balance: number, points: number): boolean {
  return points > 0 && balance >= points
}

// ── Coupons ──────────────────────────────────────────────────────────

export interface CouponLike {
  code: string
  discount_type: 'percent' | 'fixed'
  discount_value: number
  active: boolean
  starts_at?: string | null
  expires_at?: string | null
  max_redemptions?: number | null
  redeemed_count: number
}

export type CouponRejection =
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'exhausted'
  | null

/**
 * Why a coupon can't be used right now, or null if it can.
 *
 * Returns the specific reason rather than a boolean so the customer
 * can be told "that code expired on the 3rd" instead of the useless
 * "invalid code" — which is what makes them message support.
 */
export function couponRejection(
  coupon: CouponLike,
  now: Date = new Date()
): CouponRejection {
  if (!coupon.active) return 'inactive'
  if (coupon.starts_at && new Date(coupon.starts_at) > now) return 'not_started'
  if (coupon.expires_at && new Date(coupon.expires_at) <= now) return 'expired'
  if (
    coupon.max_redemptions != null &&
    coupon.redeemed_count >= coupon.max_redemptions
  ) {
    return 'exhausted'
  }
  return null
}

export function couponRejectionMessage(
  reason: Exclude<CouponRejection, null>,
  coupon: CouponLike
): string {
  switch (reason) {
    case 'inactive':
      return `Coupon ${coupon.code} is not active.`
    case 'not_started':
      return `Coupon ${coupon.code} isn't valid yet.`
    case 'expired':
      return `Coupon ${coupon.code} expired${
        coupon.expires_at
          ? ` on ${new Date(coupon.expires_at).toLocaleDateString()}`
          : ''
      }.`
    case 'exhausted':
      return `Coupon ${coupon.code} has reached its redemption limit.`
  }
}

/**
 * The discount in minor units, capped at the order total — a ₹500
 * fixed-value coupon against a ₹300 order discounts ₹300, never
 * producing a negative total the payment link couldn't represent.
 */
export function discountForOrder(
  coupon: Pick<CouponLike, 'discount_type' | 'discount_value'>,
  orderTotalMinor: number
): number {
  if (orderTotalMinor <= 0) return 0
  const raw =
    coupon.discount_type === 'percent'
      ? Math.round((orderTotalMinor * coupon.discount_value) / 100)
      : coupon.discount_value
  return Math.min(raw, orderTotalMinor)
}

/** Canonical coupon code: uppercase, no spaces or punctuation. */
export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '')
}
