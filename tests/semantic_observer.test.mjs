// SPDX-License-Identifier: MIT
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const SANDBOX = mkdtempSync(join(tmpdir(), 'semantic-observer-'))
const claudeDir = join(SANDBOX, '.claude')
mkdirSync(claudeDir, { recursive: true })
mkdirSync(join(claudeDir, 'session-events'), { recursive: true })
writeFileSync(join(claudeDir, 'project-states.json'), JSON.stringify({ sessions: {}, project_hashes: {} }))
process.env.VIBEOS_HOME = claudeDir

const ROOT = join(import.meta.dirname, '..')

function e(tool, role, family, flags) {
  return { tool, role, family, at: Date.now(), isGuardBreach: !!flags?.isGuardBreach, isProtectedTarget: !!flags?.isProtectedTarget, exitCode: flags?.exitCode ?? null }
}

let mod

test('semantic: load module', async () => {
  mod = await import(join(ROOT, 'src/vibeOS-lib/semantic-observer.js'))
  assert.ok(typeof mod.observeToolPattern === 'function')
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
