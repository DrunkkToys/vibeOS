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


import { VOTE_MARKER } from "../src/vibeOS-lib/adaptive-router.js"

async function routeCheapTask(ctx, prompt, stamp) {
  const mod = await import("../src/index.js?" + stamp)
  const hooks = await mod.DelegationEnforcer({ client: {}, directory: ctx.sandbox })
  const chat = await import("../src/lib/hooks/chat-transform.js?sync-" + stamp)
  chat.syncControlSettings({
    optimization_mode: "vibeultrax",
    tier_bias: "cheap",
    selected_slot: "cheap",
    selected_model: "opencode/big-pickle",
    selected_subagent: "vibe-cheap",
    route_path: ["cheap"],
    cascade_root: ["cheap", "medium", "brain"],
    enforcement_mode: "strict",
    flow_mode: "strict",
    tdd_mode: "quality",
    thinking_mode: "off",
  }, { authoritative: true })
  const args = { description: "d", prompt, subagent_type: "general", model: null, modelID: null, modelId: null }
  await hooks["tool.execute.before"]({ tool: "task" }, { args })
  return args
}

test("an easy cheap-tier task is sampled several times, not answered once", async () => {
  const ctx = withSandbox("vibeos-vote-easy-")
  try {
    const args = await routeCheapTask(ctx, "list the files", "vote-easy=" + Date.now())
    assert.equal(args.model, "opencode/big-pickle")
    assert.ok(args.prompt.includes(VOTE_MARKER), "delegated prompt must carry the vote contract")
    assert.match(args.prompt, /independent/i)
    assert.match(args.prompt, /list the files/)
  } finally {
    ctx.cleanup()
  }
})

test("the vote never rewrites the prompt twice for one task", async () => {
  const ctx = withSandbox("vibeos-vote-once-")
  try {
    const stamp = "vote-once=" + Date.now()
    const mod = await import("../src/index.js?" + stamp)
    const hooks = await mod.DelegationEnforcer({ client: {}, directory: ctx.sandbox })
    const chat = await import("../src/lib/hooks/chat-transform.js?sync-" + stamp)
    chat.syncControlSettings({
      optimization_mode: "vibeultrax",
      tier_bias: "cheap",
      selected_slot: "cheap",
      selected_model: "opencode/big-pickle",
      selected_subagent: "vibe-cheap",
      route_path: ["cheap"],
      cascade_root: ["cheap", "medium", "brain"],
      enforcement_mode: "strict",
      flow_mode: "strict",
      tdd_mode: "quality",
      thinking_mode: "off",
    }, { authoritative: true })
    const args = { description: "d", prompt: "list the files", subagent_type: "general", model: null, modelID: null, modelId: null }
    await hooks["tool.execute.before"]({ tool: "task" }, { args })
    const once = args.prompt
    await hooks["tool.execute.before"]({ tool: "task" }, { args })
    assert.equal(args.prompt, once, "a second pass must not stack another vote wrapper")
    assert.equal(args.prompt.split(VOTE_MARKER).length - 1, once.split(VOTE_MARKER).length - 1)
  } finally {
    ctx.cleanup()
  }
})

test("a brain-tier task is never billed N times for a vote", async () => {
  const ctx = withSandbox("vibeos-vote-brain-")
  try {
    const stamp = "vote-brain=" + Date.now()
    const mod = await import("../src/index.js?" + stamp)
    const hooks = await mod.DelegationEnforcer({ client: {}, directory: ctx.sandbox })
    const chat = await import("../src/lib/hooks/chat-transform.js?sync-" + stamp)
    chat.syncControlSettings({
      optimization_mode: "vibeqmax",
      tier_bias: "brain",
      selected_slot: "brain",
      selected_model: "deepseek/deepseek-v4-flash",
      selected_subagent: "vibe-brain",
      route_path: ["brain"],
      cascade_root: ["brain"],
      enforcement_mode: "strict",
      flow_mode: "strict",
      tdd_mode: "quality",
      thinking_mode: "full",
    }, { authoritative: true })
    const args = { description: "d", prompt: "list the files", subagent_type: "general", model: null, modelID: null, modelId: null }
    await hooks["tool.execute.before"]({ tool: "task" }, { args })
    assert.equal(args.prompt.includes(VOTE_MARKER), false, "brain must answer once")
  } finally {
    ctx.cleanup()
  }
})

