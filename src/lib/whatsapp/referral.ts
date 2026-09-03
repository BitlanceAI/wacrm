/**
 * Click-to-WhatsApp (CTWA) ad referral parsing.
 *
 * When someone taps a "Send message" ad on Facebook or Instagram, the
 * first inbound webhook message carries a `referral` object naming the
 * ad. It is present ONLY on that first message — if it isn't captured
 * there, the lead's origin is lost for good.
 *
 * Shape (Cloud API):
 *   referral: {
 *     source_url, source_id, source_type: 'ad' | 'post',
 *     headline, body, media_type, image_url, video_url, thumbnail_url,
 *     ctwa_clid
 *   }
 */

export interface RawReferral {
  source_url?: string
  source_id?: string
  source_type?: string
  headline?: string
  body?: string
  media_type?: string
  image_url?: string
  video_url?: string
  thumbnail_url?: string
  ctwa_clid?: string
}

/** Normalized attribution record stored on `contacts.source_details`. */
export interface ReferralAttribution {
  source_id: string | null
  source_type: string | null
  source_url: string | null
  headline: string | null
  body: string | null
  media_type: string | null
  /** Click id — the join key for matching back to Meta Ads reporting. */
  ctwa_clid: string | null
  captured_at: string
}

/** `contacts.source` values; must match the CHECK in migration 014. */
export type ContactSource =
  | 'manual'
  | 'import'
  | 'whatsapp'
  | 'ctwa_ad'
  | 'api'
  | 'automation'

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/**
 * Turn a raw referral into the stored attribution record. Returns null
 * when the object carries nothing identifying — an empty referral is
 * worth no more than no referral, and writing it would mark the
 * contact as ad-sourced with nothing to show for it.
 */
export function parseReferral(
  referral: RawReferral | undefined | null,
  capturedAt: string
): ReferralAttribution | null {
  if (!referral) return null

  const attribution: ReferralAttribution = {
    source_id: str(referral.source_id),
    source_type: str(referral.source_type),
    source_url: str(referral.source_url),
    headline: str(referral.headline),
    body: str(referral.body),
    media_type: str(referral.media_type),
    ctwa_clid: str(referral.ctwa_clid),
    captured_at: capturedAt,
  }

  const identifying =
    attribution.source_id ?? attribution.ctwa_clid ?? attribution.source_url
  return identifying ? attribution : null
}

/**
 * A `post` referral is an organic click from a Facebook/Instagram post,
 * not paid media — worth distinguishing so ad-spend reporting isn't
 * inflated by organic leads.
 */
export function sourceForReferral(
  attribution: ReferralAttribution | null
): ContactSource {
  if (!attribution) return 'whatsapp'
  return attribution.source_type === 'post' ? 'whatsapp' : 'ctwa_ad'
}
