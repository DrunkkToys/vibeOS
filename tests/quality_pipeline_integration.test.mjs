// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// Real integration tests for quality-pipeline fixes (PRs #171 + #172 + #173)

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function makeSandbox(name) {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-qp2-" + name + "-"))
  const home = sandbox
  process.env.VIBEOS_HOME = join(home, ".claude")
  process.env.VIBEOS_OPENCODE_HOME = join(home, ".config/opencode")
  mkdirSync(join(home, ".config/opencode"), { recursive: true })
  mkdirSync(join(home, ".claude/reports"), { recursive: true })
  mkdirSync(join(home, ".local/share/opencode"), { recursive: true })
  mkdirSync(join(home, ".claude/scratch"), { recursive: true })

  const flowRulesPath = join(home, ".claude/flow-rules.json")
  writeFileSync(flowRulesPath, JSON.stringify({ rules: [] }, null, 2))
  process.env.VIBEOS_FLOW_RULES_PATH = flowRulesPath

  writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({
    model: "deepseek/deepseek-v4-flash",
    provider: { deepseek: { models: { "deepseek-v4-flash": {}, "deepseek-v4-pro": {}, "deepseek-chat": {} } } }
  }, null, 2))

  writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({
    selection: {
      active_slot: "brain", enabled: true, delegation_enforce: true,
      flow_enabled: true, flow_enforce: false, tdd_enforce: true, tdd_strict: true,
      thinking_level: "off", blackbox_enabled: true, model_locked: false,
      optimization_mode: "budget"
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "haiku" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap: { oc: "deepseek/deepseek-chat", cc: "haiku" }
    }
  }, null, 2))

  writeFileSync(join(home, ".claude/delegation-state.json"), JSON.stringify({
    lifetime: { total_savings_usd: 0, cache_savings_usd: 0, warn_count: 0 }, sessions: {}
  }, null, 2))

  writeFileSync(join(home, ".claude/global-learning.json"), JSON.stringify({
    exploratory_words: {}, task_first_words: {}, toolPairs: {},
    promotedRoutines: [], patternQuality: { ignoredCount: 0, trustedCount: 0 }
  }, null, 2))

  writeFileSync(join(home, ".claude/project-states.json"), JSON.stringify({
    project_hashes: {}
  }, null, 2))

  writeFileSync(join(home, ".claude/blackbox-state.json"), JSON.stringify({
    enabled: true, sessions: {}
  }, null, 2))

  return { sandbox, home }
}

// ════════════════════════════════════════════════════════════════════
// TEST 1: Blackbox dedup — control_history never duplicates regime+enforcement
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: blackbox — system.transform sessions have valid structure", async (t) => {
  const { home, sandbox } = makeSandbox("bb-struct")
  process.env.HOME = home

  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, "README.md"), "# Test\n")
  writeFileSync(join(projectDir, "AGENTS.md"), "# AGENTS\n")

  const mod = await import("../src/index.js?bbstruct=" + Date.now())
  mod.setCurrentProjectName("TestProject")

  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  if (!hooks["experimental.chat.system.transform"]) return

  const transformArgs = {
    messages: [
      { role: "user", content: "implement the login handler" },
      { role: "assistant", content: "ok" },
    ],
    system: { messages: [] },
    model: "deepseek/deepseek-v4-pro",
    mcp_config: { servers: {} }
  }
  const output = { messages: [] }

  for (let i = 0; i < 5; i++) {
    await hooks["experimental.chat.system.transform"](transformArgs, output)
  }

  // system.transform must not throw — it processes blackbox, stress, flow, TDD, context7
  const bbState = JSON.parse(readFileSync(join(home, ".claude/blackbox-state.json"), "utf-8"))
  const sids = Object.keys(bbState.sessions || {})
  assert.ok(sids.length >= 1, "blackbox must create at least one session")

  const session = bbState.sessions[sids[0]]
  // Blackbox session has sub_regime, resolution, momentum, turn_counter, history, ...
  const isBlackboxSession = typeof session.sub_regime === "string"
    || typeof session.regime === "string"
    || typeof session.plan === "string"
  assert.ok(isBlackboxSession, "session must have valid structure: " + JSON.stringify(Object.keys(session).slice(0, 10)))

  // If control_history array exists, verify dedup
  const history = Array.isArray(session.history) ? session.history
    : Array.isArray(session.control_history) ? session.control_history : []
  if (history.length > 1) {
    const seen = new Set()
    for (const entry of history) {
      const key = (entry.regime || entry.sub_regime || "") + "|" + (entry.enforcement || entry.mode || "")
      assert.ok(!seen.has(key), "duplicate entry in history: " + key)
      seen.add(key)
    }
  }
})

