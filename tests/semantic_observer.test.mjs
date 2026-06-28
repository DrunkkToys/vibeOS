// SPDX-License-Identifier: MIT
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const SANDBOX = mkdtempSync(join(tmpdir(), 'semantic-observer-'))
const vibeHome = join(SANDBOX, 'vibe-home')
const claudeDir = vibeHome
const fallbackHome = join(SANDBOX, 'home')
mkdirSync(vibeHome, { recursive: true })
mkdirSync(join(vibeHome, 'session-events'), { recursive: true })
writeFileSync(join(vibeHome, 'project-states.json'), JSON.stringify({ sessions: {}, project_hashes: {} }))
process.env.VIBEOS_HOME = vibeHome
process.env.HOME = fallbackHome

const ROOT = join(import.meta.dirname, '..')

function e(tool, role, family, flags) {
  return { tool, role, family, at: Date.now(), isGuardBreach: !!flags?.isGuardBreach, isProtectedTarget: !!flags?.isProtectedTarget, exitCode: flags?.exitCode ?? null }
}

let mod

test('semantic: load module', async () => {
  mod = await import(join(ROOT, 'src/vibeOS-lib/semantic-observer.js'))
  assert.ok(typeof mod.observeToolPattern === 'function')
})

test('semantic: session events stay under VIBEOS_HOME only', async () => {
  if (!mod) mod = await import(join(ROOT, 'src/vibeOS-lib/semantic-observer.js'))
  const sid = 'vibe-home-session-events'
  const expectedPath = join(vibeHome, 'session-events', `${sid}.jsonl`)
  const fallbackPath = join(fallbackHome, '.claude', 'session-events', `${sid}.jsonl`)

  mod.writeEvent(sid, {
    tool: 'bash',
    role: 'mutation',
    family: 'write',
    at: Date.now(),
    isGuardBreach: false,
    isProtectedTarget: false,
    exitCode: 0,
  })

  assert.ok(existsSync(expectedPath), 'session event should be written under VIBEOS_HOME')
  assert.ok(!existsSync(fallbackPath), 'session event should not fall back to HOME/.claude')
})

test('semantic: deriveRole detects mutation for write/edit', () => {
  assert.equal(mod.deriveRole('write', {}, {}), 'mutation')
  assert.equal(mod.deriveRole('edit', {}, {}), 'mutation')
  assert.equal(mod.deriveRole('notebookedit', {}, {}), 'mutation')
  assert.equal(mod.deriveRole('multiedit', {}, {}), 'mutation')
})

test('semantic: deriveRole detects bypass for --no-verify', () => {
  const input = { args: { command: 'git commit --no-verify' } }
  assert.equal(mod.deriveRole('bash', input, {}), 'bypass')
})

test('semantic: deriveRole detects deployment for git push', () => {
  const input = { args: { command: 'git push origin master' } }
  assert.equal(mod.deriveRole('bash', input, {}), 'deployment')
})

test('semantic: FAILURE_BYPASS detected from failure followed by bypass', () => {
  const events = [
    e('bash', 'verification', 'git-commit', { exitCode: 1 }),
    e('bash', 'bypass', 'git-commit', { isGuardBreach: true }),
  ]
  const patterns = mod.detectPatterns(events, 'test-fp')
  assert.ok(patterns.some(p => p.key === 'workflow:bypass-after-failure:git-commit'))
})

test('semantic: GUARD_BREACH detected from isolated bypass', () => {
  const events = [
    e('bash', 'bypass', 'git-commit', { isGuardBreach: true }),
  ]
  const patterns = mod.detectPatterns(events, 'test-fp')
  assert.ok(patterns.some(p => p.key === 'workflow:guard-breach:git-commit'))
})

test('semantic: PROTECTED_CHAIN detected from mutation then bypass then deployment', () => {
  const events = [
    e('write', 'mutation', 'write'),
    e('bash', 'bypass', 'git-commit', { isGuardBreach: true }),
    e('bash', 'deployment', 'git-push', { isProtectedTarget: true }),
  ]
  const patterns = mod.detectPatterns(events, 'test-fp')
  assert.ok(patterns.some(p => p.key === 'workflow:circumvented-review'))
})

