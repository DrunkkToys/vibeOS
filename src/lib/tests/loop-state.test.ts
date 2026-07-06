import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildLoopNoticeSignature, shouldSuppressLoopNotice, reconcileStickyLoopState } from '../loop-state.js'

describe('buildLoopNoticeSignature', () => {
  it('returns empty string for null input', () => {
    assert.equal(buildLoopNoticeSignature(null), '')
  })

  it('returns empty string for undefined input', () => {
    assert.equal(buildLoopNoticeSignature(undefined), '')
  })

  it('returns a deterministic JSON hash for a valid record', () => {
    const sig1 = buildLoopNoticeSignature({ sub_regime: 'LOOPING', resolution: 'looping' })
    const sig2 = buildLoopNoticeSignature({ sub_regime: 'LOOPING', resolution: 'looping' })
    assert.equal(sig1, sig2)
    assert.ok(sig1.length > 0)
  })

  it('different records produce different signatures', () => {
    const sig1 = buildLoopNoticeSignature({ sub_regime: 'LOOPING', resolution: 'loop' })
    const sig2 = buildLoopNoticeSignature({ sub_regime: 'REFINING', resolution: 'unresolved' })
    assert.notEqual(sig1, sig2)
  })

  it('normalizes text fields to uppercase trimmed', () => {
    const sig1 = buildLoopNoticeSignature({ sub_regime: '  looping  ', resolution: ' Looping ' })
    const sig2 = buildLoopNoticeSignature({ sub_regime: 'LOOPING', resolution: 'LOOPING' })
    assert.equal(sig1, sig2)
  })
})

describe('shouldSuppressLoopNotice', () => {
  it('returns suppress=false when current is not looping', () => {
    const result = shouldSuppressLoopNotice({ loop_notice_signature: 'abc' }, { is_looping: false })
    assert.equal(result.suppress, false)
  })

  it('returns suppress=false when signature is empty', () => {
    const result = shouldSuppressLoopNotice(null, { is_looping: true })
    assert.equal(result.suppress, false)
  })

  it('returns suppress=true when previous and current signatures match and loop is active', () => {
    const current = { sub_regime: 'LOOPING', resolution: 'looping', is_looping: true }
    const previous = { loop_notice_signature: buildLoopNoticeSignature(current) }
    const result = shouldSuppressLoopNotice(previous, current)
    assert.equal(result.suppress, true)
  })

  it('returns suppress=false when signatures differ', () => {
    const current = { sub_regime: 'LOOPING', resolution: 'loop-a', is_looping: true }
    const previous = { loop_notice_signature: 'different-sig' }
    const result = shouldSuppressLoopNotice(previous, current)
    assert.equal(result.suppress, false)
  })
})