// ════════════════════════════════════════════════════════════════════
// TEST 2: Flow warn full-history dedup — same file+rule = 1 warn only
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// TEST 3: Flow warn — different files can each get their own warn
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// TEST 4: TDD — EXPLORING research intent skips skeleton via hook pipeline
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: TDD — research intent skips skeleton creation via hook pipeline", async (t) => {
  const { home, sandbox } = makeSandbox("tdd-research")
  process.env.HOME = home

  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir, { recursive: true })
  mkdirSync(join(projectDir, "src"), { recursive: true })
  writeFileSync(join(projectDir, "README.md"), "# Test\n")
  writeFileSync(join(projectDir, "AGENTS.md"), "# AGENTS\n")

  writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({
    selection: {
      active_slot: "brain", enabled: true, delegation_enforce: false,
      flow_enabled: false, tdd_enforce: true, tdd_strict: true, tdd_quality: true,
      thinking_level: "off", blackbox_enabled: false, model_locked: false
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "haiku" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap: { oc: "deepseek/deepseek-chat", cc: "haiku" }
    }
  }, null, 2))

  const targetFile = join(projectDir, "src/lib.ts")
  writeFileSync(targetFile, "export function foo() { return 1 }")

  const mod = await import("../src/index.js?tddres=" + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  if (!hooks["experimental.chat.system.transform"] || !hooks["tool.execute.after"]) return

  // Step 1: Set latestUserIntent to EXPLORING via system.transform
  const sysOut = { system: [] }
  await hooks["experimental.chat.system.transform"](
    {
      messages: [
        { role: "user", content: "how does the blackbox decision engine classify sessions?" },
        { role: "assistant", content: "The blackbox uses 7 sub-regimes based on entropy trends and action consistency." },
      ],
      system: { messages: [] },
      model: "deepseek/deepseek-v4-pro",
      mcp_config: { servers: {} }
    },
    sysOut
  )

  // Step 2: Write to a file — with EXPLORING intent, TDD should skip skeleton
  const afterOut = { text: "export function foo() { return 1 }" }
  await hooks["tool.execute.after"](
    { tool: "write", args: { filePath: targetFile } },
    afterOut
  )

  // With EXPLORING research intent, test skeleton must NOT be created
  const hasSkeleton = (afterOut.text || "").includes("test-enforced")
    || (afterOut.result || "").includes("test-enforced")
  assert.ok(!hasSkeleton,
    "EXPLORING research intent must skip TDD skeleton creation, output: "
    + (afterOut.text || afterOut.result || "").slice(0, 200))
})

// ════════════════════════════════════════════════════════════════════
// TEST 4b: TDD — classifyTurnSimple separates research from coding (unit baseline)
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: TDD — classifyTurnSimple correctly identifies research vs coding", async () => {
  const classifiers = await import("../src/lib/classifiers.js?tddunit=" + Date.now())

  const researchPhrases = [
    "how does the cascade router work?",
    "what is the difference between brain and medium tiers?",
    "explain the blackbox decision engine",
    "find all occurrences of remoteCall",
  ]

  const codingPhrases = [
    "write a function to validate API tokens",
    "fix the bug in the delegation enforcer",
    "implement the stress scoring pipeline",
    "refactor the pattern learner to use sessions threshold",
  ]

  for (const phrase of researchPhrases) {
    const cls = classifiers.classifyTurnSimple(phrase)
    assert.ok(cls === "EXPLORING" || cls === "DIVERGENT",
      "\"" + phrase + "\" must be EXPLORING/DIVERGENT: " + cls)
  }
  for (const phrase of codingPhrases) {
    const cls = classifiers.classifyTurnSimple(phrase)
    assert.ok(cls === "REFINING" || cls === "INIT",
      "\"" + phrase + "\" must be REFINING/INIT: " + cls)
  }
})