test('semantic: repeated git-commit bypasses compact to one friction pattern', async () => {
  const sid = 'guard-coalesce-test'
  const fingerprint = 'fp-coalesce'
  globalThis.__vibeOS_SID = sid
  const base = Date.now()
  mod.writeEvent(sid, { tool: 'bash', role: 'verification', family: 'git-commit', at: base, isGuardBreach: false, isProtectedTarget: false, exitCode: 1 })
  mod.writeEvent(sid, { tool: 'bash', role: 'bypass', family: 'git-commit', at: base + 1_000, isGuardBreach: true, isProtectedTarget: false, exitCode: null })
  mod.writeEvent(sid, { tool: 'bash', role: 'bypass', family: 'git-commit', at: base + 2_000, isGuardBreach: true, isProtectedTarget: false, exitCode: null })
  mod.writeEvent(sid, { tool: 'bash', role: 'bypass', family: 'git-commit', at: base + 3_000, isGuardBreach: true, isProtectedTarget: false, exitCode: null })
  mod.sessionCompact(sid, fingerprint)
  mod.sessionCompact(sid, fingerprint)

  const state = JSON.parse(readFileSync(join(claudeDir, 'project-states.json'), 'utf-8'))
  const friction = state.project_hashes?.[fingerprint]?.userPatterns?.friction || {}
  const entry = friction['workflow:bypass-after-failure:git-commit']
  assert.ok(entry, 'guard-breach friction entry is recorded')
  assert.strictEqual((entry.sessions || []).length, 1, 'repeated bypasses coalesce into one session entry')
  assert.strictEqual(Object.keys(friction).filter((key) => key === 'workflow:bypass-after-failure:git-commit').length, 1, 'only one friction key is stored')
})

test('semantic: sessionCompact writes an explicit loop reason and next action', async () => {
  const sid = 'guard-loop-test'
  const fingerprint = 'fp-loop'
  globalThis.__vibeOS_SID = sid
  const bbPath = join(claudeDir, 'blackbox-state.json')
  writeFileSync(bbPath, JSON.stringify({
    enabled: true,
    sessions: {
      [sid]: {
        sessionId: sid,
        sub_regime: 'LOOPING',
        resolution_state: 'unresolved',
      },
    },
  }, null, 2))
  mod.writeEvent(sid, { tool: 'bash', role: 'verification', family: 'git-commit', at: Date.now(), isGuardBreach: false, isProtectedTarget: false, exitCode: 1 })
  mod.writeEvent(sid, { tool: 'bash', role: 'bypass', family: 'git-commit', at: Date.now() + 1000, isGuardBreach: true, isProtectedTarget: false, exitCode: null })
  mod.writeEvent(sid, { tool: 'bash', role: 'bypass', family: 'git-commit', at: Date.now() + 2000, isGuardBreach: true, isProtectedTarget: false, exitCode: null })
  mod.sessionCompact(sid, fingerprint)

  const bb = JSON.parse(readFileSync(bbPath, 'utf-8'))
  const ses = bb.sessions?.[sid] || {}
  assert.equal(ses.resolution_state, 'intervened', 'looping sessions should be marked as intervened')
  assert.ok(String(ses.resolution_reason || '').includes('git-commit') || String(ses.resolution_reason || '').includes('loop'), 'loop reason should be explicit')
  assert.ok(String(ses.live_next_action || '').length > 0, 'looping session should record a next action')
})

