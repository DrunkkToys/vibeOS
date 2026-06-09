import test from "node:test"
import assert from "node:assert/strict"

const turn = await import("../../lib/turn-classify.js?blackbox-smoke=" + Date.now())

test("blackbox smoke: regime map stays stable", () => {
  assert.equal(turn.autoSelectMode("LOOPING", 0.1), "speed")
  assert.equal(turn.autoSelectMode("CONVERGING", 0.1), "quality")
  assert.equal(turn.autoSelectMode("CLOSED", 0.1), "quality")
  assert.equal(turn.autoSelectMode("INIT", 0.2), "litex")
  assert.equal(turn.autoSelectMode("REFINING", 1.8), "quality")
})

test("blackbox smoke: resolveOptimizationMode — ML drives, explicit modes respected only in fallback", () => {
  assert.equal(turn.resolveOptimizationMode("LOOPING", 0.1, "auto"), "speed")
  assert.equal(turn.resolveOptimizationMode("CONVERGING", 0.1, "auto"), "quality")
  assert.equal(turn.resolveOptimizationMode("DIVERGENT", 0.1, "auto"), "litex")
  assert.equal(turn.resolveOptimizationMode("LOOPING", 0.1, "speed"), "speed")
  assert.equal(turn.resolveOptimizationMode("CONVERGING", 0.1, "quality"), "quality")
})

test("blackbox smoke: classifyTurnSimple covers qna and implementation intents", () => {
  assert.equal(turn.classifyTurnSimple("how do I wire this up?"), "EXPLORING")
  assert.equal(turn.classifyTurnSimple("fix this regression"), "REFINING")
  assert.equal(turn.classifyTurnSimple(""), "INIT")
})
