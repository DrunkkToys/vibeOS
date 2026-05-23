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
import { homedir, tmpdir } from "node:os"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { checkFlowRules, getFlowWarns, ensureProjectDocs, getFlowTodos, syncFlowTodosToNative } from "./vibeOS-lib/flow-enforcer.js"
import { computeSessionMetrics } from "./vibeOS-lib/session-metrics.js"
import { createMcpServer } from "vibeOScore/mcp-server"
import { VibeOSApiClient } from "vibeOScore/client"

import { getApiClient, remoteCall, isApiFallback, setApiToken, VIBEOS_API_URL } from "./lib/api-client.js"
import {
  applySlot, modelCostPerTurn, isModelFree, isDocsTarget, detectContext7, modelToSlotLabel,
  shortModelName, roundUsd, formatUsd, classify, _refreshModel, loadTierRegexes,
  HIGH_TIER_RE, MID_TIER_RE, PLACEHOLDER_RE, readConfig,
  TRINITY_BRAIN, TRINITY_MEDIUM, TRINITY_CHEAP,
  setTrinityBrain, setTrinityMedium, setTrinityCheap,
} from "./lib/pricing.js"
import {
  scoreStress, classifyTurnSimple, extractFirstWordFromArgs, shouldLogWarn,
  resolveEnforcementMode, getLearnedExploratoryWords, extractLastUserText,
  isLikelyOffTopic, detectTechStack, loadBlackboxState, saveBlackboxState,
  getBlackboxTracker, getBlackboxResolution, detectOutcomeSignal,
  fetchBlackboxEnrichment, loadGlobalLearning, updateGlobalLearning,
  loadOptimizationMode, saveOptimizationMode,
} from "./lib/turn-classify.js"
import {
  safeJsonParse, readFullState, updateState, loadSelection, writeSelection,
  readLifetimeSavings, _OC_SID, _modelLocked, _blackboxEnabled, setBlackboxEnabled,
  currentTier, currentModel, currentProjectFingerprint, currentProjectName,
  setCurrentTier, setCurrentModel, setCurrentProjectFingerprint, setCurrentProjectName,
  textCompletePainted, softQuotaCounts, enforcementBlocked, taskSlotRestore,
  pendingUiNote, briefedProjects, scratchpadHitsSeen, context7AlertedThisSession,
  _latestBlackboxState, _latestBlackboxLoopMsg, _latestBlackboxPivotMsg,
  getScratchpadHit, recordScratchpadObservation, getSessionScratchpadDir,
  ensureSessionScratchpadDirs, getSessionIndexPath, indexAppend,
  getActiveJobForProject, projectFingerprint, loadProjectState, saveProjectState,
  ensureProjectBucket, mergeProjectBucket, saveMLState,
  SAVINGS_LEDGER_FILE, CONTEXT7_INSTALL_FLAG, SOFT_QUOTA_LIMIT, SCRATCHPAD_TOOLS,
  TRINITY_OPENCODE_CONFIG, TRINITY_OPENCODE_CONFIGC, TIERS_FILE,
  USER_HOME, FILE_LOCK_DIR, STATE_FILE, DELEGATION_STATE_FILE, PROJECT_STATE_FILE,
  BLACKBOX_STATE_FILE, REPORTS_DIR, ML_ENABLED, _mlGraph, _cacheDb,
  ML_CONFIDENCE_THRESHOLD, _mlSavePending, AUTH_F, CREDIT_CACHE_F,
  recordCacheSaving, recordMissedContext7, SCRATCHPAD_GLOBAL_DIR,
  pruneScratchpadOnce, cleanupCurrentSessionScratchpad,
  registerSessionCleanupHandlers, promotedProjectPatterns, projectPatternRows,
  clearProjectPatterns, loadTodos, getTodos, upsertTodo, markTodoDone, _handleStateCorruption, _zType, tool,
} from "./lib/state.js"
import { MONITOR } from "./lib/constants.js"
import { extractExports, buildTestSkeleton, enforceTestFile, buildTestReminder } from "./lib/tdd-enforcer.js"
import { setActiveJobFromTaskPrompt, observeToolPattern, applyDecadence, compressText, recordSaving } from "./lib/index-helpers.js"
import { researchAudit } from "./lib/research-audit.js"
import { saveReport, listReports, readReport, reportsIndex, saveReportsIndex, REPORTS_INDEX } from "./lib/reporting.js"
import { writeSessionSlot } from "./lib/selection-manager.js"
import { _refreshModel } from "./lib/pricing.js"
import { loadCredit, thinkingLevel, _lazyRefresh, _readAuth } from "./lib/credit-api.js"
import { createTrinityTool } from "./lib/trinity-tool.js"
import { classifyAndRankModels, modelToCcAlias, discoverAvailableModels, probeModel } from "./lib/trinity-rebuild.js"
import { _appendFooter } from "./lib/hooks/footer.js"
import { readFileSync as _readFileSync, existsSync as _existsSync } from "node:fs"
import { join as _join } from "node:path"

