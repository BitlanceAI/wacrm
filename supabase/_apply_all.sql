-- ============================================================
-- COMBINED SCHEMA — all migrations 001..012, in order.
-- Paste this whole file into the Supabase SQL Editor and Run.
-- Safe to re-run (every statement uses IF NOT EXISTS / OR REPLACE).
-- ============================================================


-- ############################################################
-- ## 001_initial_schema.sql
-- ############################################################
-- ============================================================
-- Idempotent migration — safe to run multiple times.
-- Uses IF NOT EXISTS for tables/indexes and DROP IF EXISTS
-- for policies/triggers (Postgres has no CREATE POLICY IF NOT EXISTS).
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- CONTACTS
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  company TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own contacts" ON contacts;
CREATE POLICY "Users can manage own contacts" ON contacts FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- TAGS
-- ============================================================
CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own tags" ON tags;
CREATE POLICY "Users can manage own tags" ON tags FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- CONTACT_TAGS (many-to-many)
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON contact_tags(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_tags_tag ON contact_tags(tag_id);

ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage contact tags" ON contact_tags;
CREATE POLICY "Users can manage contact tags" ON contact_tags FOR ALL
  USING (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_tags.contact_id AND contacts.user_id = auth.uid()));

-- ============================================================
-- CUSTOM_FIELDS
-- ============================================================
CREATE TABLE IF NOT EXISTS custom_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  field_options JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own custom fields" ON custom_fields;
CREATE POLICY "Users can manage own custom fields" ON custom_fields FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- CONTACT_CUSTOM_VALUES
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_custom_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  custom_field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id, custom_field_id)
);

ALTER TABLE contact_custom_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage custom values" ON contact_custom_values;
CREATE POLICY "Users can manage custom values" ON contact_custom_values FOR ALL
  USING (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_custom_values.contact_id AND contacts.user_id = auth.uid()));

-- ============================================================
-- CONTACT_NOTES
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contact_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own notes" ON contact_notes;
CREATE POLICY "Users can manage own notes" ON contact_notes FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  assigned_agent_id UUID,
  last_message_text TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_contact_id ON conversations(contact_id);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own conversations" ON conversations;
CREATE POLICY "Users can manage own conversations" ON conversations FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'agent', 'bot')),
  sender_id UUID,
  content_type TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'image', 'document', 'audio', 'video', 'location', 'template')),
  content_text TEXT,
  media_url TEXT,
  template_name TEXT,
  message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sending', 'sent', 'delivered', 'read', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own messages" ON messages;
DROP POLICY IF EXISTS "Service role can insert messages" ON messages;
CREATE POLICY "Users can view own messages" ON messages FOR ALL
  USING (EXISTS (SELECT 1 FROM conversations WHERE conversations.id = messages.conversation_id AND conversations.user_id = auth.uid()));
CREATE POLICY "Service role can insert messages" ON messages FOR INSERT WITH CHECK (true);

-- ============================================================
-- WHATSAPP_CONFIG
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  waba_id TEXT,
  access_token TEXT NOT NULL,
  verify_token TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE whatsapp_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own config" ON whatsapp_config;
