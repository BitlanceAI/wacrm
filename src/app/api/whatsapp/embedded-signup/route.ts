import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  exchangeEmbeddedSignupCode,
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

/**
 * Server half of Meta's Embedded Signup.
 *
 * The browser runs Meta's popup (Facebook Login for Business with a
 * WhatsApp Embedded Signup configuration). That yields two things:
 *   - a one-time authorization `code` from FB.login, and
 *   - the created/shared asset ids (phone_number_id, waba_id) posted
 *     by the flow's WA_EMBEDDED_SIGNUP `FINISH` message event.
 *
 * This route turns them into a working tenant:
 *   1. code -> business integration system-user token (never expires),
 *      exchanged server-side because the exchange needs META_APP_SECRET.
 *   2. Register the number for Cloud API messaging (Embedded Signup
 *      does NOT do this; sends fail with "not registered" until done).
 *   3. Subscribe our app to the WABA so webhooks flow.
 *   4. Prune templates left over from a previously connected WABA.
 *   5. Encrypt + upsert whatsapp_config, same shape as a manual save.
 *
 * Because every WABA onboarded this way lives under OUR Meta app, its
 * webhooks are signed with our META_APP_SECRET — the single-app model
 * the webhook handler already assumes.
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

    // Onboarding is rare; anything faster than a handful per minute is
    // a stuck retry loop, not a person.
    const limit = checkRateLimit(`embedded-signup:${user.id}`, {
      limit: 5,
      windowMs: 60_000,
    })
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const appId = process.env.NEXT_PUBLIC_META_APP_ID
    const appSecret = process.env.META_APP_SECRET
    if (!appId || !appSecret) {
      return NextResponse.json(
        {
          error:
            'Embedded Signup is not configured on this server. Set NEXT_PUBLIC_META_APP_ID and META_APP_SECRET.',
        },
        { status: 500 }
      )
    }

    const body = await request.json()
    const { code, phone_number_id, waba_id } = body as {
      code?: string
      phone_number_id?: string
      waba_id?: string
    }

    if (!code || !phone_number_id || !waba_id) {
      return NextResponse.json(
        { error: 'code, phone_number_id and waba_id are all required' },
        { status: 400 }
      )
    }

    // 1) One-time code -> permanent business token.
    let accessToken: string
    try {
      const exchanged = await exchangeEmbeddedSignupCode({
        code,
        appId,
        appSecret,
      })
      accessToken = exchanged.accessToken
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta error'
      console.error('[embedded-signup] code exchange failed:', message)
      return NextResponse.json(
        { error: `Could not exchange the signup code with Meta: ${message}` },
        { status: 502 }
      )
    }

    // Confirm the token actually reaches the phone number the popup
    // reported before persisting anything.
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta error'
      console.error('[embedded-signup] phone verification failed:', message)
      return NextResponse.json(
        { error: `Signup completed but the phone number could not be verified: ${message}` },
        { status: 502 }
      )
    }

    // 2) Register the number for Cloud API messaging. Best-effort: a
    // number that already carries a two-step PIN from a previous life
    // rejects our fresh PIN (the owner must reuse or reset theirs),
    // but sending may already work — so warn instead of failing the
    // whole onboarding.
    const pin = String(Math.floor(100000 + Math.random() * 900000))
    let registered = false
    let registerError: string | null = null
    try {
      await registerPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken,
        pin,
      })
      registered = true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta error'
      // Coexistence numbers (onboarded from the WhatsApp Business App
      // via QR) are registered by the app-side flow itself — Meta
      // refuses /register for them precisely because it's already
      // done. That refusal is success, not failure.
      if (/SMB business/i.test(message)) {
        registered = true
        console.log(
          '[embedded-signup] register skipped — coexistence (SMB) number, already registered via the Business App flow'
        )
      } else {
        registerError = message
        console.warn('[embedded-signup] register failed:', registerError)
      }
    }

    // 3) Webhooks for the new WABA.
    let webhookSubscribed = false
    let webhookSubscribeError: string | null = null
    try {
      await subscribeWabaToApp({ wabaId: waba_id, accessToken })
      webhookSubscribed = true
    } catch (err) {
      webhookSubscribeError =
        err instanceof Error ? err.message : 'Unknown Meta error'
      console.warn(
        '[embedded-signup] WABA webhook subscription failed:',
        webhookSubscribeError
      )
    }

    // 4) Templates cached from a previously connected WABA must not
    // survive the switch (same rule as a manual config save): drop
    // Meta-derived rows, keep hand-made drafts.
    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id, waba_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing?.waba_id && existing.waba_id !== waba_id) {
      const { error: pruneError } = await supabase
        .from('message_templates')
        .delete()
        .eq('user_id', user.id)
        .or(
          `waba_id.eq.${existing.waba_id},and(waba_id.is.null,status.neq.Draft)`
        )
      if (pruneError) {
        console.warn(
          '[embedded-signup] Failed to clear templates from previous WABA:',
          pruneError.message
        )
      }
    }

    // 5) Persist, encrypted — the same row a manual save writes, so
    // everything downstream (send, sync, webhook lookup) just works.
    let encryptedAccessToken: string
    try {
      encryptedAccessToken = encrypt(accessToken)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error('[embedded-signup] encryption failed:', message)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string.',
        },
        { status: 500 }
      )
    }

    const row = {
      phone_number_id,
      waba_id,
      access_token: encryptedAccessToken,
      status: 'connected' as const,
      connected_at: new Date().toISOString(),
    }

    const { error: saveError } = existing
      ? await supabase
          .from('whatsapp_config')
          .update({ ...row, updated_at: new Date().toISOString() })
          .eq('user_id', user.id)
      : await supabase
          .from('whatsapp_config')
          .insert({ ...row, user_id: user.id })

    if (saveError) {
      console.error('[embedded-signup] config save failed:', saveError)
      return NextResponse.json(
        { error: 'Connected to Meta but failed to save the configuration' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      phone_info: phoneInfo,
      registered,
      register_error: registerError,
      webhook_subscribed: webhookSubscribed,
      webhook_subscribe_error: webhookSubscribeError,
    })
  } catch (error) {
    console.error('[embedded-signup] Unhandled error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
