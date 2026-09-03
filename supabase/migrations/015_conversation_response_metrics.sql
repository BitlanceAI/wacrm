-- 015_conversation_response_metrics.sql
--
-- Problem this fixes:
-- `conversations` recorded only the last message and an open/pending/
-- closed status. Nothing recorded WHEN the customer first asked, WHEN
-- an agent first answered, or WHEN the thread was resolved — so no
-- first-response or resolution figure could be produced at all, and a
-- thread waiting three days for a reply looked identical to one
-- answered in thirty seconds.
--
-- Two distinct things are tracked here, and they answer different
-- questions:
--
--   LIFETIME (set once, per conversation)
--     first_inbound_at / first_response_at / first_response_seconds
--     -> "how fast do we answer a new customer?"
--
--   CURRENT CYCLE (set and cleared repeatedly)
--     awaiting_reply_since
--     -> "which threads are waiting on US right now, and for how long?"
--
-- Resolution timing is per-close: reopening a thread clears it, and
-- closing again overwrites it, so the figure always describes the most
-- recent resolution rather than a stale one.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS first_inbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_response_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS awaiting_reply_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_seconds INTEGER;

-- "Oldest unanswered thread" is the inbox's most-used sort, and the
-- partial index keeps it off the answered rows entirely.
CREATE INDEX IF NOT EXISTS idx_conversations_awaiting_reply
  ON conversations(user_id, awaiting_reply_since)
  WHERE awaiting_reply_since IS NOT NULL;

-- Reporting scans resolutions by user over a date window.
CREATE INDEX IF NOT EXISTS idx_conversations_resolved_at
  ON conversations(user_id, resolved_at)
  WHERE resolved_at IS NOT NULL;

COMMENT ON COLUMN conversations.first_inbound_at IS
  'Timestamp of the very first customer message. Set once, never overwritten — the clock every first-response figure is measured from.';
COMMENT ON COLUMN conversations.first_response_at IS
  'First agent (human or template) reply after first_inbound_at. Set once. NULL means the conversation has never been answered.';
COMMENT ON COLUMN conversations.first_response_seconds IS
  'first_response_at - first_inbound_at, denormalized so reporting can aggregate without a per-row subtraction.';
COMMENT ON COLUMN conversations.awaiting_reply_since IS
  'Set when a customer message arrives with no reply outstanding; cleared the moment an agent replies. NULL = the ball is in the customer''s court.';
COMMENT ON COLUMN conversations.resolved_at IS
  'When the conversation was last moved to closed. Cleared on reopen, so NULL on an open thread even if it was closed once before.';
COMMENT ON COLUMN conversations.resolution_seconds IS
  'resolved_at - first_inbound_at (falling back to created_at for threads with no inbound message).';

-- Backfill so existing conversations aren't invisible to reporting.
-- Only the timestamps that can be derived from stored messages are
-- filled; first_response_seconds follows from them.
UPDATE conversations c
SET first_inbound_at = sub.first_in,
    first_response_at = sub.first_out
FROM (
  SELECT
    m.conversation_id,
    MIN(m.created_at) FILTER (WHERE m.sender_type = 'customer') AS first_in,
    MIN(m.created_at) FILTER (WHERE m.sender_type <> 'customer') AS first_out
  FROM messages m
  GROUP BY m.conversation_id
) sub
WHERE c.id = sub.conversation_id
  AND c.first_inbound_at IS NULL
  AND c.first_response_at IS NULL;

-- An "answer" that predates the question isn't one — that's an outbound
-- thread the customer later replied to, so it has no response time.
UPDATE conversations
SET first_response_at = NULL
WHERE first_response_at IS NOT NULL
  AND (first_inbound_at IS NULL OR first_response_at < first_inbound_at);

UPDATE conversations
SET first_response_seconds =
      GREATEST(0, EXTRACT(EPOCH FROM (first_response_at - first_inbound_at))::INTEGER)
WHERE first_response_seconds IS NULL
  AND first_response_at IS NOT NULL
  AND first_inbound_at IS NOT NULL;

-- Threads still open with an unanswered last customer message are
-- waiting on us right now; seed the cycle clock from that message.
UPDATE conversations c
SET awaiting_reply_since = sub.last_in
FROM (
  SELECT
    m.conversation_id,
    MAX(m.created_at) FILTER (WHERE m.sender_type = 'customer') AS last_in,
    MAX(m.created_at) FILTER (WHERE m.sender_type <> 'customer') AS last_out
  FROM messages m
  GROUP BY m.conversation_id
) sub
WHERE c.id = sub.conversation_id
  AND c.status <> 'closed'
  AND c.awaiting_reply_since IS NULL
  AND sub.last_in IS NOT NULL
  AND (sub.last_out IS NULL OR sub.last_in > sub.last_out);
