// @ts-nocheck
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import { createHash } from "node:crypto"
import {
  currentTier, currentModel, setCurrentModel, setCurrentTier, currentProjectFingerprint, currentProjectName, getCurrentSessionId,
  _textCompletePainted, softQuotaCounts, enforcementBlocked,
  pendingUiNote, _briefedProjects, _OC_SID, _modelLocked, _blackboxEnabled,
  _autoReportCount, scratchpadHitsSeen, context7AlertedThisSession,
  loadSelection, _writeSelection, readLifetimeSavings,
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
  ML_ENABLED, _mlGraph, _cacheDb, _mlSavePending, ML_CONFIDENCE_THRESHOLD, setMlSavePending,
  _loadMLState, saveMLState,
  _readJsonOrEmpty, _handleStateCorruption, _lockPathFor,
  SCRATCHPAD_TOOLS, SCRATCHPAD_GLOBAL_DIR, TOOL_NAME_NORMALIZE, stableJson, applyDecadence,
  _VIBEOS_HOME,
} from "../state.js"
import {
  classify, modelCostPerTurn, isModelFree, detectContext7, isDocsTarget,
  shortModelName, formatUsd, _refreshModel, readConfig, resolveTrinityDisplayModel, TRINITY_CHEAP, TRINITY_MEDIUM, TRINITY_BRAIN,
  cacheSavePer1MInputTokens,
  _trendDisplay, modelToSlotLabel, resolveExecutionIdentity, _formatProviderName, _formatQualityName, modelDisplayName,
} from "../pricing.js"
import { latestUserIntent } from "./chat-transform.js"
import { loadSessionSlot } from "../selection-manager.js"
import { loadCredit, refreshCreditSnapshot } from "../credit-api.js"
import { buildFooterLine, buildEnforcementTags, resolveBrand, resolveTierIcon } from "./shared-footer.js"
import { getVibeOSHome } from "../state.js"

function isGreetingLike(text: string): boolean {
  const value = String(text || "").trim().toLowerCase()
  return value === "hi" || value === "hello" || value === "hey" || value === "yo" || /^hi[!.?\s]*$/.test(value) || /^hello[!.?\s]*$/.test(value) || /^hey[!.?\s]*$/.test(value)
}
import {
  scoreStress, extractFirstWordFromArgs, shouldLogWarn, classifyTurnSimple, autoSelectMode, resolveOptimizationSlot,
  isUserAskingForTests, _isLikelyOffTopic, resolveEnforcementMode,
  _getBlackboxTracker, loadBlackboxState, saveBlackboxState as _saveBlackboxState,
  _loadGlobalLearning, _updateGlobalLearning, getLearnedExploratoryWords,
  noteTaskRoutingLearning,
  incrementTurnCounter,
} from "../turn-classify.js"
import { saveReport } from "../reporting.js"
import { getApiClient, remoteCall, isApiConnected } from "../api-client.js"
import { getCostAnomalyDetector } from "../cost-anomaly.js"
import { checkFlowRules, recordFlowTodo } from "../../vibeOS-lib/flow-enforcer.js"
import { computeDifficulty, cascadeDecide, addRouteEdge, predictBestModel, hashQuery } from "../../vibeOS-lib/ml-router.js"
import { addCacheEntry, recordCacheStats, predictCacheHit } from "../../vibeOS-lib/smart-cache.js"
import { buildTestReminder, enforceTestFile } from "../tdd-enforcer.js"
import { setActiveJobFromTaskPrompt, observeToolPattern, compressText, recordSaving } from "../index-helpers.js"
import { buildSessionBridge, recordSessionBridge } from "../session-bridge.js"
import { scoreTaskQuality } from "./footer.js"
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
let pendingUiNote = null
let enforcementBlocked = false
let scratchpadHitsSeen = new Set()
let softQuotaCounts = {}
let context7AlertedThisSession = false
let context7Seen = new Set()
let _prompt = ""
let _autoReportCount = 0
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

