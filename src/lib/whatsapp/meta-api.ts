/**
 * Meta WhatsApp Cloud API helpers.
 *
 * Every function takes a single options object (named parameters) instead
 * of positional arguments. This was a deliberate choice after the same
 * swapped-args bug was found four times in a row with the positional form
 * (e.g. `(accessToken, phoneNumberId)` vs `(phoneNumberId, accessToken)`).
 * With named params, a typo surfaces immediately as a TypeScript error
 * instead of a runtime rejection from Meta.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export interface MetaSendResult {
 messageId: string
}

export interface MetaPhoneInfo {
 id: string
 display_phone_number: string
 verified_name?: string
 quality_rating?: string
}

interface MetaErrorResponse {
 error?: {
 message?: string
 code?: number
 type?: string
 // Meta's pinpoint diagnostics — for template errors like #131009
 // this names the offending component ("header: Format mismatch,
 // expected IMAGE, received UNKNOWN"). Losing it turns a one-line
 // fix into guesswork, so it's appended to the thrown message.
 error_data?: { details?: string }
 }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
 let message = fallback
 try {
 const data = (await response.json()) as MetaErrorResponse
 if (data.error?.message) message = data.error.message
 const details = data.error?.error_data?.details
 if (details && !message.includes(details)) {
 message = `${message} — ${details}`
 }
 } catch {
 // response body wasn't JSON — keep the fallback
 }
 throw new Error(message)
}

// ============================================================
// Billing / funding status
// ============================================================

/**
 * Does the WABA have a payment method attached?
 *
 * Meta exposes this as `primary_funding_id` on the WABA — present when
 * a card/credit line is configured, absent otherwise. A WABA without
 * funding can only use the free tier; paid sends fail with #131042,
 * which reads like a platform bug unless surfaced at onboarding.
 *
 * Returns null when the answer can't be determined (API error, field
 * unavailable for this account type) — callers should stay quiet on
 * null rather than warn on a guess.
 */
export async function wabaHasPaymentMethod(args: {
 wabaId: string
 accessToken: string
}): Promise<boolean | null> {
 try {
 const response = await fetch(
 `${META_API_BASE}/${args.wabaId}?fields=primary_funding_id`,
 { headers: { Authorization: `Bearer ${args.accessToken}` } }
 )
 if (!response.ok) return null
 const data = (await response.json()) as { primary_funding_id?: string }
 return Boolean(data.primary_funding_id)
 } catch {
 return null
 }
}

// ============================================================
// Coexistence data sync
// ============================================================

export interface InitiateSmbAppDataSyncArgs {
 phoneNumberId: string
 accessToken: string
 /** 'smb_app_state_sync' = contacts; 'history' = chat history. */
 syncType: 'smb_app_state_sync' | 'history'
}

/**
 * Kick off WhatsApp Business App data synchronization for a
 * coexistence-onboarded number. MUST be called within 24 hours of
 * onboarding or Meta offboards the customer and they have to redo
 * Embedded Signup. Each sync type can be initiated exactly once per
 * onboarding; results arrive asynchronously as webhooks
 * (smb_app_state_sync / history fields).
 */
export async function initiateSmbAppDataSync(
 args: InitiateSmbAppDataSyncArgs
): Promise<{ requestId: string | null }> {
 const { phoneNumberId, accessToken, syncType } = args
 const response = await fetch(`${META_API_BASE}/${phoneNumberId}/smb_app_data`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 Authorization: `Bearer ${accessToken}`,
 },
 body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: syncType }),
 })
 if (!response.ok) {
 await throwMetaError(response, `Meta API error: ${response.status}`)
 }
 const data = (await response.json()) as { request_id?: string }
 return { requestId: data.request_id ?? null }
}

// ============================================================
// Template creation
// ============================================================

export interface CreateTemplateButton {
 type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE'
 text?: string
 url?: string
 phone_number?: string
 /** Sample values for dynamic URL suffix / copy-code. */
 example?: string[] | string
}

export interface CreateMessageTemplateArgs {
 wabaId: string
 accessToken: string
 name: string
 language: string
 category: 'MARKETING' | 'UTILITY'
 bodyText: string
 /** Sample value per {{N}} body placeholder, in order. */
 bodyExamples?: string[]
 headerType?: 'text' | 'image' | 'video' | 'document' | null
 /** Text headers: the header line (may contain one {{1}}). */
 headerText?: string
 /** Text headers with a variable: sample value for {{1}}. */
 headerTextExample?: string
 /** Media headers: upload handle from uploadTemplateHeaderMedia(). */
 headerHandle?: string
 footerText?: string
 buttons?: CreateTemplateButton[]
}

