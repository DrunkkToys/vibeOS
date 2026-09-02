// SPDX-License-Identifier: MIT
import { test } from "node:test"
import assert from "node:assert/strict"
import { correctnessFromGroups } from "../scripts/e2e/ml-task/grade.mjs"

// A hidden group whose file crashes on import reports pass=0 fail=0. Counting only
// assertions that RAN lets a run that destroyed two whole groups score a perfect
// 1.000, because the destroyed groups leave the denominator instead of failing it.
test("a group that never ran counts as failed, not as absent", () => {
  const per = {
    "g1.test.mjs": { ran: true, pass: 10, fail: 0 },
    "g2.test.mjs": { ran: true, pass: 10, fail: 0 },
    "g3.test.mjs": { ran: true, pass: 10, fail: 0 },
    "g4.test.mjs": { ran: false, pass: 0, fail: 0 },
    "g5.test.mjs": { ran: false, pass: 0, fail: 0 },
  }
  assert.equal(correctnessFromGroups(per), 0.6)
})

test("all groups green is still a perfect score", () => {
  const per = { a: { ran: true, pass: 4, fail: 0 }, b: { ran: true, pass: 7, fail: 0 } }
  assert.equal(correctnessFromGroups(per), 1)
})

test("each group weighs the same regardless of how many assertions it holds", () => {
  // Without equal weighting, one huge green group drowns out a small broken one.
  const per = { big: { ran: true, pass: 100, fail: 0 }, small: { ran: true, pass: 0, fail: 2 } }
  assert.equal(correctnessFromGroups(per), 0.5)
})

test("partial failures inside a group are proportional", () => {
  const per = { a: { ran: true, pass: 3, fail: 1 }, b: { ran: true, pass: 1, fail: 1 } }
  assert.equal(correctnessFromGroups(per), (0.75 + 0.5) / 2)
})

test("no groups at all scores zero rather than dividing by zero", () => {
  assert.equal(correctnessFromGroups({}), 0)
})