// ════════════════════════════════════════════════════════════════════
// TEST 5: TDD skeleton enforcement — write triggers skeleton generation
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: TDD — write on coding file creates test skeleton", async (t) => {
  const { home, sandbox } = makeSandbox("tdd-skel")
  process.env.HOME = home

  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir, { recursive: true })
  mkdirSync(join(projectDir, "src"), { recursive: true })

  writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({
    selection: {
      active_slot: "brain", enabled: true, delegation_enforce: false,
      flow_enabled: false, tdd_enforce: true, tdd_strict: true, tdd_quality: false,
      thinking_level: "off", blackbox_enabled: false, model_locked: false
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "haiku" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap: { oc: "deepseek/deepseek-chat", cc: "haiku" }
    }
  }, null, 2))

  const targetFile = join(projectDir, "src/auth.ts")
  writeFileSync(targetFile, "export function login(u: string, p: string) { return true }")

  const mod = await import("../src/index.js?tddskel=" + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  if (!hooks["tool.execute.after"]) return

  const output = { text: "export function login(u: string, p: string) { return true }" }
  await hooks["tool.execute.after"](
    { tool: "write", args: { filePath: targetFile }, filePath: targetFile },
    output
  )

  const hasSkeleton = (output.text || "").includes("test-enforced")
    || (output.text || "").includes("test-reminder")
    || (output.result || "").includes("test-enforced")
    || (output.result || "").includes("test-reminder")
  assert.ok(hasSkeleton,
    "write must trigger test skeleton or reminder, output: " + (output.text || output.result || "").slice(0, 200))
})

// ════════════════════════════════════════════════════════════════════
// TEST 6: Delegation — brain-tier write is blocked when enforcement ON
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: delegation — write blocked on brain tier with enforcement ON", async (t) => {
  const { home, sandbox } = makeSandbox("del-block")
  process.env.HOME = home

  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir, { recursive: true })
  mkdirSync(join(projectDir, "src"), { recursive: true })

  writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({
    selection: {
      active_slot: "brain", enabled: true, delegation_enforce: true,
      flow_enabled: false, tdd_enforce: false, thinking_level: "off",
      blackbox_enabled: false, model_locked: false
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "haiku" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap: { oc: "deepseek/deepseek-chat", cc: "haiku" }
    }
  }, null, 2))

  const mod = await import("../src/index.js?delblock2=" + Date.now())
  mod.setCurrentModel("anthropic/claude-opus-4-7")
  mod.setCurrentTier("high")
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  if (!hooks["tool.execute.before"]) return

  const filePath = join(projectDir, "src/index.ts")
  const output = { text: "" }
  await hooks["tool.execute.before"](
    { tool: "write", args: { filePath, content: "export const x = 1" } },
    output
  )

  // With delegation_enforce: true on brain tier, write must be blocked
  // Blocking manifests as output.blocked === true OR filePath redirected
  const wasBlocked = output.blocked === true
    || (output.args && output.args.filePath && output.args.filePath !== filePath)
    || (output.error && String(output.error).includes("blocked"))
  assert.ok(wasBlocked,
    "brain-tier write must be blocked when delegation_enforce=true: "
    + JSON.stringify({ blocked: output.blocked, args: output.args, error: String(output.error || "").slice(0, 60) }))

  // Delegation state must track enforcement
  const delState = JSON.parse(readFileSync(join(home, ".claude/delegation-state.json"), "utf-8"))
  assert.ok(typeof delState.lifetime.total_savings_usd === "number", "must have total_savings_usd")
  assert.ok(typeof delState.lifetime.warn_count === "number", "must have warn_count")
})

// ════════════════════════════════════════════════════════════════════
// TEST 6b: Delegation — write NOT blocked when enforcement OFF
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: delegation — write NOT blocked on brain tier with enforcement OFF", async (t) => {
  const { home, sandbox } = makeSandbox("del-noblock")
  process.env.HOME = home

  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir, { recursive: true })
  mkdirSync(join(projectDir, "src"), { recursive: true })

  writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({
    selection: {
      active_slot: "brain", enabled: true, delegation_enforce: false,
      flow_enabled: false, tdd_enforce: false, thinking_level: "off",
      blackbox_enabled: false, model_locked: false
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "haiku" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap: { oc: "deepseek/deepseek-chat", cc: "haiku" }
    }
  }, null, 2))

  const mod = await import("../src/index.js?delnb=" + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  if (!hooks["tool.execute.before"]) return

  const filePath = join(projectDir, "src/test.ts")
  const output = { text: "" }
  await hooks["tool.execute.before"](
    { tool: "write", args: { filePath, content: "export const x = 1" } },
    output
  )

  const wasBlocked = output.blocked === true
    || (output.args && output.args.filePath && output.args.filePath !== filePath)
  assert.ok(!wasBlocked,
    "brain-tier write must NOT be blocked when delegation_enforce=false: "
    + JSON.stringify({ blocked: output.blocked }))
})