// ── Calibration pipeline: load trained mode weights ───────────────────
const CAL_WEIGHTS_FILE = _join(USER_HOME, ".claude", "mode-calibration-weights.json")
let _calibratedModeMap: Record<string, string> | null = null

function loadCalibratedModeMap(): Record<string, string> {
  if (_calibratedModeMap) return _calibratedModeMap
  try {
    if (_existsSync(CAL_WEIGHTS_FILE)) {
      const d = safeJsonParse(_readFileSync(CAL_WEIGHTS_FILE, "utf-8"))
      if (d?.regime_mode_map) {
        _calibratedModeMap = d.regime_mode_map
        console.error("[vibeOS] calibration: loaded regime→mode weights")
        return _calibratedModeMap
      }
    }
  } catch {}
  return {}
}

function getCalibratedMode(regime: string, stress: number): string | null {
  if (stress > 1.5) return "quality"
  const map = loadCalibratedModeMap()
  return map[regime] || null
}

export { loadCalibratedModeMap, getCalibratedMode }
import { onToolExecuteBefore, onToolExecuteAfter, setToolDirectory } from "./lib/hooks/tool-execute.js"
import { onMessagesTransform, onSystemTransform, latestUserIntent, ensureProjectSkill } from "./lib/hooks/chat-transform.js"
import { onSessionCompacting } from "./lib/hooks/session-compact.js"
import { onShellEnv, setShellDirectory } from "./lib/hooks/shell-env.js"

// ── Remote API client state ──────────────────────────────────────────
let _apiClient: any = null
let _apiFallbackMode = false
let _apiFallbackSince: number | null = null

let activeJob: any = null
let fp = ""
let _mcpServerRuntime: any = null
let _mcpServerHooked = false
let context7Seen = new Set()
let _prevOutputText = ""

const SAVE_EST = {
  WRITE_EDIT:   0.005,
  SOFT_QUOTA:   0.0003,
  CONTEXT7:     0.002,
  OPUS_DISABLE: 0.03,
}

// ── Credit snapshot refresh ──────────────────────────────────────────
// ── OpenCode provider config helpers ──────────────────────────────────
const OPENCODE_GO_CATALOG = [
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-chat",
  "deepseek/deepseek-reasoner",
]

function _loadOpenCodeProviders(): any {
  try {
    const cfg = _readOpenCodeConfigObject(join(USER_HOME, ".config", "opencode"))
    return cfg?.provider || {}
  } catch { return {} }
}

function _readOpenCodeConfigObject(dir: string): any {
  const jsonPath = join(dir, "opencode.json")
  const jsoncPath = join(dir, "opencode.jsonc")
  if (existsSync(jsonPath)) return safeJsonParse(readFileSync(jsonPath, "utf-8"))
  if (existsSync(jsoncPath)) return _parseJsonc(readFileSync(jsoncPath, "utf-8"))
  return {}
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
  const stripped = id.replace(/^(openrouter|opencode|deepseek)\//, "")
  return modelCostPerTurn(stripped) ?? modelCostPerTurn("deepseek/" + stripped) ?? 0
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
    const bkDir = join(USER_HOME, ".claude", ".backups")
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
    if (!Number.isFinite(n)) return 9578
    return n
  }
  try {
    if (existsSync(TIERS_FILE)) {
      const tiers = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
      const cfg = tiers?.selection?.mcp_port ?? tiers?.mcp_port
      if (cfg === false || cfg === "disabled" || cfg === 0) return 0
      const n = Number(cfg)
      if (Number.isFinite(n)) return n
    }
  } catch {}
  return 9578
}

