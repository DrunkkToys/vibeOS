// SPDX-License-Identifier: MIT
// Real end-to-end cascade test: full pipeline with state persistence and regime transitions.

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-e2e-cascade-"))
const claudeDir = join(sandbox, ".claude")
mkdirSync(join(claudeDir, "scratch"), { recursive: true })
process.env.HOME = sandbox
process.env.VIBEOS_HOME = claudeDir

writeFileSync(join(claudeDir, "model-tiers.json"), JSON.stringify({
  trinity: { brain: { oc: "test/brain" }, medium: { oc: "test/medium" }, cheap: { oc: "test/cheap" } },
  selection: { enabled: true, active_slot: "medium" },
}))

writeFileSync(join(claudeDir, "delegation-state.json"), JSON.stringify({
  lifetime: {}, sessions: {},
}))

const VALID_REGIMES = ["INIT", "DIVERGENT", "EXPLORING", "REFINING", "CONVERGING", "CLOSED", "LOOPING"]

test("cascade e2e: classify → autoSelectMode → computeControlVector pipeline", async () => {
  const turnClassify = await import("../src/lib/turn-classify.js?" + Date.now())

  const regimes = ["INIT", "EXPLORING", "REFINING", "CONVERGING", "CLOSED", "LOOPING"]
  for (const r of regimes) {
    const cv = turnClassify.computeControlVector(
      { sub_regime: r, latest_stress_multiplier: 0.3 },
      undefined,
      "auto"
    )
    assert.ok(cv, `CV for ${r} exists`)
    assert.ok(typeof cv.optimization_mode === "string", `${r}: optimization_mode`)
    assert.ok(typeof cv.tier_bias === "string", `${r}: tier_bias`)
    assert.ok(typeof cv.thinking_mode === "string", `${r}: thinking_mode`)
    assert.ok(typeof cv.enforcement_mode === "string", `${r}: enforcement_mode`)
    assert.ok(typeof cv.enforcement_reason === "string", `${r}: enforcement_reason`)
  }
})

test("cascade e2e: LOOPING regime produces quality mode", async () => {
  const turnClassify = await import("../src/lib/turn-classify.js?" + Date.now())

  assert.equal(turnClassify.autoSelectMode("LOOPING"), "quality", "LOOPING → quality")

  const cv = turnClassify.computeControlVector(
    { sub_regime: "LOOPING", latest_stress_multiplier: 1.2 },
    undefined,
    "auto"
  )
  assert.equal(cv.optimization_mode, "quality")
  assert.equal(cv.tier_bias, "brain")
  assert.ok(cv.enforcement_reason.includes("LOOPING"), "enforcement_reason mentions LOOPING")
})

test("cascade e2e: stress > 1.5 overrides to quality regardless of regime", async () => {
  const turnClassify = await import("../src/lib/turn-classify.js?" + Date.now())
  assert.equal(turnClassify.autoSelectMode("EXPLORING", 2.0), "quality")

  const cv = turnClassify.computeControlVector(
    { sub_regime: "EXPLORING", latest_stress_multiplier: 2.0 },
    undefined,
    "auto"
  )
  assert.equal(cv.optimization_mode, "quality")
})

test("cascade e2e: detectOutcomeSignal recognizes all three states", async () => {
  const c = await import("../src/lib/classifiers.js?" + Date.now())
  assert.equal(c.detectOutcomeSignal("that works great!"), "positive")
  assert.equal(c.detectOutcomeSignal("still broken"), "negative")
  assert.equal(c.detectOutcomeSignal("what is the capital?"), null)
})

test("cascade e2e: scoreStress differentiates stressed vs calm text", async () => {
  const c = await import("../src/lib/classifiers.js?" + Date.now())
  assert.ok(c.scoreStress("frustrated after 5 attempts!") > 0, "stressed > 0")
  assert.ok(c.scoreStress("explain how this works") <= 0.5, "calm <= 0.5")
})

test("cascade e2e: buildControlHistoryEntry creates valid history records", async () => {
  const turnClassify = await import("../src/lib/turn-classify.js?" + Date.now())
  const cv = turnClassify.computeControlVector(
    { sub_regime: "EXPLORING", latest_stress_multiplier: 0.3 },
    undefined,
    "auto"
  )
  const entry = turnClassify.buildControlHistoryEntry(1, "EXPLORING", cv)
  assert.ok(entry, "entry exists")
  assert.equal(entry.turn, 1, "turn number")
  assert.equal(entry.regime, "EXPLORING", "regime")
  assert.ok(entry.control, "control object")
  assert.equal(entry.control.enforcement_mode, cv.enforcement_mode, "enforcement_mode preserved")
})
