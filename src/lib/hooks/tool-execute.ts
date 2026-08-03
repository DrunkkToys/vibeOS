// @ts-nocheck
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs"
import { appendJsonlWithRotation } from "../../utils/fs-helpers.js"
import { join, dirname, basename } from "node:path"
import { createHash } from "node:crypto"
import {
  currentTier, currentModel, setCurrentModel, setCurrentTier, currentProjectFingerprint, currentProjectName, getCurrentSessionId,
  _textCompletePainted,
  _OC_SID, _modelLocked, _blackboxEnabled,
  scratchpadHitsSeen, 
  loadSelection, readLifetimeSavings, recordRecentToolEvent,
  recordCacheSaving, recordMissedContext7, getScratchpadHit,
  recordScratchpadObservation,
  recordPrivacyTelemetry,
  updateState, _withFileLock, _safeJsonParse,
  getSessionScratchpadDir, ensureSessionScratchpadDirs, _getSessionIndexPath,
  _indexAppend,
  _loadActiveJobs,
  _detectTechStack, _projectFingerprint, _loadProjectState, _saveProjectState,
  _ensureProjectBucket, _mergeProjectBucket, SAVINGS_LEDGER_FILE,
  CONTEXT7_INSTALL_FLAG, SOFT_QUOTA_LIMIT, _loadTodos, upsertTodo,
  ML_ENABLED, _cacheDb, _mlSavePending, ML_CONFIDENCE_THRESHOLD, setMlSavePending,
  _loadMLState, saveMLState,
  _readJsonOrEmpty, _handleStateCorruption, _lockPathFor,
  SCRATCHPAD_TOOLS, SCRATCHPAD_GLOBAL_DIR, TOOL_NAME_NORMALIZE, stableJson, applyDecadence,
} from "../state.js"
import {
  classify, modelCostPerTurn, isModelFree, detectContext7, isDocsTarget,
  shortModelName, formatUsd, _refreshModel, readConfig, resolveTrinityDisplayModel, TRINITY_CHEAP, TRINITY_MEDIUM, TRINITY_BRAIN,
  cacheSavePer1MInputTokens,
  _trendDisplay, modelToSlotLabel, resolveExecutionIdentity, _formatProviderName, _formatQualityName, modelDisplayName,
} from "../pricing.js"
import { latestUserIntent, normalizeRoutePath } from "./chat-transform.js"
import { loadSessionSlot } from "../selection-manager.js"
import { loadCredit, refreshCreditSnapshot } from "../credit-api.js"
import { buildFooterLine, buildEnforcementTags, resolveBrand, resolveTierIcon, resolveActiveCascadeTier, buildSessionBridge, recordSessionBridge, scoreTaskQuality } from "./footer.js"
import { getVibeOSHome } from "../state.js"

function isGreetingLike(text: string): boolean {
  const value = String(text || "").trim().toLowerCase()
  return value === "hi" || value === "hello" || value === "hey" || value === "yo" || /^hi[!.?\s]*$/.test(value) || /^hello[!.?\s]*$/.test(value) || /^hey[!.?\s]*$/.test(value)
}
import {
  scoreStress, extractFirstWordFromArgs, shouldLogWarn, classifyTurnSimple, autoSelectMode, resolveOptimizationSlot,
  isUserAskingForTests, _isLikelyOffTopic, resolveEnforcementMode,
  _getBlackboxTracker, loadBlackboxState, saveBlackboxState as _saveBlackboxState,
  _loadGlobalLearning, _updateGlobalLearning,
  noteTaskRoutingLearning,
  incrementTurnCounter,
} from "../cascade.js"
import { saveReport } from "../reporting.js"
import { remoteCall, isApiConnected } from "../api-client.js"
import { getCostAnomalyDetector } from "../cost-anomaly.js"
import { checkFlowRules, recordFlowTodo } from "../../vibeOS-lib/flow-enforcer.js"
import { computeDifficulty, cascadeDecide, hashQuery } from "../../vibeOS-lib/ml-router.js"
import { addCacheEntry, recordCacheStats, predictCacheHit } from "../../vibeOS-lib/smart-cache.js"
import { buildTestReminder, enforceTestFile } from "../tdd-enforcer.js"
import { setActiveJobFromTaskPrompt, observeToolPattern, compressText, recordSaving } from "../index-helpers.js"
import { buildTurnId, getLatestRouteEvent, recordTurnRoute, CASCADE_ROUTE_RECENCY_MS } from "../turn-ledger.js"
import { SAVE_EST, WARN_ON_DIRECT, SOFT_QUOTA, FREE, MONITOR } from "../constants.js"
import { runtimeTierCoherence } from "../runtime-config.js"
import { ToolLoopGuard } from "../loop-guard.js"

const _warnCounts: Record<string, number> = {}
export function _resetWarnCountsForTest(): void {
  for (const key of Object.keys(_warnCounts)) delete _warnCounts[key]
}
export function _resetToolExecuteStateForTest(): void {
  _resetWarnCountsForTest()
  _activeJob = null
  projectDirectory = ""
  pendingUiNote = null
  enforcementBlocked = false
  scratchpadHitsSeen.clear()
  softQuotaCounts = {}
  context7AlertedThisSession = false
  context7Seen.clear()
  _prompt = ""
  _autoReportCount = 0
  _pendingTodoArgs = null
  _pendingTelemetryStarts = []
  _loopGuard.reset()
  _loopWarnedSig = null
}
export function _setPendingUiNoteForTest(note: string | null): void {
  pendingUiNote = note
}
export function _setEnforcementBlockedForTest(value: boolean): void {
  enforcementBlocked = value === true
}
const MAX_WARNS_PER_TOOL = 5

const BYTES_PER_TOKEN = 4
const DEBUG_INTERNALS = process.env.VIBEOS_DEBUG_INTERNALS === "1"
const _IS_CLI_RUNTIME = Boolean(process.stdout?.isTTY || process.stderr?.isTTY || process.stdin?.isTTY)

let _activeJob = null
let projectDirectory = ""
let context7Seen = new Set()
let _prompt = ""
let _autoReportCount = 0
let pendingUiNote: string | null = null
let enforcementBlocked = false
let softQuotaCounts: Record<string, number> = {}
let context7AlertedThisSession = false
let _pendingTodoArgs = null
let _pendingTelemetryStarts = []
let _loopGuard = new ToolLoopGuard()
let _loopWarnedSig: string | null = null

function _bucketChars(n) {
  const size = Number(n || 0)
  if (!Number.isFinite(size) || size <= 0) return "0"
  if (size <= 63) return "1-63"
  if (size <= 255) return "64-255"
  if (size <= 1023) return "256-1k"
  if (size <= 4095) return "1k-4k"
  return "4k+"
}

function _bucketMs(n) {
  const ms = Number(n || 0)
  if (!Number.isFinite(ms) || ms < 0) return "unknown"
  if (ms <= 49) return "0-49ms"
  if (ms <= 199) return "50-199ms"
  if (ms <= 999) return "200-999ms"
  if (ms <= 4999) return "1-4.9s"
  if (ms <= 14999) return "5-14.9s"
  return "15s+"
}

function _toolKind(tool, args) {
  const t = String(tool || "").toLowerCase()
  if (t === "task") {
    const prompt = String(args?.prompt || "").trim().toLowerCase()
    const first = prompt.split(/\s+/)[0] || ""
    if (/^(check|find|list|search|does|verify|look|count|show|get|read|grep|scan|detect|inspect)$/i.test(first)) return "explore"
    if (/^(write|create|add|build|implement|fix|change|edit|modify|update|refactor|generate|make|commit|push|deploy|release|publish|install|remove|delete|rename|move|copy|transform|convert|migrate)/i.test(prompt)) return "implement"
    return "task"
  }
  if (t === "bash") {
    const command = String(args?.command || args?.cmd || args?.script || "").toLowerCase()
    if (/(\btest\b|npm\s+test|vitest|jest|mocha|ava)/i.test(command)) return "test"
    if (/(\btypecheck\b|tsc|eslint|lint)/i.test(command)) return "verify"
    if (/(\bbuild\b|esbuild|vite|webpack)/i.test(command)) return "build"
    if (/(\bdeploy\b|release|publish)/i.test(command)) return "deploy"
    if (/(\bgit\b|\bgh\b)/i.test(command)) return "git"
    return "shell"
  }
  if (t === "webfetch" || t === "websearch") {
    const target = String(args?.url || args?.query || "")
    return isDocsTarget(target) ? "docs" : "web"
  }
  if (t === "write" || t === "edit" || t === "notebookedit") {
    const filePath = String(args?.filePath || args?.file_path || args?.path || "")
    if (/(^|\/)(tests?|spec)\//i.test(filePath) || /\.(test|spec)\./i.test(filePath)) return "test"
    if (/\.(md|txt|rst)$/i.test(filePath)) return "docs"
    if (/\.(json|jsonc|yaml|yml|toml)$/i.test(filePath) || /(?:^|\/)(AGENTS|README|package)\.md$/i.test(filePath)) return "config"
    if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|sh)$/i.test(filePath)) return "source"
    return "file"
  }
  return t || "unknown"
}

function _argSizeBucket(tool, args) {
  const t = String(tool || "").toLowerCase()
  if (t === "task") return _bucketChars(String(args?.prompt || "").length)
  if (t === "bash") return _bucketChars(String(args?.command || args?.cmd || args?.script || "").length)
  if (t === "webfetch" || t === "websearch") return _bucketChars(String(args?.url || args?.query || "").length)
  if (t === "write") return _bucketChars(String(args?.content || "").length)
  if (t === "edit") return _bucketChars(String(args?.newString || "").length + String(args?.oldString || "").length)
  if (t === "notebookedit") return _bucketChars(String(args?.newString || "").length)
  return _bucketChars(JSON.stringify(args || {}).length)
}

function _toolArgSources(input, output) {
  return [input?.args, output?.args].filter((arg) => arg && typeof arg === "object")
}

function _normalizeToolPath(pathValue) {
  return String(pathValue || "").trim().replace(/\\/g, "/")
}

function _resolveToolPath(pathValue) {
  const raw = _normalizeToolPath(pathValue)
  if (!raw) return ""
  if (/^[a-z]+:\/\//i.test(raw)) return raw
  if (raw.startsWith("/")) return raw
  return projectDirectory ? join(projectDirectory, raw).replace(/\\/g, "/") : raw
}

// Self-modification protection must apply ONLY to the vibeOS plugin's own
// repo. The old pattern-matched any project path under src/, tests?/, scripts/,
// package.json, README.md, etc. — which blocked normal dev writes (creating
// test files, editing scripts) in every unrelated project. That was the
// "can not read/write" pain reported by users. Scope it to the plugin repo.
function _isVibeOSRepoProject() {
  try {
    const dir = String(projectDirectory || "").trim()
    if (!dir) return false
    if (existsSync(join(dir, "dist", "vibeOS.js"))) return true
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
      if (pkg && pkg.name === "vibeostheog") return true
    } catch {}
  } catch {}
  return false
}

