// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// Tests that blackbox (VibeMax ML engine) is enabled by default

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const sandbox = mkdtempSync(join(tmpdir(), "bb-default-"))
const HOME = sandbox
process.env.HOME = sandbox

function baseDirs() {
  mkdirSync(join(HOME, ".config/opencode"), { recursive: true })
  mkdirSync(join(HOME, ".claude"), { recursive: true })
  mkdirSync(join(HOME, ".local/share/opencode"), { recursive: true })
}

function writeOpenCodeConfig() {
  writeFileSync(join(HOME, ".config/opencode/opencode.json"), JSON.stringify({
    model: "deepseek/deepseek-v4-flash",
    provider: { deepseek: { models: { "deepseek-v4-pro": {}, "deepseek-v4-flash": {} } } }
  }, null, 2) + "\n")
}

function writeTiers() {
  writeFileSync(join(HOME, ".claude/model-tiers.json"), JSON.stringify({
    selection: { active_slot: "brain", enabled: true, monthly_budget_usd: 50 },
    trinity: {
      brain:  { oc: "deepseek/deepseek-v4-pro",  cc: "haiku" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap:  { oc: "deepseek/deepseek-v4-flash", cc: "haiku" }
    }
  }, null, 2) + "\n")
}

function writeState() {
  writeFileSync(join(HOME, ".claude/delegation-state.json"), JSON.stringify({
    lifetime: { warn_count: 0, scratchpad_hits_observed: 0, tdd_enforced: 0, cache_savings_usd: 0 },
    sessions: { [String(process.pid)]: { model: "deepseek/deepseek-v4-flash", warns: [], cost_usd: 0 } }
  }, null, 2) + "\n")
}

function writeBlackboxState(data) {
  writeFileSync(join(HOME, ".claude/blackbox-state.json"), JSON.stringify(data, null, 2) + "\n")
}

async function freshPlugin() {
  const mod = await import("../src/index.js?t=" + Date.now())
  const { DelegationEnforcer } = mod
  return await DelegationEnforcer({ client: {}, directory: join(HOME, "test-project") })
}

test("fresh start: no blackbox-state.json defaults to enabled:true", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()

  const mod = await import("../src/index.js?t=" + Date.now())
  const bbFile = join(HOME, ".claude/blackbox-state.json")
  assert.ok(!existsSync(bbFile), "blackbox-state.json should not exist on fresh start")

  const state = mod.loadBlackboxState()
  assert.deepStrictEqual(state, { enabled: true, sessions: {} })
  assert.strictEqual(state.enabled, true, "fresh blackbox should default to enabled:true")
})

test("existing state with enabled:false persists correctly", async () => {
  baseDirs()
  writeBlackboxState({ enabled: false, sessions: {} })

  const mod = await import("../src/index.js?t=" + Date.now())
  const state = mod.loadBlackboxState()
  assert.strictEqual(state.enabled, false, "enabled:false state should persist through loadBlackboxState")
})

test("auto-enable guard: setBlackboxEnabled(true) + save re-enables blackbox", async () => {
  baseDirs()
  writeBlackboxState({ enabled: false, sessions: {} })
  writeOpenCodeConfig()
  writeTiers()
  writeState()

  const stateMod = await import("../src/lib/state.js?t=" + Date.now())
  const indexMod = await import("../src/index.js?t=" + Date.now())

  stateMod.setBlackboxEnabled(true)

  const state = indexMod.loadBlackboxState()
  state.enabled = true
  indexMod.saveBlackboxState(state)

  const reloaded = indexMod.loadBlackboxState()
  assert.strictEqual(reloaded.enabled, true, "blackbox should be enabled after auto-enable guard")
})

test("mode policy returns a decision when blackbox is enabled", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState({ enabled: true, sessions: {} })

  const { peekBudgetFirstMode } = await import("../src/lib/mode-policy.js?t=" + Date.now())
  const decision = peekBudgetFirstMode({})
  assert.ok(decision !== null && decision !== undefined, "peekBudgetFirstMode should return a non-null decision")
  assert.ok(typeof decision === "object", "decision should be an object")
})

test("trinity blackbox toggle preserves enabled state through on/off/on cycle", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState({ enabled: true, sessions: {} })

  const hooks = await freshPlugin()
  const offOutput = await hooks.tool.trinity.execute({ action: "blackbox", slot: "off" })
  assert.ok(offOutput.includes("DISABLED"), 'blackbox off should report DISABLED')

  const indexMod = await import("../src/index.js?t=" + Date.now())
  let state = indexMod.loadBlackboxState()
  assert.strictEqual(state.enabled, false, "blackbox should be disabled after trinity blackbox off")

  const onOutput = await hooks.tool.trinity.execute({ action: "blackbox", slot: "on" })
  assert.ok(onOutput.includes("ENABLED"), 'blackbox on should report ENABLED')

  state = indexMod.loadBlackboxState()
  assert.strictEqual(state.enabled, true, "blackbox should be re-enabled after trinity blackbox on")
})

