// SPDX-License-Identifier: MIT
import { test, describe } from "node:test"
import assert from "node:assert/strict"

const { loadSelection } = await import("../selection-manager.js")

test("module exports loadSelection", () => {
  assert.equal(typeof loadSelection, "function")
})

describe("loadSelection", () => {
  test("returns object with expected keys", () => {
    const sel = loadSelection()
    assert.ok(typeof sel === "object")
    assert.ok("enabled" in sel)
    assert.ok("active_slot" in sel)
    assert.ok("thinking_level" in sel)
  })

  test("caches result when file unchanged", () => {
    const r1 = loadSelection()
    const r2 = loadSelection()
    assert.equal(r1, r2)
  })
})
