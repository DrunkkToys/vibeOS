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

// A contradicted claim (the user directly refuting a claim, or the assistant
// contradicting its own earlier claim) previously got the exact same generic
// "⚠N verify" claimTag as a merely-unverified-so-far claim -- there was no way
// for a user to tell "this hasn't been checked yet" apart from "this was
// caught contradicting itself" just by reading the footer. This is the
// concrete gap behind the "lie detector isn't doing its job" complaint: the
// mechanism detects the contradiction (status: "contradicted") but never
// communicated it distinctly.
test("claim evidence: contradicted claims get a distinct, visible tag from merely-unverified claims", async () => {
  const health = await import("../src/lib/session-health.js?health-claim-tag=" + Date.now())

  const contradicted = health.evaluateClaimEvidence({
    text: "I fixed the bug and verified the release.",
    userText: "It still doesn't work.",
  })
  assert.equal(contradicted.status, "contradicted")
  assert.match(contradicted.claimTag, /contradiction/i, "contradicted claims must say so, not just \"verify\": " + contradicted.claimTag)

  const merelyUnverified = health.evaluateClaimEvidence({
    text: "I fixed the bug and verified the release.",
  })
  assert.equal(merelyUnverified.status, "unsupported")
  assert.doesNotMatch(merelyUnverified.claimTag, /contradiction/i, "an unverified (not contradicted) claim must not claim a contradiction: " + merelyUnverified.claimTag)
  assert.notEqual(contradicted.claimTag, merelyUnverified.claimTag, "contradicted and merely-unverified must render different tags")
})


// Live-reproduced on a real dev machine: a real `npx vitest run
// tests/lru-cache.test.ts` bash call passed genuinely (7/7 tests, real
// output shown), and its own commit implemented a real feature (98 lines of
// implementation, 86 lines of tests) -- yet the "All 7 tests pass" claim
// came back status:"unsupported" with claimTag "⚠2 verify". Root cause was
// semantic-observer.ts's deriveTags reading the exit code from
// output.exitCode/statusCode/code, none of which exist on OpenCode's real
// bash tool output shape (the real field is output.metadata.exit) -- so the
// session event was recorded with exitCode:null forever, and
// verificationEvidenceFromEvents (which requires exitCode === 0, no text
// fallback) never counted a real passing test run as evidence.
test("claim evidence: a real passing verification event (exitCode 0) makes a test-backed claim supported", async () => {
  const { appendFileSync, mkdirSync } = await import("node:fs")
  const eventsDir = join(vibeHome, "session-events")
  mkdirSync(eventsDir, { recursive: true })
  appendFileSync(join(eventsDir, "sid-health-verified.jsonl"), JSON.stringify({
    tool: "bash",
    role: "verification",
    family: "test",
    at: Date.now(),
    isGuardBreach: false,
    isProtectedTarget: false,
    exitCode: 0,
  }) + "\n")

  const health = await import("../src/lib/session-health.js?health-verified-claim=" + Date.now())
  const result = health.evaluateClaimEvidence({
    text: "All 7 tests pass.",
    sessionId: "sid-health-verified",
  })
  assert.equal(result.status, "supported", "a real exitCode:0 verification event must make the claim supported: " + JSON.stringify(result))
  assert.equal(result.claimTag, "✓ evidence")
})