/**
 * Submit a template to Meta for review (POST /{waba_id}/message_templates).
 * Returns Meta's template id and initial status (usually PENDING).
 *
 * Meta requires an example for every variable — template review is done
 * by humans/classifiers looking at a rendered sample — and a header
 * media *handle* (from the Resumable Upload API, not a phone media id)
 * for image/video/document headers.
 */
export async function createMessageTemplate(
 args: CreateMessageTemplateArgs
): Promise<{ id: string; status: string; category: string }> {
 const {
 wabaId,
 accessToken,
 name,
 language,
 category,
 bodyText,
 bodyExamples,
 headerType,
 headerText,
 headerTextExample,
 headerHandle,
 footerText,
 buttons,
 } = args

 const components: Record<string, unknown>[] = []

 if (headerType === 'text' && headerText) {
 const header: Record<string, unknown> = {
 type: 'HEADER',
 format: 'TEXT',
 text: headerText,
 }
 if (headerTextExample) {
 header.example = { header_text: [headerTextExample] }
 }
 components.push(header)
 } else if (
 (headerType === 'image' || headerType === 'video' || headerType === 'document') &&
 headerHandle
 ) {
 components.push({
 type: 'HEADER',
 format: headerType.toUpperCase(),
 example: { header_handle: [headerHandle] },
 })
 }

 const body: Record<string, unknown> = { type: 'BODY', text: bodyText }
 if (bodyExamples && bodyExamples.length > 0) {
 body.example = { body_text: [bodyExamples] }
 }
 components.push(body)

 if (footerText) {
 components.push({ type: 'FOOTER', text: footerText })
 }

 if (buttons && buttons.length > 0) {
 components.push({
 type: 'BUTTONS',
 buttons: buttons.map((b) => {
 const btn: Record<string, unknown> = { type: b.type }
 if (b.text) btn.text = b.text
 if (b.url) btn.url = b.url
 if (b.phone_number) btn.phone_number = b.phone_number
 if (b.example) btn.example = b.example
 return btn
 }),
 })
 }

 const response = await fetch(`${META_API_BASE}/${wabaId}/message_templates`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 Authorization: `Bearer ${accessToken}`,
 },
 body: JSON.stringify({ name, language, category, components }),
 })
 if (!response.ok) {
 await throwMetaError(response, `Meta API error: ${response.status}`)
 }
 return response.json()
}

export interface UploadTemplateHeaderMediaArgs {
 appId: string
 accessToken: string
 fileName: string
 fileType: string
 data: ArrayBuffer
}

/**
 * Resumable Upload API: turn a media file into the `h:...` handle that
 * template creation requires for image/video/document header examples.
 * (Distinct from POST /{phone_id}/media, whose ids Meta refuses here.)
 */
export async function uploadTemplateHeaderMedia(
 args: UploadTemplateHeaderMediaArgs
): Promise<{ handle: string }> {
 const { appId, accessToken, fileName, fileType, data } = args

 const sessionRes = await fetch(
 `${META_API_BASE}/${appId}/uploads` +
 `?file_name=${encodeURIComponent(fileName)}` +
 `&file_length=${data.byteLength}` +
 `&file_type=${encodeURIComponent(fileType)}`,
 {
 method: 'POST',
 headers: { Authorization: `Bearer ${accessToken}` },
 }
 )
 if (!sessionRes.ok) {
 await throwMetaError(sessionRes, `Meta API error: ${sessionRes.status}`)
 }
 const session = (await sessionRes.json()) as { id?: string }
 if (!session.id) {
 throw new Error('Meta returned no upload session id')
 }

 // Session id already looks like "upload:XXXX" — it is its own path.
 const uploadRes = await fetch(`https://graph.facebook.com/${session.id}`, {
 method: 'POST',
 headers: {
 // Yes, OAuth — the upload endpoint rejects the Bearer scheme.
 Authorization: `OAuth ${accessToken}`,
 file_offset: '0',
 },
 body: data,
 })
 if (!uploadRes.ok) {
 await throwMetaError(uploadRes, `Meta API error: ${uploadRes.status}`)
 }
 const uploaded = (await uploadRes.json()) as { h?: string }
 if (!uploaded.h) {
 throw new Error('Meta returned no media handle from the upload')
 }
 return { handle: uploaded.h }
}

// ============================================================
// Embedded Signup
// ============================================================

export interface ExchangeEmbeddedSignupCodeArgs {
 /** One-time code from FB.login's authResponse (response_type 'code'). */
 code: string
 appId: string
 appSecret: string
}

/**
 * Exchange the Embedded Signup authorization code for a business
 * integration system-user access token scoped to the WABA the client
 * just shared with our app. This token doesn't expire and is what we
 * store (encrypted) as the tenant's access_token.
 */
