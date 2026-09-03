/**
 * Inbound WhatsApp cart ("order") parsing (migration 020).
 *
 * Meta delivers a cart as a message of type `order`:
 *
 *   order: {
 *     catalog_id: "...",
 *     text: "customer's note",
 *     product_items: [
 *       { product_retailer_id, quantity, item_price, currency }
 *     ]
 *   }
 *
 * `item_price` is a MAJOR-unit number (12.5 means twelve rupees fifty),
 * while everything in this codebase stores integer minor units. That
 * conversion is the single most important thing this module does — get
 * it wrong and every order total is off by a factor of a hundred.
 */

export interface RawOrderItem {
  product_retailer_id?: string
  quantity?: number | string
  item_price?: number | string
  currency?: string
}

export interface RawOrder {
  catalog_id?: string
  text?: string
  product_items?: RawOrderItem[]
}

export interface ParsedOrderItem {
  retailer_id: string
  quantity: number
  unit_price_minor: number
  currency: string
}

export interface ParsedOrder {
  catalog_id: string | null
  customer_note: string | null
  items: ParsedOrderItem[]
  total_minor: number
  currency: string
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Normalize a raw cart into rows ready for `orders` / `order_items`.
 *
 * Returns null when there is nothing orderable — an empty cart is not
 * an order, and writing one would put a ₹0 row in the list for staff
 * to puzzle over.
 *
 * Lines with a missing retailer id or a non-positive quantity are
 * dropped rather than defaulted: guessing a quantity on a real purchase
 * is worse than recording one line fewer and having the customer say so.
 */
export function parseOrder(raw: RawOrder | undefined | null): ParsedOrder | null {
  if (!raw) return null

  const items: ParsedOrderItem[] = []
  for (const rawItem of raw.product_items ?? []) {
    const retailerId = rawItem.product_retailer_id?.trim()
    if (!retailerId) continue

    const quantity = toNumber(rawItem.quantity)
    if (quantity === null || quantity <= 0) continue

    const priceMajor = toNumber(rawItem.item_price) ?? 0
    items.push({
      retailer_id: retailerId,
      quantity: Math.round(quantity),
      // Major units -> minor units. Rounded, because floating-point
      // multiplication of 19.99 * 100 is 1998.9999999999998.
      unit_price_minor: Math.max(0, Math.round(priceMajor * 100)),
      currency: rawItem.currency?.trim() || 'INR',
    })
  }

  if (items.length === 0) return null

  const total = items.reduce(
    (sum, item) => sum + item.unit_price_minor * item.quantity,
    0
  )

  return {
    catalog_id: raw.catalog_id?.trim() || null,
    customer_note: raw.text?.trim() || null,
    items,
    total_minor: total,
    // Mixed-currency carts aren't a thing WhatsApp produces, so the
    // first line's currency describes the order.
    currency: items[0].currency,
  }
}

/** Human summary for the inbox bubble and the conversation preview. */
export function describeOrder(order: ParsedOrder): string {
  const count = order.items.reduce((sum, i) => sum + i.quantity, 0)
  return `[order] ${count} item${count === 1 ? '' : 's'}`
}

export const ORDER_STATUSES = [
  'received',
  'confirmed',
  'paid',
  'shipped',
  'completed',
  'cancelled',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]
