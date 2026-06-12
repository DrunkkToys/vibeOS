// @ts-nocheck

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, copyFileSync, renameSync, openSync, closeSync, rmSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import { homedir, tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { ResolutionTracker } from "../vibeOS-lib/blackbox/index.js"
import { safeJsonParse, _blackboxEnabled, setBlackboxEnabled as _setGlobalBlackboxEnabled, USER_HOME, FILE_LOCK_DIR, DELEGATION_STATE_FILE as STATE_FILE, GLOBAL_LEARNING_FILE, BLACKBOX_STATE_FILE, PROJECT_STATE_FILE, _OC_SID, currentProjectFingerprint, setCurrentProjectFingerprint, _handleStateCorruption, _lockPathFor, withFileLock, readJsonOrEmpty, validateState, loadBlackboxState, saveBlackboxState, loadGlobalLearning, updateGlobalLearning, getLearnedExploratoryWords, projectFingerprint, loadProjectState, saveProjectState, detectTechStack, ensureProjectBucket, recordMissedContext7, VIBEOS_HOME } from "./state.js"
import { loadSelection, loadSessionOptMode, loadGlobalOptMode, saveGlobalOptMode, writeSelection, writeSessionOptMode, loadSessionSlot } from "./selection-manager.js"
import { getApiClient, isApiFallback } from "./api-client.js"
import { scoreStress, estimateContextBudget, classifyTurnSimple as _classifyTurnSimple, tokenizeWords, topKeywords, extractLastUserText, isUserAskingForTests, isLikelyOffTopic, detectOutcomeSignal } from "./classifiers.js"
export { scoreStress, estimateContextBudget, tokenizeWords, topKeywords, extractLastUserText, isUserAskingForTests, isLikelyOffTopic, detectOutcomeSignal } from "./classifiers.js"

export function classifyTurnSimple(userText: string): string {
  return _classifyTurnSimple(userText)
}

export async function classifyTurnRemote(text: string): Promise<string> {
  try {
    const client = getApiClient()
    if (!client || isApiFallback()) return _classifyTurnSimple(text)
    const res = await client.classifyQuery(text)
    if (res && typeof res === "object" && "sub_regime" in (res as Record<string, unknown>)) {
      return (res as Record<string, string>).sub_regime
    }
  } catch {}
  return _classifyTurnSimple(text)
}

function getVibeOSHome(): string {
  return process.env.VIBEOS_HOME || join(process.env.HOME || "", ".claude")
}

type OptimizationMode = "balanced" | "budget" | "quality" | "speed" | "longrun" | "auto" | "forensic" | "audit" | "vibeultrax" | "vibeqmax" | "vibemax" | "vibelitex"
const QUALITY_STRESS_THRESHOLD = 1.5
function autoSelectMode(subRegime: string, stressMultiplier?: number): OptimizationMode {
  const regime = String(subRegime || "INIT").toUpperCase()
  const stress = Number(stressMultiplier ?? 0)
  if (regime === "AUDIT" || regime === "FORENSIC") return regime.toLowerCase() as OptimizationMode
  if (regime === "LOOPING") return "speed"
  if (regime === "CONVERGING" || regime === "CLOSED") return "quality"
  if (stress > QUALITY_STRESS_THRESHOLD) return "quality"
  return "vibelitex"
}

export function resolveOptimizationMode(
  subRegime: string | undefined,
  stressMultiplier: number | undefined,
  optimizationMode: OptimizationMode | string | undefined,
): OptimizationMode {
  const normalized = String(optimizationMode || "auto").toLowerCase()
  if (normalized === "auto" || normalized === "")
    return autoSelectMode(subRegime || "INIT", stressMultiplier) as OptimizationMode
  if (isApiFallback()) return "vibelitex"
  if (normalized === "balanced" || normalized === "budget" || normalized === "quality" || normalized === "speed" || normalized === "longrun" || normalized === "audit" || normalized === "forensic" || normalized === "vibeultrax" || normalized === "vibeqmax" || normalized === "vibemax" || normalized === "vibelitex") {
    return normalized as OptimizationMode
  }
  return "budget"
}

export function resolveOptimizationSlot(mode: OptimizationMode | string | undefined): "brain" | "medium" | "cheap" {
  const normalized = String(mode || "budget").toLowerCase()
  return normalized === "speed" || normalized === "vibemax" || normalized === "vibelitex" || normalized === "litex" ? "medium"
    : normalized === "quality" || normalized === "longrun" || normalized === "vibeultrax" || normalized === "vibeqmax" || normalized === "forensic" || normalized === "audit" ? "brain"
      : "cheap"
}

export function bootstrapOptimizationSession(): { mode: OptimizationMode; slot: "brain" | "medium" | "cheap" } {
  const sid = _OC_SID
  const resolvedMode = DFLT_OPTIMIZATION_MODE
  const resolvedSlot = resolveOptimizationSlot(resolvedMode)
  try {
    writeSessionOptMode(sid, resolvedMode)
    writeSessionSlot(sid, resolvedSlot)
    const state = loadBlackboxState()
    if (!state.sessions) state.sessions = {}
    if (sid && sid !== "undefined") {
      if (!state.sessions[sid]) state.sessions[sid] = {}
      state.sessions[sid].optimization_mode = resolvedMode
      state.sessions[sid].active_slot = resolvedSlot
      state.sessions[sid].sub_regime = state.sessions[sid].sub_regime || "INIT"
      state.sessions[sid].regime = state.sessions[sid].regime || "INIT"
      state.sessions[sid].resolution = state.sessions[sid].resolution || "unresolved"
      state.sessions[sid].momentum = Number(state.sessions[sid].momentum || 0)
      state.sessions[sid].loop_count = Number(state.sessions[sid].loop_count || 0)
      state.sessions[sid].loop_intervention_level = state.sessions[sid].loop_intervention_level || "none"
      state.sessions[sid].loop_start_turn = Number(state.sessions[sid].loop_start_turn || 0)
      state.sessions[sid].loop_pattern_count = Number(state.sessions[sid].loop_pattern_count || 0)
    }
    saveBlackboxState(state)
  } catch {}
  return { mode: resolvedMode, slot: resolvedSlot }
}

export async function selectOptimizationModeRemote(
  subRegime: string | undefined,
  stressMultiplier: number | undefined,
  fallbackMode: OptimizationMode | string | undefined,
): Promise<OptimizationMode> {
  const normalizedRequestedMode = String(fallbackMode || "auto").toLowerCase()
  const fallback = resolveOptimizationMode(subRegime, stressMultiplier, fallbackMode)
  if (normalizedRequestedMode !== "auto" && normalizedRequestedMode !== "") return fallback
  if (isApiFallback()) return fallback
  try {
    const client = getApiClient()
    if (client) {
      const res = await client.blackboxSelectMode(subRegime || "INIT", Number(stressMultiplier ?? 0))
      const selected = String((res as any)?.mode || "").toLowerCase()
      if (selected === "balanced" || selected === "budget" || selected === "quality" || selected === "speed" || selected === "longrun" || selected === "audit" || selected === "forensic" || selected === "vibeultrax" || selected === "vibeqmax" || selected === "vibemax") {
        return selected as OptimizationMode
      }
    }
  } catch {}
  return fallback
}

function computeControlVector(
  _state: { sub_regime?: string; is_looping?: boolean; loop_intervention_level?: string; momentum?: number; n_interactions?: number; latest_stress_multiplier?: number },
  _action?: string,
  _optimizationMode?: OptimizationMode,
): any {
  const mode = resolveOptimizationMode(_state?.sub_regime, _state?.latest_stress_multiplier, _optimizationMode)
  const isStrict = mode === "quality" || mode === "vibemax" || mode === "vibeqmax" || mode === "vibeultrax" || mode === "forensic" || mode === "audit"
  const isRelaxed = mode === "budget" || mode === "speed"
  const subRegime = _state?.sub_regime || "INIT"
  const stress = Number(_state?.latest_stress_multiplier ?? 0)
  const tierBias = stress > QUALITY_STRESS_THRESHOLD ? "brain"
    : subRegime === "CONVERGING" || subRegime === "CLOSED" ? "brain"
      : subRegime === "REFINING" || subRegime === "LOOPING" ? "medium"
        : mode === "quality" || mode === "longrun" || mode === "vibeultrax" || mode === "vibeqmax" || mode === "forensic" || mode === "audit" ? "brain"
          : mode === "speed" || mode === "vibemax" || mode === "vibelitex" ? "medium"
            : mode === "balanced" ? "auto"
              : "cheap"
  return {
    enforcement_mode: isStrict ? "strict" : isRelaxed ? "relaxed" : "normal",
    enforcement_reason: `[optimize: ${mode}] using safe offline defaults`,
    flow_mode: isStrict ? "strict" : isRelaxed ? "audit" : "normal",
    flow_focus: [],
    tdd_mode: isStrict ? "strict" : isRelaxed ? "lazy" : "normal",
    tdd_focus: [],
    tier_bias: tierBias,
    thinking_mode: isStrict ? "full" : mode === "longrun" ? "brief" : isRelaxed ? "off" : "auto",
    stress_multiplier: 1.0,
    context7_urgency: isStrict ? "required" : "preferred",
    wbp_verbosity: isStrict ? "verbose" : isRelaxed ? "minimal" : "normal",
    agent_mode: (subRegime === "REFINING" || subRegime === "CONVERGING" || subRegime === "CLOSED") && stress <= QUALITY_STRESS_THRESHOLD ? "plan" : undefined as any,
    optimization_mode: mode,
    directives: isRelaxed && (subRegime === "EXPLORING" || subRegime === "INIT" || subRegime === "AUDIT" || subRegime === "FORENSIC" || subRegime === "LOOPING") ? [
      `[speed guard] VERIFY BEFORE ACT - Speed-oriented mode "${mode}" is active and user intent is ${subRegime}. Before modifying files or executing commands, first verify the current state. When a request is ambiguous between "check and report" vs "fix", always choose CHECK FIRST. Treat "look at", "check", "investigate", "tell me about" as requests for information, not action items.`,
    ] : [],
  }
}

function buildControlHistoryEntry(
  turn: number,
  regime: string,
  control: any,
  reward: number | null = null,
): Record<string, unknown> {
  return {
    turn,
    regime,
    control: {
      enforcement_mode: control.enforcement_mode,
      flow_mode: control.flow_mode,
      tdd_mode: control.tdd_mode,
      tier_bias: control.tier_bias,
      thinking_mode: control.thinking_mode,
      stress_multiplier: control.stress_multiplier,
      context7_urgency: control.context7_urgency,
      wbp_verbosity: control.wbp_verbosity,
    },
    reward,
  }
}

function classifyBlackboxAction(text: string): string {
  if (/refactor|change|replace|switch|pivot|migrate/i.test(text)) return "change"
  if (/commit|save|push|merge|release|finalize/i.test(text)) return "commit"
  if (/write|create|build|make|add|implement|generate/i.test(text)) return "act"
  if (/explain|why|how|what|analyze|review|check|find|search|look/i.test(text)) return "explore"
  if (/show|list|get|read|see|view|display|print/i.test(text)) return "observe"
  return "explore"
}

function computeBlackboxEntropy(features: any): number {
  const questionRatio = Number(features?.question_ratio || 0)
  const complexity = Number(features?.complexity || 0)
  const repetition = Number(features?.repetition || 0)
  const instructionDensity = Number(features?.instruction_density || 0)
  return Math.min(2.58, 0.5 + questionRatio * 0.5 + complexity * 0.8 + repetition * 0.6 + instructionDensity * 0.4)
}

function computeBlackboxUncertainty(features: any): number {
  const questionRatio = Number(features?.question_ratio || 0)
  const codeBlocks = Number(features?.code_blocks || 0)
  const sentiment = Number(features?.sentiment || 0.5)
  const urgency = Number(features?.urgency || 0)
  return Math.min(100, Math.max(10, 50 + questionRatio * 40 - codeBlocks * 10 + sentiment * 30 - urgency * 20))
}

function normalizeBlackboxFeatures(text: string): any {
  const features = ResolutionTracker.extractFeatures(text)
  return {
    features,
    action: classifyBlackboxAction(text),
    entropy: computeBlackboxEntropy(features),
    uncertainty: computeBlackboxUncertainty(features),
  }
}

function normalizeBlackboxHistoryEntry(entry: any): any {
  const text = typeof entry?.text === "string" ? entry.text : ""
  const fallback = normalizeBlackboxFeatures(text)
  const entryFeatures = entry?.features && typeof entry.features === "object" ? { ...fallback.features, ...entry.features } : fallback.features
  return {
    text,
    features: entryFeatures,
    action: typeof entry?.action === "string" && entry.action ? entry.action : fallback.action,
    entropy: Number.isFinite(Number(entry?.entropy)) ? Number(entry.entropy) : fallback.entropy,
    uncertainty: Number.isFinite(Number(entry?.uncertainty)) ? Number(entry.uncertainty) : fallback.uncertainty,
    embedding: Array.isArray(entry?.embedding) ? [...entry.embedding] : null,
    timestamp: Number.isFinite(Number(entry?.timestamp)) ? Number(entry.timestamp) : Date.now() / 1000,
    is_pivot: Boolean(entry?.is_pivot),
    outcome: typeof entry?.outcome === "string" ? entry.outcome : (entry?.outcome ?? null),
  }
}

function normalizeBlackboxHistory(history: any[]): any[] {
  if (!Array.isArray(history)) return []
  return history.map(normalizeBlackboxHistoryEntry)
}

function createResolutionTracker(data: any): ResolutionTracker {
  const tracker = new ResolutionTracker(data?.sessionId || _OC_SID, data?.maxHistory || 10)
  tracker.history = normalizeBlackboxHistory(data?.history || [])
  tracker.loopCount = Number(data?.loopCount || 0)
  tracker.pivotHistory = Array.isArray(data?.pivotHistory) ? [...data.pivotHistory] : []
  tracker.outcomeHistory = Array.isArray(data?.outcomeHistory) ? [...data.outcomeHistory] : []
  tracker.calibratedWeights = data?.calibratedWeights || null
  return tracker
}

class _BlackboxStub {
  tracker: ResolutionTracker
  static deserialize(data: any): _BlackboxStub {
    return new _BlackboxStub(data)
  }
  constructor(data: any = null) {
    this.tracker = createResolutionTracker(data)
  }
  update(text: string): any {
    const normalized = normalizeBlackboxFeatures(text)
    const state = this.tracker.update(text, normalized.features, normalized.action, normalized.entropy, normalized.uncertainty)
    return { ...state, ...normalized }
  }
  snapshot(): any {
    return this.tracker.snapshot()
  }
  serialize(): any {
    return this.tracker.serialize()
  }
  recordOutcome(outcome: any): void {
    this.tracker.recordOutcome(outcome)
  }
  getLoopIntervention(): any {
    return this.tracker.getLoopIntervention()
  }
  getPivotDirective(): any {
    return this.tracker.getPivotDirective()
  }
  setCalibratedWeights(weights: any): void {
    this.tracker.setCalibratedWeights(weights)
  }
  getHistory(): any[] {
    return this.tracker.getHistory()
  }
  getOutcomeHistory(): any[] {
    return this.tracker.getOutcomeHistory()
  }
}

let _blackboxTracker = null
let _prevOutputText = ""
let _latestBlackboxState = null
let _latestBlackboxLoopMsg = null
let _latestBlackboxPivotMsg = null

const WARN_DEDUPE_WINDOW_MS = 120 * 1000
const warnLogThrottle = new Map()
const warnPerSession = new Map()
const WARN_MAX_PER_SESSION = 3
const WARN_COALESCE_THRESHOLD = 10
const warnCoalesceCounters = new Map()

function updateState(mutator) {
  const stateFile = join(getVibeOSHome(), "delegation-state.json")
  const MAX_RETRIES = 3
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = withFileLock(stateFile, () => {
        const preGen = (readJsonOrEmpty(stateFile)._gen || 0)
        let state = readJsonOrEmpty(stateFile)
        if (!state || typeof state !== "object") state = {}
        if (!state.session_started_at || state.session_started_at === "not-a-valid-date" || isNaN(Date.parse(state.session_started_at))) {
          state.session_started_at = new Date().toISOString()
        }
        state.lifetime ??= {}
        state.lifetime.missed_context7_usd ??= 0
        state.lifetime.cache_savings_usd ??= 0
        state.lifetime.total_savings_usd ??= 0
        state._ledgerFormatVersion ??= 2
        state._gen = preGen + 1
        const next = mutator(state) ?? state
        validateState(next, stateFile)
        mkdirSync(dirname(stateFile), { recursive: true })
        const tmp = stateFile + ".tmp"
        writeFileSync(tmp, JSON.stringify(next, null, 2))
        renameSync(tmp, stateFile)
        return next
      })
      if (!result || typeof result !== "object") return result
      const postGen = result._gen
      const onDiskGen = (readJsonOrEmpty(stateFile)._gen || 0)
      if (onDiskGen === postGen) return result
      if (attempt < MAX_RETRIES - 1) continue
      if (process.env.VIBEOS_DEBUG_INTERNALS === "1") {
        console.error("[vibeOS] WARN: updateState retry exhausted - possible state divergence")
      }
      return result
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) continue
      if (process.env.VIBEOS_DEBUG_INTERNALS === "1") {
        console.error("[vibeOS] updateState error: " + err.message)
      }
      return null
    }
  }
  return null
}

