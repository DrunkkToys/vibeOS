import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-deep-deescalate-"))
const claudeDir = join(sandbox, ".claude")
mkdirSync(join(claudeDir, "scratch"), { recursive: true })
process.env.HOME = sandbox
process.env.VIBEOS_HOME = claudeDir

writeFileSync(join(claudeDir, "model-tiers.json"), JSON.stringify({
  trinity: { brain: { oc: "test/brain" }, medium: { oc: "test/medium" }, cheap: { oc: "test/cheap" } },
  selection: { enabled: true, active_slot: "medium" },
}))

const NATURAL_MODES = {
  INIT: "quality", DIVERGENT: "quality", EXPLORING: "quality", REFINING: "quality",
  IMPLEMENTING: "quality", RESEARCH: "longrun", REVIEWING: "audit",
  DESIGNING: "longrun", CONVERGING: "quality", LOOPING: "quality",
  CLOSED: "quality", FORENSIC: "forensic", AUDIT: "audit",
}

test("non-table regimes: autoSelectMode always returns quality (stress-independent)", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  for (const r of ["INIT", "DIVERGENT", "EXPLORING", "REFINING"]) {
    const high = tc.autoSelectMode(r, 2.0)
    const low = tc.autoSelectMode(r, 0.0)
    assert.equal(high, low, `${r}: stress level does not change mode`)
    assert.equal(high, "quality", `${r}: always quality`)
  }
})

test("table regimes: mode stays natural at both high and low stress", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  for (const [r, natural] of Object.entries(NATURAL_MODES)) {
    const high = tc.autoSelectMode(r, 2.0)
    const low = tc.autoSelectMode(r, 0.0)
    assert.equal(high, natural, `${r} high stress → ${natural}`)
    assert.equal(low, natural, `${r} low stress → ${natural}`)
    assert.equal(high, low, `${r}: stress does not change mode`)
  }
})

test("resolveOptimizationSlot maps modes to correct tiers", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  assert.equal(tc.resolveOptimizationSlot("quality"), "brain")
  assert.equal(tc.resolveOptimizationSlot("speed"), "medium")
  assert.equal(tc.resolveOptimizationSlot("longrun"), "brain")
  assert.equal(tc.resolveOptimizationSlot("budget"), "cheap")
  assert.equal(tc.resolveOptimizationSlot("balanced"), "cheap")
  assert.equal(tc.resolveOptimizationSlot("audit"), "brain")
  assert.equal(tc.resolveOptimizationSlot("forensic"), "brain")
})

test("explicit mode override bypasses autoSelectMode (no de-escalation needed)", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  assert.equal(tc.resolveOptimizationMode("RESEARCH", 2.0, "budget"), "budget",
    "explicit budget not overridden")
  assert.equal(tc.resolveOptimizationMode("AUDIT", 2.0, "speed"), "speed",
    "explicit speed not overridden")
})

test("autoSelectMode with 'auto' optimization delegates to mode selection", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  assert.equal(tc.resolveOptimizationMode("RESEARCH", 0, "auto"), "longrun", "RESEARCH auto → longrun")
  assert.equal(tc.resolveOptimizationMode("RESEARCH", 2.0, "auto"), "longrun", "RESEARCH high stress auto → longrun")
  assert.equal(tc.resolveOptimizationMode("INIT", 0, "auto"), "quality", "INIT auto → quality")
})

test("computeAxisBundle stress_multiplier scales with stress level", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  const lowBundle = tc.computeAxisBundle("EXPLORING", "vibeqmax", {}, 0)
  const highBundle = tc.computeAxisBundle("EXPLORING", "vibeqmax", {}, 2)
  assert.ok(typeof lowBundle.stress_multiplier === "number", "low stress_multiplier is number")
  assert.ok(typeof highBundle.stress_multiplier === "number", "high stress_multiplier is number")
})

test("LOOPING regime stress_multiplier is hard-capped at 2.0 minimum", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  const bundle = tc.computeAxisBundle("LOOPING", "vibeqmax", {}, 0)
  assert.ok(bundle.stress_multiplier >= 2.0, `LOOPING stress_multiplier >= 2.0, got ${bundle.stress_multiplier}`)
})

test("all 13 regimes produce valid CVs at both stress extremes", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  const ALL = ["INIT", "DIVERGENT", "EXPLORING", "REFINING", "IMPLEMENTING",
    "RESEARCH", "REVIEWING", "DESIGNING", "CONVERGING", "LOOPING",
    "CLOSED", "FORENSIC", "AUDIT"]
  for (const r of ALL) {
    const cvLow = tc.computeControlVector({ sub_regime: r, latest_stress_multiplier: 0 }, undefined, "auto")
    const cvHigh = tc.computeControlVector({ sub_regime: r, latest_stress_multiplier: 2.0 }, undefined, "auto")
    assert.ok(cvLow?.tier_bias, `${r} low stress CV has tier_bias`)
    assert.ok(cvHigh?.tier_bias, `${r} high stress CV has tier_bias`)
    assert.ok(typeof cvLow?.enforcement_mode === "string", `${r} low stress CV has enforcement_mode`)
    assert.ok(typeof cvHigh?.enforcement_mode === "string", `${r} high stress CV has enforcement_mode`)
  }
})
