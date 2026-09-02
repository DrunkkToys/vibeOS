// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
// The hook resolves models from pricing's TRINITY_* globals, which are null
// until this runs. Imported WITHOUT a cache-buster so it is the same module
// instance the hook itself imports; otherwise the slots load into a copy and
// the suite silently falls back to ambient machine state.
import { loadTrinitySlotsFromTiersFile } from "../src/lib/pricing.js"
import { setCurrentModel, setCurrentTier } from "../src/lib/state.js"
import * as _pricingMod from "../src/lib/pricing.js"
import { routeDiag, setPricing } from "./route-diagnostics.mjs"
setPricing(_pricingMod)

test("vibeultrax control vector keeps durable cascade root for simple route", async () => {
  const vu = await import("../dist-ts/vibeOS-lib/blackbox/vibeultrax.js?route-root=" + Date.now())
  const cv = vu.vibeultraxControlVector({ user_text: "hello" })

  assert.deepEqual(cv.cascade_root, ["cheap", "medium", "brain"])
  assert.deepEqual(cv.route_path, ["cheap"])
  assert.deepEqual(cv.pipeline_root, ["cheap", "medium", "brain"])
  assert.equal(cv.selected_slot, "cheap")
  assert.equal(cv.tier_bias, "cheap")
})

test("vibeultrax complex route selects brain without moving the root slot", async () => {
  const vu = await import("../dist-ts/vibeOS-lib/blackbox/vibeultrax.js?route-root-complex=" + Date.now())
  const cv = vu.vibeultraxControlVector({
    user_text: "implement a multi-file migration with rollback concurrency race condition distributed consensus validation and production recovery",
  })

  assert.deepEqual(cv.cascade_root, ["cheap", "medium", "brain"])
  assert.deepEqual(cv.pipeline_root, ["cheap", "medium", "brain"])
  assert.deepEqual(cv.route_path, ["cheap", "medium", "brain"])
  assert.equal(cv.selected_slot, "brain")
  assert.equal(cv.tier_bias, "cheap")
})

test("normalizer keeps vibeultrax active_pipeline durable when backend route is cheap", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-route-sync-"))
  const oldHome = process.env.VIBEOS_HOME
  try {
    process.env.VIBEOS_HOME = join(sandbox, ".claude")
    mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
    writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
      selection: {
        enabled: true,
        active_slot: "brain",
        slot_locked: false,
        optimization_mode: "vibeultrax",
        active_pipeline: ["brain"],
      },
      trinity: {
        cheap: { oc: "test/cheap" },
        medium: { oc: "test/medium" },
        brain: { oc: "test/brain" },
      },
    }))
    loadTrinitySlotsFromTiersFile()
    // tool-execute.ts:700 gates the whole Task routing block on a truthy
    // currentModel. Set it explicitly: it used to be inherited from whatever
    // OpenCode config the host machine happened to have, so these suites passed
    // on a dev box and skipped routing entirely on a clean runner.
    setCurrentModel("testprov/orchestrator")
    setCurrentTier("budget")

    const mod = await import("../dist-ts/lib/hooks/chat-transform.js?route-sync=" + Date.now())
    const result = mod.syncControlSettings({
      optimization_mode: "vibeultrax",
      tier_bias: "cheap",
      selected_slot: "cheap",
      pipeline_root: ["cheap"],
      route_path: ["cheap"],
      cascade_root: ["cheap", "medium", "brain"],
      cascade_depth: 1,
      enforcement_mode: "strict",
      flow_mode: "strict",
      tdd_mode: "quality",
      thinking_mode: "brief",
    }, {
      authoritative: true,
      backendDecision: {
        source: "backend",
        requested_mode: "vibeultrax",
        requested_slot: "cheap",
      },
    })

    const raw = JSON.parse(readFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), "utf8"))
    assert.deepEqual(raw.selection.active_pipeline, ["cheap", "medium", "brain"])
    assert.equal(raw.selection.vector_changed_pipeline, undefined)
    assert.deepEqual(result.applied_pipeline, ["cheap", "medium", "brain"])
  } finally {
    if (oldHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = oldHome
    rmSync(sandbox, { recursive: true, force: true })
  }
})