export async function exchangeEmbeddedSignupCode(
 args: ExchangeEmbeddedSignupCodeArgs
): Promise<{ accessToken: string }> {
 const { code, appId, appSecret } = args
 const url =
 `${META_API_BASE}/oauth/access_token` +
 `?client_id=${encodeURIComponent(appId)}` +
 `&client_secret=${encodeURIComponent(appSecret)}` +
 `&code=${encodeURIComponent(code)}`
 const response = await fetch(url)
 if (!response.ok) {
 await throwMetaError(response, `Meta API error: ${response.status}`)
 }
 const data = (await response.json()) as { access_token?: string }
 if (!data.access_token) {
 throw new Error('Meta returned no access_token for the signup code')
 }
 return { accessToken: data.access_token }
}

export interface RegisterPhoneNumberArgs {
 phoneNumberId: string
 accessToken: string
 /** Six-digit two-step verification PIN. */
 pin: string
}

/**
 * Register a phone number for Cloud API messaging. Numbers onboarded
 * through Embedded Signup are NOT registered automatically — sends
 * fail until this is called once. Registering an already-registered
 * number is a no-op success, so callers can invoke it unconditionally.
 */
export async function registerPhoneNumber(
 args: RegisterPhoneNumberArgs
): Promise<void> {
 const { phoneNumberId, accessToken, pin } = args
 const url = `${META_API_BASE}/${phoneNumberId}/register`
 const response = await fetch(url, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 Authorization: `Bearer ${accessToken}`,
 },
 body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
 })
 if (!response.ok) {
 await throwMetaError(response, `Meta API error: ${response.status}`)
 }
}

// ============================================================
// Phone number / account
// ============================================================

export interface VerifyPhoneNumberArgs {
 phoneNumberId: string
 accessToken: string
}

/**
 * Verify a Meta phone number ID by fetching its public metadata
 * (display_phone_number, verified_name, quality_rating).
 */
export async function verifyPhoneNumber(
 args: VerifyPhoneNumberArgs
): Promise<MetaPhoneInfo> {
 const { phoneNumberId, accessToken } = args
 const url = `${META_API_BASE}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`
 const response = await fetch(url, {
 headers: { Authorization: `Bearer ${accessToken}` },
 })
 if (!response.ok) {
 await throwMetaError(response, `Meta API error: ${response.status}`)
 }
 return response.json()
}

export interface SubscribeWabaArgs {
 wabaId: string
 accessToken: string
}

/**
 * Subscribe our Meta app to a WhatsApp Business Account's webhooks.
 *
 * Setting the callback URL in the Meta app dashboard is only half of
 * webhook setup — Meta sends events for a WABA only after the app is
 * subscribed to that specific WABA via POST /{waba_id}/subscribed_apps.
 * Without this, switching Settings to a number under a new WABA means
 * inbound messages and status updates silently never arrive: nothing
 * errors, the inbox just stays empty.
 *
 * Idempotent — subscribing an already-subscribed WABA succeeds.
 */
export async function subscribeWabaToApp(
 args: SubscribeWabaArgs
): Promise<void> {
 const { wabaId, accessToken } = args
 const url = `${META_API_BASE}/${wabaId}/subscribed_apps`
 const response = await fetch(url, {
 method: 'POST',
 headers: { Authorization: `Bearer ${accessToken}` },
 })
 if (!response.ok) {
 await throwMetaError(response, `Meta API error: ${response.status}`)
 }
}

// ============================================================
// Template definitions
// ============================================================

export interface MetaTemplateButtonDef {
 type: string // QUICK_REPLY | URL | PHONE_NUMBER | FLOW | COPY_CODE | OTP …
 text?: string
 url?: string
}

export interface MetaTemplateComponentDef {
 type: string // HEADER | BODY | FOOTER | BUTTONS
 format?: string
 text?: string
 buttons?: MetaTemplateButtonDef[]
}

export interface MetaTemplateDefinition {
 name: string
 language: string
 components?: MetaTemplateComponentDef[]
}

/**
 * Fetch one template's full definition (incl. buttons) from Meta.
 * The local message_templates cache stores only header/body/footer, so
 * anything that needs the button layout — Flow buttons, dynamic URL
 * buttons — must ask Meta. Returns null on any failure: callers use
 * this to *improve* a send, never to gate one.
 */
export async function fetchTemplateDefinition(args: {
 wabaId: string
 accessToken: string
 name: string
 language: string
}): Promise<MetaTemplateDefinition | null> {
 try {
 // Meta's `name` filter matches loosely; compare exactly below.
 const url = `${META_API_BASE}/${args.wabaId}/message_templates?name=${encodeURIComponent(args.name)}&fields=name,language,components&limit=100`
 const response = await fetch(url, {
 headers: { Authorization: `Bearer ${args.accessToken}` },
 })
 if (!response.ok) return null
 const data = (await response.json()) as { data?: MetaTemplateDefinition[] }
 return (
 (data.data ?? []).find(
 (t) => t.name === args.name && t.language === args.language
 ) ?? null
 )
 } catch {
 return null
 }
}

