// SPDX-License-Identifier: MIT
import { test, describe } from "node:test"
import assert from "node:assert/strict"

const { memoCompute, nextTurn } = await import("../../turn-memo.js")

test("module exports memoCompute and nextTurn", () => {
  assert.equal(typeof memoCompute, "function")
  assert.equal(typeof nextTurn, "function")
})

describe("memoCompute", () => {
  test("returns computed value", () => {
    assert.equal(memoCompute("memo:1", () => 42), 42)
  })

  test("caches within same turn", () => {
    let calls = 0
    const fn = () => ++calls
    const r1 = memoCompute("memo:2", fn)
    const r2 = memoCompute("memo:2", fn)
    assert.equal(r1, 1)
    assert.equal(r2, 1)
    assert.equal(calls, 1)
  })

  test("different keys are independent", () => {
    assert.equal(memoCompute("memo:a", () => "a"), "a")
    assert.equal(memoCompute("memo:b", () => "b"), "b")
  })
})

describe("nextTurn", () => {
  test("invalidates cache", () => {
    memoCompute("memo:3", () => "old")
    assert.equal(memoCompute("memo:3", () => "new"), "old")
    nextTurn()
    assert.equal(memoCompute("memo:3", () => "new"), "new")
  })
})
