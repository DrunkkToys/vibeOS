// SPDX-License-Identifier: MIT
import { after, test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-session-health-"))
const vibeHome = join(sandbox, ".claude")
const prevHome = process.env.HOME
const prevVibeHome = process.env.VIBEOS_HOME
process.env.HOME = sandbox
process.env.VIBEOS_HOME = vibeHome
mkdirSync(vibeHome, { recursive: true })

after(() => {
  try { process.env.HOME = prevHome } catch {}
  try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})

test("session health: meta-work drift is detected for self-diagnostic loops outside diagnostic requests", async () => {
  const state = await import("../src/lib/state.js?health-state=" + Date.now())
  const health = await import("../src/lib/session-health.js?health=" + Date.now())
  state.setCurrentSessionId("sid-health-meta")

  const snapshot = health.getSessionHealthSnapshot({
    sessionId: "sid-health-meta",
    projectFingerprint: "proj-meta",
    userText: "fix the footer rendering bug",
    assistantText: "Let me check status, audit the runtime state, inspect dashboard signals, and confirm cascade mode again.",
  })

  assert.equal(snapshot.metaWorkDrift, true)
  assert.ok(snapshot.loopSignals.some((signal) => signal.kind === "status_loop" || signal.kind === "audit_loop"))
  assert.equal(existsSync(join(vibeHome, "session-health.jsonl")), true)
})

test("session health: explicit diagnostic requests do not count as accidental drift", async () => {
  const health = await import("../src/lib/session-health.js?health-diagnostic=" + Date.now())
  const snapshot = health.getSessionHealthSnapshot({
    sessionId: "sid-health-diagnostic",
    projectFingerprint: "proj-diagnostic",
    userText: "audit the runtime state and report the dashboard signals",
    assistantText: "I checked status, audited runtime state, and confirmed cascade mode.",
  })

  assert.equal(snapshot.metaWorkDrift, false)
})

test("session health: positive finalize evidence marks decisive progress", async () => {
  const state = await import("../src/lib/state.js?health-finalize-state=" + Date.now())
  const ledger = await import("../src/lib/turn-ledger.js?health-finalize-ledger=" + Date.now())
  const health = await import("../src/lib/session-health.js?health-finalize=" + Date.now())
  state.setCurrentSessionId("sid-health-progress")
  ledger.recordTurnFinalize({
    sessionId: "sid-health-progress",
    turnId: "turn-health-progress",
    finalized: {
      rewardOutcome: "positive",
      finalVisibleModel: "deepseek/v4-flash",
    },
  })

  const snapshot = health.getSessionHealthSnapshot({
    sessionId: "sid-health-progress",
    projectFingerprint: "proj-progress",
    assistantText: "Implemented the fix and verified the result.",
  })

  assert.equal(snapshot.decisiveProgress, true)
})

test("claim evidence: contradiction is reported from user follow-up", async () => {
  const health = await import("../src/lib/session-health.js?health-claims=" + Date.now())
  const result = health.evaluateClaimEvidence({
    text: "I fixed the bug and verified the release.",
    userText: "It still doesn't work.",
  })

  assert.equal(result.status, "contradicted")
  assert.ok(result.contradictedBy.some((item) => /user follow-up/i.test(item)))
})