/**
 * Build the send-time `button` components a template's button layout
 * demands, or report why the template can't be sent by this pipeline.
 *
 * - FLOW buttons must be echoed as {sub_type:"flow"} components on
 *   every send — omitting them fails with #131009 "Components
 *   sub_type invalid".
 * - Dynamic URL buttons ({{1}} in the URL) and COPY_CODE buttons need
 *   per-send values the pipeline doesn't collect yet → blocked with an
 *   actionable message instead of a cryptic Meta error.
 * - QUICK_REPLY / PHONE_NUMBER / static URL buttons need nothing.
 */
export function buildButtonComponents(def: MetaTemplateDefinition | null): {
 components: Record<string, unknown>[]
 blocker: string | null
} {
 const buttons =
 def?.components?.find((c) => c.type?.toUpperCase() === 'BUTTONS')?.buttons ??
 []
 const components: Record<string, unknown>[] = []
 for (let i = 0; i < buttons.length; i++) {
 const type = buttons[i]?.type?.toUpperCase() ?? ''
 if (type === 'FLOW') {
 components.push({
 type: 'button',
 sub_type: 'flow',
 index: String(i),
 parameters: [{ type: 'action', action: {} }],
 })
 } else if (type === 'URL' && /\{\{\s*\d+\s*\}\}/.test(buttons[i]?.url ?? '')) {
 return {
 components,
 blocker: `This template's "${buttons[i]?.text ?? 'URL'}" button has a dynamic URL variable, which broadcasts don't support yet. Recreate the template with a fixed URL, or remove the variable from the button.`,
 }
 } else if (type === 'COPY_CODE') {
 return {
 components,
 blocker:
 'This template has a copy-code (coupon) button, which needs a per-send code that broadcasts don\'t support yet. Use a template without a copy-code button.',
 }
 }
 }
 return { components, blocker: null }
}

// ============================================================
// Sending
// ============================================================

export interface SendTextMessageArgs {
 phoneNumberId: string
 accessToken: string
 to: string
 text: string
 /** Meta's message_id of the message being replied to. Adds a `context` field
 * so WhatsApp renders the new message as a reply with a quote preview. */
 contextMessageId?: string
}

/**
 * Send a free-form WhatsApp text message.
 * Only works inside the 24-hour customer service window.
 */
export async function sendTextMessage(
 args: SendTextMessageArgs
): Promise<MetaSendResult> {
 const { phoneNumberId, accessToken, to, text, contextMessageId } = args
 const url = `${META_API_BASE}/${phoneNumberId}/messages`
 const body: Record<string, unknown> = {
 messaging_product: 'whatsapp',
 recipient_type: 'individual',
 to,
 type: 'text',
 text: { body: text },
 }
 if (contextMessageId) {
 body.context = { message_id: contextMessageId }
 }
 const response = await fetch(url, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 Authorization: `Bearer ${accessToken}`,
 },
 body: JSON.stringify(body),
 })
 if (!response.ok) {
 await throwMetaError(response, `Meta API error: ${response.status}`)
 }
 const data = await response.json()
 return { messageId: data.messages[0].id }
}

/**
 * Send-time header content. Meta templates fix the header's *shape*
 * at creation (text-with-variable, image, video, document) but the
 * actual content — the header variable's value, or the media asset —
 * must be supplied as a `header` component on every send. Omitting it
 * for a template that has one fails with error #132012.
 */
export interface TemplateHeaderParam {
 type: 'text' | 'image' | 'video' | 'document'
 /** Text value for text headers; public https URL for media headers. */
 value: string
}

export interface SendTemplateMessageArgs {
 phoneNumberId: string
 accessToken: string
 to: string
 templateName: string
 language?: string
 params?: string[]
 /** Required when the template's header has a variable or is media. */
 header?: TemplateHeaderParam
 /** Extra pre-built components appended after header/body — e.g. the
 * `button` components from buildButtonComponents for Flow buttons. */
 extraComponents?: Record<string, unknown>[]
 /** Meta's message_id of the message being replied to. */
 contextMessageId?: string
}

/**
 * Send a pre-approved WhatsApp message template. Required outside
 * the 24-hour window and for any first-touch messaging.
 */
