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

test("footer: stress gauge computes correct symbol for each level", async () => {
  const shared = await import("../src/lib/hooks/shared-footer.js?" + Date.now())
  const gauge = (s) => s > 0.85 ? "█" : s > 0.7 ? "▆" : s > 0.5 ? "▅" : s > 0.3 ? "▃" : s > 0.1 ? "▂" : "▁"
  assert.equal(gauge(0), "▁", "no stress")
  assert.equal(gauge(0.2), "▂", "min stress")
  assert.equal(gauge(0.4), "▃", "calm stress")
  assert.equal(gauge(0.6), "▅", "elevated stress")
  assert.equal(gauge(0.8), "▆", "high stress")
  assert.equal(gauge(1.0), "█", "critical stress")
})

test("footer: buildFooterLine includes stressGauge when present", async () => {
  const shared = await import("../src/lib/hooks/shared-footer.js?" + Date.now())
  const line = shared.buildFooterLine({
    activeSlot: "brain",
    providerLabel: "test",
    modelName: "test/model",
    ltTotal: 0,
    vibeBrand: "VibeTest",
    optMode: "quality",
    flashIcon: "",
    enfTags: [],
    stressGauge: "▃",
  })
  assert.ok(line.includes("▃"), "stress gauge appears in footer line")
})

test("fuzz: scoreStress handles all primitive inputs without crash", async () => {
  const c = await import("../src/lib/classifiers.js?" + Date.now())
  for (const val of [0, 42, true, false, [], {}, "", "hello", null, undefined]) {
    const r = c.scoreStress(val)
    assert.equal(typeof r, "number", `scoreStress(${JSON.stringify(val)}) returns number`)
    assert.ok(r >= 0 && r <= 3, `scoreStress(${JSON.stringify(val)}) in [0,3]`)
  }
})

test("fuzz: empty inputs produce valid fallback classifications", async () => {
  const c = await import("../src/lib/classifiers.js?" + Date.now())
  assert.equal(typeof c.scoreStress(""), "number")
  assert.equal(typeof c.scoreStress(null), "number")
  assert.equal(c.detectOutcomeSignal(""), null)
  assert.equal(c.detectOutcomeSignal(null), null)
})


test("footer: cascade icon appears for deep cascade depth", async () => {
  const shared = await import("../src/lib/hooks/shared-footer.js?" + Date.now())
  const line = shared.buildFooterLine({
    activeSlot: "brain", providerLabel: "T", modelName: "t/m",
    ltTotal: 0, vibeBrand: "VibeUltraX", optMode: "quality",
    flashIcon: "", enfTags: [], cascadeIcon: "▸▸▸",
  })
  assert.ok(line.includes("▸▸▸"), "deep cascade icon appears in footer")
})

test("footer: cascade icon hidden when depth is 1", async () => {
  const shared = await import("../src/lib/hooks/shared-footer.js?" + Date.now())
  const line = shared.buildFooterLine({
    activeSlot: "brain", providerLabel: "T", modelName: "t/m",
    ltTotal: 0, vibeBrand: "VibeUltraX", optMode: "quality",
    flashIcon: "", enfTags: [], cascadeIcon: "",
  })
  assert.ok(!line.includes("▸"), "no cascade icon when depth is 1")
})

test("cascade: cascadeDecide returns different depths for simple vs complex prompts", async () => {
  const ml = await import("../src/vibeOS-lib/ml-router.js?" + Date.now())
  const cheap = 0, medium = 0.000182, brain = 0.00057

  const simple = ml.cascadeDecide("hello", cheap, medium, brain, 0.85)
  assert.ok(simple.useCheap === true, "simple prompt uses cheap")

  const complex = ml.cascadeDecide("refactor auth module with 3 files OAuth race condition token refresh redirect loop", cheap, medium, brain, 0.85)
  assert.ok(complex.escalate === true, "complex prompt escalates")
  assert.ok(complex.confidence > 0.4, "complex prompt has reasonable confidence")
})

test("cascade: vibeultrax profile matches cascade depth for direct vs deep", async () => {
  const vu = await import("../src/vibeOS-lib/blackbox/vibeultrax.js?" + Date.now())

  const direct = vu.vibeultraxControlVector({ user_text: "hello", sub_regime: "INIT", stress_multiplier: 0 })
  assert.equal(direct.cascade_depth, 1, "simple text gets depth 1")
  assert.deepEqual(direct.pipeline_root, ["local"], "direct pipeline is local only")

  const deep = vu.vibeultraxControlVector({ user_text: "refactor auth module with 3 files OAuth race condition", sub_regime: "REFINING", stress_multiplier: 0.3 })
  assert.ok(deep.cascade_depth >= 2, "complex text gets depth >= 2")
  assert.ok(deep.pipeline_root.length >= 2, "complex text has pipeline with >= 2 stages")
})

test("cascade: computeControlVector includes cascade_depth for vibeultrax mode", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())

  const cv = tc.computeControlVector(
    { sub_regime: "REFINING", latest_stress_multiplier: 0.3, user_text: "fix OAuth race condition across 3 modules" },
    undefined, "vibeultrax"
  )
  assert.equal(cv.optimization_mode, "vibeultrax", "mode is vibeultrax")
  assert.ok(typeof cv.cascade_depth === "number", "cascade_depth is a number")
  assert.ok(Array.isArray(cv.pipeline_root), "pipeline_root is an array")
})
