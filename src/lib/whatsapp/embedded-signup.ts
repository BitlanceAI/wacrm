'use client'

/**
 * Client half of Meta's Embedded Signup.
 *
 * Drives the Facebook Login for Business popup configured with a
 * WhatsApp Embedded Signup flow. Two independent channels report the
 * result, and BOTH are needed:
 *
 *  - FB.login's callback returns a one-time authorization `code`
 *    (response_type 'code'), which the server exchanges for the
 *    permanent business token, and
 *  - the popup posts a WA_EMBEDDED_SIGNUP `FINISH` message event
 *    carrying the asset ids (phone_number_id, waba_id) the client
 *    created or shared.
 *
 * launchEmbeddedSignup() runs both, joins them, and resolves with the
 * complete triple — or rejects on cancel/error.
 *
 * Requires (from the Meta app dashboard, with the app switched to a
 * Tech Provider / Embedded Signup setup):
 *  - NEXT_PUBLIC_META_APP_ID     — the app id
 *  - NEXT_PUBLIC_META_CONFIG_ID  — a Facebook Login for Business
 *    configuration id whose flow is "WhatsApp Embedded Signup"
 */

export interface EmbeddedSignupResult {
  code: string
  phoneNumberId: string
  wabaId: string
}

interface FbAuthResponse {
  authResponse?: { code?: string } | null
  status?: string
}

interface FbSdk {
  init(opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void
  login(
    cb: (response: FbAuthResponse) => void,
    opts: Record<string, unknown>,
  ): void
}

declare global {
  interface Window {
    FB?: FbSdk
    fbAsyncInit?: () => void
  }
}

const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js'
const GRAPH_VERSION = 'v21.0'

let sdkPromise: Promise<FbSdk> | null = null

/** Load and init the Facebook JS SDK exactly once. */
export function loadFacebookSdk(appId: string): Promise<FbSdk> {
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<FbSdk>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Facebook SDK can only load in the browser'))
      return
    }
    if (window.FB) {
      resolve(window.FB)
      return
    }
    window.fbAsyncInit = () => {
      window.FB!.init({
        appId,
        autoLogAppEvents: false,
        xfbml: false,
        version: GRAPH_VERSION,
      })
      resolve(window.FB!)
    }
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.defer = true
    script.onerror = () =>
      reject(new Error('Failed to load the Facebook SDK (blocked by an ad blocker?)'))
    document.head.appendChild(script)
  })
  // A failed load should be retryable on the next click.
  sdkPromise.catch(() => {
    sdkPromise = null
  })
  return sdkPromise
}

/**
 * Open the Embedded Signup popup and resolve with the code + asset
 * ids once the user completes the flow. Rejects if they cancel, the
 * flow errors, or the popup closes without completing.
 */
export async function launchEmbeddedSignup(opts: {
  appId: string
  configId: string
  /**
   * Coexistence: onboard a number that is actively used in the
   * WhatsApp Business App, keeping the app AND Cloud API working on
   * it. Swaps the WABA-selection screen for the "connect your
   * existing WhatsApp Business account" flow (QR scan from the
   * phone's app, version >= 2.24.17). Finishes with the
   * FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING event, which the message
   * handler below already accepts.
   */
  coexistence?: boolean
}): Promise<EmbeddedSignupResult> {
  const FB = await loadFacebookSdk(opts.appId)

  let phoneNumberId: string | null = null
  let wabaId: string | null = null
  let sessionRejected: string | null = null

  // The popup reports created/shared assets via postMessage from
  // facebook.com. Meta wraps them as type WA_EMBEDDED_SIGNUP with
  // event FINISH (or FINISH_ONLY_WABA / FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING
  // variants), CANCEL, or ERROR.
  const onMessage = (event: MessageEvent) => {
    if (!event.origin.endsWith('facebook.com')) return
    try {
      const payload =
        typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      if (payload?.type !== 'WA_EMBEDDED_SIGNUP') return
      if (payload.event === 'CANCEL') {
        sessionRejected = 'Signup was cancelled before completing.'
      } else if (payload.event === 'ERROR') {
        sessionRejected =
          payload.data?.error_message || 'Meta reported an error during signup.'
      } else {
        // FINISH*
        phoneNumberId = payload.data?.phone_number_id ?? phoneNumberId
        wabaId = payload.data?.waba_id ?? wabaId
      }
    } catch {
      // Non-JSON messages from facebook.com are unrelated chatter.
    }
  }
  window.addEventListener('message', onMessage)

  try {
    const code = await new Promise<string>((resolve, reject) => {
      FB.login(
        (response) => {
          const c = response.authResponse?.code
          if (c) resolve(c)
          else reject(new Error(sessionRejected ?? 'Login was cancelled or failed.'))
        },
        {
          config_id: opts.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            sessionInfoVersion: '3',
            ...(opts.coexistence
              ? { featureType: 'whatsapp_business_app_onboarding' }
              : {}),
          },
        },
      )
    })

    if (sessionRejected) throw new Error(sessionRejected)
    if (!phoneNumberId || !wabaId) {
      throw new Error(
        'Signup finished but Meta did not report the phone number / WABA ids. Close the popup and try again.',
      )
    }
    return { code, phoneNumberId, wabaId }
  } finally {
    window.removeEventListener('message', onMessage)
  }
}