export async function sendTemplateMessage(
 args: SendTemplateMessageArgs
): Promise<MetaSendResult> {
 const {
 phoneNumberId,
 accessToken,
 to,
 templateName,
 language = 'en_US',
 params,
 header,
 extraComponents,
 contextMessageId,
 } = args
 const url = `${META_API_BASE}/${phoneNumberId}/messages`

 const template: Record<string, unknown> = {
 name: templateName,
 language: { code: language },
 }

 const components: Record<string, unknown>[] = []

 if (header) {
 components.push({
 type: 'header',
 parameters: [
 header.type === 'text'
 ? { type: 'text', text: header.value }
 : // Media headers take the asset by public link. (Meta also
 // accepts a pre-uploaded media `id`; link keeps the caller
 // contract simple.)
 { type: header.type, [header.type]: { link: header.value } },
 ],
 })
 }

 if (params && params.length > 0) {
 components.push({
 type: 'body',
 // Meta rejects body values containing newlines, tabs, or 4+
 // consecutive spaces with #131009 "Parameter value is not valid"
 // — easy to hit via CSV-imported names. Whitespace-only cleanup,
 // so the visible content is unchanged.
 parameters: params.map((p) => ({
 type: 'text',
 text: String(p).replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, ' ').trim(),
 })),
 })
 }

 if (extraComponents && extraComponents.length > 0) {
 components.push(...extraComponents)
 }

 if (components.length > 0) {
 template.components = components
 }

 const body: Record<string, unknown> = {
 messaging_product: 'whatsapp',
 recipient_type: 'individual',
 to,
 type: 'template',
 template,
 }
 if (contextMessageId) {
 body.context = { message_id: contextMessageId }
 }

 const response = await fetch(url, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 Authorization: `Bearer ${accessToken}`,
 },
 body: JSON.stringify(body),
 })
 if (!response.ok) {
 await throwMetaError(response, `Meta API error: ${response.status}`)
 }
 const data = await response.json()
 return { messageId: data.messages[0].id }
}

// ============================================================
// Reactions
// ============================================================

export interface SendReactionMessageArgs {
 phoneNumberId: string
 accessToken: string
 to: string
 /** Meta's message_id of the message being reacted to. */
 targetMessageId: string
 /** Single emoji, or empty string to remove an existing reaction. */
 emoji: string
}

/**
 * Send a reaction (or removal) to a previously-exchanged message.
 * Empty `emoji` removes the reaction per Meta's spec.
 */
export async function sendReactionMessage(
 args: SendReactionMessageArgs
): Promise<MetaSendResult> {
 const { phoneNumberId, accessToken, to, targetMessageId, emoji } = args
 const url = `${META_API_BASE}/${phoneNumberId}/messages`
 const response = await fetch(url, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 Authorization: `Bearer ${accessToken}`,
 },
 body: JSON.stringify({
 messaging_product: 'whatsapp',
 recipient_type: 'individual',
 to,
 type: 'reaction',
 reaction: { message_id: targetMessageId, emoji },
 }),
 })
 if (!response.ok) {
 await throwMetaError(response, `Meta API error: ${response.status}`)
 }
 const data = await response.json()
 return { messageId: data.messages[0].id }
}

// ============================================================
// Interactive (button replies + list messages)
// ============================================================
//
// Meta's two flavours of interactive message — used by the Flows
// engine to drive scripted chatbot menus. Caller passes plain
// JS values; helpers shape the Meta payload and enforce Meta's
// limits BEFORE the network call so the failure mode is a
// developer-facing error rather than a customer-facing one.

/**
 * Meta limits for interactive messages, hard-coded so violations
 * fail at build/save time rather than as a 400 from the Meta API
 * mid-conversation. See:
 * https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages
 * https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages
 */
export const INTERACTIVE_LIMITS = {
 maxButtons: 3,
 buttonTitleMaxLength: 20,
 maxListSections: 10,
 maxListRowsTotal: 10,
 listRowTitleMaxLength: 24,
 listRowDescriptionMaxLength: 72,
 bodyMaxLength: 1024,
 footerMaxLength: 60,
 headerTextMaxLength: 60,
} as const

export interface InteractiveButton {
 /** Stable id sent back in the webhook when tapped (≤ 256 chars). */
 id: string
 /** Visible label (≤ 20 chars per Meta). */
 title: string
}

export interface SendInteractiveButtonsArgs {
 phoneNumberId: string
 accessToken: string
 to: string
 /** The body text — what the customer reads above the buttons. */
 bodyText: string
 /** Optional plain-text header (≤ 60 chars). */
 headerText?: string
 /** Optional grey footer line under the buttons (≤ 60 chars). */
 footerText?: string
 /** 1–3 buttons. Validated against Meta's limits before sending. */
 buttons: InteractiveButton[]
 /** Meta's message_id of the message being replied to (quote preview). */
 contextMessageId?: string
}

/**
 * Send an interactive message with up to 3 inline reply buttons. The
 * customer taps one and Meta delivers a webhook with
 * `messages[0].interactive.button_reply.id` set to the matching button.id.
 *
 * Validation throws BEFORE the network call so misconfigured flows
 * fail at save time, not during a live conversation.
 */
