// SPDX-License-Identifier: MIT
// End-to-end ML pipeline integration test
// Verifies: regime -> mode -> tier -> selection -> footer display
import { test } from "node:test"
import assert from "node:assert/strict"

const turn = await import("../src/lib/turn-classify.js?pipeline=" + Date.now())

// ── Phase 1: classifyTurnSimple – intent detection ──
test("classifyTurnSimple: 'hi' -> INIT", () => {
  assert.equal(turn.classifyTurnSimple("hi"), "INIT")
})
test("classifyTurnSimple: 'what is python' -> EXPLORING", () => {
  assert.equal(turn.classifyTurnSimple("what is python"), "EXPLORING")
})
test("classifyTurnSimple: 'write hello world' -> REFINING", () => {
  assert.equal(turn.classifyTurnSimple("write hello world"), "REFINING")
})
test("classifyTurnSimple: 'fix this production bug' -> REFINING", () => {
  assert.equal(turn.classifyTurnSimple("fix this production bug"), "REFINING")
})

// ── Phase 2: autoSelectMode – regime -> mode ──
test("autoSelectMode: EXPLORING + 0 stress -> litex", () => {
  assert.equal(turn.autoSelectMode("EXPLORING", 0), "vibelitex")
})
test("autoSelectMode: REFINING + 0 stress -> litex", () => {
  assert.equal(turn.autoSelectMode("REFINING", 0), "vibelitex")
})
test("autoSelectMode: CONVERGING + 0 stress -> quality", () => {
  assert.equal(turn.autoSelectMode("CONVERGING", 0), "quality")
})
test("autoSelectMode: IMPLEMENTING + 0 stress -> quality", () => {
  assert.equal(turn.autoSelectMode("IMPLEMENTING", 0), "quality")
})
test("autoSelectMode: RESEARCH + 0 stress -> longrun", () => {
  assert.equal(turn.autoSelectMode("RESEARCH", 0), "longrun")
})
test("autoSelectMode: LOOPING + 0 stress -> speed", () => {
  assert.equal(turn.autoSelectMode("LOOPING", 0), "speed")
})
test("autoSelectMode: DIVERGENT + 1.8 stress -> quality (override)", () => {
  assert.equal(turn.autoSelectMode("DIVERGENT", 1.8), "quality")
})

// ── Phase 3: resolveOptimizationMode – respects branded modes ──
test("resolveOptimizationMode: vibeqmax + EXPLORING -> passes through directly = vibeqmax", () => {
  assert.equal(turn.resolveOptimizationMode("EXPLORING", 0, "vibeqmax"), "vibeqmax")
})
test("resolveOptimizationMode: vibeqmax + CONVERGING -> passes through directly = vibeqmax", () => {
  assert.equal(turn.resolveOptimizationMode("CONVERGING", 0, "vibeqmax"), "vibeqmax")
})
test("resolveOptimizationMode: vibeultrax + EXPLORING -> passes through directly = vibeultrax", () => {
  assert.equal(turn.resolveOptimizationMode("EXPLORING", 0, "vibeultrax"), "vibeultrax")
})
test("selectOptimizationModeRemote: manual branded mode bypasses remote selector", async () => {
  assert.equal(await turn.selectOptimizationModeRemote("EXPLORING", 0, "vibeqmax"), "vibeqmax")
})

// ── Phase 4: computeControlVector – mode + regime -> tier_bias ──
test("computeControlVector: EXPLORING + budget -> tier_bias cheap", () => {
  const cv = turn.computeControlVector({ sub_regime: "EXPLORING", latest_stress_multiplier: 0 }, undefined, "budget")
  assert.equal(cv.tier_bias, "cheap")
  assert.ok(cv.optimization_mode, "should have optimization_mode")
})
test("computeControlVector: REFINING + budget -> tier_bias medium", () => {
  const cv = turn.computeControlVector({ sub_regime: "REFINING", latest_stress_multiplier: 0 }, undefined, "budget")
  assert.equal(cv.tier_bias, "medium")
})
test("computeControlVector: CONVERGING + quality -> tier_bias brain", () => {
  const cv = turn.computeControlVector({ sub_regime: "CONVERGING", latest_stress_multiplier: 0 }, undefined, "quality")
  assert.equal(cv.tier_bias, "brain")
})
test("computeControlVector: DIVERGENT + stress 1.8 -> tier_bias brain (stress override)", () => {
  const cv = turn.computeControlVector({ sub_regime: "DIVERGENT", latest_stress_multiplier: 1.8 }, undefined, "budget")
  assert.equal(cv.tier_bias, "brain")
})

test("computeControlVector: vibeqmax carries a dedicated brain-ml root", () => {
  const cv = turn.computeControlVector({ sub_regime: "REFINING", latest_stress_multiplier: 0 }, undefined, "vibeqmax")
  assert.equal(cv.optimization_mode, "vibeqmax")
  assert.equal(cv.mode_root, "vibeqmax")
  assert.equal(cv.mode_family, "brain-ml")
  assert.equal(Array.isArray(cv.pipeline_root), true)
  assert.equal(cv.pipeline_root.join(","), "brain")
})

test("computeControlVector: vibeultrax carries a dedicated cascade root", () => {
  const cv = turn.computeControlVector({ sub_regime: "REFINING", latest_stress_multiplier: 0 }, undefined, "vibeultrax")
  assert.equal(cv.optimization_mode, "vibeultrax")
  assert.equal(cv.mode_root, "vibeultrax")
  assert.equal(cv.mode_family, "cascade")
  assert.equal(cv.cascade_depth, 3)
})
