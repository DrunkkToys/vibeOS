// SPDX-License-Identifier: MIT
import { test, describe, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { loadSelection, _resetSelectionCacheForTest } = await import("../../selection-manager.js")

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

describe("vector_changed_slot TTL expiry", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-vector-pulse-"))
  mkdirSync(sandbox, { recursive: true })
  const prevVibeHome = process.env.VIBEOS_HOME
  process.env.VIBEOS_HOME = sandbox

  after(() => {
    try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
    try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
  })

  const writeTiers = (vectorChangedAt: number) => {
    writeFileSync(join(sandbox, "model-tiers.json"), JSON.stringify({
      selection: {
        active_slot: "medium",
        vector_changed_slot: "cheap",
        vector_changed_at: vectorChangedAt,
      },
    }))
    _resetSelectionCacheForTest()
  }

  test("pulse still visible within TTL window", () => {
    writeTiers(Date.now())
    const sel = loadSelection()
    assert.equal(sel.vector_changed_slot, "cheap")
  })

  test("pulse expires and clears after TTL window", () => {
    writeTiers(Date.now() - 130_000)
    const sel = loadSelection()
    assert.equal(sel.vector_changed_slot, null)
  })

  test("missing file still returns null vector_changed_slot", () => {
    rmSync(join(sandbox, "model-tiers.json"), { force: true })
    _resetSelectionCacheForTest()
    const sel = loadSelection()
    assert.equal(sel.vector_changed_slot, null)
  })
})