function persistMcpPort(port: number): void {
  try {
    if (!existsSync(TIERS_FILE)) return
    const tiers = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
    tiers.selection ??= {}
    if (Number(tiers.selection.mcp_port) === Number(port)) return
    tiers.selection.mcp_port = port
    mkdirSync(dirname(TIERS_FILE), { recursive: true })
    const tmp = TIERS_FILE + ".tmp." + Date.now()
    writeFileSync(tmp, JSON.stringify(tiers, null, 2) + "\n", "utf-8")
    renameSync(tmp, TIERS_FILE)
  } catch {}
}

function computeStatusPayload(): any {
  const sel = loadSelection()
  let tiersData: any = {}
  try { tiersData = safeJsonParse(readFileSync(TIERS_FILE, "utf-8")) } catch {}
  const credit = loadCredit()
  const activeSlot = sel.active_slot || "brain"
  const current = tiersData?.trinity?.[activeSlot]?.oc || currentModel || ""
  const thinking = sel.thinking_level || thinkingLevel(credit)
  const _todos = loadTodos()
  const pendingTodos = _todos.filter(t => t.status === "pending").length
  const totalTodos = _todos.length
  return {
    enabled: sel.enabled !== false,
    active_slot: activeSlot,
    enforce: sel.delegation_enforce !== false,
    flow_enforcer: sel.flow_enabled !== false,
    flow_extract_todos: sel.flow_enforce === true,
    tdd_enforcer: sel.tdd_enforce === true,
    tdd_strict: sel.tdd_strict !== false,
    thinking,
    current_model: current,
    credit_percent: credit,
    version: readPackageVersion(),
    todos: { total: totalTodos, pending: pendingTodos },
  }
}

function computeSavingsPayload(): any {
  const lt = readLifetimeSavings()
  return {
    lifetime: {
      delegation_usd: Number(lt.ltTasks || 0),
      cache_usd: Number(lt.ltCache || 0),
      missed_context7_usd: Number(lt.missedC7 || 0),
      total_warns: Number(lt.count || 0),
    },
    current_session: {
      delegation_usd: Number(lt.sesTasks || 0),
      cache_usd: Number((readFullState()?.sessions?.[_OC_SID]?.cache_savings_usd) || 0),
      warns_count: Array.isArray(readFullState()?.sessions?.[_OC_SID]?.warns) ? readFullState().sessions[_OC_SID].warns.length : 0,
      tool_breakdown: lt.sesToolBreakdown || {},
    },
    cache_hits_this_session: Number(readFullState()?.sessions?.[_OC_SID]?.cache_hits?.length || 0),
    trend: lt.sesTrend || "stable",
    savings_rate_per_hour: Number(lt.sesRatePerHour || 0),
  }
}

function computeSessionCheckout(): any {
  const state = readFullState()
  const metrics = computeSessionMetrics(state, _OC_SID)
  const session = state?.sessions?.[_OC_SID] || {}
  const warns = Array.isArray(session?.warns) ? session.warns : []
  const rankedOps = warns
    .map((w: any) => ({
      tool: String(w?.tool || "unknown"),
      reason: String(w?.reason || ""),
      savings_usd: Number(w?.est_savings_usd || 0),
      at: w?.at || null,
    }))
    .sort((a: any, b: any) => b.savings_usd - a.savings_usd)
    .slice(0, 3)
  const flowWarns = getFlowWarns().filter((w: any) => String(w?.sid || "") === String(process.pid || ""))
  const summary = {
    session_id: _OC_SID,
    duration_seconds: Number(metrics?.sesDuration || 0),
    duration: metrics?.sesDurationFormatted || "0h 0m 0s",
    cost_usd: Number(session?.cost_usd || 0),
    savings: {
      delegation_usd: Number(metrics?.sesTasks || 0),
      cache_usd: Number(session?.cache_savings_usd || 0),
      total_usd: Number((metrics?.sesTasks || 0) + Number(session?.cache_savings_usd || 0)),
    },
    tools: {
      breakdown: metrics?.sesToolBreakdown || {},
      top_expensive_operations: rankedOps,
    },
    model_split: metrics?.sesModelTurns || { brain: 0, worker: 0 },
    trend_vs_previous_sessions: metrics?.sesTrend || "stable",
    flow_violations: flowWarns,
  }
  const reportId = saveReport({
    type: "session-checkout",
    summary: `Session checkout ${_OC_SID}: $${Number(summary.savings.total_usd || 0).toFixed(3)} saved`,
    findings: rankedOps.map((op: any) => ({
      severity: "info",
      topic: op.tool,
      detail: `${op.reason} ($${op.savings_usd.toFixed(6)})`,
    })),
    metrics: {
      duration_seconds: summary.duration_seconds,
      cost_usd: summary.cost_usd,
      delegation_savings_usd: summary.savings.delegation_usd,
      cache_savings_usd: summary.savings.cache_usd,
      total_savings_usd: summary.savings.total_usd,
      trend: summary.trend_vs_previous_sessions,
      brain_turns: summary.model_split.brain || 0,
      worker_turns: summary.model_split.worker || 0,
    },
    narrative: JSON.stringify(summary),
    tags: ["session", "checkout"],
  })
  return { ok: true, summary, report_id: reportId }
}

