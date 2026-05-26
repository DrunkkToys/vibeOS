// @ts-nocheck
/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
 *
 * vibeOS — OpenCode plugin: cost-aware delegation enforcer, trinity tier
 * control, live savings footer, TDD enforcer, flow enforcer, project guard,
 * research audit, reporting, decision engine, context7 optimization, and more.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, readdirSync, openSync, readSync, closeSync, rmSync, copyFileSync, renameSync } from "node:fs"
import { join, dirname, relative, basename } from "node:path"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { checkFlowRules, getFlowWarns, ensureProjectDocs, getFlowTodos, syncFlowTodosToNative } from "./vibeOS-lib/flow-enforcer.js"
import { computeSessionMetrics } from "./vibeOS-lib/session-metrics.js"
import { createMcpServer } from "./lib/vibeos-mcp-server.js"

import { getApiClient, remoteCall, isApiFallback, isApiConnected, setApiToken, setApiBootstrapToken, ensureBootstrapExchange, VIBEOS_API_URL } from "./lib/api-client.js"
import {
  applySlot, modelCostPerTurn, isModelFree, isDocsTarget, detectContext7, modelToSlotLabel,
  shortModelName, roundUsd, formatUsd, classify, _refreshModel, loadTierRegexes,
  HIGH_TIER_RE, MID_TIER_RE, PLACEHOLDER_RE, readConfig,
  getTrinitySlotOrder,
  loadTrinitySlotsFromTiersFile,
  TRINITY_BRAIN, TRINITY_MEDIUM, TRINITY_CHEAP,
  setTrinityBrain, setTrinityMedium, setTrinityCheap,
} from "./lib/pricing.js"
import {
  scoreStress, classifyTurnSimple, extractFirstWordFromArgs, shouldLogWarn,
  resolveEnforcementMode, getLearnedExploratoryWords, extractLastUserText,
  isLikelyOffTopic, detectTechStack, loadBlackboxState, saveBlackboxState,
  getBlackboxTracker, getBlackboxResolution, detectOutcomeSignal,
  fetchBlackboxEnrichment, loadGlobalLearning, updateGlobalLearning,
  saveOptimizationMode,
} from "./lib/turn-classify.js"
import {
  safeJsonParse, readFullState, updateState, loadSelection, writeSelection,
  readLifetimeSavings, _OC_SID, _modelLocked, _blackboxEnabled, setBlackboxEnabled,
  _lockedSlot, _lockedModel,
  currentTier, currentModel, currentProjectFingerprint, currentProjectName,
  setCurrentTier, setCurrentModel, setCurrentProjectFingerprint, setCurrentProjectName, setCurrentSessionId,
  textCompletePainted, softQuotaCounts, enforcementBlocked, taskSlotRestore,
  pendingUiNote, briefedProjects, scratchpadHitsSeen, context7AlertedThisSession,
  _latestBlackboxState, _latestBlackboxLoopMsg, _latestBlackboxPivotMsg,
  getScratchpadHit, recordScratchpadObservation, getSessionScratchpadDir,
  ensureSessionScratchpadDirs, getSessionIndexPath, indexAppend,
  getActiveJobForProject, projectFingerprint, loadProjectState, saveProjectState,
  ensureProjectBucket, mergeProjectBucket, saveMLState,
  setVibeOSHomeContext,
  SAVINGS_LEDGER_FILE, CONTEXT7_INSTALL_FLAG, SOFT_QUOTA_LIMIT, SCRATCHPAD_TOOLS,
  TRINITY_OPENCODE_CONFIG, TRINITY_OPENCODE_CONFIGC, TIERS_FILE,
  USER_HOME, FILE_LOCK_DIR, STATE_FILE, DELEGATION_STATE_FILE, PROJECT_STATE_FILE,
  BLACKBOX_STATE_FILE, REPORTS_DIR, ML_ENABLED, _mlGraph, _cacheDb,
  ML_CONFIDENCE_THRESHOLD, _mlSavePending, AUTH_F, CREDIT_CACHE_F,
  recordCacheSaving, recordMissedContext7, SCRATCHPAD_GLOBAL_DIR,
  pruneScratchpadOnce, cleanupCurrentSessionScratchpad,
  registerSessionCleanupHandlers, promotedProjectPatterns, projectPatternRows,
  clearProjectPatterns, loadTodos, getTodos, upsertTodo, markTodoDone, _handleStateCorruption, _zType, tool,
  VIBEOS_HOME, OPENCODE_HOME,
} from "./lib/state.js"
import { MONITOR } from "./lib/constants.js"
import { extractExports, buildTestSkeleton, enforceTestFile, buildTestReminder } from "./lib/tdd-enforcer.js"
import { setActiveJobFromTaskPrompt, observeToolPattern, applyDecadence, compressText, recordSaving } from "./lib/index-helpers.js"
import { researchAudit } from "./lib/research-audit.js"
import {
  buildStatusPayload,
  buildSavingsPayload,
  buildSessionCheckout,
  diagnoseStructuredFromText,
  projectStructuredFromText,
} from "./lib/runtime-surface.js"
import { saveReport, listReports, readReport, reportsIndex, saveReportsIndex, REPORTS_INDEX } from "./lib/reporting.js"
import { writeSessionSlot } from "./lib/selection-manager.js"
import { _refreshModel } from "./lib/pricing.js"
import { loadCredit, thinkingLevel, _lazyRefresh, _readAuth } from "./lib/credit-api.js"
import { createTrinityTool } from "./lib/trinity-tool.js"
import { classifyAndRankModels, modelToCcAlias, discoverAvailableModels, probeModel, collectConfiguredProviderModels } from "./lib/trinity-rebuild.js"
import { _appendFooter } from "./lib/hooks/footer.js"
import { onToolExecuteBefore, onToolExecuteAfter, setToolDirectory } from "./lib/hooks/tool-execute.js"