CREATE POLICY "Users can manage own config" ON whatsapp_config FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- MESSAGE_TEMPLATES
-- ============================================================
CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Marketing' CHECK (category IN ('Marketing', 'Utility', 'Authentication')),
  language TEXT DEFAULT 'en_US',
  header_type TEXT CHECK (header_type IN ('text', 'image', 'video', 'document')),
  header_content TEXT,
  body_text TEXT NOT NULL,
  footer_text TEXT,
  buttons JSONB,
  status TEXT DEFAULT 'Draft' CHECK (status IN ('Draft', 'Pending', 'Approved', 'Rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own templates" ON message_templates;
CREATE POLICY "Users can manage own templates" ON message_templates FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- PIPELINES
-- ============================================================
CREATE TABLE IF NOT EXISTS pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own pipelines" ON pipelines;
CREATE POLICY "Users can manage own pipelines" ON pipelines FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- PIPELINE_STAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage pipeline stages" ON pipeline_stages;
CREATE POLICY "Users can manage pipeline stages" ON pipeline_stages FOR ALL
  USING (EXISTS (SELECT 1 FROM pipelines WHERE pipelines.id = pipeline_stages.pipeline_id AND pipelines.user_id = auth.uid()));

-- ============================================================
-- DEALS
-- ============================================================
CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES pipeline_stages(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  conversation_id UUID REFERENCES conversations(id),
  title TEXT NOT NULL,
  value NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  notes TEXT,
  expected_close_date DATE,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON deals(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage_id);

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own deals" ON deals;
CREATE POLICY "Users can manage own deals" ON deals FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- BROADCASTS
-- ============================================================
CREATE TABLE IF NOT EXISTS broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_language TEXT NOT NULL DEFAULT 'en_US',
  template_variables JSONB,
  audience_filter JSONB,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  read_count INTEGER DEFAULT 0,
  replied_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own broadcasts" ON broadcasts;
CREATE POLICY "Users can manage own broadcasts" ON broadcasts FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- BROADCAST_RECIPIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'replied', 'failed')),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast ON broadcast_recipients(broadcast_id);

ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage broadcast recipients" ON broadcast_recipients;
CREATE POLICY "Users can manage broadcast recipients" ON broadcast_recipients FOR ALL
  USING (EXISTS (SELECT 1 FROM broadcasts WHERE broadcasts.id = broadcast_recipients.broadcast_id AND broadcasts.user_id = auth.uid()));

-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables with updated_at — drop existing triggers first to avoid conflicts
DROP TRIGGER IF EXISTS set_updated_at ON profiles;
DROP TRIGGER IF EXISTS set_updated_at ON contacts;
DROP TRIGGER IF EXISTS set_updated_at ON conversations;
DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_config;
DROP TRIGGER IF EXISTS set_updated_at ON message_templates;
DROP TRIGGER IF EXISTS set_updated_at ON deals;
DROP TRIGGER IF EXISTS set_updated_at ON broadcasts;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON message_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON broadcasts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- AUTO-CREATE PROFILE ON USER SIGNUP
-- Uses SECURITY DEFINER with owner=postgres (bypasses RLS).
-- EXCEPTION block ensures signup still succeeds even if profile
-- insert fails — profile can be created later if needed.
-- ============================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- ENABLE REALTIME for key tables (idempotent via DO block)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
  END IF;
END $$;


-- ############################################################
-- ## 002_pipelines_enhancements.sql
-- ############################################################
-- ============================================================
-- Pipeline enhancements:
--   * deals.assigned_to — optional FK to profiles.id
--   * deals.status — CHECK constraint ('open', 'won', 'lost')
--     (replaces the old default 'active' with spec-compliant values)
--
-- Idempotent: safe to run multiple times.
-- ============================================================

-- Add assigned_to (nullable, FK to profiles)
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_assigned_to ON deals(assigned_to);

-- Normalize status values: any existing 'active' row becomes 'open'
UPDATE deals SET status = 'open' WHERE status = 'active' OR status IS NULL;

-- Replace the old default and enforce allowed values
ALTER TABLE deals ALTER COLUMN status SET DEFAULT 'open';

-- Drop prior CHECK if any (none in 001, but be idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_status_check' AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals DROP CONSTRAINT deals_status_check;
  END IF;
END $$;

ALTER TABLE deals
  ADD CONSTRAINT deals_status_check CHECK (status IN ('open', 'won', 'lost'));


-- ############################################################
-- ## 003_broadcast_recipient_wamid.sql
-- ############################################################
-- ============================================================
-- Broadcast recipient correlation + aggregate counts
--
-- Problem this solves:
--   * broadcast_recipients had no column to correlate with Meta's
--     message id, so webhook status updates (sent/delivered/read)
--     could not be mirrored into the recipient row and the broadcast
--     aggregate counts never advanced.
--   * aggregate counts on `broadcasts` (sent/delivered/read/replied/
--     failed) were updated ad-hoc by the sender, which drifted quickly
--     once webhooks arrived out of band.
--
-- This migration:
--   1. Adds whatsapp_message_id (+ unique index) so webhooks can find
--      a recipient given Meta's message id.
--   2. Adds a composite index on (broadcast_id, status) so the
--      aggregate trigger's COUNT(*) FILTER scans are fast.
--   3. Installs an AFTER INSERT/UPDATE/DELETE trigger on
--      broadcast_recipients that re-aggregates the parent broadcasts
--      row. Keeps writer code trivial — the webhook + hook only touch
--      the recipient row; counts stay consistent automatically.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS whatsapp_message_id TEXT;

-- UNIQUE so webhook retries can't create duplicate correlations.
CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcast_recipients_wamid
  ON broadcast_recipients (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

-- Fast path for the aggregate trigger's COUNT(*) FILTER subqueries.
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_status
  ON broadcast_recipients (broadcast_id, status);

-- ============================================================
-- Aggregate trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_broadcast_counts(bid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE broadcasts b SET
    sent_count      = agg.sent_count,
    delivered_count = agg.delivered_count,
    read_count      = agg.read_count,
    replied_count   = agg.replied_count,
    failed_count    = agg.failed_count,
    updated_at      = NOW()
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent','delivered','read','replied')) AS sent_count,
      COUNT(*) FILTER (WHERE status IN ('delivered','read','replied'))        AS delivered_count,
      COUNT(*) FILTER (WHERE status IN ('read','replied'))                    AS read_count,
      COUNT(*) FILTER (WHERE status = 'replied')                              AS replied_count,
      COUNT(*) FILTER (WHERE status = 'failed')                               AS failed_count
    FROM broadcast_recipients
    WHERE broadcast_id = bid
  ) agg
  WHERE b.id = bid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.broadcast_recipient_aggregate_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_broadcast_counts(OLD.broadcast_id);
    RETURN OLD;
  END IF;

  -- INSERT or UPDATE — only recompute when status changed (or on fresh insert)
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.recompute_broadcast_counts(NEW.broadcast_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS broadcast_recipients_aggregate ON broadcast_recipients;
CREATE TRIGGER broadcast_recipients_aggregate
AFTER INSERT OR UPDATE OR DELETE ON broadcast_recipients
FOR EACH ROW EXECUTE FUNCTION public.broadcast_recipient_aggregate_trigger();


-- ############################################################
-- ## 004_contact_delete_set_null.sql
-- ############################################################
-- ============================================================
-- Allow contact deletion without wiping history.
--
-- broadcast_recipients.contact_id and deals.contact_id were declared
-- NOT NULL REFERENCES contacts(id) with no ON DELETE action, so
-- Postgres defaults to NO ACTION. The first time a user tried to
-- delete a contact that had ever received a broadcast or been
-- attached to a deal, the delete failed with:
--
--   ERROR 23503: update or delete on table "contacts" violates
--   foreign key constraint ... on table <other>
--
-- CASCADE is the wrong fix — it would silently wipe historical
-- broadcast recipient rows (breaking audit + retroactively moving
-- broadcasts.sent_count / delivered_count / read_count etc. via the
-- aggregate trigger) and deal rows.
--
-- SET NULL is the right fix: history rows survive with a NULL
-- contact_id. The UI is already null-safe (contact?.name ?? 'Unknown',
-- contact?.phone, etc.).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ── broadcast_recipients.contact_id ────────────────────────────
ALTER TABLE broadcast_recipients
  ALTER COLUMN contact_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'broadcast_recipients_contact_id_fkey'
      AND conrelid = 'broadcast_recipients'::regclass
  ) THEN
    ALTER TABLE broadcast_recipients
      DROP CONSTRAINT broadcast_recipients_contact_id_fkey;
  END IF;
END $$;

ALTER TABLE broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
    ON DELETE SET NULL;

-- ── deals.contact_id ───────────────────────────────────────────
ALTER TABLE deals
  ALTER COLUMN contact_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_contact_id_fkey'
      AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals
      DROP CONSTRAINT deals_contact_id_fkey;
  END IF;
END $$;

ALTER TABLE deals
  ADD CONSTRAINT deals_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
    ON DELETE SET NULL;


-- ############################################################
-- ## 005_broadcast_counts_incremental.sql
-- ############################################################
-- ============================================================
-- Incremental broadcast aggregate trigger.
--
-- Migration 003 installed a trigger that recomputed every counter
-- (sent/delivered/read/replied/failed) via COUNT(*) FILTER on every
-- row change. For a 10k-recipient broadcast, the send loop produces
-- 10k INSERTs + 10k UPDATEs = 20k full aggregate scans, each walking
-- the (broadcast_id, status) index. Workable at small scale, but
-- O(n²) overall.
--
-- This migration replaces that with an incremental trigger that
-- adjusts the parent broadcast's counts by ±1 based on the OLD →
-- NEW.status delta. O(1) per recipient change; no scans at all.
--
-- Semantic model (same as the lib/broadcast-status.ts "forward-only
-- ladder" in the webhook):
--   sent_count       = recipients whose status is at or past 'sent'
--   delivered_count  = ... at or past 'delivered'
--   read_count       = ... at or past 'read'
--   replied_count    = status = 'replied'
--   failed_count     = status = 'failed'
--
-- A webhook that advances a recipient pending → sent → delivered →
-- read → replied bumps every rung it crosses by 1. Going to 'failed'
-- only bumps failed_count (and can only happen from pending / sent,
-- enforced in the webhook).
--
-- Keeps the safety net: a public recompute_broadcast_counts() SQL
-- function is retained so ops can run it manually if counts ever
-- drift (e.g. after bulk DB surgery).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- Delta a single column by +1 / -1.
CREATE OR REPLACE FUNCTION public._bcast_bump(bid UUID, col TEXT, delta INT)
RETURNS VOID AS $$
BEGIN
  EXECUTE format(
    'UPDATE broadcasts SET %I = GREATEST(0, %I + $1), updated_at = NOW() WHERE id = $2',
    col, col
  ) USING delta, bid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Columns this recipient's status contributes to.
CREATE OR REPLACE FUNCTION public._bcast_cols_for_status(s TEXT)
RETURNS TEXT[] AS $$
BEGIN
  -- 'pending' contributes to nothing.
  IF s = 'pending' THEN RETURN ARRAY[]::TEXT[]; END IF;
  IF s = 'sent'      THEN RETURN ARRAY['sent_count']; END IF;
  IF s = 'delivered' THEN RETURN ARRAY['sent_count','delivered_count']; END IF;
  IF s = 'read'      THEN RETURN ARRAY['sent_count','delivered_count','read_count']; END IF;
  IF s = 'replied'   THEN RETURN ARRAY['sent_count','delivered_count','read_count','replied_count']; END IF;
  IF s = 'failed'    THEN RETURN ARRAY['failed_count']; END IF;
  RETURN ARRAY[]::TEXT[];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Replace the trigger body with the incremental version.
CREATE OR REPLACE FUNCTION public.broadcast_recipient_aggregate_trigger()
RETURNS TRIGGER AS $$
DECLARE
  old_cols TEXT[];
  new_cols TEXT[];
  c TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_cols := _bcast_cols_for_status(NEW.status);
    FOREACH c IN ARRAY new_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, 1);
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    old_cols := _bcast_cols_for_status(OLD.status);
    FOREACH c IN ARRAY old_cols LOOP
      PERFORM _bcast_bump(OLD.broadcast_id, c, -1);
    END LOOP;
    RETURN OLD;
  END IF;

  -- UPDATE: only care if status changed.
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    old_cols := _bcast_cols_for_status(OLD.status);
    new_cols := _bcast_cols_for_status(NEW.status);
    -- Subtract the old contributions, add the new.
    FOREACH c IN ARRAY old_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, -1);
    END LOOP;
    FOREACH c IN ARRAY new_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, 1);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger itself remains the same (INSERT/UPDATE/DELETE) — just its
-- body has been replaced.

-- Safety net — rebuild counts from scratch. Retained as-is so ops can
-- run it on demand if something ever drifts. Matches the incremental
-- trigger's semantic model exactly.
CREATE OR REPLACE FUNCTION public.recompute_broadcast_counts(bid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE broadcasts b SET
    sent_count      = agg.sent_count,
    delivered_count = agg.delivered_count,
    read_count      = agg.read_count,
    replied_count   = agg.replied_count,
    failed_count    = agg.failed_count,
    updated_at      = NOW()
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent','delivered','read','replied')) AS sent_count,
      COUNT(*) FILTER (WHERE status IN ('delivered','read','replied'))        AS delivered_count,
      COUNT(*) FILTER (WHERE status IN ('read','replied'))                    AS read_count,
      COUNT(*) FILTER (WHERE status = 'replied')                              AS replied_count,
      COUNT(*) FILTER (WHERE status = 'failed')                               AS failed_count
    FROM broadcast_recipients
    WHERE broadcast_id = bid
  ) agg
  WHERE b.id = bid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ############################################################
-- ## 006_automations.sql
-- ############################################################
-- ============================================================
-- 006_automations.sql — Automations feature
--
-- Idempotent migration — safe to run multiple times.
-- Follows the same conventions as 001_initial_schema.sql:
--   IF NOT EXISTS on tables/indexes, DROP IF EXISTS before
--   re-creating policies/triggers (Postgres has no
--   CREATE POLICY IF NOT EXISTS).
-- ============================================================

-- ============================================================
-- AUTOMATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  execution_count INTEGER NOT NULL DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automations_user_id ON automations(user_id);
-- Partial index tuned for the engine's hot path: find active automations
-- whose trigger_type matches the fired event. RLS then narrows by user_id.
CREATE INDEX IF NOT EXISTS idx_automations_active_trigger
  ON automations(trigger_type) WHERE is_active = TRUE;

ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own automations" ON automations;
CREATE POLICY "Users can manage own automations" ON automations FOR ALL
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_updated_at ON automations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON automations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- AUTOMATION_STEPS
--
-- `position`       — order within parent scope (root scope or a branch).
-- `parent_step_id` — NULL for root-level steps; set to the Condition
--                    step's id for steps that live inside one of its
--                    branches.
-- `branch`         — NULL for root steps. For children of a Condition,
--                    'yes' or 'no' identifying which path.
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  parent_step_id UUID REFERENCES automation_steps(id) ON DELETE CASCADE,
  branch TEXT CHECK (branch IN ('yes', 'no')),
  step_type TEXT NOT NULL,
  step_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_steps_automation_id
  ON automation_steps(automation_id, position);
CREATE INDEX IF NOT EXISTS idx_automation_steps_parent
  ON automation_steps(parent_step_id) WHERE parent_step_id IS NOT NULL;

ALTER TABLE automation_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage steps of own automations" ON automation_steps;
CREATE POLICY "Users can manage steps of own automations" ON automation_steps FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM automations a
      WHERE a.id = automation_steps.automation_id
        AND a.user_id = auth.uid()
    )
  );

