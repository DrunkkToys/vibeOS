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
  const oldDesktopHome = process.env.VIBEOS_OPENCODE_DESKTOP_HOME
  const oldCredit = process.env.CLAUDE_CREDIT_PERCENT
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  process.env.VIBEOS_OPENCODE_DESKTOP_HOME = join(sandbox, "Library", "Application Support", "ai.opencode.desktop")
  process.env.CLAUDE_CREDIT_PERCENT = "100"
  mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
  mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
  mkdirSync(join(sandbox, ".opencode"), { recursive: true })
  mkdirSync(join(sandbox, "Library", "Application Support", "ai.opencode.desktop"), { recursive: true })
  writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({
    model: "opencode/big-pickle",
    plugin: ["vibeOS"],
  }, null, 2))
  writeFileSync(join(sandbox, ".opencode", "opencode.json"), JSON.stringify({
    plugin: ["vibeOS"],
  }, null, 2))
  writeFileSync(join(sandbox, "Library", "Application Support", "ai.opencode.desktop", "opencode.json"), JSON.stringify({
    model: "deepseek/deepseek-v4-flash",
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
    dotConfig: join(sandbox, ".opencode", "opencode.json"),
    desktopConfig: join(sandbox, "Library", "Application Support", "ai.opencode.desktop", "opencode.json"),
    projectConfig: join(sandbox, "opencode.json"),
    cleanup() {
      if (oldHome === undefined) delete process.env.HOME
      else process.env.HOME = oldHome
      if (oldVibeHome === undefined) delete process.env.VIBEOS_HOME
      else process.env.VIBEOS_HOME = oldVibeHome
      if (oldDesktopHome === undefined) delete process.env.VIBEOS_OPENCODE_DESKTOP_HOME
      else process.env.VIBEOS_OPENCODE_DESKTOP_HOME = oldDesktopHome
      if (oldCredit === undefined) delete process.env.CLAUDE_CREDIT_PERCENT
      else process.env.CLAUDE_CREDIT_PERCENT = oldCredit
      rmSync(sandbox, { recursive: true, force: true })
    },
  }
}

test("vibeultrax sync installs the unified vibe primary agent plus tier subagents in all OpenCode configs", async () => {
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
    }, { authoritative: true, directory: ctx.sandbox })

    // Single global source of truth: ~/.opencode only, plus the project's own
    // opencode.json — .config/opencode and the desktop sidecar home are no
    // longer install targets (see src/lib/state.ts resolveOpenCodeHomes()).
    for (const configPath of [ctx.dotConfig, ctx.projectConfig]) {
      const oc = JSON.parse(readFileSync(configPath, "utf8"))
      assert.equal(oc.agent.vibe.mode, "primary", configPath)
      assert.equal(oc.agent.vibe.model, undefined, configPath)
      assert.equal(oc.agent["vibe-cheap"].mode, "subagent", configPath)
      assert.equal(oc.agent["vibe-cheap"].model, "opencode/big-pickle", configPath)
      assert.equal(oc.agent["vibe-medium"].mode, "subagent", configPath)
      assert.equal(oc.agent["vibe-medium"].model, "opencode-go/mimo-v2.5", configPath)
      assert.equal(oc.agent["vibe-brain"].mode, "subagent", configPath)
      assert.equal(oc.agent["vibe-brain"].model, "deepseek/deepseek-v4-flash", configPath)
      assert.equal(oc.default_agent, "vibe", configPath)
    }
    const selection = JSON.parse(readFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), "utf8")).selection
    assert.equal(selection.entry_slot || selection.active_slot, "cheap")
    assert.equal(selection.worker_slot || selection.selected_slot, "brain")
    assert.equal(result.selected_subagent, "vibe-brain")
    assert.equal(result.requires_delegation, true)
  } finally {
    ctx.cleanup()
  }
})

