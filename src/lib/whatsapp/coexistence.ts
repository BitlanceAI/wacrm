import { createClient } from '@supabase/supabase-js'

/**
 * Coexistence support: businesses onboarded from the WhatsApp Business
 * App (via Embedded Signup's "connect existing account" flow) keep
 * using the phone app alongside Cloud API. Meta reports the app side
 * of that arrangement through three webhook fields this module
 * digests:
 *
 *  - smb_message_echoes  — messages the business sends FROM the phone
 *    app; mirrored into the inbox so CRM agents see the whole thread
 *  - smb_app_state_sync  — the phone's address book (initial sync +
 *    live changes); upserted into contacts
 *  - history             — up to 6 months of pre-onboarding chat
 *    history (only if the business approved sharing); imported into
 *    conversations
 *
 * Plus `account_update` events (PARTNER_REMOVED / ACCOUNT_OFFBOARDED)
 * that mean the business disconnected — the stored config flips to
 * disconnected so the UI tells the truth instead of failing sends.
 *
 * All handlers are best-effort and idempotent (message inserts dedupe
 * on the wamid) because Meta redelivers webhooks on slow responses.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function admin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _admin
}

interface WebhookMetadata {
  display_phone_number: string
  phone_number_id: string
}

async function configFor(phoneNumberId: string) {
  const { data } = await admin()
    .from('whatsapp_config')
    .select('user_id, phone_number_id')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle()
  return data as { user_id: string } | null
}

async function findOrCreateContact(userId: string, phone: string, name?: string) {
  const db = admin()
  const { data: existing } = await db
    .from('contacts')
    .select('id, name')
    .eq('user_id', userId)
    .eq('phone', phone)
    .maybeSingle()
  if (existing) return existing as { id: string }
  const { data: created } = await db
    .from('contacts')
    .insert({ user_id: userId, phone, name: name || phone })
    .select('id')
    .single()
  return created as { id: string } | null
}

async function findOrCreateConversation(userId: string, contactId: string) {
  const db = admin()
  const { data: existing } = await db
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .maybeSingle()
  if (existing) return existing as { id: string }
  const { data: created } = await db
    .from('conversations')
    .insert({ user_id: userId, contact_id: contactId })
    .select('id')
    .single()
  return created as { id: string } | null
}

/** Text-ish rendering of an arbitrary message payload object. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderContent(type: string, payload: any): string | null {
  if (type === 'text') return payload?.body ?? null
  if (payload?.caption) return payload.caption
  return null
}

// ── smb_message_echoes ─────────────────────────────────────────

export interface SmbEchoValue {
  metadata: WebhookMetadata
  message_echoes?: Array<{
    from: string
    to: string
    id: string
    timestamp: string
    type: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
  }>
}

export async function handleSmbMessageEchoes(value: SmbEchoValue): Promise<void> {
  const echoes = value.message_echoes ?? []
  if (echoes.length === 0) return
  const config = await configFor(value.metadata.phone_number_id)
  if (!config) return
  const db = admin()

  for (const echo of echoes) {
    try {
      // Dedupe on wamid — Meta redelivers webhooks.
      const { data: dup } = await db
        .from('messages')
        .select('id')
        .eq('message_id', echo.id)
        .maybeSingle()
      if (dup) continue

      const contact = await findOrCreateContact(config.user_id, echo.to)
      if (!contact) continue
      const conversation = await findOrCreateConversation(config.user_id, contact.id)
      if (!conversation) continue

      const contentText = renderContent(echo.type, echo[echo.type])
      await db.from('messages').insert({
        conversation_id: conversation.id,
        // Sent by the business owner from their phone — an agent, not
        // the customer and not an automation.
        sender_type: 'agent',
        content_type: echo.type === 'text' ? 'text' : 'text',
        content_text: contentText ?? `[${echo.type} sent from WhatsApp Business App]`,
        message_id: echo.id,
        status: 'sent',
        created_at: new Date(parseInt(echo.timestamp) * 1000).toISOString(),
      })
      await db
        .from('conversations')
        .update({
          last_message_text: contentText ?? `[${echo.type}]`,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversation.id)
    } catch (err) {
      console.warn('[coexistence] echo mirror failed:', err)
    }
  }
}

// ── smb_app_state_sync (contacts) ──────────────────────────────

export interface SmbStateSyncValue {
  metadata: WebhookMetadata
  state_sync?: Array<{
    type: string
    contact?: { full_name?: string; first_name?: string; phone_number: string }
    action: string
  }>
}

export async function handleSmbStateSync(value: SmbStateSyncValue): Promise<void> {
  const items = (value.state_sync ?? []).filter(
    (s) => s.type === 'contact' && s.contact?.phone_number
  )
  if (items.length === 0) return
  const config = await configFor(value.metadata.phone_number_id)
  if (!config) return
  const db = admin()

  for (const item of items) {
    try {
      if (item.action === 'remove') continue // keep CRM contacts; app-side deletion isn't a CRM deletion
      const phone = item.contact!.phone_number
      const name = item.contact!.full_name || item.contact!.first_name
      const { data: existing } = await db
        .from('contacts')
        .select('id, name')
        .eq('user_id', config.user_id)
        .eq('phone', phone)
        .maybeSingle()
      if (existing) {
        // Only improve placeholder names — never clobber a name the
        // user set in the CRM.
        if (name && (!existing.name || existing.name === phone)) {
          await db.from('contacts').update({ name }).eq('id', existing.id)
        }
      } else {
        await db.from('contacts').insert({ user_id: config.user_id, phone, name: name || phone })
      }
    } catch (err) {
      console.warn('[coexistence] contact sync failed:', err)
    }
  }
}

// ── history (pre-onboarding chat import) ───────────────────────

export interface HistoryValue {
  metadata: WebhookMetadata
  history?: Array<{
    metadata?: { phase?: number; chunk_order?: number; progress?: number }
    errors?: Array<{ code: number; message?: string }>
    threads?: Array<{
      id: string
      messages: Array<{
        from: string
        id: string
        timestamp: string
        type: string
        history_context?: { status?: string }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [key: string]: any
      }>
    }>
  }>
}

export async function handleHistory(value: HistoryValue): Promise<void> {
  const batches = value.history ?? []
  if (batches.length === 0) return
  const config = await configFor(value.metadata.phone_number_id)
  if (!config) return
  const db = admin()
  const businessPhone = value.metadata.display_phone_number.replace(/\D/g, '')

  for (const batch of batches) {
    if (batch.errors?.some((e) => e.code === 2593109)) {
      console.log('[coexistence] business declined history sharing — nothing to import')
      continue
    }
    for (const thread of batch.threads ?? []) {
      try {
        const contact = await findOrCreateContact(config.user_id, thread.id)
        if (!contact) continue
        const conversation = await findOrCreateConversation(config.user_id, contact.id)
        if (!conversation) continue

        // Dedupe the whole thread chunk in one query.
        const wamids = thread.messages.map((m) => m.id)
        const { data: existingRows } = await db
          .from('messages')
          .select('message_id')
          .in('message_id', wamids)
        const seen = new Set(
          ((existingRows ?? []) as { message_id: string }[]).map((r) => r.message_id)
        )

        const rows = thread.messages
          .filter((m) => !seen.has(m.id))
          .map((m) => {
            const fromBusiness = m.from.replace(/\D/g, '') === businessPhone
            const contentText = renderContent(m.type, m[m.type])
            return {
              conversation_id: conversation.id,
              sender_type: fromBusiness ? 'agent' : 'customer',
              content_type: 'text',
              content_text:
                contentText ??
                (m.type === 'media_placeholder'
                  ? '[media from WhatsApp Business App history]'
                  : `[${m.type}]`),
              message_id: m.id,
              status: 'delivered',
              created_at: new Date(parseInt(m.timestamp) * 1000).toISOString(),
            }
          })

        // Chunked inserts — a single history webhook can carry
        // thousands of messages.
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await db.from('messages').insert(rows.slice(i, i + 200))
          if (error) console.warn('[coexistence] history insert failed:', error.message)
        }
      } catch (err) {
        console.warn('[coexistence] history thread import failed:', err)
      }
    }
    const progress = batch.metadata?.progress
    if (progress !== undefined) {
      console.log(`[coexistence] history sync progress: ${progress}%`)
    }
  }
}

// ── account_update (disconnects) ───────────────────────────────

export interface AccountUpdateValue {
  event?: string
  phone_number?: string
  disconnection_info?: { reason?: string; initiated_by?: string }
}

export async function handleAccountUpdate(
  wabaId: string,
  value: AccountUpdateValue
): Promise<void> {
  const event = value.event ?? ''
  if (!['PARTNER_REMOVED', 'ACCOUNT_OFFBOARDED'].includes(event)) return

  console.warn(
    `[coexistence] WABA ${wabaId} disconnected (${event}${
      value.disconnection_info?.reason ? `, reason=${value.disconnection_info.reason}` : ''
    })`
  )
  const { error } = await admin()
    .from('whatsapp_config')
    .update({ status: 'disconnected' })
    .eq('waba_id', wabaId)
  if (error) {
    console.error('[coexistence] failed to mark config disconnected:', error.message)
  }
}
