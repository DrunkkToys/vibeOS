import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-deep-regime-"))
const claudeDir = join(sandbox, ".claude")
mkdirSync(join(claudeDir, "scratch"), { recursive: true })
process.env.HOME = sandbox
process.env.VIBEOS_HOME = claudeDir

writeFileSync(join(claudeDir, "model-tiers.json"), JSON.stringify({
  trinity: { brain: { oc: "test/brain" }, medium: { oc: "test/medium" }, cheap: { oc: "test/cheap" } },
  selection: { enabled: true, active_slot: "medium" },
}))

const ALL_REGIMES = [
  "INIT", "DIVERGENT", "EXPLORING", "REFINING", "IMPLEMENTING",
  "RESEARCH", "REVIEWING", "DESIGNING", "CONVERGING", "LOOPING",
  "CLOSED", "FORENSIC", "AUDIT",
]

const VALID_TIER = new Set(["cheap", "medium", "brain", "auto"])
const VALID_ENFORCEMENT = new Set(["off", "relaxed", "normal", "strict"])
const VALID_FLOW = new Set(["off", "audit", "normal", "strict"])
const VALID_TDD = new Set(["off", "lazy", "normal", "quality", "strict"])
const VALID_THINKING = new Set(["off", "brief", "full", "auto"])

const EXPECTED_NATURAL_MODE = {
  INIT: "quality", DIVERGENT: "quality", EXPLORING: "quality", REFINING: "quality",
  IMPLEMENTING: "quality", RESEARCH: "longrun", REVIEWING: "audit",
  DESIGNING: "longrun", CONVERGING: "quality", LOOPING: "quality",
  CLOSED: "quality", FORENSIC: "forensic", AUDIT: "audit",
}

test("all 13 sub-regimes produce valid axis bundles", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())

  for (const r of ALL_REGIMES) {
    const bundle = tc.computeAxisBundle(r, "vibeqmax")
    assert.ok(bundle, `${r}: computeAxisBundle returned falsy`)
    assert.ok(VALID_TIER.has(bundle.tier), `${r}: tier=${bundle.tier} invalid`)
    assert.ok(VALID_ENFORCEMENT.has(bundle.enforcement), `${r}: enforcement=${bundle.enforcement} invalid`)
    assert.ok(VALID_FLOW.has(bundle.flow), `${r}: flow=${bundle.flow} invalid`)
    assert.ok(VALID_TDD.has(bundle.tdd), `${r}: tdd=${bundle.tdd} invalid`)
    assert.ok(VALID_THINKING.has(bundle.thinking), `${r}: thinking=${bundle.thinking} invalid`)
    assert.ok(typeof bundle.stress_multiplier === "number" && bundle.stress_multiplier > 0,
      `${r}: stress_multiplier=${bundle.stress_multiplier} invalid`)
    assert.ok(Array.isArray(bundle.flow_focus), `${r}: flow_focus not array`)
    assert.ok(Array.isArray(bundle.tdd_focus), `${r}: tdd_focus not array`)
  }
})

test("REGIME_AXIS_BASE has exactly 13 entries matching ALL_REGIMES", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  const bundle = tc.computeAxisBundle("INIT", "raw")
  assert.ok(bundle, "computeAxisBundle should work for raw mode")
  for (const r of ALL_REGIMES) {
    const raw = tc.computeAxisBundle(r, "raw")
    assert.equal(raw.tier, "brain", `raw mode ${r} tier should be brain`)
    assert.equal(raw.enforcement, "off", `raw mode ${r} enforcement should be off`)
  }
})

test("autoSelectMode returns correct modes per regime (actual behavior)", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  for (const [r, expectedMode] of Object.entries(EXPECTED_NATURAL_MODE)) {
    const mode = tc.autoSelectMode(r, 0.0)
    assert.equal(mode, expectedMode, `${r} → ${expectedMode}, got ${mode}`)
  }
})