-- ============================================================
-- AUTOMATION_LOGS
--
-- user_id is denormalized for simple RLS; contact_id is nullable so
-- history survives contact deletion (mirrors migration 004's pattern
-- on broadcast_recipients / deals).
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  trigger_event TEXT NOT NULL,
  steps_executed JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_automation
  ON automation_logs(automation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_logs_user ON automation_logs(user_id);

ALTER TABLE automation_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own automation logs" ON automation_logs;
CREATE POLICY "Users can view own automation logs" ON automation_logs FOR ALL
  USING (auth.uid() = user_id);

-- ============================================================
-- AUTOMATION_PENDING_EXECUTIONS
--
-- Queue row created when a running automation hits a `wait` step.
-- The cron endpoint drains rows where run_at <= now() and status =
-- 'pending', flips them to 'running', and resumes the automation
-- from `next_step_position` with the saved `context` jsonb.
--
-- Service-role only — writes never originate from the browser, and
-- the engine uses the service-role client. No user policy exposed.
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_pending_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  log_id UUID REFERENCES automation_logs(id) ON DELETE CASCADE,
  parent_step_id UUID REFERENCES automation_steps(id) ON DELETE SET NULL,
  branch TEXT CHECK (branch IN ('yes', 'no')),
  next_step_position INTEGER NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  run_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_pending_due
  ON automation_pending_executions(run_at) WHERE status = 'pending';

ALTER TABLE automation_pending_executions ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policy for authenticated users — all
-- access is server-side via the service-role key.


-- ############################################################
-- ## 007_automations_increment_counter.sql
-- ############################################################
-- ============================================================
-- 007_automations_increment_counter.sql
--
-- Atomic increment of automations.execution_count + refresh of
-- last_executed_at. Called via PostgREST RPC from the engine.
--
-- Before this, the engine did a read-modify-write:
--   UPDATE automations SET execution_count = <cached + 1> WHERE id = ...
-- so two concurrent dispatches (e.g. the same automation firing for
-- two different contacts in the same second) could both read N and
-- both write N+1, permanently losing one count.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION increment_automation_execution_count(p_automation_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE automations
  SET
    execution_count = execution_count + 1,
    last_executed_at = NOW()
  WHERE id = p_automation_id;
$$;

-- Only the service role needs to call this (engine uses the
-- service-role client). Explicitly lock anon / authenticated out so
-- an authenticated user can't juice someone else's counter via RPC.
REVOKE ALL ON FUNCTION increment_automation_execution_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_automation_execution_count(UUID) FROM anon;
REVOKE ALL ON FUNCTION increment_automation_execution_count(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_automation_execution_count(UUID) TO service_role;


-- ############################################################
-- ## 008_profile_avatars_storage.sql
-- ############################################################
-- ============================================================
-- 008_profile_avatars_storage.sql
--
-- Creates the `avatars` Supabase Storage bucket and the RLS policies
-- that let each user manage only their own avatar file while letting
-- everyone read (so rendering <img> tags without signed URLs works).
--
-- File path convention used by the app:
--   avatars/{auth.uid()}/avatar-<timestamp>.<ext>
-- The policies rely on the first path segment matching auth.uid()::text.
--
-- Idempotent — safe to re-run.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  TRUE,
  2097152, -- 2 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies live on storage.objects. Drop-if-exists because Postgres
-- has no CREATE POLICY IF NOT EXISTS, and we want this migration to
-- re-run cleanly.
DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
CREATE POLICY "Avatars are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );


-- ############################################################
-- ## 009_message_actions.sql
-- ############################################################
-- ============================================================
-- Chat actions: reply linkage + reactions
--
-- Adds two things the chat UI now needs:
--
--   1. `messages.reply_to_message_id` — a self-FK so a message can
--      point at the message it replies to. We use the internal UUID
--      (not Meta's message_id text), because Meta IDs aren't unique
--      across phone numbers and can't be FK-constrained. The webhook
--      resolves `context.id` from Meta into our internal UUID before
--      writing. ON DELETE SET NULL — a deleted parent must not nuke
--      its replies (which today never happens, but the constraint
--      should match intent).
--
--   2. `message_reactions` table — one row per (message, actor).
--      Reactions arrive concurrently from agents (UI) and customers
--      (webhook). A row-level uniqueness constraint enforces "one
--      reaction per actor per message" without read-modify-write
--      games on a JSONB column.
--
--      `conversation_id` is denormalised purely so Supabase Realtime
--      can filter on it with a plain `eq`. Realtime can't join.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. Reply linkage on messages
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID
  REFERENCES messages(id) ON DELETE SET NULL;

-- Partial index — most messages aren't replies, so skip nulls.
CREATE INDEX IF NOT EXISTS idx_messages_reply_to
  ON messages(reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

-- ============================================================
-- 2. message_reactions
-- ============================================================
CREATE TABLE IF NOT EXISTS message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('customer', 'agent')),
  actor_id UUID,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, actor_type, actor_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_conversation
  ON message_reactions(conversation_id);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
  ON message_reactions(message_id);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see reactions on their conversations" ON message_reactions;
CREATE POLICY "Users see reactions on their conversations" ON message_reactions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_reactions.conversation_id
      AND c.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users insert reactions on their conversations" ON message_reactions;
CREATE POLICY "Users insert reactions on their conversations" ON message_reactions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_reactions.conversation_id
      AND c.user_id = auth.uid()
  ));

-- Agents may remove their own reactions. Customer reactions are managed
-- by the webhook (service-role bypass), not the UI.
DROP POLICY IF EXISTS "Users delete their own agent reactions" ON message_reactions;
CREATE POLICY "Users delete their own agent reactions" ON message_reactions FOR DELETE
  USING (
    actor_type = 'agent'
    AND actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = message_reactions.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- Agents may swap their own reaction emoji (UPDATE path is also used by
-- the upsert in /api/whatsapp/react).
DROP POLICY IF EXISTS "Users update their own agent reactions" ON message_reactions;
CREATE POLICY "Users update their own agent reactions" ON message_reactions FOR UPDATE
  USING (
    actor_type = 'agent'
    AND actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = message_reactions.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- Realtime — let the thread subscribe filtered by conversation_id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;
  END IF;
END $$;


-- ############################################################
-- ## 010_flows.sql
-- ############################################################
-- ============================================================
-- Conversational Flows: stateful, branching WhatsApp chatbot.
--
-- What this migration adds:
--
--   1. `flows` — the definition envelope (name, trigger config,
--      entry node, fallback policy, status). One row per authored bot.
--
--   2. `flow_nodes` — the graph rows. Edges live INSIDE each node's
--      `config` JSONB (e.g. each button row carries its own
--      `next_node_key`). Why edges-in-config rather than a separate
--      `flow_edges` table:
--        - The runner only ever asks "given current node X, where does
--          reply Y go?" — that's a single-row lookup with the JSON
--          already on the row. Splitting edges out forces a join per
--          inbound message.
--        - The builder's natural unit of edit is the node ("change this
--          button's label and target"); a side table would force
--          coordinated inserts/deletes on every save.
--      Cross-node integrity is enforced at save-time by the validator
--      (mirrors what `automation_steps`/`validate.ts` already does).
--
--      `node_key` is a STABLE STRING (e.g. "menu_existing"), not the
--      UUID. Edge targets reference node_key, which means:
--        - Cloning a flow doesn't require UUID rewriting in JSON edges.
--        - Templates ship with human-readable keys.
--        - Direct DB inspection is debuggable.
--      The (flow_id, node_key) UNIQUE constraint guarantees lookup
--      determinism.
--
--   3. `flow_runs` — per-contact runtime state machine. The linchpin
--      is the partial unique index `idx_one_active_run_per_contact`:
--      at most one ACTIVE run per (user_id, contact_id). Two concurrent
--      webhook deliveries trying to start a run both attempt INSERT;
--      the second fails with 23505 and the runner catches & exits.
--      No locking required.
--
--   4. `flow_run_events` — append-only audit. Used by the runner for
--      idempotency (refuses to advance twice on the same Meta
--      message_id) and by the future run-history viewer.
--
--   5. Widens `messages.content_type` CHECK to allow 'interactive', and
--      adds `messages.interactive_reply_id`. With this, button/list
--      taps become first-class message rows with a queryable reply id
--      instead of getting silently coerced into the "Unsupported
--      message type" fallback in parseMessageContent.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. Messages table — widen content_type, add interactive_reply_id
-- ============================================================

-- Drop & re-add the CHECK constraint to add 'interactive' as an allowed
-- value. Migration 001 named it `messages_content_type_check` (Postgres
-- default for an inline CHECK on a TEXT column).
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive'
  ));

-- Reply id of the button / list row the customer tapped. NULL for
-- everything that isn't an interactive reply. No FK — Meta button ids
-- are arbitrary user-chosen strings, not row references.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS interactive_reply_id TEXT;

-- ============================================================
-- 2. flows
-- ============================================================
CREATE TABLE IF NOT EXISTS flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  trigger_type TEXT NOT NULL
    CHECK (trigger_type IN ('keyword', 'first_inbound_message', 'manual')),
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- References `flow_nodes.node_key` (a string, not the UUID). NULL
  -- while the flow is being authored; required before activation
  -- (enforced by the validator, not at the DB level so drafts can save).
  entry_node_id TEXT,
  fallback_policy JSONB NOT NULL DEFAULT
    '{"on_unknown_reply":"reprompt","max_reprompts":2,"on_timeout_hours":24,"on_exhaust":"handoff"}'::jsonb,
  execution_count INTEGER NOT NULL DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Active-only lookups dominate the runner's hot path. Partial index
-- keeps it small even when archived flows accumulate.
CREATE INDEX IF NOT EXISTS idx_flows_active_trigger
  ON flows(user_id, trigger_type)
  WHERE status = 'active';

ALTER TABLE flows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own flows" ON flows;
CREATE POLICY "Users can manage own flows" ON flows FOR ALL
  USING (auth.uid() = user_id);

-- ============================================================
-- 3. flow_nodes
-- ============================================================
CREATE TABLE IF NOT EXISTS flow_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'http_fetch',
    'end'
  )),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Reserved for the v2 react-flow canvas. v1 list editor leaves both
  -- at 0; carrying the columns now avoids a follow-up migration when
  -- the canvas ships.
  position_x INTEGER NOT NULL DEFAULT 0,
  position_y INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flow_id, node_key)
);