const DEBUG_INTERNALS = process.env.VIBEOS_DEBUG_INTERNALS === "1"
import { onMessagesTransform, onSystemTransform, latestUserIntent, ensureProjectSkill } from "./lib/hooks/chat-transform.js"
import { onSessionCompacting } from "./lib/hooks/session-compact.js"
import { onShellEnv, setShellDirectory } from "./lib/hooks/shell-env.js"

function getVibeOSHome() {
  return process.env.VIBEOS_HOME || join(process.env.HOME || "", ".claude")
}

function getOpenCodeHome() {
  return process.env.VIBEOS_OPENCODE_HOME || join(process.env.HOME || "", ".config", "opencode")
}

function getTiersFile() {
  return join(getVibeOSHome(), "model-tiers.json")
}

function getReportsDir() {
  return join(getVibeOSHome(), "reports")
}

function getReportsIndex() {
  return join(getReportsDir(), "index.json")
}

function getStateFile() {
  return join(getVibeOSHome(), "delegation-state.json")
}

function ensureDeferredBootstrap() {
  if (_deferredBootstrapDone || _modelLocked) return
  _deferredBootstrapDone = true
  try { _runDeferredStartupBootstrap?.() } catch {}
}

// ── Remote API client state ──────────────────────────────────────────
let _apiClient: any = null
let _apiFallbackMode = false
let _apiFallbackSince: number | null = null

let activeJob: any = null
let fp = ""
let _mcpServerRuntime: any = null
let _mcpServerHooked = false
let _mcpServerStartupPromise: Promise<void> | null = null
let context7Seen = new Set()
let _prevOutputText = ""
let _deferredBootstrapDone = false
let _runDeferredStartupBootstrap: null | (() => void) = null

const SAVE_EST = {
  WRITE_EDIT:   0.005,
  SOFT_QUOTA:   0.0003,
  CONTEXT7:     0.002,
  OPUS_DISABLE: 0.03,
}

function _readOpenCodeConfigObject(dir: string): any {
  const jsonPath = join(dir, "opencode.json")
  const jsoncPath = join(dir, "opencode.jsonc")
  if (existsSync(jsonPath)) return safeJsonParse(readFileSync(jsonPath, "utf-8"))
  if (existsSync(jsoncPath)) return _parseJsonc(readFileSync(jsoncPath, "utf-8"))
  return {}
}

function _loadOpenCodeProviders(directory?: string): any {
  try {
    const merged: any = {}
    const dirs = [directory ? join(directory, ".") : null, getOpenCodeHome()].filter(Boolean)
    for (const dir of dirs) {
      const cfg = _readOpenCodeConfigObject(String(dir))
      const providers = cfg?.provider || {}
      for (const [providerName, providerCfg] of Object.entries(providers)) {
        if (!merged[providerName]) merged[providerName] = {}
        merged[providerName] = {
          ...merged[providerName],
          ...providerCfg,
          models: {
            ...(merged[providerName]?.models || {}),
            ...(providerCfg?.models || {}),
          },
        }
      }
    }
    return merged
  } catch { return {} }
}