test("VIBEOS_ADAPTIVE_ROUTING=off restores the plain single-call cascade", async () => {
  const ctx = withSandbox("vibeos-vote-off-")
  const prev = process.env.VIBEOS_ADAPTIVE_ROUTING
  process.env.VIBEOS_ADAPTIVE_ROUTING = "off"
  try {
    const args = await routeCheapTask(ctx, "list the files", "vote-off=" + Date.now())
    assert.equal(args.prompt.includes(VOTE_MARKER), false)
    assert.equal(/independent/i.test(args.prompt), false)
  } finally {
    if (prev === undefined) delete process.env.VIBEOS_ADAPTIVE_ROUTING
    else process.env.VIBEOS_ADAPTIVE_ROUTING = prev
    ctx.cleanup()
  }
})

function voteClient(answers) {
  let n = 0
  return {
    session: {
      create: async () => ({ data: { id: "s" + ++n } }),
      delete: async () => {},
      prompt: async ({ body }) => ({
        data: { parts: [{ type: "text", text: answers[`${body.model.providerID}/${body.model.modelID}`] ?? "" }] },
      }),
    },
  }
}

async function routeWithClient(ctx, client, prompt, stamp) {
  const mod = await import("../src/index.js?" + stamp)
  const hooks = await mod.DelegationEnforcer({ client, directory: ctx.sandbox })
  const chat = await import("../src/lib/hooks/chat-transform.js?sync-" + stamp)
  chat.syncControlSettings({
    optimization_mode: "vibeultrax",
    tier_bias: "cheap",
    selected_slot: "cheap",
    selected_model: "opencode/big-pickle",
    selected_subagent: "vibe-cheap",
    route_path: ["cheap"],
    cascade_root: ["cheap", "medium", "brain"],
    enforcement_mode: "strict",
    flow_mode: "strict",
    tdd_mode: "quality",
    thinking_mode: "off",
  }, { authoritative: true })
  const args = { description: "d", prompt, subagent_type: "general", model: null, modelID: null, modelId: null }
  await hooks["tool.execute.before"]({ tool: "task" }, { args })
  return args
}

test("when independent models agree, the cheap tier keeps the work", async () => {
  const ctx = withSandbox("vibeos-live-vote-agree-")
  try {
    const client = voteClient({ "opencode/big-pickle": "42", "opencode-go/mimo-v2.5": "42" })
    const args = await routeWithClient(ctx, client, "list the files", "vote-agree=" + Date.now())
    assert.equal(args.model, "opencode/big-pickle")
    assert.equal(args.prompt.includes(VOTE_MARKER), false, "a real vote replaces the single-model imitation")
  } finally {
    ctx.cleanup()
  }
})

test("when independent models disagree, the turn escalates a tier", async () => {
  const ctx = withSandbox("vibeos-live-vote-split-")
  try {
    const client = voteClient({ "opencode/big-pickle": "42", "opencode-go/mimo-v2.5": "7" })
    const args = await routeWithClient(ctx, client, "list the files", "vote-split=" + Date.now())
    assert.notEqual(args.model, "opencode/big-pickle", "a split vote must not stay on cheap")
    assert.equal(args.model, "opencode-go/mimo-v2.5")
  } finally {
    ctx.cleanup()
  }
})

test("a client that cannot prompt leaves routing exactly as it was", async () => {
  const ctx = withSandbox("vibeos-live-vote-noclient-")
  try {
    const args = await routeWithClient(ctx, {}, "list the files", "vote-noclient=" + Date.now())
    assert.equal(args.model, "opencode/big-pickle")
    assert.ok(args.prompt.includes(VOTE_MARKER), "with no live vote, the single-model fallback still applies")
  } finally {
    ctx.cleanup()
  }
})
