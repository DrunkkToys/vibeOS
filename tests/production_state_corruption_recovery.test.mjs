//
// production_state_corruption_recovery.test.mjs
// Tests state file corruption recovery patterns found in real production data.
// Scenarios:
//   1. safeJsonParse handles trailing commas (JSONC)
//   2. safeJsonParse handles comments (// and /* */)
//   3. safeJsonParse handles unquoted keys
//   4. computeSessionMetrics recovers from corrupted state (null/undefined/malformed)
//   5. Non-atomic write corruption (A4/A7) — truncated JSON
//
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"

import { safeJsonParse } from "../src/utils/fs-helpers.js"
import { computeSessionMetrics } from "../src/vibeOS-lib/session-metrics.js"

// ── safeJsonParse corruption recovery ─────────────────────────────────

describe("safeJsonParse corruption recovery", () => {

  it("handles trailing commas (JSONC style) — objects", () => {
    const raw = `{ "a": 1, "b": 2, }`
    const result = safeJsonParse(raw)
    assert.deepEqual(result, { a: 1, b: 2 })
  })

  it("handles trailing commas (JSONC style) — arrays", () => {
    const raw = `[1, 2, 3, ]`
    const result = safeJsonParse(raw)
    assert.deepEqual(result, [1, 2, 3])
  })

  it("handles nested trailing commas", () => {
    const raw = `{ "items": [1, 2,], "obj": { "x": 1, }, }`
    const result = safeJsonParse(raw)
    assert.deepEqual(result, { items: [1, 2], obj: { x: 1 } })
  })

  it("handles // line comments", () => {
    const raw = [
      `{`,
      `  // this is a comment`,
      `  "a": 1,`,
      `  // another comment`,
      `  "b": 2`,
      `}`,
    ].join("\n")
    const result = safeJsonParse(raw)
    assert.deepEqual(result, { a: 1, b: 2 })
  })

  it("handles /* */ block comments", () => {
    const raw = `{ "a": 1 /* block comment */, "b": 2 }`
    const result = safeJsonParse(raw)
    assert.deepEqual(result, { a: 1, b: 2 })
  })

  it("handles multiline block comments", () => {
    const raw = [
      `{`,
      `  /*`,
      `   * multi-line`,
      `   * comment`,
      `   */`,
      `  "a": 1`,
      `}`,
    ].join("\n")
    const result = safeJsonParse(raw)
    assert.deepEqual(result, { a: 1 })
  })

  it("handles mixed trailing commas and comments", () => {
    const raw = [
      `{`,
      `  // user config`,
      `  "name": "vibeOS",`,
      `  /* enabled */`,
      `  "active": true,`,
      `}`,
    ].join("\n")
    const result = safeJsonParse(raw)
    assert.deepEqual(result, { name: "vibeOS", active: true })
  })

  it("does NOT handle unquoted keys — returns null", () => {
    // safeJsonParse in fs-helpers.js does NOT implement unquoted key
    // recovery. This test documents the current limitation.
    const raw = `{ key: "value" }`
    const result = safeJsonParse(raw)
    assert.equal(result, null)
  })

  it("returns null for empty string", () => {
    assert.equal(safeJsonParse(""), null)
  })

  it("returns null for null input", () => {
    assert.equal(safeJsonParse(null), null)
  })

  it("returns null for undefined input", () => {
    assert.equal(safeJsonParse(undefined), null)
  })

  it("returns null for completely garbage input", () => {
    assert.equal(safeJsonParse("not json at all !@#$%"), null)
  })

  it("returns null for truncated JSON — object (A4 pattern)", () => {
    const raw = `{ "a": 1, "b": 2`
    const result = safeJsonParse(raw)
    assert.equal(result, null)
  })

  it("returns null for truncated JSON — array (A7 pattern)", () => {
    const raw = `[1, 2, 3`
    const result = safeJsonParse(raw)
    assert.equal(result, null)
  })

  it("returns null for truncated JSON — nested (A4/A7 hybrid)", () => {
    const raw = `{ "a": { "b": [1, 2`
    const result = safeJsonParse(raw)
    assert.equal(result, null)
  })

  it("returns null for JSON truncated at string boundary", () => {
    const raw = `{ "a": "unterminated string`
    const result = safeJsonParse(raw)
    assert.equal(result, null)
  })
})

// ── computeSessionMetrics corrupted state recovery ────────────────────

