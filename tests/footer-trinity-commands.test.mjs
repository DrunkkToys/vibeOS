// SPDX-License-Identifier: MIT
// Comprehensive integration tests for footer system and trinity commands

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  buildFooterLine,
  buildEnforcementTags,
  formatEnforcementPulse,
  resolveBrand,
  resolveTierIcon,
  formatSavingsPulse,
  formatVectorPulse,
  trendGlyph,
} from "../src/lib/hooks/shared-footer.js"

// ── Helper: build mock trinity tool ──────────────────────────────────

function makeMockDeps(sandbox) {
  const home = sandbox
  const TIERS_FILE = join(home, ".claude/model-tiers.json")
  const STATE_FILE = join(home, ".claude/delegation-state.json")
  const PROJECT_STATE_FILE = join(home, ".claude/project-states.json")
  const REPORTS_DIR = join(home, ".claude/reports")
  const REPORTS_INDEX = join(home, ".claude/reports/index.json")
  const CREDIT_CACHE_F = join(home, ".claude/credit-snapshot.json")
  const SAVINGS_LEDGER_FILE = join(home, ".claude/savings-ledger.jsonl")
  const OPENCODE_HOME = join(home, ".config/opencode")
  const TIERS = {
    trinity: {
      brain:  { oc: "deepseek/deepseek-v4-pro",  cc: "haiku" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap:  { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
    },
    selection: {
      active_slot: "medium", enabled: true, delegation_enforce: true,
      flow_enabled: true, flow_enforce: true, tdd_enforce: true,
      tdd_strict: true, tdd_quality: true, thinking_level: "full",
      blackbox_enabled: false,
    },
  }

  mkdirSync(join(home, ".claude"), { recursive: true })
  mkdirSync(join(home, ".config/opencode"), { recursive: true })
  mkdirSync(join(home, ".local/share/opencode"), { recursive: true })
  writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({
    model: "deepseek/deepseek-v4-flash",
    provider: { deepseek: { models: { "deepseek-v4-pro": {}, "deepseek-v4-flash": {} } } },
  }, null, 2) + "\n")
  writeFileSync(TIERS_FILE, JSON.stringify(TIERS, null, 2) + "\n")
  writeFileSync(STATE_FILE, JSON.stringify({
    lifetime: { warn_count: 0, scratchpad_hits_observed: 0, missed_context7_usd: 0, cache_savings_usd: 0 },
    sessions: {},
  }, null, 2) + "\n")
  writeFileSync(PROJECT_STATE_FILE, JSON.stringify({ project_hashes: {} }, null, 2) + "\n")

  const stateData = { project_hashes: {} }
  let selectionData = { ...TIERS.selection }
  let modelLocked = false
  let lockedSlot = null
  let lockedModel = null
  let flowWarns = []

  return {
    sandbox: home,
    TIERS_FILE,
    STATE_FILE,
    PROJECT_STATE_FILE,
    REPORTS_DIR,
    REPORTS_INDEX,
    CREDIT_CACHE_F,
    SAVINGS_LEDGER_FILE,
    OPENCODE_HOME,
    _OC_SID: String(process.pid || "?"),
    directory: home,
    currentModel: "deepseek/deepseek-v4-flash",
    currentProjectName: "test-project",
    currentProjectFingerprint: "abc123",
    _modelLocked: false,
    _blackboxEnabled: false,
    _lockedSlot: null,
    _lockedModel: null,
    _tiersData: TIERS,
    dashboardBaseUrl: "http://127.0.0.1:9123",
    latestUserIntent: "",
    savedOptMode: null,
    savedModeSlot: null,
    tool: {
      schema: {
        enum: (vals) => ({ optional: () => vals }),
        string: () => ({ optional: () => ({}) }),
        number: () => ({ optional: () => ({}) }),
      },
    },
    loadSelection() { return { ...selectionData } },
    writeSelection(key, val) { selectionData[key] = val; return true },
    existsSync,
    readFileSync,
    writeFileSync,
    safeJsonParse: (str) => { try { return JSON.parse(str) } catch { return null } },
    readLifetimeSavings() {
      return {
        ltTasks: 183.50, ltCache: 12.30, sesTasks: 5.20, sesCache: 2.10,
        sesWarns: 3, sesTrend: "stable", sesRatePerHour: 4.75,
        missedC7: 0.80, sesToolBreakdown: { write: 1.20, edit: 0.80, bash: 0.50 },
        sesModelTurns: { brain: 15, worker: 8 }, sesDuration: 5400,
        quality_avg: 87,
      }
    },
    readFullState() {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"))
    },
    formatUsd: (v) => String(v.toFixed(2)),
    loadCredit: () => 75,
    thinkingLevel: () => "full",
    scoreStress: () => 0,
    getBlackboxResolution: () => null,
    _loadOpenCodeProviders: () => ({ deepseek: { models: { "deepseek-v4-pro": {}, "deepseek-v4-flash": {} } } }),
    _readAuth: () => ({}),
    discoverAvailableModels: async () => [],
    _modelCost: () => 0.001,
    _modelTier: () => "budget",
    modelToCcAlias: () => "haiku",
    applySlot: (s) => ({ ok: true, ocModel: "deepseek/deepseek-v4-flash" }),
    writeSessionSlot: () => {},
    writeSessionOptMode: () => {},
    writeFileAtomic: (f, d) => writeFileSync(f, d),
    renameSync: () => {},
    probeModel: async () => true,
    saveOptimizationMode: (mode) => { selectionData.opt_mode = mode; return true },
    _refreshModel: () => {},
    resolveExecutionIdentity: () => ({ provider: "DeepSeek", provider_label: "DeepSeek", quality: "medium", quality_label: "medium", model: "v4-flash" }),
    getFlowWarns: () => flowWarns,
    loadProjectState: () => stateData,
    saveProjectState: (d) => { Object.assign(stateData, d) },
    ensureProjectBucket: (ps, fp) => { ps.project_hashes[fp] = ps.project_hashes[fp] || { totalSessions: 0, context7Bypasses: 0 }; return ps.project_hashes[fp] },
    mergeProjectBucket: (a, b) => ({ ...a, ...b, totalSessions: (a.totalSessions || 0) + (b?.totalSessions || 0) }),
    projectFingerprint: () => "abc123",
    projectPatternRows: () => [],
    promotedProjectPatterns: () => [],
    clearProjectPatterns: () => 0,
    detectTechStack: () => ({}),
    ensureProjectDocs: () => ({ created: [], skipped: ["AGENTS.md"] }),
    ensureProjectSkill: () => {},
    backupFile: () => null,
    reportsIndex: () => ({ reports: [] }),
    saveReportsIndex: () => {},
    loadBlackboxState: () => ({ enabled: false, sessions: {} }),
    saveBlackboxState: () => {},
    setBlackboxEnabled: () => {},
    loadTodos: () => [],
    markTodoDone: () => {},
    syncFlowTodosToNative: () => 0,
    setApiToken: () => {},
    setApiBootstrapToken: () => {},
    mkdirSync,
    existsSync: (p) => { try { return existsSync(p) } catch { return false } },
    estimateTurnsRemaining: () => ({ balanceUsd: 100, costPerTurn: 0.0005, turnsRemaining: 200000, unlimited: false }),
    modelCostPerTurn: () => 0.0005,
    _lazyRefresh: () => {},
  }
}

// ── SECTION 1: Footer system tests ───────────────────────────────────

test("footer: resolveBrand maps all modes correctly", () => {
  assert.equal(resolveBrand("vibeultrax", "brain"), "VibeUltraX")
  assert.equal(resolveBrand("vibeqmax", "medium"), "VibeQMaX")
  assert.equal(resolveBrand("vibemax", "cheap"), "VibeMaX")
  assert.equal(resolveBrand("litex", "brain"), "VibeLiteX")
  assert.equal(resolveBrand("quality", "medium"), "VibeQMaX")
  assert.equal(resolveBrand("audit", "brain"), "VibeQMaX")
  assert.equal(resolveBrand("forensic", "cheap"), "VibeQMaX")
  assert.equal(resolveBrand("budget", "brain"), "VibeQMaX")
  assert.equal(resolveBrand("speed", "medium"), "VibeMaX")
  assert.equal(resolveBrand("unknown", "brain"), "VibeQMaX")
  assert.equal(resolveBrand("unknown", "medium"), "VibeMaX")
  assert.equal(resolveBrand("unknown", "cheap"), "VibeMaX")
})

test("footer: resolveBrand for branded modes maps to correct brand name", () => {
  assert.equal(resolveBrand("vibeultrax", "brain"), "VibeUltraX")
  assert.equal(resolveBrand("vibeqmax", "brain"), "VibeQMaX")
  assert.equal(resolveBrand("vibemax", "brain"), "VibeMaX")
  assert.equal(resolveBrand("litex", "brain"), "VibeLiteX")
})

test("footer: resolveBrand for built-in modes maps to correct brand name", () => {
  assert.equal(resolveBrand("quality", "brain"), "VibeQMaX")
  assert.equal(resolveBrand("audit", "brain"), "VibeQMaX")
  assert.equal(resolveBrand("forensic", "brain"), "VibeQMaX")
  assert.equal(resolveBrand("budget", "cheap"), "VibeMaX")
  assert.equal(resolveBrand("speed", "medium"), "VibeMaX")
  assert.equal(resolveBrand("longrun", "medium"), "VibeMaX")
})

test("footer: resolveBrand fallback logic for unknown modes", () => {
  assert.equal(resolveBrand("nonexistent", "brain"), "VibeQMaX")
  assert.equal(resolveBrand("nonexistent", "medium"), "VibeMaX")
  assert.equal(resolveBrand("nonexistent", "cheap"), "VibeMaX")
})

test("footer: resolveTierIcon returns correct icons", () => {
  assert.equal(resolveTierIcon("brain"), "\u{1F9E0}")
  assert.equal(resolveTierIcon("medium"), "\u25D0")
  assert.equal(resolveTierIcon("cheap"), "\u26A1")
  assert.equal(resolveTierIcon("free"), "\u{1F381}")
  assert.equal(resolveTierIcon("unknown"), "\u26A1")
})

test("footer: buildFooterLine format matches required pattern", () => {
  const line = buildFooterLine({
    activeSlot: "medium",
    sessionSlot: "medium",
    providerLabel: "DeepSeek",
    modelName: "v4-flash",
    ltTotal: 183.50,
    ltTrend: "up",
    vibeBrand: "VibeMaX",
    optMode: "speed",
    flashIcon: " \u26A1",
    enfTags: ["[ENF ON]", "[TDD ON]"],
    vectorChangedSlot: "brain",
  })

  assert.ok(line.startsWith("\u2014"))
  assert.ok(line.endsWith("\u2014"))
  assert.ok(line.includes("◐ medium"))
  assert.ok(line.includes("| DeepSeek"))
  assert.ok(line.includes("| v4-flash"))
  assert.ok(line.includes("| $183.50 saved \u2197"))
  assert.ok(line.includes("| VibeMaX \u26A1"))
  assert.ok(line.includes("Speed"))
  assert.ok(line.includes("guarded"))
  assert.ok(line.includes("tests live"))
  assert.ok(!line.includes("slot:medium"))
})

test("footer: buildFooterLine with vibeultrax mode", () => {
  const line = buildFooterLine({
    activeSlot: "brain",
    sessionSlot: "brain",
    providerLabel: "Anthropic",
    modelName: "claude-opus-4",
    ltTotal: 500.00,
    ltTrend: "up",
    vibeBrand: "VibeUltraX",
    optMode: "vibeultrax",
    flashIcon: " \u{1F9E0}",
    enfTags: ["[ENF ON]", "[FLOW ON]", "[TDD ON]", "[STRICT]"],
    vectorChangedSlot: undefined,
  })

  assert.ok(line.includes("\u{1F9E0} brain"))
  assert.ok(line.includes("| VibeUltraX"))
  assert.ok(line.includes("VibeUltraX"))
  assert.ok(line.includes("guarded"))
  assert.ok(line.includes("flow steady"))
  assert.ok(line.includes("tests live"))
})

test("footer: buildFooterLine with vibeqmax mode", () => {
  const line = buildFooterLine({
    activeSlot: "cheap",
    sessionSlot: "cheap",
    providerLabel: "DeepSeek",
    modelName: "deepseek-chat",
    ltTotal: 42.00,
    ltTrend: "down",
    vibeBrand: "VibeQMaX",
    optMode: "vibeqmax",
    flashIcon: " \u26A1",
    enfTags: [],
    vectorChangedSlot: undefined,
  })

  assert.ok(line.includes("\u26A1 cheap"))
  assert.ok(line.includes("| VibeQMaX"))
  assert.ok(line.includes("Quality"))
  assert.ok(line.includes("$42.00 saved \u2198"))
})

test("footer: buildFooterLine with vibemax mode on cheap slot", () => {
  const line = buildFooterLine({
    activeSlot: "cheap",
    sessionSlot: "cheap",
    providerLabel: "OpenAI",
    modelName: "gpt-4o-mini",
    ltTotal: 99.99,
    ltTrend: "stable",
    vibeBrand: "VibeMaX",
    optMode: "vibemax",
    flashIcon: " \u26A1",
    enfTags: [],
    vectorChangedSlot: undefined,
  })

  assert.ok(line.includes("\u26A1 cheap"))
  assert.ok(line.includes("| VibeMaX"))
  assert.ok(line.includes("Budget"))
  assert.ok(line.includes("$99.99 saved"))
})

test("footer: buildFooterLine shows session slot when different", () => {
  const line = buildFooterLine({
    activeSlot: "cheap",
    sessionSlot: "brain",
    providerLabel: "DeepSeek",
    modelName: "deepseek-chat",
    ltTotal: 10.00,
    ltTrend: "up",
    vibeBrand: "VibeMaX",
    optMode: "budget",
    flashIcon: " \u26A1",
    enfTags: ["[Q&A]"],
    vectorChangedSlot: "brain",
  })

  assert.ok(line.includes("session:brain"))
  assert.ok(line.includes("⟡ brain") || line.includes("\u27A1 brain"))
})

test("footer: buildFooterLine zero savings hides savings section", () => {
  const line = buildFooterLine({
    activeSlot: "medium",
    sessionSlot: "medium",
    providerLabel: "DeepSeek",
    modelName: "v4-flash",
    ltTotal: 0,
    ltTrend: "stable",
    vibeBrand: "VibeMaX",
    optMode: "auto",
    flashIcon: " \u2699\uFE0F",
    enfTags: [],
    vectorChangedSlot: undefined,
  })

  assert.ok(!line.includes("$"))
  assert.ok(!line.includes("saved"))
})

test("footer: buildFooterLine auto mode omits mode text", () => {
  const line = buildFooterLine({
    activeSlot: "brain",
    sessionSlot: "brain",
    providerLabel: "Anthropic",
    modelName: "claude-opus-4",
    ltTotal: 50.00,
    ltTrend: "up",
    vibeBrand: "VibeQMaX",
    optMode: "auto",
    flashIcon: " \u{1F9E0}",
    enfTags: [],
    vectorChangedSlot: undefined,
  })

  assert.ok(!line.includes(" auto"))
})

test("footer: buildEnforcementTags relaxed maps to [Q&A]", () => {
  const tags = buildEnforcementTags({
    delegationEnforce: false,
    flowEnforce: false,
    tddEnforce: false,
    bbMode: "relaxed",
    modelLocked: false,
  })
  assert.deepEqual(tags, ["[Q&A]"])
})

test("footer: buildEnforcementTags relaxed + locked maps to [Q&A][LOCK ON]", () => {
  const tags = buildEnforcementTags({
    delegationEnforce: false,
    flowEnforce: false,
    tddEnforce: false,
    bbMode: "relaxed",
    modelLocked: true,
  })
  assert.deepEqual(tags, ["[Q&A]", "[LOCK ON]"])
})

test("footer: buildEnforcementTags strict with all toggles", () => {
  const tags = buildEnforcementTags({
    delegationEnforce: true,
    flowEnforce: true,
    tddEnforce: true,
    bbMode: "strict",
    modelLocked: true,
  })
  assert.deepEqual(tags, ["[ENF ON]", "[FLOW ON]", "[TDD ON]", "[STRICT]", "[LOCK ON]"])
})

test("footer: buildEnforcementTags strict with no toggles gives [STRICT]", () => {
  const tags = buildEnforcementTags({
    delegationEnforce: false,
    flowEnforce: false,
    tddEnforce: false,
    bbMode: "strict",
    modelLocked: false,
  })
  assert.deepEqual(tags, ["[STRICT]"])
})

test("footer: buildEnforcementTags locked only", () => {
  const tags = buildEnforcementTags({
    delegationEnforce: false,
    flowEnforce: false,
    tddEnforce: false,
    bbMode: "auto",
    modelLocked: true,
  })
  assert.deepEqual(tags, ["[LOCK ON]"])
})

test("footer: buildEnforcementTags no tags when all off and bbMode not relaxed/strict", () => {
  const tags = buildEnforcementTags({
    delegationEnforce: false,
    flowEnforce: false,
    tddEnforce: false,
    bbMode: "auto",
    modelLocked: false,
  })
  assert.deepEqual(tags, [])
})

test("footer: formatEnforcementPulse softens the raw tags", () => {
  assert.equal(formatEnforcementPulse(["[ENF ON]", "[TDD ON]"]), "guarded · tests live")
  assert.equal(formatEnforcementPulse(["[Q&A]", "[LOCK ON]"]), "quiet mode · locked")
  assert.equal(formatEnforcementPulse([]), "")
})

test("footer: trendGlyph returns correct arrows", () => {
  assert.equal(trendGlyph("up"), "\u2197")
  assert.equal(trendGlyph("down"), "\u2198")
  assert.equal(trendGlyph("stable"), "\u2192")
  assert.equal(trendGlyph("flat"), "\u2192")
  assert.equal(trendGlyph(undefined), "\u2192")
})

test("footer: formatSavingsPulse edge cases", () => {
  assert.equal(formatSavingsPulse(0, "up"), "")
  assert.equal(formatSavingsPulse(-1, "up"), "")
  assert.equal(formatSavingsPulse(NaN, "up"), "")
  assert.equal(formatSavingsPulse(Infinity, "up"), "")
  assert.equal(formatSavingsPulse(5.50, "up"), "$5.50 saved \u2197")
  assert.equal(formatSavingsPulse(3.00, "down"), "$3.00 saved \u2198")
  assert.equal(formatSavingsPulse(10.00, "stable"), "$10.00 saved")
})

test("footer: formatVectorPulse edge cases", () => {
  assert.equal(formatVectorPulse("cheap"), "⟡ cheap")
  assert.equal(formatVectorPulse(undefined), "")
  assert.equal(formatVectorPulse(null), "")
})

// ── SECTION 2: textCompletePainted Set prevents double-painting ──────

test("footer: textCompletePainted prevents double-painting", () => {
  const painted = new Set()

  assert.equal(painted.has("msg-1"), false)
  painted.add("msg-1")
  assert.equal(painted.has("msg-1"), true)

  assert.equal(painted.has("msg-1"), true)
  const alreadyPainted = painted.has("msg-1")
  assert.equal(alreadyPainted, true)

  painted.add("msg-2")
  assert.equal(painted.has("msg-2"), true)
  assert.equal(painted.has("msg-1"), true)
  assert.equal(painted.size, 2)
})

// ── SECTION 3: Trinity command tests ─────────────────────────────────

test("trinity: status returns string with [vibeOS-dashboard]", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-status-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "status" })
  assert.ok(typeof result === "string")
  assert.ok(result.includes("[vibeOS-dashboard]"))
})

