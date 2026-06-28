// SPDX-License-Identifier: MIT
// Orchestrator → client contract tests (subagent-delegation-only, 2026-06-28).
//
// Proves the cascade routes without ever writing an OpenCode-watched config file:
//   1. A DEFERRED slot switch persists active_slot (model-tiers.json) and queues a footer
//      hint, but neither applySlot nor flushPendingLiveSwitch() ever calls config.update
//      or writes opencode.json — config.update persists <projectDir>/config.json, a
//      watched file whose change disposes the active instance and aborts the turn.
//   2. Without a wired client, flush degrades gracefully (no throw, returns null).
//   3. resolveOrchestratorState reports ran_model = the live opencode.json model (the
//      pinned dropdown that answered), intended_model = trinity[active_slot], and
//      pending_model = the orchestrator's selected model (a display hint, not a live
//      primary switch).
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

test("deferred switch persists active_slot + footer hint; flush writes no watched file and makes no config.update", async () => {
  writeTiers({ active_slot: "cheap" })
  writeOcConfig("deepseek/cheap-model")
  const calls = installWiredClient()
  try {
    const { applySlot, flushPendingLiveSwitch, getPendingLiveSwitch } = await freshPricing()

    const r = applySlot("brain", sandbox, { deferLiveSwitch: true })
    assert.ok(r.ok, `applySlot should succeed: ${r.reason || ""}`)
    // Mid-turn: nothing OpenCode watches moves — opencode.json still reflects the pinned
    // dropdown; only the orchestrator decision (active_slot) and a footer hint changed.
    assert.equal(readOcModel(), "deepseek/cheap-model", "opencode.json unchanged mid-turn (pinned dropdown)")
    assert.equal(calls.length, 0, "NO config.update mid-turn — it would persist config.json and abort the turn")
    assert.equal(getPendingLiveSwitch()?.model, "deepseek/brain-model", "orchestrator's selected model is recorded as a footer hint")

    // Turn boundary: flush is state-only. No SDK call, no watched-file write of any kind.
    const flushed = await flushPendingLiveSwitch()
    assert.equal(flushed, null, "flush performs no live primary switch (primary pinned per session)")
    assert.equal(readOcModel(), "deepseek/cheap-model", "opencode.json NOT rewritten at the boundary")
    assert.equal(calls.length, 0, "config.update NEVER fires — config.json is the file that aborts turns")
    assert.equal(getPendingLiveSwitch(), null, "pending hint cleared after flush")
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

test("foreign model in opencode.json: reconcile reports drift + queues the slot model, without rewriting the watched file", async () => {
  // Live incoherence: opencode.json held a FOREIGN model (in no trinity slot) while
  // active_slot=cheap. vibeOS does NOT rewrite opencode.json to fix it — that watched-file
  // write aborts the turn. It re-pins the slot and queues the correct model; the per-turn
  // chat.params override applies the slot's model to the actual outbound request.
  writeTiers({ active_slot: "cheap" })
  writeOcConfig("openrouter/anthropic/claude-sonnet-4.6") // foreign: in NO trinity slot
  installWiredClient()
  try {
    const { reconcileSlotModel, resolveOrchestratorState } = await freshPricing()

    // Before reconcile: ran_model is the foreign model, intended is the slot's model,
    // nothing queued → genuine, unexplained drift.
    const before = resolveOrchestratorState(sandbox)
    assert.equal(before.ran_model, "openrouter/anthropic/claude-sonnet-4.6", "live shows the foreign model")
    assert.equal(before.intended_model, "deepseek/cheap-model", "intended = trinity[active_slot]")
    assert.equal(before.drift, true, "foreign live model with no pending hint = drift")

    // Reconcile against the active slot — the single source of truth. Synchronous; headless.
    const r = reconcileSlotModel("cheap", sandbox, "deepseek/cheap-model")
    assert.equal(r.reconciled, true, "drift re-pins the slot")
    assert.equal(r.from, "openrouter/anthropic/claude-sonnet-4.6", "from = the foreign model")
    assert.equal(r.to, "deepseek/cheap-model", "to = the slot's model")

    // The watched file is left untouched — the dropdown stays where the user/platform put it.
    assert.equal(readOcModel(), "openrouter/anthropic/claude-sonnet-4.6", "opencode.json (watched) NOT rewritten")
    const after = resolveOrchestratorState(sandbox)
    assert.equal(after.active_slot, "cheap", "active_slot unchanged")
    assert.equal(after.pending_model, "deepseek/cheap-model", "the slot's model is queued as the footer hint")
    assert.equal(after.drift, false, "drift is now explained by the queued slot model (chat.params applies it per turn)")
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
