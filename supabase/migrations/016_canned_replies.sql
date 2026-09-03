-- 016_canned_replies.sql
--
-- Problem this fixes:
-- The only reusable text an agent could reach for was a Meta-approved
-- message template — which needs Meta's approval, is the wrong tool
-- for a free-text reply inside the 24-hour service window, and can't
-- be edited on the fly. So the same twenty FAQ answers were retyped by
-- hand, inconsistently, all day.
--
-- Canned replies are local-only text snippets addressed by a short
-- shortcut ("/hours", "/refund"). They never touch Meta; they simply
-- fill the composer.
--
-- `shortcut` is stored WITHOUT its leading slash and lowercased by the
-- app, so "/Hours" and "hours" can't become two different rows.

CREATE TABLE IF NOT EXISTS canned_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shortcut TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  /* Bumped on each insert into the composer — drives "most used first"
     ordering in the picker, which beats alphabetical once a desk has
     more than a handful of snippets. */
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, shortcut),
  CONSTRAINT canned_replies_shortcut_format
    CHECK (shortcut ~ '^[a-z0-9_-]{1,32}$'),
  CONSTRAINT canned_replies_body_not_blank
    CHECK (length(trim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_canned_replies_user
  ON canned_replies(user_id, usage_count DESC);

ALTER TABLE canned_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own canned replies" ON canned_replies;
CREATE POLICY "Users can manage own canned replies" ON canned_replies FOR ALL
  USING (auth.uid() = user_id);

COMMENT ON TABLE canned_replies IS
  'Local free-text snippets for the inbox composer. Unlike message_templates these never go to Meta for approval and are only valid inside the 24-hour service window.';
COMMENT ON COLUMN canned_replies.shortcut IS
  'Lowercase, no leading slash. The composer matches on "/" + this value.';

-- Atomic usage bump. Doing this client-side as read-modify-write would
-- lose counts whenever two agents used the same snippet at once.
CREATE OR REPLACE FUNCTION public.increment_canned_reply_usage(reply_id UUID)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
AS $$
  UPDATE canned_replies
  SET usage_count = usage_count + 1,
      updated_at = NOW()
  WHERE id = reply_id;
$$;
