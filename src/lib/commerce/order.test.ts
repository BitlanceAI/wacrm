import { describe, it, expect } from 'vitest'
import { parseOrder, describeOrder } from './order'

describe('parseOrder', () => {
  it('converts major-unit item prices into integer minor units', () => {
    const result = parseOrder({
      catalog_id: 'cat_1',
      text: 'please deliver after 6pm',
      product_items: [
        { product_retailer_id: 'SKU-1', quantity: 2, item_price: 19.99, currency: 'INR' },
      ],
    })
    expect(result).not.toBeNull()
    expect(result!.items[0].unit_price_minor).toBe(1999)
    expect(result!.total_minor).toBe(3998)
    expect(result!.customer_note).toBe('please deliver after 6pm')
    expect(result!.catalog_id).toBe('cat_1')
  })

  it('rounds away float multiplication error rather than truncating', () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE 754.
    const result = parseOrder({
      product_items: [{ product_retailer_id: 'x', quantity: 1, item_price: 19.99 }],
    })
    expect(result!.items[0].unit_price_minor).toBe(1999)
  })

  it('accepts string quantities and prices from the payload', () => {
    const result = parseOrder({
      product_items: [
        { product_retailer_id: 'SKU-1', quantity: '3', item_price: '10.50' },
      ],
    })
    expect(result!.items[0].quantity).toBe(3)
    expect(result!.total_minor).toBe(3150)
  })

  it('totals a multi-line cart', () => {
    const result = parseOrder({
      product_items: [
        { product_retailer_id: 'A', quantity: 2, item_price: 100 },
        { product_retailer_id: 'B', quantity: 1, item_price: 49.5 },
      ],
    })
    expect(result!.total_minor).toBe(24950)
    expect(result!.items).toHaveLength(2)
  })

  it('drops lines with no retailer id or a non-positive quantity', () => {
    const result = parseOrder({
      product_items: [
        { product_retailer_id: '', quantity: 1, item_price: 10 },
        { product_retailer_id: 'B', quantity: 0, item_price: 10 },
        { product_retailer_id: 'C', quantity: -2, item_price: 10 },
        { product_retailer_id: 'D', quantity: 1, item_price: 10 },
      ],
    })
    expect(result!.items.map((i) => i.retailer_id)).toEqual(['D'])
  })

  it('returns null for an empty or missing cart instead of a zero order', () => {
    expect(parseOrder(null)).toBeNull()
    expect(parseOrder(undefined)).toBeNull()
    expect(parseOrder({})).toBeNull()
    expect(parseOrder({ product_items: [] })).toBeNull()
    expect(parseOrder({ product_items: [{ quantity: 1 }] })).toBeNull()
  })

  it('defaults a missing price to zero rather than dropping the line', () => {
    const result = parseOrder({
      product_items: [{ product_retailer_id: 'FREEBIE', quantity: 1 }],
    })
    expect(result!.items[0].unit_price_minor).toBe(0)
    expect(result!.total_minor).toBe(0)
  })

  it('takes the currency from the first line', () => {
    const result = parseOrder({
      product_items: [
        { product_retailer_id: 'A', quantity: 1, item_price: 1, currency: 'USD' },
      ],
    })
    expect(result!.currency).toBe('USD')
  })
})

describe('describeOrder', () => {
  it('counts units, not lines', () => {
    const order = parseOrder({
      product_items: [
        { product_retailer_id: 'A', quantity: 2, item_price: 1 },
        { product_retailer_id: 'B', quantity: 3, item_price: 1 },
      ],
    })!
    expect(describeOrder(order)).toBe('[order] 5 items')
  })

  it('singularises a one-item cart', () => {
    const order = parseOrder({
      product_items: [{ product_retailer_id: 'A', quantity: 1, item_price: 1 }],
    })!
    expect(describeOrder(order)).toBe('[order] 1 item')
  })
})