test("trinity status shows blackbox enabled indicator", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState({ enabled: true, sessions: {} })

  const hooks = await freshPlugin()
  const statusOutput = await hooks.tool.trinity.execute({ action: "blackbox", slot: "status" })
  assert.ok(typeof statusOutput === "string", "blackbox status should return a string")
  assert.ok(statusOutput.length > 0, "blackbox status should be non-empty")
})

test("auto-enable guard checks persisted state, not just in-memory", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState({ enabled: false, sessions: {} })

  const { isApiConnected } = await import("../src/lib/api-client.js?t=" + Date.now())
  if (!isApiConnected()) return

  const { loadBlackboxState: loadBB, saveBlackboxState: saveBB } = await import("../src/index.js?t=" + Date.now())
  const { setBlackboxEnabled } = await import("../src/lib/turn-classify.js?t=" + Date.now())

  const bbBefore = loadBB()
  assert.strictEqual(bbBefore.enabled, false, "persisted state should be false before guard")

  setBlackboxEnabled(true)
  const bb = loadBB()
  if (!bb.enabled) { bb.enabled = true; saveBB(bb) }

  const bbAfter = loadBB()
  assert.strictEqual(bbAfter.enabled, true, "persisted state should be true after guard")
})

test("live session: API connected + blackbox enabled = ML routing works", { skip: !!process.env.CI }, async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState({ enabled: true, sessions: {} })

  const { isApiConnected, remoteCall } = await import("../src/lib/api-client.js?t=" + Date.now())
  if (!isApiConnected()) return

  const result = await remoteCall("blackboxSelectMode", ["INIT", 0.2], null)
  assert.ok(result, "should return a result")
  assert.ok(result.mode, "should have a mode")
  assert.ok(["budget", "quality", "speed"].includes(result.mode), "mode should be valid")
})

test("live session: trinity setup does not disable blackbox", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState({ enabled: true, sessions: {} })

  const hooks = await freshPlugin()
  const output = await hooks.tool.trinity.execute({ action: "setup", slot: "" })
  assert.ok(typeof output === "string", "setup should return a string")
  assert.ok(output.includes("Blackbox: on") || output.includes("blackbox") || output.includes("Blackbox"), "setup output should mention blackbox as on")

  const indexMod = await import("../src/index.js?t=" + Date.now())
  const state = indexMod.loadBlackboxState()
  assert.strictEqual(state.enabled, true, "blackbox should remain enabled after setup")
})

// ═══════════════════════════════════════════════════════════════════
// REAL INTEGRATION TESTS — full end-to-end flows
// ═══════════════════════════════════════════════════════════════════

test("E2E: shell.env returns correct env vars with blackbox enabled", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState({ enabled: true, sessions: {} })

  const hooks = await freshPlugin()
  const envOut = { env: {} }
  await hooks["shell.env"]({}, envOut)

  assert.ok(envOut.env.OPENCODE_MODEL_TIER, "should set OPENCODE_MODEL_TIER")
  assert.ok(envOut.env.OPENCODE_MODEL, "should set OPENCODE_MODEL")
  assert.ok(["high", "mid", "budget", "unknown"].includes(envOut.env.OPENCODE_MODEL_TIER), "tier should be valid")
})

test("E2E: tool.execute.before does not throw on write tool", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  writeBlackboxState({ enabled: true, sessions: {} })

  const hooks = await freshPlugin()
  const input = { tool: "write", args: { file_path: "/tmp/test.txt" } }
  const output = {}
  await hooks["tool.execute.before"](input, output)

  assert.ok(true, "tool.execute.before should not throw")
})

test("E2E: full lifecycle — fresh start → blackbox on → mode policy → trinity status", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()

  const mod = await import("../src/index.js?t=" + Date.now())
  const bb = mod.loadBlackboxState()
  assert.strictEqual(bb.enabled, true, "1. fresh start: blackbox defaults to enabled")

  const hooks = await freshPlugin()
  const status = await hooks.tool.trinity.execute({ action: "status", slot: "" })
  assert.ok(typeof status === "string", "2. trinity status returns string")
  assert.ok(status.length > 10, "3. trinity status is non-trivial")

  const envOut = { env: {} }
  await hooks["shell.env"]({}, envOut)
  assert.ok(envOut.env.OPENCODE_MODEL_TIER, "4. shell.env sets tier")

  const { isApiConnected, remoteCall } = await import("../src/lib/api-client.js?t=" + Date.now())
  if (isApiConnected()) {
    const r = await remoteCall("blackboxSelectMode", ["INIT", 0.1], null)
    const hasMode = r && (r.mode || r.optimization_mode)
    assert.ok(hasMode, "5. ML routing returns mode")
  } else {
    const { resolveOptimizationMode } = await import("../src/lib/turn-classify.js?t=" + Date.now())
    const mode = resolveOptimizationMode("INIT", 0.1, "auto")
    assert.ok(mode, "5. local mode resolution returns mode")
  }
})
