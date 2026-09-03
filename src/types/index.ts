export interface Profile {
 id: string;
 user_id: string;
 full_name: string;
 email: string;
 avatar_url?: string;
 role: string;
 /**
 * Opted-in beta feature keys for this account. The column survives
 * for future beta gates; no current feature reads it (Flows was
 * the last user and went to soft-GA in PR #134). Defaults to `[]`
 * for every profile; toggled per-account via a direct UPDATE on
 * the `profiles` row.
 */
 beta_features?: string[];
 created_at: string;
}

/**
 * Channel a contact first arrived through. Mirrors the
 * contacts_source_check constraint added in migration 014.
 */
export type ContactSource =
 | 'manual'
 | 'import'
 | 'whatsapp'
 | 'ctwa_ad'
 | 'api'
 | 'automation';

export type OptOutReason = 'keyword' | 'manual' | 'meta_block';

export interface Contact {
 id: string;
 user_id: string;
 phone: string;
 name?: string;
 email?: string;
 company?: string;
 avatar_url?: string;
 /**
  * FALSE once the contact asked to stop marketing messages. Broadcast
  * audiences must exclude these contacts — replies inside the 24-hour
  * service window are unaffected.
  */
 marketing_opt_in?: boolean;
 opted_out_at?: string | null;
 opt_out_reason?: OptOutReason | null;
 source?: ContactSource;
 /** First-touch attribution payload; see lib/whatsapp/referral.ts. */
 source_details?: Record<string, unknown> | null;
 created_at: string;
 updated_at: string;
}

export interface Tag {
 id: string;
 user_id: string;
 name: string;
 color: string;
 created_at: string;
}

export interface ContactTag {
 id: string;
 contact_id: string;
 tag_id: string;
}

export interface CustomField {
 id: string;
 user_id: string;
 field_name: string;
 field_type: string;
 field_options?: Record<string, unknown>;
 created_at: string;
}

export interface ContactCustomValue {
 id: string;
 contact_id: string;
 custom_field_id: string;
 value?: string;
}

export interface ContactNote {
 id: string;
 contact_id: string;
 user_id: string;
 note_text: string;
 created_at: string;
}

/**
 * Local free-text snippet for the inbox composer (migration 016).
 * Unlike MessageTemplate these never go to Meta for approval and are
 * only usable inside the 24-hour service window.
 */
export interface CannedReply {
 id: string;
 user_id: string;
 /** Lowercase, no leading slash. Matched as "/" + shortcut. */
 shortcut: string;
 title: string;
 body: string;
 usage_count: number;
 created_at: string;
 updated_at: string;
}

export type ConversationStatus = 'open' | 'pending' | 'closed';

/** Billing (migration 019). Money is always integer minor units. */
export type InvoiceStatus =
 | 'draft'
 | 'sent'
 | 'paid'
 | 'overdue'
 | 'void'
 | 'refunded';

export interface Invoice {
 id: string;
 user_id: string;
 contact_id: string;
 conversation_id?: string | null;
 subscription_id?: string | null;
 number: string;
 description: string;
 /** Paise / cents. Never a float. */
 amount_minor: number;
 currency: string;
 status: InvoiceStatus;
 due_date?: string | null;
 payment_url?: string | null;
 external_reference?: string | null;
 sent_at?: string | null;
 paid_at?: string | null;
 notes?: string | null;
 created_at: string;
 updated_at: string;
 contact?: Pick<Contact, 'id' | 'name' | 'phone'>;
}

export type RenewalInterval = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Subscription {
 id: string;
 user_id: string;
 contact_id: string;
 plan_name: string;
 amount_minor: number;
 currency: string;
 interval: RenewalInterval;
 next_renewal_date: string;
 status: 'active' | 'paused' | 'cancelled';
 auto_invoice: boolean;
 reminder_days_before: number;
 created_at: string;
 updated_at: string;
 contact?: Pick<Contact, 'id' | 'name' | 'phone'>;
}

/** Booking lifecycle (migration 018). */
export type AppointmentStatus =
 | 'scheduled'
 | 'confirmed'
 | 'completed'
 | 'cancelled'
 | 'no_show';

export interface Appointment {
 id: string;
 user_id: string;
 contact_id: string;
 conversation_id?: string | null;
 title: string;
 notes?: string | null;
 location?: string | null;
 starts_at: string;
 ends_at?: string | null;
 /** IANA zone the booking was made in; reminders render in it. */
 timezone: string;
 status: AppointmentStatus;
 created_at: string;
 updated_at: string;
 contact?: Pick<Contact, 'id' | 'name' | 'phone'>;
}

