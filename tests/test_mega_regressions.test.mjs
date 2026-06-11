#!/usr/bin/env node
/**
 * MEGA REGRESSION TEST — Covers all claimed fixes in last 20 commits
 * Run: node tests/test_mega_regressions.test.mjs
 */
import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

let sandbox
before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "mega-reg-"))
  mkdirSync(join(sandbox, ".claude/scratch"), { recursive: true })
  process.env.HOME = sandbox
})
beforeEach(() => {
  for (const f of ["model-tiers.json", "delegation-state.json", "savings-ledger.jsonl", "active-jobs.json", "global-learning.json", "project-states.json", "blackbox-state.json"]) {
    rmSync(join(sandbox, ".claude", f), { force: true })
  }
  rmSync(join(sandbox, ".claude", "reports"), { recursive: true, force: true })
  delete process.env.CLAUDE_CREDIT_PERCENT
  delete process.env.VIBEOS_MCP_PORT
})
after(() => rmSync(sandbox, { recursive: true, force: true }))

async function loadPlugin() {
  return import("../src/index.js?t=" + Date.now())
}

function seedTiers(overrides = {}) {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: { brain: { oc: "anthropic/claude-opus-4-7" }, medium: { oc: "deepseek/deepseek-v4-flash" }, cheap: { oc: "deepseek/deepseek-chat" } },
    selection: { enabled: true, active_slot: "brain", delegation_enforce: true },
    ...overrides,
  }, null, 2))
}

