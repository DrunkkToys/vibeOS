// SPDX-License-Identifier: MIT
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sm = await import("../../selection-manager.js")
const { loadSelection, _resetSelectionCacheForTest } = sm

const savedHome = process.env.VIBEOS_HOME

function withHome(selection, fn) {
  const home = mkdtempSync(join(tmpdir(), "vibeos-sel-"))
  process.env.VIBEOS_HOME = home
  writeFileSync(join(home, "model-tiers.json"), JSON.stringify({ selection }, null, 2) + "\n")
  _resetSelectionCacheForTest()
  try {
    return fn(home)
  } finally {
    _resetSelectionCacheForTest()
    if (savedHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = savedHome
    rmSync(home, { recursive: true, force: true })
  }
}

test("module exports loadSelection", () => {
  assert.equal(typeof loadSelection, "function")
})

describe("loadSelection", () => {
  test("returns object with expected keys", () => {
    const sel = withHome({}, () => loadSelection())
    assert.ok(typeof sel === "object")
    assert.ok("enabled" in sel)
    assert.ok("active_slot" in sel)
    assert.ok("thinking_level" in sel)
    assert.ok("quality_gate_tdd" in sel)
  })

  test("caches result when file unchanged", () => {
    const { r1, r2 } = withHome({}, () => ({ r1: loadSelection(), r2: loadSelection() }))
    assert.equal(r1, r2)
  })

  test("round-trips the TDD gate flag through selection", () => {
    const on = withHome({ quality_gate_tdd: true }, () => loadSelection())
    assert.equal(on.quality_gate_tdd, true)
    const off = withHome({ quality_gate_tdd: false }, () => loadSelection())
    assert.equal(off.quality_gate_tdd, false)
    const unset = withHome({}, () => loadSelection())
    assert.equal(unset.quality_gate_tdd, undefined)
  })
})
