// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 VibeTheOG <https://github.com/DrunkkToys/VibeTheOG>
// Tests for the trinity diagnose command

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const sandbox = mkdtempSync(join(tmpdir(), "diagnose-test-"))
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
    provider: { deepseek: { models: { "deepseek-v4-pro": {}, "deepseek-v4-flash": {}, "deepseek-chat": {} } } }
  }, null, 2) + "\n")
}

function writeTiers(trinity, sel = {}) {
  writeFileSync(join(HOME, ".claude/model-tiers.json"), JSON.stringify({
    selection: { active_slot: "brain", enabled: true, monthly_budget_usd: 50, ...sel },
    trinity: {
      brain:  { oc: "deepseek/deepseek-v4-pro",  cc: "haiku" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap:  { oc: "deepseek/deepseek-chat",     cc: "haiku" },
      ...(trinity || {})
    }
  }, null, 2) + "\n")
}

function writeCredit(total, budget) {
  writeFileSync(join(HOME, ".claude/credit-snapshot.json"), JSON.stringify({
    total,
    providers: [{ provider: "deepseek", balance: total }],
    ts: new Date().toISOString()
  }, null, 2) + "\n")
}

function writeState(sesWarns = [], flowWarns = []) {
  writeFileSync(join(HOME, ".claude/delegation-state.json"), JSON.stringify({
    lifetime: { warn_count: 5, scratchpad_hits_observed: 2, tdd_enforced: 3, cache_savings_usd: 0.45 },
    sessions: {
      [String(process.pid)]: {
        model: "deepseek/deepseek-v4-flash",
        warns: sesWarns,
        cost_usd: 0.10
      }
    },
    flow_warns: flowWarns,
  }, null, 2) + "\n")
}

async function freshPlugin() {
  const mod = await import("../src/index.js?t=" + Date.now())
  const { DelegationEnforcer } = mod
  return await DelegationEnforcer({ client: {}, directory: join(HOME, "test-project") })
}

test("diagnose: all checks pass with full config", async () => {
  baseDirs()
  writeOpenCodeConfig()
  // No writeAuth — avoid async fetch that delays _snapshot()
  writeTiers()
  writeState(
    [{ tool: "edit", reason: "high-tier direct edit", est_savings_usd: 0.05 }],
    [
      { sid: String(process.pid), tool: "write", rule: "new-md-file", severity: "warn", msg: ".md file" },
      { sid: String(process.pid), tool: "write", rule: "todo-comment", severity: "hint", msg: "TODO" },
    ]
  )

  const hooks = await freshPlugin()
  // Dummy trinity call to trigger _lazyRefresh -> _snapshot (sets _started=true).
  // After this, _snapshot won't fire again and overwrite our credit data.
  await hooks.tool.trinity.execute({ action: "status" })
  // Now rewrite after snapshot has settled
  writeTiers()
  writeCredit(44, 50) // 44/50 * 100 = 88%

  const output = await hooks.tool.trinity.execute({ action: "diagnose" })

  assert.ok(output.includes("Self Diagnostic"), "header present")
  assert.ok(output.includes("model-tiers.json") && output.includes("exists"), "model-tiers.json check")
  assert.ok(output.includes("opencode.json") && output.includes("exists"), "opencode.json check")
  assert.ok(output.includes("delegation-state.json") && output.includes("exists"), "delegation-state.json check")
  assert.ok(output.includes("brain slot") && output.includes("deepseek-v4-pro"), "brain slot populated: " + output)
  assert.ok(output.includes("medium slot") && output.includes("deepseek-v4-flash"), "medium slot populated: " + output)
  assert.ok(output.includes("cheap slot") && output.includes("deepseek-chat"), "cheap slot populated: " + output)
  assert.ok(output.includes("model probe"), "model probe present")
  assert.ok(output.includes("credits") && output.includes("\u2705"), "credits check passes: " + output)
  assert.ok(output.includes("88%"), "credits shows 88%: " + output)
  assert.ok(output.includes("session"), "session stats present")
  assert.ok(output.includes("delegates"), "delegation count shown")
  assert.ok(output.includes("TDD"), "TDD count shown")
  assert.ok(output.includes("3 TDD"), "TDD count correct")

  const passCount = (output.match(/\u2705/g) || []).length
  // Model probe fails with fake API key; credit and slots should pass
  assert.ok(passCount >= 8, `expected >= 8 ✅, got ${passCount}: ${output}`)
})

test("diagnose: missing files reported as ❌", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()

  const hooks = await freshPlugin()
  unlinkSync(join(HOME, ".claude/model-tiers.json"))
  unlinkSync(join(HOME, ".claude/delegation-state.json"))

  const output = await hooks.tool.trinity.execute({ action: "diagnose" })

  assert.ok(output.includes("model-tiers.json") && output.includes("missing"), "model-tiers.json missing")
  assert.ok(output.includes("delegation-state.json") && output.includes("missing"), "delegation-state.json missing")
  assert.ok(output.includes("opencode.json") && output.includes("exists"), "opencode.json still exists")
})

test("diagnose: placeholder models flagged ❌", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers({ medium: { oc: "placeholder-to-replace", cc: "haiku" }, cheap: { oc: "", cc: "haiku" } })
  writeState()

  const hooks = await freshPlugin()
  // Rewrite tiers after auto-sync
  writeTiers({ medium: { oc: "placeholder-to-replace", cc: "haiku" }, cheap: { oc: "", cc: "haiku" } })

  const output = await hooks.tool.trinity.execute({ action: "diagnose" })

  assert.ok(output.includes("brain slot") && output.includes("\u2705"), "brain should pass")
  assert.ok(output.includes("medium slot") && output.includes("placeholder"), "medium flagged placeholder: " + output)
  assert.ok(output.includes("cheap slot") && output.includes("unset"), "cheap flagged unset: " + output)

  const failCount = (output.match(/\u274c/g) || []).length
  assert.ok(failCount >= 2, `expected >= 2 ❌, got ${failCount}: ${output}`)
})

test("diagnose: credit low triggers ❌", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()

  const hooks = await freshPlugin()
  // Trigger initial _snapshot so it doesn't overwrite our credit data
  await hooks.tool.trinity.execute({ action: "status" })
  // Rewrite tiers first, then credit
  writeTiers()
  writeCredit(5, 50) // 5/50 * 100 = 10%

  const output = await hooks.tool.trinity.execute({ action: "diagnose" })

  assert.ok(output.includes("credits") && output.includes("\u274c"), "low credit flagged ❌: " + output)
  assert.ok(output.includes("10%"), "shows correct low percentage: " + output)
})

test("diagnose: pass/fail count summary line", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()

  const hooks = await freshPlugin()
  await hooks.tool.trinity.execute({ action: "status" })
  writeTiers()
  writeCredit(44, 50)

  const output = await hooks.tool.trinity.execute({ action: "diagnose" })
  assert.ok(output.match(/checks passed/), "pass/fail summary line: " + output.slice(-80))
})

test("diagnose: appears in help", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()

  const hooks = await freshPlugin()

  const help = await hooks.tool.trinity.execute({ action: "help" })
  assert.ok(help.includes("diagnose"), "diagnose listed in help")
})
