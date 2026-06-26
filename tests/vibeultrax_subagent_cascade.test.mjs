// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function withSandbox(name) {
  const sandbox = mkdtempSync(join(tmpdir(), name))
  const oldHome = process.env.HOME
  const oldVibeHome = process.env.VIBEOS_HOME
  const oldCredit = process.env.CLAUDE_CREDIT_PERCENT
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  process.env.CLAUDE_CREDIT_PERCENT = "100"
  mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
  mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
  writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({
    model: "opencode/big-pickle",
    plugin: ["vibeOS"],
  }, null, 2))
  writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: "cheap",
      slot_locked: false,
      optimization_mode: "vibeultrax",
      active_pipeline: ["cheap", "medium", "brain"],
    },
    trinity: {
      cheap: { oc: "opencode/big-pickle" },
      medium: { oc: "opencode-go/mimo-v2.5" },
      brain: { oc: "deepseek/deepseek-v4-flash" },
    },
    tiers: {
      high: { regex: "v4-flash|pro|opus|brain" },
      mid: { regex: "mimo|flash|sonnet|medium" },
      budget: { regex: "big-pickle|cheap|chat" },
    },
  }, null, 2))
  return {
    sandbox,
    ocConfig: join(sandbox, ".config", "opencode", "opencode.json"),
    cleanup() {
      if (oldHome === undefined) delete process.env.HOME
      else process.env.HOME = oldHome
      if (oldVibeHome === undefined) delete process.env.VIBEOS_HOME
      else process.env.VIBEOS_HOME = oldVibeHome
      if (oldCredit === undefined) delete process.env.CLAUDE_CREDIT_PERCENT
      else process.env.CLAUDE_CREDIT_PERCENT = oldCredit
      rmSync(sandbox, { recursive: true, force: true })
    },
  }
}

test("vibeultrax sync installs tier subagents with trinity models", async () => {
  const ctx = withSandbox("vibeos-tier-agents-")
  try {
    const mod = await import("../src/lib/hooks/chat-transform.js?tier-agents=" + Date.now())
    const result = mod.syncControlSettings({
      optimization_mode: "vibeultrax",
      tier_bias: "cheap",
      selected_slot: "brain",
      selected_model: "deepseek/deepseek-v4-flash",
      route_path: ["cheap", "medium", "brain"],
      cascade_root: ["cheap", "medium", "brain"],
      enforcement_mode: "strict",
      flow_mode: "strict",
      tdd_mode: "quality",
      thinking_mode: "full",
    }, { authoritative: true })

    const oc = JSON.parse(readFileSync(ctx.ocConfig, "utf8"))
    assert.equal(oc.agent["vibe-cheap"].mode, "subagent")
    assert.equal(oc.agent["vibe-cheap"].model, "opencode/big-pickle")
    assert.equal(oc.agent["vibe-medium"].mode, "subagent")
    assert.equal(oc.agent["vibe-medium"].model, "opencode-go/mimo-v2.5")
    assert.equal(oc.agent["vibe-brain"].mode, "subagent")
    assert.equal(oc.agent["vibe-brain"].model, "deepseek/deepseek-v4-flash")
    assert.equal(result.selected_subagent, "vibe-brain")
    assert.equal(result.requires_delegation, true)
  } finally {
    ctx.cleanup()
  }
})

test("vibeultrax task routing uses tier subagent_type and legacy model fields", async () => {
  const ctx = withSandbox("vibeos-tier-task-")
  try {
    const mod = await import("../src/index.js?tier-task=" + Date.now())
    const hooks = await mod.DelegationEnforcer({ client: {}, directory: ctx.sandbox })
    const chat = await import("../src/lib/hooks/chat-transform.js?tier-task-sync=" + Date.now())
    chat.syncControlSettings({
      optimization_mode: "vibeultrax",
      tier_bias: "cheap",
      selected_slot: "brain",
      selected_model: "deepseek/deepseek-v4-flash",
      selected_subagent: "vibe-brain",
      route_path: ["cheap", "medium", "brain"],
      cascade_root: ["cheap", "medium", "brain"],
      enforcement_mode: "strict",
      flow_mode: "strict",
      tdd_mode: "quality",
      thinking_mode: "full",
    }, { authoritative: true })

    const args = {
      description: "Fix cascade",
      prompt: "implement a complex multi-file cascade repair with concurrency migration rollback tests distributed consensus raft leader election byzantine fault tolerance paxos protocol CRDT eventual consistency deadlock race condition circuit breaker observability production recovery across src/lib/hooks/tool-execute.ts src/lib/hooks/chat-transform.ts src/lib/pricing.ts",
      subagent_type: "general",
      model: null,
      modelID: null,
      modelId: null,
    }
    await hooks["tool.execute.before"]({ tool: "task" }, { args })

    assert.equal(args.subagent_type, "vibe-brain")
    assert.equal(args.model, "deepseek/deepseek-v4-flash")
    assert.equal(args.modelID, "deepseek/deepseek-v4-flash")
    assert.equal(args.modelId, "deepseek/deepseek-v4-flash")
  } finally {
    ctx.cleanup()
  }
})

test("vibeultrax medium route selects vibe-medium and stress can upgrade cheap delegation", async () => {
  const mod = await import("../src/lib/hooks/tool-execute.js?tier-route=" + Date.now())

  const medium = mod.resolveCascadeRouteDecision({
    prompt: "implement auth validation and integration tests",
    firstWord: "implement",
    currentTier: "budget",
    currentModel: "opencode/big-pickle",
    trinityCheap: "opencode/big-pickle",
    trinityMedium: "opencode-go/mimo-v2.5",
    trinityBrain: "deepseek/deepseek-v4-flash",
    activePipeline: ["cheap", "medium", "brain"],
    backendRoute: null,
    stressScore: 0,
    localRoutingAllowed: true,
    hasMedia: false,
    exploratoryTarget: null,
    tierTarget: "opencode-go/mimo-v2.5",
    mlEnabled: true,
    mlConfidenceThreshold: 0.6,
  })
  assert.equal(medium.selectedSlot, "medium")
  assert.equal(medium.selectedSubagent, "vibe-medium")
  assert.equal(medium.requiresDelegation, true)

  const stressed = mod.resolveCascadeRouteDecision({
    prompt: "check status",
    firstWord: "check",
    currentTier: "budget",
    currentModel: "opencode/big-pickle",
    trinityCheap: "opencode/big-pickle",
    trinityMedium: "opencode-go/mimo-v2.5",
    trinityBrain: "deepseek/deepseek-v4-flash",
    activePipeline: ["cheap", "medium", "brain"],
    backendRoute: null,
    stressScore: 0.8,
    localRoutingAllowed: true,
    hasMedia: false,
    exploratoryTarget: "opencode/big-pickle",
    tierTarget: "opencode/big-pickle",
    mlEnabled: true,
    mlConfidenceThreshold: 0.6,
  })
  assert.equal(stressed.selectedSlot, "medium")
  assert.equal(stressed.selectedSubagent, "vibe-medium")
  assert.equal(stressed.requiresDelegation, true)
})