test("CV from computeControlVector has all required fields", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  const cv = tc.computeControlVector(
    { sub_regime: "REFINING", latest_stress_multiplier: 0.5 },
    undefined, "auto"
  )
  assert.ok(cv, "CV should exist")
  assert.ok(typeof cv.optimization_mode === "string", "optimization_mode missing")
  assert.ok(typeof cv.tier_bias === "string", "tier_bias missing")
  assert.ok(typeof cv.thinking_mode === "string", "thinking_mode missing")
  assert.ok(typeof cv.enforcement_mode === "string", "enforcement_mode missing")
  assert.ok(typeof cv.enforcement_reason === "string", "enforcement_reason missing")
  assert.ok(typeof cv.flow_mode === "string", "flow_mode missing")
  assert.ok(typeof cv.tdd_mode === "string", "tdd_mode missing")
  assert.ok(typeof cv.stress_multiplier === "number", "stress_multiplier missing")
  assert.ok(typeof cv.outcome_detection === "boolean", "outcome_detection missing")
  assert.ok(Array.isArray(cv.directives), "directives missing")
  assert.ok(Array.isArray(cv.flow_focus), "flow_focus missing")
  assert.ok(Array.isArray(cv.tdd_focus), "tdd_focus missing")
})

test("CV tier_bias is 'brain' for all regimes via auto mode (vibeqmax override)", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  for (const r of ALL_REGIMES) {
    const cv = tc.computeControlVector(
      { sub_regime: r, latest_stress_multiplier: 0.3 },
      undefined, "auto"
    )
    assert.equal(cv.tier_bias, "brain",
      `${r}: CV tier_bias should be brain (vibeqmax overrides base), got ${cv.tier_bias}`)
  }
})

test("computeAxisBundle LOOPING regime applies hardening", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  const bundle = tc.computeAxisBundle("LOOPING", "vibeqmax")
  assert.equal(bundle.enforcement, "strict", "LOOPING enforcement must be strict")
  assert.equal(bundle.flow, "strict", "LOOPING flow must be strict")
  assert.equal(bundle.tdd, "strict", "LOOPING tdd must be strict")
  assert.equal(bundle.tier, "brain", "LOOPING tier must be brain")
  assert.ok(bundle.flow_focus.includes("suggest-alternative"),
    "LOOPING flow_focus must include suggest-alternative")
})

test("computeAxisBundle with axis overrides", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  const bundle = tc.computeAxisBundle("EXPLORING", "vibeqmax", { tier: "brain" })
  assert.equal(bundle.tier, "brain", "override tier=brain should work")
  const bundle2 = tc.computeAxisBundle("EXPLORING", "vibeqmax", { thinking: "full" })
  assert.equal(bundle2.thinking, "full", "override thinking=full should work")
})

test("buildAxisDirectives generates directives for strict regimes", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  const bundle = tc.computeAxisBundle("IMPLEMENTING", "vibeqmax")
  const directives = tc.buildAxisDirectives(bundle, "vibeqmax")
  assert.ok(Array.isArray(directives), "directives should be array")
  assert.ok(directives.length > 0, "IMPLEMENTING should produce directives")
  const joined = directives.join(" ")
  assert.ok(joined.includes("strict"), "IMPLEMENTING directives should mention strict")
})

test("buildAxisDirectives returns empty for raw mode", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  const bundle = tc.computeAxisBundle("EXPLORING", "raw")
  const directives = tc.buildAxisDirectives(bundle, "raw")
  assert.equal(directives.length, 0, "raw mode should produce no directives")
})

test("REGIME_AXIS_BASE tiers differ per regime (not all brain)", async () => {
  const tc = await import("../src/lib/turn-classify.js?" + Date.now())
  const base = tc.REGIME_AXIS_BASE
  assert.ok(base, "REGIME_AXIS_BASE should be exported")
  assert.equal(base.INIT.tier, "auto", "INIT base tier is auto")
  assert.equal(base.EXPLORING.tier, "cheap", "EXPLORING base tier is cheap")
  assert.equal(base.IMPLEMENTING.tier, "brain", "IMPLEMENTING base tier is brain")
  assert.equal(base.DIVERGENT.tier, "medium", "DIVERGENT base tier is medium")
})