export type ReminderStatus =
 | 'pending'
 | 'sent'
 | 'failed'
 | 'skipped'
 | 'cancelled';

export interface AppointmentReminder {
 id: string;
 appointment_id: string;
 user_id: string;
 send_at: string;
 offset_minutes: number;
 channel: 'text' | 'template';
 message_text?: string | null;
 template_name?: string | null;
 template_language?: string | null;
 status: ReminderStatus;
 sent_at?: string | null;
 error_message?: string | null;
 created_at: string;
}

/** Agent-set ticket urgency (migration 017). */
export type ConversationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Conversation {
 id: string;
 user_id: string;
 contact_id: string;
 status: ConversationStatus;
 assigned_agent_id?: string;
 last_message_text?: string;
 last_message_at?: string;
 unread_count: number;
 /**
  * Response and resolution clocks (migration 015). Written only via
  * the helpers in lib/conversations/response-metrics.ts — see there
  * for what "first" means in each case.
  */
 first_inbound_at?: string | null;
 first_response_at?: string | null;
 first_response_seconds?: number | null;
 /** Non-null while a customer message is waiting on a reply. */
 awaiting_reply_since?: string | null;
 resolved_at?: string | null;
 resolved_by?: string | null;
 resolution_seconds?: number | null;
 /** Ticket fields (migration 017). */
 priority?: ConversationPriority;
 category?: string | null;
 resolution_note?: string | null;
 last_away_sent_at?: string | null;
 created_at: string;
 updated_at: string;
 contact?: Contact;
}

export type SenderType = 'customer' | 'agent' | 'bot';
export type ContentType =
 | 'text'
 | 'image'
 | 'document'
 | 'audio'
 | 'video'
 | 'location'
 | 'template'
 /** Customer tapped a reply button or list row on a message we sent. */
 | 'interactive';
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Message {
 id: string;
 conversation_id: string;
 sender_type: SenderType;
 sender_id?: string;
 content_type: ContentType;
 content_text?: string;
 media_url?: string;
 template_name?: string;
 message_id?: string;
 status: MessageStatus;
 created_at: string;
 reply_to_message_id?: string;
 /**
 * Only set when `content_type === 'interactive'` — the stable id of
 * the button or list row the customer tapped. The Flows engine uses
 * this to route the next node; the inbox bubble uses it as a styling
 * cue (renders with a "↩ button reply" affordance).
 */
 interactive_reply_id?: string;
}

export type ReactionActor = 'customer' | 'agent';

export interface MessageReaction {
 id: string;
 message_id: string;
 conversation_id: string;
 actor_type: ReactionActor;
 actor_id?: string;
 emoji: string;
 created_at: string;
}

export interface WhatsAppConfig {
 id: string;
 user_id: string;
 phone_number_id: string;
 waba_id?: string;
 access_token: string;
 verify_token?: string;
 status: 'connected' | 'disconnected';
 connected_at?: string;
}

export interface MessageTemplate {
 id: string;
 user_id: string;
 name: string;
 category: 'Marketing' | 'Utility' | 'Authentication';
 language?: string;
 header_type?: 'text' | 'image' | 'video' | 'document';
 header_content?: string;
 body_text: string;
 footer_text?: string;
 buttons?: Record<string, unknown>[];
 status?: 'Draft' | 'Pending' | 'Approved' | 'Rejected';
 created_at: string;
}

export interface Pipeline {
 id: string;
 user_id: string;
 name: string;
 created_at: string;
}

export interface PipelineStage {
 id: string;
 pipeline_id: string;
 name: string;
 position: number;
 color: string;
 created_at: string;
}

export type DealStatus = 'open' | 'won' | 'lost';

export interface Deal {
 id: string;
 user_id: string;
 pipeline_id: string;
 stage_id: string;
 /**
 * Nullable after migration 004 — becomes NULL when the referenced
 * contact is deleted (ON DELETE SET NULL). History preserved.
 */
 contact_id: string | null;
 conversation_id?: string;
 assigned_to?: string;
 title: string;
 value: number;
 currency?: string;
 notes?: string;
 expected_close_date?: string;
 status?: DealStatus;
 created_at: string;
 updated_at?: string;
 contact?: Contact;
 stage?: PipelineStage;
 assignee?: Profile;
}

export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
export type RecipientStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed';

export interface Broadcast {
 id: string;
 user_id: string;
 name: string;
 template_name: string;
 template_language: string;
 template_variables?: Record<string, unknown>;
 audience_filter?: Record<string, unknown>;
 scheduled_at?: string;
 status: BroadcastStatus;
 total_recipients: number;
 sent_count: number;
 delivered_count: number;
 read_count: number;
 replied_count: number;
 failed_count: number;
 created_at: string;
}