// ── CONTRACT CHANGE (2026-09-01). This test previously asserted that the
// vibeultrax root slot stays cheap when the per-turn route selects brain --
// cheap-first, with escalation happening by delegating a Task to a higher tier.
//
// That contract is what made the arm unusable. Across five live ml-impact runs
// vibeultrax voided on its first hard turn every single time, because the model
// did the work itself instead of delegating, so the turn ran on the cheap slot
// until it timed out (3027s on `diagnose`). Delegation is not something the
// plugin can force; it can only route.
//
// The measurements also removed the reason to defend cheap-first. Prompt
// caching, not tier choice, dominates cost: raw's third turn costs 249 input
// tokens against a warm cache, versus 14,057 when the prefix is invalidated.
// Switching models per turn throws the cache away, so a cheaper model on a cold
// prompt is not cheaper. Cheap-first cannot deliver the savings it promised.
//
// New contract: the primary follows the backend's tier verdict, clamped to the
// mode's envelope. entry_slot still records the tier the turn STARTED from, so
// the cascade's origin stays observable; active_slot is where it ended up.
test("sync moves the vibeultrax primary to the per-turn route's slot, keeping entry_slot as the origin", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-route-root-slot-"))
  const oldHome = process.env.VIBEOS_HOME
  try {
    process.env.VIBEOS_HOME = join(sandbox, ".claude")
    mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
    writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
      selection: {
        enabled: true,
        active_slot: "cheap",
        slot_locked: false,
        optimization_mode: "vibeultrax",
        active_pipeline: ["cheap"],
      },
      trinity: {
        cheap: { oc: "test/cheap" },
        medium: { oc: "test/medium" },
        brain: { oc: "test/brain" },
      },
    }))
    loadTrinitySlotsFromTiersFile()
    // tool-execute.ts:700 gates the whole Task routing block on a truthy
    // currentModel. Set it explicitly: it used to be inherited from whatever
    // OpenCode config the host machine happened to have, so these suites passed
    // on a dev box and skipped routing entirely on a clean runner.
    setCurrentModel("testprov/orchestrator")
    setCurrentTier("budget")

    const mod = await import("../dist-ts/lib/hooks/chat-transform.js?route-root-slot=" + Date.now())
    const result = mod.syncControlSettings({
      optimization_mode: "vibeultrax",
      tier_bias: "cheap",
      selected_slot: "brain",
      pipeline_root: ["cheap", "medium", "brain"],
      route_path: ["cheap", "medium", "brain"],
      cascade_root: ["cheap", "medium", "brain"],
      cascade_depth: 3,
      enforcement_mode: "strict",
      flow_mode: "strict",
      tdd_mode: "quality",
      thinking_mode: "full",
    }, {
      authoritative: true,
      backendDecision: {
        source: "backend",
        requested_mode: "vibeultrax",
        requested_slot: "cheap",
      },
    })

    const raw = JSON.parse(readFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), "utf8"))
    assert.equal(raw.selection.active_slot, "brain", "the primary must follow the verdict, not stall on the floor")
    assert.equal(raw.selection.entry_slot, "cheap", "entry_slot must still record where the turn started")
    assert.deepEqual(raw.selection.active_pipeline, ["cheap", "medium", "brain"])
    assert.equal(result.applied_slot, "brain")
    assert.equal(result.selected_slot, "brain")
    assert.deepEqual(result.route_path, ["cheap", "medium", "brain"])
  } finally {
    if (oldHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = oldHome
    rmSync(sandbox, { recursive: true, force: true })
  }
})

