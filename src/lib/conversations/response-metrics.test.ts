import { describe, it, expect } from 'vitest'
import {
  inboundPatch,
  outboundPatch,
  botOutboundPatch,
  statusChangePatch,
  elapsedSeconds,
  formatDuration,
  waitSeverity,
} from './response-metrics'

const T0 = '2026-08-25T09:00:00.000Z'
const T1 = '2026-08-25T09:00:45.000Z'
const T2 = '2026-08-25T09:30:00.000Z'
const T3 = '2026-08-25T11:00:00.000Z'

describe('inboundPatch', () => {
  it('starts both clocks on a brand-new conversation', () => {
    expect(inboundPatch({}, T0)).toEqual({
      first_inbound_at: T0,
      awaiting_reply_since: T0,
    })
  })

  it('does not reset the wait clock while we already owe a reply', () => {
    const conv = { first_inbound_at: T0, awaiting_reply_since: T0 }
    expect(inboundPatch(conv, T2)).toEqual({})
  })

  it('restarts only the wait clock when the customer writes again after a reply', () => {
    const conv = {
      first_inbound_at: T0,
      first_response_at: T1,
      awaiting_reply_since: null,
    }
    expect(inboundPatch(conv, T2)).toEqual({ awaiting_reply_since: T2 })
  })
})

describe('outboundPatch', () => {
  it('records the first response and clears the wait clock', () => {
    const conv = { first_inbound_at: T0, awaiting_reply_since: T0 }
    expect(outboundPatch(conv, T1)).toEqual({
      awaiting_reply_since: null,
      first_response_at: T1,
      first_response_seconds: 45,
    })
  })

  it('never overwrites an existing first response', () => {
    const conv = {
      first_inbound_at: T0,
      first_response_at: T1,
      first_response_seconds: 45,
      awaiting_reply_since: T2,
    }
    expect(outboundPatch(conv, T3)).toEqual({ awaiting_reply_since: null })
  })

  it('records no response time for an outbound-first thread', () => {
    expect(outboundPatch({}, T1)).toEqual({})
  })

  it('floors clock skew at zero rather than reporting a negative time', () => {
    const conv = { first_inbound_at: T1 }
    expect(outboundPatch(conv, T0).first_response_seconds).toBe(0)
  })
})

describe('botOutboundPatch', () => {
  it('stops the wait clock without claiming a first response', () => {
    expect(botOutboundPatch()).toEqual({ awaiting_reply_since: null })
  })
})

describe('statusChangePatch', () => {
  it('stamps the resolution from the first inbound message', () => {
    const conv = { created_at: T0, first_inbound_at: T0 }
    expect(statusChangePatch(conv, 'closed', T3, 'agent-1')).toEqual({
      resolved_at: T3,
      resolved_by: 'agent-1',
      resolution_seconds: 7200,
      awaiting_reply_since: null,
    })
  })

  it('falls back to created_at when the thread has no inbound message', () => {
    const conv = { created_at: T2 }
    expect(
      statusChangePatch(conv, 'closed', T3, null).resolution_seconds
    ).toBe(5400)
  })

  it('clears a stale resolution when the thread is reopened', () => {
    const conv = { resolved_at: T2, resolution_seconds: 60 }
    expect(statusChangePatch(conv, 'open', T3, 'agent-1')).toEqual({
      resolved_at: null,
      resolved_by: null,
      resolution_seconds: null,
    })
  })

  it('writes nothing when moving between non-closed states', () => {
    expect(statusChangePatch({}, 'pending', T3, 'agent-1')).toEqual({})
  })
})

describe('elapsedSeconds', () => {
  it('measures from the given timestamp', () => {
    expect(elapsedSeconds(T0, T2)).toBe(1800)
  })
  it('is zero when nothing is pending', () => {
    expect(elapsedSeconds(null, T2)).toBe(0)
    expect(elapsedSeconds(undefined, T2)).toBe(0)
  })
})

describe('formatDuration', () => {
  it('formats each unit band with at most two units', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(90)).toBe('1m')
    expect(formatDuration(3600)).toBe('1h')
    expect(formatDuration(11100)).toBe('3h 5m')
    expect(formatDuration(86400)).toBe('1d')
    expect(formatDuration(187200)).toBe('2d 4h')
  })

  it('renders an em dash for a missing figure', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(undefined)).toBe('—')
    expect(formatDuration(NaN)).toBe('—')
  })
})

describe('waitSeverity', () => {
  it('escalates with the length of the wait', () => {
    expect(waitSeverity(0)).toBe('none')
    expect(waitSeverity(600)).toBe('normal')
    expect(waitSeverity(3600)).toBe('warning')
    expect(waitSeverity(5 * 3600)).toBe('critical')
  })
})