test('semantic: sessionCompact recovers from malformed blackbox state when friction patterns exist', async () => {
  const sid = 'guard-loop-malformed'
  const fingerprint = 'fp-loop-malformed'
  globalThis.__vibeOS_SID = sid
  const bbPath = join(claudeDir, 'blackbox-state.json')
  writeFileSync(bbPath, '{ this is not valid json')
  mod.writeEvent(sid, { tool: 'bash', role: 'verification', family: 'git-commit', at: Date.now(), isGuardBreach: false, isProtectedTarget: false, exitCode: 1 })
  mod.writeEvent(sid, { tool: 'bash', role: 'bypass', family: 'git-commit', at: Date.now() + 1000, isGuardBreach: true, isProtectedTarget: false, exitCode: null })
  mod.writeEvent(sid, { tool: 'bash', role: 'bypass', family: 'git-commit', at: Date.now() + 2000, isGuardBreach: true, isProtectedTarget: false, exitCode: null })
  mod.writeEvent(sid, { tool: 'bash', role: 'bypass', family: 'git-commit', at: Date.now() + 3000, isGuardBreach: true, isProtectedTarget: false, exitCode: null })

  assert.doesNotThrow(() => mod.sessionCompact(sid, fingerprint), 'malformed blackbox state should not crash compaction')
  const bb = JSON.parse(readFileSync(bbPath, 'utf-8'))
  const ses = bb.sessions?.[sid] || {}
  assert.equal(ses.resolution_state, 'intervened', 'malformed blackbox should still recover an intervention state')
  assert.ok(String(ses.live_next_action || '').length > 0, 'malformed blackbox should still get a next action')
})

test('semantic: LOOPING compaction falls back to an explicit next action even without detected patterns', async () => {
  const sid = 'guard-loop-fallback'
  const fingerprint = 'fp-loop-fallback'
  globalThis.__vibeOS_SID = sid
  const bbPath = join(claudeDir, 'blackbox-state.json')
  writeFileSync(bbPath, JSON.stringify({
    enabled: true,
    sessions: {
      [sid]: {
        sessionId: sid,
        sub_regime: 'LOOPING',
        resolution_state: 'unresolved',
      },
    },
  }, null, 2))
  mod.writeEvent(sid, { tool: 'bash', role: 'query', family: 'npm-test', at: Date.now(), isGuardBreach: false, isProtectedTarget: false, exitCode: 0 })
  mod.writeEvent(sid, { tool: 'bash', role: 'query', family: 'echo', at: Date.now() + 1000, isGuardBreach: false, isProtectedTarget: false, exitCode: 0 })
  mod.writeEvent(sid, { tool: 'bash', role: 'query', family: 'status', at: Date.now() + 2000, isGuardBreach: false, isProtectedTarget: false, exitCode: 0 })

  mod.sessionCompact(sid, fingerprint)
  const bb = JSON.parse(readFileSync(bbPath, 'utf-8'))
  const ses = bb.sessions?.[sid] || {}
  assert.equal(ses.resolution_state, 'intervened', 'looping session should still be marked intervened without patterns')
  assert.ok(String(ses.live_next_action || '').includes('Review the repeated loop') || String(ses.live_next_action || '').includes('Address friction'), 'looping session should expose a fallback next action')
})

test('semantic: non-looping compaction stays quiet when no friction patterns are detected', async () => {
  const sid = 'guard-quiet-test'
  const fingerprint = 'fp-quiet'
  globalThis.__vibeOS_SID = sid
  const bbPath = join(claudeDir, 'blackbox-state.json')
  writeFileSync(bbPath, JSON.stringify({
    enabled: true,
    sessions: {
      [sid]: {
        sessionId: sid,
        sub_regime: 'EXPLORING',
        resolution_state: 'unresolved',
      },
    },
  }, null, 2))
  mod.writeEvent(sid, { tool: 'bash', role: 'query', family: 'npm-test', at: Date.now(), isGuardBreach: false, isProtectedTarget: false, exitCode: 0 })
  mod.writeEvent(sid, { tool: 'bash', role: 'query', family: 'echo', at: Date.now() + 1000, isGuardBreach: false, isProtectedTarget: false, exitCode: 0 })
  mod.writeEvent(sid, { tool: 'bash', role: 'query', family: 'status', at: Date.now() + 2000, isGuardBreach: false, isProtectedTarget: false, exitCode: 0 })

  mod.sessionCompact(sid, fingerprint)
  const bb = JSON.parse(readFileSync(bbPath, 'utf-8'))
  const ses = bb.sessions?.[sid] || {}
  assert.equal(ses.resolution_state, 'unresolved', 'non-looping session should stay unresolved without friction patterns')
  assert.equal(ses.live_next_action, undefined, 'quiet compaction should not invent a next action')
})