// ── Regression: normalizeRoutePath (chat-transform.ts) must SLICE the durable
// pipeline down to the resolved slot's index, not just check membership. Live
// blackbox-state.json across 150 real sessions showed route_path/cascade_depth
// permanently pinned at the full 3-tier pipeline regardless of the actual
// resolved slot — because `route.includes(slot)` is always true for any of
// cheap/medium/brain within vibeultrax's fixed pipeline, so the old
// implementation returned the full array unconditionally. This is the reason
// the footer's cascade depth icon (▸/▸▸/▸▸▸) never deescalated in production.
test("sync route_path shrinks to depth 1 when the resolved slot is cheap (not pinned at the full pipeline)", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-route-shrink-cheap-"))
  const oldHome = process.env.VIBEOS_HOME
  try {
    process.env.VIBEOS_HOME = join(sandbox, ".claude")
    mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
    writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
      selection: {
        enabled: true,
        active_slot: "cheap",
        slot_locked: false,
        optimization_mode: "vibeultrax",
        active_pipeline: ["cheap"],
      },
      trinity: {
        cheap: { oc: "test/cheap" },
        medium: { oc: "test/medium" },
        brain: { oc: "test/brain" },
      },
    }))
    loadTrinitySlotsFromTiersFile()
    // tool-execute.ts:700 gates the whole Task routing block on a truthy
    // currentModel. Set it explicitly: it used to be inherited from whatever
    // OpenCode config the host machine happened to have, so these suites passed
    // on a dev box and skipped routing entirely on a clean runner.
    setCurrentModel("testprov/orchestrator")
    setCurrentTier("budget")

    const mod = await import("../dist-ts/lib/hooks/chat-transform.js?route-shrink-cheap=" + Date.now())
    const result = mod.syncControlSettings({
      optimization_mode: "vibeultrax",
      tier_bias: "cheap",
      selected_slot: "cheap",
      pipeline_root: ["cheap", "medium", "brain"],
      route_path: ["cheap", "medium", "brain"],
      cascade_root: ["cheap", "medium", "brain"],
      cascade_depth: 3,
      enforcement_mode: "strict",
      flow_mode: "strict",
      tdd_mode: "quality",
      thinking_mode: "full",
    }, {
      authoritative: true,
      backendDecision: {
        source: "backend",
        requested_mode: "vibeultrax",
        requested_slot: "cheap",
      },
    })

    assert.equal(result.selected_slot, "cheap")
    assert.deepEqual(result.route_path, ["cheap"], "route_path must shrink to just the cheap entry, not stay pinned at the full pipeline")
  } finally {
    if (oldHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = oldHome
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test("sync route_path shrinks to depth 2 when the resolved slot is medium", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-route-shrink-medium-"))
  const oldHome = process.env.VIBEOS_HOME
  try {
    process.env.VIBEOS_HOME = join(sandbox, ".claude")
    mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
    writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
      selection: {
        enabled: true,
        active_slot: "cheap",
        slot_locked: false,
        optimization_mode: "vibeultrax",
        active_pipeline: ["cheap"],
      },
      trinity: {
        cheap: { oc: "test/cheap" },
        medium: { oc: "test/medium" },
        brain: { oc: "test/brain" },
      },
    }))
    loadTrinitySlotsFromTiersFile()
    // tool-execute.ts:700 gates the whole Task routing block on a truthy
    // currentModel. Set it explicitly: it used to be inherited from whatever
    // OpenCode config the host machine happened to have, so these suites passed
    // on a dev box and skipped routing entirely on a clean runner.
    setCurrentModel("testprov/orchestrator")
    setCurrentTier("budget")

    const mod = await import("../dist-ts/lib/hooks/chat-transform.js?route-shrink-medium=" + Date.now())
    const result = mod.syncControlSettings({
      optimization_mode: "vibeultrax",
      tier_bias: "cheap",
      selected_slot: "medium",
      pipeline_root: ["cheap", "medium", "brain"],
      route_path: ["cheap", "medium", "brain"],
      cascade_root: ["cheap", "medium", "brain"],
      cascade_depth: 3,
      enforcement_mode: "strict",
      flow_mode: "strict",
      tdd_mode: "quality",
      thinking_mode: "full",
    }, {
      authoritative: true,
      backendDecision: {
        source: "backend",
        requested_mode: "vibeultrax",
        requested_slot: "cheap",
      },
    })

    assert.equal(result.selected_slot, "medium")
    assert.deepEqual(result.route_path, ["cheap", "medium"], "route_path must shrink to cheap+medium, not stay pinned at the full pipeline")
  } finally {
    if (oldHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = oldHome
    rmSync(sandbox, { recursive: true, force: true })
  }
})

