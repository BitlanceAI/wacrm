import { describe, it, expect } from 'vitest'
import { detectOptKeyword } from './opt-out'

describe('detectOptKeyword', () => {
  it('detects bare opt-out keywords regardless of case or padding', () => {
    for (const t of ['stop', 'STOP', '  Stop  ', 'Unsubscribe', 'OPT OUT']) {
      expect(detectOptKeyword(t)).toBe('opt_out')
    }
  })

  it('detects opt-out keywords wrapped in punctuation or emoji', () => {
    expect(detectOptKeyword('STOP.')).toBe('opt_out')
    expect(detectOptKeyword('stop!')).toBe('opt_out')
    expect(detectOptKeyword('“unsubscribe”')).toBe('opt_out')
  })

  it('detects multi-word opt-out phrases', () => {
    expect(detectOptKeyword('stop promotions')).toBe('opt_out')
    expect(detectOptKeyword('Do not message me')).toBe('opt_out')
  })

  it('detects opt-in keywords', () => {
    expect(detectOptKeyword('START')).toBe('opt_in')
    expect(detectOptKeyword('subscribe')).toBe('opt_in')
  })

  it('ignores sentences that merely contain the word', () => {
    expect(detectOptKeyword('stop sending me the wrong invoice')).toBeNull()
    expect(detectOptKeyword('can you start my order today please')).toBeNull()
    expect(detectOptKeyword('I want to unsubscribe from the other one')).toBeNull()
  })

  it('ignores empty, whitespace, punctuation-only and missing text', () => {
    expect(detectOptKeyword('')).toBeNull()
    expect(detectOptKeyword('   ')).toBeNull()
    expect(detectOptKeyword('!!!')).toBeNull()
    expect(detectOptKeyword(null)).toBeNull()
    expect(detectOptKeyword(undefined)).toBeNull()
  })
})