function loadTrinityModels() {
  try {
    const p = join(getVibeOSHome(), "model-tiers.json")
    if (!existsSync(p)) return { brain: "", cheap: "", medium: "" }
    const j = safeJsonParse(readFileSync(p, "utf-8"))
    return {
      brain:  j?.trinity?.brain?.oc  || j?.trinity?.brain  || "",
      cheap:  j?.trinity?.cheap?.oc  || j?.trinity?.cheap  || "",
      medium: j?.trinity?.medium?.oc || j?.trinity?.medium || "",
    }
  } catch { return { brain: "", cheap: "", medium: "" } }
}
const _trinityModels = loadTrinityModels()
const TRINITY_CHEAP_MOD = _trinityModels.cheap
const TRINITY_MEDIUM_MOD = _trinityModels.medium

export function getBlackboxTracker() {
  if (!_blackboxTracker) {
    const state = loadBlackboxState()
    if (state.enabled !== undefined) _setGlobalBlackboxEnabled(state.enabled)
    const sid = _OC_SID
    if (sid && sid !== "undefined" && state.sessions?.[sid]?.history) {
      _blackboxTracker = _BlackboxStub.deserialize(state.sessions[sid])
    } else if (currentProjectFingerprint && sid && sid !== "undefined") {
      const projectKeys = Object.keys(state.sessions || {}).filter(k => state.sessions[k].project_fingerprint === currentProjectFingerprint && k !== "undefined" && k !== null && k.trim() !== "")
      const latest = projectKeys.sort().slice(-1)[0]
      if (latest && state.sessions[latest]?.history) {
        const data = state.sessions[latest]
        _blackboxTracker = _BlackboxStub.deserialize(data)
      } else {
        _blackboxTracker = new _BlackboxStub()
      }
    } else {
      _blackboxTracker = new _BlackboxStub()
    }
    const localCal = computeLocalCalibration()
    if (localCal && _blackboxTracker?.setCalibratedWeights) {
      _blackboxTracker.setCalibratedWeights(localCal)
    }
  }
  return _blackboxTracker
}

