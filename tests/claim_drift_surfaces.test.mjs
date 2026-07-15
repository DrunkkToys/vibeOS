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
    // A claim that matches CLAIM_PATTERNS (the "healthy / no degradation" pattern)
    // with no nearby cascade-audit run at all -> unsubstantiated.
    writeFileSync(ctx.claimFile, JSON.stringify({
      ts: new Date().toISOString(),
      claims: [{ text: "Cascade Diagnosis: Healthy, no degradation.", pattern: "status" }],
      totalClaims: 1,
    }) + "\n")

    const idx = await import("../src/index.js?claim-drift-idx=" + Date.now())
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

test("_checkAndRecordUnsubstantiatedClaims does not write drift-alerts.jsonl when the claim is substantiated by a nearby cascade run", async () => {
  const ctx = withSandbox("vibeos-claim-drift-ok-")
  try {
    const now = new Date().toISOString()
    writeFileSync(ctx.claimFile, JSON.stringify({
      ts: now,
      claims: [{ text: "the feature works now", pattern: "action" }],
      totalClaims: 1,
    }) + "\n")
    writeFileSync(ctx.cascadeFile, JSON.stringify({ _ts: now, answer_empty: false }) + "\n")

    const idx = await import("../src/index.js?claim-drift-ok-idx=" + Date.now())
    idx._checkAndRecordUnsubstantiatedClaims()

    assert.equal(existsSync(ctx.driftFile), false, "no drift alert should be written for a substantiated claim")
  } finally {
    ctx.cleanup()
  }
})

test("buildFooterAlert surfaces a recent unverified-claim drift alert", async () => {
  const ctx = withSandbox("vibeos-claim-drift-footer-")
  try {
    writeFileSync(ctx.driftFile, JSON.stringify({
      ts: new Date().toISOString(),
      count: 2,
      claims: ["Cascade Diagnosis: Healthy, no degradation."],
    }) + "\n")

    const footer = await import("../src/lib/hooks/footer.js?claim-drift-footer-idx=" + Date.now())
    const alert = footer.buildFooterAlert({})
    assert.match(alert, /unverified claim/i)
  } finally {
    ctx.cleanup()
  }
})

test("buildFooterAlert does not repeat the same drift alert on a second call", async () => {
  const ctx = withSandbox("vibeos-claim-drift-dedup-")
  try {
    writeFileSync(ctx.driftFile, JSON.stringify({
      ts: new Date().toISOString(),
      count: 1,
      claims: ["all good, nothing to report"],
    }) + "\n")

    const footer = await import("../src/lib/hooks/footer.js?claim-drift-dedup-idx=" + Date.now())
    const first = footer.buildFooterAlert({})
    const second = footer.buildFooterAlert({})
    assert.match(first, /unverified claim/i)
    assert.doesNotMatch(second, /unverified claim/i)
  } finally {
    ctx.cleanup()
  }
})