export async function sendInteractiveButtons(
 args: SendInteractiveButtonsArgs
): Promise<MetaSendResult> {
 const {
 phoneNumberId, accessToken, to,
 bodyText, headerText, footerText, buttons, contextMessageId,
 } = args
 validateInteractiveBody(bodyText)
 validateInteractiveHeaderFooter(headerText, footerText)
 if (buttons.length < 1 || buttons.length > INTERACTIVE_LIMITS.maxButtons) {
 throw new Error(
 `Interactive button message requires 1-${INTERACTIVE_LIMITS.maxButtons} buttons (got ${buttons.length}).`
 )
 }
 for (const btn of buttons) {
 if (!btn.id) throw new Error('Interactive button missing id.')
 if (!btn.title) throw new Error(`Interactive button "${btn.id}" missing title.`)
 if (btn.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
 throw new Error(
 `Interactive button title "${btn.title}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`
 )
 }
 }

 const interactive: Record<string, unknown> = {
 type: 'button',
 body: { text: bodyText },
 action: {
 buttons: buttons.map((b) => ({
 type: 'reply',
 reply: { id: b.id, title: b.title },
 })),
 },
 }
 if (headerText) interactive.header = { type: 'text', text: headerText }
 if (footerText) interactive.footer = { text: footerText }

 const body: Record<string, unknown> = {
 messaging_product: 'whatsapp',
 recipient_type: 'individual',
 to,
 type: 'interactive',
 interactive,
 }
 if (contextMessageId) body.context = { message_id: contextMessageId }

 const url = `${META_API_BASE}/${phoneNumberId}/messages`
 const response = await fetch(url, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 Authorization: `Bearer ${accessToken}`,
 },
 body: JSON.stringify(body),
 })
 if (!response.ok) {
 await throwMetaError(response, `Meta API error: ${response.status}`)
 }
 const data = await response.json()
 return { messageId: data.messages[0].id }
}

export interface InteractiveListRow {
 /** Stable id sent back in the webhook when tapped (≤ 200 chars). */
 id: string
 /** Visible row title (≤ 24 chars per Meta). */
 title: string
 /** Optional secondary line shown under the title (≤ 72 chars). */
 description?: string
}

export interface InteractiveListSection {
 /** Optional section header shown above its rows. */
 title?: string
 rows: InteractiveListRow[]
}

export interface SendInteractiveListArgs {
 phoneNumberId: string
 accessToken: string
 to: string
 bodyText: string
 /** Label of the tap-to-expand button on the message bubble. */
 buttonLabel: string
 headerText?: string
 footerText?: string
 /**
 * 1–10 rows TOTAL across all sections. Meta caps the *total*, not
 * per-section. Validation enforces this before send.
 */
 sections: InteractiveListSection[]
 contextMessageId?: string
}

/**
 * Send an interactive message with a tap-to-expand list of selectable
 * rows. Use when there are more options than the 3-button limit allows.
 * Webhook arrives with `messages[0].interactive.list_reply.id` set to
 * the matching row.id.
 */
export async function sendInteractiveList(
 args: SendInteractiveListArgs
): Promise<MetaSendResult> {
 const {
 phoneNumberId, accessToken, to,
 bodyText, buttonLabel, headerText, footerText, sections, contextMessageId,
 } = args
 validateInteractiveBody(bodyText)
 validateInteractiveHeaderFooter(headerText, footerText)
 if (!buttonLabel) throw new Error('Interactive list requires a buttonLabel.')
 if (buttonLabel.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
 throw new Error(
 `Interactive list buttonLabel "${buttonLabel}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`
 )
 }
 if (sections.length < 1 || sections.length > INTERACTIVE_LIMITS.maxListSections) {
 throw new Error(
 `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListSections} sections (got ${sections.length}).`
 )
 }
 const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0)
 if (totalRows < 1 || totalRows > INTERACTIVE_LIMITS.maxListRowsTotal) {
 throw new Error(
 `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListRowsTotal} rows total across all sections (got ${totalRows}).`
 )
 }
 const seenIds = new Set<string>()
 for (const section of sections) {
 for (const row of section.rows) {
 if (!row.id) throw new Error('Interactive list row missing id.')
 if (seenIds.has(row.id)) {
 throw new Error(`Interactive list has duplicate row id "${row.id}".`)
 }
 seenIds.add(row.id)
 if (!row.title) throw new Error(`Interactive list row "${row.id}" missing title.`)
 if (row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength) {
 throw new Error(
 `Interactive list row title "${row.title}" exceeds ${INTERACTIVE_LIMITS.listRowTitleMaxLength} chars.`
 )
 }
 if (
 row.description &&
 row.description.length > INTERACTIVE_LIMITS.listRowDescriptionMaxLength
 ) {
 throw new Error(
 `Interactive list row description for "${row.id}" exceeds ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength} chars.`
 )
 }
 }
 }

 const interactive: Record<string, unknown> = {
 type: 'list',
 body: { text: bodyText },
 action: {
 button: buttonLabel,
 sections: sections.map((s) => ({
 ...(s.title ? { title: s.title } : {}),
 rows: s.rows.map((r) => ({
 id: r.id,
 title: r.title,
 ...(r.description ? { description: r.description } : {}),
 })),
 })),
 },
 }
 if (headerText) interactive.header = { type: 'text', text: headerText }
 if (footerText) interactive.footer = { text: footerText }

 const body: Record<string, unknown> = {
 messaging_product: 'whatsapp',
 recipient_type: 'individual',
 to,
 type: 'interactive',
 interactive,
 }
 if (contextMessageId) body.context = { message_id: contextMessageId }

 const url = `${META_API_BASE}/${phoneNumberId}/messages`
 const response = await fetch(url, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 Authorization: `Bearer ${accessToken}`,
 },
 body: JSON.stringify(body),
 })
 if (!response.ok) {
 await throwMetaError(response, `Meta API error: ${response.status}`)
 }
 const data = await response.json()
 return { messageId: data.messages[0].id }
}

