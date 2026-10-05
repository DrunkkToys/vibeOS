import test from "node:test"
import assert from "node:assert/strict"
import { pairedBootstrap, signTest, passRate } from "../scripts/e2e/codebench/stats.mjs"

test("passRate averages per-exercise outcomes", () => {
  assert.equal(passRate({ a: [1, 1], b: [0, 0] }), 0.5)
  assert.equal(passRate({ a: [1, 0], b: [1, 0] }), 0.5)
})

test("pairedBootstrap: identical arms give a zero difference and a CI containing 0", () => {
  const arm = { a: [1, 1], b: [0, 0], c: [1, 0], d: [1, 1] }
  const r = pairedBootstrap(arm, arm, { iterations: 2000, seed: 1 })
  assert.equal(r.diff, 0)
  assert.ok(r.lo <= 0 && r.hi >= 0)
})

test("pairedBootstrap: a clearly better arm gives a CI excluding 0", () => {
  const strong = {}
  const weak = {}
  for (let i = 0; i < 20; i++) { strong["e" + i] = [1, 1]; weak["e" + i] = i < 4 ? [1, 1] : [0, 0] }
  const r = pairedBootstrap(strong, weak, { iterations: 2000, seed: 1 })
  assert.equal(r.diff, 0.8)
  assert.ok(r.lo > 0)
})

test("pairedBootstrap is deterministic for a seed and pairs only shared exercises", () => {
  const a = { x: [1], y: [0], z: [1] }
  const b = { x: [0], y: [0], w: [1] }
  const r1 = pairedBootstrap(a, b, { iterations: 500, seed: 7 })
  const r2 = pairedBootstrap(a, b, { iterations: 500, seed: 7 })
  assert.deepEqual(r1, r2)
  assert.equal(r1.n, 2)
})

test("signTest: exact two-sided binomial over discordant exercises", () => {
  const a = { e1: [1], e2: [1], e3: [1], e4: [1], e5: [1], e6: [0] }
  const b = { e1: [0], e2: [0], e3: [0], e4: [0], e5: [0], e6: [0] }
  const r = signTest(a, b)
  assert.equal(r.aOnly, 5)
  assert.equal(r.bOnly, 0)
  assert.equal(r.p, 0.0625)
  assert.equal(signTest(a, a).p, 1)
})
