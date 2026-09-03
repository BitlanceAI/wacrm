'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Contact, MessageTemplate } from '@/types';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
 fieldId: string;
 operator: CustomFieldOperator;
 value: string;
}

export interface AudienceConfig {
 /** 'manual' = phone numbers typed into the wizard; it shares the
  * csvContacts shape and the CSV upsert pipeline. */
 type: 'all' | 'tags' | 'custom_field' | 'csv' | 'manual' | 'inactive';
 tagIds?: string[];
 /**
  * For type 'inactive' (win-back): contacts whose last INBOUND message
  * is older than this many days, plus contacts who have never written
  * at all. Measured on inbound only — our own broadcasts landing in
  * their thread say nothing about whether they are still engaged.
  */
 inactiveDays?: number;
 customField?: CustomFieldFilter;
 csvContacts?: { phone: string; name?: string; vars?: Record<string, string> }[];
 /** Contacts carrying any of these tags are subtracted from the result. */
 excludeTagIds?: string[];
}

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`.
 */
export type VariableMapping =
 | { type: 'static'; value: string }
 | { type: 'field'; value: string }
 | { type: 'custom_field'; value: string };

interface BroadcastPayload {
 name: string;
 template: MessageTemplate;
 audience: AudienceConfig;
 variables: Record<string, VariableMapping>;
 /**
  * Header content shared by every recipient — the text-header
  * variable's value, or a public https URL for a media header.
  * Required when the template's header needs send-time content
  * (see getTemplateHeaderRequirement); the API refuses without it.
  */
 headerValue?: string;
}

interface UseBroadcastSendingReturn {
 createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
 isProcessing: boolean;
 progress: number;
}

/**
 * Meta rate-limit buffer. 10 per batch + 1 s pause matches the spec
 * and keeps us comfortably under Meta's per-phone-number messaging
 * rate so a large broadcast never trips the upstream limiter.
 */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

/** `broadcast_recipients` inserts are independent of the send rate. */
const INSERT_BATCH_SIZE = 200;

function sleep(ms: number) {
 return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BroadcastApiResult {
 phone: string;
 status: 'sent' | 'failed';
 whatsapp_message_id?: string;
 error?: string;
 /** Server-side opt-out backstop fired; nothing was sent to Meta. */
 opted_out?: boolean;
}

/** contactId → (customFieldId → value). */
type CustomValueIndex = Map<string, Map<string, string>>;

/**
 * PostgREST silently caps any select at 1000 rows. Every audience
 * query here must page through .range() windows, or a broadcast to
 * >1000 contacts sends to the first 1000 and quietly drops the rest —
 * while the step-4 reach estimate (a count query, uncapped) still
 * shows the full number.
 *
 * `page` must apply a stable ORDER BY, otherwise windows can overlap
 * or skip rows between requests.
 */
const ROW_PAGE = 1000;
async function fetchAllPages<T>(
 page: (
 from: number,
 to: number,
 ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
 label: string,
): Promise<T[]> {
 const all: T[] = [];
 for (let from = 0; ; from += ROW_PAGE) {
 const { data, error } = await page(from, from + ROW_PAGE - 1);
 if (error) throw new Error(`${label}: ${error.message}`);
 const rows = data ?? [];
 all.push(...rows);
 if (rows.length < ROW_PAGE) break;
 }
 return all;
}

/**
 * Fetch contacts by id in IN-clause-sized chunks (PostgREST caps the
 * .in() list around 1000 values, and each chunk stays under the row
 * cap by construction).
 */
async function fetchContactsByIds(
 supabase: ReturnType<typeof createClient>,
 contactIds: string[],
): Promise<Contact[]> {
 const CHUNK = 500;
 const contacts: Contact[] = [];
 for (let i = 0; i < contactIds.length; i += CHUNK) {
 const slice = contactIds.slice(i, i + CHUNK);
 const { data, error } = await supabase
 .from('contacts')
 .select('*')
 .in('id', slice);
 if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
 contacts.push(...(data ?? []));
 }
 return contacts;
}

/**
 * All contact_ids carrying any of the given tags, paged past the row
 * cap. Used for both include- and exclude-tag resolution.
 */
async function fetchContactIdsForTags(
 supabase: ReturnType<typeof createClient>,
 tagIds: string[],
): Promise<Set<string>> {
 const rows = await fetchAllPages<{ contact_id: string }>(
 (from, to) =>
 supabase
 .from('contact_tags')
 .select('contact_id')
 .in('tag_id', tagIds)
 .order('contact_id')
 .order('tag_id')
 .range(from, to),
 'Failed to fetch contact tags',
 );
 return new Set(rows.map((r) => r.contact_id));
}

/**
 * Per-contact resolution of custom-field placeholders. Static and
 * built-in-field mappings resolve synchronously; custom fields read
 * from a pre-built index to avoid N+1 queries during the send loop.
 */
export function resolveVariables(
  template: MessageTemplate,
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>,
  /** Per-row CSV variable values — highest priority override. */
  csvVars?: Record<string, string>,
): string[] {
  const matches = template.body_text.match(/\{\{(\d+)\}\}/g);

  console.log(
    `[resolveVariables] template="${template.name}"  body="${template.body_text.slice(0, 80)}"  detectedPlaceholders=${JSON.stringify(matches ?? [])}  variableKeys=${JSON.stringify(Object.keys(variables))}`
  );

  if (!matches) {
    console.warn(
      `[resolveVariables] No {{N}} placeholders found in body — sending params=[]. If Meta rejects with #132012, the template stored in DB may differ from what Meta has.`
    );
    return [];
  }

  const uniqueKeys = [...new Set(matches.map(m => m.replace(/^\{\{|\}\}$/g, '')))];
  const keys = uniqueKeys.sort((a, b) => Number(a) - Number(b));

  const resolved = keys.map((key) => {
    // CSV vars take highest priority — they are per-contact values explicitly
    // provided in the uploaded file, so they override any field mapping.
    if (csvVars && csvVars[key] !== undefined && csvVars[key] !== '') {
      return csvVars[key];
    }

    const v = variables[key];
    if (!v) {
      console.warn(`[resolveVariables] No mapping for placeholder {{${key}}} — contact="${contact.phone}" will receive empty string`);
      return '';
    }

    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      const result = fieldMap[v.value] ?? '';
      if (!result) console.warn(`[resolveVariables] field "${v.value}" is empty for contact="${contact.phone}"`);
      return result;
    }

    // custom_field
    const result = customValues?.get(v.value) ?? '';
    if (!result) console.warn(`[resolveVariables] custom_field id="${v.value}" has no value for contact="${contact.phone}"`);
    return result;
  });

  console.log(`[resolveVariables] contact="${contact.phone}"  resolvedParams=${JSON.stringify(resolved)}`);
  return resolved;
}