export interface BroadcastRecipient {
 id: string;
 broadcast_id: string;
 /**
 * Nullable after migration 004 — becomes NULL when the referenced
 * contact is deleted (ON DELETE SET NULL). History preserved; the
 * UI renders "Unknown" for orphaned rows.
 */
 contact_id: string | null;
 status: RecipientStatus;
 sent_at?: string;
 delivered_at?: string;
 read_at?: string;
 replied_at?: string;
 error_message?: string;
 /**
 * Meta's message id, persisted when the broadcast send succeeds so
 * the webhook can mirror status updates back onto the recipient row.
 * Added in migration 003.
 */
 whatsapp_message_id?: string;
 created_at: string;
 contact?: Contact;
}

// ============================================================
// Automations (migration 006)
// ============================================================

export type AutomationTriggerType =
 | 'new_message_received'
 | 'first_inbound_message'
 | 'keyword_match'
 | 'new_contact_created'
 | 'conversation_assigned'
 | 'tag_added'
 | 'time_based';

export type AutomationStepType =
 | 'send_message'
 | 'send_template'
 | 'add_tag'
 | 'remove_tag'
 | 'assign_conversation'
 | 'update_contact_field'
 | 'create_deal'
 | 'wait'
 | 'condition'
 | 'send_webhook'
 | 'close_conversation';

export type AutomationLogStatus = 'success' | 'partial' | 'failed';

export interface KeywordMatchTriggerConfig {
 keywords: string[];
 match_type: 'exact' | 'contains';
 case_sensitive?: boolean;
}

export interface TagTriggerConfig {
 tag_id: string;
}

export interface TimeBasedTriggerConfig {
 /** Cron expression or simple HH:mm string; engine can accept either. */
 schedule: string;
 timezone?: string;
}

export type AutomationTriggerConfig =
 | Record<string, never>
 | KeywordMatchTriggerConfig
 | TagTriggerConfig
 | TimeBasedTriggerConfig
 | Record<string, unknown>;

export interface SendMessageStepConfig {
 text: string;
}

export interface SendTemplateStepConfig {
 template_name: string;
 language?: string;
 variables?: Record<string, string>;
}

export interface TagStepConfig {
 tag_id: string;
}

export interface AssignConversationStepConfig {
 mode: 'specific' | 'round_robin';
 agent_id?: string;
}

export interface UpdateContactFieldStepConfig {
 field: string;
 value: string;
}

export interface CreateDealStepConfig {
 pipeline_id: string;
 stage_id: string;
 title: string;
 value?: number;
}

export interface WaitStepConfig {
 amount: number;
 unit: 'minutes' | 'hours' | 'days';
}

export type ConditionSubject =
 | 'contact_field'
 | 'tag_presence'
 | 'message_content'
 | 'time_of_day';

export interface ConditionStepConfig {
 subject: ConditionSubject;
 /** e.g. field name, tag id, substring, or "HH:mm-HH:mm" depending on subject */
 operand?: string;
 /** For contact_field equals / message_content contains — comparison value */
 value?: string;
}

export interface SendWebhookStepConfig {
 url: string;
 headers?: Record<string, string>;
 body_template?: string;
}

export type AutomationStepConfig =
 | SendMessageStepConfig
 | SendTemplateStepConfig
 | TagStepConfig
 | AssignConversationStepConfig
 | UpdateContactFieldStepConfig
 | CreateDealStepConfig
 | WaitStepConfig
 | ConditionStepConfig
 | SendWebhookStepConfig
 | Record<string, never>
 | Record<string, unknown>;

export interface Automation {
 id: string;
 user_id: string;
 name: string;
 description?: string;
 trigger_type: AutomationTriggerType;
 trigger_config: AutomationTriggerConfig;
 is_active: boolean;
 execution_count: number;
 last_executed_at?: string | null;
 created_at: string;
 updated_at: string;
}

export interface AutomationStep {
 id: string;
 automation_id: string;
 parent_step_id?: string | null;
 branch?: 'yes' | 'no' | null;
 step_type: AutomationStepType;
 step_config: AutomationStepConfig;
 position: number;
 created_at: string;
}

export interface AutomationLogStepResult {
 step_id: string;
 step_type: AutomationStepType;
 status: 'success' | 'skipped' | 'failed';
 detail?: string;
}

export interface AutomationLog {
 id: string;
 automation_id: string;
 user_id: string;
 contact_id: string | null;
 trigger_event: string;
 steps_executed: AutomationLogStepResult[];
 status: AutomationLogStatus;
 error_message?: string | null;
 created_at: string;
 contact?: Contact;
}
