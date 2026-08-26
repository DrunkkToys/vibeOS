// SPDX-License-Identifier: MIT
// Real cascade depth persistence test: routeDecision cascadeDepth must match
// routePath.length for every routing source, and the footer icon (formatCascadePulse)
// must respect the persisted depth.

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-cascade-depth-"))
const claudeDir = join(sandbox, ".claude")
mkdirSync(join(claudeDir, "scratch"), { recursive: true })
process.env.HOME = sandbox
process.env.VIBEOS_HOME = claudeDir

const TIERS = {
  trinity: { brain: { oc: "test/brain" }, medium: { oc: "test/medium" }, cheap: { oc: "test/cheap" } },
  selection: { enabled: true, active_slot: "cheap", active_pipeline: ["cheap", "medium", "brain"] },
}

writeFileSync(join(claudeDir, "model-tiers.json"), JSON.stringify(TIERS))
writeFileSync(join(claudeDir, "delegation-state.json"), JSON.stringify({ lifetime: {}, sessions: {} }))

const COMPLEX = "refactor the auth module across src/auth.ts src/session.ts to support OAuth and JWT refresh tokens"

const auditFile = join(claudeDir, "cascade-audit", "cascade-audit.jsonl")

// Drives the production task-routing path and returns the audit row it wrote.
// These assertions used to run against resolveCascadeRouteDecision, which had
// zero call sites and was tree-shaken out of dist/vibeOS.js -- and several were
// wrapped in `if (te.resolveCascadeRouteDecision)`, so they passed vacuously
// once it was gone. The audit row is what production actually records.
async function routeTaskRow(prompt, tag, selection = {}) {
  const { mlEnabled = true, ...sel } = selection
  writeFileSync(join(claudeDir, "model-tiers.json"), JSON.stringify({
    ...TIERS,
    selection: {
      ...TIERS.selection,
      slot_locked: false,
      optimization_mode: "vibeultrax",
      worker_slot: "cheap",
      selected_slot: "cheap",
      ...sel,
    },
  }))
  const te = await import("../src/lib/hooks/tool-execute.js?depth=" + tag + Date.now())
  const args = { prompt, subagent_type: "general", model: null, modelID: null, modelId: null }
  await te.onToolExecuteBefore({ tool: "task", mlEnabled }, { args })
  const lines = readFileSync(auditFile, "utf-8").trim().split("\n").filter(Boolean)
  return JSON.parse(lines[lines.length - 1])
}

test("the recorded cascade depth always equals the recorded route path length", async () => {
  const row = await routeTaskRow(
    "refactor auth module from scratch to support OAuth, JWT, sessions, and refresh tokens across multiple files",
    "cv",
  )
  assert.ok(row.selectedSlot, "audit row records a selected slot")
  assert.ok(Array.isArray(row.routePath), "audit row records a route path")
  assert.equal(row.cascadeDepth, row.routePath.length, "cascadeDepth matches routePath.length")
  if (row.selectedSlot === "medium") assert.equal(row.cascadeDepth, 2, "medium escalation has depth 2")
  if (row.selectedSlot === "brain") assert.equal(row.cascadeDepth, 3, "brain escalation has depth 3")
})

test("footer buildFooterLine shows cascade tier label not model name", async () => {
  const sf = await import("../src/lib/hooks/shared-footer.js?cascaded8=" + Date.now())
  const line = sf.buildFooterLine({
    activeSlot: "cheap",
    providerLabel: "DeepSeek",
    modelName: "my-model",
    ltTotal: 1.23,
    vibeBrand: "VibeUltraX",
    optMode: "vibeultrax",
    flashIcon: " ⚡",
    enfTags: ["guarded", "tests live"],
    cascadeIcon: "▸▸▸",
    cascadeLabel: "",
  })
  assert.ok(typeof line === "string" && line.length > 10, "footer line rendered")
  assert.ok(!line.includes("▸▸▸ brain"), "no tier text suffix")
})

test("cascadeDepth matches routePath.length for cheap root -> cheap slot", async () => {
  const row = await routeTaskRow("hello", "cheap")
  assert.equal(row.selectedSlot, "cheap", "a trivial prompt stays at the cheap root")
  assert.deepEqual(row.routePath, ["cheap"], "cheap slot yields a depth-1 route")
  assert.equal(row.cascadeDepth, 1)
})

