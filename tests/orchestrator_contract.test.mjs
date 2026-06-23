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

    // Turn boundary: flush lands the file write AND fires the real SDK switch.
    const flushed = await flushPendingLiveSwitch()
    assert.equal(flushed, "deepseek/brain-model", "flush returns the switched model")
    assert.equal(readOcModel(), "deepseek/brain-model", "opencode.json moved to next-turn model at boundary")
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
  assert.equal(readOcModel(), "deepseek/medium-model", "flush still lands the file write so new sessions pick it up")
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

test("CLEANUP", async () => {
  clearWiredClient()
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
  if (prevVibeHome === undefined) delete process.env.VIBEOS_HOME; else process.env.VIBEOS_HOME = prevVibeHome
  if (prevOcHome === undefined) delete process.env.OPENCODE_HOME; else process.env.OPENCODE_HOME = prevOcHome
  assert.ok(true)
})
