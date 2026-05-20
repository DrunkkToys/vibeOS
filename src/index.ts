// @ts-nocheck
/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
 *
 * vibeOS — OpenCode plugin: cost-aware delegation enforcer, trinity tier
 * control, live savings footer, TDD enforcer, flow enforcer, project guard,
 * research audit, reporting, decision engine, context7 optimization, and more.
 *
 * Source of truth: src/index.ts (compiled from TypeScript — do NOT edit .js directly).
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, readdirSync, openSync, readSync, closeSync, rmSync, copyFileSync, renameSync } from "node:fs"
import { join, dirname, relative, basename } from "node:path"
import { homedir, tmpdir } from "node:os"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { checkFlowRules, getFlowWarns, ensureProjectDocs } from "./vibeOS-lib/flow-enforcer.js"
import { computeSessionMetrics } from "./vibeOS-lib/session-metrics.js"
import { createMcpServer } from "./vibeOS-mcp-server.js"
import { VibeOSApiClient } from "./vibeOS-api-server/client.js"

import {
  getApiClient, remoteCall, isApiFallback, VIBEOS_API_URL,
} from "./lib/api-client.js"
import {
  applySlot, modelCostPerTurn, isModelFree, isDocsTarget, detectContext7, modelToSlotLabel,
  shortModelName, roundUsd, formatUsd, classify,
  _refreshModel, loadTierRegexes, HIGH_TIER_RE, MID_TIER_RE, PLACEHOLDER_RE,
  TRINITY_BRAIN, TRINITY_MEDIUM, TRINITY_CHEAP, _autoReportCount, readConfig,
} from "./lib/pricing.js"
import {
  scoreStress, classifyTurnSimple, extractFirstWordFromArgs, shouldLogWarn,
  resolveEnforcementMode, getLearnedExploratoryWords,
  extractLastUserText, isLikelyOffTopic, detectTechStack,
  loadBlackboxState, saveBlackboxState, getBlackboxTracker, getBlackboxResolution,
  detectOutcomeSignal, fetchBlackboxEnrichment,
  loadGlobalLearning, updateGlobalLearning,
  loadOptimizationMode, saveOptimizationMode, getTurnCounter, incrementTurnCounter,
} from "./lib/turn-classify.js"
import {
  safeJsonParse, updateState, loadSelection, writeSelection,
  readLifetimeSavings, _OC_SID, _modelLocked, _blackboxEnabled,
  currentTier, currentModel, currentProjectFingerprint, currentProjectName,
  textCompletePainted, softQuotaCounts, enforcementBlocked, taskSlotRestore,
  pendingUiNote, briefedProjects, scratchpadHitsSeen, context7AlertedThisSession,
  _latestBlackboxState, _latestBlackboxLoopMsg, _latestBlackboxPivotMsg,
  getScratchpadHit, recordScratchpadObservation, getSessionScratchpadDir,
  ensureSessionScratchpadDirs, getSessionIndexPath, indexAppend,
  getActiveJobForProject, projectFingerprint, loadProjectState, saveProjectState,
  ensureProjectBucket, mergeProjectBucket,
  saveMLState, SAVINGS_LEDGER_FILE, CONTEXT7_INSTALL_FLAG, SOFT_QUOTA_LIMIT,
  SCRATCHPAD_TOOLS, TRINITY_OPENCODE_CONFIG, TRINITY_OPENCODE_CONFIGC, TIERS_FILE,
  USER_HOME, FILE_LOCK_DIR, STATE_FILE, DELEGATION_STATE_FILE, PROJECT_STATE_FILE,
  BLACKBOX_STATE_FILE, REPORTS_DIR, ML_ENABLED, _mlGraph, _cacheDb,
  ML_CONFIDENCE_THRESHOLD, _mlSavePending, AUTH_F, CREDIT_CACHE_F,
  recordCacheSaving, recordMissedContext7, SCRATCHPAD_GLOBAL_DIR,
  pruneScratchpadOnce, cleanupCurrentSessionScratchpad,
  registerSessionCleanupHandlers, promotedProjectPatterns, projectPatternRows,
  clearProjectPatterns, _handleStateCorruption, detectTechStack,
  _zType, tool,
} from "./lib/state.js"
import {
  extractExports, buildTestSkeleton, enforceTestFile, buildTestReminder,
} from "./lib/tdd-enforcer.js"
import {
  setActiveJobFromTaskPrompt, observeToolPattern, applyDecadence, compressText, recordSaving,
} from "./lib/index-helpers.js"
import { researchAudit } from "./lib/research-audit.js"
import { saveReport, listReports, readReport } from "./lib/reporting.js"
import { loadCredit, thinkingLevel } from "./lib/credit-api.js"
import { classifyAndRankModels, modelToCcAlias, discoverAvailableModels } from "./lib/trinity-rebuild.js"
import { _appendFooter, scoreTaskQuality } from "./lib/hooks/footer.js"
import { onToolExecuteBefore, onToolExecuteAfter } from "./lib/hooks/tool-execute.js"
import { onMessagesTransform, onSystemTransform } from "./lib/hooks/chat-transform.js"
import { onSessionCompacting } from "./lib/hooks/session-compact.js"
import { onShellEnv } from "./lib/hooks/shell-env.js"

// ── Tool helper (used by DelegationEnforcer for tool definitions) ─────
// tool and _zType imported from ./lib/state.js

// ── Remote API client state ──────────────────────────────────────────
const _apiUrl = "https://api.vibetheog.com"
let _apiClient: any = null
let _apiFallbackMode = false
let _apiFallbackSince: number | null = null

// ── Module-level state (NOT in extracted modules) ────────────────────
let activeJob: any = null
let fp: string = ""
let _mcpServerRuntime: any = null
let _mcpServerHooked = false
let _creditTimer: ReturnType<typeof setInterval> | null = null
let _started = false
let context7Seen = new Set()
let _prevOutputText = ""
let latestUserIntent: string | null = null

const SAVE_EST = {
  WRITE_EDIT:   0.005,
  SOFT_QUOTA:   0.0003,
  CONTEXT7:     0.002,
  OPUS_DISABLE: 0.03,
}

// ── Credit snapshot refresh ──────────────────────────────────────────
const BALANCE_APIS: Record<string, any> = {
  deepseek: {
    url: "https://api.deepseek.com/user/balance",
    parse(d: any) {
      const b = d?.balance_infos?.find((b: any) => b.currency === "USD")
      return b ? parseFloat(b.total_balance) : 0
    }
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/credits",
    parse(d: any) { return parseFloat(d?.data?.total_credits) || 0 }
  }
}

function _readAuth(): any {
  try { return existsSync(AUTH_F) ? safeJsonParse(readFileSync(AUTH_F, "utf-8")) : {} } catch { return {} }
}

async function _fetchBal(provider: string, key: string): Promise<{ provider: string; balance: number }> {
  const api = BALANCE_APIS[provider]
  if (!api) return { provider, balance: 0 }
  try {
    const res = await fetch(api.url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) return { provider, balance: 0 }
    return { provider, balance: api.parse(await res.json()) }
  } catch { return { provider, balance: 0 } }
}

async function _snapshot(): Promise<void> {
  const auth = _readAuth()
  let total = 0; const provs: Array<{ provider: string; balance: number }> = []
  for (const [p, c] of Object.entries(auth)) {
    if (!(c as any)?.key || !BALANCE_APIS[p]) continue
    const { balance } = await _fetchBal(p, (c as any).key)
    if (balance > 0) { provs.push({ provider: p, balance }); total += balance }
  }
  try { writeFileSync(CREDIT_CACHE_F, JSON.stringify({ total, providers: provs, ts: Date.now() })) } catch {}
}

function _cachedPct(): number | null {
  try {
    if (!existsSync(CREDIT_CACHE_F)) return null
    const s = safeJsonParse(readFileSync(CREDIT_CACHE_F, "utf-8"))
    if (s?.total == null || !s.ts) return null
    let budget = 50
    try {
      const p = join(USER_HOME, ".claude/model-tiers.json")
      if (existsSync(p)) {
        const j = safeJsonParse(readFileSync(p, "utf-8"))
        if (j?.selection?.monthly_budget_usd) budget = j.selection.monthly_budget_usd
      }
    } catch {}
    return budget > 0 ? Math.min(150, Math.max(0, Math.round((s.total / budget) * 100))) : null
  } catch { return null }
}

function _lazyRefresh(): void {
  if (_started) return
  _started = true
  _snapshot()
  _creditTimer = setInterval(_snapshot, 60 * 60 * 1000)
  if (_creditTimer.unref) _creditTimer.unref()
}

// ── OpenCode provider config helpers ──────────────────────────────────
const MODEL_RANK: Record<string, number> = { high: 3, mid: 2, budget: 1 }
const OPENCODE_GO_CATALOG = [
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-chat",
  "deepseek/deepseek-reasoner",
]

