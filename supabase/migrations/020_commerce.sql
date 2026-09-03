-- 020_commerce.sql
--
-- Catalog and orders — the "share catalogs and close deals in chat"
-- half of the product promise.
--
-- How this fits Meta's model: the actual product catalog lives in Meta
-- Commerce Manager, and WhatsApp product messages reference items by
-- `retailer_id` within a `catalog_id`. This schema therefore mirrors
-- the catalog rather than owning it — `retailer_id` is the join key,
-- and everything else here (price, name, image) is a local copy kept
-- for display and for order-total arithmetic when Meta's payload
-- gives us only ids and quantities.
--
-- Orders arrive as an inbound webhook message of type `order` when a
-- customer sends a cart. Nothing in the CRM previously parsed that
-- message type, so carts were silently dropped on the floor.

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  /* The id used inside the Meta catalog. This — not our UUID — is what
     comes back on an order, so it has to be unique per account. */
  retailer_id TEXT NOT NULL,
  catalog_id TEXT,

  name TEXT NOT NULL,
  description TEXT,
  price_minor BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  image_url TEXT,
  in_stock BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, retailer_id),
  CONSTRAINT products_price_positive CHECK (price_minor >= 0)
);

CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id, name);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own products" ON products;
CREATE POLICY "Users can manage own products" ON products FOR ALL
  USING (auth.uid() = user_id);

COMMENT ON COLUMN products.retailer_id IS
  'Content ID / SKU inside the Meta catalog. Orders reference this, so it is the real primary key from WhatsApp''s point of view.';

-- ── Orders ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,

  /* Meta's message id for the cart message. Unique so a webhook replay
     updates nothing instead of duplicating the order. */
  wa_message_id TEXT,
  catalog_id TEXT,

  /* Denormalized from the items at insert time. Recomputing on read
     would silently change historical totals if a product's price is
     later edited — an order is a record of what was agreed. */
  total_minor BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  /* The note the customer typed alongside their cart. */
  customer_note TEXT,

  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'confirmed', 'paid', 'shipped', 'completed', 'cancelled')),
  /* Set when an invoice is raised from this order. */
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (wa_message_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_user_status
  ON orders(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_contact
  ON orders(contact_id, created_at DESC);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own orders" ON orders;
CREATE POLICY "Users can manage own orders" ON orders FOR ALL
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  /* Referenced by retailer_id, not by FK: a customer can order an item
     that was never mirrored into `products` (added in Commerce Manager
     but not here). Dropping that line would understate the order. */
  retailer_id TEXT NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,

  /* Name and price captured at order time. */
  name TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_minor BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT order_items_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own order items" ON order_items;
CREATE POLICY "Users can manage own order items" ON order_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = order_items.order_id
      AND orders.user_id = auth.uid()
  ));

COMMENT ON TABLE order_items IS
  'Line items captured from the customer''s WhatsApp cart. Name and unit price are snapshots — editing a product later must not rewrite past orders.';

-- Default catalog for product messages, stored next to the rest of the
-- WhatsApp connection rather than in a new table.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS catalog_id TEXT;

COMMENT ON COLUMN whatsapp_config.catalog_id IS
  'Meta Commerce Manager catalog id used when sending catalog and product messages.';