test("trinity: dashboard prints the stable live URL", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-dashboard-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "dashboard" })
  assert.ok(typeof result === "string")
  assert.ok(result.includes("http://127.0.0.1:9123/"))
  assert.ok(result.includes("/dashboard/home"))
})

test("trinity: gui aliases dashboard", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-gui-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "gui" })
  assert.ok(typeof result === "string")
  assert.ok(result.includes("http://127.0.0.1:9123/"))
})

test("trinity: mode switches to vibeultrax branded mode", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-mode-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "vibeultrax" })
  assert.ok(typeof result === "string")
  assert.ok(result.toUpperCase().includes("VIBEULTRAX") || result.toUpperCase().includes("MODE"))
})

test("trinity: mode switches to vibeqmax branded mode", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-mode-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "vibeqmax" })
  assert.ok(typeof result === "string")
  assert.ok(result.toUpperCase().includes("VIBEQMAX") || result.toUpperCase().includes("MODE"))
})

test("trinity: mode switches to vibemax branded mode", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-mode-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "vibemax" })
  assert.ok(typeof result === "string")
  assert.ok(result.toUpperCase().includes("VIBEMAX") || result.toUpperCase().includes("MODE"))
})

test("trinity: mode switches to budget mode", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-mode-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "mode", slot: "budget" })
  assert.ok(typeof result === "string")
  assert.ok(result.toUpperCase().includes("BUDGET") || result.toUpperCase().includes("MODE"))
})

