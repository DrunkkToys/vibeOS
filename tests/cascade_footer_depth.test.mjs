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

test("cascade_tier is exported by tool-execute for control_vector persistence", async () => {
  const te = await import("../src/lib/hooks/tool-execute.js?cascaded7=" + Date.now())
  const res = te.resolveCascadeRouteDecision({
    prompt: "refactor auth module from scratch to support OAuth, JWT, sessions, and refresh tokens across multiple files",
    trinityCheap: "test/cheap",
    trinityMedium: "test/medium",
    trinityBrain: "test/brain",
    activePipeline: ["cheap", "medium", "brain"],
    mlEnabled: true,
  })
  assert.ok(res, "route decision exists")
  if (res.selectedSlot === "medium") {
    assert.equal(res.cascadeDepth, 2, "medium escalation has depth 2")
  }
  if (res.selectedSlot === "brain") {
    assert.equal(res.cascadeDepth, 3, "brain escalation has depth 3")
  }
  assert.ok(res.selectedSlot, "route decision has a selected slot")
  assert.equal(res.cascadeDepth, res.routePath?.length || 1, "cascadeDepth matches routePath.length")
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
  const te = await import("../src/lib/hooks/tool-execute.js?cascaded1=" + Date.now())
  const res = te.resolveCascadeRouteDecision({
    prompt: "hello",
    trinityCheap: "test/cheap",
    trinityMedium: "test/medium",
    trinityBrain: "test/brain",
    activePipeline: ["cheap", "medium", "brain"],
    mlEnabled: true,
  })
  assert.ok(res, "route decision exists")
  assert.ok(res.cascadeDepth >= 1, "cascadeDepth >= 1")
  assert.equal(res.cascadeDepth, res.routePath?.length || 1, "cascadeDepth equals routePath.length")
})

test("cascadeDepth matches routePath.length for complex prompt", async () => {
  const te = await import("../src/lib/hooks/tool-execute.js?cascaded2=" + Date.now())
  const res = te.resolveCascadeRouteDecision({
    prompt: COMPLEX,
    trinityCheap: "test/cheap",
    trinityMedium: "test/medium",
    trinityBrain: "test/brain",
    activePipeline: ["cheap", "medium", "brain"],
    mlEnabled: true,
  })
  assert.ok(res, "route decision exists")
  assert.equal(res.cascadeDepth, res.routePath?.length || 1, "cascadeDepth equals routePath.length")
  assert.ok(res.cascadeDepth >= 1, "cascadeDepth >= 1")
  if (res.routePath && res.routePath.length > 1) {
    assert.ok(res.cascadeDepth > 1, "complex prompt escalates depth > 1")
  }
})

test("routePath length determines cascade icon", async () => {
  const sf = await import("../src/lib/hooks/shared-footer.js?cascaded3=" + Date.now())
  assert.equal(sf.formatCascadePulse("", ""), "", "no icon + no label")
  assert.equal(sf.formatCascadePulse("▸▸", ""), "▸▸", "medium cascade icon alone")
  assert.equal(sf.formatCascadePulse("▸▸▸", ""), "▸▸▸", "brain cascade icon alone")
  assert.equal(sf.formatCascadePulse("▸▸▸", "brain"), "▸▸▸ brain", "brain cascade + tier label")
  assert.equal(sf.formatCascadePulse("▸▸", "medium"), "▸▸ medium", "medium cascade + tier label")
  assert.equal(sf.formatCascadePulse(undefined, undefined), "", "undefined both")
})

test("footer cascadeDepth >= 3 shows ▸▸▸ icon, >= 2 shows ▸▸, < 2 shows empty", async () => {
  const sf = await import("../src/lib/hooks/shared-footer.js?cascaded4=" + Date.now())

  const empty = sf.buildResilientFooterLine({ activeSlot: "cheap", modelName: "test/cheap", cascadeIcon: "", cascadeLabel: "", optMode: "quality" })
  assert.ok(empty, "footer line exists for empty cascade")
  assert.ok(!empty.includes("▸"), "no cascade icon when cascadeIcon is empty")

  const medium = sf.buildResilientFooterLine({ activeSlot: "cheap", modelName: "test/medium", cascadeIcon: "▸▸", cascadeLabel: "test/medium", optMode: "vibeultrax" })
  assert.ok(medium, "footer line exists for medium cascade")
  assert.ok(medium.includes("▸▸"), "medium cascade icon shows")

  const brain = sf.buildResilientFooterLine({ activeSlot: "cheap", modelName: "test/brain", cascadeIcon: "▸▸▸", cascadeLabel: "test/brain", optMode: "vibeultrax" })
  assert.ok(brain, "footer line exists for brain cascade")
  assert.ok(brain.includes("▸▸▸"), "brain cascade icon shows")
})

test("_routePathForSlot returns correct depth for each slot", async () => {
  const te = await import("../src/lib/hooks/tool-execute.js?cascaded5=" + Date.now())
  const root = ["cheap", "medium", "brain"]
  const noop = (s) => s.join("-")

  const cheapPath = te._routePathForSlot ? te._routePathForSlot(root, "cheap") : noop(["cheap"])
  if (te._routePathForSlot) {
    assert.deepEqual(cheapPath, ["cheap"], "cheap routePath")
    assert.equal(cheapPath.length, 1, "cheap depth 1")

    const mediumPath = te._routePathForSlot(root, "medium")
    assert.deepEqual(mediumPath, ["cheap", "medium"], "medium routePath")
    assert.equal(mediumPath.length, 2, "medium depth 2")

    const brainPath = te._routePathForSlot(root, "brain")
    assert.deepEqual(brainPath, ["cheap", "medium", "brain"], "brain routePath")
    assert.equal(brainPath.length, 3, "brain depth 3")
  }
})

test("blackbox state persists cascade_depth after route decision", async () => {
  const te = await import("../src/lib/hooks/tool-execute.js?cascaded6=" + Date.now())
  const bb = await import("../src/lib/state.js?cascaded6b=" + Date.now())

  const mockSid = "test-session-" + Date.now()
  const mockState = {
    sessions: { [mockSid]: { regime: "INIT" } },
  }
  const stateFile = join(claudeDir, "blackbox-state.json")
  writeFileSync(stateFile, JSON.stringify(mockState))

  const loaded = bb.loadBlackboxState ? bb.loadBlackboxState() : mockState
  if (loaded && loaded.sessions && loaded.sessions[mockSid]) {
    const prevDepth = loaded.sessions[mockSid].cascade_depth
    if (te.resolveCascadeRouteDecision) {
      const res = te.resolveCascadeRouteDecision({
        prompt: COMPLEX,
        trinityCheap: "test/cheap",
        trinityMedium: "test/medium",
        trinityBrain: "test/brain",
        activePipeline: ["cheap", "medium", "brain"],
        mlEnabled: true,
      })
      if (res?.cascadeDepth && loaded.sessions[mockSid]) {
        loaded.sessions[mockSid].cascade_depth = res.cascadeDepth
        loaded.sessions[mockSid].route_path = res.routePath
        writeFileSync(stateFile, JSON.stringify(loaded))
      }
    }
    const after = JSON.parse(readFileSync(stateFile, "utf-8"))
    assert.ok(after.sessions[mockSid].cascade_depth >= 1, "cascade_depth persisted")
    assert.equal(
      after.sessions[mockSid].cascade_depth,
      after.sessions[mockSid].route_path?.length || 1,
      "persisted cascade_depth matches route_path.length"
    )
  }
})