function _isProtectedToolPath(pathValue) {
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

export function vibeUltraXSubagentForSlot(slot: string | null): string | null {
  if (slot === "brain") return "vibe-brain"
  if (slot === "medium") return "vibe-medium"
  if (slot === "cheap") return "vibe-cheap"
  return null
}

export function taskSubagentTypeForSlot(slot: string | null): string | null {
  if (slot === "brain" || slot === "medium" || slot === "cheap") return "general"
  return null
}

function _normalizeCascadeRoot(activePipeline: unknown, fallbackSlot: string | null): string[] {
  const root = Array.isArray(activePipeline)
    ? activePipeline.map((entry) => String(entry || "").trim().toLowerCase()).map((entry) => entry === "local" ? "cheap" : entry).filter((entry) => entry === "cheap" || entry === "medium" || entry === "brain")
    : []
  if (root.length > 0) return root
  return fallbackSlot ? [fallbackSlot] : []
}

function _routePathForSlot(root: string[], slot: string | null): string[] {
  if (!slot) return root.length ? [root[0]] : []
  const idx = root.indexOf(slot)
  if (idx >= 0) return root.slice(0, idx + 1)
  if (slot === "brain") return ["cheap", "medium", "brain"]
  if (slot === "medium") return ["cheap", "medium"]
  return ["cheap"]
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
  let selectedModel = backendRoute?.target ? String(backendRoute.target) : cascadeSelectedModel
  let selectedSlot = backendRoute?.target ? (backendRoute?.target_slot || backendRoute?.targetSlot || _slotFromModel(selectedModel, trinityCheap, trinityMedium, trinityBrain)) : cascadeSelectedSlot
  let source = backendRoute?.target ? "backend" : cascadeSource
  let reason = backendRoute?.target ? (backendRoute?.reason || "backend route") : cascadeReason
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
        const slot = cascadeRoot.length > 2 && cascadeDecision.confidence >= 0.8 ? cascadeRoot[2] : cascadeRoot[1]
        const model = _modelForSlot(slot, trinityCheap, trinityMedium, trinityBrain)
        if (model) {
          applyLocalCandidate(slot, model, "cascade", cascadeDecision.reason)
        }
      } else if (cascadeDecision.useCheap && !cascadeSelectedModel) {
        applyLocalCandidate(cascadeRoot[0], _modelForSlot(cascadeRoot[0], trinityCheap, trinityMedium, trinityBrain), "cascade", cascadeDecision.reason)
      }
    } catch (err) {
      if (DEBUG_INTERNALS) console.error(`[vibeOS] cascade route resolver error: ${err.message}`)
    }
  }

  if (!backendRoute?.target) {
    selectedModel = (cascadeSource === "stress" || cascadeSource === "cascade") ? cascadeSelectedModel : (explicitTarget || cascadeSelectedModel)
    selectedSlot = (cascadeSource === "stress" || cascadeSource === "cascade") ? cascadeSelectedSlot : (explicitTarget ? _slotFromModel(explicitTarget, trinityCheap, trinityMedium, trinityBrain) : cascadeSelectedSlot)
    source = cascadeSource
    reason = cascadeReason
  }

  const routePath = _routePathForSlot(cascadeRoot, selectedSlot)
  const cascadeRoutePath = _routePathForSlot(cascadeRoot, cascadeSelectedSlot)
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
  if (process.env.VIBEOS_TEST_CONTEXT === "1") _resetWarnCountsForTest()
  if (!loadSelection().enabled) return
  _refreshModel(projectDirectory)
  const t = input?.tool ?? ""
  const args = output?.args
  const inArgs = input?.args
  const telemetryStart = {
    tool: t,
    startedAt: Date.now(),
    kind: _toolKind(t, args || inArgs || {}),
    prompt_size_bucket: _argSizeBucket(t, args || inArgs || {}),
    slot: loadSelection().active_slot || "unknown",
    tier: currentTier || "unknown",
    cache_hit: false,
  }
  _pendingTelemetryStarts.push(telemetryStart)
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
  const creditForceCheap = _credit < 40 && t === "task" && TRINITY_CHEAP && args && typeof args === "object"
  const explicitApiUrl = String(process.env.VIBEOS_API_URL || "").trim()
  const isNodeTestRun = process.execArgv.includes("--test") || process.argv.includes("--test")
  if (creditForceCheap && process.env.VIBEOS_TEST_CONTEXT === "1" && !explicitApiUrl) {
    if (args.model !== TRINITY_CHEAP) {
      args.model = TRINITY_CHEAP
      args.modelID = TRINITY_CHEAP
      args.modelId = TRINITY_CHEAP
      args.subagent_type = taskSubagentTypeForSlot("cheap") || args.subagent_type
      console.error(`[vibeOS] 🔀 Credit ${_credit}%: forcing Task → cheap slot (${TRINITY_CHEAP})`)
    }
    return
  }

  // Trinity rule: route Task subagents based on orchestrator tier.
  // Exploratory first-word detection → cheap (mirrors CC exploratory routing).
  // Then: high-tier brain → medium slot; mid-tier brain → cheap slot.
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
    const BASE_EXPLORATORY = new Set(["check","find","list","search","does","verify","look","count","show","get","read","grep","scan","detect","inspect"])
    const LEARNED_EXPLORATORY = getLearnedExploratoryWords()
    const EXPLORATORY = new Set([...BASE_EXPLORATORY, ...LEARNED_EXPLORATORY])
    const _exploratoryTarget = EXPLORATORY.has(_firstWord) ? TRINITY_CHEAP : null
    const _tierTarget = (currentTier === "high" && TRINITY_MEDIUM && TRINITY_MEDIUM !== currentModel) ? TRINITY_MEDIUM
      : TRINITY_CHEAP && TRINITY_CHEAP !== currentModel ? TRINITY_CHEAP
        : null
    const _hasMedia = /\.(png|jpg|jpeg|gif|webp|bmp|svg|mp4|webm|ogg|mp3|wav|avi|mov)/i.test(_prompt)
    const stressScore = latestUserIntent ? scoreStress(latestUserIntent) : 0
    const selection = loadSelection()
    const activePipeline = selection.active_pipeline
    const cascadeInput = {
      prompt: _prompt,
      firstWord: _firstWord,
      currentTier,
      currentModel,
      trinityCheap: TRINITY_CHEAP,
      trinityMedium: TRINITY_MEDIUM,
      trinityBrain: TRINITY_BRAIN,
      activePipeline,
      stressScore,
      hasMedia: _hasMedia,
      exploratoryTarget: _exploratoryTarget,
      tierTarget: _tierTarget,
      mlEnabled: ML_ENABLED,
      mlConfidenceThreshold: ML_CONFIDENCE_THRESHOLD,
    }
    const shouldTryRemoteCascade = !isNodeTestRun || Boolean(explicitApiUrl)
    const client = shouldTryRemoteCascade ? getApiClient() : null
    let remoteRouteDecision = null
    if (client?.cascadeResolve) {
      try {
        remoteRouteDecision = await client.cascadeResolve(cascadeInput)
      } catch {}
    }
    let routeDecision = remoteRouteDecision && remoteRouteDecision.selectedModel
      ? remoteRouteDecision
      : null
    if (!routeDecision) {
      if (client?.routeModel) {
        try {
          const legacyRoute = await client.routeModel(
            cascadeInput.prompt,
            cascadeInput.currentTier,
            cascadeInput.trinityCheap,
            cascadeInput.trinityMedium,
            [],
            cascadeInput.stressScore,
          )
          if (legacyRoute?.target) {
            const legacySlot = _slotFromModel(String(legacyRoute.target), TRINITY_CHEAP, TRINITY_MEDIUM, TRINITY_BRAIN)
            routeDecision = {
              selectedModel: String(legacyRoute.target),
              selectedSlot: legacySlot,
              selectedSubagent: taskSubagentTypeForSlot(legacySlot) || null,
              requiresDelegation: legacySlot === "medium" || legacySlot === "brain",
              shouldOverrideLocal: true,
              delegationReason: legacyRoute.reason || "",
              reason: legacyRoute.reason || "",
              source: "backend-route-model",
              routePath: _routePathForSlot(_normalizeCascadeRoot(selection.active_pipeline, legacySlot), legacySlot),
              cascadeRoot: _normalizeCascadeRoot(selection.active_pipeline, legacySlot),
            }
          }
        } catch {}
      }
    }
    if (!routeDecision) {
      routeDecision = resolveCascadeRouteDecision(cascadeInput)
    }
    if (creditForceCheap && routeDecision?.source !== "backend" && routeDecision?.source !== "backend-route-model" && routeDecision?.source !== "api-cascade") {
      const creditSlot = "cheap"
      routeDecision = {
        ...(routeDecision || {}),
        selectedModel: TRINITY_CHEAP,
        selectedSlot: creditSlot,
        selectedSubagent: taskSubagentTypeForSlot(creditSlot) || null,
        requiresDelegation: false,
        shouldOverrideLocal: true,
        delegationReason: `credit ${_credit}%`,
        reason: `credit ${_credit}%`,
        source: "credit",
        routePath: _routePathForSlot(_normalizeCascadeRoot(selection.active_pipeline, creditSlot), creditSlot),
        cascadeRoot: _normalizeCascadeRoot(selection.active_pipeline, creditSlot),
      }
    }
    if (selection.optimization_mode === "vibeultrax" && selection.requires_delegation) {
      const controlSlot = selection.selected_slot || routeDecision?.selectedSlot || null
      const controlModel = _modelForSlot(controlSlot, TRINITY_CHEAP, TRINITY_MEDIUM, TRINITY_BRAIN) || selection.worker_model || null
      const routeSlot = routeDecision?.selectedSlot || null
      const shouldApplyControlVector = controlModel && (!routeSlot || _slotRank(controlSlot) >= _slotRank(routeSlot))
      if (shouldApplyControlVector) {
        routeDecision = {
          ...routeDecision,
          selectedModel: controlModel,
          selectedSlot: controlSlot,
          selectedSubagent: taskSubagentTypeForSlot(controlSlot) || routeDecision?.selectedSubagent || null,
          requiresDelegation: true,
          delegationReason: "control vector requires delegation",
          source: "control-vector",
          reason: "control vector requires delegation",
          routePath: Array.isArray(selection.route_path) ? selection.route_path : routeDecision?.routePath || [],
        }
      }
    }
    try {
      const _bbState = loadBlackboxState()
      const _sid = _OC_SID
      if (_bbState && _bbState.sessions && _sid && _bbState.sessions[_sid]) {
        if (routeDecision?.cascadeRoot) _bbState.sessions[_sid].pipeline_root = routeDecision.cascadeRoot
        if (routeDecision?.cascadeDepth) _bbState.sessions[_sid].cascade_depth = routeDecision.cascadeDepth
        if (routeDecision?.routePath) _bbState.sessions[_sid].route_path = routeDecision.routePath
        _saveBlackboxState(_bbState)
      }
    } catch (_bbErr) {
      console.error("[vibeOS] CV persistence error:", _bbErr?.message || _bbErr)
    }
    const _target = routeDecision?.selectedModel || null

    if (ML_ENABLED && _target) {
      try {
        const mlGraphPrediction = predictBestModel(_mlGraph, _firstWord, currentTier)
        if (mlGraphPrediction && mlGraphPrediction !== currentModel) {
          const graphNode = _mlGraph.nodes[_firstWord]
          if (graphNode && graphNode.count >= 3 && DEBUG_INTERNALS) {
            console.error(`[vibeOS] 🕸 ML graph: ${_firstWord} → ${mlGraphPrediction} (${graphNode.count} samples)`)
          }
        }
        const _cascadeTarget = routeDecision?.cascadeSelectedModel || _target
        const _mlTier = routeDecision?.cascadeSelectedSlot || routeDecision.selectedSlot || (classify(_cascadeTarget) === "budget" ? "cheap" : classify(_cascadeTarget) === "mid" ? "medium" : classify(_cascadeTarget))
        addRouteEdge(_mlGraph, _firstWord, _cascadeTarget, _mlTier, true)
      } catch (mlErr) {
        console.error(`[vibeOS] ML router error: ${mlErr.message}`)
      }
    }

    if (_target) noteTaskRoutingLearning(_firstWord, _target, _exploratoryTarget ? "exploratory" : `tier:${currentTier}`)
    if (_target && (targetArgs?.model !== _target || (routeDecision?.selectedSubagent && targetArgs?.subagent_type !== routeDecision.selectedSubagent))) {
      const _reason = routeDecision?.reason || (_exploratoryTarget ? `exploratory ('${_firstWord}')` : `tier=${currentTier}`)
      const _setModel = (obj) => {
        if (!obj || typeof obj !== "object") return
        obj.model = _target
        obj.modelID = _target
        obj.modelId = _target
        if (routeDecision?.selectedSubagent) obj.subagent_type = routeDecision.selectedSubagent
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
        sourceStrategy: routeDecision?.source || (remoteRouteDecision ? "api-cascade" : "local-cascade"),
      })
      if (typeof targetArgs?.prompt === "string" && bridge.prompt_prefix) {
        targetArgs.prompt = `${bridge.prompt_prefix}${targetArgs.prompt}`
      }
      _setModel(targetArgs)
      _setModel(args)
      _setModel(inArgs)
      recordSessionBridge(bridge)
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
        pendingUiNote = `[vibeOS repair] Direct ${t} allowed because runtime tier binding is not coherent: slot=${coherence.slot || "unknown"} default_agent=${coherence.agent || "unset"} expected_agent=${coherence.expectedAgent || "unset"} model=${coherence.currentModel || "unset"} expected_model=${coherence.expectedModel || "unset"}. Run \`vibe diagnose cascade\` or \`vibe repair-state apply\`.`
        if (shouldLogWarn(`${t}|runtime-drift|${coherence.slot || "unknown"}`)) console.error(`[vibeOS] [runtime-drift] allowing direct ${t}; ${pendingUiNote}`)
        return
      }
      const originalPath = argSources
        .flatMap((src) => [src?.filePath, src?.file_path, src?.path])
        .find((v) => typeof v === "string" && v.trim()) || ""
      const _basename = originalPath.split("/").pop() || "blocked"

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
        const _total = recordSaving(t, "delegation enforced", savings, {
          firstWord: _firstWord,
          projectFingerprint: currentProjectFingerprint,
          projectName: currentProjectName || "",
          sessionId: getCurrentSessionId(),
        })
        const taskModel = TRINITY_CHEAP || TRINITY_MEDIUM || currentModel || TRINITY_BRAIN || ""
        pendingUiNote = `[delegation] ${t} blocked on brain tier. Use a task subagent instead: \`task subagent_type="general" model="${taskModel}" prompt="${t} <file> with the intended content"\`. Keeps brain focused on orchestration.`
        enforcementBlocked = true
        _mutateBlockedToolArgs(t, argSources, originalPath, output)
        if (shouldLogWarn(`${t}|enforced|${_tierWord}`)) console.error(`[vibeOS] [enforcement] BLOCKED direct ${t} on high tier → delegate via Task`)
        return
      }
      const _total = recordSaving(t, "direct edit", _estEdit, {
        firstWord: _firstWord,
        projectFingerprint: currentProjectFingerprint,
        projectName: currentProjectName || "",
        sessionId: getCurrentSessionId(),
      })
      if (isFallback || !compatibilityMode) {
        const msg = `[vibeOS] ${resolveTierIcon("cheap")} cheap lane · save about ~$${_estEdit.toFixed(3)} by delegating to Task. Try ${resolveTierIcon("medium")} medium.`
        if (shouldLogWarn(`${t}|direct|${_tierWord}`) && process.env.VIBEOS_DEBUG_DELEGATION === "1") {
          console.error(`[vibeOS] [delegation] ${msg}`)
        }
        pendingUiNote = msg
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
      // VibeUltraX cascade: tier follows the LIVE model's trinity slot so the
      // header stays coherent (cheap entry \u2192 "\u26A1 cheap | Big Pickle"; escalated
      // to the medium-slot model \u2192 "\u25D0 medium | V4 Flash"), instead of pinning
      // the tier to cheap while the model name shows a higher tier.
      const _ultraSlot = () => {
        const m = displayModel || resolvedModel || ""
        if (TRINITY_CHEAP && m === TRINITY_CHEAP) return "cheap"
        if (TRINITY_MEDIUM && m === TRINITY_MEDIUM) return "medium"
        if (TRINITY_BRAIN && m === TRINITY_BRAIN) return "brain"
        return execution.quality === "brain" ? "brain" : execution.quality === "medium" ? "medium" : "cheap"
      }
      const activeSlot = displayMode === "vibeultrax"
        ? _ultraSlot()
        : selNow.active_slot || resolveOptimizationSlot(displayMode) || (execution.quality === "brain" ? "brain" : execution.quality === "medium" ? "medium" : "cheap")
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
        vectorChangedSlot: selNow.vector_changed_slot,
        subRegime: currentSubRegime,
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