CREATE INDEX IF NOT EXISTS idx_flow_nodes_flow
  ON flow_nodes(flow_id);

ALTER TABLE flow_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage nodes on their flows" ON flow_nodes;
CREATE POLICY "Users manage nodes on their flows" ON flow_nodes FOR ALL
  USING (EXISTS (
    SELECT 1 FROM flows f
    WHERE f.id = flow_nodes.flow_id
      AND f.user_id = auth.uid()
  ));

-- ============================================================
-- 4. flow_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS flow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- contact_id intentionally SET NULL on delete (matches the
  -- automation_logs / broadcast_recipients pattern in migration 004):
  -- deleting a contact must not erase the historical audit trail.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'active',           -- currently awaiting customer input
    'completed',        -- reached an end node naturally
    'handed_off',       -- ended via a handoff node
    'timed_out',        -- swept by the cron after fallback_policy.on_timeout_hours
    'paused_by_agent',  -- an agent manually replied; flow yielded
    'failed'            -- runner hit an unrecoverable error
  )),
  current_node_key TEXT,
  last_prompt_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  -- Captured collect_input values + http_fetch responses. Interpolated
  -- into downstream node configs at advance time.
  vars JSONB NOT NULL DEFAULT '{}'::jsonb,
  reprompt_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_advanced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT
);