// ── Route precedence, as production actually implements it ──
//
// The three tests that stood here asserted resolveCascadeRouteDecision: that an
// "explicit" backend target beat local cascade, that a non-explicit one lost to
// it, and that a stressScore input upgraded the tier. Production implements none
// of that. The resolver had zero call sites and was tree-shaken out of
// dist/vibeOS.js, so those contracts described code that never ran.
//
// What production does: syncControlSettings writes the backend's decision into
// selection state, and the task branch of tool.execute.before takes that as the
// baseline, which a confident per-message ML verdict may adjust UP or DOWN --
// but never outside the envelope (mode pipeline widened by the live route).
// Stress reaches routing by moving the control vector upstream, not here.

const PRECEDENCE_TRINITY = { cheap: { oc: "test/cheap" }, medium: { oc: "test/medium" }, brain: { oc: "test/brain" } }
const PRECEDENCE_COMPLEX = "fix refactor implement migrate validate the critical production crash error panic failure bug in src/lib/hooks/tool-execute.ts src/lib/hooks/chat-transform.ts src/lib/pricing.ts src/vibeOS-lib/ml-router.ts tests/cascade_route_contract.test.mjs with distributed consensus protocol raft leader election gossip protocol byzantine fault tolerance paxos algorithm eventual consistency CRDT data structures rollback observability retry circuit breaker concurrency race condition deadlock"

async function routePrecedenceTask(prompt, selection, tag) {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-route-prec-"))
  const old = { HOME: process.env.HOME, VIBEOS_HOME: process.env.VIBEOS_HOME }
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
  mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
  writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({ model: "test/cheap" }))
  writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
    selection: { enabled: true, slot_locked: false, optimization_mode: "vibeultrax", ...selection },
    trinity: PRECEDENCE_TRINITY,
    tiers: {
      high: { regex: "test/brain" },
      mid: { regex: "test/medium" },
      budget: { regex: "test/cheap" },
    },
  }))
  loadTrinitySlotsFromTiersFile()
  // tool-execute.ts:700 gates the whole Task routing block on a truthy
  // currentModel. Set it explicitly: it used to be inherited from whatever
  // OpenCode config the host machine happened to have, so these suites passed
  // on a dev box and skipped routing entirely on a clean runner.
  setCurrentModel("testprov/orchestrator")
  setCurrentTier("budget")
  try {
    const mod = await import("../src/lib/hooks/tool-execute.js?route-prec=" + tag + Date.now())
    const args = { prompt, subagent_type: "general", model: null, modelID: null, modelId: null }
    await mod.onToolExecuteBefore({ tool: "task" }, { args })
    if (!args.model && !args.modelID && !args.modelId) {
      // The hook produced no model. Dump what it saw so a CI-only failure
      // names its cause instead of just asserting null.
      console.log("ROUTE_DIAG " + routeDiag({ suite: "cascade_route_contract.test.mjs" }))
    }
    return args
  } finally {
    for (const [k, v] of Object.entries(old)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    rmSync(sandbox, { recursive: true, force: true })
  }
}

test("a confident ML verdict escalates above the control vector baseline", async () => {
  const args = await routePrecedenceTask(PRECEDENCE_COMPLEX, {
    active_slot: "cheap",
    active_pipeline: ["cheap", "medium", "brain"],
    worker_slot: "cheap",
    selected_slot: "cheap",
  }, "escalate")
  assert.equal(args.model, "test/brain", "the ML must be able to outrank a cheap baseline for a genuinely complex prompt")
})

test("a confident ML verdict de-escalates below the control vector baseline", async () => {
  const args = await routePrecedenceTask("hello", {
    active_slot: "brain",
    active_pipeline: ["cheap", "medium", "brain"],
    worker_slot: "brain",
    selected_slot: "brain",
  }, "deescalate")
  assert.equal(args.model, "test/cheap", "routing is bidirectional -- a brain baseline must not get stuck on a trivial prompt")
})

test("the envelope is a hard bound: the ML cannot route outside the declared pipeline", async () => {
  const args = await routePrecedenceTask(PRECEDENCE_COMPLEX, {
    active_slot: "medium",
    optimization_mode: "vibemax",
    active_pipeline: ["medium"],
    route_path: ["medium"],
    worker_slot: "medium",
    selected_slot: "medium",
  }, "bound")
  assert.equal(args.model, "test/medium", "a single-tier envelope wins over the ML verdict")
})
