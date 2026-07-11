import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
// Stress override: table regimes are stable by design; non-table regimes always return quality.

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-deep-stress-"))
const claudeDir = join(sandbox, ".claude")
mkdirSync(join(claudeDir, "scratch"), { recursive: true })
process.env.HOME = sandbox
process.env.VIBEOS_HOME = claudeDir

writeFileSync(join(claudeDir, "model-tiers.json"), JSON.stringify({
  trinity: { brain: { oc: "test/brain" }, medium: { oc: "test/medium" }, cheap: { oc: "test/cheap" } },
  selection: { enabled: true, active_slot: "medium" },
}))

const HIGH_STRESS = 2.0
const LOW_STRESS = 0.3

const AUTO_MODE_BY_REGIME = {
  AUDIT: "audit", FORENSIC: "forensic", LOOPING: "quality",
  CONVERGING: "quality", CLOSED: "quality", IMPLEMENTING: "quality",
  RESEARCH: "longrun", DESIGNING: "longrun", REVIEWING: "audit",
}

const NON_TABLE_REGIMES = ["INIT", "DIVERGENT", "EXPLORING", "REFINING"]
const TABLE_REGIMES = Object.keys(AUTO_MODE_BY_REGIME)

test("non-table regimes: autoSelectMode returns quality at any stress level", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  for (const r of NON_TABLE_REGIMES) {
    const low = tc.autoSelectMode(r, LOW_STRESS)
    const high = tc.autoSelectMode(r, HIGH_STRESS)
    assert.equal(low, "quality", `${r} low stress → quality`)
    assert.equal(high, "quality", `${r} high stress → quality`)
  }
})

test("table regimes: autoSelectMode returns their natural mode regardless of stress", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  for (const r of TABLE_REGIMES) {
    const natural = AUTO_MODE_BY_REGIME[r]
    const low = tc.autoSelectMode(r, LOW_STRESS)
    const high = tc.autoSelectMode(r, HIGH_STRESS)
    assert.equal(low, natural, `${r} low stress → ${natural}`)
    assert.equal(high, natural, `${r} high stress → ${natural} (stress does NOT override table)`)
  }
})

test("stress override boundary: exactly 1.5 does NOT trigger quality for non-table regimes", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  for (const r of NON_TABLE_REGIMES) {
    const mode = tc.autoSelectMode(r, 1.5)
    assert.equal(mode, "quality", `${r} at stress=1.5 → quality (same as default)`)
  }
})

test("stress override boundary: 1.51 does trigger quality for non-table regimes (redundant)", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  for (const r of NON_TABLE_REGIMES) {
    const mode = tc.autoSelectMode(r, 1.51)
    assert.equal(mode, "quality", `${r} at stress=1.51 → quality`)
  }
})

test("stress override boundary: 1.51 does NOT override table regimes to quality", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  assert.equal(tc.autoSelectMode("RESEARCH", 1.51), "longrun", "RESEARCH stays longrun at high stress")
  assert.equal(tc.autoSelectMode("AUDIT", 1.51), "audit", "AUDIT stays audit at high stress")
  assert.equal(tc.autoSelectMode("FORENSIC", 1.51), "forensic", "FORENSIC stays forensic at high stress")
  assert.equal(tc.autoSelectMode("DESIGNING", 1.51), "longrun", "DESIGNING stays longrun at high stress")
  assert.equal(tc.autoSelectMode("REVIEWING", 1.51), "audit", "REVIEWING stays audit at high stress")
})

test("scoreStress returns numeric, differentiates stressed vs calm", async () => {
  const c = await import("../src/lib/classifiers.js?" + Date.now())
  const low = c.scoreStress("hello")
  const high = c.scoreStress("FUCK THIS BROKEN SHIT WHY WONT THIS WORK FIX IT NOW")
  assert.ok(typeof low === "number", "low stress should be a number")
  assert.ok(typeof high === "number", "high stress should be a number")
  assert.ok(high > low, `high stress ${high} should exceed low stress ${low}`)
})

test("scoreStress returns 0 for empty/null/undefined", async () => {
  const c = await import("../src/lib/classifiers.js?" + Date.now())
  assert.equal(c.scoreStress(""), 0, "empty → 0")
  assert.equal(c.scoreStress(null), 0, "null → 0")
  assert.equal(c.scoreStress(undefined), 0, "undefined → 0")
})

test("scoreStress does not flag common acronyms as caps stress", async () => {
  const c = await import("../src/lib/classifiers.js?" + Date.now())
  const score = c.scoreStress("Please use the API and HTTP endpoints")
  assert.ok(score < 0.5, `Acronyms should not cause stress, got ${score}`)
})

test("all 13 regimes produce CVs regardless of stress level", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  const ALL = ["INIT", "DIVERGENT", "EXPLORING", "REFINING", "IMPLEMENTING",
    "RESEARCH", "REVIEWING", "DESIGNING", "CONVERGING", "LOOPING",
    "CLOSED", "FORENSIC", "AUDIT"]
  for (const r of ALL) {
    const cvLow = tc.computeControlVector({ sub_regime: r, latest_stress_multiplier: 0 }, undefined, "auto")
    const cvHigh = tc.computeControlVector({ sub_regime: r, latest_stress_multiplier: 2.0 }, undefined, "auto")
    assert.ok(cvLow, `${r} low stress CV exists`)
    assert.ok(cvHigh, `${r} high stress CV exists`)
  }
})