describe("computeSessionMetrics corrupted state recovery", () => {

  it("returns empty metrics for null state", () => {
    const m = computeSessionMetrics(null, "sid-1")
    assert.equal(m.ltTasks, 0)
    assert.equal(m.ltCache, 0)
    assert.equal(m.ltCost, 0)
    assert.equal(m.count, 0)
    assert.equal(m.scratchpadHits, 0)
    assert.equal(m.missedC7, 0)
    assert.equal(m.sesTasks, 0)
    assert.equal(m.sesEdit, 0)
    assert.equal(m.sesCredit, 0)
    assert.equal(m.sesC7, 0)
    assert.equal(m.sesQuota, 0)
    assert.equal(m.sesTaskDelegations, 0)
    assert.equal(m.sesDuration, 0)
    assert.equal(m.sesRatePerHour, 0)
    assert.equal(m.sesTrend, "stable")
    assert.deepEqual(m.sesToolBreakdown, {})
    assert.deepEqual(m.sesModelTurns, { brain: 0, worker: 0 })
  })

  it("returns empty metrics for undefined state", () => {
    const m = computeSessionMetrics(undefined, "sid-1")
    assert.equal(m.ltTasks, 0)
    assert.equal(m.ltCache, 0)
    assert.equal(m.count, 0)
  })

  it("returns empty metrics for array (non-object) state", () => {
    const m = computeSessionMetrics([], "sid-1")
    assert.equal(m.ltTasks, 0)
    assert.equal(m.count, 0)
  })

  it("returns empty metrics for number state", () => {
    const m = computeSessionMetrics(42, "sid-1")
    assert.equal(m.ltTasks, 0)
    assert.equal(m.count, 0)
  })

  it("returns empty metrics for string state", () => {
    const m = computeSessionMetrics("{corrupted}", "sid-1")
    assert.equal(m.ltTasks, 0)
    assert.equal(m.count, 0)
  })

  it("recovers when sessions key is missing", () => {
    const m = computeSessionMetrics({}, "sid-1")
    assert.equal(m.ltTasks, 0)
    assert.equal(m.ltCache, 0)
    assert.equal(m.ltCost, 0)
    assert.equal(m.count, 0)
  })

  it("recovers when sessions is null", () => {
    const m = computeSessionMetrics({ sessions: null }, "sid-1")
    assert.equal(m.ltTasks, 0)
    assert.equal(m.count, 0)
  })

  it("recovers when sessions is a string (corrupted)", () => {
    const m = computeSessionMetrics({ sessions: "corrupted" }, "sid-1")
    assert.equal(m.ltTasks, 0)
    assert.equal(m.count, 0)
  })

  it("recovers when session has null warns", () => {
    const state = {
      sessions: {
        "sid-1": { warns: null },
      },
    }
    const m = computeSessionMetrics(state, "sid-1")
    assert.equal(m.sesTasks, 0)
    assert.equal(m.sesEdit, 0)
    assert.equal(m.count, 0)
  })

  it("recovers when session has string warns (corrupted)", () => {
    const state = {
      sessions: {
        "sid-1": { warns: "not-an-array" },
      },
    }
    const m = computeSessionMetrics(state, "sid-1")
    assert.equal(m.sesTasks, 0)
    assert.equal(m.sesEdit, 0)
    assert.equal(m.count, 0)
  })

  it("recovers when warn entries have missing fields", () => {
    const state = {
      sessions: {
        "sid-1": {
          warns: [
            { est_savings_usd: "invalid" },
            { no_savings_field: true },
            { est_savings_usd: 1.5 },
          ],
        },
      },
    }
    const m = computeSessionMetrics(state, "sid-1")
    assert.equal(m.sesTasks, 1.5)
    assert.equal(m.count, 3)
  })

  it("recovers when session has null cache_savings_usd", () => {
    const state = {
      sessions: {
        "sid-1": {
          warns: [],
          cache_savings_usd: null,
        },
      },
    }
    const m = computeSessionMetrics(state, "sid-1")
    assert.equal(m.ltCache, 0)
    assert.equal(m.ltTasks, 0)
  })

  it("recovers when session has undefined started", () => {
    const state = {
      sessions: {
        "sid-1": { warns: [] },
      },
    }
    const m = computeSessionMetrics(state, "sid-1")
    assert.equal(m.sesDuration, 0)
    assert.equal(m.sesRatePerHour, 0)
  })

  it("recovers when lifetime key is missing", () => {
    const state = {
      sessions: {
        "sid-1": {
          warns: [{ tool: "edit", reason: "direct edit", est_savings_usd: 2.0 }],
          cache_savings_usd: 0.5,
        },
      },
    }
    const m = computeSessionMetrics(state, "sid-1")
    assert.equal(m.ltTasks, 2.0)
    assert.equal(m.ltCache, 0.5)
    assert.equal(m.count, 1)
  })

  it("recovers when multiple sessions exist and one is malformed", () => {
    const state = {
      sessions: {
        "good": {
          warns: [{ tool: "bash", reason: "delegation", est_savings_usd: 1.0 }],
          cache_savings_usd: 0.25,
        },
        "bad": null,
        "also-bad": "corrupted string",
        "empty": { warns: [] },
      },
    }
    const m = computeSessionMetrics(state, "good")
    assert.equal(m.ltTasks, 1.0)
    assert.equal(m.ltCache, 0.25)
    assert.equal(m.count, 1)
  })
})

// ── SafeJsonParse via readJsonFile round-trip ─────────────────────────

import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readJsonFile } from "../src/utils/fs-helpers.js"

describe("readJsonFile corruption recovery", () => {
  let sandbox

  before(() => {
    sandbox = mkdtempSync(join(tmpdir(), "corruption-recovery-"))
  })

  after(() => {
    rmSync(sandbox, { recursive: true, force: true })
  })

  function writeTest(name, content) {
    const p = join(sandbox, name)
    writeFileSync(p, content, "utf-8")
    return p
  }

  it("returns fallback for non-existent file", () => {
    const result = readJsonFile(join(sandbox, "nope.json"), "DEFAULT")
    assert.equal(result, "DEFAULT")
  })

  it("reads valid JSON normally", () => {
    const p = writeTest("valid.json", JSON.stringify({ a: 1, b: 2 }))
    const result = readJsonFile(p)
    assert.deepEqual(result, { a: 1, b: 2 })
  })

  it("recovers from JSON with trailing commas", () => {
    const p = writeTest("trailing.json", `{ "a": 1, "b": 2, }`)
    const result = readJsonFile(p)
    assert.deepEqual(result, { a: 1, b: 2 })
  })

  it("recovers from JSON with comments", () => {
    const p = writeTest("comments.json", [
      `{`,
      `  // config file`,
      `  "enabled": true,`,
      `}`,
    ].join("\n"))
    const result = readJsonFile(p)
    assert.deepEqual(result, { enabled: true })
  })

  it("returns fallback for truncated JSON (A4 non-atomic write)", () => {
    const p = writeTest("truncated.json", `{ "a": 1, "b":`)
    const result = readJsonFile(p, "FALLBACK")
    assert.equal(result, "FALLBACK")
  })
})
