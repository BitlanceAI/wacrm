-- 021_retention.sql
--
-- Loyalty and coupons — the "run loyalty programmes and drive
-- re-engagement" half of retention. (The other half, behavioural
-- win-back segments, needs no schema: it is derived from the message
-- history already in `messages`.)
--
-- The ledger design is the important decision here. `points_balance`
-- is a cached total, and every change to it is also written as an
-- immutable row in `loyalty_transactions`. A balance with no ledger
-- behind it is unauditable: when a customer says "I had 500 points",
-- there has to be something to check that against. The balance is kept
-- denormalized anyway because the alternative — summing the ledger on
-- every read — makes the contact list quadratic.

CREATE TABLE IF NOT EXISTS loyalty_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  /* Current spendable balance. Maintained by the ledger trigger below,
     never written directly. */
  points_balance INTEGER NOT NULL DEFAULT 0,
  /* Total ever earned — drives tier, and unlike the balance it never
     goes down when points are spent. Someone who earned and redeemed
     10,000 points is still a top-tier customer. */
  lifetime_points INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, contact_id),
  CONSTRAINT loyalty_balance_non_negative CHECK (points_balance >= 0)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_user
  ON loyalty_accounts(user_id, points_balance DESC);

ALTER TABLE loyalty_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own loyalty accounts" ON loyalty_accounts;
CREATE POLICY "Users can manage own loyalty accounts" ON loyalty_accounts FOR ALL
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  /* Positive = earned, negative = redeemed or corrected away. */
  points INTEGER NOT NULL,
  reason TEXT NOT NULL,
  /* Free-form link back to what caused it — an order id, an invoice
     number, an agent's note. */
  reference TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT loyalty_transaction_non_zero CHECK (points <> 0)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_account
  ON loyalty_transactions(account_id, created_at DESC);

ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own loyalty transactions" ON loyalty_transactions;
CREATE POLICY "Users can manage own loyalty transactions" ON loyalty_transactions FOR ALL
  USING (auth.uid() = user_id);

-- Balance follows the ledger, not the other way round. Doing this in a
-- trigger means the two cannot disagree regardless of which surface
-- writes the transaction.
CREATE OR REPLACE FUNCTION public.apply_loyalty_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE loyalty_accounts
  SET points_balance = points_balance + NEW.points,
      /* Only earnings raise the lifetime figure. */
      lifetime_points = lifetime_points + GREATEST(NEW.points, 0),
      updated_at = NOW()
  WHERE id = NEW.account_id;

  /* The CHECK on points_balance turns an over-redemption into an error
     here, which is correct: refusing the transaction is far better than
     letting a balance go negative. */
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_loyalty_transaction ON loyalty_transactions;
CREATE TRIGGER trg_apply_loyalty_transaction
  AFTER INSERT ON loyalty_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_loyalty_transaction();

-- ── Coupons ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  /* Stored uppercased by the app so "save10" and "SAVE10" can't become
     two coupons a customer would reasonably expect to be one. */
  code TEXT NOT NULL,
  description TEXT,

  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  /* percent: 1-100. fixed: an amount in minor units. */
  discount_value INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',

  /* NULL = unlimited. */
  max_redemptions INTEGER,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  once_per_contact BOOLEAN NOT NULL DEFAULT TRUE,

  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, code),
  CONSTRAINT coupons_value_positive CHECK (discount_value > 0),
  CONSTRAINT coupons_percent_range
    CHECK (discount_type <> 'percent' OR discount_value <= 100),
  CONSTRAINT coupons_window_ordered
    CHECK (starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_coupons_user_active
  ON coupons(user_id, active, expires_at);

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own coupons" ON coupons;
CREATE POLICY "Users can manage own coupons" ON coupons FOR ALL
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,

  /* What the discount was actually worth, resolved at redemption. A
     percentage coupon's value depends on the order, so recomputing it
     later would give a different answer. */
  discount_applied_minor BIGINT,

  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforces once_per_contact at the DB level for the common case. A
-- coupon that allows repeat use simply won't have this violated,
-- because the app only inserts a second row for those.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_once_per_contact
  ON coupon_redemptions(coupon_id, contact_id)
  WHERE contact_id IS NOT NULL;

ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own coupon redemptions" ON coupon_redemptions;
CREATE POLICY "Users can manage own coupon redemptions" ON coupon_redemptions FOR ALL
  USING (auth.uid() = user_id);

-- Redemption count follows its ledger too, for the same reason as the
-- loyalty balance: max_redemptions is only meaningful if the count
-- cannot drift from reality.
CREATE OR REPLACE FUNCTION public.bump_coupon_redeemed_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE coupons
  SET redeemed_count = redeemed_count + 1,
      updated_at = NOW()
  WHERE id = NEW.coupon_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_coupon_redeemed ON coupon_redemptions;
CREATE TRIGGER trg_bump_coupon_redeemed
  AFTER INSERT ON coupon_redemptions
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_coupon_redeemed_count();

COMMENT ON TABLE coupon_redemptions IS
  'One row per use. The unique index enforces once-per-contact; discount_applied_minor is captured at redemption because a percentage discount cannot be recomputed later.';
