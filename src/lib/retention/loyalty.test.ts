import { describe, it, expect } from 'vitest'
import {
  tierForPoints,
  pointsToNextTier,
  pointsForPurchase,
  canRedeem,
  couponRejection,
  couponRejectionMessage,
  discountForOrder,
  normalizeCouponCode,
  type CouponLike,
} from './loyalty'

describe('tierForPoints', () => {
  it('places customers in the right band', () => {
    expect(tierForPoints(0).name).toBe('Bronze')
    expect(tierForPoints(999).name).toBe('Bronze')
    expect(tierForPoints(1000).name).toBe('Silver')
    expect(tierForPoints(5000).name).toBe('Gold')
    expect(tierForPoints(99999).name).toBe('Platinum')
  })
})

describe('pointsToNextTier', () => {
  it('reports the gap to the next band', () => {
    expect(pointsToNextTier(600)).toEqual({
      tier: expect.objectContaining({ name: 'Silver' }),
      needed: 400,
    })
  })

  it('is null at the top tier', () => {
    expect(pointsToNextTier(20000)).toBeNull()
  })
})

describe('pointsForPurchase', () => {
  it('awards one point per major unit by default', () => {
    expect(pointsForPurchase(125000)).toBe(1250)
  })

  it('floors fractional awards', () => {
    expect(pointsForPurchase(150)).toBe(1)
    expect(pointsForPurchase(99)).toBe(0)
  })

  it('applies a multiplier', () => {
    expect(pointsForPurchase(10000, 2)).toBe(200)
  })

  it('awards nothing for zero, negative or junk amounts', () => {
    expect(pointsForPurchase(0)).toBe(0)
    expect(pointsForPurchase(-500)).toBe(0)
    expect(pointsForPurchase(Number.NaN)).toBe(0)
  })
})

describe('canRedeem', () => {
  it('allows a redemption the balance covers', () => {
    expect(canRedeem(500, 500)).toBe(true)
    expect(canRedeem(500, 100)).toBe(true)
  })

  it('refuses an over-redemption or a non-positive one', () => {
    expect(canRedeem(100, 500)).toBe(false)
    expect(canRedeem(100, 0)).toBe(false)
    expect(canRedeem(100, -50)).toBe(false)
  })
})

describe('couponRejection', () => {
  const now = new Date('2026-08-25T12:00:00Z')
  const base: CouponLike = {
    code: 'SAVE10',
    discount_type: 'percent',
    discount_value: 10,
    active: true,
    redeemed_count: 0,
  }

  it('accepts a live coupon', () => {
    expect(couponRejection(base, now)).toBeNull()
  })

  it('names each specific reason so the customer can be told', () => {
    expect(couponRejection({ ...base, active: false }, now)).toBe('inactive')
    expect(
      couponRejection({ ...base, starts_at: '2026-09-01T00:00:00Z' }, now)
    ).toBe('not_started')
    expect(
      couponRejection({ ...base, expires_at: '2026-08-01T00:00:00Z' }, now)
    ).toBe('expired')
    expect(
      couponRejection({ ...base, max_redemptions: 5, redeemed_count: 5 }, now)
    ).toBe('exhausted')
  })

  it('treats the expiry instant itself as expired', () => {
    expect(
      couponRejection({ ...base, expires_at: '2026-08-25T12:00:00Z' }, now)
    ).toBe('expired')
  })

  it('leaves unlimited coupons usable however often they are redeemed', () => {
    expect(
      couponRejection({ ...base, max_redemptions: null, redeemed_count: 9999 }, now)
    ).toBeNull()
  })

  it('produces a message naming the coupon', () => {
    expect(couponRejectionMessage('expired', base)).toContain('SAVE10')
  })
})

describe('discountForOrder', () => {
  it('computes a percentage discount', () => {
    expect(discountForOrder({ discount_type: 'percent', discount_value: 10 }, 125000)).toBe(12500)
  })

  it('computes a fixed discount', () => {
    expect(discountForOrder({ discount_type: 'fixed', discount_value: 5000 }, 125000)).toBe(5000)
  })

  it('never discounts more than the order is worth', () => {
    expect(discountForOrder({ discount_type: 'fixed', discount_value: 50000 }, 30000)).toBe(30000)
  })

  it('is zero on an empty order', () => {
    expect(discountForOrder({ discount_type: 'percent', discount_value: 50 }, 0)).toBe(0)
  })

  it('rounds percentage discounts to whole minor units', () => {
    expect(discountForOrder({ discount_type: 'percent', discount_value: 33 }, 1001)).toBe(330)
  })
})

describe('normalizeCouponCode', () => {
  it('uppercases and strips punctuation so one code stays one code', () => {
    expect(normalizeCouponCode(' save10! ')).toBe('SAVE10')
    expect(normalizeCouponCode('new-year_2026')).toBe('NEW-YEAR_2026')
  })
})
