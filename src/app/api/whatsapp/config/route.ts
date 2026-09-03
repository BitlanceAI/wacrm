import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { wabaHasPaymentMethod, verifyPhoneNumber, subscribeWabaToApp } from '@/lib/whatsapp/meta-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { resolveTenantUserId } from '@/lib/team/tenant'

/**
 * GET /api/whatsapp/config
 *
 * Used by the "Test API Connection" button and by the page to check
 * whether the saved config is healthy. Returns 200 in all non-auth cases
 * so the UI can render an appropriate message rather than show a 500.
 *
 * Response shape:
 * { connected: true, phone_info: {...} }
 * { connected: false, reason: 'no_config', message: '...' }
 * { connected: false, reason: 'token_corrupted', message: '...', needs_reset: true }
 * { connected: false, reason: 'meta_api_error', message: '...' }
 */
export async function GET() {
 try {
 const supabase = await createClient()

 const {
 data: { user },
 error: authError,
 } = await supabase.auth.getUser()

 if (authError || !user) {
 return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 }

 const tenantId = await resolveTenantUserId(supabase, user.id)
 const { data: config, error: configError } = await supabase
 .from('whatsapp_config')
 .select('phone_number_id, waba_id, access_token, status')
 .eq('user_id', tenantId)
 .maybeSingle()

 if (configError) {
 console.error('Error fetching whatsapp_config:', configError)
 return NextResponse.json(
 { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
 { status: 200 }
 )
 }

 if (!config) {
 return NextResponse.json(
 {
 connected: false,
 reason: 'no_config',
 message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
 },
 { status: 200 }
 )
 }

 // Try to decrypt the stored token with the current ENCRYPTION_KEY.
 // If this fails, the key changed (or was never consistent across envs).
 let accessToken: string
 try {
 accessToken = decrypt(config.access_token)
 } catch (err) {
 console.error('[whatsapp/config GET] Token decryption failed:', err)
 return NextResponse.json(
 {
 connected: false,
 reason: 'token_corrupted',
 needs_reset: true,
 message:
 'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs Hostinger vs Vercel). Click "Reset Configuration" below, then re-save.',
 },
 { status: 200 }
 )
 }

 // Validate credentials against Meta
 try {
 const phoneInfo = await verifyPhoneNumber({
 phoneNumberId: config.phone_number_id,
 accessToken,
 })
 // Funding status for the persistent "no payment method" badge.
 // null = unknown (API didn't answer) — the UI stays quiet on null
 // so the badge never shows on a guess.
 const paymentMethodConfigured = config.waba_id
 ? await wabaHasPaymentMethod({ wabaId: config.waba_id, accessToken })
 : null
 return NextResponse.json({
 connected: true,
 phone_info: phoneInfo,
 payment_method_configured: paymentMethodConfigured,
 })
 } catch (err) {
 const message = err instanceof Error ? err.message : 'Unknown Meta API error'
 console.error('[whatsapp/config GET] Meta API verification failed:', message)
 return NextResponse.json(
 {
 connected: false,
 reason: 'meta_api_error',
 message: `Meta API rejected the credentials: ${message}`,
 },
 { status: 200 }
 )
 }
 } catch (error) {
 console.error('Error in WhatsApp config GET:', error)
 return NextResponse.json(
 { connected: false, reason: 'unknown', message: 'Internal server error' },
 { status: 500 }
 )
 }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves or updates the WhatsApp config for the authenticated user.
 * Verifies credentials with Meta first, then encrypts and stores.
 */
export async function POST(request: Request) {
 try {
 const supabase = await createClient()

 const {
 data: { user },
 error: authError,
 } = await supabase.auth.getUser()

 if (authError || !user) {
 return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 }

 // Connection management is owner-only: the config row carries the
 // encrypted token and drives webhook routing for the whole tenant.
 const tenantId = await resolveTenantUserId(supabase, user.id)
 if (tenantId !== user.id) {
 return NextResponse.json(
 { error: 'Only the workspace owner can manage the WhatsApp connection.' },
 { status: 403 }
 )
 }

 const body = await request.json()
 const { phone_number_id, waba_id, access_token, verify_token } = body

 if (!phone_number_id) {
 return NextResponse.json(
 { error: 'phone_number_id is required' },
 { status: 400 }
 )
 }

 // Load any existing config first, so an update can reuse the stored
 // token instead of forcing the user to paste the Permanent Access Token
 // again every time they change something else (e.g. the WABA ID).
 const { data: existing } = await supabase
 .from('whatsapp_config')
 .select('id, access_token, verify_token, waba_id')
 .eq('user_id', user.id)
 .maybeSingle()

 // Resolve which access token to verify + store:
 //  - a freshly entered token always wins,
 //  - otherwise reuse the stored (encrypted) one on update,
 //  - initial setup with no token is an error.
 let accessTokenPlain: string
 let encryptedAccessToken: string
 if (access_token) {
 accessTokenPlain = access_token
 try {
 encryptedAccessToken = encrypt(access_token)
 } catch (err) {
 const message = err instanceof Error ? err.message : 'Unknown encryption error'
 console.error('Encryption failed:', message)
 return NextResponse.json(
 {
 error:
 'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
 },
 { status: 500 }
 )
 }
 } else if (existing) {
 encryptedAccessToken = existing.access_token
 try {
 accessTokenPlain = decrypt(existing.access_token)
 } catch (err) {
 console.error('[whatsapp/config POST] Stored token decryption failed:', err)
 return NextResponse.json(
 {
 error:
 'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. Re-enter the Permanent Access Token to save.',
 needs_reset: true,
 },
 { status: 400 }
 )
 }
 } else {
 return NextResponse.json(
 { error: 'access_token and phone_number_id are required' },
 { status: 400 }
 )
 }

 // Verify credentials with Meta BEFORE saving
 let phoneInfo
 try {
 phoneInfo = await verifyPhoneNumber({
 phoneNumberId: phone_number_id,
 accessToken: accessTokenPlain,
 })
 } catch (err) {
 const message = err instanceof Error ? err.message : 'Unknown Meta API error'
 console.error('Meta API verification failed during save:', message)
 return NextResponse.json(
 { error: `Meta API error: ${message}` },
 { status: 400 }
 )
 }

 // Subscribe our app to the WABA's webhooks. Meta only delivers
 // events for WABAs explicitly subscribed via /subscribed_apps —
 // the dashboard's callback-URL setup alone is not enough. Skipping
 // this is why a freshly connected account "works" for sending but
 // inbound messages never reach the inbox.
 //
 // Failure is surfaced but non-fatal: the config is still saved so
 // the user can send, and the warning tells them receiving is broken.
 let webhookSubscribed = false
 let webhookSubscribeError: string | null = null
 if (waba_id) {
 try {
 await subscribeWabaToApp({
 wabaId: waba_id,
 accessToken: accessTokenPlain,
 })
 webhookSubscribed = true
 } catch (err) {
 webhookSubscribeError =
 err instanceof Error ? err.message : 'Unknown Meta API error'
 console.warn(
 '[whatsapp/config POST] WABA webhook subscription failed:',
 webhookSubscribeError
 )
 }
 }

 // Resolve the verify token the same way: only overwrite it when a new
 // value is supplied, otherwise keep whatever is already stored.
 let encryptedVerifyToken: string | null
 if (verify_token) {
 try {
 encryptedVerifyToken = encrypt(verify_token)
 } catch (err) {
 const message = err instanceof Error ? err.message : 'Unknown encryption error'
 console.error('Verify token encryption failed:', message)
 return NextResponse.json(
 { error: 'Failed to encrypt verify token.' },
 { status: 500 }
 )
 }
 } else {
 encryptedVerifyToken = existing?.verify_token ?? null
 }

 if (existing) {
 const { error: updateError } = await supabase
 .from('whatsapp_config')
 .update({
 phone_number_id,
 waba_id: waba_id || null,
 access_token: encryptedAccessToken,
 verify_token: encryptedVerifyToken,
 status: 'connected',
 connected_at: new Date().toISOString(),
 updated_at: new Date().toISOString(),
 })
 .eq('user_id', user.id)

 if (updateError) {
 console.error('Error updating whatsapp_config:', updateError)
 return NextResponse.json(
 { error: 'Failed to update configuration' },
 { status: 500 }
 )
 }

 // Repointed at a different WhatsApp Business Account? The cached
 // templates belong to the old one. Drop them here rather than
 // waiting on the follow-up sync: the templates the user sees must
 // never outlive the account that issued them, and a sync that fails
 // (bad token, WABA ID typo) would otherwise leave the old account's
 // catalog on screen — pickable, and guaranteed to fail at Meta.
 //
 // Only Meta-derived rows go: anything stamped with the old waba_id,
 // plus pre-waba_id rows carrying a Meta-assigned status (the
 // template manager only ever writes 'Draft'). Hand-made drafts stay.
 if (existing.waba_id && existing.waba_id !== (waba_id || null)) {
 const { error: pruneError } = await supabase
 .from('message_templates')
 .delete()
 .eq('user_id', user.id)
 .or(
 `waba_id.eq.${existing.waba_id},and(waba_id.is.null,status.neq.Draft)`
 )

 if (pruneError) {
 // Non-fatal: the config itself saved. The next sync prunes.
 console.warn(
 '[whatsapp/config POST] Failed to clear templates from previous WABA:',
 pruneError.message
 )
 }
 }
 } else {
 const { error: insertError } = await supabase
 .from('whatsapp_config')
 .insert({
 user_id: user.id,
 phone_number_id,
 waba_id: waba_id || null,
 access_token: encryptedAccessToken,
 verify_token: encryptedVerifyToken,
 status: 'connected',
 connected_at: new Date().toISOString(),
 })

 if (insertError) {
 console.error('Error inserting whatsapp_config:', insertError)
 return NextResponse.json(
 { error: 'Failed to save configuration' },
 { status: 500 }
 )
 }
 }

 return NextResponse.json({
 success: true,
 phone_info: phoneInfo,
 // Receiving-side health: false + reason when the WABA couldn't be
 // subscribed to our app's webhooks (inbound messages won't arrive),
 // false + null when no WABA ID was provided to subscribe with.
 webhook_subscribed: webhookSubscribed,
 webhook_subscribe_error: webhookSubscribeError,
 })
 } catch (error) {
 console.error('Error in WhatsApp config POST:', error)
 return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
 }
}

/**
 * DELETE /api/whatsapp/config
 *
 * Removes the authenticated user's WhatsApp configuration row.
 * Used by the "Reset Configuration" button to recover from a corrupted
 * encrypted token (mismatched ENCRYPTION_KEY across environments).
 */
export async function DELETE() {
 try {
 const supabase = await createClient()

 const {
 data: { user },
 error: authError,
 } = await supabase.auth.getUser()

 if (authError || !user) {
 return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 }

 const { error: deleteError } = await supabase
 .from('whatsapp_config')
 .delete()
 .eq('user_id', user.id)

 if (deleteError) {
 console.error('Error deleting whatsapp_config:', deleteError)
 return NextResponse.json(
 { error: 'Failed to delete configuration' },
 { status: 500 }
 )
 }

 return NextResponse.json({ success: true })
 } catch (error) {
 console.error('Error in WhatsApp config DELETE:', error)
 return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
 }
}