-- Linchpin of idempotency / concurrency safety. At most one active run
-- per (user_id, contact_id). Two concurrent webhook deliveries each
-- trying to start a run will collide on this index; the second INSERT
-- fails with 23505 and the runner catches & returns consumed:true.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_contact
  ON flow_runs(user_id, contact_id)
  WHERE status = 'active';

-- Cron sweep query: "find active runs older than X hours" needs to be
-- index-supported so the sweeper stays cheap as flow volume grows.
CREATE INDEX IF NOT EXISTS idx_flow_runs_active_advanced
  ON flow_runs(last_advanced_at)
  WHERE status = 'active';

-- Detail / history page queries: "list runs for this flow, newest first".
CREATE INDEX IF NOT EXISTS idx_flow_runs_flow_started
  ON flow_runs(flow_id, started_at DESC);

ALTER TABLE flow_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own flow runs" ON flow_runs;
CREATE POLICY "Users see own flow runs" ON flow_runs FOR SELECT
  USING (auth.uid() = user_id);

-- The runner uses service_role for all writes; users never INSERT /
-- UPDATE / DELETE flow_runs from the client. Omitting those policies
-- keeps the surface tight (mirrors automation_pending_executions).

-- ============================================================
-- 5. flow_run_events
-- ============================================================
CREATE TABLE IF NOT EXISTS flow_run_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'started',
    'node_entered',
    'message_sent',
    'reply_received',
    'fallback_fired',
    'handoff',
    'timeout',
    'error',
    'completed'
  )),
  node_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency check in the runner needs fast lookup by
-- (flow_run_id, event_type, payload->>'meta_message_id'). The runner
-- does the JSONB extraction client-side; index just needs the first
-- two columns to narrow.
CREATE INDEX IF NOT EXISTS idx_flow_run_events_run_type
  ON flow_run_events(flow_run_id, event_type);

-- History viewer: reverse-chronological scan per run.
CREATE INDEX IF NOT EXISTS idx_flow_run_events_run_time
  ON flow_run_events(flow_run_id, created_at DESC);

