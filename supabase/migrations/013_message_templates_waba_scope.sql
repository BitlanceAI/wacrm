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
