-- 025_razorpay_platform_billing.sql
--
-- Razorpay-backed payments for WACRM's own subscription plans (the
-- tiers in `plans`, migration 023). Two tables:
--
--   platform_subscriptions — one row per tenant owner: which plan they
--     are on and until when. Written only by the server (service role)
--     after a verified Razorpay payment; owners can read their own row.
--
--   platform_payments — one row per Razorpay order we create. The
--     order is inserted as `created` before checkout opens, flipped to
--     `paid` by signature-verified confirmation (client callback or
--     webhook, whichever lands first — idempotent), or `failed`.
--
-- Also adds plans.max_seats so team-seat limits come from the plan
-- (starter 1, growth 5, business NULL = unlimited).

ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_seats INT;

UPDATE plans SET max_seats = 1  WHERE slug = 'starter'  AND max_seats IS NULL;
UPDATE plans SET max_seats = 5  WHERE slug = 'growth'   AND max_seats IS NULL;
-- business stays NULL = unlimited

CREATE TABLE IF NOT EXISTS platform_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_slug TEXT NOT NULL,
  interval TEXT NOT NULL DEFAULT 'monthly' CHECK (interval IN ('monthly', 'yearly')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired')),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ NOT NULL,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_slug TEXT NOT NULL,
  interval TEXT NOT NULL CHECK (interval IN ('monthly', 'yearly')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  razorpay_order_id TEXT NOT NULL UNIQUE,
  razorpay_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_payments_user
  ON platform_payments(user_id, created_at DESC);

ALTER TABLE platform_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_payments ENABLE ROW LEVEL SECURITY;

-- Owners read their own subscription/payments; all writes happen on
-- the service-role client after signature verification. No INSERT /
-- UPDATE / DELETE policies on purpose.
DROP POLICY IF EXISTS "Users read own platform subscription" ON platform_subscriptions;
CREATE POLICY "Users read own platform subscription" ON platform_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own platform payments" ON platform_payments;
CREATE POLICY "Users read own platform payments" ON platform_payments
  FOR SELECT USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_updated_at ON platform_subscriptions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON platform_payments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
