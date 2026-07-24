// SPDX-License-Identifier: MIT
// Live-reproduced gap: the claim/cascade cross-check (_checkAndRecordUnsubstantiatedClaims)
// already ran every turn and already knew when an assistant claim had no
// matching cascade-audit run nearby -- it just assigned the result to a
// module-level variable that nothing else in the codebase ever read. A real
// fabricated claim ("Cascade Diagnosis: Healthy... no degradation") never
// surfaced anywhere a human would see it without running `vibe verify-claims`
// by hand. This test proves the check now writes to drift-alerts.jsonl and
// that the footer's alert builder picks it up.

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function withSandbox(name) {
  const sandbox = mkdtempSync(join(tmpdir(), name))
  const vibeHome = join(sandbox, ".claude")
  mkdirSync(vibeHome, { recursive: true })
  const auditDir = join(vibeHome, "cascade-audit")
  mkdirSync(auditDir, { recursive: true })
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = vibeHome
  return {
    sandbox,
    vibeHome,
    auditDir,
    claimFile: join(auditDir, "claim-audit.jsonl"),
    cascadeFile: join(auditDir, "cascade-audit.jsonl"),
    driftFile: join(auditDir, "drift-alerts.jsonl"),
    cleanup() {
      if (prevHome === undefined) delete process.env.HOME
      else process.env.HOME = prevHome
      if (prevVibeHome === undefined) delete process.env.VIBEOS_HOME
      else process.env.VIBEOS_HOME = prevVibeHome
    },
  }
}

test("_checkAndRecordUnsubstantiatedClaims writes drift-alerts.jsonl when a claim has no matching cascade run", async () => {
  const ctx = withSandbox("vibeos-claim-drift-")
  try {
    const idx = await import("../src/index.js?claim-drift-idx=" + Date.now())
    idx.setCurrentSessionId("ses_test_claim_drift_1")
    // A claim that matches CLAIM_PATTERNS (the "healthy / no degradation" pattern)
    // with no nearby cascade-audit run at all -> unsubstantiated. sessionId must
    // match what the code under test resolves via getCurrentSessionId() -- claim
    // entries are now session-scoped so an unrelated session's claims can't bleed
    // into this one's count (see the cross-session leak this test file guards).
    writeFileSync(ctx.claimFile, JSON.stringify({
      ts: new Date().toISOString(),
      sessionId: "ses_test_claim_drift_1",
      claims: [{ text: "Cascade Diagnosis: Healthy, no degradation.", pattern: "status" }],
      totalClaims: 1,
    }) + "\n")

    idx._checkAndRecordUnsubstantiatedClaims()

    assert.equal(existsSync(ctx.driftFile), true, "drift-alerts.jsonl must be created")
    const lines = readFileSync(ctx.driftFile, "utf-8").trim().split("\n").filter(Boolean)
    assert.equal(lines.length, 1)
    const entry = JSON.parse(lines[0])
    assert.equal(entry.count, 1)
    assert.match(entry.claims[0], /no degradation/i)
  } finally {
    ctx.cleanup()
  }
})

test("_checkAndRecordUnsubstantiatedClaims does not write drift-alerts.jsonl when the claim is substantiated by a nearby EXECUTED cascade run", async () => {
  const ctx = withSandbox("vibeos-claim-drift-ok-")
  try {
    const idx = await import("../src/index.js?claim-drift-ok-idx=" + Date.now())
    idx.setCurrentSessionId("ses_test_claim_drift_2")
    const now = new Date().toISOString()
    writeFileSync(ctx.claimFile, JSON.stringify({
      ts: now,
      sessionId: "ses_test_claim_drift_2",
      claims: [{ text: "the feature works now", pattern: "action" }],
      totalClaims: 1,
    }) + "\n")
    writeFileSync(ctx.cascadeFile, JSON.stringify({ _ts: now, answer_empty: false, executed: true }) + "\n")

    idx._checkAndRecordUnsubstantiatedClaims()

    assert.equal(existsSync(ctx.driftFile), false, "no drift alert should be written for a substantiated claim")
  } finally {
    ctx.cleanup()
  }
})

// Live-reproduced (2026-07-15, driven for real in OpenCode Desktop): a plain
// conversational claim with zero tool calls still came out "substantiated"
// because chat-params.ts's _writeChatRouteAudit appends a cascade-audit line
// on every single turn (no `executed` field at all) -- so mere timestamp
// proximity to that routine per-turn write made almost any claim look
// verified, regardless of what actually happened. Only entries with
// executed:true (real ml/backend/task routing decisions) should count.
test("_checkAndRecordUnsubstantiatedClaims ignores a nearby chat-params audit entry (no executed field) as false evidence", async () => {
  const ctx = withSandbox("vibeos-claim-drift-chatparams-")
  try {
    const idx = await import("../src/index.js?claim-drift-chatparams-idx=" + Date.now())
    idx.setCurrentSessionId("ses_test_claim_drift_3")
    const now = new Date().toISOString()
    writeFileSync(ctx.claimFile, JSON.stringify({
      ts: now,
      sessionId: "ses_test_claim_drift_3",
      claims: [{ text: "The bug is fixed and everything is fine now.", pattern: "status" }],
      totalClaims: 1,
    }) + "\n")
    // Shaped exactly like chat-params.ts's _writeChatRouteAudit output: no
    // `executed` field at all.
    writeFileSync(ctx.cascadeFile, JSON.stringify({
      _ts: now,
      source: "chat-params",
      slot: "cheap",
      crossProvider: true,
      alreadyCorrect: false,
    }) + "\n")

    idx._checkAndRecordUnsubstantiatedClaims()

    assert.equal(existsSync(ctx.driftFile), true, "a chat-params entry must not count as substantiation")
    const entry = JSON.parse(readFileSync(ctx.driftFile, "utf-8").trim())
    assert.equal(entry.count, 1)
  } finally {
    ctx.cleanup()
  }
})

// Live-reproduced in a real end-to-end scenario (not a synthetic prompt):
// implement a feature, run real tests (pass), introduce a real bug, run real
// tests (fail, reported honestly), fix the real bug, run real tests (pass).
// The genuinely test-verified "Fixed. All 3 tests pass again" claim showed
// BOTH "unverified claim (N)" AND "check evidence" in the same footer line --
// this drift-alert tag only recognized cascade ROUTING decisions as evidence,
// not real verification-tool exit codes, so it flagged real, tool-verified
// work as unverified. evaluateClaimEvidence (session-health.ts) already
// checks the right signals and is wired into claimTag; this second,
// contradictory tag was retired from the automatic footer.
test("buildFooterAlert no longer surfaces the retired unverified-claim drift tag", async () => {
  const ctx = withSandbox("vibeos-claim-drift-footer-")
  try {
    writeFileSync(ctx.driftFile, JSON.stringify({
      ts: new Date().toISOString(),
      count: 2,
      claims: ["Cascade Diagnosis: Healthy, no degradation."],
    }) + "\n")

    const footer = await import("../src/lib/hooks/footer.js?claim-drift-footer-idx=" + Date.now())
    const alert = footer.buildFooterAlert({})
    assert.doesNotMatch(alert, /unverified claim/i)
  } finally {
    ctx.cleanup()
  }
})
