import { test } from "node:test"
import assert from "node:assert/strict"

const autoSelectMode = (subRegime, stressMultiplier) => {
  if (subRegime === "CONVERGING" || subRegime === "CLOSED") return "quality"
  if (subRegime === "LOOPING") return "speed"
  if (stressMultiplier && stressMultiplier > 1.5) return "quality"
  return "budget"
}

test("CONVERGING → quality regardless of stress", () => {
  assert.deepStrictEqual(autoSelectMode("CONVERGING", 0.1), "quality")
  assert.deepStrictEqual(autoSelectMode("CONVERGING", 2.0), "quality")
})
test("CLOSED → quality", () => {
  assert.deepStrictEqual(autoSelectMode("CLOSED", 0.1), "quality")
})
test("LOOPING → speed", () => {
  assert.deepStrictEqual(autoSelectMode("LOOPING", 0.3), "speed")
  assert.deepStrictEqual(autoSelectMode("LOOPING", 2.0), "speed")
})
test("EXPLORING + low stress → budget", () => {
  assert.deepStrictEqual(autoSelectMode("EXPLORING", 0.5), "budget")
  assert.deepStrictEqual(autoSelectMode("EXPLORING", 1.5), "budget")
})
test("EXPLORING + high stress → quality", () => {
  assert.deepStrictEqual(autoSelectMode("EXPLORING", 1.6), "quality")
  assert.deepStrictEqual(autoSelectMode("EXPLORING", 3.0), "quality")
})
test("DIVERGENT → budget (no stress override if <= 1.5)", () => {
  assert.deepStrictEqual(autoSelectMode("DIVERGENT", 1.0), "budget")
  assert.deepStrictEqual(autoSelectMode("DIVERGENT", 1.5), "budget")
})
test("DIVERGENT + stress > 1.5 → quality", () => {
  assert.deepStrictEqual(autoSelectMode("DIVERGENT", 1.51), "quality")
})
test("INIT + no stress → budget", () => {
  assert.deepStrictEqual(autoSelectMode("INIT"), "budget")
  assert.deepStrictEqual(autoSelectMode("INIT", 0.5), "budget")
})
test("REFINING + no stress → budget", () => {
  assert.deepStrictEqual(autoSelectMode("REFINING", 1.0), "budget")
})
test("CONVERGING beats LOOPING — regime priority", () => {
  assert.deepStrictEqual(autoSelectMode("CONVERGING", 0.1), "quality")
  assert.deepStrictEqual(autoSelectMode("LOOPING", 2.0), "speed")
})