async function _resolveBootstrapModel(client: any, directory?: string): Promise<{ model: string; source: string }> {
  const normalize = (value: any) => {
    const model = String(value || "").trim()
    return model && !PLACEHOLDER_RE.test(model) ? model : ""
  }

  const projectModel = normalize(readConfig(directory))
  if (projectModel) return { model: projectModel, source: "project-config" }

  const home = process.env.HOME || ""
  if (home) {
    const globalModel = normalize(readConfig(join(home, ".config/opencode")))
    if (globalModel) return { model: globalModel, source: "global-config" }
  }

  const envModel = normalize(process?.env?.OPENCODE_MODEL || "")
  if (envModel) return { model: envModel, source: "env" }

  return { model: "", source: "" }
}

function _loadActiveJobForProject(directory?: string, fp: string = ""): any {
  const candidates = [getVibeOSHome(), directory ? join(directory, "..") : ""].filter(Boolean)
  for (const base of candidates) {
    try {
      const activeJobsPath = join(String(base), ".claude", "active-jobs.json")
      if (!existsSync(activeJobsPath)) continue
      const jobs = safeJsonParse(readFileSync(activeJobsPath, "utf-8")) || {}
      const job = fp ? jobs?.[fp] : null
      if (job && typeof job === "object") return job
    } catch {}
  }
  return getActiveJobForProject(fp)
}

async function _seedModelTiersIfMissing(directory?: string): Promise<boolean> {
  const TIERS_FILE = getTiersFile()
  if (existsSync(TIERS_FILE)) return false

  const providers = _loadOpenCodeProviders(directory)
  const auth = typeof _readAuth === "function" ? _readAuth() : {}
  let discovered: any[] = []
  try {
    discovered = await discoverAvailableModels(providers, auth)
  } catch {}

  let ranked: any = null
  try {
    ranked = classifyAndRankModels(discovered)
  } catch {}

  const fallbackModel = currentModel || readConfig(directory) || readConfig(getOpenCodeHome()) || process?.env?.OPENCODE_MODEL || ""
  const brain = ranked?.brain?.id || fallbackModel
  const medium = ranked?.medium?.id || brain
  const cheap = ranked?.cheap?.id || medium || brain

  if (!brain) return false

  const tiers = {
    selection: {
      enabled: true,
      active_slot: "brain",
      thinking_level: "off",
      flow_enabled: false,
      flow_enforce: false,
      tdd_enforce: false,
      tdd_strict: false,
      tdd_quality: false,
      delegation_enforce: true,
      onboarding_mode: "assist",
      setup_completed_at: new Date().toISOString(),
    },
    trinity: {
      brain: { oc: brain, cc: modelToCcAlias(brain) },
      medium: { oc: medium, cc: modelToCcAlias(medium) },
      cheap: { oc: cheap, cc: modelToCcAlias(cheap) },
    },
  }

  mkdirSync(dirname(TIERS_FILE), { recursive: true })
  writeFileSync(TIERS_FILE, JSON.stringify(tiers, null, 2) + "\n", "utf-8")
  return true
}

function _parseJsonc(raw: string): any {
  const noBlock = String(raw || "").replace(/\/\*[\s\S]*?\*\//g, "")
  const noLine = noBlock.replace(/(^|\s)\/\/.*$/gm, "$1")
  const noTrailing = noLine.replace(/,\s*([}\]])/g, "$1")
  return safeJsonParse(noTrailing)
}

function _modelCost(id: string): number {
  if (!id) return 0
  const c = modelCostPerTurn(id)
  if (c != null) return c
  const stripped = String(id).includes("/") ? String(id).split("/").slice(1).join("/") : String(id)
  return modelCostPerTurn(stripped) ?? 0
}

function _modelTier(id: string): string {
  if (!id) return "budget"
  const high = HIGH_TIER_RE?.test?.(id)
  if (high) return "high"
  const mid = MID_TIER_RE?.test?.(id)
  return mid ? "mid" : "budget"
}

function backupFile(path: string, label: string): string | null {
  try {
    if (!existsSync(path)) return null
    const bkDir = join(getVibeOSHome(), ".backups")
    mkdirSync(bkDir, { recursive: true })
    const bk = join(bkDir, `${basename(path)}.${label}.${Date.now()}.bak`)
    copyFileSync(path, bk)
    return bk
  } catch { return null }
}

function readPackageVersion(): string {
  try {
    const pkg = safeJsonParse(readFileSync(join(process.cwd(), "package.json"), "utf-8"))
    return String(pkg?.version || "")
  } catch { return "" }
}

