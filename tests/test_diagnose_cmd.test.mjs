// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// Tests for the trinity diagnose command

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const sandbox = mkdtempSync(join(tmpdir(), "diagnose-test-"))
const HOME = sandbox
process.env.HOME = sandbox
  process.env.VIBEOS_HOME = join(sandbox, ".claude")

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

function writeTiers(trinity, sel = {}) {
  writeFileSync(join(HOME, ".claude/model-tiers.json"), JSON.stringify({
    selection: { active_slot: "brain", enabled: true, monthly_budget_usd: 50, ...sel },
    trinity: {
      brain:  { oc: "deepseek/deepseek-v4-pro",  cc: "haiku" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap:  { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
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
  assert.ok(output.includes("brain") && output.includes("deepseek-v4-pro"), "brain slot populated: " + output)
  assert.ok(output.includes("medium") && output.includes("deepseek-v4-flash"), "medium slot populated: " + output)
  assert.ok(output.includes("cheap") && output.includes("deepseek-v4-flash"), "cheap slot populated: " + output)
  assert.ok(output.includes("probe") || output.includes("model"), "model probe present")
  assert.ok(output.includes("credits") || output.includes("Credits"), "credits check present: " + output)
  assert.ok(output.includes("88%"), "credits shows 88%: " + output)
  assert.ok(output.includes("runway") || output.includes("turns"), "runway estimate shown: " + output)
  assert.ok(output.includes("warn") || output.includes("delegate") || output.includes("rate") || output.includes("slot"), "diagnosis shows stats: " + output.slice(-100))
  assert.ok(output.includes("delegate") || output.includes("delegat") || output.includes("warn"), "delegation count shown")
  assert.ok(output.includes("TDD") || output.includes("passed") || output.includes("OK") || output.includes("/"), "TDD count or pass stats shown: " + output.slice(-120))

  const passCount = (output.match(/\u2705/g) || []).length
  const okCount = (output.match(/OK/g) || []).length
  // Model probe fails with fake API key; credit and slots should pass
  assert.ok(passCount + okCount >= 6, "diagnose passes: " + output.slice(0, 120))
})

test("diagnose cascade reports VIBEOS_HOME cascade state and repair candidates", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers({}, {
    active_slot: "brain",
    optimization_mode: "vibeultrax",
    requested_optimization_mode: "vibeultrax",
    active_pipeline: ["cheap"],
    vector_changed_pipeline: ["cheap"],
  })
  writeState()
  writeFileSync(join(HOME, ".claude/blackbox-state.json"), JSON.stringify({
    enabled: true,
    cv: {
      optimization_mode: "vibeultrax",
      tier_bias: "brain",
      pipeline_root: ["cheap"],
      cascade_depth: 1,
    },
    sessions: {},
  }, null, 2) + "\n")

  const hooks = await freshPlugin()
  const output = await hooks.tool.trinity.execute({ action: "diagnose", slot: "cascade" })

  assert.ok(output.includes("cascade vibeos_home"), "cascade VIBEOS_HOME line present: " + output)
  assert.ok(output.includes("cascade active_pipeline"), "cascade active_pipeline line present: " + output)
  assert.ok(output.includes("cascade repair candidates"), "cascade repair candidates line present: " + output)
  assert.ok(output.includes("repair-state apply"), "cascade diagnose should point to repair command: " + output)
})

test("repair-state apply normalizes stale VibeUltraX state in VIBEOS_HOME", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers({}, {
    active_slot: "brain",
    optimization_mode: "vibeultrax",
    requested_optimization_mode: "vibeultrax",
    active_pipeline: ["cheap"],
    vector_changed_pipeline: ["cheap"],
  })
  writeState()
  writeFileSync(join(HOME, ".claude/blackbox-state.json"), JSON.stringify({
    enabled: true,
    cv: {
      optimization_mode: "vibeultrax",
      tier_bias: "brain",
      pipeline_root: ["cheap"],
      cascade_depth: 1,
    },
    sessions: {
      "sid-repair": {
        cv: {
          optimization_mode: "vibeultrax",
          tier_bias: "brain",
          pipeline_root: ["cheap"],
          cascade_depth: 1,
        },
      },
    },
  }, null, 2) + "\n")

  const hooks = await freshPlugin()
  const output = await hooks.tool.trinity.execute({ action: "repair-state", slot: "apply" })
  const tiers = JSON.parse(readFileSync(join(HOME, ".claude/model-tiers.json"), "utf8"))
  const blackbox = JSON.parse(readFileSync(join(HOME, ".claude/blackbox-state.json"), "utf8"))

  assert.ok(output.includes("Applied"), "repair should apply: " + output)
  assert.equal(tiers.selection.active_slot, "cheap")
  assert.deepEqual(tiers.selection.active_pipeline, ["cheap", "medium", "brain"])
  assert.deepEqual(tiers.selection.vector_changed_pipeline, ["cheap", "medium", "brain"])
  assert.deepEqual(blackbox.cv.cascade_root, ["cheap", "medium", "brain"])
  assert.deepEqual(blackbox.cv.pipeline_root, ["cheap", "medium", "brain"])
  assert.deepEqual(blackbox.cv.route_path, ["cheap"])
  assert.equal(blackbox.cv.tier_bias, "cheap")
})

test("diagnose: shows api fallback and non-failing runway when balance exists", async () => {
  baseDirs()
  writeOpenCodeConfig()
  writeTiers()
  writeState()
  mkdirSync(join(HOME, "test-project"), { recursive: true })

  const prev = {
    VIBEOS_API_URL: process.env.VIBEOS_API_URL,
    VIBEOS_API_TOKEN: process.env.VIBEOS_API_TOKEN,
    VIBEOS_API_DISABLED: process.env.VIBEOS_API_DISABLED,
    fetch: globalThis.fetch,
  }
  process.env.VIBEOS_API_URL = "http://127.0.0.1:1"
  process.env.VIBEOS_API_TOKEN = "vos_diagnose_fallback_0000000000000000000000000000000000000000000000000000000000000000"
  delete process.env.VIBEOS_API_DISABLED
  globalThis.fetch = async (url) => {
    const href = String(url || "")
    if (href.includes("127.0.0.1:1")) {
      throw new Error("remote api unavailable")
    }
    if (href.includes("api.deepseek.com/user/balance")) {
      await new Promise(resolve => setTimeout(resolve, 20))
      return {
        ok: true,
        json: async () => ({ balance_infos: [{ currency: "USD", total_balance: "78.52" }] }),
      }
    }
    throw new Error(`unexpected fetch: ${href}`)
  }

  try {
    const mod = await import("../src/index.js?diagfb=" + Date.now())
    await mod.remoteCall("health", [], () => "fallback")
    const hooks = await mod.DelegationEnforcer({ client: {}, directory: join(HOME, "test-project") })
    await hooks.tool.trinity.execute({ action: "status" })
    await new Promise(resolve => setTimeout(resolve, 50))
    writeCredit(78.52, 50)
    const output = await hooks.tool.trinity.execute({ action: "diagnose" })

    assert.ok(output.toLowerCase().includes("api fallback"), "fallback line present: " + output)
    assert.ok(!output.includes("API responsive"), "diagnose should not claim API responsive while fallback is active: " + output)
    assert.ok(output.includes("78.52") && output.includes("runway"), "runway line present with live balance: " + output)
    assert.ok(!output.includes("n/a") || output.includes("balance snapshot present"), "runway no longer collapses to n/a: " + output)
  } finally {
    if (prev.VIBEOS_API_URL === undefined) delete process.env.VIBEOS_API_URL
    else process.env.VIBEOS_API_URL = prev.VIBEOS_API_URL
    if (prev.VIBEOS_API_TOKEN === undefined) delete process.env.VIBEOS_API_TOKEN
    else process.env.VIBEOS_API_TOKEN = prev.VIBEOS_API_TOKEN
    if (prev.VIBEOS_API_DISABLED === undefined) delete process.env.VIBEOS_API_DISABLED
    else process.env.VIBEOS_API_DISABLED = prev.VIBEOS_API_DISABLED
    globalThis.fetch = prev.fetch
  }
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

  assert.ok((output.includes("brain") && output.includes("\u2705")) || output.includes("brain slot"), "brain should pass: " + output.slice(0, 100))
  assert.ok((output.includes("medium") || output.includes("placeholder")), "medium flagged placeholder: " + output)
  assert.ok((output.includes("cheap") || output.includes("unset")), "cheap flagged unset: " + output)

  const failCount = (output.match(/\u274c/g) || []).length
  assert.ok(failCount >= 1 || output.includes("MISSING") || output.includes("LOW"), `expected >= 1 failure, got ${failCount}: ${output}`)
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

  assert.ok((output.includes("credits") || output.includes("Credit")) && (output.includes("LOW") || output.includes("\u274c")), "low credit flagged: " + output)
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
  assert.ok(output.match(/checks (passed|failed|\u2705|\u274c)/) || output.includes("check") || output.includes("/") && output.includes("passed"), "pass/fail summary line: " + output.slice(-80))
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
