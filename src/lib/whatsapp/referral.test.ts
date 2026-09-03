import { describe, it, expect } from 'vitest'
import { parseReferral, sourceForReferral } from './referral'

const AT = '2026-08-25T10:00:00.000Z'

describe('parseReferral', () => {
  it('normalizes a full CTWA ad referral', () => {
    const result = parseReferral(
      {
        source_url: 'https://fb.me/2abc',
        source_id: '120210000000000000',
        source_type: 'ad',
        headline: 'Monsoon sale',
        body: '40% off everything',
        media_type: 'image',
        image_url: 'https://cdn/x.jpg',
        ctwa_clid: 'ARAbc123',
      },
      AT
    )
    expect(result).toEqual({
      source_id: '120210000000000000',
      source_type: 'ad',
      source_url: 'https://fb.me/2abc',
      headline: 'Monsoon sale',
      body: '40% off everything',
      media_type: 'image',
      ctwa_clid: 'ARAbc123',
      captured_at: AT,
    })
  })

  it('returns null for a missing or empty referral', () => {
    expect(parseReferral(undefined, AT)).toBeNull()
    expect(parseReferral(null, AT)).toBeNull()
    expect(parseReferral({}, AT)).toBeNull()
    expect(parseReferral({ headline: 'Just a headline' }, AT)).toBeNull()
  })

  it('keeps a referral identified only by click id', () => {
    expect(parseReferral({ ctwa_clid: 'ARxyz' }, AT)?.ctwa_clid).toBe('ARxyz')
  })

  it('blanks whitespace-only fields', () => {
    const result = parseReferral({ source_id: '123', headline: '   ' }, AT)
    expect(result?.headline).toBeNull()
  })
})

describe('sourceForReferral', () => {
  it('maps ad referrals to ctwa_ad', () => {
    expect(sourceForReferral(parseReferral({ source_id: '1', source_type: 'ad' }, AT))).toBe('ctwa_ad')
  })

  it('maps organic post clicks to whatsapp, not paid', () => {
    expect(sourceForReferral(parseReferral({ source_id: '1', source_type: 'post' }, AT))).toBe('whatsapp')
  })

  it('falls back to whatsapp with no referral at all', () => {
    expect(sourceForReferral(null)).toBe('whatsapp')
  })
})