describe('reconcileStickyLoopState', () => {
  it('returns current state when incoming is null', () => {
    const existing = { sub_regime: 'INIT' }
    const result = reconcileStickyLoopState(existing, null)
    assert.equal(result.sub_regime, 'INIT')
  })

  it('returns current state when incoming is undefined', () => {
    const existing = { sub_regime: 'INIT' }
    const result = reconcileStickyLoopState(existing, undefined)
    assert.equal(result.sub_regime, 'INIT')
  })

  it('enters LOOPING regime when API says loop is detected', () => {
    const result = reconcileStickyLoopState({}, { loop_authority: 'api', sub_regime: 'LOOPING' })
    assert.equal(result.sub_regime, 'LOOPING')
    assert.equal(result.is_looping, true)
  })

  it('stays in LOOPING during hold period even with recovery signal', () => {
    const now = 1_000_000_000
    const holdUntil = new Date(now + 60_000).toISOString()
    const existing = {
      loop_authority: 'api',
      sub_regime: 'LOOPING',
      is_looping: true,
      loop_hold_until: holdUntil,
      loop_release_streak: 0,
      decision_source: 'api',
    }
    const incoming = { source: 'api', sub_regime: 'REFINING' }
    const result = reconcileStickyLoopState(existing, incoming, { now })
    assert.equal(result.sub_regime, 'LOOPING')
    assert.equal(result.is_looping, true)
    assert.equal(result.loop_release_streak, 1)
  })

  it('releases after 2 consecutive API recovery signals when hold expired', () => {
    const now = 1_000_000_000
    const existing = {
      loop_authority: 'api',
      sub_regime: 'LOOPING',
      is_looping: true,
      loop_hold_until: new Date(now - 1).toISOString(),
      loop_release_streak: 1,
      decision_source: 'api',
    }
    const incoming = { source: 'api', sub_regime: 'REFINING' }
    const result = reconcileStickyLoopState(existing, incoming, { now })
    assert.equal(result.sub_regime, 'REFINING')
    assert.equal(result.loop_hold_until, null)
    assert.equal(result.loop_release_streak, 0)
  })

  it('advisory-local authority does not enter LOOPING regime', () => {
    const result = reconcileStickyLoopState({}, { loop_authority: 'advisory-local', sub_regime: 'LOOPING' })
    assert.equal(result.is_looping, false)
    assert.notEqual(result.sub_regime, 'LOOPING')
    assert.equal(result.loop_authority, 'advisory-local')
  })

  it('exits local loop when incoming is clean', () => {
    const existing = {
      decision_source: 'local',
      sub_regime: 'LOOPING',
      is_looping: true,
    }
    const incoming = { sub_regime: 'REFINING' }
    const result = reconcileStickyLoopState(existing, incoming)
    assert.equal(result.is_looping, false)
  })

  it('uses options.now for deterministic time testing', () => {
    const now = 42_000_000
    const result = reconcileStickyLoopState({}, { loop_authority: 'api', sub_regime: 'LOOPING' }, { now })
    assert.ok(result.loop_hold_until)
    assert.equal(new Date(result.loop_hold_until).getTime(), now + 10 * 60 * 1000)
  })

  it('uses options.source for source override', () => {
    const result = reconcileStickyLoopState({}, { sub_regime: 'LOOPING' }, { source: 'api' })
    assert.equal(result.sub_regime, 'LOOPING')
    assert.equal(result.is_looping, true)
  })

  it('footer source alone does not trigger a new sticky loop entry (is_looping/authority untouched)', () => {
    const result = reconcileStickyLoopState({}, { source: 'footer', sub_regime: 'LOOPING' })
    assert.equal(result.is_looping, undefined, 'footer-sourced signal must not flip is_looping true itself')
    assert.equal(result.loop_authority, null, 'footer alone carries no loop authority')
    assert.equal(result.loop_hold_until, null)
  })

  it('authoritative-local authority enters LOOPING with local decision_source', () => {
    const result = reconcileStickyLoopState({}, { loop_authority: 'authoritative-local', sub_regime: 'LOOPING' })
    assert.equal(result.sub_regime, 'LOOPING')
    assert.equal(result.is_looping, true)
    assert.equal(result.decision_source, 'local')
    assert.equal(result.loop_hold_until, null)
  })

  it('sticky api loop does not release when hold expired but streak has not reached 2', () => {
    const now = 1_000_000_000
    const existing = {
      loop_authority: 'api',
      sub_regime: 'LOOPING',
      is_looping: true,
      loop_hold_until: new Date(now - 1).toISOString(),
      loop_release_streak: 0,
      decision_source: 'api',
    }
    const incoming = { source: 'api', sub_regime: 'REFINING' }
    const result = reconcileStickyLoopState(existing, incoming, { now })
    assert.equal(result.sub_regime, 'LOOPING', 'still looping, streak only at 1 after this signal')
    assert.equal(result.loop_release_streak, 1)
  })

  it('default branch (no loop, not sticky, not advisory) passes through with normalized decision_source', () => {
    const existing = { sub_regime: 'REFINING', decision_source: 'local' }
    const incoming = { sub_regime: 'CONVERGING', source: 'local' }
    const result = reconcileStickyLoopState(existing, incoming)
    assert.equal(result.sub_regime, 'CONVERGING')
    assert.equal(result.decision_source, 'local')
    assert.equal(result.loop_hold_until, null)
    assert.equal(result.loop_release_streak, 0)
  })
})