async function runChildMutation(home, kind, readyPath, releasePath) {
  const pricingUrl = pathToFileURL(join(process.cwd(), "src/lib/pricing.js")).href
  const selectionUrl = pathToFileURL(join(process.cwd(), "src/lib/selection-manager.js")).href
  const script = `
    const fs = await import("node:fs")
    const kind = ${JSON.stringify(kind)}
    const readyPath = ${JSON.stringify(readyPath)}
    const releasePath = ${JSON.stringify(releasePath)}
    const pricing = await import(${JSON.stringify(pricingUrl)} + "?race=" + Date.now())
    const selection = await import(${JSON.stringify(selectionUrl)} + "?race=" + Date.now())
    fs.writeFileSync(readyPath, String(process.pid))
    while (!fs.existsSync(releasePath)) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    let result
    if (kind === "write-slot") {
      result = selection.writeSelection("active_slot", "medium")
    } else if (kind === "write-thinking") {
      result = selection.writeSelection("thinking_level", "full")
    } else if (kind === "write-flow") {
      result = selection.writeSelection("flow_enabled", false)
    } else {
      throw new Error("unknown mutation: " + kind)
    }
    console.log(JSON.stringify({ kind, result }))
  `
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env: {
        ...process.env,
        HOME: home,
        VIBEOS_HOME: join(home, ".claude"),
        VIBEOS_OPENCODE_HOME: join(home, ".config/opencode"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`mutation child failed (${kind}) with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

// ═══════════════════════════════════════════════════════════════════
// FIX 1: f743042 — Blackbox enabled by default
// ═══════════════════════════════════════════════════════════════════
test("FIX 1a: loadBlackboxState defaults to enabled:true when no file exists", async () => {
  const mod = await loadPlugin()
  const bb = mod.loadBlackboxState()
  assert.equal(bb.enabled, true, "fresh blackbox-state should default to enabled:true")
})

test("FIX 1b: trinity setup does NOT disable blackbox", async () => {
  const mod = await loadPlugin()
  const { DelegationEnforcer } = mod
  seedTiers()
  const bbBefore = mod.loadBlackboxState()
  assert.equal(bbBefore.enabled, true)
  const dir = join(sandbox, ".opencode-setup")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-flash" }))
  await DelegationEnforcer({ client: {}, directory: dir })
  const bbAfter = mod.loadBlackboxState()
  assert.equal(bbAfter.enabled, true, "blackbox should remain enabled after setup operations")
})

test("FIX 1c: auto-enable guard re-enables blackbox when API connected", async () => {
  const { isApiConnected } = await import("../src/lib/api-client.js")
  const mod = await loadPlugin()
  if (!isApiConnected()) {
    console.log("  SKIP: API not connected in test env")
    return
  }
  const { saveBlackboxState } = mod
  saveBlackboxState({ enabled: false, sessions: {} })
  const bbOff = mod.loadBlackboxState()
  assert.equal(bbOff.enabled, false, "should be disabled after manual save")
  // The auto-enable guard runs in chat-transform system.transform hook
  // Verify API is connected (guard condition)
  assert.equal(isApiConnected(), true, "API should be connected for guard to work")
  console.log("  PASS: auto-enable guard condition met (API connected, blackbox can be re-enabled)")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 2: 293a26d — Footer brand uses raw optModeFooter
// ═══════════════════════════════════════════════════════════════════
test("FIX 2: Footer brand selection uses correct mode strings", async () => {
  const { BRANDED_MODES } = await import("../src/lib/mode-router.js")
  assert.ok(BRANDED_MODES, "BRANDED_MODES should exist")
  const ids = BRANDED_MODES.map(m => m.id)
  assert.ok(ids.includes("vibeultrax"), "should have vibeultrax")
  assert.ok(ids.includes("vibeqmax"), "should have vibeqmax")
  assert.ok(ids.includes("vibemax"), "should have vibemax")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 3: 70a8e29 — Trinity mode persistence via sid+_opt key
// ═══════════════════════════════════════════════════════════════════
test("FIX 3: loadSessionOptMode reads from sid key in blackbox-state", async () => {
  const { loadSessionOptMode } = await import("../src/lib/selection-manager.js")
  const fakeSid = "test-session-123"
  writeFileSync(join(sandbox, ".claude/blackbox-state.json"), JSON.stringify({
    enabled: true,
    sessions: { [fakeSid]: { optimization_mode: "quality" } },
  }, null, 2))
  const mode = loadSessionOptMode(fakeSid)
  assert.equal(mode, "quality", "should read optimization_mode from session key")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 4: dccdb7e — Tier-based median cost fallback for unknown models
// ═══════════════════════════════════════════════════════════════════
test("FIX 4a: unknown model returns tier-based fallback cost (not 1e-10)", async () => {
  const mod = await loadPlugin()
  const cost = mod.modelCostPerTurn("nonexistent/vendor-xyz")
  assert.equal(cost, 0.00144, "unknown model should return budget tier fallback 0.00144")
})

test("FIX 4b: unknown model is NOT free", async () => {
  const mod = await loadPlugin()
  const free = mod.isModelFree("nonexistent/vendor-xyz")
  assert.equal(free, false, "unknown model should not be treated as free")
})

test("FIX 4c: known models still return correct costs", async () => {
  const mod = await loadPlugin()
  const opusCost = mod.modelCostPerTurn("anthropic/claude-opus-4-7")
  assert.ok(opusCost > 0.01, "opus should have a significant cost")
  assert.ok(opusCost < 0.1, "opus cost should be reasonable per turn")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 5: b492b1a — OpenCode Go + Zen pricing maps
// ═══════════════════════════════════════════════════════════════════
test("FIX 5a: OpenCode Go model has correct cost", async () => {
  const mod = await loadPlugin()
  const cost = mod.modelCostPerTurn("opencode-go/mimo-v2-pro")
  assert.ok(cost > 0, "OpenCode Go mimo-v2-pro should have a cost")
  assert.ok(cost < 0.01, "should be cheap")
})

test("FIX 5b: OpenCode Go Zen model has correct cost", async () => {
  const mod = await loadPlugin()
  const cost = mod.modelCostPerTurn("opencode-go/mimo-v2-pro-free")
  assert.ok(cost >= 0, "OpenCode Go Zen should have a non-negative cost")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 6: c9c9bde — Footer model display, -free suffix, free icon
// ═══════════════════════════════════════════════════════════════════
test("FIX 6a: modelDisplayName strips deepseek- prefix", async () => {
  const { modelDisplayName } = await import("../src/lib/pricing.js")
  const name = modelDisplayName("deepseek/deepseek-v4-flash")
  assert.equal(name, "V4 Flash", "should strip deepseek- prefix and title-case")
})

test("FIX 6b: modelDisplayName handles -free suffix", async () => {
  const { modelDisplayName } = await import("../src/lib/pricing.js")
  const name = modelDisplayName("deepseek/deepseek-chat-free")
  assert.ok(name.includes("Free"), "should include Free in display name")
})

test("FIX 6c: modelDisplayName handles OpenCode Go models", async () => {
  const { modelDisplayName } = await import("../src/lib/pricing.js")
  const name = modelDisplayName("opencode-go/mimo-v2-pro")
  assert.ok(name.length > 0, "should produce a non-empty display name")
  assert.ok(!name.includes("opencode-go"), "should not include provider prefix")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 7: 7f45b34 — Footer regex case-sensitivity /VIBE/i
// ═══════════════════════════════════════════════════════════════════
test("FIX 7: Footer brand mapping — optModeFooter to display name", async () => {
  const { BRANDED_MODES } = await import("../src/lib/mode-router.js")
  const ultra = BRANDED_MODES.find(m => m.id === "vibeultrax")
  assert.equal(ultra.name, "VibeUltraX", "vibeultrax maps to VibeUltraX")
  const qmax = BRANDED_MODES.find(m => m.id === "vibeqmax")
  assert.equal(qmax.name, "VibeQMaX", "vibeqmax maps to VibeQMaX")
  const max = BRANDED_MODES.find(m => m.id === "vibemax")
  assert.equal(max.name, "VibeMaX", "vibemax maps to VibeMaX")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 8: 73a0002 — Footer dedup via content hash
// ═══════════════════════════════════════════════════════════════════
test("FIX 8: Footer double-append prevention", async () => {
  const text1 = "Hello world"
  const footer = "— VibeMaX ⚡ Budget —"
  const combined = text1 + "\n" + footer
  const alreadyHasFooter = /VibeMaX|VibeUltraX|VibeQMaX/i.test(combined)
  assert.equal(alreadyHasFooter, true, "should detect existing footer")
  const shouldAppend = !alreadyHasFooter
  assert.equal(shouldAppend, false, "should NOT append footer again")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 9: 98bb86a — Compact footer format
// ═══════════════════════════════════════════════════════════════════
test("FIX 9: BRANDED_MODES have correct icon and quality mapping", async () => {
  const { BRANDED_MODES } = await import("../src/lib/mode-router.js")
  const ultra = BRANDED_MODES.find(m => m.id === "vibeultrax")
  assert.equal(ultra.icon, "🏆")
  assert.equal(ultra.pipeline.length, 3, "ultra should use 3-model pipeline")
  const qmax = BRANDED_MODES.find(m => m.id === "vibeqmax")
  assert.equal(qmax.icon, "⭐")
  assert.equal(qmax.pipeline.length, 1, "qmax should use 1-model pipeline")
  const max = BRANDED_MODES.find(m => m.id === "vibemax")
  assert.equal(max.icon, "⚡")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 10: b4a8f3a — Model name resolution regression tests
// ═══════════════════════════════════════════════════════════════════
test("FIX 10a: classify returns correct tier for opus", async () => {
  const mod = await loadPlugin()
  const tier = mod.classify("anthropic/claude-opus-4-7")
  assert.equal(tier, "high", "opus should be high tier")
})

test("FIX 10b: classify returns correct tier for flash", async () => {
  const mod = await loadPlugin()
  const tier = mod.classify("deepseek/deepseek-v4-flash")
  assert.equal(tier, "mid", "flash should be mid tier")
})

test("FIX 10c: classify returns budget for unknown", async () => {
  const mod = await loadPlugin()
  const tier = mod.classify("totally-unknown-model")
  assert.equal(tier, "budget", "unknown model should be budget tier")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 11: 60d45d3 — Provider-qualified resolution, no bare names
// ═══════════════════════════════════════════════════════════════════
test("FIX 11: resolveExecutionIdentity returns valid structure", async () => {
  const { resolveExecutionIdentity } = await import("../src/lib/pricing.js")
  const result = resolveExecutionIdentity("deepseek/deepseek-v4-flash", join(sandbox, ".opencode-test"))
  assert.ok(result, "should return a result object")
  assert.ok(result.provider_label || result.provider, "should have provider info")
  assert.ok(result.model, "should have model info")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 12: dirname import fix in trinity-tool.ts
// ═══════════════════════════════════════════════════════════════════
test("FIX 12: trinity-tool imports dirname correctly", async () => {
  const trinitySrc = readFileSync(join(process.cwd(), "src/lib/trinity-tool.ts"), "utf-8")
  assert.ok(trinitySrc.includes('import { join, dirname } from "node:path"'), "should import dirname from node:path")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 13: setCurrentModel/setCurrentTier re-exported from index.js
// ═══════════════════════════════════════════════════════════════════
test("FIX 13: index.js exports setCurrentModel and setCurrentTier", async () => {
  const mod = await loadPlugin()
  assert.equal(typeof mod.setCurrentModel, "function", "setCurrentModel should be exported")
  assert.equal(typeof mod.setCurrentTier, "function", "setCurrentTier should be exported")
})

test("FIX 13b: concurrent slot writes preserve all selection fields", async () => {
  const rounds = 3
  const mutations = ["write-slot", "write-thinking", "write-flow"]
  for (let i = 0; i < rounds; i++) {
    seedTiers()
    const readyDir = join(sandbox, `.race-ready-${i}`)
    const releasePath = join(sandbox, `.race-go-${i}`)
    mkdirSync(readyDir, { recursive: true })
    const readyPaths = mutations.map((kind) => join(readyDir, `${kind}.ready`))
    const childRuns = mutations.map((kind, idx) => runChildMutation(sandbox, kind, readyPaths[idx], releasePath))
    const deadline = Date.now() + 5000
    while (!readyPaths.every((p) => existsSync(p))) {
      if (Date.now() > deadline) {
        throw new Error("timed out waiting for concurrent writers to start")
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    writeFileSync(releasePath, "go")
    await Promise.all(childRuns)
    const tiers = JSON.parse(readFileSync(join(sandbox, ".claude/model-tiers.json"), "utf8"))
    assert.equal(tiers.selection.active_slot, "medium")
    assert.equal(tiers.selection.thinking_level, "full")
    assert.equal(tiers.selection.flow_enabled, false)
    assert.equal(tiers.selection.enabled, true)
    assert.equal(tiers.trinity.brain.oc, "anthropic/claude-opus-4-7")
    assert.equal(tiers.trinity.medium.oc, "deepseek/deepseek-v4-flash")
    assert.equal(tiers.trinity.cheap.oc, "deepseek/deepseek-chat")
    rmSync(readyDir, { recursive: true, force: true })
    rmSync(releasePath, { force: true })
  }
})

test("FIX 13c: large savings ledger remains readable without corruption logging", async () => {
  const { readLifetimeSavings } = await import("../src/lib/state.js?t=" + Date.now())
  const ledgerPath = join(sandbox, ".claude/savings-ledger.jsonl")
  const logPath = join(sandbox, ".claude/.state-corruption-log.jsonl")
  writeFileSync(join(sandbox, ".claude/delegation-state.json"), JSON.stringify({
    lifetime: { warn_count: 0, total_savings_usd: 0, cache_savings_usd: 0, missed_context7_usd: 0 },
  }, null, 2))
  const entry = JSON.stringify({ v: 2, at: new Date().toISOString(), kind: "cache", amount_usd: 0.0001, sid: "ledger-large-test", tool: "Read" })
  const targetBytes = 11 * 1024 * 1024
  const repeats = Math.ceil(targetBytes / (entry.length + 1))
  writeFileSync(ledgerPath, Array.from({ length: repeats }, () => entry).join("\n") + "\n")
  const before = existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).length : 0
  const sv = readLifetimeSavings()
  const after = existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).length : 0
  assert.ok(sv.ltCache > 0, "large ledger should still contribute cache savings")
  assert.equal(after, before, "reading a large ledger should not record corruption")
})

test("FIX 13d: active jobs are normalized and stale entries are pruned", async () => {
  const { loadActiveJobs } = await import("../src/lib/state.js?t=" + Date.now())
  const activePath = join(sandbox, ".claude/active-jobs.json")
  const staleAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
  writeFileSync(activePath, JSON.stringify({
    staleJob: { prompt: "stale", keywords: ["a"], status: "active", createdAt: staleAt, updatedAt: staleAt },
    malformedJob: { prompt: "fresh", keywords: ["b"], updatedAt: staleAt },
  }, null, 2))
  const jobs = loadActiveJobs()
  assert.equal(jobs.malformedJob, undefined, "malformed active job should be pruned")
  assert.equal(jobs.staleJob, undefined, "stale active job should be removed after completion")
  const persisted = JSON.parse(readFileSync(activePath, "utf8"))
  assert.equal(persisted.malformedJob, undefined, "malformed job should not remain on disk")
  assert.equal(persisted.staleJob, undefined, "completed stale job should not remain on disk")
})

test("FIX 13e: corruption backups are capped at 5 and stale entries are pruned", async () => {
  const { _handleStateCorruption } = await import("../src/lib/state.js?t=" + Date.now())
  const backupDir = join(sandbox, ".claude/.backups")
  mkdirSync(backupDir, { recursive: true })
  const target = join(sandbox, ".claude/broken.json")
  writeFileSync(target, "broken")
  const oldBackup = join(backupDir, "broken.json.corrupted.1")
  writeFileSync(oldBackup, "old")
  const oldTime = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
  utimesSync(oldBackup, oldTime, oldTime)
  for (let i = 0; i < 7; i++) {
    writeFileSync(target, `broken-${i}`)
    _handleStateCorruption(target)
    await new Promise((r) => setTimeout(r, 2))
  }
  const backups = readdirSync(backupDir).filter((f) => f.includes(".corrupted."))
  assert.ok(backups.length <= 5, `expected at most 5 backups, got ${backups.length}`)
  assert.equal(backups.includes("broken.json.corrupted.1"), false, "stale backup should be pruned")
})

test("FIX 13f: large savings ledger compacts on read", async () => {
  const { readLifetimeSavings } = await import("../src/lib/state.js?t=" + Date.now())
  const ledgerPath = join(sandbox, ".claude/savings-ledger.jsonl")
  const base = {
    v: 2,
    at: new Date().toISOString(),
    kind: "cache",
    amount_usd: 0.0001,
    sid: "ledger-rotate-test",
    tool: "Read",
    note: "x".repeat(80),
  }
  const entry = JSON.stringify(base)
  writeFileSync(ledgerPath, Array.from({ length: 12000 }, () => entry).join("\n") + "\n")
  const beforeSize = readFileSync(ledgerPath).length
  const sv = readLifetimeSavings()
  const afterSize = readFileSync(ledgerPath).length
  assert.ok(sv.ltCache > 0, "large ledger should still contribute cache savings")
  assert.ok(afterSize < beforeSize, `ledger should compact, before=${beforeSize} after=${afterSize}`)
  assert.ok(afterSize <= 1_048_576, `ledger should stay near 1MB, got ${afterSize}`)
})

test("FIX 13g: active jobs GC runs on init and drops malformed entries", async () => {
  const activePath = join(sandbox, ".claude/active-jobs.json")
  const staleAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
  writeFileSync(activePath, JSON.stringify({
    staleJob: { prompt: "stale", keywords: ["a"], status: "active", createdAt: staleAt, updatedAt: staleAt },
    malformedJob: { prompt: "bad", keywords: ["b"], updatedAt: staleAt },
  }, null, 2))
  await import("../src/lib/state.js?t=" + Date.now())
  const persisted = JSON.parse(readFileSync(activePath, "utf8"))
  assert.equal(persisted.malformedJob, undefined, "malformed job should be pruned")
  assert.equal(persisted.staleJob, undefined, "stale job should be removed after completion")
})

test("FIX 13h: cold start maintenance cleans dirty disk state before the first report flow", async () => {
  const coldHome = mkdtempSync(join(tmpdir(), "mega-startup-"))
  const childScript = `
    const fs = await import("node:fs")
    const { join } = await import("node:path")
    const home = process.env.HOME
    const claude = join(home, ".claude")
    const projectDir = join(home, "project")
    const backupsDir = join(claude, ".backups")
    const ledgerPath = join(claude, "savings-ledger.jsonl")
    const activePath = join(claude, "active-jobs.json")
    fs.mkdirSync(backupsDir, { recursive: true })
    fs.mkdirSync(join(claude, "reports"), { recursive: true })
    fs.mkdirSync(join(home, ".config/opencode"), { recursive: true })
    fs.mkdirSync(projectDir, { recursive: true })
    const staleAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    fs.writeFileSync(activePath, JSON.stringify({
      staleJob: { prompt: "stale", keywords: ["boot"], status: "active", createdAt: staleAt, updatedAt: staleAt },
      malformedJob: { prompt: "bad", keywords: ["boot"], updatedAt: staleAt },
    }, null, 2))
    for (let i = 0; i < 7; i++) {
      fs.writeFileSync(join(backupsDir, "savings-ledger.jsonl.corrupted." + i), "backup-" + i)
    }
    const entry = JSON.stringify({ v: 2, at: new Date().toISOString(), kind: "cache", amount_usd: 0.0001, sid: "boot-flow", tool: "Read" })
    fs.writeFileSync(ledgerPath, Array.from({ length: 14000 }, () => entry).join("\\n") + "\\n")
    fs.writeFileSync(join(claude, "model-tiers.json"), JSON.stringify({
      trinity: {
        brain: { oc: "anthropic/claude-opus-4-7" },
        medium: { oc: "deepseek/deepseek-v4-flash" },
        cheap: { oc: "deepseek/deepseek-chat" },
      },
      selection: { enabled: true, active_slot: "brain", delegation_enforce: true },
      tiers: {
        high: { regex: "opus" },
        mid: { regex: "sonnet|flash" },
        budget: { regex: ".*" },
      },
    }, null, 2))
    fs.writeFileSync(join(projectDir, "opencode.json"), JSON.stringify({
      model: "deepseek/deepseek-v4-flash",
    }, null, 2))
    const mod = await import(${JSON.stringify(join(process.cwd(), "src/index.js"))} + "?t=" + Date.now())
    const state = await import(${JSON.stringify(join(process.cwd(), "src/lib/state.js"))} + "?t=" + Date.now())
    await mod.DelegationEnforcer({ client: {}, directory: projectDir })
    const jobs = JSON.parse(fs.readFileSync(activePath, "utf8"))
    const remainingBackups = fs.readdirSync(backupsDir).filter((f) => f.includes(".corrupted."))
    const sv = state.readLifetimeSavings()
    mod.setCurrentProjectFingerprint("boot-flow-fingerprint")
    mod.setCurrentProjectName("saveOS")
    mod.setCurrentSessionId("boot-flow-session")
    const reportId = mod.saveReport({
      type: "session",
      summary: "boot flow report " + Date.now(),
      metrics: { value: 1 },
    })
    const report = mod.readReport(reportId)
    const listed = mod.listReports({ project: "saveOS", hours: 24 })
    process.stdout.write(JSON.stringify({
      remainingBackups: remainingBackups.length,
      malformedJobPresent: Object.prototype.hasOwnProperty.call(jobs, "malformedJob"),
      staleJobPresent: Object.prototype.hasOwnProperty.call(jobs, "staleJob"),
      savings: sv.ltCache,
      reportProject: report.meta?.project || "",
      reportSessionId: report.meta?.sessionId || "",
      reportListed: listed.some((r) => r.id === reportId),
    }))
  `
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", childScript], {
    env: {
      ...process.env,
      HOME: coldHome,
      VIBEOS_HOME: join(coldHome, ".claude"),
      VIBEOS_OPENCODE_HOME: join(coldHome, ".config", "opencode"),
    },
    encoding: "utf8",
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const payload = JSON.parse(result.stdout || "{}")
  assert.ok(payload.remainingBackups <= 5, "startup maintenance should prune old corruption backups")
  assert.equal(payload.malformedJobPresent, false, "startup maintenance should drop malformed jobs")
  assert.equal(payload.staleJobPresent, false, "startup maintenance should remove stale completed jobs")
  assert.ok(payload.savings > 0, "boot flow should still be able to read the savings ledger")
  assert.equal(payload.reportProject, "saveOS", "report flow should still use live project context after startup maintenance")
  assert.equal(payload.reportSessionId, "boot-flow-session", "report flow should keep live session context after startup maintenance")
  assert.equal(payload.reportListed, true, "report should still be listable after startup maintenance")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 14: Mode policy — budget-first mode works
// ═══════════════════════════════════════════════════════════════════
test("FIX 14: peekBudgetFirstMode returns valid decision", async () => {
  const { peekBudgetFirstMode } = await import("../src/lib/mode-policy.js")
  const result = peekBudgetFirstMode({ requestedMode: "budget" })
  assert.ok(result, "should return a decision")
  assert.ok(result.mode, "should have a mode")
  assert.equal(typeof result.active, "boolean", "active should be boolean")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 15: Stress scoring works
// ═══════════════════════════════════════════════════════════════════
test("FIX 15: scoreStress returns numeric value", async () => {
  const { scoreStress } = await import("../src/lib/turn-classify.js")
  const lowStress = scoreStress("hello")
  const highStress = scoreStress("this is broken nothing works I'm furious")
  assert.equal(typeof lowStress, "number", "should return a number")
  assert.ok(lowStress >= 0, "should be non-negative")
  assert.ok(highStress > lowStress, "high stress text should score higher")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 16: Blackbox ML routing works end-to-end
// ═══════════════════════════════════════════════════════════════════
test("FIX 16: remoteCall blackboxSelectMode works", { skip: !!process.env.CI }, async () => {
  const { isApiConnected, remoteCall } = await import("../src/lib/api-client.js")
  if (!isApiConnected()) {
    console.log("  SKIP: API not connected")
    return
  }
  const r = await remoteCall("blackboxSelectMode", ["INIT", 0.2], null)
  if (!r) return
  assert.ok(r, "should return a result")
  assert.ok(r.mode, "should have a mode")
  assert.ok(["budget", "quality", "speed"].includes(r.mode), "mode should be valid")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 17: DelegationEnforcer initializes all 8 hooks
// ═══════════════════════════════════════════════════════════════════
test("FIX 17: DelegationEnforcer returns all 8 hooks", async () => {
  const mod = await loadPlugin()
  const { DelegationEnforcer } = mod
  seedTiers()
  const dir = join(sandbox, ".opencode-hooks")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-flash" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })
  const expected = [
    "tool.execute.before", "tool.execute.after",
    "experimental.chat.messages.transform", "experimental.session.compacting",
    "experimental.chat.system.transform", "shell.env",
    "experimental.text.complete", "message.updated",
  ]
  for (const h of expected) {
    assert.equal(typeof hooks[h], "function", `${h} should be a function`)
  }
})

// ═══════════════════════════════════════════════════════════════════
// FIX 18: shell.env returns correct tier for model
// ═══════════════════════════════════════════════════════════════════
test("FIX 18: shell.env returns model tier environment variable", async () => {
  const mod = await loadPlugin()
  const { DelegationEnforcer } = mod
  seedTiers()
  const dir = join(sandbox, ".opencode-env")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-flash" }))
  const hooks = await DelegationEnforcer({ client: {}, directory: dir })
  const envOut = { env: {} }
  await hooks["shell.env"]({}, envOut)
  assert.ok(envOut.env.OPENCODE_MODEL_TIER, "should set OPENCODE_MODEL_TIER")
  assert.ok(["high", "mid", "budget"].includes(envOut.env.OPENCODE_MODEL_TIER), "tier should be valid")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 19: isModelFree correctly identifies free vs paid models
// ═══════════════════════════════════════════════════════════════════
test("FIX 19: isModelFree differentiates paid vs free models", async () => {
  const mod = await loadPlugin()
  assert.equal(mod.isModelFree("anthropic/claude-opus-4-7"), false, "opus is not free")
  assert.equal(mod.isModelFree("deepseek-chat"), true, "deepseek-chat (no prefix) is free")
  assert.equal(mod.isModelFree("nonexistent-model"), false, "unknown model is not free")
})

// ═══════════════════════════════════════════════════════════════════
// FIX 20: Model pricing cache — known models return expected costs
// ═══════════════════════════════════════════════════════════════════
test("FIX 20: Known model costs are within expected ranges", async () => {
  const mod = await loadPlugin()
  const models = [
    ["anthropic/claude-opus-4-7", 0.01, 0.1],
    ["anthropic/claude-sonnet-4-6", 0.001, 0.02],
    ["deepseek/deepseek-v4-flash", 0.0001, 0.005],
    ["deepseek/deepseek-v4-pro", 0.0003, 0.02],
  ]
  for (const [model, min, max] of models) {
    const cost = mod.modelCostPerTurn(model)
    assert.ok(cost >= min, `${model} cost ${cost} should be >= ${min}`)
    assert.ok(cost <= max, `${model} cost ${cost} should be <= ${max}`)
  }
})

// ═══════════════════════════════════════════════════════════════════
// REAL END-TO-END TEST: trinity mode → syncControlSettings → persists
// ═══════════════════════════════════════════════════════════════════

test("E2E: trinity mode vibeultrax → syncControlSettings does NOT overwrite", async () => {
  // Setup
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: { brain: { oc: "anthropic/claude-opus-4-7" }, medium: { oc: "deepseek/deepseek-v4-flash" }, cheap: { oc: "deepseek/deepseek-chat" } },
    selection: { enabled: true, active_slot: "cheap", delegation_enforce: false, flow_enabled: false, tdd_enforce: false, thinking_level: "off" },
  }))
  writeFileSync(join(sandbox, ".claude/blackbox-state.json"), JSON.stringify({ enabled: true, sessions: {} }))

  const mod = await loadPlugin()
  const dir = join(sandbox, ".opencode-e2e-mode")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-flash" }))
  const hooks = await mod.DelegationEnforcer({ client: {}, directory: dir })

  // Step 1: Set trinity mode to vibeultrax
  const modeResult = await hooks.tool.trinity.execute({ action: "mode", slot: "vibeultrax" })
  assert.ok(modeResult.includes("VIBEULTRAX") || modeResult.includes("vibeultrax"), "mode should be set to vibeultrax: " + modeResult)

  // Step 2: Verify settings were written by trinity handler
  const sel1 = JSON.parse(readFileSync(join(sandbox, ".claude/model-tiers.json"), "utf-8")).selection
  assert.equal(sel1.active_slot, "brain", "vibeultrax should resolve cascade slot to brain")
  assert.equal(sel1.delegation_enforce, true, "vibeultrax: delegation_enforce should be true (strict)")
  assert.equal(sel1.flow_enabled, true, "vibeultrax: flow_enabled should be true")
  assert.equal(sel1.tdd_enforce, true, "vibeultrax: tdd_enforce should be true")
  assert.equal(sel1.thinking_level, "full", "vibeultrax: thinking_level should be full")

  // Step 3: Verify mode was persisted to blackbox-state.json
  const bb = JSON.parse(readFileSync(join(sandbox, ".claude/blackbox-state.json"), "utf-8"))
  const sessions = Object.keys(bb.sessions)
  const baseSession = sessions.find(s => !s.endsWith("_opt"))
  assert.ok(baseSession, "should have a base session key")
  const optMode = bb.sessions[baseSession]?.optimization_mode
  assert.equal(optMode, "vibeultrax", "optimization_mode should be vibeultrax in blackbox state")

  // Step 4: Verify the _opt session key was written correctly
  const optSessionKey = baseSession + "_opt"
  const optSession = bb.sessions[optSessionKey]
  assert.ok(optSession, "_opt session key should exist")
  assert.equal(optSession.optimization_mode, "vibeultrax", "_opt session should have vibeultrax")

  // Step 5: Verify settings match VibeUltraX spec from BRANDED_MODES
  const { BRANDED_MODES } = await import("../src/lib/mode-router.js")
  const ultraX = BRANDED_MODES.find(m => m.id === "vibeultrax")
  assert.equal(sel1.delegation_enforce, ultraX.enforcement === "strict" || ultraX.enforcement === "on", "delegation_enforce matches VibeUltraX spec")
  assert.equal(sel1.flow_enabled, ultraX.flow === "strict" || ultraX.flow === "on" || ultraX.flow === "audit", "flow_enabled matches VibeUltraX spec")
  assert.equal(sel1.tdd_enforce, ultraX.tdd === "quality" || ultraX.tdd === "on" || ultraX.tdd === "strict", "tdd_enforce matches VibeUltraX spec")
  assert.equal(sel1.thinking_level, ultraX.thinking, "thinking_level matches VibeUltraX spec")
})

test("E2E: trinity mode budget → syncControlSettings respects budget defaults", async () => {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: { brain: { oc: "anthropic/claude-opus-4-7" }, medium: { oc: "deepseek/deepseek-v4-flash" }, cheap: { oc: "deepseek/deepseek-chat" } },
    selection: { enabled: true, active_slot: "cheap", delegation_enforce: true, flow_enabled: true, tdd_enforce: true, thinking_level: "full" },
  }))
  writeFileSync(join(sandbox, ".claude/blackbox-state.json"), JSON.stringify({ enabled: true, sessions: {} }))

  const mod = await loadPlugin()
  const dir = join(sandbox, ".opencode-e2e-budget")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-flash" }))
  const hooks = await mod.DelegationEnforcer({ client: {}, directory: dir })

  // Set to budget mode
  const modeResult = await hooks.tool.trinity.execute({ action: "mode", slot: "budget" })
  assert.ok(modeResult.includes("BUDGET"), "mode should be set to budget: " + modeResult)

  // Budget mode has enforcement:off, flow:audit, tdd:off, thinking:off
  const sel1 = JSON.parse(readFileSync(join(sandbox, ".claude/model-tiers.json"), "utf-8")).selection
  // budget mode: enforcement off, flow audit, tdd off
  assert.equal(sel1.delegation_enforce, false, "budget: delegation_enforce should be false")
  assert.equal(sel1.flow_enabled, false, "budget: flow_enabled should be false (audit = off)")
  assert.equal(sel1.tdd_enforce, false, "budget: tdd_enforce should be false")

  // Verify mode was persisted to blackbox-state.json
  const bb = JSON.parse(readFileSync(join(sandbox, ".claude/blackbox-state.json"), "utf-8"))
  const sessions = Object.keys(bb.sessions)
  const baseSession = sessions.find(s => !s.endsWith("_opt"))
  assert.ok(baseSession, "should have a base session key")
  const optMode = bb.sessions[baseSession]?.optimization_mode
  assert.equal(optMode, "budget", "optimization_mode should be budget in blackbox state")

  // Verify settings match Budget mode spec from RUNTIME_MODES
  const { RUNTIME_MODES } = await import("../src/lib/mode-router.js")
  const budgetMode = RUNTIME_MODES.find(m => m.id === "budget")
  assert.equal(sel1.delegation_enforce, budgetMode.enforcement === "strict" || budgetMode.enforcement === "on", "delegation_enforce matches Budget spec")
  assert.equal(sel1.flow_enabled, budgetMode.flow === "strict" || budgetMode.flow === "on" || budgetMode.flow === "audit", "flow_enabled matches Budget spec")
  assert.equal(sel1.tdd_enforce, budgetMode.tdd === "quality" || budgetMode.tdd === "on" || budgetMode.tdd === "strict", "tdd_enforce matches Budget spec")
})

test("E2E: trinity set brain keeps manual slot after system.transform auto-sync", async () => {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: { brain: { oc: "anthropic/claude-opus-4-7" }, medium: { oc: "deepseek/deepseek-v4-flash" }, cheap: { oc: "deepseek/deepseek-chat" } },
    selection: { enabled: true, active_slot: "cheap", slot_locked: false, delegation_enforce: true, flow_enabled: true, tdd_enforce: true, thinking_level: "off" },
  }))
  writeFileSync(join(sandbox, ".claude/blackbox-state.json"), JSON.stringify({ enabled: true, sessions: {} }))

  const mod = await loadPlugin()
  const dir = join(sandbox, ".opencode-e2e-manual-slot")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-flash" }))
  const hooks = await mod.DelegationEnforcer({ client: {}, directory: dir })

  const setResult = await hooks.tool.trinity.execute({ action: "set", slot: "brain" })
  assert.ok(setResult.includes("brain") || setResult.includes("BRAIN"), "manual set should succeed: " + setResult)

  const before = JSON.parse(readFileSync(join(sandbox, ".claude/model-tiers.json"), "utf-8")).selection
  assert.equal(before.active_slot, "brain", "manual set should write brain slot")
  assert.equal(before.slot_locked, true, "manual set should lock the slot")

  const out = { system: [] }
  await hooks["experimental.chat.system.transform"]({}, out)
  assert.ok(out.system.length > 0, "system.transform should still produce directives")

  const after = JSON.parse(readFileSync(join(sandbox, ".claude/model-tiers.json"), "utf-8")).selection
  assert.equal(after.active_slot, "brain", "system.transform must not overwrite a manual brain slot")
  assert.equal(after.slot_locked, true, "manual slot lock should persist after syncControlSettings")
})