function loadMcpPort(): number {
  const envPort = process.env.VIBEOS_MCP_PORT
  if (envPort != null && envPort !== "") {
    const n = Number(envPort)
    if (!Number.isFinite(n)) return 0
    return n
  }
  try {
    if (existsSync(getTiersFile())) {
      const tiers = safeJsonParse(readFileSync(getTiersFile(), "utf-8"))
      const cfg = tiers?.selection?.mcp_port
      if (cfg === false || cfg === "disabled" || cfg === 0) return 0
      const n = Number(cfg)
      if (Number.isFinite(n)) return n
    }
  } catch {}
  return 0
}

function persistMcpPort(port: number): void {
  try {
    if (!existsSync(getTiersFile())) return
    const tiers = safeJsonParse(readFileSync(getTiersFile(), "utf-8"))
    tiers.selection ??= {}
    if (Number(tiers.selection.mcp_port) === Number(port) && !("mcp_port" in tiers)) return
    tiers.selection.mcp_port = port
    if ("mcp_port" in tiers) delete (tiers as any).mcp_port
    mkdirSync(dirname(getTiersFile()), { recursive: true })
    const tmp = getTiersFile() + ".tmp." + Date.now()
    writeFileSync(tmp, JSON.stringify(tiers, null, 2) + "\n", "utf-8")
    renameSync(tmp, getTiersFile())
  } catch {}
}

// ── DelegationEnforcer — main plugin entry point ─────────────────────