test("vibeultrax sync does not rewrite default_agent when the active slot changes", async () => {
  const ctx = withSandbox("vibeos-tier-default-agent-")
  try {
    const mod = await import("../src/lib/hooks/chat-transform.js?tier-default-agent=" + Date.now())
    const first = mod.syncControlSettings({
      optimization_mode: "vibeultrax",
      tier_bias: "cheap",
      selected_slot: "cheap",
      selected_model: "opencode/big-pickle",
      route_path: ["cheap"],
      cascade_root: ["cheap", "medium", "brain"],
      enforcement_mode: "strict",
      flow_mode: "strict",
      tdd_mode: "quality",
      thinking_mode: "off",
    }, { authoritative: true, directory: ctx.sandbox })

    const initial = JSON.parse(readFileSync(ctx.projectConfig, "utf8"))
    assert.equal(initial.default_agent, "vibe")
    assert.equal(first.selected_slot, "cheap")

    const second = mod.syncControlSettings({
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
    }, { authoritative: true, directory: ctx.sandbox })

    const after = JSON.parse(readFileSync(ctx.projectConfig, "utf8"))
    assert.equal(after.default_agent, "vibe", "per-turn slot changes must not churn the OpenCode default agent")
    assert.equal(after.agent.vibe.mode, "primary")
    assert.equal(after.agent.vibe.model, undefined)
    assert.equal(after.agent["vibe-cheap"].mode, "subagent")
    assert.equal(after.agent["vibe-brain"].mode, "subagent")
    assert.equal(second.selected_slot, "brain")
    assert.equal(second.entry_slot, "cheap")
    assert.equal(second.worker_slot, "brain")
  } finally {
    ctx.cleanup()
  }
})

test("vibeultrax task routing normalizes task subagent_type to general", async () => {
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

    assert.equal(args.subagent_type, "general")
    assert.equal(args.model, "deepseek/deepseek-v4-flash")
    assert.equal(args.modelID, "deepseek/deepseek-v4-flash")
    assert.equal(args.modelId, "deepseek/deepseek-v4-flash")
  } finally {
    ctx.cleanup()
  }
})