function diagnoseStructuredFromText(raw: string): any {
  const text = String(raw || "")
  const lines = text.split("\n")
  const files: Array<any> = []
  const model_probes: Array<any> = []
  const suggestions: string[] = []
  let credit = { percent: loadCredit(), ok: true, fix: null as string | null }
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.includes("→")) suggestions.push(trimmed.replace(/^→\s*/, ""))
    if (/slot/i.test(trimmed) && /(brain|medium|cheap)/i.test(trimmed)) {
      model_probes.push({ slot: trimmed, model: "", ok: trimmed.includes("✅"), fix: trimmed.includes("→") ? trimmed.split("→")[1].trim() : undefined })
    }
    if (/model-tiers\.json|opencode\.json|delegation-state\.json|auth\.json/i.test(trimmed)) {
      files.push({ path: trimmed, exists: trimmed.includes("✅"), ok: trimmed.includes("✅"), fix: trimmed.includes("→") ? trimmed.split("→")[1].trim() : undefined })
    }
    if (/credit/i.test(trimmed)) {
      const m = trimmed.match(/(\d+)%/)
      if (m) credit.percent = Number(m[1])
      credit.ok = trimmed.includes("✅")
      credit.fix = trimmed.includes("→") ? trimmed.split("→")[1].trim() : null
    }
  }
  return {
    config_valid: !text.includes("❌"),
    files,
    model_probes,
    credit,
    locks_clean: true,
    suggestions,
  }
}

function projectStructuredFromText(raw: string): any {
  const text = String(raw || "")
  const m1 = text.match(/Brain[^0-9]*(\d+)%/i)
  const m2 = text.match(/Worker[^0-9]*(\d+)%/i)
  const brainPct = m1 ? Number(m1[1]) : 0
  const workerPct = m2 ? Number(m2[1]) : 0
  const lines = text.split("\n")
  const suggestions = lines.filter((l: string) => l.includes("💡")).map((l: string) => l.replace(/^.*💡\s*/, "").trim())
  return {
    brain_pct: brainPct,
    worker_pct: workerPct,
    enforcement_status: loadSelection().delegation_enforce ? "enforce" : "warn",
    flow_status: loadSelection().flow_enabled !== false ? "on" : "off",
    credit_percent: loadCredit(),
    suggestions,
  }
}

// ── DelegationEnforcer — main plugin entry point ─────────────────────