ALTER TABLE flow_run_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see events on their runs" ON flow_run_events;
CREATE POLICY "Users see events on their runs" ON flow_run_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM flow_runs r
    WHERE r.id = flow_run_events.flow_run_id
      AND r.user_id = auth.uid()
  ));

-- ============================================================
-- 6. updated_at trigger on flows
-- ============================================================
-- Reuses update_updated_at_column() from migration 001. Trigger name
-- matches the convention used on every other table that has one
-- (see migration 001 lines 361-367).
DROP TRIGGER IF EXISTS set_updated_at ON flows;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON flows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 7. Realtime publication
-- ============================================================
-- Add flow_runs so the inbox can render "this contact is in flow X at
-- node Y" live as the runner advances. Other flow tables don't need
-- realtime — the builder reads on demand, the runner is server-side.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'flow_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE flow_runs;
  END IF;
END $$;


-- ############################################################
-- ## 011_profile_beta_features.sql
-- ############################################################
-- ============================================================
-- Per-account beta feature flag column on `profiles`.
--
-- Adds an array of opted-in beta feature keys to each profile row.
-- Currently used to gate the Flows feature (`'flows'`); shape is
-- generic so subsequent betas (e.g. `'ai_replies'`, `'voice_notes'`)
-- can land in this column without another migration.
--
-- Why a per-account flag rather than a global env var:
--   - Self-hosted wacrm instances are multi-user (small teams, shared
--     workspaces). A global flag would force every account on the
--     instance to opt into a not-yet-stable feature simultaneously.
--   - The owner wanted to dogfood the feature on their own account
--     before exposing it to teammates. Flipping a column via
--     Supabase Studio (`UPDATE profiles SET beta_features = ...
--     WHERE user_id = '<theirs>'`) is the lowest-friction toggle.
--   - DB-managed flags survive env rotation, deploy-restart timing,
--     and (since beta_features is a TEXT[]) extend naturally to
--     additional features without further schema work.
--
-- Default is the empty array, so every existing profile row opts
-- out of every beta feature on apply. NOT NULL keeps callers from
-- having to defend against `beta_features == null` at every site.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS beta_features TEXT[]
    NOT NULL
    DEFAULT ARRAY[]::TEXT[];

-- No new RLS policy needed: the existing `Users can view own profile` /
-- `Users can update own profile` policies (migration 001) already gate
-- access to this column. Server-side reads via service_role bypass RLS
-- as they do for every other column.
--
-- No index needed: the column is read on the login codepath (one row
-- lookup by primary key / user_id, both already indexed) and very
-- rarely written.