export async function DelegationEnforcer({ client, directory }: { client?: unknown; directory?: string } = {}) {
  if (DEBUG_INTERNALS) console.error(`[vibeOS] LOADED cwd=${directory}`)
  const hookHome = process.env.HOME || USER_HOME
  const hookFp = projectFingerprint(directory || "")
  const hookSessionId = `opencode-${process.pid || "x"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  setVibeOSHomeContext(join(hookHome, ".claude"))
  setCurrentSessionId(hookSessionId)
  if (hookFp) {
    setCurrentProjectFingerprint(hookFp)
    setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
  }
  if (typeof setToolDirectory === "function") setToolDirectory(directory || "")
  if (typeof setShellDirectory === "function") setShellDirectory(directory || "")
  registerSessionCleanupHandlers()
  pruneScratchpadOnce()

  // Detect model: project opencode.json → OpenCode API → global ~/.config/opencode/opencode.json → env.
  const _bootstrapModel = await _resolveBootstrapModel(client, directory)
  if (_bootstrapModel.model) {
    setCurrentModel(_bootstrapModel.model)
    setCurrentTier(classify(_bootstrapModel.model))
  }
  if (currentModel) {
    setCurrentTier(classify(currentModel))
    try {
      const _tiersData = safeJsonParse(readFileSync(getTiersFile(), "utf-8"))
      const _slotOrder = getTrinitySlotOrder(_tiersData)
      const _primarySlot = _slotOrder[0] || "brain"
      const _activeSlot = _tiersData?.selection?.active_slot || _primarySlot
      if (_activeSlot === _primarySlot) {
        const _brainOcModel = _tiersData?.trinity?.[_primarySlot]?.oc || ""
        if (_brainOcModel && currentModel === _brainOcModel && !PLACEHOLDER_RE.test(_brainOcModel)) {
          const cost = modelCostPerTurn(_brainOcModel)
          if (HIGH_TIER_RE.test(_brainOcModel) || (cost !== null && cost >= 0.01)) {
            setCurrentTier("high")
            if (DEBUG_INTERNALS) console.error(`[vibeOS] tier override → high (primary slot)`)
          }
        }
      }
    } catch {}
    if (DEBUG_INTERNALS) console.error(`[vibeOS] ACTIVE: model=${currentModel} tier=${currentTier}`)
  } else {
    if (DEBUG_INTERNALS) console.error("[vibeOS] NO MODEL — enforcement disabled, will auto-detect on first hook")
  }

  if (DEBUG_INTERNALS) console.error(`[vibeOS] auto-config guard: currentModel=${currentModel ? "SET" : "NONE"}, TIERS_FILE=${getTiersFile()}, exists=${existsSync(getTiersFile())}`)
  try {
    if (!existsSync(getTiersFile())) {
      if (DEBUG_INTERNALS) console.error(`[vibeOS] model-tiers.json missing at load; will seed on first hook`)
    }
    await _seedModelTiersIfMissing(directory)
    loadTrinitySlotsFromTiersFile()
  } catch {}

  if (DEBUG_INTERNALS && detectContext7()) console.error(`[vibeOS] context7 detected — docs nudge enabled`)

  // ── Startup safety ──────────────────────────────────────────────────
  // Keep load-time side effects minimal: defer any slot/catalog writes until
  // the first real hook runs after OpenCode is fully ready.

  fp = projectFingerprint(directory)
  setCurrentProjectFingerprint(fp)
  setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
  briefedProjects.clear()
  activeJob = _loadActiveJobForProject(directory, fp)
  const systemBriefedProjects = new Set<string>()
  const hookVibeHome = join(hookHome, ".claude")
  const hookStateFile = join(hookVibeHome, "delegation-state.json")
  const hookProjectStateFile = join(hookVibeHome, "project-states.json")
  const hookReportsDir = join(hookVibeHome, "reports")
  const hookReportsIndex = join(hookReportsDir, "index.json")
  const hookTiersFile = join(hookVibeHome, "model-tiers.json")
  const loadProjectStateStable = () => {
    try {
      const state = safeJsonParse(readFileSync(hookProjectStateFile, "utf-8"))
      if (state && typeof state === "object") {
        state.project_hashes ??= {}
        return state
      }
    } catch {}
    return { project_hashes: {} }
  }
  const saveProjectStateStable = (state: any) => {
    try {
      mkdirSync(dirname(hookProjectStateFile), { recursive: true })
      const tmp = hookProjectStateFile + ".tmp"
      writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n")
      renameSync(tmp, hookProjectStateFile)
    } catch {}
  }
  const reportsIndexStable = () => {
    try {
      const idx = safeJsonParse(readFileSync(hookReportsIndex, "utf-8"))
      if (!idx || !Array.isArray(idx.reports)) return { reports: [] }
      return idx
    } catch { return { reports: [] } }
  }
  const saveReportsIndexStable = (idx: any) => {
    try {
      mkdirSync(hookReportsDir, { recursive: true })
      writeFileSync(hookReportsIndex, JSON.stringify(idx, null, 2) + "\n")
    } catch {}
  }
  const backupFileStable = (path: string, label: string): string | null => {
    try {
      if (!existsSync(path)) return null
      const bkDir = join(hookVibeHome, ".backups")
      mkdirSync(bkDir, { recursive: true })
      const bk = join(bkDir, `${basename(path)}.${label}.${Date.now()}.bak`)
      copyFileSync(path, bk)
      return bk
    } catch { return null }
  }
  _runDeferredStartupBootstrap = () => {}

  // ── Plugin hooks ──────────────────────────────────────────────────
    // trinity tool dependency injection
    const _tiersData = (() => { try { return safeJsonParse(readFileSync(getTiersFile(), "utf-8")) } catch { return {} } })()
    const trinityDeps = {
      tool, _lazyRefresh, _readAuth, _tiersData,
      _loadOpenCodeProviders, _modelCost, _modelTier,
      _modelLocked, _latestBlackboxState,
      currentModel, currentTier, currentProjectFingerprint, currentProjectName,
      get latestUserIntent() { return latestUserIntent }, directory,
      safeJsonParse, readFileSync, writeFileSync, existsSync, renameSync, mkdirSync,
      get TIERS_FILE() { return hookTiersFile }, USER_HOME, get STATE_FILE() { return hookStateFile }, CREDIT_CACHE_F,
      SAVINGS_LEDGER_FILE, PROJECT_STATE_FILE: hookProjectStateFile, get REPORTS_DIR() { return hookReportsDir }, get REPORTS_INDEX() { return hookReportsIndex },
      get OPENCODE_HOME() { return getOpenCodeHome() }, get VIBEOS_HOME() { return hookVibeHome },
      loadSelection, writeSelection, loadCredit, thinkingLevel,
      readLifetimeSavings, readFullState, _OC_SID, formatUsd,
      getBlackboxResolution, scoreStress, applySlot, saveOptimizationMode,
      getFlowWarns, projectFingerprint, loadProjectState: loadProjectStateStable, saveProjectState: saveProjectStateStable,
      ensureProjectBucket, mergeProjectBucket, clearProjectPatterns,
      projectPatternRows, promotedProjectPatterns, detectTechStack, ensureProjectDocs,
      discoverAvailableModels, classifyAndRankModels, modelToCcAlias, probeModel,
      setBlackboxEnabled, loadBlackboxState, saveBlackboxState,
      reportsIndex: reportsIndexStable, saveReportsIndex: saveReportsIndexStable, backupFile: backupFileStable, writeSessionSlot, _refreshModel,
      setApiToken,
      setApiBootstrapToken,
      ensureBootstrapExchange,
      loadTodos, upsertTodo, getTodos, markTodoDone, syncFlowTodosToNative,
      get _blackboxTracker() { return getBlackboxTracker() },
      set _blackboxTracker(v) { resetBlackboxTracker() },
      get _blackboxEnabled() { return _blackboxEnabled },
      set _blackboxEnabled(v) { setBlackboxEnabled(v) },
    }
  const pluginHooks = {
    "tool.execute.before": async (input: any, output: any) => {
      setVibeOSHomeContext(hookVibeHome)
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp)
        setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
      }
      ensureDeferredBootstrap();
      (onToolExecuteBefore as any)._directory = directory
      return onToolExecuteBefore(input, output)
    },
    "tool.execute.after": async (input: any, output: any) => {
      setVibeOSHomeContext(hookVibeHome)
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp)
        setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
      }
      (onToolExecuteAfter as any)._directory = directory
      return onToolExecuteAfter(input, output)
    },
    "experimental.chat.messages.transform": async (_input: any, output: any) => {
      ensureDeferredBootstrap()
      return onMessagesTransform(_input, output)
    },

    "experimental.session.compacting": async (_input: any, output: any) => {
      return onSessionCompacting(_input, output)
    },
    "experimental.chat.system.transform": async (_input: any, output: any) => {
      setVibeOSHomeContext(hookVibeHome)
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp)
        setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
      }
      ensureDeferredBootstrap()
      ;(onSystemTransform as any)._directory = directory
      ;(onSystemTransform as any)._activeJob = activeJob
      ;(onSystemTransform as any)._briefedProjects = systemBriefedProjects
      return onSystemTransform(_input, output)
    },
    "shell.env": async (_input: any, output: any) => {
      setVibeOSHomeContext(hookVibeHome)
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp)
        setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
      }
      if (typeof setShellDirectory === "function") setShellDirectory(directory || "")
      return onShellEnv(_input, output)
    },
    "experimental.text.complete": async (_input: any, output: any) => {
      setVibeOSHomeContext(hookVibeHome)
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp)
        setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
      }
      ensureDeferredBootstrap()
      await _appendFooter(_input, output, directory)
    },
    "message.updated": async (_input: any, output: any) => {
      setVibeOSHomeContext(hookVibeHome)
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp)
        setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
      }
      ensureDeferredBootstrap()
      await _appendFooter(_input, output, directory)
    },
    tool: {
      trinity: tool(createTrinityTool(trinityDeps)),
      "research-audit": tool({
        description: "Scan session for research anti-patterns (domain chains, redundant queries, no synthesis). hours=N (default 24).",
        args: { hours: tool.schema.number().optional() },
        async execute({ hours }: { hours?: number } = {}) {
          const report = researchAudit({ hours: hours ?? 24 })
          try {
            const state = loadProjectState()
            const bucket = ensureProjectBucket(state, fp)
            bucket.lastSeen = new Date().toISOString()
            bucket.researchChains = Math.max(bucket.researchChains || 0, report.chains.length)
            saveProjectState(state)
          } catch {}
          try {
            const findings: Array<{ severity: string; topic: string; detail: string }> = []
            for (const c of report.chains) findings.push({ severity: "warn", topic: "Domain chain", detail: `${c.domain}: ${c.count} fetches` })
            if (report.redundant > 0) findings.push({ severity: "warn", topic: "Context7 bypass", detail: `${report.redundant} bypasses` })
            if (report.totalFetches > 0) findings.push({ severity: "info", topic: "Fetch volume", detail: `${report.totalFetches} fetches, ${(report.totalBytes/1024).toFixed(0)}KB` })
            saveReport({ type: "research-audit", summary: `${report.totalFetches} fetches, ${report.chains.length} chains`, findings, metrics: report, tags: ["research"] })
          } catch {}
          const lines = [`Research audit (last ${hours ?? 24}h):`]
          if (report.totalFetches === 0) return lines.concat("  No activity.").join("\n")
          lines.push(`  Fetches: ${report.totalFetches} (${(report.totalBytes/1024).toFixed(0)}KB)`)
          if (report.redundant > 0) lines.push(`  Context7 bypasses: ${report.redundant}`)
          for (const c of report.chains) lines.push(`  Chain: ${c.domain} (${c.count}x)`)
          return lines.join("\n")
        },
      }),
      "report-save": tool({
        description: "Save report with findings, metrics, narrative.",
        args: {
          summary: tool.schema.string({ description: "One-line summary" }),
          findings: tool.schema.string({ description: "Plain text lines or JSON array" }).optional(),
          metrics: tool.schema.string({ description: "Plain text lines key=value or JSON" }).optional(),
          narrative: tool.schema.string({ description: "Free-form markdown" }).optional(),
          tags: tool.schema.string({ description: "Comma-separated tags" }).optional(),
        },
        async execute({ summary, findings, metrics, narrative, tags }: any = {}) {
          let parsedFindings: Array<any> = []; let parsedMetrics: any = {}
          try { if (findings) parsedFindings = JSON.parse(findings) } catch {
            if (findings) for (const line of findings.split("\n").map((l: string) => l.trim()).filter(Boolean)) {
              const m = line.match(/^(warn|info|hint)\s*:\s*(.+?)\s*:\s*(.+)/i)
              if (m) parsedFindings.push({ severity: m[1].toLowerCase(), topic: m[2].trim(), detail: m[3].trim() })
              else parsedFindings.push({ severity: "info", topic: "Note", detail: line })
            }
          }
          try { if (metrics) parsedMetrics = JSON.parse(metrics) } catch {
            if (metrics) for (const line of metrics.split("\n").map((l: string) => l.trim()).filter(Boolean)) {
              const m = line.match(/^([\w-]+)\s*=\s*([\d.]+)/)
              if (m) parsedMetrics[m[1]] = parseFloat(m[2])
            }
          }
          const tagList = tags ? tags.split(",").map((t: string) => t.trim()).filter(Boolean) : []
          const id = saveReport({ type: "manual", summary, findings: parsedFindings, metrics: parsedMetrics, narrative: narrative || "", tags: tagList })
          return id ? `Report saved: ${id}` : "Failed"
        },
      }),
      "report-list": tool({
        description: "List reports. Filter by type, project, hours (default 168).",
        args: {
          type: tool.schema.string().optional(),
          project: tool.schema.string().optional(),
          hours: tool.schema.number().optional(),
        },
        async execute({ type, project, hours }: any = {}) {
          const reports = listReports({ type, project, hours: hours ?? 168 })
          if (reports.length === 0) return "No reports found."
          const lines = [`Reports (last ${hours ?? 168}h): ${reports.length} total`]
          for (const r of reports.slice(0, 15)) {
            const d = r.created.slice(0, 16).replace("T", " ")
            lines.push(`  [${d}] #${r.id} ${r.type} ${(r.summary || "").slice(0, 80)}`)
          }
          if (reports.length > 15) lines.push(`  ... and ${reports.length - 15} more`)
          return lines.join("\n")
        },
      }),
      "report-read": tool({
        description: "Read a report by ID (from report-list).",
        args: { id: tool.schema.string({ description: "Report ID" }) },
        async execute({ id }: { id?: string } = {}) {
          if (!id || !/^[\w-]+$/.test(id)) return `Invalid ID: ${id}`
          const report = readReport(id)
          if (!report) return `Not found: ${id}`
          const d = (report?.meta?.created ?? report?.created ?? "?").slice(0, 16).replace("T", " ")
          const lines = [`Report #${id}`, `  Type: ${report?.meta?.type ?? report?.type ?? "?"}  |  ${d}`]
          if (report.summary) lines.push(`  ${report.summary}`)
          if (report.tags?.length) lines.push(`  Tags: ${report.tags.join(", ")}`)
          if (report.narrative) lines.push(`  ---\n${report.narrative}`)
          return lines.join("\n")
        },
      }),
    },
  }

  // ── MCP server startup ─────────────────────────────────────────────
  const _inTestEnv = process.env.VIBEOS_MCP_PORT === "0" || !client || Object.keys((client as any) || {}).length === 0
  if (!_mcpServerStartupPromise && !_inTestEnv) {
    _mcpServerStartupPromise = Promise.resolve().then(async () => {
      try {
        const port = loadMcpPort()
        if (port === 0) return
        if (!_mcpServerRuntime) {
          _mcpServerRuntime = createMcpServer({
            getState: () => ({
              ...buildStatusPayload({
                selection: loadSelection(),
                tiersData: (() => { try { return safeJsonParse(readFileSync(getTiersFile(), "utf-8")) } catch { return {} } })(),
                currentModel: currentModel || "",
                creditPercent: loadCredit(),
                version: readPackageVersion(),
                todos: loadTodos(),
                fallbackThinking: thinkingLevel(loadCredit()),
                backendConnected: isApiConnected(),
                backendHealthUrl: `${VIBEOS_API_URL}/health`,
                modelLocked: _modelLocked,
                lockedSlot: _lockedSlot,
                lockedModel: _lockedModel,
              }),
              sessions_raw: readFullState()?.sessions || {},
            }),
            getSavings: () => buildSavingsPayload({
              lifetime: readLifetimeSavings(),
              session: readFullState()?.sessions?.[_OC_SID] || {},
            }),
            getSessionMetrics: () => computeSessionMetrics(readFullState(), _OC_SID),
            getTodos: () => loadTodos(),
            listReports: (filter: any) => {
              if (!existsSync(getReportsDir())) { const e: any = new Error("reports dir not found"); e.status = 404; throw e }
              return listReports(filter || {})
            },
            readReport: (rvId: string) => readReport(rvId),
            runDiagnose: async () => diagnoseStructuredFromText(await pluginHooks.tool.trinity.execute({ action: "diagnose" }), loadCredit()),
            runProject: async () => projectStructuredFromText(await pluginHooks.tool.trinity.execute({ action: "project" }), loadSelection(), loadCredit()),
            runTrinity: async (rvAction: string, params: any = {}) => pluginHooks.tool.trinity.execute({ action: rvAction, slot: params.slot, level: params.level }),
            runResearchAudit: (hours: number) => researchAudit({ hours: hours ?? 24 }),
            saveReport: (data: any) => saveReport(data),
            getCurrentSessionId: () => _OC_SID,
            generateSessionCheckout: () => {
              const state = readFullState()
              const metrics = computeSessionMetrics(state, _OC_SID)
              const session = state?.sessions?.[_OC_SID] || {}
              const flowWarns = getFlowWarns().filter((w: any) => String(w?.sid || "") === String(process.pid || ""))
              const checkout = buildSessionCheckout({
                sessionId: _OC_SID,
                metrics,
                session,
                flowWarns,
              })
              const reportId = saveReport(checkout.report)
              return { ok: true, summary: checkout.summary, report_id: reportId }
            },
          })
        }
        const mcpServer = await _mcpServerRuntime.start(port)
        const actualPort = Number(mcpServer?.address?.()?.port || port)
        if (actualPort && actualPort !== port) persistMcpPort(actualPort)
        console.error(`[vibeOS] MCP server on http://127.0.0.1:${actualPort}`)
        if (actualPort) console.error(`[vibeOS] Dashboard at http://127.0.0.1:${actualPort}/`)
        console.error(`[vibeOS] Dashboard at http://127.0.0.1:${actualPort}/`)
        if (!_mcpServerHooked) {
          _mcpServerHooked = true
          process.on("SIGTERM", () => { try { _mcpServerRuntime?.close() } catch {} })
          process.on("SIGINT", () => { try { _mcpServerRuntime?.close() } catch {} })
        }
      } catch (err) {
        console.error(`[vibeOS] MCP startup failed: ${(err as Error).message}`)
      }
    })
  }

  return pluginHooks
}

