-- 017_support_desk.sql
--
-- Completes the support layer on top of 015's response clocks:
--
--   1. TICKET FIELDS on conversations — priority, category and a
--      resolution note. Without them every thread is equally urgent and
--      "why did this take three days" has no answer after the fact.
--
--   2. INBOX SETTINGS — business hours, away message and CSAT config,
--      one row per user. Previously the CRM had no concept of being
--      closed: a message at 2am looked exactly like one at 2pm, and the
--      "over 4 hours unanswered" figure counted the night shift nobody
--      works.
--
--   3. CSAT RESPONSES — the survey sent after a thread is resolved.
--      Scores arrive as interactive button taps (reply id "csat:N"),
--      which the webhook already parses into interactive_reply_id.

-- ── 1. Ticket fields ────────────────────────────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT,
  /* Rate-limits the away auto-reply so a customer sending six messages
     overnight gets one "we're closed", not six. */
  ADD COLUMN IF NOT EXISTS last_away_sent_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_priority_check'
      AND conrelid = 'conversations'::regclass
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_priority_check
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  END IF;
END $$;

-- The inbox filters by priority within a user; normal-priority threads
-- are the overwhelming majority so they're excluded from the index.
CREATE INDEX IF NOT EXISTS idx_conversations_priority
  ON conversations(user_id, priority)
  WHERE priority <> 'normal';

COMMENT ON COLUMN conversations.priority IS
  'Agent-set urgency: low | normal | high | urgent. Does not affect routing on its own — it drives inbox sorting and the escalation view.';
COMMENT ON COLUMN conversations.last_away_sent_at IS
  'When the out-of-hours auto-reply last went out on this thread. Compared against inbox_settings.away_cooldown_minutes so a customer is never told twice in one night.';

-- ── 2. Inbox settings ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inbox_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  /* IANA zone. Business hours are meaningless without one — 09:00 has
     to be 09:00 somewhere specific, and the server's clock is UTC. */
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',

  /* [{ dow: 0..6 (0=Mon), closed: bool, open: "HH:mm", close: "HH:mm" }]
     Kept as JSONB rather than seven columns so a future "second shift"
     or per-day multiple windows doesn't need another migration. */
  business_hours JSONB NOT NULL DEFAULT '[
    {"dow":0,"closed":false,"open":"09:00","close":"18:00"},
    {"dow":1,"closed":false,"open":"09:00","close":"18:00"},
    {"dow":2,"closed":false,"open":"09:00","close":"18:00"},
    {"dow":3,"closed":false,"open":"09:00","close":"18:00"},
    {"dow":4,"closed":false,"open":"09:00","close":"18:00"},
    {"dow":5,"closed":false,"open":"10:00","close":"14:00"},
    {"dow":6,"closed":true,"open":"09:00","close":"18:00"}
  ]'::jsonb,

  away_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  away_message TEXT NOT NULL DEFAULT
    'Thanks for your message! Our team is away right now. We''ll reply as soon as we''re back.',
  away_cooldown_minutes INTEGER NOT NULL DEFAULT 240,

  csat_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  csat_question TEXT NOT NULL DEFAULT
    'How would you rate the support you received today?',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id),
  CONSTRAINT inbox_settings_cooldown_check
    CHECK (away_cooldown_minutes BETWEEN 0 AND 10080)
);

ALTER TABLE inbox_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own inbox settings" ON inbox_settings;
CREATE POLICY "Users can manage own inbox settings" ON inbox_settings FOR ALL
  USING (auth.uid() = user_id);

COMMENT ON TABLE inbox_settings IS
  'Per-account support desk configuration: when the desk is open, what to say when it is not, and whether to survey customers after a thread is resolved.';

-- ── 3. CSAT responses ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS csat_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,

  /* 1-5. NULL until the customer taps a button — a sent-but-unanswered
     survey is itself a signal (response rate), so the row is created at
     send time rather than on reply. */
  score INTEGER,
  comment TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT csat_score_range CHECK (score IS NULL OR score BETWEEN 1 AND 5)
);

-- At most one unanswered survey per conversation: re-closing a thread
-- must not stack a second survey on top of one the customer hasn't
-- answered yet.
CREATE UNIQUE INDEX IF NOT EXISTS idx_csat_one_pending_per_conversation
  ON csat_responses(conversation_id)
  WHERE responded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_csat_user_responded
  ON csat_responses(user_id, responded_at DESC)
  WHERE responded_at IS NOT NULL;

ALTER TABLE csat_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own csat responses" ON csat_responses;
CREATE POLICY "Users can manage own csat responses" ON csat_responses FOR ALL
  USING (auth.uid() = user_id);

COMMENT ON TABLE csat_responses IS
  'Post-resolution satisfaction surveys. One row per survey SENT; score/responded_at fill in when the customer taps a rating button (interactive reply id "csat:N").';
