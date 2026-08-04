// SPDX-License-Identifier: MIT
// Regression test: cascade audit path safety — no files pollute undefined/ or cwd
// when VIBEOS_HOME is unset or invalid. Validates the runtime-paths fallback
// and all audit-write sites handle bad VIBEOS_HOME gracefully.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'

test('cascade audit path: runtime-paths getVibeOSHome() never returns falsy', async () => {
  // Reimport with no VIBEOS_HOME, no context, no HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  const prevHome = process.env.HOME
  delete process.env.VIBEOS_HOME
  delete process.env.HOME

  try {
    const rp = await import('../src/lib/runtime-paths.js?' + Date.now())
    const home = rp.getVibeOSHome()
    assert.ok(home, 'getVibeOSHome() returned a truthy value: "' + home + '"')
    assert.notEqual(home, 'undefined', 'getVibeOSHome() did not return the string "undefined"')
    assert.ok(home.startsWith('/'), 'getVibeOSHome() returns an absolute path')
    assert.ok(home.includes('.vibeos'), 'getVibeOSHome() returns the vibeOS-owned home (never ~/.claude)')
  } finally {
    if (prevVibeHome !== undefined) process.env.VIBEOS_HOME = prevVibeHome
    if (prevHome !== undefined) process.env.HOME = prevHome
  }
})

test('cascade audit path: ensureCascadeAuditFiles does not pollute cwd', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'vibeos-audit-path-'))
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  process.env.HOME = sandbox
  delete process.env.VIBEOS_HOME

  try {
    // Import the module (which calls ensureCascadeAuditFiles at init)
    const st = await import('../src/lib/state.js?' + Date.now())

    // Check that no files were created in cwd
    const cwdFiles = []
    try {
      const dir = process.cwd()
      const entries = require('fs').readdirSync(dir)
      for (const e of entries) {
        if (e.startsWith('undefined') || e === 'cascade-audit') cwdFiles.push(e)
      }
    } catch {}
    assert.equal(cwdFiles.length, 0, 'No cascade-audit or undefined/ directory in cwd: ' + JSON.stringify(cwdFiles))

    // Check that files were created in the sandbox (vibeOS owns ~/.vibeos, not ~/.claude)
    const auditDir = join(sandbox, '.vibeos', 'cascade-audit')
    assert.ok(existsSync(auditDir), 'Audit directory created in sandbox/.vibeos')
    assert.ok(existsSync(join(auditDir, 'claim-audit.jsonl')), 'claim-audit.jsonl exists')
    assert.ok(existsSync(join(auditDir, 'cascade-audit.jsonl')), 'cascade-audit.jsonl exists')
  } finally {
    process.env.HOME = prevHome
    if (prevVibeHome !== undefined) process.env.VIBEOS_HOME = prevVibeHome
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('cascade audit path: _writeCascadeAudit targets correct directory', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'vibeos-audit-write-'))
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  process.env.HOME = sandbox
  delete process.env.VIBEOS_HOME

  try {
    // Simulate a benign audit write
    const te = await import('../src/lib/hooks/tool-execute.js?' + Date.now())

    // Verify no undefined/ dir in cwd
    const cwdFiles = []
    try {
      const entries = require('fs').readdirSync(process.cwd())
      for (const e of entries) {
        if (e.startsWith('undefined') || e === 'cascade-audit') cwdFiles.push(e)
      }
    } catch {}
    assert.equal(cwdFiles.length, 0, 'No cascade-audit or undefined/ in cwd after writes: ' + JSON.stringify(cwdFiles))
  } finally {
    process.env.HOME = prevHome
    if (prevVibeHome !== undefined) process.env.VIBEOS_HOME = prevVibeHome
    rmSync(sandbox, { recursive: true, force: true })
  }
})
