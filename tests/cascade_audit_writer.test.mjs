// SPDX-License-Identifier: MIT
// The live ML cascade made routing decisions but wrote NO audit trail: cascade-audit/cascade-audit.jsonl never
// existed in VIBEOS_HOME, yet session-health.ts's evaluateClaimEvidence reads
// it to substantiate "tests pass / I fixed it" claims. This pins the writer:
// every cascade decision appends a JSONL line with a parseable _ts that the
// verifier can correlate.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs"
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

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-cascade-audit-"))
const prevHome = process.env.VIBEOS_HOME
process.env.VIBEOS_HOME = join(sandbox, ".claude")
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })

const te = await import("../src/lib/hooks/tool-execute.js?cascadeaudit=" + Date.now())
const cv = await import("../src/lib/session-health.js?cascadeaudit=" + Date.now())
const auditFile = join(sandbox, ".claude", "cascade-audit", "cascade-audit.jsonl")

after(() => {
  try { process.env.VIBEOS_HOME = prevHome } catch {}
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})

const COMPLEX = "refactor the authentication module across src/auth.ts src/session.ts and src/db.ts to support OAuth and JWT refresh tokens with rate limiting while keeping backward compatibility and updating every related test file"

// Driven through the production task-routing hook. This suite used to trigger
// the write via resolveCascadeRouteDecision, which had zero call sites and was
// tree-shaken out of dist/vibeOS.js, so the audit trail it asserted was never
// the one production writes.
writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
  selection: {
    enabled: true,
    slot_locked: false,
    active_slot: "cheap",
    optimization_mode: "vibeultrax",
    active_pipeline: ["cheap", "medium", "brain"],
    worker_slot: "brain",
    selected_slot: "brain",
  },
  trinity: {
    cheap: { oc: "opencode/big-pickle" },
    medium: { oc: "deepseek/deepseek-v4-flash" },
    brain: { oc: "deepseek/deepseek-v4-pro" },
  },
}, null, 2))
loadTrinitySlotsFromTiersFile()
// tool-execute.ts:700 gates the whole Task routing block on a truthy
// currentModel. Set it explicitly: it used to be inherited from whatever
// OpenCode config the host machine happened to have, so these suites passed
// on a dev box and skipped routing entirely on a clean runner.
setCurrentModel("testprov/orchestrator")
setCurrentTier("budget")

test("[cascade-audit] a cascade decision appends a parseable _ts line", async () => {
  const args = { prompt: COMPLEX, subagent_type: "general", model: null, modelID: null, modelId: null }
  await te.onToolExecuteBefore({ tool: "task", mlEnabled: false }, { args })
  if (!args.model && !args.modelID && !args.modelId) {
    // The hook produced no model. Dump what it saw so a CI-only failure
    // names its cause instead of just asserting null.
    console.log("ROUTE_DIAG " + routeDiag({ suite: "cascade_audit_writer.test.mjs" }))
  }
  assert.ok(existsSync(auditFile), "cascade-audit.jsonl must be written")
  const lines = readFileSync(auditFile, "utf-8").trim().split("\n").filter(Boolean)
  assert.ok(lines.length >= 1, "at least one audit line")
  const entry = JSON.parse(lines[lines.length - 1])
  assert.ok(entry._ts && Number.isFinite(new Date(entry._ts).getTime()), "_ts must be date-parseable")
  assert.ok("sessionId" in entry, "entry records session identity")
  assert.ok("turnId" in entry, "entry records turn identity")
  assert.ok("selectedSlot" in entry, "entry records the selected slot")
  assert.ok("selectedModel" in entry, "entry records the selected model")
  assert.ok("source" in entry, "entry records the route source")
  assert.ok(Array.isArray(entry.routePath), "entry records a joinable route path")
  assert.equal(typeof entry.slot, "string")
  assert.ok("escalate" in entry, "entry records the escalate decision")
  assert.ok("confidence" in entry, "entry records confidence")
  assert.ok("difficulty_score" in entry, "entry records the local difficulty snapshot")
  assert.ok("difficulty_confidence" in entry, "entry records the local confidence snapshot")
})

test("[cascade-audit] the written line substantiates a claim within the window", () => {
  const res = cv.evaluateClaimEvidence({
    text: "I fixed it and all tests are passing",
    vibeHome: join(sandbox, ".claude"),
    sessionId: "",
    now: Date.now(),
    windowMs: 120000,
  })
  assert.equal(res.unsubstantiatedCount, 0, "recent cascade run should substantiate the claim")
  assert.equal(res.claimTag, "✓ evidence")
})