function getBlackboxResolution() {
  try {
    const tracker = getBlackboxTracker()
    return tracker.snapshot()
  } catch { return null }
}

function computeLocalCalibration(): any {
  try {
    const calFile = join(getVibeOSHome(), "calibration-data.jsonl")
    if (!existsSync(calFile)) return null
    const lines = readFileSync(calFile, "utf-8").trim().split("\n").filter(Boolean)
    if (lines.length < 10) return null
    const recent = lines.slice(-50)
    const state = loadBlackboxState()
    const allOutcomes = []
    for (const [sid, session] of Object.entries(state.sessions || {})) {
      if (session?.outcomeHistory?.length) {
        for (const o of session.outcomeHistory) {
          allOutcomes.push({ sid, outcome: o.outcome, turn: o.turn })
        }
      }
    }
    if (allOutcomes.length < 5) return null
    const positiveCount = allOutcomes.filter(o => o.outcome === "positive").length
    const ratio = positiveCount / allOutcomes.length
    return {
      loopJaccard: ratio > 0.7 ? 0.55 : 0.65,
      closureConfidence: ratio > 0.7 ? 0.75 : 0.65,
      exploringContradiction: ratio > 0.7 ? 0.15 : 0.25,
      momentum: [-0.3, 0.5, 0.2],
    }
  } catch { return null }
}

