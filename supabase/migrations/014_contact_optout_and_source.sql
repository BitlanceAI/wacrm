-- 014_contact_optout_and_source.sql
--
-- Two gaps this closes, both on `contacts`:
--
-- 1. MARKETING OPT-OUT (compliance)
--    Nothing in the schema recorded whether a contact had asked to stop
--    receiving marketing. Broadcasts sent to every resolved contact
--    unconditionally, so a "STOP" reply had no effect — a WhatsApp
--    Business Policy violation and the fastest route to a quality-rating
--    downgrade. `marketing_opt_in` defaults TRUE so existing contacts
--    keep their current (implicitly opted-in) behaviour.
--
-- 2. LEAD SOURCE / CTWA ATTRIBUTION
--    Inbound messages from a Click-to-WhatsApp ad carry a `referral`
--    object (source_id = the ad id, source_url, headline, ctwa_clid).
--    The webhook dropped it, so ad-sourced leads were indistinguishable
--    from someone who found the number on a business card. `source` is
--    the coarse channel; `source_details` keeps the raw first-touch
--    referral payload for attribution reporting.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opt_out_reason TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_details JSONB;

-- Kept as a CHECK rather than an enum so adding a channel later is an
-- ALTER, not a type migration. Values must match ContactSource in
-- src/types/index.ts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_source_check' AND conrelid = 'contacts'::regclass
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_source_check
      CHECK (source IN ('manual', 'import', 'whatsapp', 'ctwa_ad', 'api', 'automation'));
  END IF;
END $$;

-- Every broadcast audience query filters on this, per user.
CREATE INDEX IF NOT EXISTS idx_contacts_user_opt_in
  ON contacts(user_id, marketing_opt_in);

-- Attribution reporting groups by source within a user.
CREATE INDEX IF NOT EXISTS idx_contacts_user_source
  ON contacts(user_id, source);

COMMENT ON COLUMN contacts.marketing_opt_in IS
  'FALSE once the contact asked to stop marketing messages (STOP keyword, or toggled off by an agent). Broadcasts must skip these contacts; service/utility replies inside the 24h window are unaffected.';
COMMENT ON COLUMN contacts.opt_out_reason IS
  'How the opt-out happened: keyword | manual | meta_block. NULL while opted in.';
COMMENT ON COLUMN contacts.source IS
  'Channel this contact first arrived through. ctwa_ad = Click-to-WhatsApp ad, identified by the referral object on the first inbound message.';
COMMENT ON COLUMN contacts.source_details IS
  'First-touch attribution payload. For ctwa_ad: {source_id, source_type, source_url, headline, body, media_type, ctwa_clid, captured_at}.';