test('semantic: deriveTags correctly identifies protected targets', async () => {
  const modPh = await import(join(ROOT, 'src/lib/pattern-helpers.js'))
  assert.ok(modPh.targetsProtectedBranch('git push origin master'))
  assert.ok(modPh.targetsProtectedBranch('gh pr merge --branch main'))
  assert.ok(!modPh.targetsProtectedBranch('git push origin my-feature'))
})

test('semantic: deriveTags correctly detects bypass flags', async () => {
  const modPh = await import(join(ROOT, 'src/lib/pattern-helpers.js'))
  assert.ok(modPh.hasBypassFlag('git commit --no-verify'))
  assert.ok(modPh.hasBypassFlag('git push --force'))
  assert.ok(!modPh.hasBypassFlag('git commit -m "fix"'))
})

test('semantic: observeToolPattern does not throw from direct module', () => {
  const modSm = mod
  assert.doesNotThrow(() => modSm.observeToolPattern('bash', { args: { command: 'npm test' } }, {}, '/tmp'))
  assert.doesNotThrow(() => modSm.observeToolPattern('write', { args: { filePath: '/tmp/test.ts' } }, {}, '/tmp'))
})

test('semantic: getSessionEventLogPath returns path under VIBEOS_HOME', () => {
  const path = mod.getSessionEventLogPath('test-sid')
  assert.ok(path.startsWith(claudeDir))
  assert.ok(path.endsWith('test-sid.jsonl'))
})

test('semantic: getCurrentSid returns non-empty string', () => {
  const sid = mod.getCurrentSid()
  assert.ok(typeof sid === 'string')
  assert.ok(sid.length > 0)
})

test('semantic: shared pattern store writes one normalized row for repeated updates', async () => {
  const store = await import(join(ROOT, 'src/lib/pattern-store.js?store=' + Date.now()))
  const fp = 'fp-shared-store'
  const first = store.upsertProjectPattern('friction', 'workflow:repeat-fail:bash', 'bash failed repeatedly — possible systematic issue.', {
    fingerprint: fp,
    sessions: ['s1'],
    family: 'bash',
  })
  const second = store.upsertProjectPattern('friction', 'workflow:repeat-fail:bash', 'bash failed repeatedly — possible systematic issue.', {
    fingerprint: fp,
    sessions: ['s2'],
    family: 'bash',
  })

  assert.ok(first)
  assert.ok(second)
  const state = JSON.parse(readFileSync(join(claudeDir, 'project-states.json'), 'utf-8'))
  const row = state.project_hashes?.[fp]?.userPatterns?.friction?.['workflow:repeat-fail:bash']
  assert.ok(row, 'shared pattern row exists')
  assert.equal(row.count, 2, 'shared store increments the same row')
  assert.deepEqual(row.sessions, ['s1', 's2'], 'shared store preserves both sessions')
})

test('semantic: writeEvent and readRecentEvents roundtrip', () => {
  mod.writeEvent('test-rt', { tool: 'bash', role: 'verification', family: 'test', at: Date.now(), isGuardBreach: false, isProtectedTarget: false, exitCode: 0 })
  const events = mod.readRecentEvents('test-rt', 10)
  assert.equal(events.length, 1)
  assert.equal(events[0].tool, 'bash')
  assert.equal(events[0].role, 'verification')
})

test('semantic: flushSessionAnalysis is a no-op', () => {
  assert.doesNotThrow(() => mod.flushSessionAnalysis('test-sid'))
})

test('semantic: event log auto-prunes to 200 events', () => {
  for (let i = 0; i < 250; i++) {
    mod.writeEvent('test-prune', { tool: 'bash', role: 'query', family: 'test', at: Date.now(), isGuardBreach: false, isProtectedTarget: false, exitCode: 0 })
  }
  const events = mod.readRecentEvents('test-prune', 300)
  assert.ok(events.length <= 200)
})
