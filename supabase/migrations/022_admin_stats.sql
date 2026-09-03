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
