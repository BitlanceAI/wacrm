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