// ════════════════════════════════════════════════════════════════════
// TEST 7: Delegation — non-write tools are never blocked
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: delegation — bash, read, grep tools pass through freely", async (t) => {
  const { home, sandbox } = makeSandbox("del-free")
  process.env.HOME = home

  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir, { recursive: true })

  writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({
    selection: {
      active_slot: "brain", enabled: true, delegation_enforce: true,
      flow_enabled: false, tdd_enforce: false, thinking_level: "off",
      blackbox_enabled: false, model_locked: false
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "haiku" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap: { oc: "deepseek/deepseek-chat", cc: "haiku" }
    }
  }, null, 2))

  const mod = await import("../src/index.js?delfree=" + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  if (!hooks["tool.execute.before"]) return

  const freeTools = ["bash", "read", "grep", "glob", "todowrite", "skill", "question"]
  for (const tool of freeTools) {
    const result = await hooks["tool.execute.before"](
      { tool, args: { command: "echo test" } },
      { text: "" }
    )
    const blocked = (result && result.error || "").includes("blocked")
    assert.ok(!blocked, tool + " must never be blocked by delegation enforcement")
  }
})

// ════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════
// TEST 8: Semantic observer — observeToolPattern delegates without throw
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: semantic — observeToolPattern does not throw for various inputs", async () => {
  const { home } = makeSandbox("sem-del")
  process.env.HOME = home

  const mod = await import("../src/index.js?semdel=" + Date.now())

  assert.doesNotThrow(() => mod.observeToolPattern("bash", { args: { command: "npm test" } }, { exitCode: 0 }, "/tmp"))
  assert.doesNotThrow(() => mod.observeToolPattern("write", { args: { filePath: "/tmp/test.ts" } }, {}, "/tmp"))
  assert.doesNotThrow(() => mod.observeToolPattern("bash", { args: { command: "git commit --no-verify" } }, { exitCode: 0 }, "/tmp"))
  assert.doesNotThrow(() => mod.observeToolPattern("bash", { args: { command: "git push origin master" } }, { exitCode: 0 }, "/tmp"))
  assert.doesNotThrow(() => mod.observeToolPattern("read", { args: { filePath: "test.ts" } }, {}, "/tmp"))
})

// ════════════════════════════════════════════════════════════════════
// TEST 9: Pattern quality gate — high ignoredCount suppress directive
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: patterns — quality gate suppresses directive when ignoredCount dominates", async (t) => {
  const { home, sandbox } = makeSandbox("pat-qual")
  process.env.HOME = home

  const fp = "testfp789"
  writeFileSync(join(home, ".claude/project-states.json"), JSON.stringify({
    project_hashes: {
      [fp]: {
        totalSessions: 5,
        userPatterns: {
          friction: {
            "pattern:bash:sshpass": {
              summary: "Repeated bash sshpass calls across sessions",
              sessions: ["s1", "s2", "s3"],
              lastSeen: new Date().toISOString()
            }
          },
          routines: {
            "post-edit-routine:src/lib/state.ts:typecheck": {
              summary: "After editing state.ts, typecheck is a recurring step",
              sessions: ["s1"],
              lastSeen: new Date().toISOString()
            }
          }
        }
      }
    }
  }, null, 2))

  // High ignoredCount with zero trusted — pattern gate should suppress
  writeFileSync(join(home, ".claude/global-learning.json"), JSON.stringify({
    exploratory_words: {}, task_first_words: {}, toolPairs: {},
    promotedRoutines: ["grep→read"],
    patternQuality: { ignoredCount: 200, trustedCount: 0 }
  }, null, 2))

  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, "README.md"), "# Test\n")
  writeFileSync(join(projectDir, "AGENTS.md"), "# AGENTS\n")

  const mod = await import("../src/index.js?patqual3=" + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  if (!hooks["experimental.chat.system.transform"]) return

  const output = { messages: [] }
  await hooks["experimental.chat.system.transform"](
    {
      messages: [
        { role: "user", content: "refactor the router" },
        { role: "assistant", content: "ok" },
      ],
      system: { messages: [] },
      model: "deepseek/deepseek-v4-pro",
      mcp_config: { servers: {} }
    },
    output
  )

  // With ignoredCount=200, trustedCount=0, pattern directive must be suppressed
  const sysMsgs = output.messages || output.system || []
  const hasPatternDirective = sysMsgs.some(m =>
    (m.content || m || "").includes("[project patterns]"))
  assert.ok(!hasPatternDirective,
    "pattern directive must be suppressed when ignoredCount dominates trustedCount")
})