function validateInteractiveBody(bodyText: string): void {
 if (!bodyText) throw new Error('Interactive message requires bodyText.')
 if (bodyText.length > INTERACTIVE_LIMITS.bodyMaxLength) {
 throw new Error(
 `Interactive bodyText exceeds ${INTERACTIVE_LIMITS.bodyMaxLength} chars.`
 )
 }
}

function validateInteractiveHeaderFooter(
 headerText: string | undefined,
 footerText: string | undefined,
): void {
 if (headerText && headerText.length > INTERACTIVE_LIMITS.headerTextMaxLength) {
 throw new Error(
 `Interactive headerText exceeds ${INTERACTIVE_LIMITS.headerTextMaxLength} chars.`
 )
 }
 if (footerText && footerText.length > INTERACTIVE_LIMITS.footerMaxLength) {
 throw new Error(
 `Interactive footerText exceeds ${INTERACTIVE_LIMITS.footerMaxLength} chars.`
 )
 }
}

// ============================================================
// Media
// ============================================================

export interface GetMediaUrlArgs {
 mediaId: string
 accessToken: string
}

/**
 * Resolve a media ID to Meta's (short-lived, authenticated) CDN URL
 * plus the MIME type. Step one of the media-proxy flow.
 */
export async function getMediaUrl(
 args: GetMediaUrlArgs
): Promise<{ url: string; mimeType: string }> {
 const { mediaId, accessToken } = args
 const response = await fetch(`${META_API_BASE}/${mediaId}`, {
 headers: { Authorization: `Bearer ${accessToken}` },
 })
 if (!response.ok) {
 await throwMetaError(response, `Media fetch failed: ${response.status}`)
 }
 const data = await response.json()
 if (!data.url) throw new Error('Media URL not found in Meta response')
 return { url: data.url, mimeType: data.mime_type || 'application/octet-stream' }
}

export interface DownloadMediaArgs {
 downloadUrl: string
 accessToken: string
}

/**
 * Fetch the binary bytes for a media URL obtained from getMediaUrl.
 * Step two of the media-proxy flow.
 */
export async function downloadMedia(
 args: DownloadMediaArgs
): Promise<{ buffer: Buffer; contentType: string }> {
 const { downloadUrl, accessToken } = args
 const response = await fetch(downloadUrl, {
 headers: { Authorization: `Bearer ${accessToken}` },
 })
 if (!response.ok) {
 throw new Error(`Media download failed: ${response.status}`)
 }
 const contentType =
 response.headers.get('content-type') || 'application/octet-stream'
 const buffer = Buffer.from(await response.arrayBuffer())
 return { buffer, contentType }
}

// ============================================================
// Commerce — catalog and product messages
//
// These reference items in a Meta Commerce Manager catalog by their
// `retailer_id`. The catalog itself is not managed here: WhatsApp
// renders the product card from Meta's copy, so a mismatch between our
// mirror and theirs shows up as a card that doesn't match the price we
// quoted — which is why products.retailer_id is the join key rather
// than any local id.
// ============================================================

/** Meta caps a multi-product message at 30 items across 10 sections. */
export const PRODUCT_MESSAGE_LIMITS = {
  maxSections: 10,
  maxProductsTotal: 30,
  sectionTitleMaxLength: 24,
} as const

export interface ProductSection {
  title: string
  /** Catalog retailer ids, in display order. */
  retailerIds: string[]
}

