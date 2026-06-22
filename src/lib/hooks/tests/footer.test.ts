import { test, expect, describe, it } from 'vitest';
import { buildFooterAlert } from '../shared-footer';

describe('buildFooterAlert', () => {
  it('all-clear: returns empty string when nothing is wrong', () => {
    const result = buildFooterAlert({})
    expect(result).toBe('')
  })

  it('all-clear: returns empty string when all fields are clean', () => {
    const result = buildFooterAlert({
      apiDegraded: false,
      liveModel: 'deepseek/deepseek-v4-flash',
      expectedModel: 'deepseek/deepseek-v4-flash',
      lastModelError: '',
    })
    expect(result).toBe('')
  })

  it('degraded: returns alert when apiDegraded is true', () => {
    const result = buildFooterAlert({ apiDegraded: true })
    expect(result).toBe('⚠ api degraded')
  })

  it('drift: returns alert when live model does not match expected', () => {
    const result = buildFooterAlert({
      liveModel: 'deepseek/deepseek-chat',
      expectedModel: 'deepseek/deepseek-v4-flash',
    })
    expect(result).toBe('⚠ model drift')
  })

  it('unreachable: returns alert when lastModelError contains EHOSTUNREACH', () => {
    const result = buildFooterAlert({ lastModelError: 'fetch failed: EHOSTUNREACH' })
    expect(result).toBe('⚠ model unreachable')
  })

  it('unreachable: returns alert when lastModelError contains ENOTFOUND', () => {
    const result = buildFooterAlert({ lastModelError: 'getaddrinfo ENOTFOUND api.example.com' })
    expect(result).toBe('⚠ model unreachable')
  })

  it('unreachable: returns alert when lastModelError contains ETIMEDOUT', () => {
    const result = buildFooterAlert({ lastModelError: 'connect ETIMEDOUT 1.2.3.4:443' })
    expect(result).toBe('⚠ model unreachable')
  })

  it('combined: renders multiple alerts joined by ·', () => {
    const result = buildFooterAlert({
      apiDegraded: true,
      liveModel: 'deepseek/deepseek-chat',
      expectedModel: 'deepseek/deepseek-v4-flash',
    })
    expect(result).toBe('⚠ api degraded · ⚠ model drift')
  })

  it('no throw: returns empty string on null/undefined input', () => {
    expect(() => buildFooterAlert(null as any)).not.toThrow()
    expect(() => buildFooterAlert(undefined as any)).not.toThrow()
  })
})
