-- 023_plans.sql
--
-- Subscription plans, DB-driven so the operator edits pricing from
-- /admin/pricing instead of redeploying. The public /pricing page
-- reads these rows anonymously; writes go through the admin panel's
-- server actions on the service-role client only.

CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  -- Integer minor units (paise), same convention as billing (019).
  price_monthly_minor BIGINT NOT NULL CHECK (price_monthly_minor >= 0),
  price_yearly_minor BIGINT CHECK (price_yearly_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  -- Display bullet points, JSON array of strings.
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- "MOST POPULAR" style emphasis on the pricing page.
  highlight BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous visitors on /pricing) may read active
-- plans. No insert/update/delete policies exist: all writes happen on
-- the service-role client from the admin panel.
DROP POLICY IF EXISTS "Anyone can read active plans" ON plans;
CREATE POLICY "Anyone can read active plans" ON plans
  FOR SELECT USING (active = true);

DROP TRIGGER IF EXISTS set_updated_at ON plans;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed the launch tiers (idempotent). Prices in paise.
INSERT INTO plans (slug, name, description, price_monthly_minor, price_yearly_minor, features, highlight, sort_order)
VALUES
  (
    'starter', 'Starter',
    'For solo founders getting their WhatsApp channel off the ground.',
    99900, 999000,
    '["1 team member","5,000 contacts","100 campaigns / month","Shared team inbox","Template builder with Meta submission","Basic automations","Meta message rates — zero markup"]'::jsonb,
    false, 1
  ),
  (
    'growth', 'Growth',
    'For growing teams running WhatsApp as a real revenue channel.',
    249900, 2499000,
    '["5 team members","50,000 contacts","Unlimited campaigns","Everything in Starter","Chatbot flows & advanced automations","Developer API & webhooks","WhatsApp Business App coexistence","Priority support"]'::jsonb,
    true, 2
  ),
  (
    'business', 'Business',
    'For established businesses running their operations on WhatsApp.',
    499900, 4999000,
    '["Unlimited team members","Unlimited contacts","Everything in Growth","Catalog & order management","Invoices & payment reminders","Loyalty & coupons","Appointments","Dedicated onboarding & support"]'::jsonb,
    false, 3
  )
ON CONFLICT (slug) DO NOTHING;
