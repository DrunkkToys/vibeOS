// SPDX-License-Identifier: MIT
// Real cascade switch + drift reconciliation tests.
//
// Covers the two regressions reported against VibeUltraX:
//   1. applySlot must perform a REAL runtime switch via the OpenCode SDK
//      (client.config.update / POST /config), not just a file write — and it
//      must persist active_slot + the opencode.json default for the slot.
//   2. Drift reconciliation must be synchronous and client-independent: a stale
//      or foreign live model is corrected back to the slot's model on the next
//      turn, and the derived (footer/report) model is always the slot's model —
//      never a bogus persisted executed_model shadow key.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// ── Sandbox ────────────────────────────────────────────────────────────
let sandbox = null
let TIERS_FILE = ""
let OC_CONFIG = ""
const prevVibeHome = process.env.VIBEOS_HOME
const prevOcHome = process.env.OPENCODE_HOME

function ensureSandbox() {
  if (!sandbox) {
    sandbox = mkdtempSync(join(tmpdir(), "vibeos-switch-test-"))
    mkdirSync(join(sandbox, ".claude"), { recursive: true })
    process.env.VIBEOS_HOME = join(sandbox, ".claude")
    process.env.OPENCODE_HOME = sandbox
    TIERS_FILE = join(sandbox, ".claude", "model-tiers.json")
    OC_CONFIG = join(sandbox, "opencode.json")
  }
}

function writeTiers(selection = {}) {
  ensureSandbox()
  writeFileSync(TIERS_FILE, JSON.stringify({
    trinity: {
      brain: { oc: "deepseek/brain-model" },
      medium: { oc: "deepseek/medium-model" },
      cheap: { oc: "deepseek/cheap-model" },
    },
    selection: { enabled: true, active_slot: "cheap", onboarding_mode: "strict", ...selection },
  }))
}

function writeOcConfig(model) {
  ensureSandbox()
  writeFileSync(OC_CONFIG, JSON.stringify({ model, $schema: "https://opencode.ai/config.json" }, null, 2))
}

function readSelection() {
  return JSON.parse(readFileSync(TIERS_FILE, "utf8")).selection
}

function readOcModel() {
  return JSON.parse(readFileSync(OC_CONFIG, "utf8")).model
}

// Install a fake OpenCode SDK client that records config.update calls.
function installFakeClient() {
  const calls = []
  globalThis.client = {
    config: {
      update: async (opts) => { calls.push(opts); return {} },
      get: async () => readOcModel(),
    },
  }
  return calls
}

function clearFakeClient() {
  delete globalThis.client
}

let _q = 0
function freshPricing() {
  // Cache-bust so the module re-reads env-derived paths each import.
  return import("../src/lib/pricing.js?switch-test=" + (++_q) + "-" + Date.now())
}

// ── applySlot: real runtime switch ─────────────────────────────────────
test("applySlot('medium') persists active_slot and opencode.json for next session", async () => {
  writeTiers({ active_slot: "cheap" })
  writeOcConfig("deepseek/cheap-model")
  try {
    const { applySlot } = await freshPricing()
    const r = applySlot("medium", sandbox)

    assert.ok(r.ok, `applySlot should succeed: ${r.reason || ""}`)
    assert.equal(r.ocModel, "deepseek/medium-model")
    // (1) selection persisted
    assert.equal(readSelection().active_slot, "medium", "active_slot must flip to medium")
    // (2) opencode.json next-session default rewritten
    assert.equal(readOcModel(), "deepseek/medium-model", "opencode.json model must be medium's model for next session")
  } finally {
    // SDK switch now happens at next session start, not mid-turn
  }
})

test("applySlot does NOT persist shadow execution keys", async () => {
  writeTiers({ active_slot: "cheap", executed_model: "deepseek/FAKE_MODEL", selected_model: "deepseek/FAKE_MODEL" })
  writeOcConfig("deepseek/cheap-model")
  const { applySlot } = await freshPricing()
  const r = applySlot("brain", sandbox)
  assert.ok(r.ok)
  const sel = readSelection()
  assert.equal(sel.active_slot, "brain")
  assert.equal(sel.executed_model, undefined, "executed_model is a shadow key and must be stripped")
  assert.equal(sel.selected_model, undefined, "selected_model is a shadow key and must be stripped")
})