function _isProtectedToolPath(pathValue) {
  if (!_isVibeOSRepoProject()) return false
  const raw = _normalizeToolPath(pathValue)
  if (!raw) return false
  const resolved = _resolveToolPath(pathValue)
  const candidates = [raw, resolved].filter(Boolean)
  const protectedPatterns = [
    /(^|\/)src\/index\.(js|ts)$/i,
    /(^|\/)src\/vibeOS-lib\//i,
    /(^|\/)src\/utils\//i,
    /(^|\/)src\/dashboard\//i,
    /(^|\/)src\/vibeOS-api-server\//i,
    /(^|\/)tests?\//i,
    /(^|\/)test-scripts\//i,
    /(^|\/)scripts\//i,
    /(^|\/)\.github\/workflows\//i,
    /(^|\/)\.opencode\/plugins\//i,
    /(^|\/)plugins\//i,
    /(^|\/)README\.md$/i,
    /(^|\/)AGENTS\.md$/i,
    /(^|\/)CHANGELOG\.md$/i,
    /(^|\/)LICENSE$/i,
    /(^|\/)package\.json$/i,
    /(^|\/)tsconfig\.json$/i,
    /(^|\/)\.env\.production$/i,
    /(^|\/)PRODUCTION-CREDENTIALS\.md$/i,
  ]
  return candidates.some((candidate) => protectedPatterns.some((re) => re.test(candidate)))
}

function _mutateBlockedToolArgs(toolName, sources, blockedPath, outputObj) {
  const tLower = String(toolName || "").toLowerCase()
  const blockedBase = basename(blockedPath || "") || "blocked"
  for (const src of sources) {
    if (!src || typeof src !== "object") continue
    if (tLower === "write") {
      src.filePath = `/tmp/vibeos-enforcement-blocked-${blockedBase}`
      if (src.file_path !== undefined) src.file_path = src.filePath
      if (src.path !== undefined) src.path = src.filePath
      if (src.content !== undefined) src.content = ""
    } else if (tLower === "edit" || tLower === "notebookedit") {
      src.oldString = `__THE_SAVER_ENFORCEMENT_BLOCK_${Date.now()}__`
      if (src.newString !== undefined) src.newString = ""
      if (src.content !== undefined) src.content = ""
      if (!src.filePath && blockedPath) src.filePath = blockedPath
      if (src.file_path !== undefined && !src.file_path) src.file_path = blockedPath
      if (src.path !== undefined && !src.path) src.path = blockedPath
    }
  }
  if (outputObj && typeof outputObj === "object") {
    outputObj.blocked = true
    outputObj.status = "error"
    outputObj.error = outputObj.error || `blocked direct ${tLower}`
  }
}