export function resolveEnforcementMode() {
  const sub = _latestBlackboxState?.sub_regime || "INIT"
  if (sub === "EXPLORING" || sub === "DIVERGENT" || sub === "LOOPING") return "relaxed"
  if (sub === "CONVERGING" || sub === "CLOSED") return "strict"
  return "normal"
}

async function syncOutcomeToApi(outcome) {
  try {
    const client = getApiClient()
    if (!client || isApiFallback()) return
    await client.blackboxOutcome(_OC_SID, outcome)
  } catch {}
}

async function fetchBlackboxEnrichment(sessionId, localState) {
  try {
    const client = getApiClient()
    if (!client || isApiFallback()) return null
    const result = await client.blackboxAnalyze(sessionId, {
      userText: "",
      features: localState.features || {},
      action: localState.action || "explore",
      entropy: localState.entropy ?? 1.0,
      uncertainty: localState.uncertainty ?? 50,
      project_id: currentProjectFingerprint || null,
    })
    if (result) {
      _latestBlackboxLoopMsg = result.loop_intervention_directive || null
      _latestBlackboxPivotMsg = result.pivot_directive || null
      return {
        ...localState,
        sub_regime: result.sub_regime || localState.sub_regime,
        resolution: result.resolution || localState.resolution,
        momentum: result.momentum ?? localState.momentum,
        signals: result.signals || localState.signals,
        intent_state: result.intent_state || localState.intent_state,
        continuity_state: result.continuity_state || localState.continuity_state,
        is_looping: result.is_looping ?? localState.is_looping,
        loop_consecutive: result.loop_consecutive ?? localState.loop_consecutive,
        loop_intervention_level: result.loop_intervention_level || localState.loop_intervention_level,
        pivot_detected: result.pivot_detected ?? localState.pivot_detected,
        pivot_score: result.pivot_score ?? localState.pivot_score,
        outcome: result.outcome || localState.outcome,
      }
    }
  } catch {}
  return null
}

