// SPDX-License-Identifier: MIT
// Orchestrator → client contract tests.
//
// Proves the three fixes that make the cascade actually switch the model and the
// footer tell the truth:
//   1. With the live SDK client wired to globalThis.__vibeOS_client, a DEFERRED slot
//      switch does NOT call config.update mid-turn — it queues — and
//      flushPendingLiveSwitch() (called at the turn boundary) fires the real
//      config.update with the slot's model.
//   2. Without a wired client, flush degrades gracefully (no throw, returns null) but
//      the file write still happened so new sessions pick up the model.
//   3. resolveOrchestratorState reports ran_model = the live opencode.json model (what
//      actually answered), and pending_model = the queued switch (what runs next turn).
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let sandbox = null
let TIERS_FILE = ""
let OC_CONFIG = ""
const prevVibeHome = process.env.VIBEOS_HOME
const prevOcHome = process.env.OPENCODE_HOME

function ensureSandbox() {
  if (!sandbox) {
    sandbox = mkdtempSync(join(tmpdir(), "vibeos-orch-test-"))
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
    selection: { enabled: true, active_slot: "cheap", ...selection },
  }))
}

function writeOcConfig(model) {
  ensureSandbox()
  writeFileSync(OC_CONFIG, JSON.stringify({ model, $schema: "https://opencode.ai/config.json" }, null, 2))
}

function readOcModel() {
  return JSON.parse(readFileSync(OC_CONFIG, "utf8")).model
}

// Fake OpenCode SDK client wired exactly where pushLiveModelSwitch reads it.
function installWiredClient() {
  const calls = []
  globalThis.__vibeOS_client = {
    config: {
      update: async (opts) => { calls.push(opts); return {} },
      get: async () => readOcModel(),
    },
  }
  return calls
}
function clearWiredClient() { delete globalThis.__vibeOS_client }

let _q = 0
function freshPricing() {
  return import("../src/lib/pricing.js?orch-test=" + (++_q) + "-" + Date.now())
}

test("deferred switch queues, does not fire mid-turn; flush fires the real SDK switch", async () => {
  writeTiers({ active_slot: "cheap" })
  writeOcConfig("deepseek/cheap-model")
  const calls = installWiredClient()
  try {
    const { applySlot, flushPendingLiveSwitch, getPendingLiveSwitch } = await freshPricing()

    const r = applySlot("brain", sandbox, { deferLiveSwitch: true })
    assert.ok(r.ok, `applySlot should succeed: ${r.reason || ""}`)
    // Mid-turn: NEITHER the live file NOR the SDK switch moves — opencode.json still
    // reflects the model that ran this turn; only the queued decision changed.
    assert.equal(readOcModel(), "deepseek/cheap-model", "opencode.json unchanged mid-turn (truthful)")
    assert.equal(calls.length, 0, "NO config.update mid-turn — switching mid-turn aborts the turn")
    assert.equal(getPendingLiveSwitch()?.model, "deepseek/brain-model", "switch is queued")

    // Turn boundary: flush fires the real SDK switch ONLY. It must NOT write opencode.json
    // — that watched-file write would dispose the active instance and abort the turn.
    const flushed = await flushPendingLiveSwitch()
    assert.equal(flushed, "deepseek/brain-model", "flush returns the switched model")
    assert.equal(readOcModel(), "deepseek/cheap-model", "opencode.json NOT rewritten at boundary (watched-file write aborts the turn)")
    assert.equal(calls.length, 1, "config.update fired exactly once at the boundary")
    assert.equal(calls[0]?.body?.model, "deepseek/brain-model", "SDK switched to the slot's model")
    assert.equal(getPendingLiveSwitch(), null, "pending cleared after flush")
  } finally {
    clearWiredClient()
  }
})

test("flush degrades gracefully without a wired client (no throw, null)", async () => {
  writeTiers({ active_slot: "cheap" })
  writeOcConfig("deepseek/cheap-model")
  clearWiredClient()
  const { applySlot, flushPendingLiveSwitch } = await freshPricing()
  applySlot("medium", sandbox, { deferLiveSwitch: true })
  assert.equal(readOcModel(), "deepseek/cheap-model", "opencode.json unchanged until the boundary flush")
  const flushed = await flushPendingLiveSwitch()
  assert.equal(flushed, null, "no SDK client → flush reports no live switch (graceful, no throw)")
  assert.equal(readOcModel(), "deepseek/cheap-model", "flush never writes the watched file — primary stays pinned, SDK best-effort only")
})

