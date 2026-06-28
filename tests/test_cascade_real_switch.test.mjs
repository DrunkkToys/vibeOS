// SPDX-License-Identifier: MIT
// Cascade slot + drift reconciliation tests.
//
// Contract (subagent-delegation-only, 2026-06-28):
//   1. applySlot persists the orchestrator decision (active_slot) to the UNWATCHED
//      model-tiers.json and must NOT rewrite opencode.json or call client.config.update
//      — both touch OpenCode-watched config files whose change disposes the active
//      project instance and aborts the in-flight turn. The per-turn model override is
//      done by the chat.params middleware and subagent delegation, not a config rewrite.
//   2. Drift reconciliation is synchronous and client-independent: it re-pins the slot
//      decision and reports from/to for observability, but never writes a watched file.
//      The derived (footer/report) model is always the slot's model — never a bogus
//      persisted executed_model shadow key.
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
test("applySlot('medium') persists active_slot to model-tiers.json and does NOT touch the watched opencode.json", async () => {
  writeTiers({ active_slot: "cheap" })
  writeOcConfig("deepseek/cheap-model")
  const { applySlot } = await freshPricing()
  const r = applySlot("medium", sandbox)

  assert.ok(r.ok, `applySlot should succeed: ${r.reason || ""}`)
  assert.equal(r.ocModel, "deepseek/medium-model")
  // (1) orchestrator decision persisted to the UNWATCHED tiers file
  assert.equal(readSelection().active_slot, "medium", "active_slot must flip to medium")
  // (2) the watched opencode.json is NOT rewritten — that would abort the turn. The model
  // override for the turn is applied by the chat.params middleware, not a config write.
  assert.equal(readOcModel(), "deepseek/cheap-model", "opencode.json (a watched file) stays pinned")
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

test("applySlot succeeds headless and writes no watched file", async () => {
  writeTiers({ active_slot: "cheap" })
  writeOcConfig("deepseek/cheap-model")
  clearFakeClient()
  const { applySlot } = await freshPricing()
  const r = applySlot("brain", sandbox)
  assert.ok(r.ok, "applySlot must succeed headless (tiers-file write only)")
  assert.equal(readSelection().active_slot, "brain")
  assert.equal(readOcModel(), "deepseek/cheap-model", "opencode.json stays pinned — no watched-file write")
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

test("reconcileSlotModel re-pins the slot on drift and reports from/to WITHOUT touching the watched file", async () => {
  writeTiers({ active_slot: "medium" })
  writeOcConfig("deepseek/FAKE_MODEL") // live model drifted to something foreign
  const { reconcileSlotModel } = await freshPricing()
  const r = reconcileSlotModel("medium", sandbox, "deepseek/medium-model")
  assert.equal(r.reconciled, true, "drift re-pins the slot decision")
  assert.equal(r.from, "deepseek/FAKE_MODEL")
  assert.equal(r.to, "deepseek/medium-model")
  // opencode.json is NOT rewritten — that aborts the turn. The chat.params override applies
  // the slot's model to the outbound request per turn instead.
  assert.equal(readOcModel(), "deepseek/FAKE_MODEL", "opencode.json (watched) left untouched")
})

test("reconcileSlotModel falls back to trinity when no expected model is passed (no watched-file write)", async () => {
  writeTiers({ active_slot: "brain" })
  writeOcConfig("deepseek/FAKE_MODEL")
  const { reconcileSlotModel } = await freshPricing()
  const r = reconcileSlotModel("brain", sandbox) // expectedModel omitted → read from trinity
  assert.equal(r.reconciled, true)
  assert.equal(r.to, "deepseek/brain-model")
  assert.equal(readOcModel(), "deepseek/FAKE_MODEL", "opencode.json (watched) left untouched")
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