function extractFirstWordFromArgs(tool, args) {
  try {
    if (!args || typeof args !== "object") return null
    const pick = (...vals) => vals.find(v => typeof v === "string" && v.trim())
    const raw = pick(
      args.prompt, args.query, args.url, args.command, args.cmd,
      args.oldString, args.newString, args.filePath, args.file_path,
    )
    if (!raw) return null
    const token = String(raw).trim().toLowerCase().split(/\s+/)[0] || ""
    return /^[a-z][a-z0-9_-]{1,24}$/.test(token) ? token : null
  } catch {
    return null
  }
}

function shouldLogWarn(key, windowMs = WARN_DEDUPE_WINDOW_MS) {
  const now = Date.now()
  const prev = warnLogThrottle.get(key) || 0
  if (now - prev < windowMs) return false
  warnLogThrottle.set(key, now)
  if (warnLogThrottle.size > 2000) {
    for (const [k, ts] of warnLogThrottle.entries()) {
      if (now - ts > windowMs * 10) warnLogThrottle.delete(k)
    }
    if (warnLogThrottle.size > 2000) {
      const entries = [...warnLogThrottle.entries()].sort((a, b) => a[1] - b[1])
      for (let i = 0; i < entries.length - 2000; i++) warnLogThrottle.delete(entries[i][0])
    }
  }
  // Session-level cap: max WARN_MAX_PER_SESSION fires per category
  const cat = key.split("|")[0]
  const ps = warnPerSession.get(cat) || 0
  if (ps >= WARN_MAX_PER_SESSION) {
    // Track for coalesce message
    const cc = (warnCoalesceCounters.get(cat) || 0) + 1
    warnCoalesceCounters.set(cat, cc)
    if (cc === WARN_COALESCE_THRESHOLD) {
      console.error("[vibeOS] " + cat + ": " + cc + " warnings coalesced — `trinity medium` recommended")
    }
    return false
  }
  warnPerSession.set(cat, ps + 1)
  return true
}

