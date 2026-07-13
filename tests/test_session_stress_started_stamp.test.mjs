//
// test_session_stress_started_stamp.test.mjs
// Regression: saveSessionStress() and recordSaving() were state.sessions[sid]
// initializers that didn't stamp started/session_started_at, unlike the other
// initializers in state.ts (recordDelegation, recordCacheSaving, telemetry).
// Since stress scoring and delegation-warn recording both run very early in the
// turn pipeline, either can be the FIRST writer to create a brand-new session's
// disk record -- and because every other writer uses `??=`/`if (!exists)` guards,
// once the session key exists without `started`, it can never be backfilled.
// Live-reproduced via the dashboard: a fresh session's Running Sessions row
// showed "unknown start" for the CURRENT session while every other (older)
// session showed a real timestamp.
import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert"
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"

let _tmpDir, _origHome

function isolateHome() {
  _origHome = process.env.HOME
  _tmpDir = mkdtempSync(join(import.meta.dirname, "../tmp-stress-started-test-"))
  process.env.HOME = _tmpDir
}

function restoreHome() {
  process.env.HOME = _origHome
  if (_tmpDir) { try { rmSync(_tmpDir, { recursive: true, force: true }) } catch {} }
}

let saveSessionStress, recordSaving, getVibeOSHome, _OC_SID

beforeEach(async () => {
  isolateHome()
  const helpers = await import("../src/lib/index-helpers.js")
  const state = await import("../src/lib/state.js")
  saveSessionStress = helpers.saveSessionStress
  recordSaving = helpers.recordSaving
  getVibeOSHome = state.getVibeOSHome
  _OC_SID = state._OC_SID
})

afterEach(() => {
  restoreHome()
})

function readSession() {
  const raw = readFileSync(join(getVibeOSHome(), "delegation-state.json"), "utf-8")
  const data = JSON.parse(raw)
  return data.sessions?.[_OC_SID]
}

describe("session-record initializers stamp started/session_started_at on first write", () => {
  it("saveSessionStress creates a fresh session record with a real started timestamp, not null", () => {
    saveSessionStress(0.05, "none")
    const ses = readSession()
    assert.ok(ses, "session record must exist after saveSessionStress")
    assert.ok(ses.started, "started must be stamped, not left null/undefined")
    assert.ok(!Number.isNaN(Date.parse(ses.started)), "started must be a valid ISO timestamp")
    assert.equal(ses.session_started_at, ses.started)
  })

  it("recordSaving creates a fresh session record with a real started timestamp, not null", () => {
    recordSaving("bash", "delegation enforced", 0.02, { firstWord: "bash" })
    const ses = readSession()
    assert.ok(ses, "session record must exist after recordSaving")
    assert.ok(ses.started, "started must be stamped, not left null/undefined")
    assert.ok(!Number.isNaN(Date.parse(ses.started)), "started must be a valid ISO timestamp")
    assert.equal(ses.session_started_at, ses.started)
  })
})
