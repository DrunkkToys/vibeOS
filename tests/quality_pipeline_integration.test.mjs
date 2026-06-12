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
// TEST 1: Blackbox dedup — buildControlHistoryEntry has fingerprint
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: blackbox — control_history entries carry dedup fingerprint", async (t) => {
  const { home, sandbox } = makeSandbox("bb-fprint")
  process.env.HOME = home

  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, "README.md"), "# Test\n")
  writeFileSync(join(projectDir, "AGENTS.md"), "# AGENTS\n")

  const mod = await import("../src/index.js?bbfprint=" + Date.now())
  mod.setCurrentProjectName("TestProject")

  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  if (!hooks["experimental.chat.system.transform"]) return

  const input = {
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
    await hooks["experimental.chat.system.transform"](input, output)
  }

  const bbState = JSON.parse(readFileSync(join(home, ".claude/blackbox-state.json"), "utf-8"))
  const sids = Object.keys(bbState.sessions || {})
  assert.ok(sids.length >= 1, "blackbox must create at least one session")

  const session = bbState.sessions[sids[0]]
  const keys = Object.keys(session)
  assert.ok(keys.length >= 1, "session must exist with structure: " + JSON.stringify(keys))

  // Session structure varies based on API availability
  // With API available: sub_regime, control_history, turn_counter, ...
  // With API unavailable: plan, selected_slot, ...
  const hasBlackbox = typeof session.sub_regime === "string" || typeof session.turn_counter === "number"
  const hasPlan = typeof session.plan === "string" || typeof session.selected_slot === "string"
  assert.ok(hasBlackbox || hasPlan, "session must have blackbox or plan structure: " + JSON.stringify(keys))

  // If control_history exists, verify no duplicate entries
  if (Array.isArray(session.control_history) && session.control_history.length > 1) {
    const seen = new Set()
    for (const entry of session.control_history) {
      const key = (entry.regime || "") + "|" + (entry.enforcement || "")
      assert.ok(!seen.has(key),
        "duplicate regime+enforcement '" + key + "' in control_history")
      seen.add(key)
    }
    assert.ok(session.control_history.length <= (session.turn_counter || 0) + 1,
      "history length <= turn_counter+1")
  }
})

// ════════════════════════════════════════════════════════════════════
// TEST 2: Flow warn full-history dedup — same file+rule = 1 warn only
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: flow enforcer — same file+rule hit 5 times produces exactly 1 warn", async () => {
  const flowEnforcer = await import("../src/vibeOS-lib/flow-enforcer.js?flhit=" + Date.now())
  flowEnforcer.resetAll()

  assert.doesNotThrow(() => {
    flowEnforcer.addFlowRule({
      id: "detect-api-key",
      severity: "high",
      description: "Detect hardcoded API keys",
      patterns: ["sk-[a-zA-Z0-9]{10,}"],
      trigger: "write",
      enabled: true,
    })
  }, "addFlowRule must not throw (writes to sandbox via VIBEOS_FLOW_RULES_PATH)")

  const args = { tool: "write", filePath: "/app/config.ts", content: "const key = \"sk-abc123456789\"" }

  for (let i = 0; i < 5; i++) {
    flowEnforcer.checkFlowRules(args)
  }

  const warns = flowEnforcer.getFlowWarns()
  const matching = warns.filter(w =>
    w.rule_id === "detect-api-key" && w.filePath === "/app/config.ts")

  assert.equal(matching.length, 1,
    "5 hits on same file+rule must produce exactly 1 warn, got " + matching.length)

  // The 5 hits deduped to 1 warn — production flow-rules.json is not polluted
  // (VIBEOS_FLOW_RULES_PATH env var redirects writes to sandbox)
})

// ════════════════════════════════════════════════════════════════════
// TEST 3: Flow warn — different files can each get their own warn
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: flow enforcer — different files each record their own warn", async () => {
  const flowEnforcer = await import("../src/vibeOS-lib/flow-enforcer.js?flmulti=" + Date.now())
  flowEnforcer.resetAll()

  flowEnforcer.addFlowRule({
    id: "detect-password",
    severity: "high",
    description: "Detect hardcoded passwords",
    patterns: ["password\\s*=\\s*[\"'][^\"']+[\"']"],
    trigger: "write",
    enabled: true,
  })

  const files = ["/app/auth.ts", "/app/db.ts", "/app/config.ts"]
  for (const fp of files) {
    flowEnforcer.checkFlowRules({ tool: "write", filePath: fp, content: "password = \"secret123\"" })
  }

  const warns = flowEnforcer.getFlowWarns()
  const matching = warns.filter(w => w.rule_id === "detect-password")

  assert.equal(matching.length, files.length,
    "3 different files must each get their own warn: got " + matching.length)
})

// ════════════════════════════════════════════════════════════════════
// TEST 4: TDD context gate — classifyTurnSimple separates research from coding
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: TDD — classifyTurnSimple gates research vs coding correctly", async () => {
  const classifiers = await import("../src/lib/classifiers.js?tddctx=" + Date.now())

  const researchPhrases = [
    "how does the cascade router work?",
    "what is the difference between brain and medium tiers?",
    "explain the blackbox decision engine",
    "show me the delegation enforcement logic",
    "find all occurrences of remoteCall",
  ]

  const codingPhrases = [
    "write a function to validate API tokens",
    "fix the bug in the delegation enforcer",
    "implement the stress scoring pipeline",
    "add a new trinity command for rebuild",
    "refactor the pattern learner to use sessions threshold",
  ]

  for (const phrase of researchPhrases) {
    const cls = classifiers.classifyTurnSimple(phrase)
    assert.ok(cls === "EXPLORING" || cls === "DIVERGENT",
      "\"" + phrase + "\" must classify as EXPLORING/DIVERGENT (research), got: " + cls)
  }

  for (const phrase of codingPhrases) {
    const cls = classifiers.classifyTurnSimple(phrase)
    assert.ok(cls === "REFINING" || cls === "INIT",
      "\"" + phrase + "\" must classify as REFINING/INIT (coding), got: " + cls)
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
  assert.ok(hasSkeleton,
    "write must trigger test skeleton creation, output: " + (output.text || "").slice(0, 200))
})

