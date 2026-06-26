// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

test("vibeultrax control vector keeps durable cascade root for simple route", async () => {
  const vu = await import("../src/vibeOS-lib/blackbox/vibeultrax.js?route-root=" + Date.now())
  const cv = vu.vibeultraxControlVector({ user_text: "hello" })

  assert.deepEqual(cv.cascade_root, ["cheap", "medium", "brain"])
  assert.deepEqual(cv.route_path, ["cheap"])
  assert.deepEqual(cv.pipeline_root, ["cheap", "medium", "brain"])
  assert.equal(cv.selected_slot, "cheap")
  assert.equal(cv.tier_bias, "cheap")
})

test("vibeultrax complex route selects brain without moving the root slot", async () => {
  const vu = await import("../src/vibeOS-lib/blackbox/vibeultrax.js?route-root-complex=" + Date.now())
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

    const mod = await import("../src/lib/hooks/chat-transform.js?route-sync=" + Date.now())
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

test("sync keeps vibeultrax root slot cheap when per-turn route selects brain", async () => {
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

    const mod = await import("../src/lib/hooks/chat-transform.js?route-root-slot=" + Date.now())
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
    assert.equal(raw.selection.active_slot, "cheap")
    assert.equal(raw.selection.vector_changed_slot, "cheap")
    assert.deepEqual(raw.selection.active_pipeline, ["cheap", "medium", "brain"])
    assert.equal(result.applied_slot, "cheap")
    assert.equal(result.selected_slot, "brain")
    assert.deepEqual(result.route_path, ["cheap", "medium", "brain"])
  } finally {
    if (oldHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = oldHome
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test("route resolver upgrades backend cheap hint for complex vibeultrax task", async () => {
  const mod = await import("../src/lib/hooks/tool-execute.js?route-resolver=" + Date.now())
  const decision = mod.resolveCascadeRouteDecision({
    prompt: "fix refactor implement migrate validate the critical production crash error panic failure bug in src/lib/hooks/tool-execute.ts src/lib/hooks/chat-transform.ts src/lib/pricing.ts src/vibeOS-lib/ml-router.ts tests/cascade_route_contract.test.mjs with distributed consensus protocol raft leader election gossip protocol byzantine fault tolerance paxos algorithm eventual consistency CRDT data structures rollback observability retry circuit breaker concurrency race condition deadlock",
    firstWord: "fix",
    currentTier: "high",
    currentModel: "test/cheap",
    trinityCheap: "test/cheap",
    trinityMedium: "test/medium",
    trinityBrain: "test/brain",
    activePipeline: ["cheap", "medium", "brain"],
    backendRoute: { target: "test/cheap", confidence: 0.4, explicit: false },
    stressScore: 0,
    localRoutingAllowed: true,
    hasMedia: false,
    exploratoryTarget: null,
    tierTarget: "test/cheap",
    mlEnabled: true,
    mlConfidenceThreshold: 0.6,
  })

  assert.equal(decision.selectedSlot, "brain")
  assert.equal(decision.selectedModel, "test/brain")
  assert.deepEqual(decision.cascadeRoot, ["cheap", "medium", "brain"])
  assert.deepEqual(decision.routePath, ["cheap", "medium", "brain"])
  assert.ok(decision.localConfidence >= 0.7)
})

test("route resolver stress-upgrades cheap without collapsing cascade root", async () => {
  const mod = await import("../src/lib/hooks/tool-execute.js?route-stress=" + Date.now())
  const decision = mod.resolveCascadeRouteDecision({
    prompt: "check current status",
    firstWord: "check",
    currentTier: "budget",
    currentModel: "test/cheap",
    trinityCheap: "test/cheap",
    trinityMedium: "test/medium",
    trinityBrain: "test/brain",
    activePipeline: ["cheap", "medium", "brain"],
    backendRoute: null,
    stressScore: 0.8,
    localRoutingAllowed: true,
    hasMedia: false,
    exploratoryTarget: "test/cheap",
    tierTarget: "test/cheap",
    mlEnabled: true,
    mlConfidenceThreshold: 0.6,
  })

  assert.equal(decision.selectedSlot, "medium")
  assert.equal(decision.selectedModel, "test/medium")
  assert.deepEqual(decision.cascadeRoot, ["cheap", "medium", "brain"])
  assert.deepEqual(decision.routePath, ["cheap", "medium"])
})
