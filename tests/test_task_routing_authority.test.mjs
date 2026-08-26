// SPDX-License-Identifier: MIT
// Task routing authority, tested against the path that actually routes Tasks:
// the `tool.execute.before` task branch, asserted through the model that lands
// on the tool args.
//
// This suite previously asserted resolveCascadeRouteDecision, which had zero
// call sites and was tree-shaken out of dist/vibeOS.js -- it was green against
// code that never shipped. The assertions below drive the production hook.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
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

const CHEAP = "opencode/big-pickle"
const MEDIUM = "opencode-go/mimo-v2.5"
const BRAIN = "deepseek/deepseek-v4-flash"

const COMPLEX = "implement a complex distributed migration with concurrency race condition deadlock byzantine fault tolerance paxos raft consensus CRDT eventual consistency circuit breaker observability security vulnerability exploit injection authentication authorization database schema migration kubernetes docker container orchestration microservice architecture refactor across src/lib/hooks/tool-execute.ts src/lib/hooks/chat-transform.ts src/lib/pricing.ts package.json tsconfig.json"
const TRIVIAL = "check status"

function withSandbox(name, selection) {
  const sandbox = mkdtempSync(join(tmpdir(), name))
  const old = {
    HOME: process.env.HOME,
    VIBEOS_HOME: process.env.VIBEOS_HOME,
    CLAUDE_CREDIT_PERCENT: process.env.CLAUDE_CREDIT_PERCENT,
  }
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  process.env.CLAUDE_CREDIT_PERCENT = "100"
  mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
  mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
  writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({
    model: CHEAP, plugin: ["vibeOS"],
  }, null, 2))
  writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
    selection: { enabled: true, slot_locked: false, ...selection },
    trinity: { cheap: { oc: CHEAP }, medium: { oc: MEDIUM }, brain: { oc: BRAIN } },
    tiers: {
      high: { regex: "v4-flash|pro|opus|brain" },
      mid: { regex: "mimo|flash|sonnet|medium" },
      budget: { regex: "big-pickle|cheap|chat" },
    },
  }, null, 2))
  loadTrinitySlotsFromTiersFile()
  // tool-execute.ts:700 gates the whole Task routing block on a truthy
  // currentModel, which _refreshModel resolves from readConfig(projectDirectory)
  // -- and projectDirectory falls back to cwd, the repo root. The repo root's
  // opencode.json is gitignored, so on a dev machine it supplied a model and the
  // block ran, while on a clean runner currentModel stayed null and the block was
  // skipped entirely (null model, no audit row, no route log). Set it here so the
  // sandbox is self-contained instead of borrowing host state.
  setCurrentModel(CHEAP)
  setCurrentTier("budget")
  return {
    cleanup() {
      for (const [k, v] of Object.entries(old)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      rmSync(sandbox, { recursive: true, force: true })
    },
  }
}

async function routeTask(prompt, tag, extraInput = {}) {
  const mod = await import("../src/lib/hooks/tool-execute.js?taskroute=" + tag + Date.now())
  const args = { prompt, subagent_type: "general", model: null, modelID: null, modelId: null }
  await mod.onToolExecuteBefore({ tool: "task", ...extraInput }, { args })
  return args
}

// ── The fix: the ML envelope is no longer vibeultrax-only ──

test("vibemax: the ML de-escalates a trivial Task inside the span the backend opened", async () => {
  // Production-reachable shape, taken from a live ~/.vibeos/model-tiers.json:
  // vibemax ("medium tier auto-escalate") where the backend selected brain, so
  // normalizeRoutePath persisted route_path ["medium","brain"]. Reading
  // active_pipeline alone pinned the envelope to ["medium"], which excludes the
  // brain baseline, so no adjustment was possible in either direction.
  //
  // Note route_path is clamped at the selected slot (normalizeRoutePath slices
  // to idx+1), so it never reaches ABOVE the backend's pick. The reachable win
  // is de-escalation within that span, not escalation past the backend.
  const ctx = withSandbox("vibeos-route-vibemax-", {
    active_slot: "brain",
    optimization_mode: "vibemax",
    active_pipeline: ["medium"],
    route_path: ["medium", "brain"],
    worker_slot: "brain",
    selected_slot: "brain",
  })
  try {
    const args = await routeTask(TRIVIAL, "vibemax")
    assert.equal(args.model, MEDIUM,
      "a confident trivial verdict must pull the Task off the brain baseline down to the envelope floor\n" +
      routeDiag({ case: "vibemax de-escalation", expected: MEDIUM, got: args.model }))
    assert.equal(args.modelID, MEDIUM)
    assert.equal(args.modelId, MEDIUM)
  } finally {
    ctx.cleanup()
  }
})

test("vibeqmax: an explicitly single-tier mode is not de-escalated by a trivial prompt", async () => {
  const ctx = withSandbox("vibeos-route-vibeqmax-", {
    active_slot: "brain",
    optimization_mode: "vibeqmax",
    active_pipeline: ["brain"],
    route_path: ["brain"],
    worker_slot: "brain",
    selected_slot: "brain",
  })
  try {
    const args = await routeTask(TRIVIAL, "vibeqmax")
    assert.equal(args.model, BRAIN, "vibeqmax means brain only -- the ML must not route out of the declared envelope\n" +
      routeDiag({ case: "vibeqmax hard bound", expected: BRAIN, got: args.model }))
  } finally {
    ctx.cleanup()
  }
})

// ── Baseline authority: the control vector is the floor the ML adjusts from ──

test("the control vector's worker slot is what routes a Task when the ML does not adjust", async () => {
  // mlEnabled:false isolates the baseline. With the ML on, "check status" is
  // genuinely trivial and a medium baseline is *supposed* to de-escalate to
  // cheap -- that bidirectional behaviour is covered in
  // vibeultrax_subagent_cascade.test.mjs.
  const ctx = withSandbox("vibeos-route-cv-", {
    active_slot: "cheap",
    optimization_mode: "vibeultrax",
    active_pipeline: ["cheap", "medium", "brain"],
    route_path: ["cheap", "medium"],
    worker_slot: "medium",
    selected_slot: "medium",
  })
  try {
    const args = await routeTask(TRIVIAL, "cv", { mlEnabled: false })
    assert.equal(args.model, MEDIUM, "worker_slot is the single source of truth for the baseline\n" +
      routeDiag({ case: "control-vector baseline", expected: MEDIUM, got: args.model }))
  } finally {
    ctx.cleanup()
  }
})

test("task routing is deterministic for the same live input", async () => {
  const selection = {
    active_slot: "cheap",
    optimization_mode: "vibeultrax",
    active_pipeline: ["cheap", "medium", "brain"],
    worker_slot: "cheap",
    selected_slot: "cheap",
  }
  const a = withSandbox("vibeos-route-det-a-", selection)
  let first
  try { first = (await routeTask(COMPLEX, "det-a")).model } finally { a.cleanup() }
  const b = withSandbox("vibeos-route-det-b-", selection)
  let second
  try { second = (await routeTask(COMPLEX, "det-b")).model } finally { b.cleanup() }
  assert.equal(second, first)
})