export const id = "vibeOS"
export const server = DelegationEnforcer
export const VERSION = readPackageVersion()

export default { id: "vibeOS", server: DelegationEnforcer }

export { researchAudit } from "./lib/research-audit.js"
export { saveReport, listReports, readReport } from "./lib/reporting.js"
export {
  applySlot, modelCostPerTurn, isModelFree, isDocsTarget, detectContext7,
  loadTierRegexes, classify, _refreshModel, HIGH_TIER_RE, MID_TIER_RE, PLACEHOLDER_RE,
  TRINITY_BRAIN, TRINITY_MEDIUM, TRINITY_CHEAP,
  setTrinityBrain, setTrinityMedium, setTrinityCheap, trendDisplay,
} from "./lib/pricing.js"
export { getScratchpadHit, getSessionScratchpadDir, getSessionIndexPath } from "./lib/state.js"
export { extractExports, buildTestSkeleton, enforceTestFile, buildTestReminder } from "./lib/tdd-enforcer.js"
export { classifyAndRankModels, modelToCcAlias } from "./lib/trinity-rebuild.js"
export { scoreStress, detectTechStack, loadBlackboxState, saveBlackboxState, getBlackboxResolution, } from "./lib/turn-classify.js"
export { remoteCall } from "./lib/api-client.js"
export { observeToolPattern, noteProjectPattern, recordSaving, compressText, } from "./lib/index-helpers.js"

export function closeMcpServer() {
  try {
    if (_mcpServerRuntime) { _mcpServerRuntime.close(); _mcpServerRuntime = null }
  } catch {}
}