function noteTaskRoutingLearning(firstWord, targetModel, reason) {
  if (!firstWord || !/^[a-z][a-z0-9_-]{1,24}$/.test(firstWord)) return
  try {
    const now = new Date().toISOString()
    const nonExploratory = new Set(["build", "implement", "fix", "add", "update", "remove", "write", "edit", "refactor", "create"])
    // Per-project: store this learning in the current project bucket
    try {
      const pstate = loadProjectState()
      const fp = currentProjectFingerprint || projectFingerprint(process.cwd())
      const bucket = ensureProjectBucket(pstate, fp)
      bucket.taskWordPatterns ??= {}
      const localRow = bucket.taskWordPatterns[firstWord] || { total: 0, cheap: 0, medium: 0, high: 0, lastSeen: null }
      localRow.total += 1
      if (targetModel === TRINITY_CHEAP_MOD) localRow.cheap += 1
      else if (targetModel === TRINITY_MEDIUM_MOD) localRow.medium += 1
      else localRow.high += 1
      localRow.lastSeen = now
      bucket.taskWordPatterns[firstWord] = localRow
      saveProjectState(pstate)
    } catch {}

    updateGlobalLearning((gl) => {
      gl.task_first_words ??= {}
      const row = gl.task_first_words[firstWord] || { total: 0, cheap: 0, medium: 0, high: 0, lastSeen: null, lastReason: null }
      row.total += 1
      if (targetModel === TRINITY_CHEAP_MOD) row.cheap += 1
      else if (targetModel === TRINITY_MEDIUM_MOD) row.medium += 1
      else row.high += 1
      row.lastSeen = now
      row.lastReason = reason || "unknown"
      gl.task_first_words[firstWord] = row

      // Cross-project pattern merging: search other project buckets with overlapping techStack
      try {
        const pstate = loadProjectState()
        const currentFp = currentProjectFingerprint || ""
        const currentTech = currentFp ? pstate.project_hashes?.[currentFp]?.techStack : null
        if (currentTech && Array.isArray(currentTech) && currentTech.length > 0) {
          for (const [fp, bucket] of Object.entries(pstate.project_hashes || {})) {
            if (fp === currentFp) continue
            const otherTech = bucket?.techStack
            if (!otherTech || !Array.isArray(otherTech)) continue
            if (!otherTech.some(t => currentTech.includes(t))) continue
            const otherRow = bucket?.taskWordPatterns?.[firstWord]
            if (otherRow && otherRow.total) {
              row.total += otherRow.total
            }
          }
        }
      } catch {}
      gl.task_first_words[firstWord] = row

      // Learn portable exploratory intent across projects after repeated cheap-safe routes.
      if (!nonExploratory.has(firstWord) && row.cheap >= 3 && row.cheap / Math.max(1, row.total) >= 0.7) {
        gl.exploratory_words ??= {}
        const e = gl.exploratory_words[firstWord] || { count: 0, lastSeen: null }
        e.count += 1
        e.lastSeen = now
        gl.exploratory_words[firstWord] = e
      }
      return gl
    })
  } catch {}
}

