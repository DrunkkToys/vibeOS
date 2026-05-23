// @ts-nocheck

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, copyFileSync, renameSync, openSync, closeSync, rmSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import { homedir, tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { safeJsonParse, _blackboxEnabled, setBlackboxEnabled as _setGlobalBlackboxEnabled, USER_HOME, FILE_LOCK_DIR, DELEGATION_STATE_FILE as STATE_FILE, GLOBAL_LEARNING_FILE, BLACKBOX_STATE_FILE, PROJECT_STATE_FILE, _OC_SID, currentProjectFingerprint, setCurrentProjectFingerprint, _handleStateCorruption, _lockPathFor, withFileLock, readJsonOrEmpty, validateState, loadBlackboxState, saveBlackboxState, loadGlobalLearning, updateGlobalLearning, getLearnedExploratoryWords, projectFingerprint, loadProjectState, saveProjectState, detectTechStack, ensureProjectBucket, recordMissedContext7 } from "./state.js"
import { loadSessionOptMode, writeSessionOptMode } from "./selection-manager.js"
import { getApiClient, isApiFallback } from "./api-client.js"
import { scoreStress, estimateContextBudget, classifyTurnSimple, tokenizeWords, topKeywords, extractLastUserText, isUserAskingForTests, isLikelyOffTopic, detectOutcomeSignal } from "./classifiers.js"
export { scoreStress, estimateContextBudget, classifyTurnSimple, tokenizeWords, topKeywords, extractLastUserText, isUserAskingForTests, isLikelyOffTopic, detectOutcomeSignal } from "./classifiers.js"

type OptimizationMode = "balanced" | "budget" | "quality" | "speed" | "longrun" | "auto"

function autoSelectMode(_subRegime: string, _stressMultiplier?: number): OptimizationMode {
  return "balanced"
}

function computeControlVector(
  _state: { sub_regime?: string; is_looping?: boolean; loop_intervention_level?: string; momentum?: number; n_interactions?: number; latest_stress_multiplier?: number },
  _action?: string,
  _optimizationMode?: OptimizationMode,
): any {
  return {
    enforcement_mode: "normal",
    enforcement_reason: "[optimize: balanced] using safe offline defaults",
    flow_mode: "normal",
    flow_focus: [],
    tdd_mode: "normal",
    tdd_focus: [],
    tier_bias: "auto",
    thinking_mode: "auto",
    stress_multiplier: 1.0,
    context7_urgency: "preferred",
    wbp_verbosity: "normal",
    optimization_mode: "balanced",
    directives: [],
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

class _BlackboxStub {
  history: any[]
  currentRegime: string
  static deserialize(data: any): _BlackboxStub {
    const s = new _BlackboxStub()
    s.history = data?.history || []
    s.currentRegime = data?.currentRegime || "INIT"
    return s
  }
  update(_text: string): any {
    return { sub_regime: this.currentRegime || "INIT" }
  }
  snapshot(): any {
    return { sub_regime: this.currentRegime || "INIT", resolution: "unresolved", momentum: 0, signals: {} }
  }
  serialize(): any {
    return { history: this.history, currentRegime: this.currentRegime }
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
  const MAX_RETRIES = 3
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = withFileLock(STATE_FILE, () => {
        const preGen = (readJsonOrEmpty(STATE_FILE)._gen || 0)
        let state = readJsonOrEmpty(STATE_FILE)
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
        validateState(next, STATE_FILE)
        mkdirSync(dirname(STATE_FILE), { recursive: true })
        const tmp = STATE_FILE + ".tmp"
        writeFileSync(tmp, JSON.stringify(next, null, 2))
        renameSync(tmp, STATE_FILE)
        return next
      })
      if (!result || typeof result !== "object") return result
      const postGen = result._gen
      const onDiskGen = (readJsonOrEmpty(STATE_FILE)._gen || 0)
      if (onDiskGen === postGen) return result
      if (attempt < MAX_RETRIES - 1) continue
      console.error("[vibeOS] WARN: updateState retry exhausted - possible state divergence")
      return result
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) continue
      console.error("[vibeOS] updateState error: " + err.message)
      return null
    }
  }
  return null
}

function loadTrinityModels() {
  try {
    const p = join(USER_HOME, ".claude/model-tiers.json")
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
    if (state.sessions?.[sid]?.history) {
      _blackboxTracker = _BlackboxStub.deserialize(state.sessions[sid])
    } else if (currentProjectFingerprint) {
      const projectKeys = Object.keys(state.sessions || {}).filter(k => state.sessions[k].project_fingerprint === currentProjectFingerprint)
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
  }
  return _blackboxTracker
}

function getBlackboxResolution() {
  try {
    const tracker = getBlackboxTracker()
    return tracker.snapshot()
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
      args.oldString, args.newString, args.filePath, args.file_path
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
// Default: "auto" (first session / restart). User can lock per session.
const DFLT_OPTIMIZATION_MODE = "auto"

export function loadOptimizationMode(): string {
  try {
    const sid = _OC_SID
    return loadSessionOptMode(sid) || DFLT_OPTIMIZATION_MODE
  } catch { return DFLT_OPTIMIZATION_MODE }
}

export function saveOptimizationMode(mode: string): void {
  try {
    writeSessionOptMode(_OC_SID, mode)
  } catch (err) {
    console.error("[vibeOS] saveOptimizationMode failed: " + err.message)
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
    if (!state.sessions[sid]) state.sessions[sid] = {}
    const next = (state.sessions[sid].turn_counter || 0) + 1
    state.sessions[sid].turn_counter = next
    saveBlackboxState(state)
    return next
  } catch { return 0 }
}

export { OptimizationMode, autoSelectMode, computeControlVector, buildControlHistoryEntry }

export {
  loadOptimizationMode,
  saveOptimizationMode,
  getTurnCounter,
  incrementTurnCounter,
  // Blackbox
  getBlackboxTracker,
  getBlackboxResolution,
  resolveEnforcementMode,
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