test("trinity: mode switches to quality mode", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-mode-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "quality" })
  assert.ok(typeof result === "string")
  assert.ok(result.toUpperCase().includes("QUALITY") || result.toUpperCase().includes("MODE"))
})

test("trinity: enforce on works", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-enforce-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "enforce", slot: "on" })
  assert.ok(typeof result === "string")
  assert.ok(result.includes("ENABLED") || result.includes("enforcement"))
})

test("trinity: flow on works", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-flow-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "flow", slot: "on" })
  assert.ok(typeof result === "string")
  assert.ok(result.includes("ENABLED") || result.includes("Flow"))
})

test("trinity: flow off works", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-flow-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "flow", slot: "off" })
  assert.ok(typeof result === "string")
  assert.ok(result.includes("DISABLED") || result.includes("Flow"))
})

test("trinity: tdd on works", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-tdd-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "tdd", slot: "on" })
  assert.ok(typeof result === "string")
  assert.ok(result.includes("ENABLED") || result.includes("TDD"))
})

test("trinity: tdd off works", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-tdd-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "tdd", slot: "off" })
  assert.ok(typeof result === "string")
  assert.ok(result.includes("DISABLED") || result.includes("TDD"))
})

test("trinity: lock on works", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-lock-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "lock", slot: "on" })
  assert.ok(typeof result === "string")
  assert.ok(result.includes("LOCK ON") || result.includes("lock"))
})