// State accessors — called from index.ts to sync mutable state
export function setProjectFingerprint(fp) {
  setCurrentProjectFingerprint(fp)
}

export function getBlackboxEnabled() {
  return _blackboxEnabled
}

export function setBlackboxEnabled(val) {
  _setGlobalBlackboxEnabled(val)
}

export function getLatestBlackboxState() {
  return _latestBlackboxState
}

export function setLatestBlackboxState(val) {
  _latestBlackboxState = val
}

export function getLatestBlackboxLoopMsg() {
  return _latestBlackboxLoopMsg
}

export function setLatestBlackboxLoopMsg(val) {
  _latestBlackboxLoopMsg = val
}

export function getLatestBlackboxPivotMsg() {
  return _latestBlackboxPivotMsg
}

export function setLatestBlackboxPivotMsg(val) {
  _latestBlackboxPivotMsg = val
}

export function getOC_SID() {
  return _OC_SID
}

// ── Optimization Mode persistence ───────────────────────────────────────
// Stored in blackbox-state.json under sessions[<SID>].optimization_mode
// Default: "budget" (fresh session / restart). User can lock per session.
const DFLT_OPTIMIZATION_MODE = "budget"

function recoverOptimizationModeFromSelection(sel: any): string {
  const slot = String(sel?.active_slot || "").toLowerCase()
  if (slot === "brain") return "quality"
  if (slot === "medium") return "vibemax"
  if (slot === "cheap") return "budget"
  return "budget"
}