// ML difficulty can escalate or de-escalate the control-vector's regime slot
// for a single message -- bidirectional, per the explicit design directive:
// a cheap-baseline turn must escalate for a genuinely complex prompt, and a
// brain-baseline turn must de-escalate for a genuinely trivial one. Neither
// direction is allowed to get "stuck" at the regime's baseline tier. See
// docs/live-debug-session-notes.md round 13.
test("vibeultrax task routing: ML difficulty escalates a cheap-baseline turn for a genuinely complex prompt", async () => {
  const ctx = withSandbox("vibeos-ml-escalate-")
  try {
    writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
      selection: {
        enabled: true,
        active_slot: "cheap",
        slot_locked: false,
        optimization_mode: "vibeultrax",
        active_pipeline: ["cheap", "medium", "brain"],
        selected_slot: "cheap",
        worker_slot: "cheap",
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

    const mod = await import("../src/index.js?ml-escalate=" + Date.now())
    const hooks = await mod.DelegationEnforcer({ client: {}, directory: ctx.sandbox })
    const args = {
      description: "Complex migration",
      prompt: "implement a complex distributed migration with concurrency race condition deadlock byzantine fault tolerance paxos raft consensus CRDT eventual consistency circuit breaker observability security vulnerability exploit injection authentication authorization database schema migration kubernetes docker container orchestration microservice architecture refactor across src/lib/hooks/tool-execute.ts src/lib/hooks/chat-transform.ts src/lib/pricing.ts package.json tsconfig.json",
      subagent_type: "general",
      model: null,
      modelID: null,
      modelId: null,
    }
    await hooks["tool.execute.before"]({ tool: "task" }, { args })

    assert.equal(args.model, "deepseek/deepseek-v4-flash")
    assert.equal(args.modelID, "deepseek/deepseek-v4-flash")
    assert.equal(args.modelId, "deepseek/deepseek-v4-flash")
  } finally {
    ctx.cleanup()
  }
})

test("vibeultrax task routing: ML difficulty de-escalates a brain-baseline turn for a genuinely trivial prompt", async () => {
  const ctx = withSandbox("vibeos-ml-deescalate-")
  try {
    writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
      selection: {
        enabled: true,
        active_slot: "brain",
        slot_locked: false,
        optimization_mode: "vibeultrax",
        active_pipeline: ["cheap", "medium", "brain"],
        selected_slot: "brain",
        worker_slot: "brain",
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

    const mod = await import("../src/index.js?ml-deescalate=" + Date.now())
    const hooks = await mod.DelegationEnforcer({ client: {}, directory: ctx.sandbox })
    const args = {
      description: "Trivial fix",
      prompt: "fix typo",
      subagent_type: "general",
      model: null,
      modelID: null,
      modelId: null,
    }
    await hooks["tool.execute.before"]({ tool: "task" }, { args })

    assert.equal(args.model, "opencode/big-pickle")
    assert.equal(args.modelID, "opencode/big-pickle")
    assert.equal(args.modelId, "opencode/big-pickle")
  } finally {
    ctx.cleanup()
  }
})

test("vibeultrax task routing ignores stale lower-tier worker_model for brain route", async () => {
  const ctx = withSandbox("vibeos-tier-stale-worker-")
  try {
    writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
      selection: {
        enabled: true,
        active_slot: "cheap",
        slot_locked: false,
        optimization_mode: "vibeultrax",
        active_pipeline: ["cheap", "medium", "brain"],
        selected_slot: "brain",
        worker_model: "opencode-go/mimo-v2.5",
        selected_subagent: "vibe-brain",
        route_path: ["cheap", "medium", "brain"],
        requires_delegation: true,
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

    const mod = await import("../src/index.js?stale-worker=" + Date.now())
    const hooks = await mod.DelegationEnforcer({ client: {}, directory: ctx.sandbox })
    const args = {
      description: "Fix complex cascade",
      prompt: "implement a complex multi-file cascade repair with distributed consensus raft leader election byzantine fault tolerance paxos protocol CRDT rollback observability circuit breaker concurrency race condition deadlock across src/lib/hooks/tool-execute.ts src/lib/hooks/chat-transform.ts src/vibeOS-lib/ml-router.ts tests/cascade_route_contract.test.mjs",
      subagent_type: "general",
      model: null,
      modelID: null,
      modelId: null,
    }

    await hooks["tool.execute.before"]({ tool: "task" }, { args })

    assert.equal(args.subagent_type, "general")
    assert.equal(args.model, "deepseek/deepseek-v4-flash")
    assert.equal(args.modelID, "deepseek/deepseek-v4-flash")
    assert.equal(args.modelId, "deepseek/deepseek-v4-flash")
  } finally {
    ctx.cleanup()
  }
})

test("delegation hard block requires coherent brain tier agent binding", async () => {
  const ctx = withSandbox("vibeos-tier-drift-")
  try {
    writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
      selection: {
        enabled: true,
        active_slot: "brain",
        delegation_enforce: true,
        onboarding_mode: "strict",
      },
      trinity: {
        cheap: { oc: "opencode/big-pickle" },
        medium: { oc: "opencode-go/mimo-v2.5" },
        brain: { oc: "deepseek/deepseek-v4-flash" },
      },
    }, null, 2))
    writeFileSync(ctx.projectConfig, JSON.stringify({
      model: "deepseek/deepseek-v4-flash",
      default_agent: "build",
      plugin: ["vibeOS"],
    }, null, 2))
    const mod = await import("../src/index.js?tier-drift=" + Date.now())
    const hooks = await mod.DelegationEnforcer({ client: {}, directory: ctx.sandbox })
    const input = { tool: "write", args: { filePath: "notes.txt", content: "x" } }
    const output = { args: { filePath: "notes.txt", content: "x" } }

    await hooks["tool.execute.before"](input, output)

    assert.equal(output.blocked, undefined)
    assert.equal(output.args.filePath, "notes.txt")
  } finally {
    ctx.cleanup()
  }
})

test("vibeultrax medium route delegates a Task to the general subagent at the medium model", async () => {
  // Was asserted against resolveCascadeRouteDecision, which never routed a
  // Task and never shipped. Driven through the production hook instead.
  const ctx = withSandbox("vibeos-tier-route-")
  try {
    writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
      selection: {
        enabled: true,
        active_slot: "cheap",
        slot_locked: false,
        optimization_mode: "vibeultrax",
        active_pipeline: ["cheap", "medium", "brain"],
        worker_slot: "medium",
        selected_slot: "medium",
        requires_delegation: true,
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
    const mod = await import("../src/lib/hooks/tool-execute.js?tier-route=" + Date.now())
    const args = {
      prompt: "implement auth validation and integration tests",
      subagent_type: "general",
      model: null,
      modelID: null,
      modelId: null,
    }
    await mod.onToolExecuteBefore({ tool: "task", mlEnabled: false }, { args })

    assert.equal(args.model, "opencode-go/mimo-v2.5")
    assert.equal(args.subagent_type, "general")
    assert.equal(mod.taskSubagentTypeForSlot("medium"), "general")
  } finally {
    ctx.cleanup()
  }
})
