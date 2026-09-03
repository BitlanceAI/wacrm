-- 019_billing.sql
--
-- Payments, invoices and renewals.
--
-- Design decisions worth stating up front:
--
-- * NO GATEWAY INTEGRATION. This ships the parts that are provider-
--   agnostic — the invoice record, the reminder schedule, the renewal
--   clock — plus UPI deep links, which need no gateway account at all.
--   `payment_url` holds a link from whatever the account already uses
--   (Razorpay, Stripe, Cashfree, a bank page). Wiring a specific
--   provider's API is a later, separate decision; nothing here has to
--   change when it happens.
--
-- * MONEY IN INTEGER MINOR UNITS. amount_minor is paise/cents. Floating
--   point money is a bug waiting for a rounding error, and NUMERIC
--   round-trips through JSON as a string that JS then coerces anyway.
--
-- * INVOICE NUMBERS ARE ALLOCATED IN THE DATABASE. A number generated
--   client-side would collide the first time two invoices are raised
--   at once, and invoice numbers are exactly the thing that must not
--   collide.

-- ── Billing settings ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  currency TEXT NOT NULL DEFAULT 'INR',
  invoice_prefix TEXT NOT NULL DEFAULT 'INV-',
  /* Next number to hand out. Bumped inside next_invoice_number(). */
  invoice_next_number INTEGER NOT NULL DEFAULT 1,

  /* UPI collection details. With these set, every invoice can carry a
     working pay link without the account signing up for anything. */
  upi_vpa TEXT,
  upi_payee_name TEXT,

  /* Free text appended to invoice messages — bank details, GST notes,
     "please share the screenshot after paying", whatever the business
     already says by hand today. */
  payment_instructions TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id),
  CONSTRAINT billing_settings_next_number_positive
    CHECK (invoice_next_number > 0)
);

ALTER TABLE billing_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own billing settings" ON billing_settings;
CREATE POLICY "Users can manage own billing settings" ON billing_settings FOR ALL
  USING (auth.uid() = user_id);

-- ── Invoices ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  /* Set when the invoice was raised automatically by a renewal. */
  subscription_id UUID,

  number TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void', 'refunded')),
  due_date DATE,
  payment_url TEXT,
  /* Gateway/bank reference once paid — a UTR, a payment id, a cheque
     number. Free text on purpose: it comes from outside this system. */
  external_reference TEXT,

  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, number),
  CONSTRAINT invoices_amount_positive CHECK (amount_minor > 0)
);

CREATE INDEX IF NOT EXISTS idx_invoices_user_status
  ON invoices(user_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_contact
  ON invoices(contact_id, created_at DESC);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own invoices" ON invoices;
CREATE POLICY "Users can manage own invoices" ON invoices FOR ALL
  USING (auth.uid() = user_id);

COMMENT ON COLUMN invoices.amount_minor IS
  'Amount in the currency''s minor unit (paise for INR, cents for USD). Integer — never store money as a float.';

-- ── Invoice reminders ───────────────────────────────────────────────
-- Same materialized-row design as appointment_reminders: absolute
-- send_at, claimed_at against double-sends. Deliberately a separate
-- table rather than a shared polymorphic one — a dunning reminder and
-- an appointment nudge have different lifecycles (dunning stops the
-- instant an invoice is paid, from anywhere), and a shared table would
-- need a discriminator on every query for no gain.
CREATE TABLE IF NOT EXISTS invoice_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  send_at TIMESTAMPTZ NOT NULL,
  /* Negative = before the due date, positive = after (dunning). */
  offset_days INTEGER NOT NULL,

  channel TEXT NOT NULL DEFAULT 'text' CHECK (channel IN ('text', 'template')),
  message_text TEXT,
  template_name TEXT,
  template_language TEXT DEFAULT 'en_US',

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped', 'cancelled')),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  claimed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_reminders_due
  ON invoice_reminders(send_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_invoice
  ON invoice_reminders(invoice_id);

ALTER TABLE invoice_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own invoice reminders" ON invoice_reminders;
CREATE POLICY "Users can manage own invoice reminders" ON invoice_reminders FOR ALL
  USING (auth.uid() = user_id);

-- Chasing someone for money they have already paid is the single worst
-- failure mode here, so it is enforced by trigger rather than by
-- remembering to cancel reminders at every call site.
CREATE OR REPLACE FUNCTION public.cancel_reminders_on_invoice_settled()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('paid', 'void', 'refunded')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE invoice_reminders
    SET status = 'cancelled'
    WHERE invoice_id = NEW.id
      AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_invoice_reminders ON invoices;
CREATE TRIGGER trg_cancel_invoice_reminders
  AFTER UPDATE OF status ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.cancel_reminders_on_invoice_settled();

-- ── Subscriptions / renewals ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  plan_name TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',

  interval TEXT NOT NULL DEFAULT 'monthly'
    CHECK (interval IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_renewal_date DATE NOT NULL,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'cancelled')),

  /* Raise an invoice automatically on the renewal date. Off by default:
     silently billing a customer is not something to opt anyone into. */
  auto_invoice BOOLEAN NOT NULL DEFAULT FALSE,
  /* How many days ahead of the renewal to warn the customer. */
  reminder_days_before INTEGER NOT NULL DEFAULT 3,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT subscriptions_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT subscriptions_reminder_days_sane
    CHECK (reminder_days_before BETWEEN 0 AND 90)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_due
  ON subscriptions(next_renewal_date)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_subscriptions_user
  ON subscriptions(user_id, status);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own subscriptions" ON subscriptions;
CREATE POLICY "Users can manage own subscriptions" ON subscriptions FOR ALL
  USING (auth.uid() = user_id);

-- ── Invoice number allocation ───────────────────────────────────────
-- Atomic: the UPDATE ... RETURNING takes a row lock, so two concurrent
-- invoice creations get consecutive numbers instead of the same one.
-- SECURITY DEFINER so the counter row can be created on first use even
-- though the caller's RLS policy is what governs the rest of billing.
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT;
  v_number INTEGER;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not authorised to allocate invoice numbers for another account';
  END IF;

  INSERT INTO billing_settings (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE billing_settings
  SET invoice_next_number = invoice_next_number + 1,
      updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING invoice_prefix, invoice_next_number - 1
  INTO v_prefix, v_number;

  RETURN v_prefix || LPAD(v_number::TEXT, 4, '0');
END;
$$;

COMMENT ON FUNCTION public.next_invoice_number(UUID) IS
  'Allocates the next invoice number for a user, atomically. Refuses to allocate for any account other than the caller''s.';
