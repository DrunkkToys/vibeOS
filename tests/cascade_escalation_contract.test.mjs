// SPDX-License-Identifier: MIT
// Locks the live cascade escalation contract. The handed-in finding claimed
// "escalation never fires because requires_delegation is only true for
// medium/brain". In reality the per-message ML difficulty adjustment escalates
// from the cheap pipeline root for a complex prompt and stays cheap for a
// simple one. This test pins that so the cascade cannot silently regress to
// never-escalating.
//
// Previously asserted against resolveCascadeRouteDecision, which had zero call
// sites and was tree-shaken out of dist/vibeOS.js. Now driven through the
// production hook -- the model that lands on the task args is the contract.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
const MEDIUM = "deepseek/deepseek-v4-flash"
const BRAIN = "deepseek/deepseek-v4-pro"

// The production gate is `confidence >= ML_CONFIDENCE_THRESHOLD (0.6) &&
// level !== "moderate"`, so escalation needs a prompt the ML rates complex
// *with confidence* -- weak signals deliberately leave the tier alone rather
// than churning it. This one scores level=complex, confidence=0.7, tier=brain.
const COMPLEX = "refactor the authentication module across src/auth.ts src/session.ts src/db.ts and src/middleware.ts to support OAuth and JWT refresh tokens with rate limiting, fix the race condition and deadlock crash in the distributed session store, migrate the database schema with a concurrency-safe rollback, harden the injection vulnerability, and update every related test file and config in package.json tsconfig.json"
const SIMPLE = "what does this function do"

function withSandbox(name) {
  const sandbox = mkdtempSync(join(tmpdir(), name))
  const prev = { HOME: process.env.HOME, VIBEOS_HOME: process.env.VIBEOS_HOME }
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
  mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
  writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({ model: CHEAP }, null, 2))
  writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
    selection: {
      enabled: true,
      slot_locked: false,
      active_slot: "cheap",
      optimization_mode: "vibeultrax",
      active_pipeline: ["cheap", "medium", "brain"],
      worker_slot: "cheap",
      selected_slot: "cheap",
    },
    trinity: { cheap: { oc: CHEAP }, medium: { oc: MEDIUM }, brain: { oc: BRAIN } },
    tiers: {
      high: { regex: "v4-pro|opus|brain" },
      mid: { regex: "v4-flash|mimo|sonnet|medium" },
      budget: { regex: "big-pickle|cheap|chat" },
    },
  }, null, 2))
  loadTrinitySlotsFromTiersFile()
  // tool-execute.ts:700 gates the whole Task routing block on a truthy
  // currentModel. Set it explicitly: it used to be inherited from whatever
  // OpenCode config the host machine happened to have, so these suites passed
  // on a dev box and skipped routing entirely on a clean runner.
  setCurrentModel(CHEAP)
  setCurrentTier("budget")
  return {
    cleanup() {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      rmSync(sandbox, { recursive: true, force: true })
    },
  }
}

async function routeTask(prompt, tag) {
  const te = await import("../src/lib/hooks/tool-execute.js?escalation=" + tag + Date.now())
  const args = { prompt, subagent_type: "general", model: null, modelID: null, modelId: null }
  await te.onToolExecuteBefore({ tool: "task" }, { args })
  if (!args.model && !args.modelID && !args.modelId) {
    // The hook produced no model. Dump what it saw so a CI-only failure
    // names its cause instead of just asserting null.
    console.log("ROUTE_DIAG " + routeDiag({ suite: "cascade_escalation_contract.test.mjs" }))
  }
  return args
}

test("[escalation] a complex prompt from cheap root delegates to medium/brain", async () => {
  const ctx = withSandbox("vibeos-escalation-complex-")
  try {
    const args = await routeTask(COMPLEX, "complex")
    assert.ok([MEDIUM, BRAIN].includes(args.model), `expected medium|brain model, got ${args.model}`)
  } finally {
    ctx.cleanup()
  }
})

test("[escalation] a simple prompt stays cheap with no delegation", async () => {
  const ctx = withSandbox("vibeos-escalation-simple-")
  try {
    const args = await routeTask(SIMPLE, "simple")
    assert.equal(args.model, CHEAP, `expected cheap model, got ${args.model}`)
  } finally {
    ctx.cleanup()
  }
})