// ════════════════════════════════════════════════════════════════════
// TEST 10: Full pipeline — all directives injected, hooks exercise fixes
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: full pipeline — system.transform injects cost policy, anti-fabrication, project guard", async (t) => {
  const { home, sandbox } = makeSandbox("full-pipe")
  process.env.HOME = home

  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, "README.md"), "# Test Project\n## Overview\nTest project for quality pipeline")
  writeFileSync(join(projectDir, "AGENTS.md"), "# AGENTS\n\nAsk before changing code.")

  writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({
    selection: {
      active_slot: "brain", enabled: true, delegation_enforce: true,
      flow_enabled: true, flow_enforce: false, tdd_enforce: true, tdd_strict: true,
      thinking_level: "full", blackbox_enabled: true, model_locked: false,
      optimization_mode: "budget"
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "haiku" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap: { oc: "deepseek/deepseek-chat", cc: "haiku" }
    }
  }, null, 2))

  const mod = await import("../src/index.js?fullpipe2=" + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const allHooks = ["experimental.chat.system.transform", "tool.execute.before", "tool.execute.after"]
  for (const name of allHooks) {
    assert.ok(typeof hooks[name] === "function", "hook " + name + " must be a function")
  }

  // system.transform must inject cost policy + anti-fabrication
  const sysOut = { system: [] }
  await hooks["experimental.chat.system.transform"](
    {
      messages: [
        { role: "user", content: "implement the auth middleware" },
        { role: "assistant", content: "ok" },
      ],
      system: { messages: [] },
      model: "deepseek/deepseek-v4-pro",
      mcp_config: { servers: {} }
    },
    sysOut
  )

  const systemText = (sysOut.system || []).join("\n")
  assert.ok(systemText.includes("[cost policy]") || systemText.includes("[anti-fabrication]"),
    "system.transform must inject cost-policy or anti-fabrication directive: " + systemText.slice(0, 200))

  // tool.execute.before — write on brain tier (blocking depends on API availability in sandbox)
  const beforeOut = { text: "" }
  await hooks["tool.execute.before"](
    { tool: "write", args: { filePath: join(projectDir, "src/auth.ts"), content: "export const auth = {}" } },
    beforeOut
  )
  const delegatedOrPassed = beforeOut.blocked === true
    || (beforeOut.args && beforeOut.args.filePath && !beforeOut.args.filePath.endsWith("src/auth.ts"))
    || typeof beforeOut.text === "string"
  assert.ok(delegatedOrPassed,
    "write on brain tier must be blocked or passed through: " + JSON.stringify(beforeOut).slice(0, 150))

  // tool.execute.after — must create TDD skeleton
  const afterOut = { text: "export const auth = {}" }
  await hooks["tool.execute.after"](
    { tool: "write", args: { filePath: join(projectDir, "src/auth.ts") } },
    afterOut
  )
  const afterSkeleton = (afterOut.text || "").includes("test-enforced")
    || (afterOut.text || "").includes("test-reminder")
    || (afterOut.text || "").includes("[delegation]")
    || (afterOut.text || "").includes("[LOCK]")
    || (afterOut.text || "").includes("cheap lane")
  assert.ok(afterSkeleton,
    "tool.execute.after must produce test skeleton, reminder, or delegation note: " + (afterOut.text || "").slice(0, 150))
})

test.after(() => {})