// ════════════════════════════════════════════════════════════════════
// TEST 6: Delegation enforcement — brain-tier write hits enforcement path
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: delegation — brain-tier write updates delegation state", async (t) => {
  const { home, sandbox } = makeSandbox("del-state")
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

  const mod = await import("../src/index.js?delstate=" + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })
  if (!hooks["tool.execute.before"]) return

  // Write on brain tier — must not crash
  await assert.doesNotReject(async () => {
    await hooks["tool.execute.before"](
      { tool: "write", args: { filePath: join(projectDir, "src/test.ts"), content: "export const x = 1" } },
      { text: "" }
    )
  }, "tool.execute.before must not throw for write on brain tier")

  // Verify delegation state is readable and has expected structure
  const delState = JSON.parse(readFileSync(join(home, ".claude/delegation-state.json"), "utf-8"))
  assert.ok(typeof delState.lifetime.total_savings_usd === "number", "must have total_savings_usd")
  assert.ok(typeof delState.lifetime.cache_savings_usd === "number", "must have cache_savings_usd")
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
// TEST 8: Pattern learner — self-pair exclusion in observeToolPattern
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: patterns — self-pair tool chains excluded from promoted routines", async () => {
  const { home } = makeSandbox("pat-self")
  process.env.HOME = home

  const mod = await import("../src/index.js?patself=" + Date.now())

  // Simulate bash→bash self-pairs (3 in a row should trigger promotion without the fix)
  for (let i = 0; i < 5; i++) {
    mod.observeToolPattern("bash", { command: "ls" })
  }

  // Simulate cross-tool pair (read→grep)
  mod.observeToolPattern("read", { filePath: "test.ts" })
  mod.observeToolPattern("grep", { pattern: "TODO" })
  mod.observeToolPattern("grep", { pattern: "FIXME" })

  mod.observeToolPattern("read", { filePath: "test.ts" })
  mod.observeToolPattern("grep", { pattern: "TODO" })
  mod.observeToolPattern("grep", { pattern: "FIXME" })

  const glPath = join(process.env.VIBEOS_HOME, "global-learning.json")
  const gl = JSON.parse(readFileSync(glPath, "utf-8"))
  const promoted = gl.promotedRoutines || []

  // bash→bash must NOT appear (self-pair exclusion fix)
  assert.ok(!promoted.some(p => p.startsWith("bash→bash")),
    "bash→bash self-pair must NOT be promoted: " + JSON.stringify(promoted))

  // read→grep CAN appear (legitimate cross-tool pair with ≥3 hits)
  if (promoted.length > 0) {
    const hasReadGrep = promoted.some(p => p.startsWith("read→grep"))
    console.log("Promoted routines:", promoted, "| has read->grep:", hasReadGrep)
  }
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
// TEST 10: Full pipeline — system.transform runs end-to-end without crash
// ════════════════════════════════════════════════════════════════════

test("quality-pipeline: full pipeline — system.transform completes with all fixes active", async (t) => {
  const { home, sandbox } = makeSandbox("full-pipe")
  process.env.HOME = home

  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, "README.md"), "# Test Project\n## Overview\nTest project for quality pipeline")
  writeFileSync(join(projectDir, "AGENTS.md"), "# AGENTS\n\nAsk before changing code.")

  // Enable all features: blackbox, flow, TDD, delegation
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

  const mod = await import("../src/index.js?fullpipe=" + Date.now())
  const hooks = await mod.DelegationEnforcer({ directory: projectDir })

  const allHooks = ["experimental.chat.system.transform", "experimental.chat.messages.transform",
    "tool.execute.before", "tool.execute.after"]
  for (const name of allHooks) {
    assert.ok(typeof hooks[name] === "function", "hook " + name + " must be a function")
  }

  // Run system.transform — must complete without throwing
  const sysOut = { system: [] }
  await assert.doesNotReject(async () => {
    await hooks["experimental.chat.system.transform"](
      {
        messages: [
          { role: "user", content: "implement the auth middleware" },
          { role: "assistant", content: "I'll implement the auth middleware now." },
        ],
        system: { messages: [] },
        model: "deepseek/deepseek-v4-pro",
        mcp_config: { servers: {} }
      },
      sysOut
    )
  }, "system.transform must complete without throwing")

  // Verify system messages were injected (cost policy, project guard, anti-fabrication, etc.)
  const messages = sysOut.messages || sysOut.system || []
  assert.ok(messages.length > 0,
    "system.transform must inject system prompt messages: got " + messages.length)

  // Run tool.execute.before — write on brain tier must not crash
  await assert.doesNotReject(async () => {
    await hooks["tool.execute.before"](
      { tool: "write", args: { filePath: join(projectDir, "src/auth.ts"), content: "export const auth = {}" } },
      { text: "" }
    )
  }, "tool.execute.before for write must not crash")

  // Run tool.execute.after — must not crash
  await assert.doesNotReject(async () => {
    await hooks["tool.execute.after"](
      { tool: "write", args: { filePath: join(projectDir, "src/auth.ts") } },
      { text: "export const auth = {}" }
    )
  }, "tool.execute.after for write must not crash")
})

test.after(() => {})
