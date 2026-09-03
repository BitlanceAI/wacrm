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
