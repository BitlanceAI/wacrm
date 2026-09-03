import { describe, it, expect } from 'vitest'
import {
  normalizeShortcut,
  isValidShortcut,
  extractSlashQuery,
  filterCannedReplies,
  renderCannedBody,
} from './match'
import type { CannedReply } from '@/types'

function reply(partial: Partial<CannedReply>): CannedReply {
  return {
    id: partial.shortcut ?? 'id',
    user_id: 'u1',
    shortcut: 'hours',
    title: 'Opening hours',
    body: 'We are open 9-6.',
    usage_count: 0,
    created_at: '2026-08-25T00:00:00.000Z',
    updated_at: '2026-08-25T00:00:00.000Z',
    ...partial,
  }
}

describe('normalizeShortcut', () => {
  it('strips the slash, lowercases and hyphenates spaces', () => {
    expect(normalizeShortcut('/Opening Hours')).toBe('opening-hours')
    expect(normalizeShortcut('  //REFUND  ')).toBe('refund')
  })

  it('drops characters the DB constraint would reject', () => {
    expect(normalizeShortcut('price?!£')).toBe('price')
  })

  it('caps length at 32 characters', () => {
    expect(normalizeShortcut('a'.repeat(50))).toHaveLength(32)
  })
})

describe('isValidShortcut', () => {
  it('accepts normalized shortcuts and rejects everything else', () => {
    expect(isValidShortcut('refund-policy_2')).toBe(true)
    expect(isValidShortcut('')).toBe(false)
    expect(isValidShortcut('Has Space')).toBe(false)
    expect(isValidShortcut('/slash')).toBe(false)
  })
})

describe('extractSlashQuery', () => {
  it('opens on a lone leading slash token', () => {
    expect(extractSlashQuery('/')).toBe('')
    expect(extractSlashQuery('/ref')).toBe('ref')
    expect(extractSlashQuery('/REF')).toBe('ref')
  })

  it('stays closed for slashes that are part of real text', () => {
    expect(extractSlashQuery('9/10 would recommend')).toBeNull()
    expect(extractSlashQuery('see https://example.com')).toBeNull()
    expect(extractSlashQuery('/hours and also')).toBeNull()
    expect(extractSlashQuery('')).toBeNull()
  })
})

describe('filterCannedReplies', () => {
  const replies = [
    reply({ shortcut: 'hours', title: 'Opening hours', usage_count: 1 }),
    reply({ shortcut: 'hold', title: 'Please hold', usage_count: 9 }),
    reply({ shortcut: 'refund', title: 'Refund policy', body: 'Within 30 days.' }),
  ]

  it('ranks exact shortcut above prefix above body match', () => {
    const result = filterCannedReplies(replies, 'ho')
    expect(result.map((r) => r.shortcut)).toEqual(['hold', 'hours'])
  })

  it('puts an exact shortcut match first regardless of usage', () => {
    expect(filterCannedReplies(replies, 'hours')[0].shortcut).toBe('hours')
  })

  it('matches on title and body text too', () => {
    expect(filterCannedReplies(replies, '30 days').map((r) => r.shortcut)).toEqual([
      'refund',
    ])
  })

  it('returns everything, most-used first, for an empty query', () => {
    expect(filterCannedReplies(replies, '').map((r) => r.shortcut)).toEqual([
      'hold',
      'hours',
      'refund',
    ])
  })

  it('honours the result limit', () => {
    expect(filterCannedReplies(replies, '', 2)).toHaveLength(2)
  })
})

describe('renderCannedBody', () => {
  it('substitutes known placeholders case-insensitively', () => {
    expect(renderCannedBody('Hi {{Name}}, we called {{phone}}.', {
      name: 'Asha',
      phone: '+91999',
    })).toBe('Hi Asha, we called +91999.')
  })

  it('leaves unknown or empty placeholders visible rather than blanking them', () => {
    expect(renderCannedBody('Order {{order_id}} for {{name}}', { name: '' })).toBe(
      'Order {{order_id}} for {{name}}'
    )
  })
})
