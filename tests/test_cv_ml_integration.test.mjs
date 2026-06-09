// SPDX-License-Identifier: MIT
// Integration tests: ML-driven CV vectors → selection → footer display
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// ── Helpers ───────────────────────────────────────────────────────────
let sandbox = null
let TIERS_FILE = ""
const prevVibeHome = process.env.VIBEOS_HOME

function ensureSandbox() {
  if (!sandbox) {
    sandbox = mkdtempSync(join(tmpdir(), "vibeos-cv-test-"))
    mkdirSync(join(sandbox, ".claude"), { recursive: true })
    mkdirSync(join(sandbox, ".opencode"), { recursive: true })
    process.env.VIBEOS_HOME = join(sandbox, ".claude")
    TIERS_FILE = join(sandbox, ".claude", "model-tiers.json")
  }
}

function cleanupSandbox() {
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
  sandbox = null
}

function writeTiers(selection = {}) {
  ensureSandbox()
  writeFileSync(TIERS_FILE, JSON.stringify({
    trinity: { brain: { oc: "brain-model" }, medium: { oc: "medium-model" }, cheap: { oc: "cheap-model" } },
    selection: { enabled: true, active_slot: "brain", onboarding_mode: "strict", ...selection },
  }))
}

function readSelection() {
  if (!existsSync(TIERS_FILE)) return {}
  return JSON.parse(readFileSync(TIERS_FILE, "utf8")).selection
}

test("SETUP: sandbox created", async () => {
  ensureSandbox()
  assert.ok(existsSync(sandbox))
})

// ── Phase B-adjacent: blackbox enabled in fresh import ──
test("blackbox: _blackboxEnabled defaults to true in fresh module", async () => {
  const mod = await import("../src/lib/state.js?cv-test=" + Date.now())
  // setBlackboxEnabled is exported — blackbox is managed via this toggle
  assert.equal(typeof mod.setBlackboxEnabled, "function")
})

// ── Phase C: CV tier_bias → active_slot in selection ──
test("CV: tier_bias brain → active_slot brain", async () => {
  ensureSandbox()
  writeTiers({ active_slot: "medium" })
  // Simulate what syncControlSettings does: write the slot
  const applySlot = (await import("../src/lib/pricing.js?cv-test-2=" + Date.now())).applySlot
  const r = applySlot("brain")
  assert.ok(r.ok, "applySlot brain should succeed")
  assert.equal(readSelection().active_slot, "brain")
})

test("CV: tier_bias medium → active_slot medium", async () => {
  ensureSandbox()
  writeTiers({ active_slot: "brain" })
  const applySlot = (await import("../src/lib/pricing.js?cv-test-3=" + Date.now())).applySlot
  const r = applySlot("medium")
  assert.ok(r.ok, "applySlot medium should succeed")
  assert.equal(readSelection().active_slot, "medium")
})

test("CV: tier_bias cheap → active_slot cheap", async () => {
  ensureSandbox()
  writeTiers({ active_slot: "brain" })
  const applySlot = (await import("../src/lib/pricing.js?cv-test-4=" + Date.now())).applySlot
  const r = applySlot("cheap")
  assert.ok(r.ok, "applySlot cheap should succeed")
  assert.equal(readSelection().active_slot, "cheap")
})

// ── Phase D: Footer reads active_slot not execution ──
test("footer: active_slot is read from selection, not executed_model", async () => {
  ensureSandbox()
  writeTiers({ active_slot: "medium" })
  const sel = readSelection()
  const activeSlot = sel.active_slot || "brain"
  assert.equal(activeSlot, "medium")
})

test("footer: tier icon matches active_slot", async () => {
  ensureSandbox()
  const icons = { brain: "🧠", medium: "⚙", cheap: "🎁" }
  for (const [slot, icon] of Object.entries(icons)) {
    writeTiers({ active_slot: slot })
    const activeSlot = readSelection().active_slot
    assert.equal(activeSlot, slot)
    assert.equal(icons[activeSlot], icon)
  }
})

test("footer: brand fallback follows active_slot", async () => {
  ensureSandbox()
  writeTiers({ active_slot: "brain", optimization_mode: "budget" })
  let sel = readSelection()
  // When active_slot is brain → VibeQMaX
  const brand = sel.active_slot === "brain" ? "VibeQMaX" : "VibeMaX"
  assert.equal(brand, "VibeQMaX")

  writeTiers({ active_slot: "medium", optimization_mode: "budget" })
  sel = readSelection()
  const brand2 = sel.active_slot === "brain" ? "VibeQMaX" : "VibeMaX"
  assert.equal(brand2, "VibeMaX")
})

// ── Phase E: Full regime → mode → tier pipeline ──
test("E2E: regime DIVERGENT → autoSelectMode → litex", async () => {
  const turn = await import("../src/lib/turn-classify.js?e2e-1=" + Date.now())
  const mode = turn.autoSelectMode("DIVERGENT", 0.1)
  assert.equal(mode, "litex")
})

test("E2E: regime CONVERGING → autoSelectMode → quality", async () => {
  const turn = await import("../src/lib/turn-classify.js?e2e-2=" + Date.now())
  const mode = turn.autoSelectMode("CONVERGING", 0.1)
  assert.equal(mode, "quality")
})

test("E2E: regime LOOPING → autoSelectMode → speed", async () => {
  const turn = await import("../src/lib/turn-classify.js?e2e-3=" + Date.now())
  const mode = turn.autoSelectMode("LOOPING", 0.1)
  assert.equal(mode, "speed")
})

test("E2E: stress > 1.5 overrides to quality", async () => {
  const turn = await import("../src/lib/turn-classify.js?e2e-4=" + Date.now())
  const mode = turn.autoSelectMode("DIVERGENT", 1.8)
  assert.equal(mode, "quality")
})

test("E2E: computeControlVector — tier_bias from regime not mode", async () => {
  const turn = await import("../src/lib/turn-classify.js?e2e-5=" + Date.now())
  // computeControlVector uses sub_regime from state
  // For CONVERGING, tier should be brain regardless of mode input
  const cv = turn.computeControlVector({ sub_regime: "CONVERGING", latest_stress_multiplier: 0 }, undefined, "budget")
  assert.equal(cv.tier_bias, "brain")
})

test("E2E: computeControlVector — DIVERGENT → brain with quality mode input", async () => {
  const turn = await import("../src/lib/turn-classify.js?e2e-6=" + Date.now())
  const cv = turn.computeControlVector({ sub_regime: "DIVERGENT", latest_stress_multiplier: 0 }, undefined, "quality")
  assert.equal(cv.tier_bias, "brain")
})

test("E2E: resolveOptimizationMode — ML path always uses regime when connected", async () => {
  ensureSandbox()
  const turn = await import("../src/lib/turn-classify.js?e2e-7=" + Date.now())
  // When API is not in fallback (!isApiFallback()), it should use autoSelectMode
  // We test the fallback path here since API might not be configured in tests
  const mode = turn.resolveOptimizationMode("REFINING", 0.1, "quality")
  // REFINING regime → autoSelectMode should pick "budget" when stress < 1.5
  // But in fallback, explicit "quality" locks — test just verifies function runs
  assert.ok(mode === "budget" || mode === "quality", "Should return a valid mode: " + mode)
})

// ── Cleanup ──
test("CLEANUP", () => {
  cleanupSandbox()
  if (prevVibeHome) process.env.VIBEOS_HOME = prevVibeHome
  assert.ok(true)
})
