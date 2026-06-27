import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFooterAlert } from '../shared-footer.js';

describe('buildFooterAlert', () => {
  it('all-clear: returns empty string when nothing is wrong', () => {
    const result = buildFooterAlert({})
    assert.equal(result, '')
  })

  it('all-clear: returns empty string when all fields are clean', () => {
    const result = buildFooterAlert({
      apiDegraded: false,
      liveModel: 'deepseek/deepseek-v4-flash',
      expectedModel: 'deepseek/deepseek-v4-flash',
      lastModelError: '',
    })
    assert.equal(result, '')
  })

  it('slow: returns alert when apiSlow is true', () => {
    const result = buildFooterAlert({ apiSlow: true })
    assert.equal(result, '⚠ api slow')
  })

  it('degraded: returns alert when apiDegraded is true and an error exists', () => {
    const result = buildFooterAlert({ apiDegraded: true, lastModelError: 'fetch failed' })
    assert.equal(result, '⚠ api degraded')
  })

  it('drift: returns alert when live model does not match expected', () => {
    const result = buildFooterAlert({
      liveModel: 'deepseek/deepseek-chat',
      expectedModel: 'deepseek/deepseek-v4-flash',
    })
    assert.equal(result, '⚠ model drift')
  })

  it('unreachable: returns alert when lastModelError contains EHOSTUNREACH', () => {
    const result = buildFooterAlert({ lastModelError: 'fetch failed: EHOSTUNREACH' })
    assert.equal(result, '⚠ model unreachable')
  })

  it('unreachable: returns alert when lastModelError contains ENOTFOUND', () => {
    const result = buildFooterAlert({ lastModelError: 'getaddrinfo ENOTFOUND api.example.com' })
    assert.equal(result, '⚠ model unreachable')
  })

  it('unreachable: returns alert when lastModelError contains ETIMEDOUT', () => {
    const result = buildFooterAlert({ lastModelError: 'connect ETIMEDOUT 1.2.3.4:443' })
    assert.equal(result, '⚠ model unreachable')
  })

  it('combined: renders multiple alerts joined by ·', () => {
    const result = buildFooterAlert({
      apiDegraded: true,
      lastModelError: 'fetch failed',
      liveModel: 'deepseek/deepseek-chat',
      expectedModel: 'deepseek/deepseek-v4-flash',
    })
    assert.equal(result, '⚠ api degraded · ⚠ model drift')
  })

  it('no throw: returns empty string on undefined input', () => {
    assert.doesNotThrow(() => buildFooterAlert(undefined as any))
  })

  it('no throw: returns empty string on null input', () => {
    assert.doesNotThrow(() => buildFooterAlert(null as any))
    assert.equal(buildFooterAlert(null as any), '')
  })
})