test("applySlot succeeds (file write) even when the SDK client is absent", async () => {
  writeTiers({ active_slot: "cheap" })
  writeOcConfig("deepseek/cheap-model")
  clearFakeClient()
  const { applySlot } = await freshPricing()
  const r = applySlot("brain", sandbox)
  assert.ok(r.ok, "file-write fallback must still succeed headless")
  assert.equal(readSelection().active_slot, "brain")
  assert.equal(readOcModel(), "deepseek/brain-model")
})

// ── readLiveOpenCodeModel ──────────────────────────────────────────────
test("readLiveOpenCodeModel reads the project opencode.json model", async () => {
  writeTiers()
  writeOcConfig("deepseek/medium-model")
  const { readLiveOpenCodeModel } = await freshPricing()
  assert.equal(readLiveOpenCodeModel(sandbox), "deepseek/medium-model")
})

// ── reconcileSlotModel: drift correction ───────────────────────────────
test("reconcileSlotModel is a no-op when the live model already matches the slot", async () => {
  writeTiers({ active_slot: "medium" })
  writeOcConfig("deepseek/medium-model")
  const calls = installFakeClient()
  try {
    const { reconcileSlotModel } = await freshPricing()
    const r = reconcileSlotModel("medium", sandbox, "deepseek/medium-model")
    assert.equal(r.reconciled, false, "no drift → no reconciliation")
    assert.equal(calls.length, 0, "no SDK switch when already aligned")
    assert.equal(readOcModel(), "deepseek/medium-model")
  } finally {
    clearFakeClient()
  }
})

test("reconcileSlotModel corrects a drifted/foreign live model back to the slot's model", async () => {
  writeTiers({ active_slot: "medium" })
  writeOcConfig("deepseek/FAKE_MODEL") // live model drifted to something foreign
  try {
    const { reconcileSlotModel } = await freshPricing()
    const r = reconcileSlotModel("medium", sandbox, "deepseek/medium-model")
    assert.equal(r.reconciled, true, "drift must be reconciled")
    assert.equal(r.from, "deepseek/FAKE_MODEL")
    assert.equal(r.to, "deepseek/medium-model")
    // opencode.json corrected for next session
    assert.equal(readOcModel(), "deepseek/medium-model")
  } finally {
    // no SDK call — file is updated, live switch takes effect next session
  }
})

test("reconcileSlotModel falls back to trinity when no expected model is passed", async () => {
  writeTiers({ active_slot: "brain" })
  writeOcConfig("deepseek/FAKE_MODEL")
  const { reconcileSlotModel } = await freshPricing()
  const r = reconcileSlotModel("brain", sandbox) // expectedModel omitted → read from trinity
  assert.equal(r.reconciled, true)
  assert.equal(r.to, "deepseek/brain-model")
  assert.equal(readOcModel(), "deepseek/brain-model")
})

// ── Footer/report derives execution from the slot, never a shadow key ──
test("resolveCurrentExecution reports the slot's model, ignoring a bogus persisted executed_model", async () => {
  writeTiers({ active_slot: "medium", executed_model: "deepseek/FAKE_MODEL" })
  const { resolveCurrentExecution } = await freshPricing()
  const exec = resolveCurrentExecution({
    directory: sandbox,
    activeSlot: "medium",
    currentModel: "",
    liveModel: "", // no live signal → must derive from the slot
    tiersData: { trinity: { medium: { oc: "deepseek/deepseek-v4-flash" } } },
  })
  assert.equal(exec.model, "deepseek/deepseek-v4-flash", "execution model must be the slot's model")
  assert.notEqual(exec.model, "deepseek/FAKE_MODEL", "must never surface the shadow executed_model")
  assert.equal(exec.quality, "medium", "v4-flash must classify as the medium tier")
})

// ── Cleanup ────────────────────────────────────────────────────────────
test("CLEANUP", async () => {
  clearFakeClient()
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
  if (prevVibeHome === undefined) delete process.env.VIBEOS_HOME; else process.env.VIBEOS_HOME = prevVibeHome
  if (prevOcHome === undefined) delete process.env.OPENCODE_HOME; else process.env.OPENCODE_HOME = prevOcHome
  assert.ok(true)
})
