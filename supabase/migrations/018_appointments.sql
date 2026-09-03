-- 018_appointments.sql
--
-- Bookings & appointments. Nothing in the CRM previously modelled "a
-- thing happening at a future time for a specific contact": the only
-- scheduling primitives were broadcast send-at (one campaign, one
-- moment) and cron-triggered automations (everybody, on a clock).
-- Neither can express "remind THIS customer 24 hours before THEIR
-- 3pm slot on Thursday".
--
-- Two tables:
--   appointments          — the booking itself
--   appointment_reminders — one row per scheduled nudge, each with its
--                           own absolute send_at so the cron sweep is a
--                           single indexed "what is due?" query rather
--                           than a recomputation over every booking.
--
-- Reminders are materialized rows, not offsets computed at sweep time,
-- because rescheduling a booking must visibly move its reminders (and
-- must not re-send one that already went out).

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  /* Optional: the thread the booking came out of, so a reminder can be
     posted into the same conversation the customer already knows. */
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,

  title TEXT NOT NULL,
  notes TEXT,
  location TEXT,

  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  /* The zone the booking was made in — needed to render "3pm" back to
     the customer correctly, which a UTC instant alone cannot do. */
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',

  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT appointments_end_after_start
    CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_appointments_user_start
  ON appointments(user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_contact
  ON appointments(contact_id, starts_at DESC);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own appointments" ON appointments;
CREATE POLICY "Users can manage own appointments" ON appointments FOR ALL
  USING (auth.uid() = user_id);

-- ── Reminders ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointment_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  /* Absolute instant, derived from starts_at - offset at write time.
     Storing it resolved is what makes the cron sweep one index scan. */
  send_at TIMESTAMPTZ NOT NULL,
  /* Kept alongside send_at so a reschedule can rebuild the same set of
     nudges without the caller having to remember what they were. */
  offset_minutes INTEGER NOT NULL,

  /* 'text' only works inside the 24-hour service window. A reminder
     for a booking a week out will almost always fall outside it, so
     'template' (a Meta-approved utility template) is the correct
     channel there — hence both are supported rather than assumed. */
  channel TEXT NOT NULL DEFAULT 'text' CHECK (channel IN ('text', 'template')),
  message_text TEXT,
  template_name TEXT,
  template_language TEXT DEFAULT 'en_US',
  /* Positional {{1}},{{2}}… values for the template, in order. */
  template_params JSONB,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped', 'cancelled')),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  /* Guards against a double-send when two cron ticks overlap. */
  claimed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT appointment_reminders_payload_present CHECK (
    (channel = 'text' AND message_text IS NOT NULL)
    OR (channel = 'template' AND template_name IS NOT NULL)
  )
);

-- The cron sweep's only query: pending reminders whose time has come.
-- Partial index keeps it off the (eventually much larger) sent history.
CREATE INDEX IF NOT EXISTS idx_appointment_reminders_due
  ON appointment_reminders(send_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_appointment_reminders_appointment
  ON appointment_reminders(appointment_id);

ALTER TABLE appointment_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own appointment reminders" ON appointment_reminders;
CREATE POLICY "Users can manage own appointment reminders" ON appointment_reminders FOR ALL
  USING (auth.uid() = user_id);

COMMENT ON TABLE appointment_reminders IS
  'Materialized per-booking nudges. send_at is absolute so the cron sweep is one indexed query; rescheduling rebuilds the pending rows and leaves already-sent ones alone.';
COMMENT ON COLUMN appointment_reminders.claimed_at IS
  'Set the moment a cron tick picks the row up. A second overlapping tick skips claimed rows, so a slow Meta call cannot produce two identical reminders.';

-- Cancelling a booking must silence its future reminders. Doing this in
-- a trigger rather than in the API means it holds no matter who does the
-- cancelling — the UI, a cron sweep, or a hand-run SQL statement.
CREATE OR REPLACE FUNCTION public.cancel_reminders_on_appointment_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'completed', 'no_show')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE appointment_reminders
    SET status = 'cancelled'
    WHERE appointment_id = NEW.id
      AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_reminders ON appointments;
CREATE TRIGGER trg_cancel_reminders
  AFTER UPDATE OF status ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.cancel_reminders_on_appointment_cancel();
