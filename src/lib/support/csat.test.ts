import { describe, it, expect } from 'vitest'
import {
  parseCsatReply,
  csatSections,
  averageScore,
  satisfactionRate,
  CSAT_OPTIONS,
} from './csat'

describe('parseCsatReply', () => {
  it('parses valid scores', () => {
    expect(parseCsatReply('csat:1')).toBe(1)
    expect(parseCsatReply('csat:5')).toBe(5)
  })

  it('rejects ids that are not surveys', () => {
    expect(parseCsatReply('flow:step-2')).toBeNull()
    expect(parseCsatReply(null)).toBeNull()
    expect(parseCsatReply(undefined)).toBeNull()
  })

  it('rejects out-of-range and non-integer scores from a tampered reply', () => {
    expect(parseCsatReply('csat:0')).toBeNull()
    expect(parseCsatReply('csat:6')).toBeNull()
    expect(parseCsatReply('csat:4.5')).toBeNull()
    expect(parseCsatReply('csat:')).toBeNull()
    expect(parseCsatReply('csat:abc')).toBeNull()
  })
})

describe('csatSections', () => {
  it('emits one section covering the whole 1-5 scale', () => {
    const [section] = csatSections()
    expect(section.rows).toHaveLength(5)
    expect(section.rows.map((r) => r.id)).toEqual([
      'csat:5',
      'csat:4',
      'csat:3',
      'csat:2',
      'csat:1',
    ])
  })

  it('keeps every row title inside Meta’s 24-character limit', () => {
    for (const row of csatSections()[0].rows) {
      expect(row.title.length).toBeLessThanOrEqual(24)
    }
  })

  it('round-trips every option id back to its score', () => {
    for (const option of CSAT_OPTIONS) {
      expect(parseCsatReply(`csat:${option.score}`)).toBe(option.score)
    }
  })
})

describe('averageScore', () => {
  it('averages to one decimal place', () => {
    expect(averageScore([5, 4, 4])).toBe(4.3)
    expect(averageScore([5])).toBe(5)
  })

  it('is null with no responses rather than zero', () => {
    expect(averageScore([])).toBeNull()
  })
})

describe('satisfactionRate', () => {
  it('counts 4s and 5s as satisfied', () => {
    expect(satisfactionRate([5, 4, 3, 1])).toBe(50)
    expect(satisfactionRate([1, 2, 3])).toBe(0)
  })

  it('is null with no responses', () => {
    expect(satisfactionRate([])).toBeNull()
  })
})
