// SPDX-License-Identifier: MIT
// Fast contract + fuzz tests for blackbox pipeline. No API calls, no cooldown waits.

import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"

const SANDBOX = mkdtempSync(join(tmpdir(), "vibeos-contract-fuzz-"))
const claudeDir = join(SANDBOX, ".claude")
mkdirSync(claudeDir, { recursive: true })

process.env.HOME = SANDBOX
process.env.VIBEOS_HOME = claudeDir
process.env.VIBEOS_FAST_CI = "1"

writeFileSync(join(claudeDir, "model-tiers.json"), JSON.stringify({
  trinity: { brain: { oc: "test/brain" }, medium: { oc: "test/medium" }, cheap: { oc: "test/cheap" } },
  selection: { enabled: true, active_slot: "medium", delegation_enforce: true, flow_enabled: true, tdd_enabled: true, thinking_level: "off" },
  tiers: { high: { regex: "brain" }, mid: { regex: "medium" }, budget: { regex: ".*" } },
}))

const VALID_REGIMES = ["INIT", "DIVERGENT", "EXPLORING", "REFINING", "CONVERGING", "CLOSED", "LOOPING"]

test("contract: all 7 sub-regimes recognized by autoSelectMode", async () => {
  const mod = await import("../src/lib/turn-classify.js?" + Date.now())
  for (const regime of VALID_REGIMES) {
    const mode = mod.autoSelectMode(regime)
    assert.ok(typeof mode === "string" && mode.length > 0)
  }
})

test("contract: autoSelectMode returns valid mode per regime", async () => {
  const mod = await import("../src/lib/turn-classify.js?" + Date.now())
  const VALID_MODES = ["vibelitex", "vibeqmax", "vibemax", "vibeultrax", "budget", "quality", "speed", "longrun", "audit", "forensic", "balanced"]
  for (const regime of VALID_REGIMES) {
    const mode = mod.autoSelectMode(regime)
    assert.ok(VALID_MODES.includes(mode), `${regime} -> ${mode}`)
  }
})

test("contract: computeControlVector returns required fields", async () => {
  const mod = await import("../src/lib/turn-classify.js?" + Date.now())
  const cv = mod.computeControlVector({ sub_regime: "EXPLORING", latest_stress_multiplier: 0.5 }, undefined, "auto")
  assert.ok(cv, "cv exists")
  assert.ok(typeof cv.optimization_mode === "string")
  assert.ok(typeof cv.tier_bias === "string")
  assert.ok(typeof cv.thinking_mode === "string")
  assert.ok(typeof cv.enforcement_mode === "string")
  
  
  
})

test("contract: stress > 1.5 overrides to quality", async () => {
  const mod = await import("../src/lib/turn-classify.js?" + Date.now())
  assert.equal(mod.autoSelectMode("INIT", 2.0), "quality")
  assert.notEqual(mod.autoSelectMode("INIT", 0.2), "quality")
})

test("fuzz: scoreStress handles non-string input", async () => {
  const mod = await import("../src/lib/classifiers.js?" + Date.now())
  for (const val of [null, undefined, 42, true, [], {}]) {
    const r = mod.scoreStress(val)
    assert.equal(typeof r, "number")
    assert.ok(r >= 0 && r <= 3)
  }
})

test("fuzz: detectOutcomeSignal handles non-string input", async () => {
  const mod = await import("../src/lib/classifiers.js?" + Date.now())
  for (const val of [null, undefined, 42, true, [], {}]) {
    const r = mod.detectOutcomeSignal(val)
    assert.ok(r === null || r === "positive" || r === "negative")
  }
})

test("contract: detectOutcomeSignal recognizes positive/negative", async () => {
  const mod = await import("../src/lib/classifiers.js?" + Date.now())
  for (const p of ["thank you", "that works great", "perfect", "solved it", "much better"]) {
    assert.equal(mod.detectOutcomeSignal(p), "positive", p)
  }
  for (const n of ["still broken", "doesn't work", "wrong answer", "same error again"]) {
    assert.equal(mod.detectOutcomeSignal(n), "negative", n)
  }
})

test("pipeline: REGIME_CONTROL_TABLE covers all regimes", async () => {
  const mod = await import("../src/vibeOS-lib/blackbox/meta-controller.js?" + Date.now())
  const table = mod.REGIME_CONTROL_TABLE || {}
  for (const r of VALID_REGIMES) {
    assert.ok(r in table, `${r} in table`)
    assert.ok(table[r].tier_bias, `${r} has tier_bias`)
  }
})