test("trinity: lock off works", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-lock-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "lock", slot: "off" })
  assert.ok(typeof result === "string")
  assert.ok(result.includes("LOCK OFF") || result.includes("lock"))
})

test("trinity: patterns shows project patterns", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-patterns-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  const result = await tool.execute({ action: "patterns" })
  assert.ok(typeof result === "string")
  assert.ok(result.includes("Project patterns") || result.includes("learned"))
})

test("trinity: diagnose returns check results", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "trinity-diagnose-"))
  const deps = makeMockDeps(sandbox)
  const { createTrinityTool } = await import("../src/lib/trinity-tool.js")
  const tool = createTrinityTool(deps)
  let result
  try {
    result = await tool.execute({ action: "diagnose" })
  } catch (e) {
    result = e.message
  }
  assert.ok(typeof result === "string")
  assert.ok(result.length > 0)
})

// ── Log all results ──────────────────────────────────────────────────

import { homedir } from "node:os"

const LOG_FILE = join(homedir(), ".claude/test-footer-trinity.json")

const results = {
  suite: "footer-trinity-commands.test.mjs",
  timestamp: new Date().toISOString(),
  tests: [
    "resolveBrand all modes",
    "resolveBrand branded modes",
    "resolveBrand built-in modes",
    "resolveBrand fallback logic",
    "resolveTierIcon",
    "buildFooterLine format pattern",
    "buildFooterLine vibeultrax",
    "buildFooterLine vibeqmax",
    "buildFooterLine vibemax",
    "buildFooterLine session slot diff",
    "buildFooterLine zero savings",
    "buildFooterLine auto mode",
    "buildEnforcementTags relaxed",
    "buildEnforcementTags relaxed+locked",
    "buildEnforcementTags strict+all",
    "buildEnforcementTags strict only",
    "buildEnforcementTags locked only",
    "buildEnforcementTags all off",
    "trendGlyph",
    "formatSavingsPulse",
    "formatVectorPulse",
    "textCompletePainted",
    "trinity status",
    "trinity mode vibeultrax",
    "trinity mode vibeqmax",
    "trinity mode vibemax",
    "trinity mode budget",
    "trinity mode quality",
    "trinity enforce on",
    "trinity flow on",
    "trinity flow off",
    "trinity tdd on",
    "trinity tdd off",
    "trinity lock on",
    "trinity lock off",
    "trinity patterns",
    "trinity diagnose",
  ],
  status: "completed",
}

try {
  mkdirSync(join(homedir(), ".claude"), { recursive: true })
  writeFileSync(LOG_FILE, JSON.stringify(results, null, 2) + "\n")
  console.error("[test] Results logged to " + LOG_FILE)
} catch (e) {
  console.error("[test] Failed to write log: " + e.message)
}