export async function DelegationEnforcer({ client, directory }: { client?: unknown; directory?: string } = {}) {
  console.error(`[vibeOS] LOADED cwd=${directory}`)
  if (typeof setToolDirectory === "function") setToolDirectory(directory || "")
  if (typeof setShellDirectory === "function") setShellDirectory(directory || "")
  registerSessionCleanupHandlers()
  pruneScratchpadOnce()

  // Detect model: project opencode.json → global ~/.config/opencode/opencode.json → env.
  setCurrentModel(readConfig(directory))
  if (!currentModel) {
    const home = process.env.HOME || ""
    if (home) setCurrentModel(readConfig(join(home, ".config/opencode")))
  }
  if (!currentModel) setCurrentModel(process?.env?.OPENCODE_MODEL || "")
  if (currentModel) {
    setCurrentTier(classify(currentModel))
    try {
      const _tiersData = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
      const _activeSlot = _tiersData?.selection?.active_slot || "brain"
      if (_activeSlot === "brain") {
        const _brainOcModel = _tiersData?.trinity?.brain?.oc || ""
        if (_brainOcModel && currentModel === _brainOcModel && !PLACEHOLDER_RE.test(_brainOcModel)) {
          const cost = modelCostPerTurn(_brainOcModel)
          if (HIGH_TIER_RE.test(_brainOcModel) || (cost !== null && cost >= 0.01)) {
            setCurrentTier("high")
            console.error(`[vibeOS] tier override → high (brain slot)`)
          }
        }
      }
    } catch {}
    console.error(`[vibeOS] ACTIVE: model=${currentModel} tier=${currentTier}`)
  } else {
    console.error("[vibeOS] NO MODEL — enforcement disabled, will auto-detect on first hook")
  }

  // Auto-configure model-tiers.json
  console.error(`[vibeOS] auto-config guard: currentModel=${currentModel ? "SET" : "NONE"}, TIERS_FILE=${TIERS_FILE}, exists=${existsSync(TIERS_FILE)}`)
  if (currentModel || !existsSync(TIERS_FILE)) {
    try {
      let _tiersData
      let _wasCorrupted = false
      if (existsSync(TIERS_FILE)) {
        try { _tiersData = safeJsonParse(readFileSync(TIERS_FILE, "utf-8")) } catch {
          _tiersData = { selection: { enabled: true, active_slot: "brain", delegation_enforce: true, tdd_strict: true }, trinity: {} }
          _wasCorrupted = true
        }
        if (!_wasCorrupted && !_tiersData?.trinity) _wasCorrupted = true
        if (!_wasCorrupted) {
          for (const slot of ["brain", "medium", "cheap"]) {
            if (!_tiersData?.trinity?.[slot] || _tiersData.trinity[slot] === null || typeof _tiersData.trinity[slot].oc !== "string") {
              _wasCorrupted = true
              break
            }
          }
        }
      } else {
        _tiersData = { selection: { enabled: true, active_slot: "brain", delegation_enforce: true, tdd_strict: true }, trinity: {} }
      }
      const _providers = _loadOpenCodeProviders()
      const _allModels: Array<{ id: string; cost: number; tier: string }> = []
      for (const [providerName, cfg] of Object.entries(_providers)) {
        if ((cfg as any)?.models && typeof (cfg as any).models === "object") {
          for (const rawId of Object.keys((cfg as any).models)) {
            const id = rawId.includes("/") ? rawId : providerName + "/" + rawId
            if (!_allModels.some(m => m.id === id)) {
              _allModels.push({ id, cost: _modelCost(id), tier: _modelTier(id) })
            }
          }
        }
      }
      if (!_allModels.some(m => m.id === currentModel)) {
        _allModels.push({ id: currentModel, cost: _modelCost(currentModel), tier: _modelTier(currentModel) })
      }
      const _ranked = classifyAndRankModels(_allModels)
      const _brain  = _ranked?.brain  || { id: currentModel, cost: _modelCost(currentModel), tier: _modelTier(currentModel) }
      let _medium: any = _ranked?.medium
      let _cheap: any  = _ranked?.cheap
      const _existing = _tiersData?.trinity || {}
      const _existingMedium = _existing.medium?.oc || ""
      const _existingCheap  = _existing.cheap?.oc  || ""
      const _isPlaceholder = (id: string) => !id || PLACEHOLDER_RE.test(id)
      const _preferExistingOrRanked = (ranked: any, existingId: string) => {
        if (ranked && ranked.id) return ranked
        if (_isPlaceholder(existingId)) return null
        if (!existingId) return null
        return { id: existingId, cost: _modelCost(existingId), tier: _modelTier(existingId) }
      }
      if (!_medium || _medium.id === _brain.id) {
        _medium = _preferExistingOrRanked(_medium, _existingMedium) || _medium
      }
      if (!_cheap || _cheap.id === _brain.id || (_medium && _cheap && _cheap.id === _medium.id)) {
        _cheap = _preferExistingOrRanked(_cheap, _existingCheap) || _cheap
      }
      if (_medium?.id === _brain.id) _medium = { ..._brain }
      if (_cheap?.id === _brain.id || _cheap?.id === _medium?.id) _cheap = { ..._brain }
      let _didWrite = false
      const _existingBrain = _existing.brain?.oc || ""
      if (_brain.id && _isPlaceholder(_existingBrain)) {
        _tiersData.trinity.brain = { oc: _brain.id, cc: modelToCcAlias(_brain.id) }
        _didWrite = true
      }
      if (_medium && _medium.id && _isPlaceholder(_existingMedium)) {
        _tiersData.trinity.medium = { oc: _medium.id, cc: modelToCcAlias(_medium.id) }
        _didWrite = true
      }
      if (_cheap && _cheap.id && _isPlaceholder(_existingCheap)) {
        _tiersData.trinity.cheap = { oc: _cheap.id, cc: modelToCcAlias(_cheap.id) }
        _didWrite = true
      }
      if (_tiersData) {
        _tiersData.selection ??= {}
        if (_tiersData.selection.mcp_port === undefined) _tiersData.selection.mcp_port = 9578
        mkdirSync(dirname(TIERS_FILE), { recursive: true })
        const _tmp = TIERS_FILE + ".tmp." + Date.now()
        writeFileSync(_tmp, JSON.stringify(_tiersData, null, 2) + "\n", "utf-8")
        renameSync(_tmp, TIERS_FILE)
        console.error(`[vibeOS] auto-synced model-tiers.json: brain=${_brain.id} medium=${_tiersData.trinity?.medium?.oc || ""} cheap=${_tiersData.trinity?.cheap?.oc || ""}`)
        const _tiersCfg = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
        const _b = _tiersCfg?.trinity?.brain?.oc
        const _m = _tiersCfg?.trinity?.medium?.oc
        const _c = _tiersCfg?.trinity?.cheap?.oc
        setTrinityBrain(_b || _brain.id)
        setTrinityCheap(_c || _cheap?.id || null)
        setTrinityMedium(_m || _medium?.id || null)
        if (_didWrite || _wasCorrupted) {
          console.error(`[vibeOS] WRITE: _didWrite=${_didWrite} _wasCorrupted=${_wasCorrupted} brain=${_brain?.id}`)
        } else {
          console.error(`[vibeOS] SKIP WRITE: _didWrite=${_didWrite} _wasCorrupted=${_wasCorrupted} existingBrain=${_existingBrain} brainId=${_brain?.id}`)
        }
      }
    } catch {}
  }

  // Ensure mcp_port is set
  try {
    const _mt = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
    if (_mt.selection && (_mt.selection.mcp_port === undefined || _mt.selection.mcp_port === null)) {
      _mt.selection.mcp_port = 9578
      const _tmp = TIERS_FILE + ".tmp." + Date.now()
      writeFileSync(_tmp, JSON.stringify(_mt, null, 2) + "\n", "utf-8")
      renameSync(_tmp, TIERS_FILE)
    }
  } catch {}
  if (detectContext7()) console.error(`[vibeOS] context7 detected — docs nudge enabled`)

  // ── Project memory ────────────────────────────────────────────────
  fp = projectFingerprint(directory)
  setCurrentProjectFingerprint(fp)
  setCurrentProjectName(directory ? directory.split("/").pop() : "unknown")
  activeJob = getActiveJobForProject(fp)
  try {
    const state = loadProjectState()
    const bucket = ensureProjectBucket(state, fp)
    bucket.totalSessions = (bucket.totalSessions || 0) + 1
    bucket.lastSeen = new Date().toISOString()
    saveProjectState(state)
  } catch (err) {
    console.error(`[vibeOS] project-memory init failed for ${fp}: ${(err as Error).message}`)
  }

  // ── Project Guard ─────────────────────────────────────────────────
  try {
    if (directory && existsSync(directory)) {
      const techStack = detectTechStack(directory)
      const result = ensureProjectDocs(directory, techStack)
      if (result.created.length > 0) console.error(`[vibeOS] Project Guard: created ${result.created.join(", ")}`)
      const skillResult = ensureProjectSkill(directory, fp)
      if (skillResult.created) {
        console.error(`[vibeOS] Project Guard: created ${skillResult.path}`)
      }
    }
  } catch (err) {
    console.error(`[vibeOS] Project Guard init failed: ${(err as Error).message}`)
  }

  // ── Plugin hooks ──────────────────────────────────────────────────
    // trinity tool dependency injection
    const _tiersData = (() => { try { return safeJsonParse(readFileSync(TIERS_FILE, "utf-8")) } catch { return {} } })()
    const trinityDeps = {
      tool, _lazyRefresh, _readAuth, _tiersData,
      _loadOpenCodeProviders, _modelCost, _modelTier,
      _modelLocked, _blackboxEnabled, _latestBlackboxState,
      currentModel, currentTier, currentProjectFingerprint, currentProjectName,
      latestUserIntent, directory,
      safeJsonParse, readFileSync, writeFileSync, existsSync, renameSync,
      TIERS_FILE, USER_HOME, STATE_FILE, CREDIT_CACHE_F,
      SAVINGS_LEDGER_FILE, PROJECT_STATE_FILE, REPORTS_DIR, REPORTS_INDEX,
      loadSelection, writeSelection, loadCredit, thinkingLevel,
      readLifetimeSavings, readFullState, _OC_SID, formatUsd,
      getBlackboxResolution, scoreStress, applySlot, saveOptimizationMode,
      getFlowWarns, projectFingerprint, loadProjectState, saveProjectState,
      ensureProjectBucket, mergeProjectBucket, clearProjectPatterns,
      projectPatternRows, promotedProjectPatterns, detectTechStack, ensureProjectDocs,
      discoverAvailableModels, classifyAndRankModels, modelToCcAlias, probeModel,
      setBlackboxEnabled, loadBlackboxState, saveBlackboxState,
      reportsIndex, saveReportsIndex, backupFile, writeSessionSlot, _refreshModel,
      setApiToken,
      loadTodos, upsertTodo, getTodos, markTodoDone, syncFlowTodosToNative,
      get _blackboxTracker() { return getBlackboxTracker() },
      set _blackboxTracker(v) { resetBlackboxTracker() },
    }
  const pluginHooks = {
    "tool.execute.before": async (input: any, output: any) => {
      (onToolExecuteBefore as any)._directory = directory
      return onToolExecuteBefore(input, output)
    },
    "tool.execute.after": async (input: any, output: any) => {
      (onToolExecuteAfter as any)._directory = directory
      return onToolExecuteAfter(input, output)
    },
    "experimental.chat.messages.transform": async (_input: any, output: any) => {
      return onMessagesTransform(_input, output)
    },

    "experimental.session.compacting": async (_input: any, output: any) => {
      return onSessionCompacting(_input, output)
    },
    "experimental.chat.system.transform": async (_input: any, output: any) => {
      return onSystemTransform(_input, output)
    },
    "shell.env": async (_input: any, output: any) => {
      if (typeof setShellDirectory === "function") setShellDirectory(directory || "")
      return onShellEnv(_input, output)
    },
    "experimental.text.complete": async (_input: any, output: any) => {
      await _appendFooter(_input, output, directory)
    },
    "message.updated": async (_input: any, output: any) => {
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
  try {
    const port = loadMcpPort()
    if (port !== 0 && !_inTestEnv) {
      if (!_mcpServerRuntime) {
        _mcpServerRuntime = createMcpServer({
          getState: () => ({ ...computeStatusPayload(), sessions_raw: readFullState()?.sessions || {} }),
          getSavings: () => computeSavingsPayload(),
          getSessionMetrics: () => computeSessionMetrics(readFullState(), _OC_SID),
          getTodos: () => loadTodos(),
          listReports: (filter: any) => {
            if (!existsSync(REPORTS_DIR)) { const e: any = new Error("reports dir not found"); e.status = 404; throw e }
            return listReports(filter || {})
          },
          readReport: (rvId: string) => readReport(rvId),
          runDiagnose: async () => diagnoseStructuredFromText(await pluginHooks.tool.trinity.execute({ action: "diagnose" })),
          runProject: async () => projectStructuredFromText(await pluginHooks.tool.trinity.execute({ action: "project" })),
          runTrinity: async (rvAction: string, params: any = {}) => pluginHooks.tool.trinity.execute({ action: rvAction, slot: params.slot, level: params.level }),
          runResearchAudit: (hours: number) => researchAudit({ hours: hours ?? 24 }),
          saveReport: (data: any) => saveReport(data),
          getCurrentSessionId: () => _OC_SID,
          generateSessionCheckout: () => computeSessionCheckout(),
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
    }
  } catch (err) {
    console.error(`[vibeOS] MCP startup failed: ${(err as Error).message}`)
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