test("resolveOrchestratorState reports ran_model=live and pending_model=queued", async () => {
  writeTiers({ active_slot: "cheap" })
  writeOcConfig("deepseek/cheap-model") // the model that actually ran this turn
  installWiredClient()
  try {
    const { applySlot, resolveOrchestratorState } = await freshPricing()
    // Orchestrator decides brain for NEXT turn (deferred).
    applySlot("brain", sandbox, { deferLiveSwitch: true })
    const s = resolveOrchestratorState(sandbox)
    assert.equal(s.active_slot, "brain", "active_slot reflects the orchestrator decision")
    assert.equal(s.intended_model, "deepseek/brain-model", "intended = trinity[brain]")
    assert.equal(s.ran_model, "deepseek/cheap-model", "ran = the live model that answered THIS turn")
    assert.equal(s.pending_model, "deepseek/brain-model", "pending = the queued next-turn switch")
  } finally {
    clearWiredClient()
  }
})

test("foreign model in opencode.json reconciles back to active_slot's model (the live dropdown bug)", async () => {
  // Reproduces the exact live incoherence: opencode.json held a FOREIGN model
  // (in no trinity slot) while active_slot=cheap — the "dropdown ≠ alert" bug.
  writeTiers({ active_slot: "cheap" })
  writeOcConfig("openrouter/anthropic/claude-sonnet-4.6") // foreign: in NO trinity slot
  installWiredClient()
  try {
    const { reconcileSlotModel, resolveOrchestratorState } = await freshPricing()

    // Before reconcile: ran_model is the foreign model, intended is the slot's model
    // → genuine drift (dropdown ≠ alert).
    const before = resolveOrchestratorState(sandbox)
    assert.equal(before.ran_model, "openrouter/anthropic/claude-sonnet-4.6", "live shows the foreign model")
    assert.equal(before.intended_model, "deepseek/cheap-model", "intended = trinity[active_slot]")
    assert.equal(before.drift, true, "foreign live model with no pending switch = drift")

    // Reconcile against the active slot — the single source of truth. Synchronous,
    // so it works headless. (deferLiveSwitch:false → write the file now, like a same-turn fix.)
    const r = reconcileSlotModel("cheap", sandbox, "deepseek/cheap-model")
    assert.equal(r.reconciled, true, "drift was corrected")
    assert.equal(r.from, "openrouter/anthropic/claude-sonnet-4.6", "from = the foreign model")
    assert.equal(r.to, "deepseek/cheap-model", "to = the slot's model")

    // After reconcile: dropdown == trinity[active_slot].oc == intended == ran. Coherent.
    assert.equal(readOcModel(), "deepseek/cheap-model", "opencode.json (the dropdown) now matches the slot")
    const after = resolveOrchestratorState(sandbox)
    assert.equal(after.active_slot, "cheap", "active_slot unchanged")
    assert.equal(after.ran_model, after.intended_model, "dropdown == alert (full coherence)")
    assert.equal(after.drift, false, "no drift after reconcile")
  } finally {
    clearWiredClient()
  }
})

test("reconcile is a no-op when the live model already matches the slot (no needless SDK churn)", async () => {
  writeTiers({ active_slot: "medium" })
  writeOcConfig("deepseek/medium-model")
  const calls = installWiredClient()
  try {
    const { reconcileSlotModel } = await freshPricing()
    const r = reconcileSlotModel("medium", sandbox, "deepseek/medium-model")
    assert.equal(r.reconciled, false, "already coherent → nothing to reconcile")
    assert.equal(calls.length, 0, "no SDK switch fired when already in sync")
  } finally {
    clearWiredClient()
  }
})

test("OpenCode home resolution honors OPENCODE_HOME (test isolation: never write real ~/.opencode)", async () => {
  ensureSandbox() // sets process.env.OPENCODE_HOME = sandbox
  const { getOpenCodeHomes } = await import("../src/lib/state.js?orch-test-home=" + Date.now())
  const homes = getOpenCodeHomes()
  assert.deepEqual(homes, [sandbox], "global homes scope to OPENCODE_HOME, not the real ~/.opencode")
  const realHome = join(process.env.HOME || "", ".opencode")
  assert.ok(!homes.includes(realHome), "real ~/.opencode is never a write target when OPENCODE_HOME is set")
})

test("CLEANUP", async () => {
  clearWiredClient()
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
  if (prevVibeHome === undefined) delete process.env.VIBEOS_HOME; else process.env.VIBEOS_HOME = prevVibeHome
  if (prevOcHome === undefined) delete process.env.OPENCODE_HOME; else process.env.OPENCODE_HOME = prevOcHome
  assert.ok(true)
})