export interface SendCatalogMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  bodyText: string
  footerText?: string
  /**
   * Item shown on the catalog card's thumbnail. Optional — Meta picks
   * the catalog's cover when omitted.
   */
  thumbnailRetailerId?: string
}

/**
 * Send the "view catalog" card. One tap opens the whole storefront
 * inside WhatsApp — the lightest-weight way to answer "what do you
 * sell?" without listing anything by hand.
 */
export async function sendCatalogMessage(
  args: SendCatalogMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, bodyText, footerText, thumbnailRetailerId } = args
  validateInteractiveBody(bodyText)
  validateInteractiveHeaderFooter(undefined, footerText)

  const interactive: Record<string, unknown> = {
    type: 'catalog_message',
    body: { text: bodyText },
    action: {
      name: 'catalog_message',
      ...(thumbnailRetailerId
        ? { parameters: { thumbnail_product_retailer_id: thumbnailRetailerId } }
        : {}),
    },
  }
  if (footerText) interactive.footer = { text: footerText }

  return postInteractive({ phoneNumberId, accessToken, to, interactive })
}

export interface SendProductMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  catalogId: string
  retailerId: string
  bodyText?: string
  footerText?: string
}

/**
 * Send a single product card. The customer can add it to a cart and
 * send the cart back, which arrives as an inbound `order` message.
 */
export async function sendProductMessage(
  args: SendProductMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, catalogId, retailerId, bodyText, footerText } = args
  if (!catalogId) throw new Error('Product message requires a catalogId.')
  if (!retailerId) throw new Error('Product message requires a retailerId.')
  if (bodyText) validateInteractiveBody(bodyText)
  validateInteractiveHeaderFooter(undefined, footerText)

  const interactive: Record<string, unknown> = {
    type: 'product',
    action: {
      catalog_id: catalogId,
      product_retailer_id: retailerId,
    },
  }
  if (bodyText) interactive.body = { text: bodyText }
  if (footerText) interactive.footer = { text: footerText }

  return postInteractive({ phoneNumberId, accessToken, to, interactive })
}

export interface SendProductListArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  catalogId: string
  headerText: string
  bodyText: string
  footerText?: string
  sections: ProductSection[]
}

/**
 * Send a multi-product message — a curated subset of the catalog,
 * grouped into sections. Validation runs before the network call so a
 * bad selection fails where the operator can see it, not mid-chat.
 */
export async function sendProductList(
  args: SendProductListArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId, accessToken, to, catalogId,
    headerText, bodyText, footerText, sections,
  } = args

  if (!catalogId) throw new Error('Product list requires a catalogId.')
  if (!headerText) throw new Error('Product list requires a headerText.')
  validateInteractiveBody(bodyText)
  validateInteractiveHeaderFooter(headerText, footerText)

  if (sections.length < 1 || sections.length > PRODUCT_MESSAGE_LIMITS.maxSections) {
    throw new Error(
      `Product list requires 1-${PRODUCT_MESSAGE_LIMITS.maxSections} sections (got ${sections.length}).`
    )
  }
  const total = sections.reduce((sum, s) => sum + s.retailerIds.length, 0)
  if (total < 1 || total > PRODUCT_MESSAGE_LIMITS.maxProductsTotal) {
    throw new Error(
      `Product list requires 1-${PRODUCT_MESSAGE_LIMITS.maxProductsTotal} products in total (got ${total}).`
    )
  }
  for (const section of sections) {
    if (!section.title) throw new Error('Product list section missing title.')
    if (section.title.length > PRODUCT_MESSAGE_LIMITS.sectionTitleMaxLength) {
      throw new Error(
        `Product list section title "${section.title}" exceeds ${PRODUCT_MESSAGE_LIMITS.sectionTitleMaxLength} chars.`
      )
    }
    if (section.retailerIds.length === 0) {
      throw new Error(`Product list section "${section.title}" has no products.`)
    }
  }

  const interactive: Record<string, unknown> = {
    type: 'product_list',
    header: { type: 'text', text: headerText },
    body: { text: bodyText },
    action: {
      catalog_id: catalogId,
      sections: sections.map((s) => ({
        title: s.title,
        product_items: s.retailerIds.map((id) => ({ product_retailer_id: id })),
      })),
    },
  }
  if (footerText) interactive.footer = { text: footerText }

  return postInteractive({ phoneNumberId, accessToken, to, interactive })
}

/**
 * Shared POST for every interactive variant above. The three product
 * senders differ only in their `interactive` payload, so the transport,
 * error handling and result shape live in one place.
 */
async function postInteractive(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  interactive: Record<string, unknown>
}): Promise<MetaSendResult> {
  const response = await fetch(`${META_API_BASE}/${args.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: args.to,
      type: 'interactive',
      interactive: args.interactive,
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}