-- ############################################################
-- ## 012_flows_increment_counter.sql
-- ############################################################
-- ============================================================
-- 012_flows_increment_counter.sql
--
-- Atomic increment of flows.execution_count + refresh of
-- last_executed_at. Called via PostgREST RPC from the engine.
--
-- Before this, startNewRun did a read-modify-write:
--   UPDATE flows SET execution_count = <cached + 1> WHERE id = ...
-- so two concurrent dispatches (e.g. two webhooks for the same flow
-- starting runs for different contacts in the same second) could both
-- read N and both write N+1, permanently losing one count.
--
-- Mirrors migration 007 for automations — same shape, same security
-- posture. Idempotent: safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION increment_flow_execution_count(p_flow_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE flows
  SET
    execution_count = execution_count + 1,
    last_executed_at = NOW()
  WHERE id = p_flow_id;
$$;

-- Only the service role needs to call this (engine uses the
-- service-role client). Explicitly lock anon / authenticated out so
-- an authenticated user can't juice someone else's counter via RPC.
REVOKE ALL ON FUNCTION increment_flow_execution_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_flow_execution_count(UUID) FROM anon;
REVOKE ALL ON FUNCTION increment_flow_execution_count(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_flow_execution_count(UUID) TO service_role;



-- ============================================================
-- ## 013_message_templates_waba_scope.sql
-- ============================================================

-- 013_message_templates_waba_scope.sql
--
-- Problem this fixes:
-- message_templates rows were scoped to user_id only. When a user
-- repointed Settings → WhatsApp Configuration at a different WhatsApp
-- Business Account, the sync pulled the NEW account's templates but the
-- OLD account's rows stayed behind forever — the sync is upsert-only and
-- had no way to tell "came from the account we just left" apart from
-- "the user typed this in by hand".
--
-- Stamping the source WABA gives the sync that signal:
--   waba_id IS NULL      -> locally-created draft, never came from Meta
--   waba_id = current    -> belongs to the connected account
--   waba_id <> current   -> left over from a previous account, prune it

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS waba_id TEXT;

-- The sync prunes by (user_id, waba_id) on every run.
CREATE INDEX IF NOT EXISTS idx_message_templates_user_waba
  ON message_templates(user_id, waba_id);

COMMENT ON COLUMN message_templates.waba_id IS
  'WhatsApp Business Account this template was synced from. NULL means the row was created locally in the app and has no Meta counterpart.';
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


-- ============================================================
-- ## 014_developer_api.sql
-- ============================================================

-- 014_developer_api.sql
--
-- Developer API v1: lets customers build chatbots and integrations on
-- top of their WACRM account.
--   - api_keys: bearer keys for the public /api/v1/* endpoints. Only a
--     SHA-256 hash is stored; the plaintext is shown once at creation.
--   - developer_webhooks: one outbound webhook per user. Inbound
--     WhatsApp messages are relayed there as signed JSON events
--     (HMAC-SHA256 with the row's secret, mirroring how Meta signs
--     webhooks to us).

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- SHA-256 hex of the full key. Plaintext is never stored.
  key_hash TEXT NOT NULL UNIQUE,
  -- First characters of the key (after the wak_live_ prefix) so the
  -- UI can show "wak_live_a1b2c3…" for identification.
  key_prefix TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own api keys" ON api_keys;
CREATE POLICY "Users can manage own api keys" ON api_keys
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS developer_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  -- Signing secret (whsec_…). Visible to the owner — they need it to
  -- verify our signatures on their server.
  secret TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  last_delivery_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id)
);

ALTER TABLE developer_webhooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own developer webhook" ON developer_webhooks;
CREATE POLICY "Users can manage own developer webhook" ON developer_webhooks
  FOR ALL USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_updated_at ON developer_webhooks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON developer_webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- ## 022_admin_stats.sql
-- ============================================================

-- 022_admin_stats.sql
--
-- Cross-tenant aggregates for the /admin panel. PostgREST cannot
-- GROUP BY, so per-tenant usage rollups live in SQL functions.
--
-- Both functions are SECURITY DEFINER and locked to the service role
-- (same hardening pattern as increment_flow_execution_count in 012):
-- they deliberately read across every tenant, so an authenticated
-- user must never be able to call them.

CREATE OR REPLACE FUNCTION admin_platform_stats()
RETURNS TABLE (
  total_users BIGINT,
  total_contacts BIGINT,
  total_messages BIGINT,
  messages_30d BIGINT,
  total_broadcasts BIGINT,
  total_conversations BIGINT,
  connected_whatsapp_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM profiles),
    (SELECT COUNT(*) FROM contacts),
    (SELECT COUNT(*) FROM messages),
    (SELECT COUNT(*) FROM messages WHERE created_at >= NOW() - INTERVAL '30 days'),
    (SELECT COUNT(*) FROM broadcasts),
    (SELECT COUNT(*) FROM conversations),
    (SELECT COUNT(*) FROM whatsapp_config WHERE status = 'connected');
$$;

REVOKE ALL ON FUNCTION admin_platform_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_platform_stats() FROM anon;
REVOKE ALL ON FUNCTION admin_platform_stats() FROM authenticated;
GRANT EXECUTE ON FUNCTION admin_platform_stats() TO service_role;

CREATE OR REPLACE FUNCTION admin_tenant_stats()
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  email TEXT,
  role TEXT,
  created_at TIMESTAMPTZ,
  whatsapp_status TEXT,
  phone_number_id TEXT,
  contacts_count BIGINT,
  messages_count BIGINT,
  messages_30d BIGINT,
  broadcasts_count BIGINT,
  last_message_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.user_id,
    p.full_name,
    p.email,
    p.role,
    p.created_at,
    wc.status,
    wc.phone_number_id,
    COALESCE(c.cnt, 0),
    COALESCE(m.cnt, 0),
    COALESCE(m.cnt_30d, 0),
    COALESCE(b.cnt, 0),
    m.last_at
  FROM profiles p
  LEFT JOIN whatsapp_config wc ON wc.user_id = p.user_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt FROM contacts WHERE contacts.user_id = p.user_id
  ) c ON TRUE
  LEFT JOIN LATERAL (
    -- Messages hang off conversations, not user_id directly.
    SELECT
      COUNT(*) AS cnt,
      COUNT(*) FILTER (WHERE msg.created_at >= NOW() - INTERVAL '30 days') AS cnt_30d,
      MAX(msg.created_at) AS last_at
    FROM conversations conv
    JOIN messages msg ON msg.conversation_id = conv.id
    WHERE conv.user_id = p.user_id
  ) m ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt FROM broadcasts WHERE broadcasts.user_id = p.user_id
  ) b ON TRUE
  ORDER BY p.created_at DESC;
$$;

REVOKE ALL ON FUNCTION admin_tenant_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_tenant_stats() FROM anon;
REVOKE ALL ON FUNCTION admin_tenant_stats() FROM authenticated;
GRANT EXECUTE ON FUNCTION admin_tenant_stats() TO service_role;


-- ============================================================
-- ## 023_plans.sql
-- ============================================================

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


-- ============================================================
-- ## 023_plans.sql
-- ============================================================

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


-- ============================================================
-- ## 024_team_members.sql
-- ============================================================

-- 024_team_members.sql
--
-- Path-B multi-user: team members share the OWNER's tenant without
-- re-keying any table. The owner's user_id stays the tenant key on
-- every row; membership grants access through two helper functions
-- used by every rewritten RLS policy below.
--
--   has_team_access(owner) -> the caller IS that owner, or an active
--     member of that owner's team. Used in USING clauses.
--   tenant_id() -> the tenant a caller writes into: their owner's id
--     if they are a member, else their own. Used in WITH CHECK so a
--     member's inserts land in the owner's tenant (client code passes
--     the tenant id explicitly; this is the backstop).
--
-- Both are SECURITY DEFINER so policy evaluation does not recurse
-- into team_members' own RLS.

CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  invited_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (owner_user_id, member_user_id),
  -- One team per member account keeps tenant resolution unambiguous.
  UNIQUE (member_user_id),
  CHECK (owner_user_id <> member_user_id)
);

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners manage their team" ON team_members;
CREATE POLICY "Owners manage their team" ON team_members
  FOR ALL USING (auth.uid() = owner_user_id);
DROP POLICY IF EXISTS "Members can see their own membership" ON team_members;
CREATE POLICY "Members can see their own membership" ON team_members
  FOR SELECT USING (auth.uid() = member_user_id);

CREATE INDEX IF NOT EXISTS idx_team_members_member ON team_members(member_user_id) WHERE status = 'active';

CREATE OR REPLACE FUNCTION has_team_access(p_owner UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT p_owner = auth.uid() OR EXISTS (
    SELECT 1 FROM team_members
    WHERE owner_user_id = p_owner
      AND member_user_id = auth.uid()
      AND status = 'active'
  );
$$;
GRANT EXECUTE ON FUNCTION has_team_access(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION tenant_id()
RETURNS UUID
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT owner_user_id FROM team_members
     WHERE member_user_id = auth.uid() AND status = 'active'
     LIMIT 1),
    auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION tenant_id() TO authenticated;

-- whatsapp_config: members may SEE connection status, but only the
-- owner may change the connection (it holds the encrypted token).
DROP POLICY IF EXISTS "Users can manage own config" ON whatsapp_config;
CREATE POLICY "Team can read config" ON whatsapp_config
  FOR SELECT USING (has_team_access(user_id));
CREATE POLICY "Owner inserts config" ON whatsapp_config
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner updates config" ON whatsapp_config
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Owner deletes config" ON whatsapp_config
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- Rewritten tenant-table policies (generated from the originals:
-- auth.uid() = user_id  ->  has_team_access(user_id), and join
-- policies likewise on the parent's user_id; personal predicates
-- such as message_reactions.actor_id are untouched).
-- ============================================================

DROP POLICY IF EXISTS "Users can manage own contacts" ON contacts;
CREATE POLICY "Users can manage own contacts" ON contacts FOR ALL USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own tags" ON tags;
CREATE POLICY "Users can manage own tags" ON tags FOR ALL USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage contact tags" ON contact_tags;
CREATE POLICY "Users can manage contact tags" ON contact_tags FOR ALL
  USING (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_tags.contact_id AND has_team_access(contacts.user_id)));

DROP POLICY IF EXISTS "Users can manage own custom fields" ON custom_fields;
CREATE POLICY "Users can manage own custom fields" ON custom_fields FOR ALL USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage custom values" ON contact_custom_values;
CREATE POLICY "Users can manage custom values" ON contact_custom_values FOR ALL
  USING (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_custom_values.contact_id AND has_team_access(contacts.user_id)));

DROP POLICY IF EXISTS "Users can manage own notes" ON contact_notes;
CREATE POLICY "Users can manage own notes" ON contact_notes FOR ALL USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own conversations" ON conversations;
CREATE POLICY "Users can manage own conversations" ON conversations FOR ALL USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can view own messages" ON messages;
CREATE POLICY "Users can view own messages" ON messages FOR ALL
  USING (EXISTS (SELECT 1 FROM conversations WHERE conversations.id = messages.conversation_id AND has_team_access(conversations.user_id)));

DROP POLICY IF EXISTS "Users can manage own templates" ON message_templates;
CREATE POLICY "Users can manage own templates" ON message_templates FOR ALL USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own pipelines" ON pipelines;
CREATE POLICY "Users can manage own pipelines" ON pipelines FOR ALL USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage pipeline stages" ON pipeline_stages;
CREATE POLICY "Users can manage pipeline stages" ON pipeline_stages FOR ALL
  USING (EXISTS (SELECT 1 FROM pipelines WHERE pipelines.id = pipeline_stages.pipeline_id AND has_team_access(pipelines.user_id)));

DROP POLICY IF EXISTS "Users can manage own deals" ON deals;
CREATE POLICY "Users can manage own deals" ON deals FOR ALL USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own broadcasts" ON broadcasts;
CREATE POLICY "Users can manage own broadcasts" ON broadcasts FOR ALL USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage broadcast recipients" ON broadcast_recipients;
CREATE POLICY "Users can manage broadcast recipients" ON broadcast_recipients FOR ALL
  USING (EXISTS (SELECT 1 FROM broadcasts WHERE broadcasts.id = broadcast_recipients.broadcast_id AND has_team_access(broadcasts.user_id)));

DROP POLICY IF EXISTS "Users can manage own automations" ON automations;
CREATE POLICY "Users can manage own automations" ON automations FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage steps of own automations" ON automation_steps;
CREATE POLICY "Users can manage steps of own automations" ON automation_steps FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM automations a
      WHERE a.id = automation_steps.automation_id
        AND has_team_access(a.user_id)
    )
  );

DROP POLICY IF EXISTS "Users can view own automation logs" ON automation_logs;
CREATE POLICY "Users can view own automation logs" ON automation_logs FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users see reactions on their conversations" ON message_reactions;
CREATE POLICY "Users see reactions on their conversations" ON message_reactions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_reactions.conversation_id
      AND has_team_access(c.user_id)
  ));

DROP POLICY IF EXISTS "Users insert reactions on their conversations" ON message_reactions;
CREATE POLICY "Users insert reactions on their conversations" ON message_reactions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_reactions.conversation_id
      AND has_team_access(c.user_id)
  ));

DROP POLICY IF EXISTS "Users delete their own agent reactions" ON message_reactions;
CREATE POLICY "Users delete their own agent reactions" ON message_reactions FOR DELETE
  USING (
    actor_type = 'agent'
    AND actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = message_reactions.conversation_id
        AND has_team_access(c.user_id)
    )
  );

DROP POLICY IF EXISTS "Users update their own agent reactions" ON message_reactions;
CREATE POLICY "Users update their own agent reactions" ON message_reactions FOR UPDATE
  USING (
    actor_type = 'agent'
    AND actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = message_reactions.conversation_id
        AND has_team_access(c.user_id)
    )
  );

DROP POLICY IF EXISTS "Users can manage own flows" ON flows;
CREATE POLICY "Users can manage own flows" ON flows FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users manage nodes on their flows" ON flow_nodes;
CREATE POLICY "Users manage nodes on their flows" ON flow_nodes FOR ALL
  USING (EXISTS (
    SELECT 1 FROM flows f
    WHERE f.id = flow_nodes.flow_id
      AND has_team_access(f.user_id)
  ));

DROP POLICY IF EXISTS "Users see own flow runs" ON flow_runs;
CREATE POLICY "Users see own flow runs" ON flow_runs FOR SELECT
  USING (has_team_access(user_id));

DROP POLICY IF EXISTS "Users see events on their runs" ON flow_run_events;
CREATE POLICY "Users see events on their runs" ON flow_run_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM flow_runs r
    WHERE r.id = flow_run_events.flow_run_id
      AND has_team_access(r.user_id)
  ));

DROP POLICY IF EXISTS "Users can manage own canned replies" ON canned_replies;
CREATE POLICY "Users can manage own canned replies" ON canned_replies FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own inbox settings" ON inbox_settings;
CREATE POLICY "Users can manage own inbox settings" ON inbox_settings FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own csat responses" ON csat_responses;
CREATE POLICY "Users can manage own csat responses" ON csat_responses FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own appointments" ON appointments;
CREATE POLICY "Users can manage own appointments" ON appointments FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own appointment reminders" ON appointment_reminders;
CREATE POLICY "Users can manage own appointment reminders" ON appointment_reminders FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own billing settings" ON billing_settings;
CREATE POLICY "Users can manage own billing settings" ON billing_settings FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own invoices" ON invoices;
CREATE POLICY "Users can manage own invoices" ON invoices FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own invoice reminders" ON invoice_reminders;
CREATE POLICY "Users can manage own invoice reminders" ON invoice_reminders FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own subscriptions" ON subscriptions;
CREATE POLICY "Users can manage own subscriptions" ON subscriptions FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own products" ON products;
CREATE POLICY "Users can manage own products" ON products FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own orders" ON orders;
CREATE POLICY "Users can manage own orders" ON orders FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own order items" ON order_items;
CREATE POLICY "Users can manage own order items" ON order_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM orders
    WHERE orders.id = order_items.order_id
      AND has_team_access(orders.user_id)
  ));

DROP POLICY IF EXISTS "Users can manage own loyalty accounts" ON loyalty_accounts;
CREATE POLICY "Users can manage own loyalty accounts" ON loyalty_accounts FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own loyalty transactions" ON loyalty_transactions;
CREATE POLICY "Users can manage own loyalty transactions" ON loyalty_transactions FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own coupons" ON coupons;
CREATE POLICY "Users can manage own coupons" ON coupons FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());

DROP POLICY IF EXISTS "Users can manage own coupon redemptions" ON coupon_redemptions;
CREATE POLICY "Users can manage own coupon redemptions" ON coupon_redemptions FOR ALL
  USING (has_team_access(user_id)) WITH CHECK (user_id = tenant_id());