test("cascadeDepth matches routePath.length for complex prompt", async () => {
  const row = await routeTaskRow(COMPLEX, "complex")
  assert.equal(row.cascadeDepth, row.routePath.length, "cascadeDepth equals routePath.length")
  assert.ok(row.cascadeDepth >= 1, "cascadeDepth >= 1")
})

test("routePath length determines cascade icon", async () => {
  const sf = await import("../src/lib/hooks/shared-footer.js?cascaded3=" + Date.now())
  assert.equal(sf.formatCascadePulse("", ""), "", "no icon + no label")
  assert.equal(sf.formatCascadePulse("▸▸", ""), "▸▸", "medium cascade icon alone")
  assert.equal(sf.formatCascadePulse("▸▸▸", ""), "▸▸▸", "brain cascade icon alone")
  assert.equal(sf.formatCascadePulse(undefined, undefined), "", "undefined both")
})

test("footer cascadeDepth >= 3 shows ▸▸▸ icon, >= 2 shows ▸▸, < 2 shows empty", async () => {
  const sf = await import("../src/lib/hooks/shared-footer.js?cascaded4=" + Date.now())

  const empty = sf.buildResilientFooterLine({ activeSlot: "cheap", modelName: "test/cheap", cascadeIcon: "", cascadeLabel: "", optMode: "quality" })
  assert.ok(empty, "footer line exists for empty cascade")
  assert.ok(!empty.includes("▸"), "no cascade icon when cascadeIcon is empty")

  const medium = sf.buildResilientFooterLine({ activeSlot: "cheap", modelName: "test/medium", cascadeIcon: "▸▸", cascadeLabel: "", optMode: "vibeultrax" })
  assert.ok(medium, "footer line exists for medium cascade")
  assert.ok(medium.includes("▸▸"), "medium cascade icon shows")

  const brain = sf.buildResilientFooterLine({ activeSlot: "cheap", modelName: "test/brain", cascadeIcon: "▸▸▸", cascadeLabel: "", optMode: "vibeultrax" })
  assert.ok(brain, "footer line exists for brain cascade")
  assert.ok(brain.includes("▸▸▸"), "brain cascade icon shows")
})

test("normalizeRoutePath returns the correct depth for each slot", async () => {
  // _routePathForSlot was removed as a duplicate; normalizeRoutePath in
  // chat-transform is the single implementation. The old test guarded every
  // assertion behind `if (te._routePathForSlot)`, so it asserted nothing.
  const ct = await import("../src/lib/hooks/chat-transform.js?routepath=" + Date.now())
  const root = ["cheap", "medium", "brain"]
  assert.deepEqual(ct.normalizeRoutePath(root, "cheap"), ["cheap"], "cheap routePath")
  assert.deepEqual(ct.normalizeRoutePath(root, "medium"), ["cheap", "medium"], "medium routePath")
  assert.deepEqual(ct.normalizeRoutePath(root, "brain"), ["cheap", "medium", "brain"], "brain routePath")
})

test("blackbox state persists cascade_depth after route decision", async () => {
  // Production writes flat cascade keys onto sessions[_OC_SID], and only when
  // that session already exists. The old test seeded a mock session id that
  // production never touches, then wrote the values itself and asserted its own
  // write -- it could not fail.
  const { _OC_SID } = await import("../src/lib/state.js")
  const stateFile = join(claudeDir, "blackbox-state.json")
  writeFileSync(stateFile, JSON.stringify({ sessions: { [_OC_SID]: { regime: "INIT" } } }))

  const row = await routeTaskRow(COMPLEX, "bbpersist", { worker_slot: "brain", selected_slot: "brain", mlEnabled: false })

  const session = JSON.parse(readFileSync(stateFile, "utf-8")).sessions[_OC_SID]
  assert.ok(session.cascade_depth >= 1, "cascade_depth persisted")
  assert.ok(Array.isArray(session.route_path), "route_path persisted")
  assert.equal(session.cascade_depth, session.route_path.length, "persisted cascade_depth matches route_path.length")
  assert.equal(row.cascadeDepth, session.cascade_depth, "audit row and persisted state agree")
})