// Neutralize a runaway bash loop: replace the command with a harmless echo that
// surfaces the stop directive, and mark the result blocked. Mirrors the
// write/edit block path so the tool "runs" but does nothing costly.
function _neutralizeBashLoop(input, output, directive) {
  const safe = String(directive || "loop blocked").replace(/"/g, "'")
  const replacement = `echo "[vibeOS loop-guard] ${safe}"`
  for (const src of [output?.args, input?.args]) {
    if (!src || typeof src !== "object") continue
    if (typeof src.command === "string") src.command = replacement
    if (typeof src.cmd === "string") src.cmd = replacement
    if (typeof src.script === "string") src.script = replacement
  }
  if (output && typeof output === "object") {
    output.blocked = true
    output.status = "error"
    output.error = output.error || "blocked runaway bash loop"
  }
}

function _dequeueTelemetryStart(tool) {
  if (_pendingTelemetryStarts.length === 0) return null
  const t = String(tool || "").toLowerCase()
  for (let i = _pendingTelemetryStarts.length - 1; i >= 0; i--) {
    if (String(_pendingTelemetryStarts[i]?.tool || "").toLowerCase() === t) {
      return _pendingTelemetryStarts.splice(i, 1)[0]
    }
  }
  return _pendingTelemetryStarts.shift()
}

function _slotRank(slot: string | null): number {
  if (slot === "brain") return 3
  if (slot === "medium") return 2
  if (slot === "cheap") return 1
  return 0
}

function _slotFromModel(model: string | null, trinityCheap: string | null, trinityMedium: string | null, trinityBrain: string | null): string | null {
  if (!model) return null
  if (trinityBrain && model === trinityBrain) return "brain"
  if (trinityMedium && model === trinityMedium) return "medium"
  if (trinityCheap && model === trinityCheap) return "cheap"
  const tier = classify(model)
  if (tier === "high") return "brain"
  if (tier === "mid") return "medium"
  if (tier === "budget") return "cheap"
  return null
}

function _modelForSlot(slot: string | null, trinityCheap: string | null, trinityMedium: string | null, trinityBrain: string | null): string | null {
  if (slot === "brain") return trinityBrain
  if (slot === "medium") return trinityMedium
  if (slot === "cheap") return trinityCheap
  return null
}

export function taskSubagentTypeForSlot(slot: string | null): string | null {
  if (slot === "brain" || slot === "medium" || slot === "cheap") return "general"
  return null
}

// rawCascadeDepth reflects the last-recorded ROUTE PLAN (blackbox control
// vector / route_path), which is regime+mode driven and can stay pinned at a
// deep tier (e.g. brain) long after the orchestrator stopped delegating, or
// even when a delegation was only ever planned and never dispatched. The
// only trustworthy signal that a cascade actually executed is a turn.route
// event recorded moments ago (a real Task dispatch, gated in this file's
// onToolExecuteBefore). If no such recent event exists, fall back to
// liveModelDepth -- classification of the model actually shown -- not the
// route-path-derived tier, which is the same signal that's polluted.
export function clampCascadeDepthToTurnTruth(
  rawCascadeDepth: number,
  liveModelDepth: number,
  recentRoute: { ts: string; executedRoute: { cascadeDepth?: number | null } | null } | null,
  nowMs: number = Date.now(),
  recencyWindowMs: number = CASCADE_ROUTE_RECENCY_MS,
): number {
  if (recentRoute?.executedRoute?.cascadeDepth != null) {
    const routeTs = Date.parse(recentRoute.ts)
    if (Number.isFinite(routeTs) && (nowMs - routeTs) <= recencyWindowMs && (nowMs - routeTs) >= 0) {
      return Math.min(rawCascadeDepth, recentRoute.executedRoute.cascadeDepth)
    }
  }
  return Math.min(rawCascadeDepth, liveModelDepth)
}

function _normalizeCascadeRoot(activePipeline: unknown, fallbackSlot: string | null): string[] {
  const root = Array.isArray(activePipeline)
    ? activePipeline.map((entry) => String(entry || "").trim().toLowerCase()).map((entry) => entry === "local" ? "cheap" : entry).filter((entry) => entry === "cheap" || entry === "medium" || entry === "brain")
    : []
  if (root.length > 0) return root
  return fallbackSlot ? [fallbackSlot] : []
}

function _writeCascadeAudit(prompt: string, slot: string | null, model: string | null, decision: unknown, meta: unknown = {}): void {
  try {
    const vibeHome = getVibeOSHome()
    if (!vibeHome || vibeHome === "undefined" || vibeHome.startsWith("undefined")) return
    const dir = join(vibeHome, "cascade-audit")
    mkdirSync(dir, { recursive: true })
    const path = join(dir, "cascade-audit.jsonl")
    if (!existsSync(path)) {
      mkdirSync(dir, { recursive: true })
    }
    const difficulty = computeDifficulty(prompt)
    const line = JSON.stringify({
      _ts: new Date().toISOString(),
      sessionId: String(meta?.sessionId || getCurrentSessionId() || _OC_SID || ""),
      turnId: String(meta?.turnId || ""),
      bridgeId: String(meta?.bridgeId || ""),
      parentSessionId: String(meta?.parentSessionId || ""),
      query_hash: hashQuery(String(prompt || "")),
      slot: String(slot || ""),
      model: String(model || ""),
      selectedSlot: String(meta?.selectedSlot || slot || ""),
      selectedModel: String(meta?.selectedModel || model || ""),
      source: String(meta?.source || decision?.source || ""),
      routePath: Array.isArray(meta?.routePath) ? meta.routePath : [],
      cascadeDepth: Number(meta?.cascadeDepth || (Array.isArray(meta?.routePath) ? meta.routePath.length : 0) || 0),
      executed: meta?.executed === false ? false : true,
      status: String(meta?.status || "completed"),
      difficulty_score: Number(difficulty.score.toFixed(4)),
      difficulty_level: difficulty.level,
      difficulty_confidence: Number(difficulty.confidence.toFixed(2)),
      difficulty_suggested_tier: difficulty.suggestedTier,
      escalate: Boolean(decision?.escalate),
      use_cheap: Boolean(decision?.useCheap),
      confidence: Number(decision?.confidence || 0),
      reason: String(decision?.reason || ""),
    })
    appendJsonlWithRotation(path, line + "\n", 5000, 200)
  } catch (err) {
    if (DEBUG_INTERNALS) console.error(`[vibeOS] cascade-audit write error: ${err.message}`)
  }
}

export function resolveCascadeRouteDecision(input: unknown = {}): unknown {
  const prompt = String(input?.prompt || "")
  const firstWord = String(input?.firstWord || prompt.trim().split(/\s+/)[0] || "").toLowerCase()
  const trinityCheap = input?.trinityCheap || null
  const trinityMedium = input?.trinityMedium || null
  const trinityBrain = input?.trinityBrain || null
  const hasMedia = input?.hasMedia === true
  const backendRoute = input?.backendRoute && typeof input.backendRoute === "object" ? input.backendRoute : null
  const backendExplicit = backendRoute?.explicit === true || backendRoute?.allow_local_upgrade === false
  const cascadeRoot = _normalizeCascadeRoot(input?.activePipeline, _slotFromModel(input?.tierTarget || input?.exploratoryTarget || null, trinityCheap, trinityMedium, trinityBrain))
  let cascadeSelectedModel = input?.exploratoryTarget || input?.tierTarget || null
  const explicitTarget = cascadeSelectedModel
  let cascadeSelectedSlot = _slotFromModel(cascadeSelectedModel, trinityCheap, trinityMedium, trinityBrain)
  let cascadeSource = cascadeSelectedModel ? (input?.exploratoryTarget ? "exploratory" : "tier") : "none"
  let cascadeReason = cascadeSelectedModel ? `${cascadeSource}:${firstWord || input?.currentTier || "task"}` : "no target"
  // selectedModel/selectedSlot/source/reason are set below by the backend branch
  // (line ~390) or the no-backend/merge branch (line ~466) — this is the single
  // decision point; nothing reads these placeholder values before then.
  let selectedModel: string | null = null
  let selectedSlot: string | null = null
  let source = "none"
  let reason = "no target"
  let localConfidence = 0
  let localScore = 0
  let cascadeDecision = null

  const applyLocalCandidate = (slot: string | null, model: string | null, nextSource: string, nextReason: string, force = false) => {
    if (!slot || !model || hasMedia) return
    if (!cascadeSelectedSlot || force || _slotRank(slot) > _slotRank(cascadeSelectedSlot)) {
      cascadeSelectedSlot = slot
      cascadeSelectedModel = model
      cascadeSource = nextSource
      cascadeReason = nextReason
    }
  }

  if (backendRoute?.target) {
    selectedModel = String(backendRoute.target)
    selectedSlot = backendRoute?.target_slot || backendRoute?.targetSlot || _slotFromModel(selectedModel, trinityCheap, trinityMedium, trinityBrain)
    source = "backend"
    reason = backendRoute?.reason || "backend route"
      _writeCascadeAudit(prompt, selectedSlot, selectedModel, { escalate: selectedSlot !== "cheap", useCheap: selectedSlot === "cheap", confidence: backendRoute.confidence || 1, reason: `backend: ${reason}`, source }, {
        selectedSlot,
        selectedModel,
        source,
        routePath: normalizeRoutePath(cascadeRoot, selectedSlot),
        cascadeDepth: normalizeRoutePath(cascadeRoot, selectedSlot).length || 1,
        executed: true,
      })
  }

  const precomputedEmbeddingMode = input?.embeddingMode ? String(input.embeddingMode) : null
  if (!backendRoute?.target && precomputedEmbeddingMode) {
    const isBudget = /budget|lite|speed|cheap/i.test(precomputedEmbeddingMode)
    const isQuality = /quality|brain|ultra|opus|pro/i.test(precomputedEmbeddingMode)
    if (isBudget && trinityCheap) {
      applyLocalCandidate("cheap", trinityCheap, "embedding", `embedding=${precomputedEmbeddingMode}`)
    } else if (isQuality && trinityBrain) {
      applyLocalCandidate("brain", trinityBrain, "embedding", `embedding=${precomputedEmbeddingMode}`)
    } else if (trinityMedium) {
      applyLocalCandidate("medium", trinityMedium, "embedding", `embedding=${precomputedEmbeddingMode}`)
    }
  }

  if (input?.mlEnabled !== false) {
    try {
      const mlDifficulty = computeDifficulty(prompt)
      localConfidence = mlDifficulty.confidence
      localScore = mlDifficulty.score
      if (mlDifficulty.confidence >= Number(input?.mlConfidenceThreshold ?? ML_CONFIDENCE_THRESHOLD) && mlDifficulty.level !== "moderate") {
        const mlSlot = mlDifficulty.suggestedTier
        const mlModel = _modelForSlot(mlSlot, trinityCheap, trinityMedium, trinityBrain)
        if (mlModel) {
          applyLocalCandidate(mlSlot, mlModel, "ml", `${mlDifficulty.level} score=${mlDifficulty.score.toFixed(2)} conf=${mlDifficulty.confidence.toFixed(2)}`)
        }
      }
    } catch (err) {
      if (DEBUG_INTERNALS) console.error(`[vibeOS] ML route resolver error: ${err.message}`)
    }
  }

  // Stress upgrade: must run BEFORE cascade decision so it doesn't skip
  // when cascadeSelectedSlot gets changed by cascade escalation
  if (cascadeSelectedSlot === "cheap" && trinityMedium && Number(input?.stressScore || 0) > 0.5) {
    applyLocalCandidate("medium", trinityMedium, "stress", `stress ${Number(input?.stressScore || 0).toFixed(2)}`, true)
  }

  if (cascadeRoot.length > 1 && trinityCheap && trinityMedium) {
    try {
      cascadeDecision = cascadeDecide(prompt, 0.001, 0.005, 0.02, 0.85)
      if (cascadeDecision.escalate) {
        const slot = cascadeRoot.length > 2 && (cascadeDecision.confidence >= 0.7 || cascadeDecision.level === "complex") ? cascadeRoot[2] : cascadeRoot[1]
        const model = _modelForSlot(slot, trinityCheap, trinityMedium, trinityBrain)
        if (model) {
          applyLocalCandidate(slot, model, "cascade", cascadeDecision.reason)
        }
      } else if (cascadeDecision.useCheap && !cascadeSelectedModel) {
        applyLocalCandidate(cascadeRoot[0], _modelForSlot(cascadeRoot[0], trinityCheap, trinityMedium, trinityBrain), "cascade", cascadeDecision.reason)
      }
      _writeCascadeAudit(prompt, cascadeSelectedSlot, cascadeSelectedModel, { ...cascadeDecision, source: cascadeSource }, {
        selectedSlot: cascadeSelectedSlot,
        selectedModel: cascadeSelectedModel,
        source: cascadeSource,
        routePath: normalizeRoutePath(cascadeRoot, cascadeSelectedSlot),
        cascadeDepth: normalizeRoutePath(cascadeRoot, cascadeSelectedSlot).length || 1,
        executed: true,
      })
    } catch (err) {
      if (DEBUG_INTERNALS) console.error(`[vibeOS] cascade route resolver error: ${err.message}`)
    }
  }

  if (!backendRoute?.target) {
    selectedModel = (cascadeSource === "stress" || cascadeSource === "cascade") ? cascadeSelectedModel : (explicitTarget || cascadeSelectedModel)
    selectedSlot = (cascadeSource === "stress" || cascadeSource === "cascade") ? cascadeSelectedSlot : (explicitTarget ? _slotFromModel(explicitTarget, trinityCheap, trinityMedium, trinityBrain) : cascadeSelectedSlot)
    source = cascadeSource
    reason = cascadeReason
  } else if (!backendExplicit && cascadeSelectedSlot && _slotRank(cascadeSelectedSlot) > _slotRank(selectedSlot)) {
    // Backend route is not marked explicit/non-negotiable, and local cascade
    // escalated to a higher-ranked slot: local cascade outranks the backend.
    selectedModel = cascadeSelectedModel
    selectedSlot = cascadeSelectedSlot
    source = cascadeSource
    reason = cascadeReason
  }

  const routePath = normalizeRoutePath(cascadeRoot, selectedSlot)
  const cascadeRoutePath = normalizeRoutePath(cascadeRoot, cascadeSelectedSlot)
  const selectedSubagent = taskSubagentTypeForSlot(selectedSlot)
  const cascadeSelectedSubagent = taskSubagentTypeForSlot(cascadeSelectedSlot)
  const requiresDelegation = selectedSlot === "medium" || selectedSlot === "brain"
  return {
    selectedModel,
    selectedSlot,
    selectedSubagent,
    requiresDelegation,
    shouldOverrideLocal: Boolean(selectedModel),
    delegationReason: requiresDelegation ? reason : "",
    reason,
    source,
    cascadeDepth: routePath.length || 1,
    cascadeRoot,
    routePath,
    cascadeSelectedModel,
    cascadeSelectedSlot,
    cascadeSelectedSubagent,
    cascadeRoutePath,
    backendTarget: backendRoute?.target || null,
    backendExplicit,
    localConfidence,
    localScore,
    cascadeConfidence: cascadeDecision?.confidence || 0,
    cascadeReason: cascadeDecision?.reason || "",
  }
}

// Strip any vibeOS footer block(s) already at the head of a tool-output string.
// tool.execute.after can run more than once against the same output object; without
// this the footer was prepended each time, producing "— … —\n\n— … —\n\n<output>".
function _stripLeadingFooter(s: string): string {
  return s.replace(/^(?:— [^\n]*—\n\n)+/, "")
}

function _prependFooterAlert(target: unknown, footerText: string, seen = new Set<unknown>()): boolean {
  if (!target || typeof target !== "object" || seen.has(target)) return false
  seen.add(target)

  if (typeof target.output === "string") {
    target.output = footerText + _stripLeadingFooter(target.output)
    return true
  }
  if (typeof target.result === "string") {
    target.result = footerText + _stripLeadingFooter(target.result)
    return true
  }
  if (typeof target.text === "string") {
    target.text = footerText + _stripLeadingFooter(target.text)
    return true
  }
  if (Array.isArray(target.content)) {
    const textParts = target.content.filter((part: unknown) => part?.type === "text")
    if (textParts.length > 0 && typeof textParts[0].text === "string") {
      textParts[0].text = footerText + _stripLeadingFooter(textParts[0].text)
    } else {
      target.content.unshift({ type: "text", text: footerText })
    }
    return true
  }
  if (Array.isArray(target.parts)) {
    const textParts = target.parts.filter((part: unknown) => part?.type === "text")
    if (textParts.length > 0 && typeof textParts[0].text === "string") {
      textParts[0].text = footerText + _stripLeadingFooter(textParts[0].text)
    } else {
      target.parts.unshift({ type: "text", text: footerText })
    }
    return true
  }
  if (typeof target.content === "string") {
    target.content = footerText + _stripLeadingFooter(target.content)
    return true
  }

  for (const key of ["message", "data", "payload", "output", "result"]) {
    if (_prependFooterAlert(target[key], footerText, seen)) return true
  }
  for (const value of Object.values(target)) {
    if (_prependFooterAlert(value, footerText, seen)) return true
  }
  return false
}

export function materializeScratchpadAlias(
  toolLower: string,
  args: unknown,
  sourceHash: string,
  options: { sessionDir?: string; globalDir?: string } = {},
): { hash: string; sourcePath: string; targetPath: string } | null {
  if (!sourceHash) return null
  const titleCase = TOOL_NAME_NORMALIZE[String(toolLower || "").toLowerCase()]
  if (!titleCase) return null
  const sessionDir = options.sessionDir || getSessionScratchpadDir()
  const globalDir = options.globalDir || SCRATCHPAD_GLOBAL_DIR
  const inputJson = stableJson(args ?? {})
  const hash = createHash("sha256").update(`${titleCase}\n${inputJson}\n`).digest("hex").slice(0, 16)
  if (hash === sourceHash) return null
  const targetPath = join(sessionDir, `${hash}.txt`)
  if (existsSync(targetPath)) return { hash, sourcePath: targetPath, targetPath }
  const sessionSource = join(sessionDir, `${sourceHash}.txt`)
  const globalSource = join(globalDir, `${sourceHash}.txt`)
  const sourcePath = existsSync(sessionSource) ? sessionSource : (existsSync(globalSource) ? globalSource : "")
  if (!sourcePath) return null
  try {
    ensureSessionScratchpadDirs()
    copyFileSync(sourcePath, targetPath)
    const ptrPath = join(sessionDir, `${hash}.ptr`)
    writeFileSync(ptrPath, JSON.stringify({
      contentHash: sourceHash,
      tool: titleCase,
      warmed: true,
      prewarmed: true,
      at: new Date().toISOString(),
    }))
    return { hash, sourcePath, targetPath }
  } catch {
    return null
  }
}

export const setToolDirectory = (dir) => { projectDirectory = dir || "" }

export const onToolExecuteBefore = async (input, output) => {
  if (!loadSelection().enabled) return
  _refreshModel(projectDirectory)
  const t = input?.tool ?? ""
  const args = output?.args
  const inArgs = input?.args
  const _effArgs = args || inArgs || {}
  const telemetryStart = {
    tool: t,
    startedAt: Date.now(),
    kind: _toolKind(t, _effArgs),
    prompt_size_bucket: _argSizeBucket(t, _effArgs),
    slot: loadSelection().active_slot || "unknown",
    tier: currentTier || "unknown",
    cache_hit: false,
  }
  _pendingTelemetryStarts.push(telemetryStart)
  recordRecentToolEvent(t, _effArgs)
  let _cacheSave = 0
  let _prompt = ""

  // Scratchpad observation (all tiers) — read-only, never blocks.
  if (SCRATCHPAD_TOOLS.has(t)) {
    const hit = getScratchpadHit(t, args)
    if (hit && !scratchpadHitsSeen.has(hit.hash)) {
      scratchpadHitsSeen.add(hit.hash)
      telemetryStart.cache_hit = true
      const total = recordScratchpadObservation(t, args, hit.sizeBytes, { hash: hit.hash })
      // Persist cache savings as a first-class savings type.
      // Compute from actual scratchpad file size: inputs that would
      // have been charged at miss rate are served from cache.
      const rate = cacheSavePer1MInputTokens(currentModel)
      _cacheSave = 0
      if (rate > 0) {
        const _inputTokens = Math.max(1, Math.round(hit.sizeBytes / BYTES_PER_TOKEN))
        _cacheSave = Math.max(0.0001, Math.round(_inputTokens * rate / 1_000_000 * 10000) / 10000)
      }
      const cacheSaved = recordCacheSaving(t, _cacheSave, { hash: hit.hash })
      const sumNote = hit.summaryPath ? ` (summary: ${hit.summaryPath})` : ""
      const cacheNote = cacheSaved ? `, cache+$${(cacheSaved.lifetime || 0).toFixed(3)} lt` : ""
      if (DEBUG_INTERNALS) {
        console.error(`[vibeOS] 📦 scratchpad hit for ${t}: ${hit.fullPath} ${hit.sizeBytes}B ${hit.ageSec}s old${sumNote} — total observed: ${total ?? "?"}${cacheNote}`)
      }
    }
    // Smart cache: learn from this observation + predict future reuse.
    if (ML_ENABLED) {
      try {
        const rawArgs = args || inArgs || {}
        const promptText = typeof rawArgs.prompt === "string" ? rawArgs.prompt
          : typeof rawArgs.filePath === "string" ? `${t}:${rawArgs.filePath}`
            : typeof rawArgs.command === "string" ? rawArgs.command
              : typeof rawArgs.url === "string" ? rawArgs.url
                : typeof rawArgs.pattern === "string" ? rawArgs.pattern
                  : typeof rawArgs.query === "string" ? rawArgs.query
                    : ""
        if (promptText) {
          const keyStr = `${t}:${String(promptText).slice(0, 120)}`
          addCacheEntry(_cacheDb, hit ? hit.hash : hashQuery(keyStr), t, promptText, hit ? hit.sizeBytes : 0, hit ? hit.ageSec : 0)
          recordCacheStats(_cacheDb, t, !!hit, hit ? _cacheSave : 0)
          if (!hit) {
            const prediction = predictCacheHit(_cacheDb, t, promptText)
            if (prediction.shouldWarm && prediction.confidence >= 0.95 && prediction.similarEntries.length > 0) {
              try {
                const warm = materializeScratchpadAlias(t, rawArgs, prediction.similarEntries[0].hash)
                if (warm && DEBUG_INTERNALS) {
                  console.error(`[vibeOS] 🔮 prewarmed scratchpad alias for ${t}: ${warm.sourcePath} → ${warm.targetPath}`)
                }
              } catch (prewarmErr) {
                if (DEBUG_INTERNALS) console.error(`[vibeOS] Scratchpad prewarm error: ${prewarmErr.message}`)
              }
            }
            if (prediction.shouldWarm && prediction.confidence >= 0.6 && prediction.similarEntries.length > 0) {
              try {
                const titleCase = TOOL_NAME_NORMALIZE[t]
                if (titleCase) {
                  const argsJson = stableJson(args ?? inArgs ?? {})
                  const curHash = createHash("sha256").update(`${titleCase}\n${argsJson}\n`).digest("hex").slice(0, 16)
                  const sessionDir = getSessionScratchpadDir()
                  const globalDir = SCRATCHPAD_GLOBAL_DIR
                  const ptrPath = join(sessionDir, `${curHash}.ptr`)
                  if (!existsSync(ptrPath)) {
                    for (const similar of prediction.similarEntries) {
                      const targetHash = similar.entry.hash
                      if (targetHash.length < 16) continue
                      const cachedFile = join(sessionDir, `${targetHash}.txt`)
                      const globalFile = join(globalDir, `${targetHash}.txt`)
                      if (existsSync(cachedFile) || existsSync(globalFile)) {
                        ensureSessionScratchpadDirs()
                        writeFileSync(ptrPath, JSON.stringify({
                          contentHash: targetHash,
                          tool: titleCase,
                          warmed: true,
                          at: new Date().toISOString(),
                          confidence: prediction.confidence,
                          reason: prediction.reason,
                        }))
                        if (DEBUG_INTERNALS) {
                          console.error(`[vibeOS] 🔮 Smart cache: warmed ${t} → ${targetHash.slice(0,8)} (conf: ${(prediction.confidence * 100).toFixed(0)}%)`)
                        }
                        break
                      }
                    }
                  }
                }
              } catch (warmErr) {
                if (DEBUG_INTERNALS) {
                  console.error(`[vibeOS] Smart cache warming error: ${warmErr.message}`)
                }
              }
            }
          }
        }
      } catch (scErr) {
        if (DEBUG_INTERNALS) {
          console.error(`[vibeOS] Smart cache error: ${scErr.message}`)
        }
      }
    }
  }

  // Credit < 40% + Task: force to cheap slot (mirrors CC's rwh path).
  let _credit = loadCredit()
  if (_credit < 40) {
    try {
      const refreshed = await refreshCreditSnapshot()
      if (Number.isFinite(refreshed)) _credit = refreshed
    } catch (creditErr) {
      if (DEBUG_INTERNALS) console.error(`[vibeOS] credit refresh error: ${creditErr.message}`)
    }
  }
  // Subagent routing reads the single source of truth (control vector / worker
  // slot in selection state) below. No credit / remote / ML / escalation layers.
  if (t === "task" && currentModel && ((args && typeof args === "object") || (inArgs && typeof inArgs === "object"))) {
    // OpenCode versions differ on where task args are consumed and what
    // key name is used for model. Update both input/output arg objects and
    // all known key variants so routing sticks.
    const targetArgs = (
      args ? args
        : input?.args ? input.args
          : {}
    )
    _prompt = (targetArgs?.prompt ?? "").trim().toLowerCase()
    if (typeof targetArgs?.prompt === "string") setActiveJobFromTaskPrompt(targetArgs.prompt)
    const _firstWord = _prompt.split(/\s+/)[0]
    const selection = loadSelection()
    // ── ONE source of truth ──
    // syncControlSettings (onSystemTransform) already decided this turn's worker
    // tier in selection state (regime + stress driven). Escalation (loop / web-
    // search / uncertainty) propagates here via tier_bias -> worker_slot. This
    // is the baseline; read it, never re-derive the regime from scratch.
    //
    // On top of that baseline, per-message ML difficulty (computeDifficulty) may
    // adjust the tier UP OR DOWN for this one message -- bidirectional, never
    // regime-sticky. A cheap-baseline turn escalates when the prompt is
    // genuinely complex; a brain-baseline turn de-escalates when the prompt is
    // genuinely trivial. This wires the ML difficulty engine (previously
    // computed via resolveCascadeRouteDecision but never consulted by real Task
    // routing) into production routing. See docs/live-debug-session-notes.md
    // round 13.
    const _rawSlot = String(selection.worker_slot || selection.selected_slot || "").trim().toLowerCase()
    const _regimeSlot = (_rawSlot === "cheap" || _rawSlot === "medium" || _rawSlot === "brain")
      ? _rawSlot
      : (currentTier === "high" ? "medium" : "cheap")
    const _cascadeRoot = _normalizeCascadeRoot(selection.active_pipeline, _regimeSlot)
    let _slot = _regimeSlot
    let _routeSource = "control-vector"
    let _routeReason = `worker slot ${_regimeSlot}`
    if (input?.mlEnabled !== false && _prompt.length > 0) {
      try {
        const mlDifficulty = computeDifficulty(_prompt)
        if (
          mlDifficulty.confidence >= ML_CONFIDENCE_THRESHOLD &&
          mlDifficulty.level !== "moderate" &&
          _cascadeRoot.includes(mlDifficulty.suggestedTier) &&
          mlDifficulty.suggestedTier !== _regimeSlot
        ) {
          _slot = mlDifficulty.suggestedTier
          _routeSource = "ml"
          _routeReason = `ml ${mlDifficulty.level} score=${mlDifficulty.score.toFixed(2)} conf=${mlDifficulty.confidence.toFixed(2)} (regime=${_regimeSlot})`
        }
      } catch (mlErr) {
        if (DEBUG_INTERNALS) console.error(`[vibeOS] ML per-turn route adjustment error: ${mlErr.message}`)
      }
    }
    const _routePath = normalizeRoutePath(_cascadeRoot, _slot)
    const routeDecision = {
      selectedModel: _modelForSlot(_slot, TRINITY_CHEAP, TRINITY_MEDIUM, TRINITY_BRAIN),
      selectedSlot: _slot,
      selectedSubagent: taskSubagentTypeForSlot(_slot),
      requiresDelegation: _slot === "medium" || _slot === "brain",
      shouldOverrideLocal: true,
      delegationReason: _routeReason,
      reason: _routeReason,
      source: _routeSource,
      routePath: _routePath,
      cascadeRoot: _cascadeRoot,
      cascadeDepth: _routePath.length || 1,
    }
    try {
      const _bbState = loadBlackboxState()
      const _sid = _OC_SID
      if (_bbState?.sessions?.[_sid]) {
        _bbState.sessions[_sid].pipeline_root = routeDecision.cascadeRoot
        _bbState.sessions[_sid].cascade_depth = routeDecision.cascadeDepth
        _bbState.sessions[_sid].route_path = routeDecision.routePath
        _saveBlackboxState(_bbState)
      }
    } catch (_bbErr) {
      if (DEBUG_INTERNALS) console.error("[vibeOS] CV persistence error:", _bbErr?.message || _bbErr)
    }
    const _target = routeDecision?.selectedModel || null

    if (_target) noteTaskRoutingLearning(_firstWord, _target, `tier:${currentTier}`)
    if (_target && (targetArgs?.model !== _target || (routeDecision?.selectedSubagent && targetArgs?.subagent_type !== routeDecision.selectedSubagent))) {
      const _reason = routeDecision?.reason || `tier=${currentTier}`
      const turnId = buildTurnId({
        sessionId: getCurrentSessionId(),
        prompt: String(targetArgs?.prompt || latestUserIntent || ""),
        salt: Date.now(),
      })
      const _setModel = (obj) => {
        if (!obj || typeof obj !== "object") return
        obj.model = _target
        obj.modelID = _target
        obj.modelId = _target
        if (routeDecision?.selectedSubagent) obj.subagent_type = routeDecision.selectedSubagent
        obj._vibe_turn_id = turnId
      }
      const enrichedRouteDecision = {
        ...routeDecision,
        turnId,
      }
      const bridge = buildSessionBridge({
        sessionId: getCurrentSessionId(),
        fromModel: currentModel,
        fromTier: currentTier,
        toModel: _target,
        toTier: routeDecision?.selectedSlot || (classify(_target) === "mid" ? "medium" : classify(_target) === "high" ? "brain" : "cheap"),
        reason: _reason,
        prompt: String(targetArgs?.prompt || ""),
        userText: latestUserIntent || "",
        activePipeline: routeDecision?.cascadeRoot || loadSelection().active_pipeline || [],
        projectFingerprint: currentProjectFingerprint,
        projectName: currentProjectName || "",
        sourceStrategy: routeDecision?.source || "control-vector",
        routeDecision: enrichedRouteDecision,
        turnId,
      })
      enrichedRouteDecision.bridgeId = bridge?.bridge_id || null
      enrichedRouteDecision.parentSessionId = getCurrentSessionId()
      enrichedRouteDecision.status = "completed"
      // Task delegation records an executed worker leg, not the final visible
      // assistant answer. The footer must not project this worker model onto
      // the orchestrator response unless a later finalize event says it did.
      enrichedRouteDecision.contributedToFinalAnswer = false
      if (typeof targetArgs?.prompt === "string" && bridge.prompt_prefix) {
        targetArgs.prompt = `${bridge.prompt_prefix}${targetArgs.prompt}`
      }
      _setModel(targetArgs)
      _setModel(args)
      _setModel(inArgs)
      recordSessionBridge(bridge)
      recordTurnRoute({
        sessionId: getCurrentSessionId(),
        turnId,
        prompt: String(targetArgs?.prompt || latestUserIntent || ""),
        plannedRoute: {
          selectedModel: routeDecision?.selectedModel || null,
          selectedSlot: routeDecision?.selectedSlot || null,
          selectedSubagent: routeDecision?.selectedSubagent || null,
          requiresDelegation: Boolean(routeDecision?.requiresDelegation),
          reason: routeDecision?.reason || "",
          source: routeDecision?.source || "",
          routePath: Array.isArray(routeDecision?.routePath) ? routeDecision.routePath : [],
          cascadeRoot: Array.isArray(routeDecision?.cascadeRoot) ? routeDecision.cascadeRoot : [],
          cascadeDepth: Number(routeDecision?.cascadeDepth || 0) || 0,
          backendTarget: routeDecision?.backendTarget || null,
          backendExplicit: Boolean(routeDecision?.backendExplicit),
          localConfidence: Number(routeDecision?.localConfidence || 0) || 0,
          localScore: Number(routeDecision?.localScore || 0) || 0,
        },
        executedRoute: {
          selectedModel: _target,
          selectedSlot: routeDecision?.selectedSlot || (classify(_target) === "mid" ? "medium" : classify(_target) === "high" ? "brain" : "cheap"),
          selectedSubagent: routeDecision?.selectedSubagent || null,
          requiresDelegation: Boolean(routeDecision?.requiresDelegation),
          reason: _reason,
          source: routeDecision?.source || "",
          routePath: Array.isArray(routeDecision?.routePath) ? routeDecision.routePath : [],
          cascadeRoot: Array.isArray(routeDecision?.cascadeRoot) ? routeDecision.cascadeRoot : [],
          cascadeDepth: Number(routeDecision?.cascadeDepth || 0) || 0,
          bridgeId: bridge?.bridge_id || null,
          parentSessionId: getCurrentSessionId(),
          status: "completed",
          contributedToFinalAnswer: false,
        },
      })
      _writeCascadeAudit(String(targetArgs?.prompt || ""), routeDecision?.selectedSlot || null, _target, { ...routeDecision, source: routeDecision?.source || "", reason: _reason }, {
        sessionId: getCurrentSessionId(),
        turnId,
        bridgeId: bridge?.bridge_id || null,
        parentSessionId: getCurrentSessionId(),
        selectedSlot: routeDecision?.selectedSlot || null,
        selectedModel: _target,
        source: routeDecision?.source || "",
        routePath: Array.isArray(routeDecision?.routePath) ? routeDecision.routePath : [],
        cascadeDepth: Number(routeDecision?.cascadeDepth || 0) || 0,
        executed: true,
        status: "completed",
      })
      console.error(`[vibeOS] 🔀 Task → ${_target} (${routeDecision?.source || "route"}:${_reason}, path=${(routeDecision?.routePath || []).join("→") || "n/a"}, orchestrator: ${currentModel})`)
    }
  }

  if (FREE.has(t)) return
  if (MONITOR.has(t)) {
    const todosArg = args?.todos || inArgs?.todos || []
    _pendingTodoArgs = Array.isArray(todosArg) ? todosArg : [todosArg]
    return
  }
  // Free models have no per-turn cost — no savings to enforce.
  // Keep docs/webfetch accounting alive so context7 misses still write state.
  if (isModelFree(currentModel) && !SOFT_QUOTA.has(t)) return

  // Dynamic save estimates derived from actual model pricing.
  const _brainCost  = modelCostPerTurn(currentModel)
  const _workerModel = TRINITY_CHEAP || TRINITY_MEDIUM || null
  const _workerCost  = _workerModel ? (modelCostPerTurn(_workerModel) ?? 0) : 0
  // Keep precision high to avoid dropping tiny but real per-event savings to zero.
  const _rawEdit    = Math.max(0, _brainCost - _workerCost)
  const _estEdit    = Math.max(_rawEdit, SAVE_EST.WRITE_EDIT * 0.1)
  const _estOpus    = Math.max(_brainCost, _estEdit)
  const _estC7      = Math.max(_brainCost, SAVE_EST.CONTEXT7)
  const _tierWord   = currentTier === "high" ? "Brain" : currentTier === "mid" ? "Medium" : "Budget"
  const _firstWord = extractFirstWordFromArgs(t, args || inArgs)
  const sel = loadSelection()
  const compatibilityMode = sel.onboarding_mode === "assist"

  // Self-modification protection: never allow writes to project source trees.
  // This must run before credit gating so protected files are blocked even
  // when the session is in low-credit mode.
  if (WARN_ON_DIRECT.has(String(t || "").toLowerCase())) {
    const argSources = _toolArgSources(input, output)
    const checkPath = argSources
      .flatMap((src) => [src?.filePath, src?.file_path, src?.path])
      .find((v) => typeof v === "string" && v.trim()) || ""
    if (_isProtectedToolPath(checkPath)) {
      _mutateBlockedToolArgs(t, argSources, checkPath, output)
      if (shouldLogWarn(`${t}|protect|${checkPath}`)) console.error(`[vibeOS] [protection] BLOCKED direct ${t} in self-protected directory: ${checkPath}`)
      pendingUiNote = `[LOCK] Self-modification paused: ${basename(checkPath)} is in a protected project tree. Use a manual git workflow.`
      enforcementBlocked = true
      return
    }
  }

  // Cost anomaly detection: warn if this model's per-turn cost spikes
  // significantly above the session rolling average.
  const costDetector = getCostAnomalyDetector()
  if (!costDetector.disabled && currentModel) {
    const modelCost = modelCostPerTurn(currentModel)
    const fullModelName = currentModel
    if (costDetector.checkAnomaly(fullModelName, modelCost)) {
      const avg = costDetector.currentAnomalyMean
      const ratio = avg > 0 ? (modelCost / avg).toFixed(1) : "?"
      const msg = `Cost spike: ${shortModelName(fullModelName)} at $${modelCost.toFixed(4)}/turn — ${ratio}x above the recent average of $${avg.toFixed(4)}. Switch to \`trinity medium\` or \`trinity cheap\` to keep momentum.`
      if (shouldLogWarn(`${t}|cost-anomaly|${fullModelName}|${modelCost.toFixed(4)}`)) {
        console.error(`[vibeOS] [cost-anomaly] ${msg}`)
      }
      pendingUiNote = `[SLOW DOWN] ${msg}`
      enforcementBlocked = true
      return
    }
    costDetector.record(modelCost)
  }

  const tLower = String(t || "").toLowerCase()

  const lowCreditNudge = _credit < 40 && !compatibilityMode

  // Credit < 40%: always record savings, cap UI note at MAX_WARNS_PER_TOOL per tool type per session.
  if (lowCreditNudge) {
    const _total = recordSaving(t, "credit<40% high-tier", _estEdit, {
      firstWord: _firstWord,
      projectFingerprint: currentProjectFingerprint,
      projectName: currentProjectName || "",
      sessionId: getCurrentSessionId(),
    })
    const warnKey = `${getCurrentSessionId()}|${t}|lowCredit`
    const warnCount = _warnCounts[warnKey] || 0
    if (warnCount < MAX_WARNS_PER_TOOL) {
      _warnCounts[warnKey] = warnCount + 1
      const msg = `[vibeOS] Quick win: ${resolveTierIcon("cheap")} cheap lane open · switch to ${resolveTierIcon("medium")} medium to save about ~$${_estEdit.toFixed(3)}/turn.`
      if (shouldLogWarn(`${t}|credit|${_tierWord}`) && process.env.VIBEOS_DEBUG_DELEGATION === "1") {
        console.error(`[vibeOS] [delegation] ${msg}`)
      }
      pendingUiNote = msg
    }
    if (!WARN_ON_DIRECT.has(tLower)) return
  }

  // Write/Edit/NotebookEdit: enforce delegation on high tier when delegation_enforce is on.
  if (WARN_ON_DIRECT.has(tLower)) {
    const argSources = _toolArgSources(input, output)
    if (process.env.VIBEOS_DEBUG_DELEGATION === "1") console.error(`[vibeOS] [enforce-debug] tool=${t} tier=${currentTier} enforce=${sel?.delegation_enforce} argsType=${typeof args} argsExists=${argSources.length > 0}`)
    if (!compatibilityMode && sel.delegation_enforce && currentTier === "high") {
      const coherence = runtimeTierCoherence(projectDirectory, sel?.active_slot || "", currentModel || "", TRINITY_BRAIN || "")
      if (!coherence.coherent) {
        pendingUiNote = `[vibeOS repair] Direct ${t} allowed because runtime tier binding is not coherent: slot=${coherence.slot || "unknown"} default_agent=${coherence.agent || "unset"} expected_agent=${coherence.expectedAgent || "build|plan|vibe"} model=${coherence.currentModel || "unset"} expected_model=${coherence.expectedModel || "unset"}. Run \`vibe diagnose cascade\` or \`vibe repair-state apply\`.`
        if (shouldLogWarn(`${t}|runtime-drift|${coherence.slot || "unknown"}`)) console.error(`[vibeOS] [runtime-drift] allowing direct ${t}; ${pendingUiNote}`)
        return
      }

      const apiResult = await remoteCall("delegateCheck", [tLower, currentTier, currentModel, _prompt], () => ({
        blocked: false,
        savings: 0,
        _fallback: true,
      }))
      const remoteSavings = Number(apiResult?.savings)
      const savings = Number.isFinite(remoteSavings) ? Math.min(remoteSavings, _estEdit) : _estEdit
      const MIN_MEANINGFUL_SAVINGS = 0.001
      const isFallback = apiResult?._fallback === true
      // When the remote API is offline/degraded (fallback), delegation enforcement
      // must stay live locally — a fallback is treated as enforcement-eligible so the
      // local delegation warning still fires and savings/warn state is written, rather
      // than silently bailing out and leaving brain-tier writes unenforced offline.
      const isBlocked = apiResult?.blocked !== false && (isFallback || savings >= MIN_MEANINGFUL_SAVINGS)

      if (isBlocked) {
        const _total = recordSaving(t, "delegation suggested", savings, {
          firstWord: _firstWord,
          projectFingerprint: currentProjectFingerprint,
          projectName: currentProjectName || "",
          sessionId: getCurrentSessionId(),
        })
        const taskModel = TRINITY_CHEAP || TRINITY_MEDIUM || currentModel || TRINITY_BRAIN || ""
        // vibeOS v2: enforcement is NON-BLOCKING. Blocking direct writes on the
        // strong tier fought the model and spammed the GUI (and blocked user
        // read/write in search sessions). The deterministic quality gate now
        // verifies outcomes instead; this path only suggests, capped, and lets
        // the tool run.
        const suggestKey = `${getCurrentSessionId()}|${t}|suggest`
        const suggestCount = _warnCounts[suggestKey] || 0
        if (suggestCount < MAX_WARNS_PER_TOOL) {
          _warnCounts[suggestKey] = suggestCount + 1
          pendingUiNote = `[delegation] ${t} on the strong tier — a task subagent (model="${taskModel}") could do it cheaper. Not blocked.`
        }
        if (shouldLogWarn(`${t}|suggest|${_tierWord}`)) console.error(`[vibeOS] [delegation] suggested Task for ${t} on high tier (non-blocking)`)
        return
      }
      const _total = recordSaving(t, "direct edit", _estEdit, {
        firstWord: _firstWord,
        projectFingerprint: currentProjectFingerprint,
        projectName: currentProjectName || "",
        sessionId: getCurrentSessionId(),
      })
      if (isFallback || !compatibilityMode) {
        const directWarnKey = `${getCurrentSessionId()}|${t}|direct`
        const directWarnCount = _warnCounts[directWarnKey] || 0
        if (directWarnCount < MAX_WARNS_PER_TOOL) {
          _warnCounts[directWarnKey] = directWarnCount + 1
          const msg = `[vibeOS] ${resolveTierIcon("cheap")} cheap lane · save about ~$${_estEdit.toFixed(3)} by delegating to Task. Try ${resolveTierIcon("medium")} medium.`
          if (shouldLogWarn(`${t}|direct|${_tierWord}`) && process.env.VIBEOS_DEBUG_DELEGATION === "1") {
            console.error(`[vibeOS] [delegation] ${msg}`)
          }
          pendingUiNote = msg
        }
        return
      }
    }
  }

  if (SOFT_QUOTA.has(t)) {
    // Loop circuit-breaker (bash only): catch tool-call poll/repeat loops that the
    // text-similarity detector misses — e.g. `sleep 600 && gh pr view 348` re-run
    // for hours. Warn first, then hard-block by neutralizing the command.
    if (t === "bash") {
      const command = String(args?.command ?? args?.cmd ?? args?.script ?? inArgs?.command ?? inArgs?.cmd ?? inArgs?.script ?? "")
      if (command) {
        const verdict = _loopGuard.observe(command)
        if (verdict.level === "block") {
          const _total = recordSaving(t, `loop blocked (${verdict.kind} x${verdict.count})`, SAVE_EST.LOOP_GUARD, {
            firstWord: _firstWord,
            projectFingerprint: currentProjectFingerprint,
            projectName: currentProjectName || "",
            sessionId: getCurrentSessionId(),
          })
          pendingUiNote = `[loop-guard] Blocked runaway ${verdict.kind} loop (${verdict.count}x). ${verdict.directive}`
          enforcementBlocked = true
          _neutralizeBashLoop(input, output, verdict.directive)
          if (shouldLogWarn(`loop-block|${verdict.signature.slice(0, 60)}`)) {
            console.error(`[vibeOS] [loop-guard] BLOCKED ${verdict.kind} loop (${verdict.count}x): ${verdict.signature.slice(0, 80)}`)
          }
          return
        }
        if (verdict.level === "warn" && _loopWarnedSig !== verdict.signature) {
          _loopWarnedSig = verdict.signature
          console.error(`[vibeOS] [loop-guard] ${verdict.kind} repeated ${verdict.count}x — ${verdict.directive}`)
        }
      }
    }
    // Context7 nudge / install-suggestion / per-session alert (WebFetch/WebSearch only).
    if (t !== "bash") {
      const target = args?.url || args?.query || ""
      if (isDocsTarget(target) && !context7Seen.has(target)) {
        context7Seen.add(target)
        // Re-check each time — context7 might be added mid-session
        if (detectContext7()) {
          const _missed = recordMissedContext7(SAVE_EST.CONTEXT7)
          if (shouldLogWarn(`context7-bypass|${t}|${_firstWord || "?"}`)) {
            console.error(`[vibeOS] [cost policy] Context7 available but bypassed — webfetch on docs target instead. ~$${SAVE_EST.CONTEXT7.toFixed(4)}/turn missed.`)
          }
        } else {
          const missed = recordMissedContext7(_estC7)
          if (!existsSync(CONTEXT7_INSTALL_FLAG)) {
            try {
              mkdirSync(dirname(CONTEXT7_INSTALL_FLAG), { recursive: true })
              writeFileSync(CONTEXT7_INSTALL_FLAG, "")
            } catch (c7FlagErr) {
              if (DEBUG_INTERNALS) console.error(`[vibeOS] context7 flag write error: ${c7FlagErr.message}`)
            }
            console.error(`[vibeOS] Small win: install context7 MCP to save about ~$0.06/turn on docs: \`claude mcp add context7 npx @upstash/context7-mcp\``)
          } else if (!context7AlertedThisSession) {
            context7AlertedThisSession = true
            console.error(`[vibeOS] context7 is still off — about ~$${(missed ?? 0).toFixed(2)} in savings slipped this session.`)
          }
        }
      }
    }
    // Soft quota: track per-tool, fire exactly once at QUOTA+1 (tool still runs).
    softQuotaCounts[t] = (softQuotaCounts[t] ?? 0) + 1
    const n = softQuotaCounts[t]
    if (n === SOFT_QUOTA_LIMIT + 1) {
      const _total = recordSaving(t, `soft quota exceeded (limit ${SOFT_QUOTA_LIMIT})`, SAVE_EST.SOFT_QUOTA, {
        projectFingerprint: currentProjectFingerprint,
        projectName: currentProjectName || "",
        sessionId: getCurrentSessionId(),
      })
      console.error(`[vibeOS] Bash usage is getting heavy (${n}/${SOFT_QUOTA_LIMIT}) — hand the next step to a Task subagent.`)
    }
    return
  }
}

export const onToolExecuteAfter = async (input, output) => {
  _refreshModel(projectDirectory)
  const t = input?.tool ?? ""

  try {
    const start = _dequeueTelemetryStart(input?.tool)
    if (start) {
      const outputText = typeof output?.result === "string" ? output.result
        : typeof output?.text === "string" ? output.text
          : typeof output?.content === "string" ? output.content
            : typeof output?.data === "string" ? output.data
              : ""
      const result = output?.error || output?.isError || output?.status === "error" || output?.exitCode > 0
        ? "error"
        : enforcementBlocked ? "blocked"
          : "ok"
      recordPrivacyTelemetry({
        session_id: _OC_SID,
        tool: input?.tool ?? "unknown",
        tier: start.tier || currentTier || "unknown",
        slot: start.slot || loadSelection().active_slot || "unknown",
        kind: start.kind || _toolKind(input?.tool, input?.args || {}),
        prompt_size_bucket: start.prompt_size_bucket || "unknown",
        output_size_bucket: _bucketChars(String(outputText || "").length),
        duration_bucket: _bucketMs(Date.now() - Number(start.startedAt || Date.now())),
        result,
        cache_hit: start.cache_hit === true,
        enforcement: loadSelection().delegation_enforce ? "on" : "off",
        flow: loadSelection().flow_enforce ? "on" : "off",
        tdd: loadSelection().tdd_enforce ? "on" : "off",
      })
    }
  } catch (telemetryErr) {
    if (DEBUG_INTERNALS) console.error(`[vibeOS] telemetry error: ${telemetryErr.message}`)
  }

  try { incrementTurnCounter() } catch (e) {
    if (DEBUG_INTERNALS) console.error(`[vibeOS] incrementTurnCounter error: ${e.message}`)
  }

  // ── Generate footer alert (prepended to tool result, visible in chat) ──
  let _footerText = ""
  try {
    if (t !== "task") {
      const { ltTasks, ltCache, ltCost, sesTrend, sesTaskDelegations } = readLifetimeSavings()
      const ltTotal = ltTasks + ltCache
      const selNow = loadSelection()
      let liveModel = ""
      try {
        const cfg = await client.config.get("model")
        if (cfg) liveModel = String(cfg)
      } catch (cfgErr) {
        if (DEBUG_INTERNALS) console.error(`[vibeOS] config.get error: ${cfgErr.message}`)
      }
      if (!liveModel) {
        liveModel = readConfig(projectDirectory) || readConfig(join(process.env.HOME || "", ".config", "opencode")) || process?.env?.OPENCODE_MODEL || ""
      }
      const displayModel = resolveTrinityDisplayModel(projectDirectory, selNow.active_slot || "", liveModel, currentModel) || liveModel || currentModel
      const resolvedModel = displayModel || liveModel || currentModel || ""
      if (resolvedModel && resolvedModel !== currentModel) {
        setCurrentModel(resolvedModel)
        setCurrentTier(classify(resolvedModel))
      }
      const execution = resolveExecutionIdentity(displayModel || resolvedModel || "", projectDirectory)
      const currentSid = _OC_SID
      const currentSubRegime = loadBlackboxState()?.sessions?.[currentSid]?.sub_regime || classifyTurnSimple(latestUserIntent || "")
      const bbMode = resolveEnforcementMode()
      const enfTags = buildEnforcementTags({
        delegationEnforce: selNow.delegation_enforce,
        flowEnforce: selNow.flow_enforce,
        tddEnforce: selNow.tdd_enforce,
        bbMode,
        modelLocked: _modelLocked,
        quietIntent: isGreetingLike(latestUserIntent || ""),
      })
      const backendMode = String(
        selNow.requested_optimization_mode ||
        selNow.optimization_mode ||
        loadOptimizationMode() ||
        loadBlackboxState()?.cv?.optimization_mode ||
        "",
      ).trim().toLowerCase()
      const displayMode = backendMode || autoSelectMode(currentSubRegime, latestUserIntent ? scoreStress(latestUserIntent) : 0)
      const cascadeState = loadBlackboxState()
      const cascadeSession = cascadeState?.sessions?.[currentSid] || {}
      const rawCascadeDepth = Number(cascadeSession?.cascade_depth ?? cascadeState?.control_vector?.cascade_depth ?? 0) || 0
      // VibeUltraX cascade: tier follows the LIVE model's trinity slot so the
      // header stays coherent (cheap entry \u2192 "\u26A1 cheap | Big Pickle"; escalated
      // to the medium-slot model \u2192 "\u25D0 medium | V4 Flash"), instead of pinning
      // the tier to cheap while the model name shows a higher tier. resolved_tier is the
      // BE-classify path's own authoritative field (chat-transform.ts) and takes priority;
      // otherwise resolveActiveCascadeTier reads route_path \u2014 the same array the depth
      // icon uses \u2014 so tier label and icon can never disagree.
      const _ultraSlot = () => {
        const _rTier = String(cascadeSession?.resolved_tier || "").toLowerCase()
        if (_rTier === "cheap" || _rTier === "medium" || _rTier === "brain") return _rTier
        return resolveActiveCascadeTier({
          liveSession: cascadeSession,
          liveModel: displayModel || resolvedModel || "",
          trinityCheap: TRINITY_CHEAP,
          trinityMedium: TRINITY_MEDIUM,
          trinityBrain: TRINITY_BRAIN,
          classify,
        }).tier
      }
      const activeSlot = displayMode === "vibeultrax"
        ? _ultraSlot()
        : selNow.active_slot || resolveOptimizationSlot(displayMode) || (execution.quality === "brain" ? "brain" : execution.quality === "medium" ? "medium" : "cheap")
      // liveModelDepth classifies the model actually being shown, independent
      // of route_path/cascade_depth (which is regime+mode-planned and can
      // stay pinned at a deep tier long after delegation stops -- the same
      // signal activeSlot/_ultraSlot reads for its route-path branch, so it
      // must NOT be reused here as the fallback).
      const _liveModelTier = classify(displayModel || resolvedModel || currentModel || "")
      const liveModelDepth = _liveModelTier === "high" ? 3 : _liveModelTier === "mid" ? 2 : 0
      const cascadeDepth = (() => {
        try {
          return clampCascadeDepthToTurnTruth(rawCascadeDepth, liveModelDepth, getLatestRouteEvent(currentSid, 10))
        } catch {
          return Math.min(rawCascadeDepth, liveModelDepth)
        }
      })()
      const vibeBrand = resolveBrand(displayMode, activeSlot)
      const sessionSlot = loadSessionSlot(currentSid)
      const flashIcon = isApiConnected() ? " \u26A1" : ""
      _footerText = buildFooterLine({
        activeSlot,
        providerLabel: execution.provider_label,
        modelName: modelDisplayName(execution.model),
        ltTotal,
        ltTrend: sesTrend || "",
        vibeBrand,
        optMode: displayMode,
        flashIcon,
        enfTags,
        sessionSlot,
        subRegime: currentSubRegime,
        cascadeIcon: cascadeDepth >= 3 ? "▸▸▸" : cascadeDepth >= 2 ? "▸▸" : cascadeDepth >= 1 ? "▸" : "",
        cascadeLabel: cascadeDepth >= 2 ? modelDisplayName(execution.model) : "",
      }) + "\n\n"
      _prependFooterAlert(_payload(output), _footerText)

      _autoReportCount = (_autoReportCount || 0) + 1
      if (_autoReportCount % 5 === 0 && ltTotal > 0) {
        setTimeout(() => {
          try {
            saveReport({
              type: "session", summary: `Session cost: $${formatUsd(ltCost)} | cache saved: $${formatUsd(ltCache)} | delegation saved: $${formatUsd(ltTasks)}`,
              metrics: {
                sessionId: _OC_SID,
                sessionCost: ltCost,
                cacheSavings: ltCache,
                delegationSavingsUsd: ltTasks,
                taskDelegationCount: sesTaskDelegations,
                tasksDelegated: sesTaskDelegations,
                model: resolvedModel || currentModel,
                slot: selNow.active_slot || "unknown",
              },
              tags: ["auto", "cost"],
            })
          } catch (reportErr) {
            if (DEBUG_INTERNALS) console.error(`[vibeOS] saveReport error: ${reportErr.message}`)
          }
        }, 0)
      }
    }
  } catch (footerErr) {
    if (DEBUG_INTERNALS) console.error(`[vibeOS] footer error: ${footerErr.message}`)
  }

  // ── Increment turn counter for compaction trigger ──
  // (already incremented above)

  if (t === "trinity") {
    const trinityArgs = input?.args || {}
    const trinityAction = trinityArgs?.action || trinityArgs?.todo || ""
    if (trinityAction === "todo") {
      try {
        const flowTodoFilePath = join(getVibeOSHome(), ".flow-todo-queue.jsonl")
        let todoLines: string[] = []
        if (existsSync(flowTodoFilePath)) {
          const raw = readFileSync(flowTodoFilePath, "utf-8").trim()
          todoLines = raw ? raw.split("\n").filter(Boolean) : []
        }
        let todoList = todoLines.map((l, i) => {
          try { const p = JSON.parse(l); return "  " + (i+1) + ". " + (p.text || l) }
          catch { return "  " + (i+1) + ". " + l }
        }).join("\n")
        const todoNote = "[vibeOS] Flow TODO Queue: " + todoLines.length + " item(s)\n" + (todoList || "  (no pending TODOs)")
        if (typeof output?.text === "string")
          output.text = todoNote + "\n\n" + output.text
        else if (typeof output?.result === "string")
          output.result = todoNote + "\n\n" + output.result
      } catch (e) {
        console.error("[vibeOS] trinity todo error:", e)
      }
    }
    return
  }

  // Save ML state after Task or key tools (throttled to avoid excessive I/O).
  if ((t === "task" || t === "bash" || t === "edit" || t === "write") && !_mlSavePending) {
    setMlSavePending(true)
    setTimeout(() => { saveMLState(); setMlSavePending(false) }, 5000)
  }

  // Show human-friendly slot label in the UI title for Task subagents.
  if (t === "task") {
    const m = input?.args?.model
    if (m && typeof output?.title === "string") {
      const label = modelToSlotLabel(m)
      output.title = output.title.replace(/\[agent\]|\[general\]/gi, label)
      if (!output.title.includes(label)) output.title = `${output.title} ${label}`
    }
  }

  // Quality scoring for task outputs
  if (t === "task") {
    const taskOutput = output?.result || output?.text || output?.state?.output || output?.state?.result || ""
    const taskPrompt = input?.args?.prompt || input?.args?.description || ""
    const quality = scoreTaskQuality(taskOutput, taskPrompt)
    try {
      appendFileSync(SAVINGS_LEDGER_FILE, JSON.stringify({
        at: new Date().toISOString(),
        kind: "quality",
        score: quality,
        tool: t,
        sid: _OC_SID,
        v: 2,
      }) + "\n")
    } catch (ledgerErr) {
      if (DEBUG_INTERNALS) console.error(`[vibeOS] ledger append error: ${ledgerErr.message}`)
    }
    updateState((s) => {
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" }
      s.lifetime.quality_total_score = (s.lifetime.quality_total_score || 0) + quality
      s.lifetime.quality_total_count = (s.lifetime.quality_total_count || 0) + 1
      s.lifetime.last_updated = new Date().toISOString()
      return s
    })
  }

  // Verified savings (vibeOS v2): only completed task delegations count as real
  // savings — the delta between the active strong model and the task subagent's
  // actual model. Estimates (est_savings_usd) are never displayed as real.
  if (t === "task") {
    try {
      const taskModel = String(input?.args?.model || "").trim() || TRINITY_CHEAP || ""
      const strongCost = Number(modelCostPerTurn(currentModel) || 0)
      const taskCost = taskModel ? Number(modelCostPerTurn(taskModel) || 0) : 0
      const delta = Math.max(0, strongCost - taskCost)
      if (delta > 0) {
        const sid = getCurrentSessionId() || _OC_SID
        updateState((s) => {
          s.sessions ??= {}
          s.sessions[sid] ??= {}
          s.sessions[sid].verified_savings_usd = (Number(s.sessions[sid].verified_savings_usd) || 0) + delta
          s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" }
          s.lifetime.verified_savings_usd = (Number(s.lifetime.verified_savings_usd) || 0) + delta
          s.lifetime.last_updated = new Date().toISOString()
          return s
        })
      }
    } catch {}
  }

  function _payload(obj) {
    if (obj?.message && typeof obj.message === "object") return obj.message
    return obj
  }

  if (enforcementBlocked) {
    const target = _payload(output)
    const blockMsg = pendingUiNote || `[delegation] ${String(input?.tool || "tool")} blocked by enforcement`
    const replaceIfNeeded = (key) => {
      if (typeof target?.[key] === "string" && /oldString not found/i.test(target[key])) target[key] = blockMsg
    }
    replaceIfNeeded("error")
    replaceIfNeeded("result")
    replaceIfNeeded("text")
    replaceIfNeeded("content")
  }

  // Inject pending delegation UI note (set in tool.execute.before).
  // This surfaces the warning in the OC chat transcript, not just stderr.
  if (pendingUiNote) {
    const target = _payload(output)
    if (enforcementBlocked) {
      const note = pendingUiNote
      if (typeof target?.result === "string") target.result += `\n\n${note}`
      else console.error("APPEND_NOTE: text=" + typeof target?.text + " note=" + (note || "").substring(0, 40) + " enforceBlocked=" + enforcementBlocked + " pendingNote=" + (typeof pendingUiNote === "string"))
      if (typeof target?.text === "string") target.text += `\n\n${note}`
      else if (typeof target?.content === "string") target.content += `\n\n${note}`
      else if (typeof target?.error === "string") target.error += `\n\n${note}`
      else target.result = pendingUiNote
    } else {
      const note = `\n\n${pendingUiNote}`
      if (typeof target?.result === "string") target.result += note
      else if (typeof target?.text === "string") target.text += note
      else if (typeof target?.content === "string") target.content += note
      else if (typeof target?.error === "string") target.error += note
      else target.result = pendingUiNote
    }
    pendingUiNote = null
  }

  // Skip test-reminder, TDD, flow enforcement, and compression for blocked tools
  if (enforcementBlocked) { enforcementBlocked = false; return }
  observeToolPattern(t, input, output, projectDirectory)

  // TDD enforcement for task subagent results: scan task output for
  // file paths with source extensions and create skeletons (same logic
  // as the write/edit handler below, but for files written by subagents).
  if (t === "task") {
    const outputText = (output?.result ?? output?.text ?? output?.content ?? "")
    if (typeof outputText === "string" && outputText.length > 0) {
      const TASK_FILE_RE = /((?:\.?[\w@][\w.\-]*\/)+[\w.\-]+\.(?:py|js|ts|mjs|tsx|jsx|cjs|mts|sh|go|rs|rb|java|kt))/gi
      const sel = loadSelection()
      const _explicitTestIntent = isUserAskingForTests(latestUserIntent)
      const seen = new Set()
      let match
      while ((match = TASK_FILE_RE.exec(outputText)) !== null) {
        const fp = match[1]
        if (seen.has(fp)) continue
        seen.add(fp)
        const isTestPath = /(^|\/)(tests?|spec)\//i.test(fp) || /\.(test|spec)\./i.test(fp)
        const intentClass2 = classifyTurnSimple(latestUserIntent)
        const isResearchSession2 = intentClass2 === "EXPLORING" || intentClass2 === "DIVERGENT"
        if (sel.tdd_enforce && !isTestPath && !isResearchSession2) {
          const createdPath = enforceTestFile(fp)
          if (createdPath) {
            const _ext = createdPath.split(".").pop()
            const fileName = createdPath.split("/").pop()
            const enforceNote = "\n\n[test-enforced] Created skeleton at " + createdPath + "\n  NEXT: 1) Open " + fileName + "  2) Replace TODO/FIXME markers with real assertions  3) Run `npx vitest run " + createdPath + "` (or language-equivalent)  4) Confirm tests pass"
            if (typeof output?.text === "string") output.text += enforceNote
            else if (typeof output?.result === "string") output.result += enforceNote
          }
        }
      }
    }
  }

  // Loop guard: nudge when the same edit/write target has failed repeatedly.
  // Bash's loop-guard (see _loopGuard.observe above) can't see this -- edit/write
  // aren't in SOFT_QUOTA and retries often carry different args each time (e.g.
  // a re-guessed oldString), so an exact-repeat signature match would miss it.
  // This instead tracks consecutive FAILURES per file, independent of args.
  if (t === "write" || t === "edit" || t === "multiedit") {
    const _loopFp = input?.args?.filePath || input?.args?.file_path || input?.args?.path || ""
    if (_loopFp) {
      const _loopKey = `${t}:${_loopFp}`
      const _editFailed = Boolean(output?.error || output?.isError || output?.status === "error")
      if (_editFailed) {
        const verdict = _loopGuard.observeEditFailure(_loopKey)
        if (verdict.shouldWarn) {
          const note = `\n\n[loop-guard] This ${t} on ${_loopFp} has failed ${verdict.count}x in a row. Stop retrying with a guessed oldString -- re-read the file fresh with Read and base the next edit on its exact current content.`
          if (typeof output?.text === "string") output.text += note
          else if (typeof output?.result === "string") output.result += note
        }
      } else {
        _loopGuard.clearEditFailure(_loopKey)
      }
    }
  }

  // Test-reminder: nudge when source code is written/edited.
  if (t === "write" || t === "edit" || t === "multiedit") {
    const fp = input?.args?.filePath || input?.args?.file_path || input?.args?.path || ""
    const reminder = buildTestReminder(fp)
    if (reminder) {
      // Surface as a side note via the output; OpenCode renders the
      // tool's text/result in the transcript. We append a short line.
      const note = `\n\n[test-reminder] ${reminder}`
      if (typeof output?.text === "string") output.text += note
      else if (typeof output?.result === "string") output.result += note
      else console.error(`[vibeOS] ${reminder}`)
    }

    // TDD enforcement: auto-create skeleton test if enabled and no test exists.
    const sel = loadSelection()
    const _explicitTestIntent = isUserAskingForTests(latestUserIntent)
    const isTestPath = /(^|\/)(tests?|spec)\//i.test(fp) || /\.(test|spec)\./i.test(fp)
    const intentClass = classifyTurnSimple(latestUserIntent)
    const isResearchSession = intentClass === "EXPLORING" || intentClass === "DIVERGENT"
    if (sel.tdd_enforce && !isTestPath && !isResearchSession) {
      const createdPath = enforceTestFile(fp)
      if (createdPath) {
        const _ext = createdPath.split(".").pop()
        const fileName = createdPath.split("/").pop()
        const enforceNote = `\n\n[test-enforced] Created skeleton at ${createdPath}\n  NEXT: 1) Open ${fileName}  2) Replace TODO/FIXME markers with real assertions  3) Run \`npx vitest run ${createdPath}\` (or language-equivalent)  4) Confirm tests pass`
        if (typeof output?.text === "string") output.text += enforceNote
        else if (typeof output?.result === "string") output.result += enforceNote
      }
    }

    // Detect test-file follow-up edits (telemetry)
    if (t === "edit" || t === "write") {
      const testExtRe = /\.(test|spec)\./i
      if (testExtRe.test(fp)) {
        try {
          updateState((state) => {
            state.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" }
            state.lifetime.tdd_followup_completions = (state.lifetime.tdd_followup_completions || 0) + 1
            state.lifetime.last_updated = new Date().toISOString()
            return state
          })
        } catch (tddStateErr) {
          if (DEBUG_INTERNALS) console.error(`[vibeOS] tdd followup state error: ${tddStateErr.message}`)
        }
      }
    }

    // Project Guard: check edits to protected doc files (AGENTS.md / README.md)
    {
      const fp = input?.args?.filePath || input?.args?.file_path || input?.args?.path || ""
      const guardRe = /(?:^|\/)(AGENTS|README)\.md$/i
      if (guardRe.test(fp)) {
        const guardIcons = { flag: "!", warn: "!!", hint: "_" }
        const guardIcon = guardIcons.flag || "!"
        const fn = basename(fp)
        console.error(`[flow-enforcer] ${guardIcon} [guard] ${fn}: protected project doc modified — verify user intent`)
      }
    }

    // Flow enforcer: check Write/Edit against development-flow rules.
    if (sel.flow_enabled) {
      const toolName = t === "edit" ? "edit" : "write"
      const filePath = input?.args?.filePath || input?.args?.file_path || input?.args?.path || ""
      const content = t === "edit" ? (input?.args?.newString || "") : (input?.args?.content || "")
      const flowHits = checkFlowRules({ tool: toolName, filePath, content })
      for (const h of flowHits) {
        if (h.deduped) continue
        const icon = h.severity === "warn" ? "⚠" : "💡"
        console.error(`[flow-enforcer] ${icon} [${h.severity}] ${h.id}: ${h.description} — ${filePath}`)
      }
      // Flow enforcement: extract TODO/FIXME to queue when flow_enforce is on.
      if (sel.flow_enforce) {
        for (const h of flowHits) {
          if (h.id === "todo-comment" && !h.deduped) {
            recordFlowTodo({ filePath, content })
          }
        }
      }
      let todoCount = 0
      for (const h of flowHits) {
        if (h.id === "todo-comment" && !h.deduped) todoCount++
      }
      if (todoCount > 0) {
        const todoPushNote = "[todo-push] Auto-extracted " + todoCount + " TODO(s) from " + filePath + ". Call todowrite to add them to your task list."
        if (typeof output?.text === "string")
          output.text += "\n\n" + todoPushNote
        else if (typeof output?.result === "string")
          output.result += "\n\n" + todoPushNote
      }
    }
  }

  // ── todowrite result parsing ──
  if (t === "todowrite") {
    try {
      const todoArgs = (_pendingTodoArgs && _pendingTodoArgs.length > 0)
        ? _pendingTodoArgs
        : (Array.isArray(input?.args?.todos) ? input.args.todos : input?.args?.todos ? [input.args.todos] : [])
      for (const entry of todoArgs) {
        if (entry && entry.content) {
          upsertTodo({
            content: entry.content,
            filePath: entry.filePath || "",
            priority: entry.priority || "medium",
            source: "intercepted",
          })
        }
      }
      if (todoArgs.length > 0) console.error("[vibeOS] tracked " + todoArgs.length + " todo(s) from todowrite call")
    } catch (todoErr) {
      if (DEBUG_INTERNALS) console.error(`[vibeOS] todowrite parse error: ${todoErr.message}`)
    }
    _pendingTodoArgs = null
  }

  // Compress verbose tool outputs before they bloat context.
  // Only webfetch — task results contain synthesized data the brain needs verbatim.
  if (t !== "webfetch") {
    // Run decadence even for non-webfetch tools (opportunistic maintenance)
    applyDecadence()
    return
  }

  // Try multiple output paths (plugin API may vary)
  const raw = output?.result ?? output?.text ?? output?.content ?? output?.data
  if (!raw || typeof raw !== "string") { applyDecadence(); return }

  const processed = compressText(raw)
  // Note: the Worker-to-Brain protocol is now injected via the
  // `experimental.chat.messages.transform` hook below as a separate
  // text content block, not prepended to the worker output. This keeps
  // worker output and orchestrator directive cleanly separated.

  if (processed !== raw) {
    // Write back to whichever field held the original
    if (output.result !== undefined) output.result = processed
    else if (output.text !== undefined) output.text = processed
    else if (output.content !== undefined) output.content = processed
    else if (output.data !== undefined) output.data = processed
  }
  applyDecadence()
}