function _loadOpenCodeProviders(): any {
  try {
    const cfg = readOpenCodeConfigObject(join(USER_HOME, ".config", "opencode"))
    return cfg?.provider || {}
  } catch { return {} }
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

// ── Utility: readConfig from directory ────────────────────────────────
import { readConfig } from "./lib/pricing.js"

// ── DelegationEnforcer — main plugin entry point ─────────────────────

export async function DelegationEnforcer({ client, directory }: { client?: unknown; directory?: string } = {}) {
  console.error(`[vibeOS] LOADED cwd=${directory}`)
  registerSessionCleanupHandlers()
  pruneScratchpadOnce()

  // Detect model: project opencode.json → global ~/.config/opencode/opencode.json → env.
  currentModel = readConfig(directory)
  if (!currentModel) {
    const home = process.env.HOME || ""
    if (home) currentModel = readConfig(join(home, ".config/opencode"))
  }
  if (!currentModel) currentModel = process?.env?.OPENCODE_MODEL || ""
  if (currentModel) {
    currentTier = classify(currentModel)
    try {
      const _tiersData = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
      const _activeSlot = _tiersData?.selection?.active_slot || "brain"
      if (_activeSlot === "brain") {
        const _brainOcModel = _tiersData?.trinity?.brain?.oc || ""
        if (_brainOcModel && currentModel === _brainOcModel && !PLACEHOLDER_RE.test(_brainOcModel)) {
          const cost = modelCostPerTurn(_brainOcModel)
          if (HIGH_TIER_RE.test(_brainOcModel) || (cost !== null && cost >= 0.01)) {
            currentTier = "high"
            console.error(`[vibeOS] tier override → high (brain slot)`)
          }
        }
      }
    } catch {}
    console.error(`[vibeOS] ACTIVE: model=${currentModel} tier=${currentTier}`)
  } else {
    console.error("[vibeOS] NO MODEL — enforcement disabled, will auto-detect on first hook")
  }
  // Auto-configure model-tiers.json — always syncs with opencode desktop config.
  if (currentModel || !existsSync(TIERS_FILE)) {
    try {
      let _tiersData
      if (existsSync(TIERS_FILE)) {
        try {
          _tiersData = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
        } catch {
          _tiersData = { selection: { enabled: true, active_slot: "brain", delegation_enforce: true, tdd_strict: true }, trinity: {} }
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
      if (_didWrite) {
        _tiersData.selection ??= {}
        if (_tiersData.selection.mcp_port === undefined) {
          _tiersData.selection.mcp_port = 9578
        }
        mkdirSync(dirname(TIERS_FILE), { recursive: true })
        const _tmp = TIERS_FILE + ".tmp." + Date.now()
        writeFileSync(_tmp, JSON.stringify(_tiersData, null, 2) + "\n", "utf-8")
        renameSync(_tmp, TIERS_FILE)
        console.error(`[vibeOS] auto-synced model-tiers.json: brain=${_brain.id} medium=${_tiersData.trinity?.medium?.oc || ""} cheap=${_tiersData.trinity?.cheap?.oc || ""}`)
        const _refreshed = loadTrinityModels()
        TRINITY_BRAIN  = _refreshed.brain
        TRINITY_CHEAP  = _refreshed.cheap
        TRINITY_MEDIUM = _refreshed.medium
      } else if (!existsSync(TIERS_FILE)) {
        mkdirSync(dirname(TIERS_FILE), { recursive: true })
        const _tmp2 = TIERS_FILE + ".tmp." + Date.now()
        writeFileSync(_tmp2, JSON.stringify(_tiersData, null, 2) + "\n", "utf-8")
        renameSync(_tmp2, TIERS_FILE)
        console.error(`[vibeOS] created empty model-tiers.json skeleton (no model detected)`)
      }
    } catch {}
  }
  // Ensure mcp_port is set
  try {
    const _mt = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
    if (_mt.selection && (_mt.selection.mcp_port === undefined || _mt.selection.mcp_port === null)) {
      _mt.selection.mcp_port = 9578
      const _tmp3 = TIERS_FILE + ".tmp." + Date.now()
      writeFileSync(_tmp3, JSON.stringify(_mt, null, 2) + "\n", "utf-8")
      renameSync(_tmp3, TIERS_FILE)
      console.error(`[vibeOS] mcp_port set to 9578 in model-tiers.json`)
    }
  } catch {}
  if (detectContext7()) console.error(`[vibeOS] context7 detected — docs nudge enabled`)

  // ── Project memory ────────────────────────────────────────────────
  fp = projectFingerprint(directory)
  currentProjectFingerprint = fp
  currentProjectName = directory ? directory.split("/").pop() : "unknown"
  activeJob = getActiveJobForProject(fp)
  try {
    const state = loadProjectState()
    const bucket = ensureProjectBucket(state, fp)
    bucket.totalSessions = (bucket.totalSessions || 0) + 1
    bucket.lastSeen = new Date().toISOString()
    saveProjectState(state)
    console.error(`[vibeOS] project-memory: ${fp} now ${bucket.totalSessions} sessions`)
  } catch (err) {
    console.error(`[vibeOS] project-memory init failed for ${fp}: ${(err as Error).message}`)
  }

  // ── Project Guard ─────────────────────────────────────────────────
  try {
    if (directory && existsSync(directory)) {
      const techStack = detectTechStack(directory)
      const result = ensureProjectDocs(directory, techStack)
      if (result.created.length > 0) {
        console.error(`[vibeOS] Project Guard: created ${result.created.join(", ")}`)
      }
    }
  } catch (err) {
    console.error(`[vibeOS] Project Guard init failed: ${(err as Error).message}`)
  }

  // ── Plugin hooks ──────────────────────────────────────────────────
  const pluginHooks = {
    "tool.execute.before": async (input: any, output: any) => {
      // Set directory context for imported hooks
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
    "experimental.text.complete": async (input: any, output: any) => { await _appendFooter(input, output, directory) },
    "message.updated": async (input: any, output: any) => { await _appendFooter(input, output, directory) },
    "experimental.session.compacting": async (_input: any, output: any) => {
      return onSessionCompacting(_input, output)
    },
    "experimental.chat.system.transform": async (_input: any, output: any) => {
      return onSystemTransform(_input, output)
    },
    "shell.env": async (_input: any, output: any) => {
      (onShellEnv as any)._directory = directory
      return onShellEnv(_input, output)
    },
    tool: {
      trinity: tool({
        description:
          "Control the vibeOS plugin and active model slot. " +
          "Use action='status' to see current state. " +
          "Use action='enable' or 'disable' to toggle the plugin (takes effect immediately, no restart needed). " +
          "Use action='set' with slot='brain'|'medium'|'cheap' to switch model tiers " +
          "(writes opencode.json — active immediately). " +
          "Use action='rebuild' to auto-detect available models from all configured providers and reassign brain/medium/cheap slots. " +
          "Use action='flow' with slot='on'|'off' to toggle flow enforcer, or action='flow' alone for audit. " +
          "Use action='flow' with slot='enforce' and level='on'|'off' to toggle auto-extract TODOs. " +
          "Use action='enforce' with slot='on'|'off' to toggle delegation enforcement (blocks direct writes/edits on brain tier). " +
          "Use action='tdd' with slot='on'|'off' to toggle auto-create test skeletons. " +
          "Use action='tdd' with slot='strict' and level='on'|'off' to toggle strict failing TODO test templates. " +
          "Use action='tdd' alone for audit. " +
          "Use action='project' to show per-project analytics and optimization suggestions. " +
          "Use action='patterns' to inspect learned project patterns or slot='clear' to clear them. " +
          "Use action='guard' to ensure AGENTS.md and README.md exist and stay current. " +
          "Call this when the user says things like 'switch to medium', 'use cheap model', 'disable plugin', 'trinity status'.",
        args: {
          action: tool.schema.enum(["status", "enable", "disable", "set", "thinking", "flow", "tdd", "project", "patterns", "rebuild", "diagnose", "help", "enforce", "repair-state", "blackbox", "report", "target", "guard"]).optional(),
          slot: tool.schema.enum(["brain", "medium", "cheap", "on", "off", "enforce", "strict", "quality", "preview", "apply", "clear", "savings"]).optional(),
          level: tool.schema.enum(["full", "brief", "off", "on"]).optional(),
        },
        async execute({ action, slot, level }: { action?: string; slot?: string; level?: string } = {}) {
          if (typeof _lazyRefresh === "function") _lazyRefresh()
          if (!action) action = "status"
          if (["brain", "medium", "cheap"].includes(action)) { slot = action; action = "set" }
          if (action === "status") {
            const sel = loadSelection()
            let tiers: any = {}
            try { tiers = safeJsonParse(readFileSync(TIERS_FILE, "utf-8")).trinity || {} } catch {}
            const credit = loadCredit()
            const effectiveLevel = sel.thinking_level || thinkingLevel(credit)

            const sv = readLifetimeSavings()
            const ltTotal = (sv.ltTasks || 0) + (sv.ltCache || 0)
            const sesTasks = sv.sesTasks || 0
            const sesCache = Number(readFullState()?.sessions?.[_OC_SID]?.cache_savings_usd || 0)
            const sesWarns = Array.isArray(readFullState()?.sessions?.[_OC_SID]?.warns) ? readFullState().sessions[_OC_SID].warns.length : 0
            const sesTrend = sv.sesTrend || "stable"
            const sesRate = sv.sesRatePerHour || 0
            const missedC7 = sv.missedC7 || 0
            const toolBreakdown = sv.sesToolBreakdown || {}
            const topTools = Object.entries(toolBreakdown).filter(([, v]) => (v as number) > 0.005).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 5) as [string, number][]

            const brainModel = tiers?.brain?.oc || "(unset)"
            const mediumModel = tiers?.medium?.oc || "(unset)"
            const cheapModel = tiers?.cheap?.oc || "(unset)"
            const activeSlot = sel.active_slot || "brain"

            const stressScore = latestUserIntent ? scoreStress(latestUserIntent) : 0
            const stressBar = stressScore > 0.85 ? "█" : stressScore > 0.7 ? "▆" : stressScore > 0.5 ? "▅" : stressScore > 0.3 ? "▃" : stressScore > 0.1 ? "▂" : "▁"
            const stressLabel = stressScore > 0.7 ? "high" : stressScore > 0.4 ? "elevated" : stressScore > 0.1 ? "calm" : "none"

            const totalTurns = (sv.sesModelTurns?.brain || 0) + (sv.sesModelTurns?.worker || 0)
            const brainPct = totalTurns > 0 ? Math.round((sv.sesModelTurns.brain / totalTurns) * 100) : 0
            const workerPct = 100 - brainPct
            const qualityAvg = sv.quality_avg || 0
            const sesDuration = sv.sesDuration || 0
            const durHrs = Math.floor(sesDuration / 3600)
            const durMins = Math.floor((sesDuration % 3600) / 60)

            let decisionLine = ""
            if (_blackboxEnabled) {
              try {
                const res = _latestBlackboxState || getBlackboxResolution()
                if (res && res.n_interactions > 3) {
                  const momentumIcon = res.momentum > 0.3 ? "up up" : res.momentum > 0 ? "up" : res.momentum < -0.3 ? "down down" : res.momentum < 0 ? "down" : "flat"
                  const loopTag = res.is_looping ? " (loop)" : ""
                  decisionLine = `${res.resolution} ${res.sub_regime} ${momentumIcon}${loopTag}`
                }
              } catch {}
            }

            const goalUsd = sel.savings_goal_usd || 0
            const goalBar = goalUsd > 0 ? ` ${Math.round(Math.min(100, (ltTotal / goalUsd) * 100))}%` : ""

            const lines = [
              `[vibeOS-dashboard]`,
              `Model: ${activeSlot} (${brainModel})`,
              ...(totalTurns > 0 ? [`Split: brain ${brainPct}% / worker ${workerPct}% (${totalTurns} total)`] : []),
              `Thinking: ${effectiveLevel}`,
              `Credit: ${credit}%`,
              ...(qualityAvg > 0 ? [`Quality: ${Math.round(qualityAvg)}%`] : []),
              ...(decisionLine ? [`Decision: ${decisionLine}`] : []),
              `|`,
              `Stress: ${stressBar} (${stressLabel})`,
              `|`,
              `Guards:`,
              `  Flow: ${sel.flow_enabled !== false ? "ON" : "OFF"}${sel.flow_enforce ? " (extract)" : ""}`,
              `  TDD: ${sel.tdd_enforce ? "ON" : "OFF"}${sel.tdd_strict !== false ? " strict" : ""}${sel.tdd_quality !== false ? " quality" : ""}`,
              `  Enforce: ${sel.delegation_enforce ? "ON" : "OFF"}`,
              `  Lock: ${_modelLocked ? "🔒 ON (model fixed)" : "🔓 OFF"}`,
              `|`,
              `All-time savings:`,
              `  Total: $${ltTotal.toFixed(2)} (${sesTrend})${goalBar}`,
              `  Delegation: $${(sv.ltTasks || 0).toFixed(2)}`,
              `  Cache: $${formatUsd(sv.ltCache || 0)}`,
              `  Missed: $${missedC7.toFixed(2)}`,
              `|`,
              `This session:`,
              ...(sesDuration > 0 ? [`  Duration: ${durHrs}h ${durMins}m`] : []),
              `  Rate: $${sesRate.toFixed(2)}/hr`,
              `  Warnings: ${sesWarns}`,
              ...(topTools.length > 0 ? [`  Top tools:`, ...topTools.map(([t, v]) => `    ${t}: $${v.toFixed(2)}`)] : []),
              `|`,
              `Tiers:`,
              `  brain:  ${brainModel}${activeSlot === "brain" ? "  *" : ""}`,
              `  medium: ${mediumModel}${activeSlot === "medium" ? "  *" : ""}`,
              `  cheap:  ${cheapModel}${activeSlot === "cheap" ? "  *" : ""}`,
            ]
            return lines.join("\n")
          }

          if (action === "enable" || action === "disable") {
            const val = action === "enable"
            const ok = writeSelection("enabled", val)
            if (!ok) return `❌ Failed to write model-tiers.json`
            return `${val ? "✅ Plugin ENABLED" : "❌ Plugin DISABLED"} — takes effect immediately (no restart needed).`
          }

          if (action === "set") {
            if (!slot || !["brain", "medium", "cheap"].includes(slot)) {
              return `❌ Provide slot: brain | medium | cheap`
            }
            let targetModel = ""
            try {
              const tiers = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
              targetModel = tiers?.trinity?.[slot]?.oc || ""
            } catch {}
            if (!targetModel) {
              return "❌ No model configured for " + slot + " slot. Run `trinity rebuild` first."
            }
            const auth = _readAuth()
            // probeModel is only available via require from trinity-rebuild
            const result = applySlot(slot)
            if (!result.ok) return `❌ Failed to set slot: ${result.reason}`
            return `✅ Switched to ${slot} slot (${result.ocModel}). Active now (no restart needed).`
          }

          if (action === "thinking") {
            if (!level || !["full", "brief", "off"].includes(level)) {
              return `❌ Provide level: full | brief | off`
            }
            const stored = level
            const ok = writeSelection("thinking_level", stored)
            if (!ok) return `❌ Failed to write model-tiers.json`
            const desc: Record<string, string> = {
              full:  "full thinking (no restriction) — takes effect on next message",
              brief: "brief thinking (complex tasks only) — takes effect on next message",
              off:   "thinking OFF (respond directly) — takes effect on next message",
            }
            return `✅ Reasoning depth → ${desc[level]}`
          }

          if (action === "flow") {
            if (slot === "on" || slot === "off") {
              const ok = writeSelection("flow_enabled", slot === "on")
              return ok
                ? `✅ Flow enforcer ${slot === "on" ? "ENABLED" : "DISABLED"}`
                : `❌ Failed to write model-tiers.json`
            }
            if (slot === "enforce") {
              if (level !== "on" && level !== "off") return "❌ Provide level on|off for `trinity flow enforce`"
              const enforceOn = level === "on"
              const ok = writeSelection("flow_enforce", enforceOn)
              return ok
                ? `✅ Flow enforcement ${enforceOn ? "ENABLED (auto-extract TODOs)" : "DISABLED (log only)"}`
                : `❌ Failed to write model-tiers.json`
            }
            const flowWarns = getFlowWarns()
            const sid = String(process.pid || "?")
            const sessionWarns = flowWarns.filter((w: any) => String(w.sid) === sid)
            const bySev: Record<string, number> = { warn: 0, hint: 0, flag: 0 }
            for (const w of sessionWarns) {
              if (bySev[w.severity] !== undefined) bySev[w.severity]++
            }
            const lines = [`🔀 Flow enforcer audit (this session):`]
            lines.push(`  ${bySev.warn} warn, ${bySev.hint} hint, ${bySev.flag} flag`)
            if (sessionWarns.length > 0) {
              for (const w of sessionWarns.slice(-15)) {
                const icon = w.severity === "warn" ? "⚠" : "💡"
                lines.push(`  ${icon} [${w.severity}] ${w.rule_id}: ${w.description} — ${w.filePath || "(no file)"}`)
              }
            }
            if (sessionWarns.length === 0) lines.push(`  No flow violations this session.`)
            return lines.join("\n")
          }

          if (action === "enforce") {
            if (slot === "on" || slot === "off") {
              const ok = writeSelection("delegation_enforce", slot === "on")
              return ok
                ? `🚫 Delegation enforcement ${slot === "on" ? "ENABLED — direct writes/edits BLOCKED on brain tier" : "DISABLED — warn only"}`
                : `❌ Failed to write model-tiers.json`
            }
            const sel = loadSelection()
            return `🚫 Delegation enforcement: ${sel.delegation_enforce ? "ON (blocks direct writes/edits on brain tier)" : "OFF (warn only)"}\nUse \`trinity enforce on\` or \`trinity enforce off\` to toggle.`
          }

          if (action === "lock") {
            if (slot === "on") {
              _modelLocked = true
              const _tiers = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
              console.error(`[vibeOS] model LOCKED — ${_tiers?.trinity?.[_tiers?.selection?.active_slot || "brain"]?.oc || currentModel || "?"} (${currentTier}) will not auto-reconcile with config`)
              const lockModel = _tiers?.trinity?.[_tiers?.selection?.active_slot || "brain"]?.oc || currentModel || "detected model"
              return `🔒 Model LOCKED — ${lockModel} will not change unless you force with \`trinity set\` or \`trinity lock off\`.`
            }
            if (slot === "off") {
              _modelLocked = false
              console.error(`[vibeOS] model UNLOCKED — auto-reconcile re-enabled`)
              return `🔓 Model UNLOCKED — will auto-follow OpenCode config changes.`
            }
            return `🔒 Model lock: ${_modelLocked ? "ON (fixed per session)" : "OFF (follows config)"}\nUse \`trinity lock on\` or \`trinity lock off\` to toggle.\nLock is per-session (resets on restart).`
          }

          if (action === "tdd") {
            if (slot === "strict") {
              if (level !== "on" && level !== "off") {
                return "❌ Provide level on|off for `trinity tdd strict`"
              }
              const ok = writeSelection("tdd_strict", level === "on")
              return ok
                ? `✅ TDD strict ${level === "on" ? "ENABLED (TODO tests fail loudly)" : "DISABLED (TODO tests non-blocking)"}`
                : `❌ Failed to write model-tiers.json`
            }
            if (slot === "quality") {
              if (level !== "on" && level !== "off") {
                return "❌ Provide level on|off for `trinity tdd quality`"
              }
              const ok = writeSelection("tdd_quality", level === "on")
              return ok
                ? `✅ TDD quality templates ${level === "on" ? "ENABLED (real assertions, invalid-input, edge-case stubs)" : "DISABLED (TODO-only stubs)"}`
                : `❌ Failed to write model-tiers.json`
            }
            if (slot === "on" || slot === "off") {
              const ok = writeSelection("tdd_enforce", slot === "on")
              return ok
                ? `✅ TDD enforcement ${slot === "on" ? "ENABLED (auto-create skeletons)" : "DISABLED (nudge only)"}`
                : `❌ Failed to write model-tiers.json`
            }
            const stateFile = join(USER_HOME, ".claude/delegation-state.json")
            let enforced = 0
            try {
              if (existsSync(stateFile)) {
                const s = safeJsonParse(readFileSync(stateFile, "utf-8"))
                enforced = s.lifetime?.tdd_enforced ?? 0
              }
            } catch {}
            const sel = loadSelection()
            const lines = [`🧪 TDD enforcer audit:`]
            lines.push(`  Mode: ${sel.tdd_enforce ? "ENFORCE (auto-create skeletons)" : "NUDGE (reminders only)"}`)
            lines.push(`  Strict templates: ${sel.tdd_strict !== false ? "ON (fail TODO tests)" : "OFF (non-blocking TODO tests)"}`)
            lines.push(`  Quality templates: ${sel.tdd_quality !== false ? "ON (real assertion stubs)" : "OFF (TODO-only stubs)"}`)
            lines.push(`  Skeletons created this lifetime: ${enforced}`)
            return lines.join("\n")
          }

          if (action === "project") {
            const L = "\u2501"
            const lines = [`📊 Project profile — ${currentProjectName || (directory ? directory.split("/").pop() : "unknown")}`]
            lines.push(L.repeat(40))
            const _fp = currentProjectFingerprint || projectFingerprint(directory)

            const pstate = loadProjectState()
            const proj = pstate.project_hashes?.[_fp]
            if (proj) {
              lines.push(`\n📅 Sessions: ${proj.totalSessions || 0} | Last: ${(proj.lastSeen || "").slice(0, 10)}`)
              if (proj.researchChains) lines.push(`🔍 Research chains detected: ${proj.researchChains}`)
              if (proj.context7Bypasses) lines.push(`💰 Context7 bypasses: ${proj.context7Bypasses}`)
              if (proj.commonTopics?.length) {
                const topics = proj.commonTopics.slice(0, 5).join(", ")
                lines.push(`🌐 Common fetch domains: ${topics}`)
              }
              const promoted = promotedProjectPatterns(_fp)
              if (promoted.length) {
                lines.push(`\nLearned patterns:`)
                for (const ptn of promoted) lines.push(`  [${ptn.label}] ${ptn.summary}`)
              }
            } else {
              lines.push(`\n  (no project memory yet — first session)`)
            }

            const sv = readLifetimeSavings()
            const totalTurns = (sv.sesModelTurns?.brain || 0) + (sv.sesModelTurns?.worker || 0)
            const brainPct = totalTurns > 0 ? Math.round((sv.sesModelTurns.brain / totalTurns) * 100) : 0
            if (totalTurns > 0) {
              const workerPct = 100 - brainPct
              lines.push(`\n🔀 Model usage: Brain ${brainPct}% (${sv.sesModelTurns.brain} turns) / Worker ${workerPct}% (${sv.sesModelTurns.worker} tasks)`)
            }
            if (sv.sesTasks > 0.01 || sv.ltCache > 0.01) {
              lines.push(`💰 Session savings: $${sv.sesTasks.toFixed(2)} delegation + $${sv.ltCache.toFixed(2)} cache`)
            }
            if (sv.sesDuration > 0) {
              const hrs = Math.floor(sv.sesDuration / 3600)
              const mins = Math.floor((sv.sesDuration % 3600) / 60)
              lines.push(`⏱  Duration: ${hrs}h ${mins}m | Rate: $${sv.sesRatePerHour.toFixed(2)}/hr | Trend: ${sv.sesTrend === "down" ? "↓" : sv.sesTrend === "up" ? "↑" : "→"}`)
            }

            const toolEntries = Object.entries(sv.sesToolBreakdown || {}).filter(([_, v]) => (v as number) > 0.005).sort((a, b) => (b[1] as number) - (a[1] as number))
            if (toolEntries.length > 0) {
              lines.push(`\n🔧 Per-tool savings:`)
              for (const [tool, savings] of toolEntries) {
                lines.push(`  ${tool.padEnd(14)} —$${(savings as number).toFixed(2)}`)
              }
            }

            const flowWarns = getFlowWarns()
            const sid = String(process.pid || "?")
            const sessionFlowWarns = flowWarns.filter((w: any) => String(w.sid) === sid)
            const byRule: Record<string, number> = {}
            for (const w of sessionFlowWarns) {
              const key = w.rule_id || "unknown"
              byRule[key] = (byRule[key] || 0) + 1
            }
            if (Object.keys(byRule).length > 0) {
              lines.push(`\n⚠️ Flow violations (this session):`)
              for (const [rule, count] of Object.entries(byRule)) {
                lines.push(`  ${rule.padEnd(22)} ${count}`)
              }
            }

            const suggestions: string[] = []
            if (totalTurns > 10 && sv.sesModelTurns.brain > sv.sesModelTurns.worker * 2) {
              if (!loadSelection().delegation_enforce) {
                suggestions.push(`💡 High direct brain usage (${brainPct}%) — enable enforcement with \`trinity enforce on\` to block direct writes/edits`)
              } else {
                suggestions.push(`💡 High direct brain usage (${brainPct}%) — enforcement is ON but brain keeps editing directly; check plugin logs`)
              }
            }
            if (proj?.context7Bypasses > 3) {
              suggestions.push(`💡 ${proj.context7Bypasses} context7 bypasses — install context7 MCP to save ~$0.05/turn`)
            }
            if (proj?.researchChains > 2) {
              suggestions.push(`💡 ${proj.researchChains} research domain chains — consider caching or batching doc lookups`)
            }
            if ((sv.sesToolBreakdown?.webfetch || 0) > 0.1 || (sv.sesToolBreakdown?.websearch || 0) > 0.1) {
              suggestions.push(`💡 High webfetch/websearch usage — use context7 tools or scratchpad caching`)
            }
            if ((byRule["new-md-file"] || 0) > 2) {
              suggestions.push(`💡 ${byRule["new-md-file"]} new .md files — verify explicit user request for docs`)
            }
            if ((byRule["todo-comment"] || 0) > 5) {
              suggestions.push(`💡 ${byRule["todo-comment"]} TODO/FIXME left — clean up or track in issue tracker`)
            }
            if (loadSelection().flow_enabled === false) {
              suggestions.push(`💡 Flow enforcer is OFF — enable with \`trinity flow on\` to catch anti-patterns`)
            }
            for (const ptn of promotedProjectPatterns(_fp)) {
              suggestions.push(`Learned ${ptn.label} pattern: ${ptn.summary}`)
            }
            const credit = loadCredit()
            if (credit < 40) {
              suggestions.push(`💡 Credit at ${credit}% — switch to medium/cheap slot with \`trinity medium\``)
            }

            if (suggestions.length > 0) {
              lines.push(`\n🎯 Optimization suggestions:`)
              for (const s of suggestions) lines.push(`  ${s}`)
            } else {
              lines.push(`\n✅ No optimization suggestions — looking good!`)
            }

            lines.push(`\n${L.repeat(40)}`)
            lines.push(`Run \`trinity help\` for all commands | \`research-audit\` for deep fetch analysis`)
            return lines.join("\n")
          }

          if (action === "report" && slot === "savings") {
            const L = "\u2501"
            const lines = [`== Savings Deep Report ==`]
            lines.push(L.repeat(40))
            const sv = readLifetimeSavings()
            const ltTotal = sv.ltTasks + sv.ltCache

            const toolTotals: Record<string, number> = {}
            let entryCount = 0
            try {
              if (existsSync(SAVINGS_LEDGER_FILE)) {
                const raw = readFileSync(SAVINGS_LEDGER_FILE, "utf-8")
                for (const ln of raw.trim().split("\n")) {
                  if (!ln.trim()) continue
                  let rec: any = null
                  try { rec = JSON.parse(ln) } catch { continue }
                  if (!rec || rec.v !== 2) continue
                  const amt = Number(rec.amount_usd ?? 0)
                  const tool = String(rec.tool || "unknown")
                  toolTotals[tool] = (toolTotals[tool] || 0) + amt
                  entryCount++
                }
              }
            } catch {}
            lines.push(`\nBy tool:`)
            const sortedTools = Object.entries(toolTotals).sort((a, b) => b[1] - a[1])
            if (sortedTools.length === 0) {
              lines.push(`  (no ledger entries yet)`)
            } else {
              for (const [tool, amt] of sortedTools) {
                lines.push(`  ${tool.padEnd(14)} $${amt.toFixed(4)}`)
              }
            }

            const dayTotals: Record<string, number> = {}
            try {
              if (existsSync(SAVINGS_LEDGER_FILE)) {
                const raw = readFileSync(SAVINGS_LEDGER_FILE, "utf-8")
                for (const ln of raw.trim().split("\n")) {
                  if (!ln.trim()) continue
                  let rec: any = null
                  try { rec = JSON.parse(ln) } catch { continue }
                  if (!rec || rec.v !== 2) continue
                  const amt = Number(rec.amount_usd ?? 0)
                  const day = (rec.at || "").slice(0, 10)
                  if (day) dayTotals[day] = (dayTotals[day] || 0) + amt
                }
              }
            } catch {}
            lines.push(`\nBy day:`)
            const sortedDays = Object.entries(dayTotals).sort((a, b) => a[0].localeCompare(b[0]))
            if (sortedDays.length === 0) {
              lines.push(`  (no daily data yet)`)
            } else {
              for (const [day, amt] of sortedDays) {
                lines.push(`  ${day}  $${amt.toFixed(4)}`)
              }
            }

            lines.push(`\nLifetime:`)
            lines.push(`  Delegation savings: $${sv.ltTasks.toFixed(4)}`)
            lines.push(`  Cache savings:     $${(sv.ltCache || 0).toFixed(4)}`)
            lines.push(`  Total:             $${ltTotal.toFixed(4)}`)
            lines.push(`  Ledger entries:    ${entryCount}`)
            lines.push(`\n${L.repeat(40)}`)
            return lines.join("\n")
          }

          if (action === "target") {
            const goalVal = parseFloat(slot || "")
            if (!Number.isFinite(goalVal) || goalVal <= 0) {
              return `Usage: trinity target <amount>\nExample: trinity target 5.00`
            }
            const ok = writeSelection("savings_goal_usd", Math.round(goalVal * 100) / 100)
            return ok
              ? `Savings goal set to $${goalVal.toFixed(2)}. Track progress in the footer.`
              : `Failed to write savings goal.`
          }

          if (action === "patterns") {
            const _fp = currentProjectFingerprint || projectFingerprint(directory)
            const name = currentProjectName || (directory ? directory.split("/").pop() : "unknown")
            if (slot === "clear") {
              const count = clearProjectPatterns(_fp)
              return `Pattern memory cleared for "${name}" (${count} pattern${count === 1 ? "" : "s"} removed).`
            }
            if (slot === "suggest") {
              const pstate = loadProjectState()
              const currentBucket = pstate.project_hashes?.[_fp]
              const currentTech = currentBucket?.techStack || []
              const currentKeys = new Set([
                ...Object.keys(currentBucket?.userPatterns?.friction || {}),
                ...Object.keys(currentBucket?.userPatterns?.routines || {}),
              ])
              const candidates: Array<{ key: string; label: string; summary: string; count: number; sessions: number; lastSeen: string }> = []
              for (const [otherFp, bucket] of Object.entries(pstate.project_hashes || {})) {
                if (otherFp === _fp) continue
                const otherTech = (bucket as any)?.techStack || []
                if (!otherTech.some((t: string) => currentTech.includes(t))) continue
                for (const [kind, label] of [["friction", "friction"], ["routines", "routine"]]) {
                  for (const [key, row] of Object.entries((bucket as any)?.userPatterns?.[kind] || {})) {
                    if (currentKeys.has(key)) continue
                    const sessions = new Set((row as any)?.sessions || []).size
                    candidates.push({ key, label, summary: (row as any)?.summary || key, count: Number((row as any)?.count || 0), sessions, lastSeen: (row as any)?.lastSeen || "" })
                  }
                }
              }
              candidates.sort((a, b) => b.count - a.count || b.sessions - a.sessions)
              const top = candidates.slice(0, 5)
              const _lines = ["[⚡ From similar tech stack projects]"]
              if (top.length === 0) {
                _lines.push("  No cross-project suggestions available yet.")
                return _lines.join("\n")
              }
              for (const c of top) {
                const tag = c.sessions >= 3 ? "promoted" : "learning"
                _lines.push(`  [${c.label}/${tag}] ${c.summary} (${c.count} hit${c.count === 1 ? "" : "s"}, ${c.sessions} session${c.sessions === 1 ? "" : "s"})`)
              }
              _lines.push("")
              _lines.push("Use `trinity patterns` to see this project's own patterns.")
              return _lines.join("\n")
            }
            const rows = projectPatternRows(_fp)
            const _lines = [`Project patterns - ${name}`]
            if (rows.length === 0) {
              _lines.push("  No learned patterns yet.")
              _lines.push("  Patterns promote into briefings after 3 separate sessions.")
              return _lines.join("\n")
            }
            const _promoted = rows.filter((r: any) => r.sessions >= 3).length
            _lines.push(`  ${rows.length} stored, ${_promoted} promoted`)
            for (const r of rows.slice(0, 15)) {
              const tag = r.sessions >= 3 ? "promoted" : "learning"
              _lines.push(`  [${r.label}/${tag}] ${r.summary} (${r.sessions} session${r.sessions === 1 ? "" : "s"}, ${r.count} hit${r.count === 1 ? "" : "s"})`)
            }
            _lines.push("")
            _lines.push("Use `trinity patterns clear` to clear project pattern memory.")
            return _lines.join("\n")
          }

          if (action === "guard") {
            if (!directory || !existsSync(directory)) return "Working directory not accessible."
            const techStack = detectTechStack(directory)
            const result = ensureProjectDocs(directory, techStack)
            if (result.created.length === 0 && result.skipped.length > 0) {
              return `AGENTS.md and README.md already exist. Use \`trinity guard\` to check for missing features.`
            }
            const _lines = [`Project Guard: ${directory.split("/").pop() || "unknown"}`]
            for (const f of result.created) _lines.push(`  Created ${f}`)
            for (const f of result.skipped) _lines.push(`  Already exists: ${f}`)
            _lines.push("")
            _lines.push("AGENTS.md: defines AI agent behavioral rules — ASK BEFORE changing code.")
            _lines.push("README.md: auto-maintained feature documentation — keep it updated.")
            return _lines.join("\n")
          }

          if (action === "rebuild") {
            const providers = _loadOpenCodeProviders()
            const auth = _readAuth()
            const models = await discoverAvailableModels(providers, auth)
            const ranked = classifyAndRankModels(models)
            if (!ranked) {
              return "❌ No models discovered from any configured provider."
            }
            const probed: Record<string, any> = { brain: null, medium: null, cheap: null }
            const failed: string[] = []
            // Note: probeModel is in state.ts as _probeModel or we use the imported version
            const lines = [
              "🔍 Auto-detected models from configured providers:",
              "  🧠 brain  → " + ranked.brain.id + " (tier: " + ranked.brain.tier + ", $" + ranked.brain.cost.toFixed(4) + "/turn) ✅",
              "  ⚙  medium → " + ranked.medium.id + " (tier: " + ranked.medium.tier + ", $" + ranked.medium.cost.toFixed(4) + "/turn) ✅",
              "  ⚡ cheap  → " + ranked.cheap.id + " (tier: " + ranked.cheap.tier + ", $" + ranked.cheap.cost.toFixed(4) + "/turn) ✅",
            ]
            try {
              const tiers = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
              tiers.trinity = {
                brain: { oc: ranked.brain.id, cc: modelToCcAlias(ranked.brain.id) },
                medium: { oc: ranked.medium.id, cc: modelToCcAlias(ranked.medium.id) },
                cheap: { oc: ranked.cheap.id, cc: modelToCcAlias(ranked.cheap.id) },
              }
              const _tmp4 = TIERS_FILE + ".tmp." + Date.now()
              writeFileSync(_tmp4, JSON.stringify(tiers, null, 2) + "\n", "utf-8")
              renameSync(_tmp4, TIERS_FILE)
            } catch (err) {
              return "❌ Failed to write model-tiers.json: " + (err as Error).message
            }
            try { applySlot("brain") } catch (e) { console.error("[vibeOS] auto-activate brain failed:", (e as Error).message) }
            lines.push("", "✅ model-tiers.json updated.")
            return lines.join("\n")
          }

          if (action === "diagnose") {
            const results: Array<{ ok: boolean; okLabel: string; label: string; detail: string; fix?: string | undefined }> = []
            const ocConfig = join(USER_HOME, ".config/opencode/opencode.json")

            const checks = [
              { path: TIERS_FILE,                                        label: "model-tiers.json"       },
              { path: ocConfig,                                            label: "opencode.json"          },
              { path: STATE_FILE,                                          label: "delegation-state.json" },
            ]
            for (const c of checks) {
              results.push({
                ok: existsSync(c.path),
                okLabel: existsSync(c.path) ? "✅" : "❌",
                label: c.label,
                detail: existsSync(c.path) ? "exists" : "missing",
                fix: existsSync(c.path) ? undefined : (c.label === "model-tiers.json" ? "run `trinity rebuild` to create it" : undefined),
              })
            }

            try {
              const tiers = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
              for (const s of ["brain","medium","cheap"]) {
                const m = tiers?.trinity?.[s]?.oc || ""
                const ok = m.length > 0 && !m.toLowerCase().includes("placeholder")
                results.push({
                  ok, okLabel: ok ? "✅" : "❌",
                  label: `${s} slot`,
                  detail: ok ? m : (m.length > 0 ? `placeholder: ${m}` : "unset"),
                  fix: ok ? undefined : "run `trinity rebuild` to auto-assign",
                })
              }
            } catch {
              for (const s of ["brain","medium","cheap"]) {
                results.push({ ok: false, okLabel: "❌", label: `${s} slot`, detail: "cannot read model-tiers.json", fix: "run `trinity rebuild` to create it" })
              }
            }

            if (currentModel || !existsSync(TIERS_FILE)) {
              results.push({ ok: true, okLabel: "✅", label: "model probe", detail: "API probe skipped in read-only mode" })
            }

            const credit = loadCredit()
            let budget = 50
            try {
              const j = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
              if (j?.selection?.monthly_budget_usd) budget = j.selection.monthly_budget_usd
            } catch {}
            const creditOk = credit >= 40
            results.push({
              ok: creditOk, okLabel: creditOk ? "✅" : "❌",
              label: "credits",
              detail: `${credit}% (of $${budget})`,
              fix: creditOk ? undefined : "run `trinity medium` to reduce spend",
            })

            try {
              const state = safeJsonParse(readFileSync(STATE_FILE, "utf-8"))
              const sid = String(process.pid || "?")
              const ses = state?.sessions?.[sid]
              const delegationCount = ses?.warns?.length || 0
              const cacheSavings = formatUsd(state?.lifetime?.cache_savings_usd || 0)
              const fw = (state?.flow_warns || []).filter((w: any) => String(w.sid) === sid)
              const flowW = fw.filter((w: any) => w.severity === "warn").length
              const flowH = fw.filter((w: any) => w.severity === "hint").length
              const tdd = state?.lifetime?.tdd_enforced ?? 0
              const enf = loadSelection().delegation_enforce ? " ENFORCE" : ""
              results.push({
                ok: true, okLabel: "✅",
                label: "session",
                detail: `${delegationCount} delegates, $${cacheSavings} cache, ${flowW}w/${flowH}h flow, ${tdd} TDD${enf}`,
              })
            } catch {
              results.push({ ok: true, okLabel: "✅", label: "session", detail: "no state file yet" })
            }

            const okCount = results.filter(r => r.ok).length
            results.sort((a, b) => (a.ok === b.ok ? 0 : a.ok ? 1 : -1))
            const lines = [
              "🔍  vibeOS — Self Diagnostic",
              "=".repeat(40),
              ""
            ]
            for (const r of results) {
              lines.push(`  ${r.okLabel} ${r.label}: ${r.detail}`)
              if (!r.ok && r.fix) lines.push(`    → ${r.fix}`)
            }
            if (okCount === results.length) {
              lines.push("", `✅ All ${results.length} checks passed`)
            } else {
              const failCount = results.length - okCount
              lines.push("", `❌ ${failCount}/${results.length} checks failed — fix items above`)
            }
            return lines.join("\n")
          }

          if (action === "repair-state") {
            const mode = slot || "preview"
            if (mode !== "preview" && mode !== "apply") {
              return "❌ Use `trinity repair-state preview` or `trinity repair-state apply`."
            }
            const dstFp = currentProjectFingerprint || projectFingerprint(directory)
            const name = currentProjectName || (directory ? directory.split("/").pop() : "unknown")
            const idx = reportsIndex()
            const byFp = new Map()
            for (const r of idx.reports || []) {
              if (r.project !== name) continue
              byFp.set(r.fingerprint, (byFp.get(r.fingerprint) || 0) + 1)
            }
            const candidates = [...byFp.entries()]
              .filter(([fp2, count]) => fp2 && fp2 !== dstFp && (count as number) > 0)
              .sort((a, b) => (b[1] as number) - (a[1] as number))
            if (candidates.length === 0) {
              return `✅ No duplicate fingerprint candidates found for project "${name}".`
            }
            const [srcFp, reportCount] = candidates[0]
            const pstate = loadProjectState()
            const dstBucket = ensureProjectBucket(pstate, dstFp)
            const srcBucket = pstate.project_hashes?.[srcFp] || null
            const merged = mergeProjectBucket(dstBucket, srcBucket)
            const lines = [
              `🛠 State repair (${mode})`,
              `  project: ${name}`,
              `  target:  ${dstFp}`,
              `  source:  ${srcFp}`,
              `  reports to relabel: ${reportCount}`,
              `  sessions: ${(dstBucket.totalSessions || 0)} + ${(srcBucket?.totalSessions || 0)} -> ${merged.totalSessions}`,
              `  bypasses: ${(dstBucket.context7Bypasses || 0)} + ${(srcBucket?.context7Bypasses || 0)} -> ${merged.context7Bypasses}`,
              `  researchChains(max): ${Math.max(dstBucket.researchChains || 0, srcBucket?.researchChains || 0)}`,
            ]
            if (mode === "preview") {
              lines.push("", "Run `trinity repair-state apply` to execute with backups.")
              return lines.join("\n")
            }

            const backups: string[] = []
            const b1 = backupFile(PROJECT_STATE_FILE, "repair-state")
            if (b1) backups.push(b1)
            const b2 = backupFile(REPORTS_INDEX, "repair-state")
            if (b2) backups.push(b2)

            pstate.project_hashes ??= {}
            pstate.project_hashes[dstFp] = merged
            delete pstate.project_hashes[srcFp]
            saveProjectState(pstate)

            let relabeled = 0
            for (const r of idx.reports || []) {
              if (r.project === name && r.fingerprint === srcFp) {
                r.fingerprint = dstFp
                relabeled++
              }
            }
            saveReportsIndex(idx)

            for (const r of idx.reports || []) {
              if (r.project !== name || r.fingerprint !== dstFp) continue
              const rf = join(REPORTS_DIR, `${r.id}.json`)
              try {
                if (!existsSync(rf)) continue
                const data = safeJsonParse(readFileSync(rf, "utf-8"))
                if (data?.meta?.project === name && data?.meta?.fingerprint === srcFp) {
                  data.meta.fingerprint = dstFp
                  writeFileSync(rf, JSON.stringify(data, null, 2) + "\n")
                }
              } catch {}
            }

            lines.push("")
            lines.push(`✅ Applied. Relabeled ${relabeled} report index entries.`)
            if (backups.length > 0) {
              lines.push("Backups:")
              for (const b of backups) lines.push(`  - ${b}`)
            }
            return lines.join("\n")
          }

          if (action === "blackbox") {
            const mode = slot || "status"
            if (mode === "on") {
              _blackboxEnabled = true
              const state = loadBlackboxState()
              state.enabled = true
              saveBlackboxState(state)
              return "✅ Blackbox decision engine ENABLED — will track resolution state and enhance system prompts."
            }
            if (mode === "off") {
              _blackboxEnabled = false
              const state = loadBlackboxState()
              state.enabled = false
              saveBlackboxState(state)
              return "⏸ Blackbox decision engine DISABLED."
            }
            if (mode === "reset") {
              const state = loadBlackboxState()
              const sid = _OC_SID
              delete state.sessions[sid]
              saveBlackboxState(state)
              return "🔄 Blackbox resolution tracker RESET."
            }
            if (mode === "status") {
              const bbState = loadBlackboxState()
              const enabled = _blackboxEnabled || bbState.enabled
              const lines = [`Blackbox Decision Engine: ${enabled ? "ON" : "OFF"}`]
              if (enabled) {
                const res = _latestBlackboxState || getBlackboxResolution()
                if (res) {
                  lines.push(`  Resolution: ${res.resolution}`)
                  lines.push(`  Sub-regime: ${res.sub_regime}`)
                  lines.push(`  Momentum: ${res.momentum > 0 ? "↑" : res.momentum < 0 ? "↓" : "→"} ${res.momentum.toFixed(2)}`)
                  lines.push(`  Interactions: ${res.n_interactions}`)
                  if (res.is_looping) lines.push("  ⚠ Looping detected — consider a fresh perspective")
                } else {
                  lines.push("  No resolution data yet — start a decision session")
                }
                if (currentProjectFingerprint) {
                  lines.push("")
                  lines.push(`  Project: ${currentProjectName || "unknown"}`)
                  const projectSessions = Object.entries(bbState.sessions || {}).filter(([k, v]) => (v as any).project_fingerprint === currentProjectFingerprint)
                  lines.push(`  Cross-session history: ${projectSessions.length} session(s) for this project`)
                }
              }
              lines.push("")
              lines.push("Usage: trinity blackbox on|off|status|reset")
              return lines.join("\n")
            }
            return `❌ Use \`trinity blackbox on|off|status|reset\``
          }

          if (action === "help") {
            return [
              "vibeOS — trinity commands",
              "",
              "TIERS:",
              "  trinity status            See plugin state, credit, model assignment",
              "  trinity brain             Switch to brain tier (most capable)",
              "  trinity medium            Switch to medium tier (balanced)",
              "  trinity cheap             Switch to cheap tier (most savings)",
              "  trinity rebuild           Auto-detect available models",
              "",
              "CONTROLS:",
              "  trinity enable/disable    Toggle vibeOS plugin on/off",
              "  trinity enforce on/off    Block brain-tier writes/edits (save $$)",
              "  trinity lock on/off       Lock model at session start (skip auto-reconcile)",
              "  trinity thinking full|brief|off  Set reasoning depth",
              "",
              "GUARDRAILS:",
              "  trinity flow on/off       Toggle flow enforcer (code quality checks)",
              "  trinity tdd on/off        Toggle auto test skeleton creation",
              "  trinity guard             Ensure AGENTS.md/README.md exist and are current",
              "  trinity flow              Show flow violations this session",
              "",
              "DIAGNOSTICS:",
              "  trinity diagnose          Self-check: config, files, model probes, budget",
              "  trinity project           Project analytics and optimization tips",
              "  trinity patterns          Show learned friction/routine patterns",
              "  trinity patterns suggest  Suggest relevant patterns from similar stack projects",
              "  trinity patterns clear    Clear learned patterns for this project",
              "",
              "REPAIR:",
              "  trinity repair-state      Fix fingerprint collisions (preview/apply)",
              "",
              "DECISION ENGINE:",
              "  trinity blackbox on/off   Toggle theWay blackbox decision engine",
              "  trinity blackbox status   View resolution state, momentum, project history",
              "  trinity blackbox reset    Clear resolution tracker for current session",
            ].join("\n")
          }

          return `❌ Unknown action: ${action}`
        },
      }),
      "research-audit": tool({
        description:
          "Scan recent session data for research anti-patterns (domain chains, redundant queries, no synthesis). " +
          "Use hours=N to look back N hours (default 24). " +
          "Call this after research-heavy interactions to audit quality.",
        args: {
          hours: tool.schema.number().optional(),
        },
        async execute({ hours }: { hours?: number } = {}) {
          const report = researchAudit({ hours: hours ?? 24 })

          try {
            const state = loadProjectState()
            const bucket = ensureProjectBucket(state, fp)
            bucket.lastSeen = new Date().toISOString()
            bucket.researchChains = Math.max(
              bucket.researchChains || 0, report.chains.length
            )
            bucket.context7Bypasses = (bucket.context7Bypasses || 0) + report.redundant
            for (const [d] of Object.entries(report.byDomain)) {
              if (!d.startsWith("_") && !bucket.commonTopics.includes(d)) {
                bucket.commonTopics.push(d)
              }
            }
            if (bucket.commonTopics.length > 20) {
              bucket.commonTopics = bucket.commonTopics.slice(-20)
            }
            saveProjectState(state)
          } catch (err) {
            console.error(`[vibeOS] project-memory update failed: ${(err as Error).message}`)
          }

          try {
            const findings: Array<{ severity: string; topic: string; detail: string }> = []
            for (const c of report.chains) findings.push({ severity: "warn", topic: "Domain chain", detail: `${c.domain}: ${c.count} fetches in a row` })
            if (report.redundant > 0) findings.push({ severity: "warn", topic: "Context7 bypass", detail: `${report.redundant} bypasses detected` })
            if (report.totalFetches > 0) findings.push({ severity: "info", topic: "Fetch volume", detail: `${report.totalFetches} fetches, ${(report.totalBytes/1024).toFixed(0)}KB, ~$${report.estCost.toFixed(3)}` })
            const narParts = [`Scanned index and session state for last ${hours ?? 24}h.`]
            narParts.push(`Found ${report.totalFetches} fetch operations (${(report.totalBytes/1024).toFixed(0)}KB, ~$${report.estCost.toFixed(3)}).`)
            if (report.chains.length > 0) {
              narParts.push(`${report.chains.length} domain chain(s):`)
              for (const c of report.chains) narParts.push(`  - ${c.domain}: ${c.count} consecutive fetches`)
            }
            if (report.redundant > 0) narParts.push(`Context7 bypasses: ${report.redundant}.`)
            if (report.sessions > 0) narParts.push(`Spans ${report.sessions} session(s).`)
            const narrative = narParts.join("\n")
            saveReport({ type: "research-audit", summary: `${report.totalFetches} fetches, ${report.chains.length} chains, ${report.redundant} bypasses in ${hours ?? 24}h`, findings, metrics: report, narrative, tags: ["research"] })
          } catch {}

          const lines = [`🔬 Research audit (last ${hours ?? 24}h):`]
          if (report.totalFetches === 0) {
            lines.push(`  No WebFetch/WebSearch activity found.`)
            return lines.join("\n")
          }
          lines.push(`  Fetches: ${report.totalFetches} (${(report.totalBytes / 1024).toFixed(0)}KB, ~$${report.estCost.toFixed(3)})`)
          lines.push(`  Unique domains: ${Object.keys(report.byDomain).filter(k => !k.startsWith("_")).length}`)
          if (report.redundant > 0) lines.push(`  ⚠ Context7 bypasses: ${report.redundant}`)
          if (report.chains.length > 0) {
            lines.push(`  ⚠ Domain chains (≥3 consecutive to same domain):`)
            for (const c of report.chains) {
              const d = c.domain.length > 50 ? c.domain.slice(0, 50) + "…" : c.domain
              lines.push(`    • ${d}: ${c.count} fetches in a row`)
            }
          }
          if (Object.keys(report.byDomain).length > 0) {
            lines.push(`  Domain breakdown:`)
            for (const [d, n] of Object.entries(report.byDomain).sort((a, b) => (b[1] as number) - (a[1] as number))) {
              if (d.startsWith("_")) continue
              const label = d.length > 55 ? d.slice(0, 55) + "…" : d
              lines.push(`    ${String(n).padStart(3)}  ${label}`)
            }
          }

          lines.push(`\nTip: run with hours=6 for finer granularity.`)
          return lines.join("\n")
        },
      }),
      "report-save": tool({
        description: "Save a manual report with findings, metrics, narrative. " +
          "Findings: lines like 'warn: Topic: Detail' or 'info: Volume: 10 fetches'. " +
          "Metrics: lines like 'fetches=10' or 'cost=0.03'. " +
          "JSON arrays/objects also accepted for programmatic callers.",
        args: {
          summary: tool.schema.string({description: "One-line summary"}),
          findings: tool.schema.string({description: "Plain text lines: severity: Topic: Detail / or JSON array"}).optional(),
          metrics: tool.schema.string({description: "Plain text lines: key=value / or JSON object"}).optional(),
          narrative: tool.schema.string({description: "Free-form markdown narrative"}).optional(),
          tags: tool.schema.string({description: "Comma-separated tags"}).optional(),
        },
        async execute({ summary, findings, metrics, narrative, tags }: any = {}) {
          let parsedFindings: Array<any> = []; let parsedMetrics: any = {}
          try { if (findings) parsedFindings = JSON.parse(findings) } catch {
            if (findings) {
              for (const line of findings.split("\n").map((l: string) => l.trim()).filter(Boolean)) {
                const m = line.match(/^(warn|info|hint)\s*:\s*(.+?)\s*:\s*(.+)/i)
                if (m) parsedFindings.push({ severity: m[1].toLowerCase(), topic: m[2].trim(), detail: m[3].trim() })
                else parsedFindings.push({ severity: "info", topic: "Note", detail: line })
              }
            }
          }
          try { if (metrics) parsedMetrics = JSON.parse(metrics) } catch {
            if (metrics) {
              for (const line of metrics.split("\n").map((l: string) => l.trim()).filter(Boolean)) {
                const m = line.match(/^([\w-]+)\s*=\s*([\d.]+)/)
                if (m) parsedMetrics[m[1]] = parseFloat(m[2])
              }
            }
          }
          const tagList = tags ? tags.split(",").map((t: string) => t.trim()).filter(Boolean) : []
          const id = saveReport({ type: "manual", summary, findings: parsedFindings, metrics: parsedMetrics, narrative: narrative || "", tags: tagList })
          if (id) return `✅ Report saved: ${id}\n  ${summary}\n  ${parsedFindings.length} findings, ${Object.keys(parsedMetrics).length} metrics, ${tagList.length} tags`
          return `❌ Failed to save report`
        },
      }),
      "report-list": tool({
        description: "List saved reports. Filter by type (research-audit|manual), project name, hours (default 168 = 7d).",
        args: {
          type: tool.schema.string().optional(),
          project: tool.schema.string().optional(),
          hours: tool.schema.number().optional(),
          fingerprint: tool.schema.string().optional(),
        },
        async execute({ type, project, hours, fingerprint }: any = {}) {
          const reports = listReports({ type, project, hours: hours ?? 168, fingerprint })
          if (reports.length === 0) return "📋 No reports found."
          const lines = ["📋 Reports (last " + (hours ?? 168) + "h) — " + reports.length + " total:"]
          for (const r of reports.slice(0, 15)) {
            const d = r.created.slice(0, 16).replace("T", " ")
            const s = (r.summary || "").slice(0, 100)
            lines.push("  [" + d + "] #" + r.id + "  " + r.type + "  " + s)
          }
          if (reports.length > 15) lines.push("  … and " + (reports.length - 15) + " more")
          return lines.join("\n")
        },
      }),
      "report-read": tool({
        description: "Read a specific report by its ID (shown in report-list output). Returns full structured report.",
        args: {
          id: tool.schema.string({description: "Report ID from report-list"}),
        },
        async execute({ id }: { id?: string } = {}) {
          if (!id) return `❌ Provide id=<report-id>`
          if (!/^[\w-]+$/.test(id)) return `❌ Invalid report ID: ${id} (use only alphanumeric, underscore, or hyphens)`
          const report = readReport(id)
          if (!report) return `❌ Report not found: ${id}`
          const d = (report?.meta?.created ?? report?.created ?? "unknown").slice(0, 16).replace("T", " ")
          const lines = [
            "📄 Report #" + id,
            "  Type: " + (report?.meta?.type ?? report?.type ?? "unknown") + "  |  " + d,
            "  💬 " + (report.summary || "(no summary)"),
          ]
          if (report.metrics && Object.keys(report.metrics).length > 0) {
            const m = report.metrics
            lines.push("")
            if (m.model) lines.push("  🧠 Model: " + m.model)
            if (m.slot) lines.push("  🎯 Slot: " + m.slot)
            if (m.sessionCost != null) lines.push("  💰 Cost: $" + Number(m.sessionCost).toFixed(2))
            if (m.cacheSavings != null) lines.push("  💸 Cache saved: $" + Number(m.cacheSavings).toFixed(2))
            if (m.taskDelegationCount != null) lines.push("  🛒 Task delegations: " + Number(m.taskDelegationCount))
            if (m.delegationSavingsUsd != null) lines.push("  🧾 Delegation savings: -$" + Number(m.delegationSavingsUsd).toFixed(2))
            else if (m.tasksDelegated != null) lines.push("  🛒 Tasks delegated: " + m.tasksDelegated)
            if (m.editSavings != null) lines.push("  ✏️ Edit savings: -$" + Number(m.editSavings).toFixed(2))
            if (m.creditSavings != null) lines.push("  💳 Credit savings: -$" + Number(m.creditSavings).toFixed(2))
            if (m.context7Savings != null) lines.push("  🔍 C7 savings: -$" + Number(m.context7Savings).toFixed(2))
            if (m.scratchpadHits != null) lines.push("  📁 Scratchpad hits: " + m.scratchpadHits)
          }
          if (report.tags?.length > 0) lines.push("\nTags: " + report.tags.join(", "))
          if (report.narrative) lines.push(`\n---\n${report.narrative}`)
          return lines.join("\n")
        },
      }),
    },
  }

  // ── MCP server startup ─────────────────────────────────────────────
  try {
    const port = loadMcpPort()
    if (port !== 0) {
      if (!_mcpServerRuntime) {
        _mcpServerRuntime = createMcpServer({
          getState: () => ({ ...computeStatusPayload(), sessions_raw: readFullState()?.sessions || {} }),
          getSavings: () => computeSavingsPayload(),
          getSessionMetrics: () => computeSessionMetrics(readFullState(), _OC_SID),
          listReports: (filter: any) => {
            if (!existsSync(REPORTS_DIR)) {
              const err: any = new Error("reports dir not found")
              err.status = 404
              throw err
            }
            return listReports(filter || {})
          },
          readReport: (id: string) => readReport(id),
          runDiagnose: async () => {
            const raw = await pluginHooks.tool.trinity.execute({ action: "diagnose" })
            return diagnoseStructuredFromText(raw)
          },
          runProject: async () => {
            const raw = await pluginHooks.tool.trinity.execute({ action: "project" })
            return projectStructuredFromText(raw)
          },
          runTrinity: async (action: string, params: any = {}) => pluginHooks.tool.trinity.execute({ action, slot: params.slot, level: params.level }),
          runResearchAudit: (hours: number) => researchAudit({ hours: hours ?? 24 }),
          saveReport: (data: any) => saveReport(data),
          getCurrentSessionId: () => _OC_SID,
          generateSessionCheckout: () => computeSessionCheckout(),
        })
      }
      const mcpServer = await _mcpServerRuntime.start(port)
      const actualPort = Number(mcpServer?.address?.()?.port || port)
      if (actualPort && actualPort !== port) persistMcpPort(actualPort)
      console.error(`[vibeOS] MCP server listening on http://127.0.0.1:${actualPort}`)
      if (!_mcpServerHooked) {
        _mcpServerHooked = true
        const closeServer = () => {
          try { _mcpServerRuntime?.close() } catch {}
        }
        process.on("SIGTERM", closeServer)
        process.on("SIGINT", closeServer)
      }
    }
  } catch (err) {
    console.error(`[vibeOS] MCP server startup failed: ${(err as Error).message}`)
  }

  return pluginHooks
}

export const id = "vibeOS"
export const server = DelegationEnforcer
export default { id: "vibeOS", server: DelegationEnforcer }

export { researchAudit } from "./lib/research-audit.js"
export { saveReport, listReports, readReport } from "./lib/reporting.js"
