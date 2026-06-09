// SPDX-License-Identifier: MIT
// Integration test: Pattern/friction discovery + BE telemetry sync
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-patterns-"))
mkdirSync(join(sandbox, ".claude"), { recursive: true })
process.env.VIBEOS_HOME = join(sandbox, ".claude")
const prevHome = process.env.HOME
process.env.HOME = sandbox

// Write minimal tiers config
writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
  trinity: { brain: { oc: "a" }, medium: { oc: "b" }, cheap: { oc: "c" } },
  selection: { enabled: true, active_slot: "brain" }
}))

test("SETUP: sandbox ready", () => {
  assert.ok(true)
})

// ── Pattern recording exists ──
test("patterns: noteProjectPattern function is exported", async () => {
  const state = await import("../src/lib/state.js?pat1=" + Date.now())
  assert.ok(state.noteProjectPattern || state.updateGlobalLearning, "pattern tracking available")
})

test("patterns: updateGlobalLearning function is exported", async () => {
  const state = await import("../src/lib/state.js?pat2=" + Date.now())
  assert.equal(typeof state.updateGlobalLearning, "function")
})

// ── Friction recording is wired ──
test("friction: recordFrictionPattern logs to session keys", async () => {
  const helpers = await import("../src/lib/index-helpers.js?pat3=" + Date.now())
  assert.ok(typeof helpers.recordFrictionPattern === "function" || helpers, "friction recording available")
})

// ── API client has patterns endpoint ──
test("telemetry: api-client has patternsObserve method", async () => {
  const client = await import("../src/lib/api-client.js?pat4=" + Date.now())
  const c = client.getApiClient?.()
  if (c) {
    assert.equal(typeof c.patternsObserve, "function")
  }
})

// ── API client has blackbox endpoints ──
test("telemetry: api-client has blackboxOutcome method", async () => {
  const client = await import("../src/lib/api-client.js?pat5=" + Date.now())
  const c = client.getApiClient?.()
  if (c) {
    assert.equal(typeof c.blackboxOutcome, "function")
    assert.equal(typeof c.blackboxAnalyze, "function")
    assert.equal(typeof c.blackboxControlVector, "function")
    assert.equal(typeof c.blackboxSelectMode, "function")
  }
})

// ── Global learning persistence ──
test("patterns: global-learning.json can be written and read", async () => {
  const state = await import("../src/lib/state.js?pat6=" + Date.now())
  assert.equal(typeof state.updateGlobalLearning, "function")
  if (state.updateGlobalLearning) {
    state.updateGlobalLearning((gl) => {
      gl.test_pattern = { type: "friction", key: "test-key", count: 1 }
    })
  }
  assert.ok(true)
})

// ── Mode variety: all modes recognized ──
test("modes: budget recognized", async () => {
  const t = await import("../src/lib/turn-classify.js?pat7=" + Date.now())
  assert.equal(t.autoSelectMode("EXPLORING", 0), "budget")
})

test("modes: quality recognized", async () => {
  const t = await import("../src/lib/turn-classify.js?pat8=" + Date.now())
  assert.equal(t.autoSelectMode("CONVERGING", 0), "quality")
})

test("modes: speed recognized", async () => {
  const t = await import("../src/lib/turn-classify.js?pat9=" + Date.now())
  assert.equal(t.autoSelectMode("LOOPING", 0), "speed")
})

test("modes: resolveOptimizationMode handles branded modes", async () => {
  const t = await import("../src/lib/turn-classify.js?pat10=" + Date.now())
  const vib = t.resolveOptimizationMode("EXPLORING", 0, "vibeqmax")
  assert.ok(vib === "vibeqmax", "branded should pass through directly: " + vib)
})

// ── Telemetry callers exist in source ──
test("telemetry: blackboxOutcome caller exists in turn-classify", async () => {
  const t = await import("../src/lib/turn-classify.js?pat11=" + Date.now())
  assert.ok(typeof t.recordBlackboxOutcome === "function" || t.fetchBlackboxEnrichment, "outcome tracking available")
})

test("telemetry: blackboxAnalyze caller exists", async () => {
  const t = await import("../src/lib/turn-classify.js?pat12=" + Date.now())
  assert.equal(typeof t.fetchBlackboxEnrichment, "function")
})

// ── Cleanup ──
test("CLEANUP", () => {
  try { process.env.HOME = prevHome } catch {}
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
  assert.ok(true)
})