/**
 * Bulk-fetch contact_custom_values for a set of contacts. Returns an
 * index keyed by contact_id → field_id → value.
 */
async function fetchCustomValueIndex(
 supabase: ReturnType<typeof createClient>,
 contactIds: string[],
): Promise<CustomValueIndex> {
 const index: CustomValueIndex = new Map();
 if (contactIds.length === 0) return index;

 // Supabase PostgREST caps the .in(...) IN-clause roughly at 1000
 // values. Page through to stay safe.
 const PAGE = 500;
 for (let i = 0; i < contactIds.length; i += PAGE) {
 const slice = contactIds.slice(i, i + PAGE);
 const { data } = await supabase
 .from('contact_custom_values')
 .select('contact_id, custom_field_id, value')
 .in('contact_id', slice);

 for (const row of data ?? []) {
 const bucket = index.get(row.contact_id) ?? new Map<string, string>();
 bucket.set(row.custom_field_id, row.value ?? '');
 index.set(row.contact_id, bucket);
 }
 }
 return index;
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
 const [isProcessing, setIsProcessing] = useState(false);
 const [progress, setProgress] = useState(0);

 async function resolveAudience(audience: AudienceConfig): Promise<Contact[]> {
 const supabase = createClient();

 let contacts: Contact[] = [];

 if (audience.type === 'all') {
 contacts = await fetchAllPages<Contact>(
 (from, to) =>
 supabase.from('contacts').select('*').order('id').range(from, to),
 'Failed to fetch contacts',
 );
 } else if (
 audience.type === 'tags' &&
 audience.tagIds &&
 audience.tagIds.length > 0
 ) {
 const taggedIds = await fetchContactIdsForTags(supabase, audience.tagIds);
 if (taggedIds.size > 0) {
 contacts = await fetchContactsByIds(supabase, [...taggedIds]);
 }
 } else if (audience.type === 'inactive') {
 contacts = await resolveInactiveAudience(
 supabase,
 audience.inactiveDays ?? 30,
 );
 } else if (audience.type === 'custom_field' && audience.customField) {
 contacts = await resolveCustomFieldAudience(supabase, audience.customField);
 } else if (
 (audience.type === 'csv' || audience.type === 'manual') &&
 audience.csvContacts
 ) {
 contacts = await upsertCsvContacts(supabase, audience.csvContacts);
 }

 // Apply exclude tags (works across all contact-derived audience
 // types). CSV contacts are synthetic so exclusion doesn't apply.
 if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
 const excludedIds = await fetchContactIdsForTags(
 supabase,
 audience.excludeTagIds,
 );
 contacts = contacts.filter((c) => !excludedIds.has(c.id));
 }

 // Marketing opt-out is absolute and applies to every audience type,
 // CSV re-uploads included: re-importing a number does not undo the
 // contact's request to stop. `undefined` means the column predates
 // migration 014 on this row — treat as opted in.
 return contacts.filter((c) => c.marketing_opt_in !== false);
 }

 /**
 * CSV uploads arrive as raw phone/name pairs, not DB rows. Before we
 * can insert broadcast_recipients (whose contact_id FKs contacts.id),
 * we need real contacts.id UUIDs. So: look up each CSV phone in the
 * caller's contacts table; insert any that don't exist; return the
 * resolved set.
 *
 * Pre-existing implementation synthesized `csv-N` strings as
 * contact_id, which failed the UUID cast on insert — every CSV
 * broadcast silently created zero recipients.
 */
 async function upsertCsvContacts(
 supabase: ReturnType<typeof createClient>,
 csvRows: { phone: string; name?: string }[],
 ): Promise<Contact[]> {
 if (csvRows.length === 0) return [];

 const {
 data: { session },
 } = await supabase.auth.getSession();
 const user = session?.user;
 if (!user) {
 throw new Error('You are not signed in.');
 }

 // De-duplicate by phone within the CSV (users can paste duplicates).
 const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
 for (const row of csvRows) {
 if (row.phone) uniqueByPhone.set(row.phone, row);
 }
 const phones = [...uniqueByPhone.keys()];

 // Single round-trip lookup of existing contacts by phone.
 const { data: existing, error: lookupErr } = await supabase
 .from('contacts')
 .select('*')
 .eq('user_id', user.id)
 .in('phone', phones);
 if (lookupErr) {
 throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
 }

 const byPhone = new Map<string, Contact>();
 for (const c of (existing ?? []) as Contact[]) {
 if (c.phone) byPhone.set(c.phone, c);
 }

 // Insert only missing contacts, in one batch per 200 rows (PostgREST
 // has a default payload cap — 200 keeps individual requests small).
 const missing = phones
 .filter((p) => !byPhone.has(p))
 .map((phone) => ({
 user_id: user.id,
 phone,
 name: uniqueByPhone.get(phone)?.name ?? null,
 source: 'import' as const,
 }));

 const INSERT_CHUNK = 200;
 for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
 const chunk = missing.slice(i, i + INSERT_CHUNK);
 const { data: inserted, error: insertErr } = await supabase
 .from('contacts')
 .insert(chunk)
 .select();
 if (insertErr) {
 throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
 }
 for (const c of (inserted ?? []) as Contact[]) {
 if (c.phone) byPhone.set(c.phone, c);
 }
 }

 // Preserve input order so analytics roughly matches the CSV order.
 return phones
 .map((p) => byPhone.get(p))
 .filter((c): c is Contact => Boolean(c));
 }

 /**
 * Win-back segment: everyone who hasn't written in `days`.
 *
 * Built from the message log rather than conversations.last_message_at,
 * which is bumped by our OWN outbound messages — using it would mean a
 * broadcast re-engages nobody, because sending it makes every recipient
 * look active again.
 *
 * Contacts who have never sent an inbound message count as inactive:
 * an imported list that has never replied is exactly who a win-back
 * campaign is for.
 */
 async function resolveInactiveAudience(
 supabase: ReturnType<typeof createClient>,
 days: number,
 ): Promise<Contact[]> {
 const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

 // Everyone who HAS written recently — the set to subtract.
 const recentRows = await fetchAllPages<{
 conversation_id: string;
 conversations: { contact_id: string } | { contact_id: string }[] | null;
 }>(
 (from, to) =>
 supabase
 .from('messages')
 .select('conversation_id, conversations(contact_id)')
 .eq('sender_type', 'customer')
 .gte('created_at', cutoff)
 .order('conversation_id')
 .range(from, to),
 'Failed to fetch recent inbound messages',
 );

 const activeContactIds = new Set<string>();
 for (const row of recentRows) {
 const conv = Array.isArray(row.conversations)
 ? row.conversations[0]
 : row.conversations;
 if (conv?.contact_id) activeContactIds.add(conv.contact_id);
 }

 const all = await fetchAllPages<Contact>(
 (from, to) =>
 supabase.from('contacts').select('*').order('id').range(from, to),
 'Failed to fetch contacts',
 );

 return all.filter((c) => !activeContactIds.has(c.id));
 }

 async function resolveCustomFieldAudience(
 supabase: ReturnType<typeof createClient>,
 filter: CustomFieldFilter,
 ): Promise<Contact[]> {
 const { fieldId, operator, value } = filter;

 // Build the WHERE clause for the operator. PostgREST supports
 // eq/neq/ilike via the query builder — use ilike with wildcards
 // for "contains" so the match is case-insensitive. Built fresh per
 // page: builders are mutable, so reusing one across .range() calls
 // would stack query params.
 const buildQuery = () => {
 let query = supabase
 .from('contact_custom_values')
 .select('contact_id')
 .eq('custom_field_id', fieldId);
 if (operator === 'is') query = query.eq('value', value);
 else if (operator === 'is_not') query = query.neq('value', value);
 else if (operator === 'contains') query = query.ilike('value', `%${value}%`);
 return query;
 };

 const matches = await fetchAllPages<{ contact_id: string }>(
 (from, to) => buildQuery().order('contact_id').range(from, to),
 'Custom-field filter failed',
 );

 const contactIds = [...new Set(matches.map((m) => m.contact_id))];
 if (contactIds.length === 0) return [];

 return fetchContactsByIds(supabase, contactIds);
 }

 async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
 setIsProcessing(true);
 setProgress(0);

 const supabase = createClient();

 try {
 // ── Step 0: Resolve current user ──────────────────────────────
 // broadcasts.user_id is NOT NULL + guarded by RLS
 // (auth.uid() = user_id). Without this, the INSERT below was
 // silently failing with 23502 / 42501 — the wizard would
 // no-op with no feedback.
 const {
 data: { session },
 } = await supabase.auth.getSession();
 const user = session?.user;
 if (!user) {
 throw new Error('You are not signed in.');
 }

 // ── Step 1: Resolve audience contacts ─────────────────────────
 setProgress(5);
 const contacts = await resolveAudience(payload.audience);

 if (contacts.length === 0) {
 throw new Error('No contacts found for this audience.');
 }

 // ── Step 2: Create broadcast row ──────────────────────────────
 setProgress(10);
 const { data: broadcast, error: broadcastError } = await supabase
 .from('broadcasts')
 .insert({
 user_id: user.id,
 name: payload.name,
 template_name: payload.template.name,
 template_language: payload.template.language ?? 'en_US',
 template_variables: payload.variables,
 audience_filter: {
 type: payload.audience.type,
 tagIds: payload.audience.tagIds,
 inactiveDays: payload.audience.inactiveDays,
 customField: payload.audience.customField,
 excludeTagIds: payload.audience.excludeTagIds,
 },
 status: 'sending',
 total_recipients: contacts.length,
 sent_count: 0,
 delivered_count: 0,
 read_count: 0,
 replied_count: 0,
 failed_count: 0,
 })
 .select()
 .single();

 if (broadcastError || !broadcast) {
 throw new Error(
 `Failed to create broadcast: ${broadcastError?.message ?? 'unknown error'}`,
 );
 }

 // ── Step 3: Insert recipient rows ─────────────────────────────
 setProgress(20);
 const recipientRows = contacts.map((contact) => ({
 broadcast_id: broadcast.id,
 contact_id: contact.id,
 status: 'pending' as const,
 }));

 for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
 const batch = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
 const { error: recipientError } = await supabase
 .from('broadcast_recipients')
 .insert(batch);
 if (recipientError) {
 // Previous impl logged and marched on — the broadcast then ran
 // with an incomplete recipient set, so webhook status updates
 // couldn't find some rows and the aggregate counts drifted.
 // Flip the broadcast to failed so the user sees the problem
 // immediately, then throw to abort the send loop.
 await supabase
 .from('broadcasts')
 .update({
 status: 'failed',
 failed_count: contacts.length,
 })
 .eq('id', broadcast.id);
 throw new Error(
 `Failed to insert recipient batch ${i / INSERT_BATCH_SIZE + 1}: ${recipientError.message}`,
 );
 }
 }

 // ── Step 4: Fetch recipients (joined contact) + preload custom values
 setProgress(30);
 // Paged for the same reason as resolveAudience: an unpaged select
 // caps at 1000 rows, and any recipient not fetched here would be
 // skipped by the send loop and sit in `pending` forever.
 const recipients = await fetchAllPages<{
 id: string;
 contact: Contact | null;
 }>(
 (from, to) =>
 supabase
 .from('broadcast_recipients')
 .select('*, contact:contacts(*)')
 .eq('broadcast_id', broadcast.id)
 .order('id')
 .range(from, to),
 'Failed to fetch broadcast recipients',
 );

 // One bulk fetch of custom values for every contact in this
 // broadcast, avoiding N+1 during the send loop.
 const contactIds = recipients
 .map((r) => r.contact?.id)
 .filter((id): id is string => Boolean(id));
 const customValueIndex = await fetchCustomValueIndex(
 supabase,
 contactIds,
 );

  let failedCount = 0;
  const totalRecipients = recipients.length;

  // Build a phone → vars map for CSV broadcasts so each contact's
  // uploaded variable values override the generic field mappings.
  const csvVarsIndex = new Map<string, Record<string, string>>();
  if (
    (payload.audience.type === 'csv' || payload.audience.type === 'manual') &&
    payload.audience.csvContacts
  ) {
    for (const csvRow of payload.audience.csvContacts) {
      if (csvRow.phone && csvRow.vars) {
        csvVarsIndex.set(csvRow.phone, csvRow.vars);
      }
    }
  }

 for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
 const batch = recipients.slice(i, i + SEND_BATCH_SIZE);

  const apiRecipients = batch
  .filter((r) => r.contact?.phone)
  .map((r) => ({
  phone: r.contact!.phone as string,
  params: r.contact
  ? resolveVariables(
  payload.template,
  payload.variables,
  r.contact,
  customValueIndex.get(r.contact.id),
  csvVarsIndex.get(r.contact.phone as string),
  )
  : [],
  }));

  if (apiRecipients.length === 0) continue;

  console.log(
    `[broadcast-send] Batch ${Math.floor(i / SEND_BATCH_SIZE) + 1} — template="${payload.template.name}"  lang="${payload.template.language ?? 'en_US'}"  recipients=${apiRecipients.length}`
  );
  apiRecipients.forEach((r) =>
    console.log(`  → phone="${r.phone}"  params=${JSON.stringify(r.params)}`)
  );

  try {
  const res = await fetch('/api/whatsapp/broadcast', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
  recipients: apiRecipients,
  template_name: payload.template.name,
  template_language: payload.template.language ?? 'en_US',
  header_value: payload.headerValue,
  }),
  });

 const data = await res.json();

 if (!res.ok) {
 throw new Error(data.error || 'Broadcast API request failed');
 }

 const resultsByPhone = new Map<string, BroadcastApiResult>();
 for (const r of (data.results ?? []) as BroadcastApiResult[]) {
 resultsByPhone.set(r.phone, r);
 }

 for (const recipient of batch) {
 const phone = recipient.contact?.phone;
 const result = phone ? resultsByPhone.get(phone) : undefined;

 if (!result) {
 failedCount++;
 await supabase
 .from('broadcast_recipients')
 .update({
 status: 'failed',
 error_message: 'No phone number on contact',
 })
 .eq('id', recipient.id);
 continue;
 }

 if (result.status === 'sent') {
 await supabase
 .from('broadcast_recipients')
 .update({
 status: 'sent',
 sent_at: new Date().toISOString(),
 whatsapp_message_id: result.whatsapp_message_id ?? null,
 error_message: null,
 })
 .eq('id', recipient.id);
 } else {
 failedCount++;
 await supabase
 .from('broadcast_recipients')
 .update({
 status: 'failed',
 error_message: result.error ?? 'Unknown error',
 })
 .eq('id', recipient.id);
 }
 }
 } catch (err) {
 for (const recipient of batch) {
 failedCount++;
 await supabase
 .from('broadcast_recipients')
 .update({
 status: 'failed',
 error_message: err instanceof Error ? err.message : 'Unknown error',
 })
 .eq('id', recipient.id);
 }
 }

 const progressPct =
 30 + Math.round(((i + batch.length) / totalRecipients) * 60);
 setProgress(progressPct);

 if (i + SEND_BATCH_SIZE < recipients.length) {
 await sleep(SEND_BATCH_DELAY_MS);
 }
 }

 // ── Step 5: Finalize status ───────────────────────────────────
 // Aggregate counts are maintained by the DB trigger (migration
 // 003); we only flip the final status here.
 setProgress(95);
 const finalStatus = failedCount === totalRecipients ? 'failed' : 'sent';
 await supabase
 .from('broadcasts')
 .update({ status: finalStatus })
 .eq('id', broadcast.id);

 setProgress(100);
 return broadcast.id;
 } finally {
 setIsProcessing(false);
 }
 }

 return { createAndSendBroadcast, isProcessing, progress };
}