export function loadOptimizationMode(): string {
  try {
    const sel = loadSelection()
    const persistedMode = sel.optimization_mode || null
    if (persistedMode === "vibelitex") {
      const prevKey = `${_OC_SID}_prev_opt`
      const sessionMode = loadSessionOptMode(_OC_SID)
      const globalMode = loadGlobalOptMode()
      const recoveryMode =
        sel.previous_optimization_mode ||
        loadSessionOptMode(prevKey) ||
        (sessionMode && sessionMode !== "vibelitex" ? sessionMode : "") ||
        (globalMode && globalMode !== "vibelitex" ? globalMode : "") ||
        recoverOptimizationModeFromSelection(sel)
      if (recoveryMode && recoveryMode !== "vibelitex") {
        try { writeSelection("optimization_mode", recoveryMode) } catch {}
        try { writeSelection("previous_optimization_mode", null) } catch {}
        try { writeSessionOptMode(_OC_SID, recoveryMode) } catch {}
        try { writeSessionOptMode(prevKey, "") } catch {}
        return recoveryMode
      }
    }
    const mode = loadSessionOptMode(_OC_SID)
    if (mode && mode !== "auto") return mode
    const global = loadGlobalOptMode()
    if (global && global !== "auto") return global
    return DFLT_OPTIMIZATION_MODE
  } catch { return DFLT_OPTIMIZATION_MODE }
}

export function saveOptimizationMode(mode: string): boolean {
  try {
    writeSessionOptMode(_OC_SID, mode)
  } catch (e) {
    console.error("[vibeOS] saveOptimizationMode session write failed: " + e.message)
  }
  try {
    if (mode && mode !== "auto") saveGlobalOptMode(mode)
    return true
  } catch (e) {
    console.error("[vibeOS] saveOptimizationMode global write failed: " + e.message)
    return false
  }
}

// ── Turn counter for compaction triggers ───────────────────────────────
// Stored in blackbox-state.json under sessions[<SID>].turn_counter
// Incremented each interaction turn. At % 10 === 0, compaction fires.

export function getTurnCounter(): number {
  try {
    const state = loadBlackboxState()
    const sid = _OC_SID
    return state.sessions?.[sid]?.turn_counter || 0
  } catch { return 0 }
}

export function incrementTurnCounter(): number {
  try {
    const state = loadBlackboxState()
    const sid = _OC_SID
    if (!state.sessions) state.sessions = {}
    if (sid && sid !== "undefined") {
      if (!state.sessions[sid]) state.sessions[sid] = {}
      const next = (state.sessions[sid].turn_counter || 0) + 1
      state.sessions[sid].turn_counter = next
    }
    saveBlackboxState(state)
    return 0
  } catch { return 0 }
}

export { OptimizationMode, autoSelectMode, computeControlVector, buildControlHistoryEntry }

export {
  // Blackbox
  getBlackboxResolution,
  syncOutcomeToApi,
  fetchBlackboxEnrichment,
  // Warnings
  extractFirstWordFromArgs,
  shouldLogWarn,
  // Global learning
  loadGlobalLearning,
  updateGlobalLearning,
  getLearnedExploratoryWords,
  noteTaskRoutingLearning,
  // Missed context7
  recordMissedContext7,
  // State helpers
  updateState,
  loadProjectState,
  saveProjectState,
  ensureProjectBucket,
  projectFingerprint,
  withFileLock,
  readJsonOrEmpty,
  detectTechStack,
  loadBlackboxState,
  saveBlackboxState,
}

export function resetBlackboxTracker() { _blackboxTracker = null }
