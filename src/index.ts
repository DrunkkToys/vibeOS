// @ts-nocheck
/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
 *
 * Delegation Enforcer Plugin — memory-mode, never blocks.
 *
 * Strategy: track every "would-have-blocked" event in the shared state file
 * at ~/.claude/delegation-state.json (also written by the Claude Code hook)
 * and surface cumulative savings in the OpenCode GUI via the
 * `experimental.text.complete` hook. Worker-to-Brain protocol is injected as
 * a separate text content block via `experimental.chat.messages.transform`.
 *
 * Tier classification: .opencode/MODEL_TIERS.md
 *
 *   write/edit on high tier   → warn + record (memory)
 *   webfetch/websearch >5     → warn + record (memory)
 *   task/read/glob/grep/...   → free
 *
 * Sister hook: ~/.claude/hooks/vibeOS (Claude Code).
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, readdirSync, openSync, readSync, closeSync, rmSync, copyFileSync, renameSync } from "node:fs"
import { join, dirname, relative, basename } from "node:path"
import { homedir, tmpdir } from "node:os"

const USER_HOME = (() => { try { return homedir() } catch { return tmpdir() } })()
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { checkFlowRules, getFlowWarns, getSessionFlowCounts, setFlowStateWriter, ensureProjectDocs } from "./vibeOS-lib/flow-enforcer.js"
import { computeSessionMetrics } from "./vibeOS-lib/session-metrics.js"
import { LocalBlackboxStub } from "./vibeOS-lib/blackbox/local-stub.js"
import { computeControlVector, buildControlHistoryEntry } from "./vibeOS-lib/blackbox/meta-controller.js"
import { createMcpServer } from "./vibeOS-mcp-server.js"
import { VibeOSApiClient, VibeOSAuthError, VibeOSTimeoutError, VibeOSNetworkError } from "./vibeOS-api-server/client.js"
import { computeDifficulty, cascadeDecide, createPatternGraph, ensureNode, addRouteEdge, predictBestModel, hashQuery, deserializeGraph } from "./vibeOS-lib/ml-router.js"
import { createCacheDatabase, addCacheEntry, recordCacheStats, predictCacheHit, compositeSimilarity, evictStaleEntries, deserializeCacheDb } from "./vibeOS-lib/smart-cache.js"

// ── Remote API client (Phase 2) ─────────────────────────────────────
const VIBEOS_API_URL = process.env.VIBEOS_API_URL || "https://api.vibetheog.com"
const VIBEOS_API_TOKEN = process.env.VIBEOS_API_TOKEN || "vos_854d143233ad156dfc4863371e507f36418119dddac46ebfd4f8d97dc5f29680"
const VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN

let _apiClient = null
let _apiFallbackMode = false
let _apiFallbackSince = null

function getApiClient() {
  if (!_apiClient && VIBEOS_API_ENABLED) {
    _apiClient = new VibeOSApiClient({
      baseUrl: VIBEOS_API_URL,
      apiToken: VIBEOS_API_TOKEN,
      timeout: 5000,
    })
  }
  return _apiClient
}

function isApiFallback() {
  return _apiFallbackMode || !VIBEOS_API_ENABLED
}

export async function remoteCall(method, args, fallbackFn) {
  if (!VIBEOS_API_ENABLED) {
    if (fallbackFn) return fallbackFn()
    return null
  }
  try {
    const client = getApiClient()
    if (!client) { if (fallbackFn) return fallbackFn(); return null }
    const result = await client[method](...args)
    _apiFallbackMode = false
    _apiFallbackSince = null
    return result
  } catch (err) {
    if (!_apiFallbackMode) {
      _apiFallbackMode = true
      _apiFallbackSince = new Date().toISOString()
      console.error(`[vibeOS] API fallback activated: ${err.message}`)
    }
    if (fallbackFn) {
      try { return fallbackFn() } catch (fe) { console.error(`[vibeOS] fallback also failed: ${fe.message}`) }
    }
    return null
  }
}

// Minimal self-contained tool helper — avoids @opencode-ai/plugin dependency
// so the plugin works immediately on any install without bun/npm.
function _zType(base) {
  return Object.assign((...a) => _zType({ ...base, args: a }), {
    optional: () => _zType({ ...base, optional: true }),
    _isZod: true, _base: base,
  })
}
const tool = Object.assign((def) => def, {
  schema: {
    string: (o) => _zType({ kind: "string", ...(o || {}) }),
    number: (o) => _zType({ kind: "number", ...(o || {}) }),
    enum: (values) => _zType({ kind: "enum", values }),
  }
})

// ── Module state ────────────────────────────────────────────────────
let currentTier = null
let currentModel = null
// Project identity (set during init, used by report framework)
let currentProjectFingerprint = ""
let currentProjectName = ""

// Per-tool soft-quota counters (same semantics as bash hook per-SID flag files).
// Main scope uses quota 20, sub-agent scope uses 5 — OC has no scope concept so
// use the more conservative sub-agent limit.
const softQuotaCounts = {}
const SOFT_QUOTA_LIMIT = 5
const STATE_FILE = join(USER_HOME, ".claude/delegation-state.json")
const SAVINGS_LEDGER_FILE = join(USER_HOME, ".claude/savings-ledger.jsonl")
const GLOBAL_LEARNING_FILE = join(USER_HOME, ".claude/global-learning.json")
const PRICING_CACHE_FILE = join(USER_HOME, ".claude/model-pricing-cache.json")
const FILE_LOCK_DIR = join(USER_HOME, ".claude/.vibeOS-locks")
const BLACKBOX_STATE_FILE = join(USER_HOME, ".claude/blackbox-state.json")

// Dedupe set: assistantMessageIds that already had the savings tag appended
// during this sidecar's lifetime.
const textCompletePainted = new Set()

// ── JSONC-tolerant JSON.parse for config files ──────────────────────
function safeJsonParse(raw: string): any {
  try {
    return JSON.parse(raw)
  } catch {}

  let cleaned = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1')
  try {
    return JSON.parse(cleaned)
  } catch (e) {
    throw e
  }
}

function validateState(state: any, path: string): void {
  if (!state || typeof state !== 'object') {
    console.error(`[vibeOS] State validation failed: not an object at ${path}`)
    return
  }
  if (state.session_started_at && isNaN(Date.parse(state.session_started_at))) {
    console.error(`[vibeOS] State validation warning: invalid session_started_at at ${path}, resetting`)
    state.session_started_at = new Date().toISOString()
  }
  if (state.sessions && Array.isArray(state.sessions)) {
    console.error(`[vibeOS] State validation: converting legacy sessions array to object at ${path}`)
    state.sessions = {}
  } else if (state.sessions && !Array.isArray(state.sessions) && (typeof state.sessions !== "object" || state.sessions === null)) {
    console.error(`[vibeOS] State validation warning: sessions is invalid type at ${path}, resetting`)
    state.sessions = {}
  }
  if (state.lifetime && typeof state.lifetime !== 'object') {
    console.error(`[vibeOS] State validation warning: lifetime is not object at ${path}, resetting`)
    state.lifetime = {}
  }
}

// Max lines before rotating session-reports.log.
const MAX_LOG_LINES = 500
const WARN_DEDUPE_WINDOW_MS = 120 * 1000
const warnLogThrottle = new Map()
const recentToolEvents = []
const frictionSessionKeys = new Set()
const routineSessionKeys = new Set()
let lastMutationEvent = null
const warnPerSession = new Map()
const WARN_MAX_PER_SESSION = 3
const WARN_COALESCE_THRESHOLD = 10
const warnCoalesceCounters = new Map()

// ── ML Router: query difficulty predictor + confidence cascading + pattern graph ──
let _mlGraph = createPatternGraph()
let _cacheDb = createCacheDatabase()
const ML_ENABLED = true
const ML_CONFIDENCE_THRESHOLD = 0.6
let _mlSavePending = false

function loadMLState() {
  try {
    const gl = loadGlobalLearning()
    if (gl.ml_graph_raw) _mlGraph = deserializeGraph(gl.ml_graph_raw)
    if (gl.ml_cache_raw) _cacheDb = deserializeCacheDb(gl.ml_cache_raw)
    evictStaleEntries(_cacheDb, 86400 * 7)
  } catch {}
}
function saveMLState() {
  if (!ML_ENABLED) return false
  try {
    updateGlobalLearning((gl) => {
      gl.ml_graph_raw = JSON.stringify(_mlGraph)
      gl.ml_cache_raw = JSON.stringify(_cacheDb)
      return gl
    })
    return true
  } catch { return false }
}
loadMLState()

// Tier regexes — load from ~/.claude/model-tiers.json (single source of truth
// shared with the bash hook). Falls back to inline regexes if file missing or
// malformed, so the plugin never fails to load due to tier-config issues.
const FALLBACK_HIGH = /opus|gemini-.*-pro|deepseek\/deepseek-v4-pro|gpt-5|(^|\/)o[134]($|-|\/)/i
const FALLBACK_MID  = /deepseek\/deepseek-v4-flash|claude.*sonnet|gemini-.*-flash|gpt-4o(?!-mini)/i
function _safeRegex(cfg, fallback, label) {
  if (!cfg) return fallback
  try { return new RegExp(cfg, "i") }
  catch (e) {
    console.error(`[vibeOS] Invalid ${label}-tier regex in model-tiers.json: ${e.message}. Falling back.`)
    return fallback
  }
}
function loadTierRegexes() {
  try {
    const p = join(USER_HOME, ".claude/model-tiers.json")
    if (!existsSync(p)) return { high: FALLBACK_HIGH, mid: FALLBACK_MID }
    const j = safeJsonParse(readFileSync(p, "utf-8"))
    const highRe = _safeRegex(j?.tiers?.high?.regex, FALLBACK_HIGH, "high")
    const midRe  = _safeRegex(j?.tiers?.mid?.regex,  FALLBACK_MID,  "mid")
    return { high: highRe, mid: midRe }
  } catch { return { high: FALLBACK_HIGH, mid: FALLBACK_MID } }
}
const { high: HIGH_TIER_RE, mid: MID_TIER_RE } = loadTierRegexes()

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
let { brain: TRINITY_BRAIN, cheap: TRINITY_CHEAP, medium: TRINITY_MEDIUM } = loadTrinityModels()

// Read remaining credit percent from env/file/helper, same sources as bash hook.
function loadCredit() {
  // 1. Check cached API snapshot (populated by background refresh — triggered via trinity tool).
  const pct = _cachedPct()
  if (pct !== null) return pct
  // 2. Check CLAUDE_CREDIT_PERCENT env
  if (process.env.CLAUDE_CREDIT_PERCENT) {
    const n = parseInt(process.env.CLAUDE_CREDIT_PERCENT, 10)
    if (!isNaN(n)) return n
  }
  // 3. Check legacy file ~/.claude/credit-percent
  try {
    const f = join(USER_HOME, ".claude/credit-percent")
    if (existsSync(f)) {
      const n = parseInt(readFileSync(f, "utf-8").trim(), 10)
      if (!isNaN(n)) return n
    }
  } catch {}
  return 50
}

// Map credit to thinking level: full / brief / off.
function thinkingLevel(credit) {
  if (credit >= 70) return "full"
  if (credit >= 40) return "brief"
  return "brief"
}

function _handleStateCorruption(path) {
  const backupDir = join(USER_HOME, ".claude", ".backups")
  mkdirSync(backupDir, { recursive: true })
  const backupPath = join(backupDir, basename(path) + ".corrupted." + Date.now())
  try { copyFileSync(path, backupPath) } catch {}
  const logPath = join(USER_HOME, ".claude", ".state-corruption-log.jsonl")
  try { appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), path, backup: backupPath }) + "\n") } catch {}
}

// Read plugin enabled flag + active_slot fresh from model-tiers.json.
// Called per-hook so live edits (trinity on/off) take effect without restart.
const TIERS_FILE = join(USER_HOME, ".claude/model-tiers.json")
function loadSelection() {
  try {
    if (!existsSync(TIERS_FILE)) return DFLT_SEL
    const st = statSync(TIERS_FILE)
    if (st.size > 10485760) { _handleStateCorruption(TIERS_FILE); return DFLT_SEL }
    const j = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
    return {
      enabled:            j?.selection?.enabled !== false,
      active_slot:        j?.selection?.active_slot || null,
      thinking_level:     j?.selection?.thinking_level || "brief",
      flow_enabled:       j?.selection?.flow_enabled !== false,
      tdd_enforce:        j?.selection?.tdd_enforce === true,
      tdd_strict:         j?.selection?.tdd_strict === true,
      tdd_quality:        j?.selection?.tdd_quality === true,
      flow_enforce:       j?.selection?.flow_enforce !== false,
      delegation_enforce: j?.selection?.delegation_enforce !== false,
      savings_goal_usd:   Number(j?.selection?.savings_goal_usd || 0),
    }
  } catch { _handleStateCorruption(TIERS_FILE); return DFLT_SEL }
}
const DFLT_SEL = { enabled: true, active_slot: null, thinking_level: "brief", flow_enabled: true, tdd_enforce: false, tdd_strict: false, tdd_quality: false, flow_enforce: true, delegation_enforce: true, savings_goal_usd: 0 }

// Write a single key into selection block of model-tiers.json.
function writeSelection(key, value) {
  try {
    const j = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
    j.selection[key] = value
    const tmp = TIERS_FILE + ".tmp"
    writeFileSync(tmp, JSON.stringify(j, null, 2) + "\n")
    renameSync(tmp, TIERS_FILE)
    return true
  } catch (err) {
    console.error(`[vibeOS] writeSelection failed: ${err.message}`)
    return false
  }
}

// ── Blackbox state management ──────────────────────────────────────
let _blackboxTracker = null
let _blackboxEnabled = true
let _modelLocked = false
let _detectedFramework = null

export function loadBlackboxState() {
  try {
    if (!existsSync(BLACKBOX_STATE_FILE)) return { enabled: true, sessions: {} }
    const st = statSync(BLACKBOX_STATE_FILE)
    if (st.size > 10485760) { _handleStateCorruption(BLACKBOX_STATE_FILE); return { enabled: false, sessions: {} } }
    return safeJsonParse(readFileSync(BLACKBOX_STATE_FILE, "utf-8")) || { enabled: false, sessions: {} }
  } catch { _handleStateCorruption(BLACKBOX_STATE_FILE); return { enabled: false, sessions: {} } }
}

export function saveBlackboxState(state) {
  try {
    mkdirSync(dirname(BLACKBOX_STATE_FILE), { recursive: true })
    const tmp = BLACKBOX_STATE_FILE + ".tmp"
    writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n")
    renameSync(tmp, BLACKBOX_STATE_FILE)
  } catch (err) {
    console.error(`[vibeOS] saveBlackboxState failed: ${err.message}`)
  }
}

function getBlackboxTracker() {
  if (!_blackboxTracker) {
    const state = loadBlackboxState()
    if (state.enabled !== undefined) _blackboxEnabled = state.enabled
    const sid = _OC_SID
    if (state.sessions?.[sid]?.history) {
      _blackboxTracker = LocalBlackboxStub.deserialize(state.sessions[sid])
    } else if (currentProjectFingerprint) {
      const projectKeys = Object.keys(state.sessions || {}).filter(k => state.sessions[k].project_fingerprint === currentProjectFingerprint)
      const latest = projectKeys.sort().slice(-1)[0]
      if (latest && state.sessions[latest]?.history) {
        const data = state.sessions[latest]
        _blackboxTracker = LocalBlackboxStub.deserialize(data)
      } else {
        _blackboxTracker = new LocalBlackboxStub()
      }
    } else {
      _blackboxTracker = new LocalBlackboxStub()
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

let _prevOutputText = ""
let _latestBlackboxState = null
let _latestBlackboxLoopMsg = null
let _latestBlackboxPivotMsg = null

function resolveEnforcementMode() {
  const sub = _latestBlackboxState?.sub_regime || "INIT"
  if (sub === "EXPLORING" || sub === "DIVERGENT" || sub === "LOOPING") return "relaxed"
  if (sub === "CONVERGING" || sub === "CLOSED") return "strict"
  return "normal"
}

function detectOutcomeSignal(text) {
  if (!text) return null
  if (/thank|perfect|exactly|that.?s it|works great|works perfectly|solved|fixed|awesome|you rock/i.test(text)) return "positive"
  if (/doesn.?t work|still broken|not working|incorrect|wrong|failed|error|useless|stuck/i.test(text)) return "negative"
  return null
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

// Write active_slot AND update opencode.json model to the matching oc model.
export function applySlot(slot) {
  try {
    const j = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
    const ocModel = j?.trinity?.[slot]?.oc
    if (!ocModel) return { ok: false, reason: `slot '${slot}' has no oc model` }
    j.selection.active_slot = slot
    const _tmp = TIERS_FILE + ".tmp." + Date.now()
    writeFileSync(_tmp, JSON.stringify(j, null, 2) + "\n", "utf-8")
    renameSync(_tmp, TIERS_FILE)
    // Prefer project-local config to avoid mutating global provider/dropdown config.
    const localOcConfig = join(process.cwd(), "opencode.json")
    const ocConfig = existsSync(localOcConfig)
      ? localOcConfig
      : join(USER_HOME, ".config/opencode/opencode.json")
    if (existsSync(ocConfig)) {
      const oc = safeJsonParse(readFileSync(ocConfig, "utf-8"))
      oc.model = ocModel
      writeFileSync(ocConfig, JSON.stringify(oc, null, 2) + "\n")
    }
    _refreshModel(process.cwd())
    return { ok: true, ocModel }
  } catch (err) {
    return { ok: false, reason: err.message }
  }
}

// Map a model ID to a human-readable label with tier icon.
// Provider prefix is stripped before matching (everything before last "/").
function modelToSlotLabel(modelId: string, effectiveTier?: string) {
  const tier = effectiveTier ?? classify(modelId)
  const icon = tier === "high" ? "🧠" : tier === "mid" ? "⚙" : "⚡"
  return `[${icon} ${tier.charAt(0).toUpperCase() + tier.slice(1)}]`
}

function shortModelName(modelId) {
  const raw = String(modelId || "").trim()
  if (!raw) return "unknown"
  const parts = raw.split("/")
  return parts[parts.length - 1] || raw
}

function trendDisplay(sesTrend) {
  const t = sesTrend === "up" || sesTrend === "down" ? sesTrend : "stable"
  const icon = t === "up" ? "↑" : t === "down" ? "↓" : "→"
  return `${icon} ${t}`
}

function classify(m) {
  const s = String(m || "").toLowerCase()
  if (HIGH_TIER_RE.test(s)) return "high"
  if (MID_TIER_RE.test(s))  return "mid"
  return "budget"
}

// Memory mode: never throw / never stop. Track "would-have-blocked" events
// and surface cumulative savings to the GUI via experimental.text.complete.
const WARN_ON_DIRECT = new Set(["write", "edit", "notebookedit", "write_to_file", "replace_in_file", "apply_patch"])
const SOFT_QUOTA     = new Set(["bash", "webfetch", "websearch"])
const FREE           = new Set(["task","todowrite","question","skill","read","glob","grep","list"])

// Estimated $ savings per warn — fallback constants (used when model is unknown).
// Fallback savings estimates when modelCostPerTurn() returns null.
// These are floors — actual known models use their real turn cost.
// Values calibrated to the cheap end of the high tier (deepseek-v4-pro)
// to ensure savings reported are conservative, not aspirational.
const SAVE_EST = {
  WRITE_EDIT:   0.005,  // Conservative estimate for brain-tier vs worker-tier
  SOFT_QUOTA:   0.0003,  // tool runs regardless — nominal for tracking
  CONTEXT7:     0.002,   // webfetch turn cost for cheapest high-tier model
  OPUS_DISABLE: 0.03,    // full-turn cost for actual opus-tier model (Anthropic API)
}
// Estimated USD saved per 1M cached input tokens (miss_price - cache_hit_price).
// DeepSeek v4-pro: $0.14 - $0.0028 = $0.1372. General heuristic ~$0.10 across providers.
const CACHE_SAVED_PER_1M_INPUT_TOKENS = 0.10
// Approximate bytes per token for JSON/text content (varies 3-6, use 4 as safe estimate).
const BYTES_PER_TOKEN = 4

function roundUsd(v, precision = 6) {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return 0
  const f = 10 ** precision
  return Math.round(n * f) / f
}

function formatUsd(v) {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n) || n === 0) return "0.00"
  const abs = Math.abs(n)
  if (abs >= 0.01) return n.toFixed(2)
  if (abs >= 0.001) return n.toFixed(3)
  return n.toFixed(4)
}

// Models with negligible per-turn cost (less than 2e-5 USD/turn).
// These skip enforcement entirely to avoid noise.
const FREE_MODELS = new Set([
  "deepseek/deepseek-chat",         // free legacy v3 model on DeepSeek API
  "deepseek-chat",
  "deepseek/deepseek-v3",
])

// Approximate USD per typical ~1 K-token turn (blended input+output).
// Blend: 700 input + 300 output tokens per turn (line 272-273).
// Sources: provider API pricing pages, OpenRouter /api/v1/models.
// Add entries as new models appear; unknown models fall back to SAVE_EST constants.
// ── Auto-updated by scripts/sync-pricing.mjs before each release ──
const MODEL_USD_PER_TURN = {
  // ── Anthropic (Claude Code direct API) ─────────────────────
  "anthropic/claude-opus-4-7":            0.033,
  "anthropic/claude-opus-4-5":            0.033,
  "anthropic/claude-sonnet-4-6":          0.0066,
  "anthropic/claude-sonnet-4-5":          0.0066,
  "anthropic/claude-haiku-4-5":           0.0022,
  "anthropic/claude-haiku-4-5-20251001":  0.0022,
  "haiku":                                0.0022,
  // ── DeepSeek (OC platform + OpenRouter) ──────────────────
  "deepseek/deepseek-v4-pro":             0.00057,
  "deepseek/deepseek-v4-flash": 0.000182,
  "deepseek/deepseek-chat":               0,
  "deepseek-chat":                        0,
  "deepseek/deepseek-v3":                 0,
  "deepseek/deepseek-r1":                 0.00124,
  "deepseek/deepseek-reasoner":           0.000182,
  "deepseek/haiku":                       0.0022,
  // ── Google Gemini ────────────────────────────────────────
  "google/gemini-2.5-pro":                0.0039,
  "google/gemini-2.5-flash":              0.00096,
  "google/gemini-2.0-flash":              0.00019,
  // ── OpenAI ───────────────────────────────────────────────
  "openai/gpt-4o":                        0.00475,
  "openai/gpt-4.1":                       0.0038,
  "openai/gpt-4o-mini":                   0.00029,
  "openai/gpt-4.1-mini":                  0.00019,
  "openai/o3":                            0.0038,
  "openai/o4-mini":                       0.0021,
}

const TURN_BLEND_INPUT_TOKENS = 700
const TURN_BLEND_OUTPUT_TOKENS = 300
let _dynamicPricingCache = null
let _dynamicPricingCacheLoadedAt = 0

function _loadDynamicPricingCache() {
  const now = Date.now()
  if (_dynamicPricingCache && (now - _dynamicPricingCacheLoadedAt) < 10_000) return _dynamicPricingCache
  _dynamicPricingCacheLoadedAt = now
  try {
    if (!existsSync(PRICING_CACHE_FILE)) return {}
    const st = statSync(PRICING_CACHE_FILE)
    if (st.size > 10485760) { _handleStateCorruption(PRICING_CACHE_FILE); _dynamicPricingCache = {}; return {} }
    const raw = safeJsonParse(readFileSync(PRICING_CACHE_FILE, "utf-8"))
    const map = raw?.models && typeof raw.models === "object" ? raw.models : {}
    _dynamicPricingCache = map
  } catch {
    _handleStateCorruption(PRICING_CACHE_FILE)
    _dynamicPricingCache = {}
  }
  return _dynamicPricingCache
}

function _dynamicCostFor(model) {
  const key = normalizeModelId(model)
  const cache = _loadDynamicPricingCache()
  const map = _getNormalizedCostMap()
  if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key]
  for (const [k, v] of Object.entries(cache)) {
    if (key === k) return v
    if (key.startsWith(k) && /-\d+$/.test(k) && key.charAt(k.length) === "-") return v
  }
  return null
}

function _parseOpenRouterTurnCost(modelRow) {
  const p = modelRow?.pricing || {}
  const inTok = Number(p.prompt ?? p.input ?? p.request)
  const outTok = Number(p.completion ?? p.output ?? p.response)
  if (Number.isFinite(inTok) && Number.isFinite(outTok)) {
    return inTok * TURN_BLEND_INPUT_TOKENS + outTok * TURN_BLEND_OUTPUT_TOKENS
  }
  const oneTok = Number(p.price ?? p.total ?? p.input ?? p.output)
  if (Number.isFinite(oneTok)) return oneTok * 1000
  return null
}

function _writeDynamicPricingCache(modelsMap) {
  if (!modelsMap || typeof modelsMap !== "object") return
  try {
    withFileLock(PRICING_CACHE_FILE, () => {
      mkdirSync(dirname(PRICING_CACHE_FILE), { recursive: true })
      const tmp = PRICING_CACHE_FILE + ".tmp"
      writeFileSync(tmp, JSON.stringify({
        ts: Date.now(),
        source: "openrouter-models",
        models: modelsMap,
      }, null, 2) + "\n")
      renameSync(tmp, PRICING_CACHE_FILE)
    })
    _dynamicPricingCache = modelsMap
    _dynamicPricingCacheLoadedAt = Date.now()
  } catch {}
}

// Strip routing prefixes (openrouter/, opencode/) and normalize version dots
// so "openrouter/anthropic/claude-sonnet-4.6" → "anthropic/claude-sonnet-4-6"
function normalizeModelId(model) {
  let m = String(model || "").toLowerCase()
  if (m.startsWith("openrouter/")) m = m.slice("openrouter/".length)
  if (m.startsWith("opencode/"))   m = m.slice("opencode/".length)
  m = m.replace(/(\d)\.(\d)/g, "$1-$2")  // 4.6 → 4-6
  return m
}

let _modelCostMapNormalized = null
function _getNormalizedCostMap() {
  if (_modelCostMapNormalized) return _modelCostMapNormalized
  _modelCostMapNormalized = {}
  for (const [k, v] of Object.entries(MODEL_USD_PER_TURN)) {
    const kd = k.replace(/(\d)\.(\d)/g, "$1-$2")
    _modelCostMapNormalized[kd] = v
    _modelCostMapNormalized[k] = v
  }
  return _modelCostMapNormalized
}

export function modelCostPerTurn(model) {
  if (!model) return 0
  const dyn = _dynamicCostFor(model)
  if (dyn != null) return dyn
  const key = normalizeModelId(model)
  const map = _getNormalizedCostMap()
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key]
  // Prefix match for versioned model IDs (e.g. "claude-opus-4-7-20251001")
  for (const [k, v] of Object.entries(map)) {
    if (key.startsWith(k) && /-\d+$/.test(k) && key.charAt(k.length) === "-") return v
  }
  // Log unknown models so we can add entries
  console.error(`[vibeOS] modelCostPerTurn: unknown model '${model}' (normalized: '${key}') — add to MODEL_USD_PER_TURN`)
  return null  // unknown — callers fall back to SAVE_EST constants
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
      console.error(`[vibeOS] ${cat}: ${cc} warnings coalesced — \`trinity medium\` recommended`)
    }
    return false
  }
  warnPerSession.set(cat, ps + 1)
  return true
}

export function isModelFree(model) {
  if (!model || typeof model !== "string") return false
  if (FREE_MODELS.has(model)) return true
  if (FREE_MODELS.has(normalizeModelId(model))) return true
  const cost = modelCostPerTurn(model)
  return cost !== null && cost === 0
}

// Context7 detection — scan known config files for the string "context7".
// Cheap (one-time at module load); falsy → docs nudge stays dormant.
const CONTEXT7_CONFIG_FILES = [
  join(USER_HOME, ".claude/settings.json"),
  join(USER_HOME, ".claude.json"),
  join(USER_HOME, ".config/opencode/opencode.json"),
]
export function detectContext7(files = CONTEXT7_CONFIG_FILES) {
  if (process.env.CLAUDE_CONTEXT7_AVAILABLE) return true
  for (const f of files) {
    try {
      if (existsSync(f) && /context7/i.test(readFileSync(f, "utf-8"))) return true
    } catch {}
  }
  return false
}

const DOCS_TARGET_RE = /(docs\.|readthedocs|developer\.mozilla|\/api\/|\/reference\/|\/guide\/|npmjs\.com\/package\/|pypi\.org\/project\/|crates\.io\/crates\/|pkg\.go\.dev|api-docs|\/javadoc\/)/i
export function isDocsTarget(s) {
  return typeof s === "string" && DOCS_TARGET_RE.test(s)
}

export function scoreStress(text: string): number {
  if (!text || typeof text !== "string") return 0
  const t = text.toLowerCase()
  let score = 0

  const aggressive = ["fuck","shit","bullshit","useless","wrong","bad","slow","broken","stupid","idiot","hell","damn","waste","annoying","terrible","hate"]
  for (const w of aggressive) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi")
    const hits = (t.match(re) || []).length
    score += hits * 0.05
  }

  const urgency = ["fix","now","fast","urgent","important","critical","hurry","immediately","asap"]
  for (const w of urgency) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi")
    const hits = (t.match(re) || []).length
    score += hits * 0.04
  }

  const negative = ["no","not","don't","can't","won't","doesn't","isn't","shouldn't","never","stop"]
  for (const w of negative) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi")
    const hits = (t.match(re) || []).length
    score += hits * 0.02
  }

  const capsAcronyms = new Set(["ai","ui","api","cli","ssh","dns","http","url","json","xml","css","html","sql","csv","yaml","ide","tdd","pr","ci","cd","env","os","sdk","gui","crud","rest","crlf","utf","ascii"])
  const words = text.split(/\s+/)
  for (const w of words) {
    if (w.length >= 3 && /^[A-Z]+$/.test(w) && !capsAcronyms.has(w.toLowerCase())) {
      score += 0.03
    }
  }

  const exclamParts = text.match(/!{2,}/g)
  if (exclamParts) score += exclamParts.length * 0.05

  const qmarkParts = text.match(/\?{2,}/g)
  if (qmarkParts) score += qmarkParts.length * 0.03

  const qeCombos = text.match(/\?!|!\?/g)
  if (qeCombos) score += qeCombos.length * 0.08

  if (text.length < 30) score += 0.10
  else if (text.length < 80) score += 0.05
  else if (text.length < 150) score += 0.02

  return Math.min(score, 1.0)
}

function estimateContextBudget(_input, output) {
  try {
    const DEFAULT_CONTEXT_LIMIT = 128000
    const CHARS_PER_TOKEN = 4
    let totalChars = 0
    const messages = output?.messages
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        const parts = msg?.parts
        if (!Array.isArray(parts)) continue
        for (const part of parts) {
          if (part?.type === "text" && typeof part.text === "string") {
            totalChars += part.text.length
          } else if (part?.type === "tool" && typeof part.state?.output === "string") {
            totalChars += part.state.output.length
          }
        }
      }
    }
    const systemParts = output?.system
    if (Array.isArray(systemParts)) {
      for (const s of systemParts) {
        if (typeof s === "string") totalChars += s.length
      }
    }
    const estimatedTokens = Math.round(totalChars / CHARS_PER_TOKEN)
    const pct = Math.round((estimatedTokens / DEFAULT_CONTEXT_LIMIT) * 100)
    return { estimatedTokens, pct, totalChars }
  } catch {
    return null
  }
}

// Per-process dedup so the same docs URL doesn't nudge twice.
const context7Seen = new Set()

// ── Scratchpad-cache READ-ONLY detection ─────────────────────────────
// The bash scratchpad.sh writes ~/.claude/scratch/by-hash/<hash>.txt
// keyed by sha256(tool_name + "\n" + tool_input_json) (first 16 chars).
// Claude Code tools are TitleCase (Read/Bash/Grep), opencode tools are
// lowercase (read/bash/grep). To allow cross-runtime cache reuse without
// any writes, we normalize opencode → TitleCase for the hash lookup.
//
// Conservative: detect + log + count hits. Do NOT short-circuit the tool
// (cache may be stale; bash hook validates freshness, JS just observes
// for now).
const SCRATCHPAD_ROOT = join(USER_HOME, ".claude/scratch")
const SCRATCHPAD_GLOBAL_DIR = join(SCRATCHPAD_ROOT, "by-hash")
const SCRATCHPAD_SESSIONS_DIR = join(SCRATCHPAD_ROOT, "sessions")
const SCRATCHPAD_SESSION_TTL_MS = 48 * 60 * 60 * 1000
const SCRATCHPAD_MAX_AGE_SEC = Number(process.env.CLAUDE_SCRATCHPAD_MAX_AGE_SEC || 86400)
const TOOL_NAME_NORMALIZE = {
  read: "Read", bash: "Bash", grep: "Grep", glob: "Glob",
  webfetch: "WebFetch", websearch: "WebSearch", list: "LS",
  // Deterministic OpenCode-native tools — same input = same output
  "context7_query-docs": "Context7QueryDocs",
  "context7_resolve-library-id": "Context7ResolveLibrary",
  obsidian: "Obsidian",   // read action: note content is immutable for same query
}
const SCRATCHPAD_TOOLS = new Set(Object.keys(TOOL_NAME_NORMALIZE))
// Per-process dedup so the same hit isn't logged 5x in one turn.
const scratchpadHitsSeen = new Set()
const _OC_SID = "opencode-" + (process.pid || "x") + "-" + Date.now()
function getSessionRoot() { return join(SCRATCHPAD_SESSIONS_DIR, _OC_SID) }
function getSessionScratchpadDir() { return join(getSessionRoot(), "by-hash") }
function getSessionIndexPath() { return join(getSessionRoot(), "index.jsonl") }
function getGlobalIndexPath() { return join(SCRATCHPAD_ROOT, "index.jsonl") }
function ensureSessionScratchpadDirs() {
  try {
    mkdirSync(getSessionScratchpadDir(), { recursive: true })
    return true
  } catch { return false }
}

function safeCopyIntoSession(hash, fromPath) {
  try {
    if (!ensureSessionScratchpadDirs()) return
    const sessionPath = join(getSessionScratchpadDir(), `${hash}.txt`)
    if (!existsSync(sessionPath)) {
      copyFileSync(fromPath, sessionPath)
      const globalSummary = join(SCRATCHPAD_GLOBAL_DIR, `${hash}.summary.txt`)
      const sessionSummary = join(getSessionScratchpadDir(), `${hash}.summary.txt`)
      if (existsSync(globalSummary) && !existsSync(sessionSummary)) {
        copyFileSync(globalSummary, sessionSummary)
      }
    }
  } catch {}
}
let _sessionCleanupRegistered = false
let _sessionCacheCleaned = false
function cleanupCurrentSessionScratchpad() {
  if (_sessionCacheCleaned) return
  _sessionCacheCleaned = true
  try {
    rmSync(getSessionRoot(), { recursive: true, force: true })
  } catch {}
}
function registerSessionCleanupHandlers() {
  if (_sessionCleanupRegistered) return
  _sessionCleanupRegistered = true
  if (process._vibeOS_cleanupRegistered) return
  process._vibeOS_cleanupRegistered = true
  process.setMaxListeners(20)
  ensureSessionScratchpadDirs()
  cleanupStaleSessionScratchpads()
  process.on("exit", () => { _flushLedgerBuffer(); cleanupCurrentSessionScratchpad() })
  process.on("SIGINT", () => {
    cleanupCurrentSessionScratchpad()
    process.exit(130)
  })
}

// Ledger write buffer: flushes every 10 entries or after 5s.
let _ledgerBuffer = []
let _ledgerBufferTimer = null
const LEDGER_BUFFER_MAX = 10
const LEDGER_BUFFER_FLUSH_MS = 5000

function _flushLedgerBuffer() {
  if (_ledgerBufferTimer) { clearTimeout(_ledgerBufferTimer); _ledgerBufferTimer = null }
  if (_ledgerBuffer.length === 0) return
  const batch = _ledgerBuffer.splice(0)
  try { appendFileSync(SAVINGS_LEDGER_FILE, batch.join("")) } catch {}
}

export function getScratchpadHit(toolLower, args, baseDir = null) {
  if (!SCRATCHPAD_TOOLS.has(toolLower)) return null
  const titleCase = TOOL_NAME_NORMALIZE[toolLower]
  // Use stable JSON (sorted keys) so OC and CC produce the same hash
  // regardless of property insertion order.
  const inputJson = stableJson(args ?? {})
  const hash = createHash("sha256").update(`${titleCase}\n${inputJson}\n`).digest("hex").slice(0, 16)
  const sessionDir = baseDir || getSessionScratchpadDir()
  const globalDir = SCRATCHPAD_GLOBAL_DIR
  const sessionPath = join(sessionDir, `${hash}.txt`)
  const globalPath = join(globalDir, `${hash}.txt`)
  let fullPath = existsSync(sessionPath) ? sessionPath : (existsSync(globalPath) ? globalPath : null)
  if (!fullPath) {
    const recent = scanRecentScratchpad(sessionDir, titleCase, 2000) || scanRecentScratchpad(globalDir, titleCase, 2000)
    if (recent) return recent
    return null
  }
  try {
    const st = statSync(fullPath)
    const ageSec = (Date.now() - st.mtimeMs) / 1000
    if (ageSec > SCRATCHPAD_MAX_AGE_SEC) return null
    if (fullPath === globalPath) safeCopyIntoSession(hash, globalPath)
    const sessionSummaryPath = join(sessionDir, `${hash}.summary.txt`)
    const globalSummaryPath = join(globalDir, `${hash}.summary.txt`)
    const summaryPath = existsSync(sessionSummaryPath) ? sessionSummaryPath : globalSummaryPath
    return {
      hash, fullPath, sizeBytes: st.size, ageSec: Math.round(ageSec),
      summaryPath: existsSync(summaryPath) ? summaryPath : null,
    }
  } catch { return null }
}

// Stable JSON serialization with sorted keys — matches CC's shasum output.
function stableJson(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj)
  if (Array.isArray(obj)) return "[" + obj.map(stableJson).join(",") + "]"
  return "{" + Object.keys(obj).sort()
    .map(k => JSON.stringify(k) + ":" + stableJson(obj[k]))
    .join(",") + "}"
}

function _lockPathFor(filePath) {
  const hash = createHash("sha1").update(String(filePath || "")).digest("hex")
  return join(FILE_LOCK_DIR, `${hash}.lock`)
}

function withFileLock(filePath, fn, opts = {}) {
  const staleMs = Number(opts.staleMs || 30_000)
  const timeoutMs = Number(opts.timeoutMs || 2_000)
  const lockPath = _lockPathFor(filePath)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      mkdirSync(FILE_LOCK_DIR, { recursive: true })
      const fd = openSync(lockPath, "wx")
      try { writeFileSync(fd, `${process.pid}\n${Date.now()}\n`) } catch {}
      try {
        return fn()
      } finally {
        try { closeSync(fd) } catch {}
        try { rmSync(lockPath, { force: true }) } catch {}
      }
    } catch (err) {
      try {
        if (existsSync(lockPath)) {
          const age = Date.now() - statSync(lockPath).mtimeMs
          if (age > staleMs) {
            try { rmSync(lockPath, { force: true }) } catch {}
          }
        }
      } catch {}
    }
  }
  throw new Error(`[vibeOS] lock not acquired for ${filePath} after ${timeoutMs}ms`)
}

function readJsonOrEmpty(filePath) {
  try {
    if (!existsSync(filePath)) return {}
    const st = statSync(filePath)
    if (st.size > 10485760) {
      _handleStateCorruption(filePath)
      return {}
    }
    return safeJsonParse(readFileSync(filePath, "utf-8"))
  } catch { _handleStateCorruption(filePath); return {} }
}

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
      console.error(`[vibeOS] WARN: updateState retry exhausted - possible state divergence`)
      return result
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) continue
      console.error(`[vibeOS] updateState error: ${err.message}`)
      return null
    }
  }
  return null
}
setFlowStateWriter((state) => {
  withFileLock(STATE_FILE, () => {
    mkdirSync(dirname(STATE_FILE), { recursive: true })
    const existing = readJsonOrEmpty(STATE_FILE)
    const merged = Object.assign({}, existing, { flow_warns: state.flow_warns, _gen: Math.max(existing._gen || 0, state._gen || 0) })
    const tmp = STATE_FILE + ".tmp"
    writeFileSync(tmp, JSON.stringify(merged, null, 2))
    renameSync(tmp, STATE_FILE)
  })
})
// Bootstrap current session on startup
updateState((s) => {
  s.sessions ??= {}
  const sid = _OC_SID
  s.sessions[sid] ??= { started: new Date().toISOString(), source: "opencode", tool_counts: {}, warns: [] }
  if (currentProjectFingerprint) s.sessions[sid].project_fingerprint = currentProjectFingerprint
  if (currentProjectName) s.sessions[sid].project_name = currentProjectName
  return s
})

// Fallback: scan scratchpad for files written within the last N ms.
let _lastScan = 0
function scanRecentScratchpad(baseDir, toolName, windowMs) {
  try {
    if (!existsSync(baseDir)) return null
    const now = Date.now()
    // Throttle scans to once per 5s per process
    if (now - _lastScan < 5000) return null
    _lastScan = now
    const entries = readdirSync(baseDir)
    for (const entry of entries) {
      if (!entry.endsWith(".txt") || entry.endsWith(".summary.txt")) continue
      const fp = join(baseDir, entry)
      const st = statSync(fp)
      const ageMs = now - st.mtimeMs
      if (ageMs > windowMs) continue
      const summaryPath = join(baseDir, entry.replace(".txt", ".summary.txt"))
      return {
        hash: entry.replace(".txt", ""), fullPath: fp,
        sizeBytes: st.size, ageSec: Math.round(ageMs / 1000),
        summaryPath: existsSync(summaryPath) ? summaryPath : null,
      }
    }
  } catch {}
  return null
}

function recordScratchpadObservation() {
  try {
    const state = updateState((s) => {
      s.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" }
      s.lifetime.scratchpad_hits_observed = (s.lifetime.scratchpad_hits_observed || 0) + 1
      return s
    })
    return state?.lifetime?.scratchpad_hits_observed ?? null
  } catch { return null }
}

// One-time install-suggestion flag (persisted across processes) and
// per-session alert flag (process lifetime is fine — sidecar == session).
const CONTEXT7_INSTALL_FLAG = join(USER_HOME, ".claude/.context7-install-suggested")
let context7AlertedThisSession = false

// Pending UI note: set in tool.execute.before, consumed in tool.execute.after.
// Lets the delegation warning appear in the OC chat transcript (tool result),
// not just in stderr debug output.
let pendingUiNote = null
let enforcementBlocked = false
let taskSlotRestore = null
const ACTIVE_JOBS_FILE = join(USER_HOME, ".claude/active-jobs.json")
let activeJob = null
let latestUserIntent = null

// Lightweight turn classifier — detects Q&A vs implementation when blackbox is off
function classifyTurnSimple(userText: string): string {
  const lower = String(userText || "").trim()
  if (!lower) return "INIT"
  // Q&A / research patterns -> EXPLORING (relaxed enforcement)
  if (/^(how|what|why|when|where|who|can you|could you|tell me|explain|describe|show|list|check|is there|are there|does|do you|summarize|elaborate|clarify|inspect|trace|find|search|look|read|show me|dump)/i.test(lower)) {
    return "EXPLORING"
  }
  // Implementation / write patterns -> REFINING (normal enforcement)
  if (/^(write|create|add|build|implement|fix|change|edit|modify|update|refactor|generate|make|commit|push|deploy|release|publish|install|remove|delete|rename|move|copy|transform|convert|migrate)/i.test(lower)) {
    return "REFINING"
  }
  return "INIT"
}
function tokenizeWords(text) {
  if (!text || typeof text !== "string") return []
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w.length > 2)
}

function topKeywords(text, max = 10) {
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "your", "you", "are", "but", "not", "all", "can", "use", "was", "have", "has", "had", "they", "them", "their", "then", "than", "when", "what", "why", "how", "who", "will", "would", "should", "about", "check", "make", "build", "write", "edit", "file", "code", "test", "tests", "run"])
  const freq = new Map()
  for (const w of tokenizeWords(text)) {
    if (stop.has(w)) continue
    freq.set(w, (freq.get(w) || 0) + 1)
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w)
}

function loadActiveJobs() {
  try {
    if (!existsSync(ACTIVE_JOBS_FILE)) return {}
    const st = statSync(ACTIVE_JOBS_FILE)
    if (st.size > 10485760) { _handleStateCorruption(ACTIVE_JOBS_FILE); return {} }
    const raw = safeJsonParse(readFileSync(ACTIVE_JOBS_FILE, "utf-8"))
    if (!raw || typeof raw !== "object") return {}
    return raw
  } catch {
    _handleStateCorruption(ACTIVE_JOBS_FILE)
    return {}
  }
}

function getActiveJobForProject(fp = currentProjectFingerprint) {
  if (!fp) return null
  const jobs = loadActiveJobs()
  const job = jobs[fp]
  if (!job || typeof job !== "object") return null
  return job
}

function saveActiveJobForProject(job, fp = currentProjectFingerprint) {
  if (!fp || !job || typeof job !== "object") return
  try {
    const jobs = loadActiveJobs()
    jobs[fp] = job
    mkdirSync(dirname(ACTIVE_JOBS_FILE), { recursive: true })
    const tmp = ACTIVE_JOBS_FILE + ".tmp"
    writeFileSync(tmp, JSON.stringify(jobs, null, 2))
    renameSync(tmp, ACTIVE_JOBS_FILE)
  } catch {}
}

function setActiveJobFromTaskPrompt(prompt) {
  if (!prompt || typeof prompt !== "string") return
  const p = prompt.trim()
  if (p.length < 24) return
  activeJob = {
    prompt: p.slice(0, 1200),
    keywords: topKeywords(p, 12),
    updatedAt: new Date().toISOString(),
  }
  saveActiveJobForProject(activeJob)
}

function extractLastUserText(obj) {
  if (!obj || typeof obj !== "object") return null
  const candidates = []
  const scan = (v) => {
    if (!v || typeof v !== "object") return
    if (Array.isArray(v)) {
      for (const i of v) scan(i)
      return
    }
    if (v.role === "user" && typeof v.content === "string") candidates.push(v.content)
    if (typeof v.text === "string") candidates.push(v.text)
    for (const val of Object.values(v)) scan(val)
  }
  scan(obj)
  if (!candidates.length) return null
  return candidates[candidates.length - 1]
}

function isUserAskingForTests(text) {
  if (!text || typeof text !== "string") return false
  return /\b(test|tests|typecheck|coverage|qa|regression|e2e|unit test|integration test)\b/i.test(text)
}

function isLikelyOffTopic(userText, job) {
  if (!userText || !job?.keywords?.length) return false
  if (/\b(new task|switch task|different task|ignore previous|start over)\b/i.test(userText)) return false
  const now = Date.now()
  const updatedAt = Date.parse(job.updatedAt || "")
  if (!Number.isFinite(updatedAt) || now - updatedAt > 2 * 60 * 60 * 1000) return false
  const userWords = new Set(topKeywords(userText, 12))
  const overlap = job.keywords.filter((k) => userWords.has(k))
  return overlap.length === 0 && userWords.size >= 3
}

function loadGlobalLearning() {
  try {
    if (!existsSync(GLOBAL_LEARNING_FILE)) return DFLT_GL
    const st = statSync(GLOBAL_LEARNING_FILE)
    if (st.size > 10485760) { _handleStateCorruption(GLOBAL_LEARNING_FILE); return DFLT_GL }
    const j = safeJsonParse(readFileSync(GLOBAL_LEARNING_FILE, "utf-8"))
    if (!j || typeof j !== "object") return DFLT_GL
    j.exploratory_words ??= {}
    j.task_first_words ??= {}
    return j
  } catch {
    _handleStateCorruption(GLOBAL_LEARNING_FILE)
    return DFLT_GL
  }
}
const DFLT_GL = { exploratory_words: {}, task_first_words: {}, updatedAt: null }

function updateGlobalLearning(mutator) {
  return withFileLock(GLOBAL_LEARNING_FILE, () => {
    const s = loadGlobalLearning()
    const next = mutator(s) ?? s
    next.updatedAt = new Date().toISOString()
    mkdirSync(dirname(GLOBAL_LEARNING_FILE), { recursive: true })
    const tmp = GLOBAL_LEARNING_FILE + ".tmp"
    writeFileSync(tmp, JSON.stringify(next, null, 2))
    renameSync(tmp, GLOBAL_LEARNING_FILE)
    return next
  })
}

function getLearnedExploratoryWords() {
  const out = new Set()
  try {
    const gl = loadGlobalLearning()
    for (const [w, meta] of Object.entries(gl.exploratory_words || {})) {
      if ((meta?.count || 0) >= 1) out.add(String(w))
    }
  } catch {}
  return out
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
      if (targetModel === TRINITY_CHEAP) localRow.cheap += 1
      else if (targetModel === TRINITY_MEDIUM) localRow.medium += 1
      else localRow.high += 1
      localRow.lastSeen = now
      bucket.taskWordPatterns[firstWord] = localRow
      saveProjectState(pstate)
    } catch {}

    updateGlobalLearning((gl) => {
      gl.task_first_words ??= {}
      const row = gl.task_first_words[firstWord] || { total: 0, cheap: 0, medium: 0, high: 0, lastSeen: null, lastReason: null }
      row.total += 1
      if (targetModel === TRINITY_CHEAP) row.cheap += 1
      else if (targetModel === TRINITY_MEDIUM) row.medium += 1
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

// Soft counter for hypothetical missed savings (no locking — drift acceptable
// for a hypothetical metric). Mirrors bash record_missed_c7().
function recordMissedContext7(saveEst) {
  try {
    const state = updateState((s) => {
      s.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" }
      s.lifetime.missed_context7_usd = Math.round(
        ((s.lifetime.missed_context7_usd || 0) + saveEst) * 100
      ) / 100
      return s
    })
    try {
      if (currentProjectFingerprint) {
        const pstate = loadProjectState()
        const bucket = ensureProjectBucket(pstate, currentProjectFingerprint)
        bucket.context7Bypasses = (bucket.context7Bypasses || 0) + 1
        bucket.lastSeen = new Date().toISOString()
        saveProjectState(pstate)
      }
    } catch {}
    return state?.lifetime?.missed_context7_usd ?? null
  } catch { return null }
}

function detectTechStack(dir) {
  const stacks = []
  try {
    const pkg = safeJsonParse(readFileSync(join(dir, "package.json"), "utf-8"))
    if (pkg) {
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript || existsSync(join(dir, "tsconfig.json"))) stacks.push("typescript")
      if (pkg.dependencies?.react || pkg.devDependencies?.react) stacks.push("react")
      stacks.push("javascript")
    }
  } catch {}
  try {
    if (existsSync(join(dir, "Cargo.toml"))) stacks.push("rust")
  } catch {}
  try {
    if (existsSync(join(dir, "go.mod"))) stacks.push("go")
  } catch {}
  try {
    if (existsSync(join(dir, "requirements.txt"))) stacks.push("python")
    if (existsSync(join(dir, "setup.py"))) stacks.push("python")
    if (existsSync(join(dir, "pyproject.toml"))) stacks.push("python")
  } catch {}
  return [...new Set(stacks)]
}

// Test-reminder: per-process dedup so we don't nudge for the same file twice.
const testReminderSeen = new Set()
const SOURCE_EXT_RE = /\.(py|js|ts|mjs|tsx|jsx|cjs|mts|sh|go|rs|rb|java|kt)$/i
const SKIP_PATH_RE = /(\/(node_modules|\.venv|dist|build|__pycache__)\/|\/(tests?|spec)\/|test_[^/]+\.py$|_test\.py$|\.test\.[a-z]+$|\.spec\.[a-z]+$|\.config\/opencode\/plugins\/)/i

// ── TDD Enforcement — skeleton templates with incomplete markers ────────────
// Each skeleton CANNOT pass silently — uses language-specific skip/fail markers.
// Extract function/class/export names from source code per language.
// Returns an array of { name, type } objects.
export function extractExports(sourceContent, ext) {
  if (!sourceContent || typeof sourceContent !== "string") return []
  const exports = []
  const seen = new Set()
  const add = (name, type = "function") => {
    if (name && !seen.has(name)) { seen.add(name); exports.push({ name, type }) }
  }

  switch (ext) {
    case "py": {
      // def function_name( (exclude _private)
      for (const m of sourceContent.matchAll(/^def\s+([a-zA-Z]\w*)\s*\(/gm)) add(m[1])
      // class ClassName(
      for (const m of sourceContent.matchAll(/^class\s+([a-zA-Z_]\w*)\s*[\(:]/gm)) add(m[1], "class")
      break
    }
    case "js": case "mjs": case "jsx": {
      // export function name(
      for (const m of sourceContent.matchAll(/export\s+(?:async\s+)?function\s+([a-zA-Z_$]\w*)\s*\(/g)) add(m[1])
      // export const name = ...
      for (const m of sourceContent.matchAll(/export\s+const\s+([a-zA-Z_$]\w*)\s*=/g)) add(m[1])
      // function name( (non-exported, fallback)
      if (exports.length === 0) {
        for (const m of sourceContent.matchAll(/^(?:async\s+)?function\s+([a-zA-Z_$]\w*)\s*\(/gm)) add(m[1])
      }
      break
    }
    case "ts": case "tsx": {
      // export function name(
      for (const m of sourceContent.matchAll(/export\s+(?:async\s+)?function\s+([a-zA-Z_$]\w*)\s*\(/g)) add(m[1])
      // export const name = ...
      for (const m of sourceContent.matchAll(/export\s+const\s+([a-zA-Z_$]\w*)\s*[:=]/g)) add(m[1])
      // export class Name
      for (const m of sourceContent.matchAll(/export\s+class\s+([a-zA-Z_$]\w*)/g)) add(m[1], "class")
      break
    }
    case "go": {
      // func (r Receiver) Name( or func Name(
      for (const m of sourceContent.matchAll(/func\s+(?:\([^)]+\)\s+)?([A-Z]\w*)\s*\(/g)) add(m[1])
      break
    }
    case "rs": {
      // pub fn name(
      for (const m of sourceContent.matchAll(/pub\s+fn\s+([a-zA-Z_]\w*)\s*</g)) add(m[1])
      for (const m of sourceContent.matchAll(/pub\s+fn\s+([a-zA-Z_]\w*)\s*\(/g)) add(m[1])
      // pub struct Name
      for (const m of sourceContent.matchAll(/pub\s+struct\s+([a-zA-Z_]\w*)/g)) add(m[1], "struct")
      break
    }
    case "rb": {
      // def method_name
      for (const m of sourceContent.matchAll(/def\s+(?:self\.)?([a-zA-Z_]\w*[?!=]?)/g)) add(m[1])
      // class Name
      for (const m of sourceContent.matchAll(/class\s+([A-Z]\w*)/g)) add(m[1], "class")
      break
    }
    case "java": case "kt": {
      // public/protected type name(
      for (const m of sourceContent.matchAll(/(?:public|protected)\s+(?:static\s+)?(?:final\s+)?\S+\s+([a-zA-Z_$]\w*)\s*\(/g)) add(m[1])
      // fun name(
      for (const m of sourceContent.matchAll(/fun\s+([a-zA-Z_$]\w*)\s*\(/g)) add(m[1])
      break
    }
    case "sh": {
      // function name { or name() {
      for (const m of sourceContent.matchAll(/^(?:function\s+)?([a-zA-Z_]\w*)\s*\(\)\s*\{/gm)) add(m[1])
      for (const m of sourceContent.matchAll(/^function\s+([a-zA-Z_]\w*)/gm)) add(m[1])
      break
    }
  }
  return exports
}

// Generate test case names for a given function name.
// Returns array of descriptive test case names.
function generateTestCaseNames(funcName, _type, quality = false) {
  const base = funcName.replace(/^[_$]+/, "")
  if (!quality) {
    return [
      `should ${base} with valid input`,
      `should handle invalid input for ${base}`,
      `should handle edge cases in ${base}`,
    ]
  }
  // Quality mode gives richer, signature-aware names
  return [
    `${base}: works correctly with typical valid input`,
    `${base}: raises gracefully on invalid/malformed input`,
    `${base}: handles boundary and edge-case values`,
  ]
}

// Extract parameter names from a function's source code for type inference.
function inferFunctionParams(sourceContent, funcName) {
  if (!sourceContent || !funcName) return []
  const patterns = [
    new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${funcName}\\s*\\(([^)]*)\\)`, 'm'),
    new RegExp(`(?:export\\s+)?const\\s+${funcName}\\s*[:=]\\s*(?:async\\s+)?\\(([^)]*)\\)`, 'm'),
    new RegExp(`(?:export\\s+)?const\\s+${funcName}\\s*[:=]\\s*(?:async\\s+)?function\\s*\\(([^)]*)\\)`, 'm'),
    new RegExp(`def\\s+${funcName}\\s*\\(([^)]*)\\)`, 'm'),
    new RegExp(`fun\\s+${funcName}\\s*\\(([^)]*)\\)`, 'm'),
  ]
  for (const pat of patterns) {
    const m = sourceContent.match(pat)
    if (m) {
      return m[1].split(',').map(s => {
        const trimmed = s.trim()
        if (!trimmed) return null
        // Extract name from "name: Type = default" or "name=default" or just "name"
        const nameMatch = trimmed.match(/^\s*((?:public|protected)|static|final|val|var|let|const)?\s*(?:readonly\s+)?(?:[_$a-zA-Z][_$a-zA-Z0-9]*)\s*(?::|(?=\s*=)|(?=\s*[,)]))/)
        const rawName = trimmed.replace(/^[^a-zA-Z_$]*/, '').replace(/[=:].*$/, '').replace(/\s+.*$/, '').trim()
        const defaultMatch = trimmed.match(/=\s*(.+)$/)
        const typeMatch = trimmed.match(/:\s*(\w+)/)
        return {
          name: rawName || `arg${Math.random().toString(36).slice(2, 5)}`,
          type: typeMatch ? typeMatch[1] : null,
          defaultValue: defaultMatch ? defaultMatch[1].trim() : null,
        }
      }).filter(Boolean)
    }
  }
  return []
}

// Infer likely type from parameter name heuristics when no type annotation exists.
function inferTypeFromName(paramName, defaultValue) {
  if (!paramName) return "any"
  const name = paramName.toLowerCase()
  if (defaultValue !== null && defaultValue !== undefined) {
    if (/^["']/.test(defaultValue)) return "string"
    if (/^\d+\.?\d*$/.test(defaultValue)) return "number"
    if (/^(true|false)$/i.test(defaultValue)) return "boolean"
    if (/^\[/.test(defaultValue)) return "array"
    if (/^\{/.test(defaultValue)) return "object"
    if (/^null$/i.test(defaultValue)) return "null"
  }
  if (/^(is|has|can|should|will|did|was|are|contains?_|[A-Z])/.test(name)) return "boolean"
  if (/^(count|index|limit|offset|max|min|size|length|total|num|age)_?/.test(name)) return "number"
  if (/^(name|title|label|msg|message|text|str|prefix|suffix|path|url|email|id)_?/.test(name)) return "string"
  if (/^(items|list|arr|entries|data|values|args)_?/.test(name)) return "array"
  if (/^(obj|config|opts|options|settings|params|props)_?/.test(name)) return "object"
  if (/^(fn|cb|callback|handler|on[A-Z])/.test(name)) return "function"
  return "any"
}

// Map language key to language name for comment syntax.
function _langComment(lang) {
  const map = { py: "#", js: "//", mjs: "//", ts: "//", tsx: "//", jsx: "//", go: "//", rs: "//", rb: "#", sh: "#", java: "//", kt: "//" }
  return map[lang] || "//"
}

// Generate quality assertion templates for a single function based on inferred signature.
function buildQualityAssertionsForFunc(funcName, params, lang, indent) {
  const cmt = _langComment(lang)
  const nl = lang === "py" || lang === "rb" || lang === "sh" ? "\n" : "\n"
  let block = ""

  // Determine test-value defaults per parameter
  const testValues = params.map(p => {
    const t = p.type || inferTypeFromName(p.name, p.defaultValue)
    if (t === "string" || t === "String") return '"sample_input"'
    if (t === "number" || t === "int" || t === "float" || t === "Number") return "42"
    if (t === "boolean" || t === "bool" || t === "Boolean") return "true"
    if (t === "array" || t === "Array" || t === "list" || t === "List") return "[]"
    if (t === "object" || t === "Object" || t === "dict" || t === "Dict") return "{}"
    if (t === "function" || t === "Function") return "() => {}"
    if (t === "any") return '"test"'
    if (t === "null") return "null"
    return '"test"'
  })

  const args = testValues.join(", ")

  switch (lang) {
    case "py": {
      block += `${indent}def test_${funcName}_valid_input():\n`
      block += `${indent}    """Assert ${funcName} runs with typical valid input."""\n`
      block += `${indent}    result = ${funcName}(${args})\n`
      block += `${indent}    assert result is not None\n\n`
      block += `${indent}def test_${funcName}_invalid_input():\n`
      block += `${indent}    """Assert ${funcName} raises on None/null input where applicable."""\n`
      block += `${indent}    with pytest.raises((TypeError, ValueError)):\n`
      block += `${indent}        ${funcName}(None)\n\n`
      block += `${indent}def test_${funcName}_edge_cases():\n`
      block += `${indent}    """Assert ${funcName} handles boundary values."""\n`
      const ecArgs = params.map(p => {
        const t = p.type || inferTypeFromName(p.name, p.defaultValue)
        if (t === "string") return '""'
        if (t === "number" || t === "int" || t === "float") return "0"
        return '"edge"'
      }).join(", ")
      block += `${indent}    result = ${funcName}(${ecArgs})\n`
      block += `${indent}    assert result is not None\n\n`
      break
    }
    case "js": case "mjs": case "ts": case "tsx": case "jsx": {
      const blkLang = (lang === "ts" || lang === "tsx") ? "it" : "test"
      block += `${indent}${blkLang}('${funcName}: handles valid input', () => {\n`
      block += `${indent}  const result = mod.${funcName}(${args});\n`
      block += `${indent}  expect(result).toBeDefined();\n`
      block += `${indent}});\n\n`
      block += `${indent}${blkLang}('${funcName}: rejects invalid input', () => {\n`
      block += `${indent}  // TODO: replace with expected error type\n`
      block += `${indent}  expect(() => mod.${funcName}(null)).toThrow();\n`
      block += `${indent}});\n\n`
      block += `${indent}${blkLang}('${funcName}: handles edge cases', () => {\n`
      const ecArgsJS = params.map(p => {
        const t = p.type || inferTypeFromName(p.name, p.defaultValue)
        if (t === "string") return '""'
        if (t === "number" || t === "int" || t === "float") return "0"
        if (t === "boolean") return "false"
        if (t === "array") return "[]"
        if (t === "object") return "{}"
        return "undefined"
      }).join(", ")
      block += `${indent}  const result = mod.${funcName}(${ecArgsJS});\n`
      block += `${indent}  expect(result).toBeDefined();\n`
      block += `${indent}});\n\n`
      break
    }
    default: {
      // Generic quality template with comments
      block += `${indent}${cmt} TODO: Quality assertion for ${funcName} — valid input\n`
      block += `${indent}${cmt} ${funcName}(${args}) should return expected result\n\n`
      block += `${indent}${cmt} TODO: Quality assertion for ${funcName} — invalid input\n`
      block += `${indent}${cmt} ${funcName}(null) should error gracefully\n\n`
      block += `${indent}${cmt} TODO: Quality assertion for ${funcName} — edge case\n`
      block += `${indent}${cmt} ${funcName}() with boundary values should not crash\n\n`
    }
  }
  return block
}

// Check if generated skeleton content has ONLY placeholders (no real logic).
function isSkeletonUseless(content) {
  if (!content) return true
  // Count meaningful lines vs TODO/placeholder lines
  const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('#') && !l.trim().startsWith('/*') && !l.trim().startsWith('*'))
  const todoLines = content.split('\n').filter(l => /TODO|placeholder|smoke|is exported|module loads/.test(l))
  const meaningfulLines = lines.filter(l => !/TODO|placeholder|smoke|is exported|module loads|throw new Error|raise AssertionError|pytest\.skip|assert.*true/.test(l))
  // If fewer than 2 meaningful lines, it's probably just a skeleton
  return meaningfulLines.length < 2
}

function _detectTestFramework() {
  if (_detectedFramework) return _detectedFramework
  let framework = null
  let testExt = null
  try {
    const root = directory || process.cwd()
    const pkgPath = join(root, "package.json")
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
      const testScript = String(pkg?.scripts?.test || "")
      const deps = { ...pkg?.devDependencies, ...pkg?.dependencies }
      if (testScript.includes("vitest") || deps["vitest"]) { framework = "vitest"; testExt = "ts" }
      else if (testScript.includes("jest") || deps["jest"]) { framework = "jest"; testExt = "js" }
      else if (testScript.includes("mocha") || deps["mocha"]) { framework = "mocha"; testExt = "js" }
      else if (/node\s+--test/.test(testScript)) { framework = "node-test"; testExt = "js" }
    }
    if (!framework) {
      const testDirs = ["src/tests", "tests", "test", "__tests__"]
      for (const td of testDirs) {
        const dirPath = join(root, td)
        if (!existsSync(dirPath)) continue
        const files = readdirSync(dirPath).filter(f => /\.test\./.test(f) || /\.spec\./.test(f))
        if (files.length > 0) {
          const content = readFileSync(join(dirPath, files[0]), "utf-8")
          if (/from\s+['"]node:test['"]/.test(content)) { framework = "node-test"; testExt = files[0].split(".").pop(); break }
          if (/from\s+['"]vitest['"]/.test(content)) { framework = "vitest"; testExt = files[0].split(".").pop(); break }
          if (/require\(['"]@jest\/globals['"]\)/.test(content)) { framework = "jest"; testExt = files[0].split(".").pop(); break }
        }
      }
    }
  } catch (e) {
    console.error(`[vibeOS] [tdd] framework detection failed: ${e.message}`)
  }
  _detectedFramework = { framework, testExt }
  console.error(`[vibeOS] [tdd] detected test framework: ${framework || "default"} (ext: ${testExt || "match source"})`)
  return _detectedFramework
}

const TEST_SKELETONS = {
  py: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const moduleImport = name.replace(/-/g, "_")
    let content = `# [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `import pytest\n`
    content += `from ${moduleImport} import ${exports.length > 0 ? exports.map(e => e.name).join(", ") : moduleImport}\n\n`
    if (depth === "minimal") {
      content += `def test_${name}_smoke():\n`
      content += `    """Smoke test — replace with real assertions."""\n`
      content += `    assert ${exports.length > 0 ? exports[0].name : moduleImport} is not None\n\n`
    } else {
      // Smoke test (passing)
      content += `def test_${name}_smoke():\n`
      content += `    """Smoke test: module imports correctly."""\n`
      content += `    assert ${exports.length > 0 ? exports[0].name : moduleImport} is not None\n\n`
      // Generate test stubs for each exported function
      for (const exp of exports) {
        if (exp.type === "class") continue
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        content += `# TODO: implement tests for ${exp.name}\n`
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `def test_${caseFunc}():\n`
          if (strict) content += `    raise AssertionError("TODO: implement ${caseName}")\n\n`
          else content += `    pytest.skip("TODO: implement ${caseName}")\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "py", "")
        }
      }
      if (exports.length === 0) {
        content += `def test_${name}_placeholder():\n`
        if (strict) content += `    raise AssertionError("TODO: implement tests for ${name}")\n\n`
        else content += `    pytest.skip("TODO: implement tests for ${name}")\n\n`
      }
    }
    return content
  },
  js: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const importPath = `../${name}`
    let content = `// [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `const { test, expect, describe } = require('@jest/globals');\n`
    content += `const mod = require('${importPath}');\n\n`
    content += `describe('${name}', () => {\n`
    if (depth === "minimal") {
      content += `  test('smoke: module loads', () => {\n`
      content += `    expect(mod).toBeDefined();\n`
      content += `  });\n`
    } else {
      // Smoke test (passing)
      content += `  test('smoke: module loads', () => {\n`
      content += `    expect(mod).toBeDefined();\n`
      content += `  });\n\n`
      // Generate test stubs for each exported function
      for (const exp of exports) {
        if (exp.type === "class") continue
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        content += `  // TODO: implement tests for ${exp.name}\n`
        content += `  test('${exp.name} is exported', () => {\n`
        content += `    expect(typeof mod.${exp.name}).toBe('function');\n`
        content += `  });\n\n`
        for (const caseName of cases) {
          content += `  test('${caseName}', () => {\n`
          content += `    // TODO: implement ${caseName}\n`
          if (strict) content += `    throw new Error('TODO: implement ${caseName}');\n`
          else content += `    expect(true).toBe(true);\n`
          content += `  });\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "js", "  ")
        }
      }
      if (exports.length === 0) {
        content += `  test('placeholder', () => {\n`
        content += `    // TODO: implement tests for ${name}\n`
        content += `    expect(true).toBe(true);\n`
        content += `  });\n`
      }
    }
    content += `});\n`
    return content
  },
  mjs: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const importPath = `../${name}`
    let content = `// [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `import { test, expect, describe } from 'vitest';\n`
    content += `import * as mod from '${importPath}';\n\n`
    content += `describe('${name}', () => {\n`
    if (depth === "minimal") {
      content += `  test('smoke: module loads', () => {\n`
      content += `    expect(mod).toBeDefined();\n`
      content += `  });\n`
    } else {
      content += `  test('smoke: module loads', () => {\n`
      content += `    expect(mod).toBeDefined();\n`
      content += `  });\n\n`
      for (const exp of exports) {
        if (exp.type === "class") continue
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        content += `  // TODO: implement tests for ${exp.name}\n`
        content += `  test('${exp.name} is exported', () => {\n`
        content += `    expect(typeof mod.${exp.name}).toBe('function');\n`
        content += `  });\n\n`
        for (const caseName of cases) {
          content += `  test('${caseName}', () => {\n`
          content += `    // TODO: implement ${caseName}\n`
          if (strict) content += `    throw new Error('TODO: implement ${caseName}');\n`
          else content += `    expect(true).toBe(true);\n`
          content += `  });\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "mjs", "  ")
        }
      }
      if (exports.length === 0) {
        content += `  test('placeholder', () => {\n`
        content += `    // TODO: implement tests for ${name}\n`
        content += `    expect(true).toBe(true);\n`
        content += `  });\n`
      }
    }
    content += `});\n`
    return content
  },
  ts: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const importPath = `../${name}`
    let content = `// [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `import { test, expect, describe, it } from 'vitest';\n`
    content += `import * as mod from '${importPath}';\n\n`
    content += `describe('${name}', () => {\n`
    if (depth === "minimal") {
      content += `  it('smoke: module loads', () => {\n`
      content += `    expect(mod).toBeDefined();\n`
      content += `  });\n`
    } else {
      content += `  it('smoke: module loads', () => {\n`
      content += `    expect(mod).toBeDefined();\n`
      content += `  });\n\n`
      for (const exp of exports) {
        if (exp.type === "class") continue
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        content += `  // TODO: implement tests for ${exp.name}\n`
        content += `  it('${exp.name} is exported', () => {\n`
        content += `    expect(typeof mod.${exp.name}).toBe('function');\n`
        content += `  });\n\n`
        for (const caseName of cases) {
          content += `  it('${caseName}', () => {\n`
          content += `    // TODO: implement ${caseName}\n`
          if (strict) content += `    throw new Error('TODO: implement ${caseName}');\n`
          else content += `    expect(true).toBe(true);\n`
          content += `  });\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "ts", "  ")
        }
      }
      if (exports.length === 0) {
        content += `  it('placeholder', () => {\n`
        content += `    // TODO: implement tests for ${name}\n`
        content += `    expect(true).toBe(true);\n`
        content += `  });\n`
      }
    }
    content += `});\n`
    return content
  },
  tsx: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => TEST_SKELETONS.ts(name, exports, depth, strict, quality, sourceContent),
  jsx: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => TEST_SKELETONS.mjs(name, exports, depth, strict, quality, sourceContent),
  cjs: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => TEST_SKELETONS.mjs(name, exports, depth, strict, quality, sourceContent),
  mts: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => TEST_SKELETONS.ts(name, exports, depth, strict, quality, sourceContent),
  go: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1)
    let content = `// [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `package main\n\n`
    content += `import "testing"\n\n`
    if (depth === "minimal") {
      content += `func Test${cap}_Smoke(t *testing.T) {\n`
      content += `\tt.Log("TODO: implement smoke test")\n`
      content += `\tt.Fail()\n`
      content += `}\n`
    } else {
      content += `func Test${cap}_Smoke(t *testing.T) {\n`
      content += `\tt.Log("Module loads correctly")\n`
      content += `\tt.Fail()\n`
      content += `}\n\n`
      for (const exp of exports) {
        if (exp.type === "class") continue
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        const expCap = exp.name.charAt(0).toUpperCase() + exp.name.slice(1)
        content += `// TODO: implement tests for ${exp.name}\n`
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `func Test${cap}_${caseFunc}(t *testing.T) {\n`
          if (strict) content += `\tt.Error("TODO: implement ${caseName}")\n`
          else content += `\tt.Skip("TODO: implement ${caseName}")\n`
          content += `}\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += `    // TODO: Real assertion for ${exp.name} — valid input\n`
          content += `    // TODO: Real assertion for ${exp.name} — invalid input\n`
          content += `    // TODO: Real assertion for ${exp.name} — edge case\n\n`
        }
      }
      if (exports.length === 0) {
        content += `func Test${cap}_Placeholder(t *testing.T) {\n`
        if (strict) content += `\tt.Error("TODO: implement tests for ${name}")\n`
        else content += `\tt.Skip("TODO: implement tests for ${name}")\n`
        content += `}\n`
      }
    }
    return content
  },
  sh: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    let content = `# [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `#!/bin/bash\n\n`
    if (depth === "minimal") {
      content += `echo "TODO: implement smoke test for ${name}" && exit 1\n`
    } else {
      content += `# Smoke: module loads\n`
      content += `echo "Smoke test placeholder"\n\n`
      for (const exp of exports) {
        content += `# TODO: implement tests for ${exp.name}\n`
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `function test_${caseFunc} {\n`
          content += `    echo "TODO: implement ${caseName}"\n`
          if (strict) content += `    exit 1\n`
          else content += `    echo "SKIP: ${caseName}"\n`
          content += `}\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "sh", "")
        }
      }
      if (exports.length === 0) {
        content += `function test_smoke {\n`
        if (strict) content += `    echo "TODO: implement tests for ${name}" && exit 1\n`
        else content += `    echo "TODO: implement tests for ${name}"\n`
        content += `}\n`
      }
      content += `# Run all tests\n`
      content += `test_smoke\n`
    }
    return content
  },
  rs: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    let content = `// [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `#[cfg(test)]\nmod tests {\n`
    content += `    use super::*;\n\n`
    if (depth === "minimal") {
      content += `    #[test]\n    fn ${name}_smoke() {\n`
      content += `        // TODO: implement smoke test\n        panic!();\n    }\n`
    } else {
      content += `    #[test]\n    fn ${name}_smoke() {\n`
      content += `        // Smoke: module loads\n`
      content += `        assert!(true);\n    }\n\n`
      for (const exp of exports) {
        if (exp.type === "class") continue
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        content += `    // TODO: implement tests for ${exp.name}\n`
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `    #[test]\n    fn test_${caseFunc}() {\n`
          if (strict) content += `        panic!("TODO: implement ${caseName}");\n`
          else content += `        // TODO: implement ${caseName}\n`
          content += `    }\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "rs", "    ")
        }
      }
      if (exports.length === 0) {
        content += `    #[test]\n    fn ${name}_placeholder() {\n`
        if (strict) content += `        panic!("TODO: implement tests for ${name}");\n`
        else content += `        // TODO: implement tests for ${name}\n`
        content += `    }\n`
      }
    }
    content += `}\n`
    return content
  },
  rb: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    let content = `# [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `require 'minitest/autorun'\n`
    content += `require_relative '../${name}'\n\n`
    content += `class Test${name.charAt(0).toUpperCase() + name.slice(1)} < Minitest::Test\n`
    if (depth === "minimal") {
      content += `  def test_smoke\n`
      content += `    # TODO: implement smoke test\n`
      content += `    flunk "TODO: implement smoke test"\n`
      content += `  end\n`
    } else {
      content += `  def test_smoke\n`
      content += `    # Smoke: module loads\n`
      content += `    assert true\n`
      content += `  end\n\n`
      for (const exp of exports) {
        if (exp.type === "class") continue
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        content += `  # TODO: implement tests for ${exp.name}\n`
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `  def test_${caseFunc}\n`
          if (strict) content += `    flunk "TODO: implement ${caseName}"\n`
          else content += `    # TODO: implement ${caseName}\n`
          content += `  end\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "rb", "  ")
        }
      }
      if (exports.length === 0) {
        content += `  def test_placeholder\n`
        if (strict) content += `    flunk "TODO: implement tests for ${name}"\n`
        else content += `    # TODO: implement tests for ${name}\n`
        content += `  end\n`
      }
    }
    content += `end\n`
    return content
  },
  java: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1)
    let content = `// [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `import org.junit.jupiter.api.Test;\n`
    content += `import static org.junit.jupiter.api.Assertions.*;\n\n`
    content += `class Test${cap} {\n`
    if (depth === "minimal") {
      content += `    @Test\n`
      content += `    void testSmoke() {\n`
      content += `        assertTrue(true);\n`
      content += `    }\n`
    } else {
      content += `    @Test\n`
      content += `    void testSmoke() {\n`
      content += `        assertTrue(true);\n`
      content += `    }\n\n`
      for (const exp of exports) {
        content += `    // TODO: implement tests for ${exp.name}\n`
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        for (const caseName of cases) {
          const testFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          if (!strict) content += `    // @Disabled(\"TODO\")\n`
          content += `    @Test\n`
          content += `    void test${testFunc.charAt(0).toUpperCase() + testFunc.slice(1)}() {\n`
          if (strict) content += `        fail("TODO: implement ${caseName}");\n`
          else content += `        assertTrue(true); // TODO: implement ${caseName}\n`
          content += `    }\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "java", "    ")
        }
      }
      if (exports.length === 0) {
        content += `    @Test\n`
        content += `    void testPlaceholder() {\n`
        content += `        assertTrue(true); // TODO: implement tests for ${name}\n`
        content += `    }\n`
      }
    }
    content += `}\n`
    return content
  },
  kt: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1)
    let content = `// [vibeOS-enforced] Skeleton test — replace with real assertions\n`
    content += `import org.junit.jupiter.api.Test\n`
    content += `import org.junit.jupiter.api.Assertions.*\n\n`
    content += `class Test${cap} {\n`
    if (depth === "minimal") {
      content += `    @Test\n`
      content += `    fun testSmoke() {\n`
      content += `        assertTrue(true)\n`
      content += `    }\n`
    } else {
      content += `    @Test\n`
      content += `    fun testSmoke() {\n`
      content += `        assertTrue(true)\n`
      content += `    }\n\n`
      for (const exp of exports) {
        content += `    // TODO: implement tests for ${exp.name}\n`
        const cases = generateTestCaseNames(exp.name, exp.type, quality)
        for (const caseName of cases) {
          const testFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          if (!strict) content += `    // @Disabled(\"TODO\")\n`
          content += `    @Test\n`
          content += `    fun test${testFunc.charAt(0).toUpperCase() + testFunc.slice(1)}() {\n`
          if (strict) content += `        fail(\"TODO: implement ${caseName}\")\n`
          else content += `        assertTrue(true) // TODO: implement ${caseName}\n`
          content += `    }\n\n`
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name)
          content += buildQualityAssertionsForFunc(exp.name, params, "kt", "    ")
        }
      }
      if (exports.length === 0) {
        content += `    @Test\n`
        content += `    fun testPlaceholder() {\n`
        content += `        assertTrue(true) // TODO: implement tests for ${name}\n`
        content += `    }\n`
      }
    }
    content += `}\n`
    return content
  },
}

// Cross-process lock directory for test file creation coordination.
const ENFORCEMENT_LOCK_DIR = join(USER_HOME, ".claude/.enforcement-lock")
const LOCK_EXPIRE_MS = 30_000

// Cross-process cooldown to avoid duplicate enforcement across processes.
const ENFORCEMENT_COOLDOWN_FILE = join(USER_HOME, ".claude/.enforcement-cooldown.jsonl")
const COOLDOWN_MS = 60_000

// Per-process recursion guard.
const _enforcementCooldown = new Set()

function _acquireLock(testPath) {
  try {
    mkdirSync(ENFORCEMENT_LOCK_DIR, { recursive: true })
    const hash = createHash("sha256").update(testPath).digest("hex").slice(0, 16)
    const lockPath = join(ENFORCEMENT_LOCK_DIR, `${hash}.lock`)
    try {
      openSync(lockPath, "wx")
      return true
    } catch (err) {
      if (err.code !== "EEXIST") return false
      try {
        const st = statSync(lockPath)
        if (Date.now() - st.mtimeMs >= LOCK_EXPIRE_MS) {
          rmSync(lockPath, { force: true })
          try { openSync(lockPath, "wx"); return true } catch {}
        }
      } catch {}
      return false
    }
  } catch { return false }
}

function _releaseLock(testPath) {
  try {
    const hash = createHash("sha256").update(testPath).digest("hex").slice(0, 16)
    const lockPath = join(ENFORCEMENT_LOCK_DIR, `${hash}.lock`)
    rmSync(lockPath)
  } catch {}
}

function _isInCooldown(testPath) {
  try {
    if (!existsSync(ENFORCEMENT_COOLDOWN_FILE)) return false
    const hash = createHash("sha256").update(testPath).digest("hex").slice(0, 16)
    const lines = readFileSync(ENFORCEMENT_COOLDOWN_FILE, "utf-8").trim().split("\n").filter(Boolean)
    const now = Date.now()
    for (const line of lines) {
      try {
        const { h, ts } = JSON.parse(line)
        if (h === hash && (now - ts) < COOLDOWN_MS) return true
      } catch {}
    }
    return false
  } catch { return false }
}

function _recordCooldown(testPath) {
  try {
    mkdirSync(dirname(ENFORCEMENT_COOLDOWN_FILE), { recursive: true })
    const hash = createHash("sha256").update(testPath).digest("hex").slice(0, 16)
    const entry = JSON.stringify({ h: hash, ts: Date.now() }) + "\n"
    appendFileSync(ENFORCEMENT_COOLDOWN_FILE, entry)
    // Prune old entries to keep file bounded
    const lines = readFileSync(ENFORCEMENT_COOLDOWN_FILE, "utf-8").trim().split("\n").filter(Boolean)
    if (lines.length > 500) {
      writeFileSync(ENFORCEMENT_COOLDOWN_FILE, lines.slice(-200).join("\n") + "\n")
    }
  } catch {}
}

export function buildTestSkeleton(filePath, sourceContent = "", options = {}) {
  const fw = _detectTestFramework()
  if (!filePath || typeof filePath !== "string") return null
  if (!SOURCE_EXT_RE.test(filePath)) return null
  if (SKIP_PATH_RE.test(filePath)) return null
  const m = filePath.match(/([^/]+)\.([^.]+)$/)
  if (!m) return null
  const [, name, ext] = m
  const extLower = ext.toLowerCase()
  const skeletonFn = TEST_SKELETONS[extLower]
  if (!skeletonFn) return null
  const strict = options.strict !== undefined ? options.strict : true
  const quality = options.quality !== undefined ? options.quality : true
  const m2 = filePath.match(/^(.*\/)?([^/]+)\.([^.]+)$/)
  const dir = m2 ? (m2[1] || "") : ""
  let testPath
  switch (extLower) {
    case "py": testPath = dir + "tests/test_" + name + ".py"; break
    case "sh": testPath = dir + "tests/test_" + name + ".sh"; break
    case "js": case "mjs": case "ts": case "jsx": case "tsx": case "cjs": case "mts":
      testPath = dir + "tests/" + name + ".test." + ext; break
    case "go": testPath = dir + name + "_test.go"; break
    case "rs": testPath = dir + "tests/" + name + "_test.rs"; break
    case "rb": testPath = dir + "test/" + name + "_test.rb"; break
    case "java": case "kt": testPath = dir + "src/test/" + name.charAt(0).toUpperCase() + name.slice(1) + "Test." + ext; break
    default: return null
  }
  if (fw?.testExt) {
    testPath = testPath.replace(new RegExp("\\.[^.]+$"), "." + fw.testExt)
  }
  const exports = extractExports(sourceContent, extLower)
  return { path: testPath, content: skeletonFn(name, exports, "full", strict, quality, sourceContent), dir: dirname(testPath) }
}

export function enforceTestFile(filePath) {
  console.error(`[vibeOS] [tdd-enforce] enforceTestFile called for ${filePath}`)
  let sourceContent = ""
  try {
    if (existsSync(filePath)) {
      sourceContent = readFileSync(filePath, "utf-8")
    }
  } catch {}
  const sel = loadSelection()
  const skeleton = buildTestSkeleton(filePath, sourceContent, { strict: sel.tdd_strict !== false, quality: sel.tdd_quality !== false })
  if (!skeleton) return null
  if (existsSync(skeleton.path)) return null
  if (_enforcementCooldown.has(skeleton.path)) return null
  if (_isInCooldown(skeleton.path)) return null
  if (!_acquireLock(skeleton.path)) return null
  try {
    mkdirSync(skeleton.dir, { recursive: true })
    writeFileSync(skeleton.path, skeleton.content)
    _enforcementCooldown.add(skeleton.path)
    _recordCooldown(skeleton.path)
    // Record extended telemetry in state file
    try {
      updateState((state) => {
        state.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" }
        state.lifetime.tdd_enforced = (state.lifetime.tdd_enforced || 0) + 1
        state.lifetime.tdd_skeletons_created = (state.lifetime.tdd_skeletons_created || 0) + 1
        if (sel.tdd_strict !== false) {
          state.lifetime.tdd_strict_fail_templates_created = (state.lifetime.tdd_strict_fail_templates_created || 0) + 1
        }
        if (sel.tdd_quality !== false) {
          state.lifetime.tdd_quality_templates_created = (state.lifetime.tdd_quality_templates_created || 0) + 1
        }
        state.lifetime.last_updated = new Date().toISOString()
        return state
      })
    } catch {}
    let resultPath = skeleton.path
    // Anti-useless-run guard: warn if content is only placeholders
    const useless = isSkeletonUseless(skeleton.content)
    if (useless) {
      console.error(`[vibeOS] ⚠ TDD skeleton at ${skeleton.path} has no real assertions. Run \`trinity tdd strict off\` or add manual tests.`)
    }
    console.error(`[vibeOS] [tdd-enforce] Created skeleton: ${skeleton.path}`)
    return resultPath
  } catch (err) {
    console.error(`[vibeOS] [tdd-enforce] Failed to create ${skeleton.path}: ${err.message}`)
    return null
  } finally {
    _releaseLock(skeleton.path)
  }
}

export function buildTestReminder(filePath) {
  if (!filePath || typeof filePath !== "string") return null
  if (!SOURCE_EXT_RE.test(filePath)) return null
  if (SKIP_PATH_RE.test(filePath)) return null
  if (testReminderSeen.has(filePath)) return null
  testReminderSeen.add(filePath)
  const m = filePath.match(/([^/]+)\.([^.]+)$/)
  if (!m) return null
  const [, name, ext] = m
  let suggest
  switch (ext.toLowerCase()) {
    case "py": suggest = `tests/test_${name}.py`; break
    case "sh": suggest = `tests/test_${name}.sh`; break
    case "js": case "mjs": case "ts": case "jsx": case "tsx":
      suggest = `tests/${name}.test.${ext}`; break
    case "go": suggest = `${name}_test.go`; break
    default: suggest = "co-located test file"
  }
  return `🧪 Changed ${filePath} — add test at ${suggest} before completing.`
}

function recordSaving(tool, reason, saveEst, meta = {}) {
  try {
    const state = updateState((s) => {
      const now = new Date().toISOString()
      s.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" }
      s.lifetime.warn_count = (s.lifetime.warn_count || 0) + 1
      s.lifetime.est_savings_usd = roundUsd((s.lifetime.est_savings_usd || 0) + Number(saveEst || 0))
      s.lifetime.last_updated = now
      s.sessions ??= {}
      const sid = _OC_SID
      s.sessions[sid] ??= { started: now, source: "opencode", tool_counts: {}, warns: [] }
      if (currentProjectFingerprint) s.sessions[sid].project_fingerprint = currentProjectFingerprint
      if (currentProjectName) s.sessions[sid].project_name = currentProjectName
      s.sessions[sid].session_cache_dir = getSessionScratchpadDir()
      s.sessions[sid].tool_counts[tool] = (s.sessions[sid].tool_counts[tool] || 0) + 1
      const warns = Array.isArray(s.sessions[sid].warns) ? s.sessions[sid].warns : []
      const last = warns.length > 0 ? warns[warns.length - 1] : null
      const lastAt = last?.at ? Date.parse(last.at) : 0
      const nowTs = Date.parse(now)
      const canMerge = Boolean(
        last &&
        last.tool === tool &&
        last.reason === reason &&
        Number.isFinite(lastAt) &&
        Number.isFinite(nowTs) &&
        (nowTs - lastAt) <= WARN_DEDUPE_WINDOW_MS
      )
      if (canMerge) {
        last.at = now
        last.count = Number(last.count || 1) + 1
        last.est_savings_usd = roundUsd(Number(last.est_savings_usd || 0) + Number(saveEst || 0))
      } else {
        warns.push({ at: now, tool, reason, est_savings_usd: roundUsd(saveEst), count: 1 })
      }
      s.sessions[sid].warns = warns
      if (s.sessions[sid].warns.length > 200) {
        console.error(`[vibeOS] session warns truncated from ${s.sessions[sid].warns.length} to 200 for ${sid}`)
        s.sessions[sid].warns = s.sessions[sid].warns.slice(-200)
      }
      const firstWord = meta?.firstWord
      if (firstWord && (tool === "bash" || tool === "webfetch" || tool === "websearch" || tool === "write" || tool === "edit" || tool === "notebookedit")) {
        try { noteTaskRoutingLearning(firstWord, TRINITY_CHEAP || TRINITY_MEDIUM || "unknown", `observed:${tool}`) } catch {}
      }
      _pruneOldSessions(s)
      return s
    })
    const sid = _OC_SID
    try {
      _ledgerBuffer.push(JSON.stringify({ v: 2, at: new Date().toISOString(), kind: "delegation", amount_usd: Number(saveEst || 0), sid, tool }) + "\n")
      if (_ledgerBuffer.length >= LEDGER_BUFFER_MAX) _flushLedgerBuffer()
      else if (!_ledgerBufferTimer) _ledgerBufferTimer = setTimeout(_flushLedgerBuffer, LEDGER_BUFFER_FLUSH_MS)
    } catch {}
    saveSessionCheckpoint()
    return state?.lifetime?.est_savings_usd ?? null
  } catch (err) {
    console.error(`[vibeOS] state write failed: ${err.message}`)
    return null
  }
}

function recordCacheSaving(tool, saveEst, meta = {}) {
  try {
    const state = updateState((s) => {
      const now = new Date().toISOString()
      const delta = Number(saveEst || 0)
      s.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" }
      s.lifetime.cache_savings_usd = roundUsd(Number(s.lifetime.cache_savings_usd || 0) + delta)
      s.lifetime.last_updated = now
      s.sessions ??= {}
      const sid = _OC_SID
      s.sessions[sid] ??= { started: now, source: "opencode", tool_counts: {}, warns: [] }
      if (currentProjectFingerprint) s.sessions[sid].project_fingerprint = currentProjectFingerprint
      if (currentProjectName) s.sessions[sid].project_name = currentProjectName
      s.sessions[sid].session_cache_dir = getSessionScratchpadDir()
      s.sessions[sid].tool_counts[tool] = (s.sessions[sid].tool_counts[tool] || 0) + 1
      s.sessions[sid].cache_savings_usd = roundUsd(Number(s.sessions[sid].cache_savings_usd || 0) + delta)
      if (meta?.hash) {
        s.sessions[sid].cache_hits ??= []
        s.sessions[sid].cache_hits.push({
        at: now,
        tool,
        hash: meta.hash,
        est_savings_usd: roundUsd(delta),
      })
      if (s.sessions[sid].cache_hits.length > 200) {
        console.error(`[vibeOS] session cache_hits truncated from ${s.sessions[sid].cache_hits.length} to 200 for ${sid}`)
        s.sessions[sid].cache_hits = s.sessions[sid].cache_hits.slice(-200)
      }
      }
      _pruneOldSessions(s)
      return s
    })
    const sid = _OC_SID
    try {
      _ledgerBuffer.push(JSON.stringify({ v: 2, at: new Date().toISOString(), kind: "cache", amount_usd: Number(saveEst || 0), sid, tool }) + "\n")
      if (_ledgerBuffer.length >= LEDGER_BUFFER_MAX) _flushLedgerBuffer()
      else if (!_ledgerBufferTimer) _ledgerBufferTimer = setTimeout(_flushLedgerBuffer, LEDGER_BUFFER_FLUSH_MS)
    } catch {}
    saveSessionCheckpoint()
    return {
      lifetime: state?.lifetime?.cache_savings_usd || 0,
      session: state?.sessions?.[sid]?.cache_savings_usd || 0,
    }
  } catch (err) {
    console.error(`[vibeOS] cache state write failed: ${err.message}`)
    return null
  }
}

// Prune session entries: keep latest 30 (by started or last_costed).
function _pruneOldSessions(state) {
  if (!state?.sessions) return
  const entries = Object.entries(state.sessions)
  if (entries.length <= 30) return
  entries.sort((a, b) => {
    const da = a[1]?.started || a[1]?.last_costed || ""
    const db = b[1]?.started || b[1]?.last_costed || ""
    return db.localeCompare(da)
  })
  state.sessions = Object.fromEntries(entries.slice(0, 30))
}

// Rotate session-reports.log: keep tail when exceeding max lines.
// Avoids reading the file on every call via mtime guard.
let _lastLogRotated = 0
function _rotateLog(filePath, maxLines) {
  try {
    if (!existsSync(filePath)) return
    const mtime = statSync(filePath).mtimeMs
    if (mtime === _lastLogRotated) return
    const data = readFileSync(filePath, "utf-8")
    const lines = data.split("\n")
    if (lines.length <= maxLines) return
    const kept = lines.slice(-Math.floor(maxLines / 2)).join("\n") + "\n"
    writeFileSync(filePath, kept)
    _lastLogRotated = statSync(filePath).mtimeMs
  } catch {}
}

// Read last N lines of a file efficiently. Used for cross-process dedup.
function getLastLines(filePath, n = 5, maxBytes = 1024) {
  try {
    if (!existsSync(filePath)) return []
    const st = statSync(filePath)
    if (st.size === 0) return []
    const bufSize = Math.min(maxBytes, st.size)
    const pos = Math.max(0, st.size - bufSize)
    const buf = Buffer.alloc(bufSize)
    const fd = openSync(filePath, "r")
    let bytesRead = 0
    try {
      const result = readSync(fd, buf, 0, bufSize, pos)
      bytesRead = result.bytesRead
    } finally {
      closeSync(fd)
    }
    const chunk = buf.toString("utf-8", 0, bytesRead)
    const lines = chunk.split("\n").filter(Boolean)
    return lines.slice(-n).map(l => l.trim())
  } catch { return [] }
}
// Legacy alias for callers expecting singular return.
function getLastLine(filePath) {
  const lines = getLastLines(filePath, 1, 200)
  return lines[0] || ""
}

// Cache the lifetime totals — invalidated on every recordSaving() write
// (same process) and via mtime check (cross-process: bash hook may have
// written since we last read).
let _savingsCache = null
let _savingsCacheMtime = 0
let _ledgerReconciledMtime = 0

function readLedgerTotals() {
  const empty = { delegation: 0, cache: 0, total: 0, entries: 0 }
  try {
    if (!existsSync(SAVINGS_LEDGER_FILE)) return empty
    const raw = readFileSync(SAVINGS_LEDGER_FILE, "utf-8")
    if (!raw.trim()) return empty
    let delegation = 0
    let cache = 0
    let entries = 0
    for (const line of raw.split("\n")) {
      const ln = line.trim()
      if (!ln) continue
      let rec = null
      try { rec = JSON.parse(ln) } catch { continue }
      if (!rec || typeof rec !== "object") continue
      if (rec.v !== undefined && rec.v !== 2) continue
      const amt = Number(rec.amount_usd ?? rec.est_savings_usd ?? rec.savings_usd ?? 0)
      if (!Number.isFinite(amt) || amt <= 0) continue
      entries += 1
      const kind = String(rec.kind || rec.type || rec.category || rec.source || "").toLowerCase()
      if (kind.includes("cache")) cache += amt
      else delegation += amt
    }
    const total = delegation + cache
    return {
      delegation: Math.round(delegation * 1000) / 1000,
      cache: Math.round(cache * 1000) / 1000,
      total: Math.round(total * 1000) / 1000,
      entries,
    }
  } catch {
    return empty
  }
}

function reconcileStateFromLedger() {
  try {
    const ledgerMtime = existsSync(SAVINGS_LEDGER_FILE) ? statSync(SAVINGS_LEDGER_FILE).mtimeMs : 0
    if (ledgerMtime === _ledgerReconciledMtime) return
    _ledgerReconciledMtime = ledgerMtime
    const l = readLedgerTotals()
    if (l.total <= 0) return
    const state = readJsonOrEmpty(STATE_FILE)
    const stDelegation = Number(state?.lifetime?.est_savings_usd ?? 0)
    const stCache = Number(state?.lifetime?.cache_savings_usd ?? 0)
    const stTotal = (Number.isFinite(stDelegation) ? stDelegation : 0) + (Number.isFinite(stCache) ? stCache : 0)
    if (Math.abs(stTotal - l.total) < 0.0005) return
    updateState((s) => {
      s.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" }
      s.lifetime.est_savings_usd = l.delegation
      s.lifetime.cache_savings_usd = l.cache
      s.lifetime.last_updated = new Date().toISOString()
      s.lifetime.rebuilt_from_ledger = true
      s.lifetime.ledger_entries_reconciled = l.entries
      return s
    })
    _savingsCache = null
    _savingsCacheMtime = 0
    console.error(`[vibeOS] savings reconciled from ledger: state $${stTotal.toFixed(3)} -> ledger $${l.total.toFixed(3)} (${l.entries} entries)`)
  } catch (err) {
    console.error(`[vibeOS] ledger reconcile failed: ${err.message}`)
  }
}

function readLifetimeSavings() {
  const empty = { ltTasks: 0, ltCache: 0, ltCost: 0, count: 0, scratchpadHits: 0, missedC7: 0, sesTasks: 0, sesEdit: 0, sesCredit: 0, sesC7: 0, sesQuota: 0, sesTaskDelegations: 0, sesDuration: 0, sesRatePerHour: 0, sesTrend: "stable", sesToolBreakdown: {}, sesModelTurns: { brain: 0, worker: 0 }, quality_avg: 0 }
  try {
    reconcileStateFromLedger()
    if (!existsSync(STATE_FILE)) return empty
    const mtime = statSync(STATE_FILE).mtimeMs
    if (_savingsCache && mtime === _savingsCacheMtime) return _savingsCache
    const s = safeJsonParse(readFileSync(STATE_FILE, "utf-8"))
    _savingsCache = computeSessionMetrics(s, _OC_SID)
    _savingsCacheMtime = mtime
    return _savingsCache
  } catch { return empty }
}

function readPackageVersion() {
  try {
    const pkg = safeJsonParse(readFileSync(join(process.cwd(), "package.json"), "utf-8"))
    return String(pkg?.version || "")
  } catch { return "" }
}

function readFullState() {
  try {
    if (!existsSync(STATE_FILE)) return {}
    const st = statSync(STATE_FILE)
    if (st.size > 10485760) { _handleStateCorruption(STATE_FILE); return {} }
    return safeJsonParse(readFileSync(STATE_FILE, "utf-8"))
  } catch { _handleStateCorruption(STATE_FILE); return {} }
}

function saveSessionCheckpoint() {
  try {
    const state = readFullState()
    const session = state.sessions?.[_OC_SID]
    if (!session) return
    const cp = {
      session_id: _OC_SID,
      ts: new Date().toISOString(),
      cost: session.cost_usd || 0,
      cache_savings: session.cache_savings_usd || 0,
      delegation_savings: session.delegation_savings_usd || 0,
      tool_counts: session.tool_counts || {},
      warns: session.warns?.length || 0,
      model: session.model || "",
    }
    const cpPath = join(getSessionRoot(), "checkpoint.json")
    mkdirSync(dirname(cpPath), { recursive: true })
    const tmp = cpPath + ".tmp"
    writeFileSync(tmp, JSON.stringify(cp, null, 2) + "\n")
    renameSync(tmp, cpPath)
  } catch {}
}

function computeStatusPayload() {
  const sel = loadSelection()
  const tiers = readJsonOrEmpty(TIERS_FILE)
  const credit = loadCredit()
  const activeSlot = sel.active_slot || "brain"
  const current = tiers?.trinity?.[activeSlot]?.oc || currentModel || ""
  const thinking = sel.thinking_level || thinkingLevel(credit)
  const hooks = {
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
  }

  return hooks
}

function computeSavingsPayload() {
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

function computeSessionCheckout() {
  const state = readFullState()
  const metrics = computeSessionMetrics(state, _OC_SID)
  const session = state?.sessions?.[_OC_SID] || {}
  const warns = Array.isArray(session?.warns) ? session.warns : []
  const rankedOps = warns
    .map((w) => ({
      tool: String(w?.tool || "unknown"),
      reason: String(w?.reason || ""),
      savings_usd: Number(w?.est_savings_usd || 0),
      at: w?.at || null,
    }))
    .sort((a, b) => b.savings_usd - a.savings_usd)
    .slice(0, 3)
  const flowWarns = getFlowWarns().filter((w) => String(w?.sid || "") === String(process.pid || ""))
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
    findings: rankedOps.map((op) => ({
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

function diagnoseStructuredFromText(raw) {
  const text = String(raw || "")
  const lines = text.split("\n")
  const files = []
  const model_probes = []
  const suggestions = []
  let credit = { percent: loadCredit(), ok: true, fix: null }
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.includes("→")) {
      suggestions.push(trimmed.replace(/^→\s*/, ""))
    }
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

function projectStructuredFromText(raw) {
  const text = String(raw || "")
  const lines = text.split("\n")
  let brain_pct = 0
  let worker_pct = 0
  const m1 = text.match(/Brain[^0-9]*(\d+)%/i)
  const m2 = text.match(/Worker[^0-9]*(\d+)%/i)
  if (m1) brain_pct = Number(m1[1])
  if (m2) worker_pct = Number(m2[1])
  const suggestions = lines.filter((l) => l.includes("💡")).map((l) => l.replace(/^.*💡\s*/, "").trim())
  return {
    brain_pct,
    worker_pct,
    enforcement_status: loadSelection().delegation_enforce ? "enforce" : "warn",
    flow_status: loadSelection().flow_enabled !== false ? "on" : "off",
    credit_percent: loadCredit(),
    suggestions,
  }
}

function loadMcpPort() {
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
      if (cfg === false || cfg === "disabled") return 0
      if (cfg === 0) return 0
      const n = Number(cfg)
      if (Number.isFinite(n)) return n
    }
  } catch {}
  return 9578
}

function persistMcpPort(port) {
  try {
    if (!existsSync(TIERS_FILE)) return
    const tiers = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
    tiers.selection ??= {}
    tiers.mcp_port = port
    if (Number(tiers.selection.mcp_port) === Number(port)) return
    tiers.selection.mcp_port = port
    mkdirSync(dirname(TIERS_FILE), { recursive: true })
    const _tmp = TIERS_FILE + ".tmp." + Date.now()
    writeFileSync(_tmp, JSON.stringify(tiers, null, 2) + "\n", "utf-8")
    renameSync(_tmp, TIERS_FILE)
    console.error(`[vibeOS] mcp_port set to ${port} in model-tiers.json`)
  } catch {}
}

function readConfig(dir) {
  try {
    const c = readOpenCodeConfigObject(dir)
    return c?.agent?.build?.model || c?.model || ""
  } catch { return "" }
}

function parseJsonc(raw) {
  const noBlockComments = String(raw || "").replace(/\/\*[\s\S]*?\*\//g, "")
  const noLineComments = noBlockComments.replace(/(^|\s)\/\/.*$/gm, "$1")
  const noTrailingCommas = noLineComments.replace(/,\s*([}\]])/g, "$1")
  return safeJsonParse(noTrailingCommas)
}

function readOpenCodeConfigObject(dir) {
  const jsonPath = join(dir, "opencode.json")
  const jsoncPath = join(dir, "opencode.jsonc")
  if (existsSync(jsonPath)) {
    return safeJsonParse(readFileSync(jsonPath, "utf-8"))
  }
  if (existsSync(jsoncPath)) {
    return parseJsonc(readFileSync(jsoncPath, "utf-8"))
  }
  return {}
}

// ── Scratchpad decadence (progressive aging) ────────────────────────
// Age-based cache decay:
//   0-5 min:   FRESH   — keep full content, indexed
//   5 min-1h:  WARM    — rotate to summary-only
//   1h-24h:    COLD    — ensure summary only, compress summary
//   >24h:      EXPIRE  — delete everything
const DECADENCE_FRESH_MS    = 5 * 60 * 1000
const DECADENCE_WARM_MS     = 60 * 60 * 1000
const DECADENCE_COLD_MS     = 24 * 60 * 60 * 1000
const DECADENCE_EXPIRE_MS   = 48 * 60 * 60 * 1000  // grace window beyond cold
const DECADENCE_THROTTLE_MS = 60 * 1000              // session run max once per minute
const DECADENCE_GLOBAL_THROTTLE_MS = 5 * 60 * 1000   // global run max once per 5 minutes
const MAX_SCRATCHPAD_FILES  = 1000
const MAX_SCRATCHPAD_BYTES  = 10 * 1024 * 1024       // 10MB
const MAX_SESSION_SCRATCHPAD_FILES = 200
const MAX_SESSION_SCRATCHPAD_BYTES = 2 * 1024 * 1024 // 2MB
let _lastDecadenceRun = 0
let _lastGlobalDecadenceRun = 0

// Read only the first 120 bytes of a file (header check — avoids reading huge files).
function _readHead(fullPath) {
  try {
    const buf = Buffer.alloc(120)
    const fd = openSync(fullPath, "r")
    const { bytesRead } = readSync(fd, buf, 0, 120, 0)
    closeSync(fd)
    return buf.toString("utf-8", 0, bytesRead)
  } catch { return "" }
}

function indexAppend(hash: string, tool: string, size: number, extra?: string) {
  try {
    const entryObj = {
      ts: new Date().toISOString(),
      hash, tool, size,
      pid: process.pid || 0,
      session: _OC_SID,
      source: "opencode",
      ...extra,
    }
    const entry = JSON.stringify(entryObj) + "\n"
    const globalIndex = getGlobalIndexPath()
    const sessionIndex = getSessionIndexPath()
    mkdirSync(dirname(globalIndex), { recursive: true })
    mkdirSync(dirname(sessionIndex), { recursive: true })
    appendFileSync(globalIndex, entry)
    appendFileSync(sessionIndex, entry)
  } catch (err) {
    console.error(`[vibeOS] index write failed: ${err.message}`)
  }
}

function _pruneScratchpadDir(targetDir, opts = {}) {
  const { maxFiles = MAX_SCRATCHPAD_FILES, maxBytes = MAX_SCRATCHPAD_BYTES, rotate = true } = opts
  const now = Date.now()
  if (!existsSync(targetDir)) return { dataFiles: 0, totalBytes: 0, deleted: 0, rotated: 0 }
  const entries = readdirSync(targetDir)
  let dataFiles = 0; let totalBytes = 0; let deleted = 0; let rotated = 0
  for (const entry of entries) {
    if (entry.endsWith(".meta.json") || entry.endsWith(".summary.txt")) continue
    const fullPath = join(targetDir, entry)
    let st
    try { st = statSync(fullPath) } catch { continue }
    const age = now - st.mtimeMs
    const hash = entry.replace(/\.txt$/, "")
    if (age > DECADENCE_EXPIRE_MS) {
      try { rmSync(fullPath) } catch {}
      const meta = join(targetDir, hash + ".meta.json")
      if (existsSync(meta)) try { rmSync(meta) } catch {}
      const summary = join(targetDir, hash + ".summary.txt")
      if (existsSync(summary)) try { rmSync(summary) } catch {}
      deleted++; continue
    }
    dataFiles++; totalBytes += st.size
    if (!rotate) continue
    if (age > DECADENCE_COLD_MS) {
      const summaryPath = join(targetDir, hash + ".summary.txt")
      if (!existsSync(summaryPath)) try {
        const content = readFileSync(fullPath, "utf-8")
        writeFileSync(summaryPath, content.slice(0, 200).replace(/\n+/g, " ").trim() + (content.length > 200 ? "…" : ""))
      } catch {}
      const head = _readHead(fullPath)
      if (!head.includes("[cold-storage]")) try {
        writeFileSync(fullPath, `[cold-storage] ${st.size}B original → ${hash}.summary.txt`)
        rotated++
      } catch {}
      continue
    }
    if (age > DECADENCE_FRESH_MS && st.size > 1024) {
      const summaryPath = join(targetDir, hash + ".summary.txt")
      if (!existsSync(summaryPath)) try {
        const content = readFileSync(fullPath, "utf-8")
        writeFileSync(summaryPath, content.slice(0, 500).replace(/\n+/g, " ").trim() + (content.length > 500 ? "…" : ""))
      } catch {}
      const head = _readHead(fullPath)
      if (!head.includes("[warm-storage]") && !head.includes("[cold-storage]")) try {
        writeFileSync(fullPath, `[warm-storage] ${st.size}B original at ${hash}.summary.txt`)
        rotated++
      } catch {}
    }
  }
  if (dataFiles > maxFiles || totalBytes > maxBytes) {
    const candidates = entries
      .filter(e => !e.endsWith(".meta.json") && !e.endsWith(".summary.txt"))
      .map(e => {
        try { return { name: e, mtime: statSync(join(targetDir, e)).mtimeMs } }
        catch { return null }
      })
      .filter(Boolean)
      .sort((a, b) => a.mtime - b.mtime)
    const toRemove = Math.ceil(candidates.length * 0.3)
    for (let i = 0; i < toRemove; i++) {
      const base = join(targetDir, candidates[i].name)
      try { rmSync(base) } catch {}
      const meta = base.replace(".txt", ".meta.json")
      if (existsSync(meta)) try { rmSync(meta) } catch {}
      const summary = base.replace(".txt", ".summary.txt")
      if (existsSync(summary)) try { rmSync(summary) } catch {}
      deleted++
    }
  }
  return { dataFiles, totalBytes, deleted, rotated }
}

function cleanupStaleSessionScratchpads() {
  try {
    if (!existsSync(SCRATCHPAD_SESSIONS_DIR)) return
    const now = Date.now()
    for (const sid of readdirSync(SCRATCHPAD_SESSIONS_DIR)) {
      const sesRoot = join(SCRATCHPAD_SESSIONS_DIR, sid)
      let st
      try { st = statSync(sesRoot) } catch { continue }
      if (!st.isDirectory()) continue
      const age = now - st.mtimeMs
      if (age > SCRATCHPAD_SESSION_TTL_MS) {
        try { rmSync(sesRoot, { recursive: true, force: true }) } catch {}
      }
    }
  } catch {}
}

function applyDecadence() {
  const now = Date.now()
  if (now - _lastDecadenceRun >= DECADENCE_THROTTLE_MS) {
    _lastDecadenceRun = now
    try {
      const ses = _pruneScratchpadDir(getSessionScratchpadDir(), {
        maxFiles: MAX_SESSION_SCRATCHPAD_FILES,
        maxBytes: MAX_SESSION_SCRATCHPAD_BYTES,
        rotate: false,
      })
      if (ses.deleted > 0) {
        console.error(`[vibeOS] 📦 session-decadence: deleted=${ses.deleted} (${ses.dataFiles} files, ${Math.round(ses.totalBytes/1024)}KB)`)
      }
    } catch (err) {
      console.error(`[vibeOS] session decadence error: ${err.message}`)
    }
  }
  if (now - _lastGlobalDecadenceRun >= DECADENCE_GLOBAL_THROTTLE_MS) {
    _lastGlobalDecadenceRun = now
    try {
      const global = _pruneScratchpadDir(SCRATCHPAD_GLOBAL_DIR, {
        maxFiles: MAX_SCRATCHPAD_FILES,
        maxBytes: MAX_SCRATCHPAD_BYTES,
        rotate: true,
      })
      cleanupStaleSessionScratchpads()
      if (global.deleted > 0 || global.rotated > 0) {
        const action = []
        if (global.rotated > 0) action.push(`rotated=${global.rotated}`)
        if (global.deleted > 0) action.push(`deleted=${global.deleted}`)
        console.error(`[vibeOS] 📦 global-decadence: ${action.join(" ")} (${global.dataFiles} files, ${Math.round(global.totalBytes/1024)}KB)`)
      }
    } catch (err) {
      console.error(`[vibeOS] global decadence error: ${err.message}`)
    }
  }
}

// ── Output compression ──────────────────────────────────────────────

const VERBOSE_LINE_RE = [
  /^\s*(Sure|Certainly|Absolutely|Of course|Great question)[!.,]?\s*$/i,
  /^\s*(Hope this helps|Let me know if|Feel free to|Happy to|Please let me know).*$/i,
]

// Key-line patterns used during bullet-point extraction.
const BULLET_PATTERNS = [
  /^\s*\w[^:]{0,80}:/,              // definition lines  (key: value)
  /^\s*[-*•]\s/,                     // already bulleted
  /^\s*\d+\.\s/,                     // numbered lists
  /^\s*(NOTE|TIP|IMPORTANT|WARNING|FIX|TODO|HACK)\b/i,
  /^\s*[A-Z][A-Z\s_-]{4,}:\s/,      // section headers   (UPPERCASE: text)
]

// Compression parameters.
const COMPRESS_RATIO      = 0.30   // target 30 % of original when compressing
const COMPRESS_THRESHOLD  = 2000   // only compress if result exceeds this
const MIN_KEPT_LINES_RATIO = 0.40  // keep at least 40 % of lines even if under target

function extractBulletLines(lines, targetChars, minLines) {
  const keyLines   = []
  const otherLines = []

  for (const line of lines) {
    if (BULLET_PATTERNS.some(re => re.test(line))) keyLines.push(line)
    else otherLines.push(line)
  }

  // Take key (bullet) lines first, then fill from remainder.
  const selected = [...keyLines]
  for (const line of otherLines) {
    if (selected.length >= minLines && selected.join("\n").length >= targetChars) break
    selected.push(line)
  }

  // If still well over target, trim from the end.
  while (selected.length > minLines && selected.join("\n").length > targetChars * 2) {
    selected.pop()
  }

  return selected
}

function compressText(text) {
  if (!text || typeof text !== "string") return text

  let lines = text.split("\n")
  let removed = 0
  const out = []

  for (const line of lines) {
    let skip = false
    for (const re of VERBOSE_LINE_RE) {
      if (re.test(line)) { skip = true; removed++; break }
    }
    if (!skip) out.push(line)
  }

  // Collapse 3+ consecutive blank lines to 2
  const collapsed = []
  let blanks = 0
  for (const line of out) {
    if (line.trim() === "") {
      blanks++
      if (blanks <= 2) collapsed.push(line)
    } else {
      blanks = 0
      collapsed.push(line)
    }
  }

  let result = collapsed.join("\n").trim()

  // Percentage-based compression: only act if above threshold.
  if (result.length > COMPRESS_THRESHOLD) {
    const targetChars = Math.max(
      Math.round(result.length * COMPRESS_RATIO),
      COMPRESS_THRESHOLD
    )
    const minLines = Math.max(1, Math.round(collapsed.length * MIN_KEPT_LINES_RATIO))
    const bulletLines = extractBulletLines(collapsed, targetChars, minLines)

    result = bulletLines.join("\n").trim()

    // Final safety truncate if bullet extraction didn't shrink enough.
    if (result.length > targetChars * 1.5) {
      const cutoff = result.lastIndexOf("\n\n", targetChars)
      if (cutoff > targetChars * 0.5) {
        result = result.slice(0, cutoff) + `\n\n… [${result.length - cutoff} chars truncated]`
      } else {
        result = result.slice(0, targetChars) + `… [${result.length - targetChars} chars truncated]`
      }
    }
  }

  if (removed > 0 || result !== collapsed.join("\n").trim()) {
    console.error(`[vibeOS] COMPRESS: ${text.length}→${result.length} chars (${removed} verbose lines stripped)`)
  }
  return result || text // never return empty if original wasn't
}

// ── Plugin ──────────────────────────────────────────────────────────

// One-shot scratchpad prune: keeps ~/.claude/scratch under control.
// Runs once per plugin instance load (typically once per project per sidecar).
let prunedThisProcess = false
function pruneScratchpadOnce() {
  if (prunedThisProcess) return
  prunedThisProcess = true
  try {
    const script = join(USER_HOME, ".claude/hooks/scratchpad-prune.sh")
    if (existsSync(script)) {
      const child = spawn("bash", [script], { detached: true, stdio: "ignore" })
      child.unref()
    }
  } catch { /* prune is best-effort */ }
  // Inline size cap: use decadence thresholds, remove oldest 30%
  try {
    const dir = SCRATCHPAD_GLOBAL_DIR
    if (!existsSync(dir)) return
    const entries = readdirSync(dir)
    const txtFiles = entries.filter(e => e.endsWith(".txt") && !e.endsWith(".meta.json") && !e.endsWith(".summary.txt")).map(e => join(dir, e))
    if (txtFiles.length <= MAX_SCRATCHPAD_FILES) return
    const totalSize = txtFiles.reduce((a, f) => a + (statSync(f).size || 0), 0)
    if (totalSize < MAX_SCRATCHPAD_BYTES) return
    // Sort by mtime ascending (oldest first), remove oldest 30%
    txtFiles.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
    const remove = Math.ceil(txtFiles.length * 0.3)
    for (let i = 0; i < remove; i++) {
      try { rmSync(txtFiles[i]) } catch {}
      const meta = txtFiles[i].replace(".txt", ".meta.json")
      if (existsSync(meta)) try { rmSync(meta) } catch {}
      const sum = txtFiles[i].replace(".txt", ".summary.txt")
      if (existsSync(sum)) try { rmSync(sum) } catch {}
    }
    console.error(`[vibeOS] pruned ${remove} scratchpad files (${txtFiles.length} → ${txtFiles.length - remove})`)
  } catch {}
}

// ── Project memory — cross-session continuity ───────────────────────
const PROJECT_STATE_FILE = join(USER_HOME, ".claude/project-states.json")
const briefedProjects = new Set()

function projectFingerprint(dir) {
  if (!dir) return "unknown"
  return createHash("sha256").update(dir).digest("hex").slice(0, 12)
}

function loadProjectState() {
  try {
    const state = readJsonOrEmpty(PROJECT_STATE_FILE)
    if (state && typeof state === "object") {
      state.project_hashes ??= {}
      return state
    }
  } catch {}
  return { project_hashes: {} }
}

function saveProjectState(state) {
  try {
    withFileLock(PROJECT_STATE_FILE, () => {
      mkdirSync(dirname(PROJECT_STATE_FILE), { recursive: true })
      const _tmp = PROJECT_STATE_FILE + ".tmp." + Date.now()
      writeFileSync(_tmp, JSON.stringify(state, null, 2) + "\n", "utf-8")
      renameSync(_tmp, PROJECT_STATE_FILE)
    })
  } catch (err) {
    console.error(`[vibeOS] project state write failed: ${err.message}`)
  }
}

function ensureProjectBucket(state, fp) {
  state.project_hashes ??= {}
  if (!state.project_hashes[fp]) {
    state.project_hashes[fp] = {
      totalSessions: 0,
      researchChains: 0,
      context7Bypasses: 0,
      commonTopics: [],
      techStack: detectTechStack(process.cwd()),
    }
  }
  return state.project_hashes[fp]
}

function mergeProjectBucket(dst, src) {
  const a = dst || {}
  const b = src || {}
  const topics = [...new Set([...(a.commonTopics || []), ...(b.commonTopics || [])])].slice(-20)
  const mergePatterns = (kind) => {
    const out = {}
    for (const srcObj of [a.userPatterns?.[kind], b.userPatterns?.[kind]]) {
      for (const [key, val] of Object.entries(srcObj || {})) {
        const row = out[key] || { count: 0, sessions: [], lastSeen: null, summary: val?.summary || "" }
        row.count += Number(val?.count || 0)
        row.sessions = [...new Set([...(row.sessions || []), ...(val?.sessions || [])])].slice(-10)
        row.lastSeen = [row.lastSeen, val?.lastSeen].filter(Boolean).sort().slice(-1)[0] || null
        row.summary = row.summary || val?.summary || ""
        if (val?.kind) row.kind = val.kind
        out[key] = row
      }
    }
    return out
  }
  return {
    totalSessions: (a.totalSessions || 0) + (b.totalSessions || 0),
    researchChains: Math.max(a.researchChains || 0, b.researchChains || 0),
    context7Bypasses: (a.context7Bypasses || 0) + (b.context7Bypasses || 0),
    commonTopics: topics,
    userPatterns: {
      friction: mergePatterns("friction"),
      routines: mergePatterns("routines"),
    },
    lastSeen: [a.lastSeen, b.lastSeen].filter(Boolean).sort().slice(-1)[0] || new Date().toISOString(),
  }
}

function normalizeObservedPath(filePath, directory) {
  if (!filePath || typeof filePath !== "string") return "unknown"
  let p = filePath
  try {
    if (directory && p.startsWith("/")) {
      const rel = relative(directory, p)
      if (rel && !rel.startsWith("..") && !rel.startsWith("/")) p = rel
    }
  } catch {}
  p = p.replace(/\\/g, "/").replace(/^\.\/+/, "")
  if (/^(src\/index\.js|package\.json|README\.md|CHANGELOG\.md|tsconfig\.json)$/i.test(p)) return p
  const m = p.match(/\.([a-z0-9]+)$/i)
  if (p.startsWith("src/") && m) return `src/*.${m[1].toLowerCase()}`
  if (p.startsWith("tests/") && m) return `tests/*.${m[1].toLowerCase()}`
  return basename(p) || "unknown"
}

function commandFamily(command) {
  const c = String(command || "").trim().toLowerCase()
  if (!c) return "unknown"
  if (/\bnode\s+--check\b/.test(c)) return "syntax-check"
  if (/\bnpm\s+run\s+typecheck\b|\btsc\b.*--noemit/.test(c)) return "typecheck"
  if (/\bnpm\s+test\b|\bnode\s+--test\b|\bvitest\b|\bjest\b|\bpytest\b/.test(c)) return "test"
  if (/\bnpm\s+run\s+build\b|\btsc\s+-p\b/.test(c)) return "build"
  if (/\bgit\s+status\b/.test(c)) return "git-status"
  if (/\bgit\s+commit\b/.test(c)) return "git-commit"
  const first = c.replace(/^[a-z_][a-z0-9_]*=\S+\s+/g, "").split(/\s+/)[0]
  return /^[a-z0-9._/-]{1,30}$/.test(first) ? first : "command"
}

function commandFailed(output) {
  const code = output?.exitCode ?? output?.statusCode ?? output?.code
  if (Number.isFinite(Number(code)) && Number(code) !== 0) return true
  const raw = output?.result ?? output?.text ?? output?.content ?? output?.data ?? ""
  if (typeof raw !== "string") return false
  return /\b(exit code|exited with code)\s*[:=]?\s*[1-9]\b|\b(assertionerror|syntaxerror|typeerror|referenceerror)\b|\b(failed|error:|err!)\b/i.test(raw)
}

export function noteProjectPattern(kind, key, summary, meta = {}) {
  if (!currentProjectFingerprint || !key || !summary) return
  try {
    const pstate = loadProjectState()
    const bucket = ensureProjectBucket(pstate, currentProjectFingerprint)
    bucket.userPatterns ??= { friction: {}, routines: {} }
    bucket.userPatterns.friction ??= {}
    bucket.userPatterns.routines ??= {}
    const target = kind === "routine" ? bucket.userPatterns.routines : bucket.userPatterns.friction
    const now = new Date().toISOString()
    const row = target[key] || { kind, summary, count: 0, sessions: [], firstSeen: now, lastSeen: null }
    row.kind = kind
    row.summary = summary
    row.count = Number(row.count || 0) + 1
    row.sessions = [...new Set([...(row.sessions || []), _OC_SID])].slice(-10)
    row.lastSeen = now
    if (meta.family) row.family = meta.family
    if (meta.path) row.path = meta.path
    target[key] = row
    const entries = Object.entries(target)
    if (entries.length > 50) {
      entries.sort((a, b) => String(b[1]?.lastSeen || "").localeCompare(String(a[1]?.lastSeen || "")))
      const kept = Object.fromEntries(entries.slice(0, 50))
      for (const k of Object.keys(target)) delete target[k]
      Object.assign(target, kept)
    }
    bucket.lastSeen = now
    saveProjectState(pstate)
  } catch (err) {
    console.error(`[vibeOS] pattern learner write failed: ${err.message}`)
  }
}

function recordFrictionPattern(key, summary, meta = {}) {
  const sessionKey = `friction:${key}`
  if (frictionSessionKeys.has(sessionKey)) return
  frictionSessionKeys.add(sessionKey)
  noteProjectPattern("friction", key, summary, meta)
}

function recordRoutinePattern(key, summary, meta = {}) {
  const sessionKey = `routine:${key}`
  if (routineSessionKeys.has(sessionKey)) return
  routineSessionKeys.add(sessionKey)
  noteProjectPattern("routine", key, summary, meta)
}

function observeUserCorrection(text) {
  const s = String(text || "").toLowerCase()
  if (!s) return
  let key = null
  let summary = null
  if (/\b(wrong|incorrect|bad)\s+import\b|\bimport\s+(is|was)\s+wrong\b/.test(s)) {
    key = "correction:imports"
    summary = "User corrections mention import mistakes."
  } else if (/\b(forgot|missing|didn't|did not)\s+(run\s+)?(test|tests|typecheck|build)\b/.test(s)) {
    key = "correction:verification"
    summary = "User corrections mention missing verification."
  } else if (/\b(forgot|missing|didn't|did not)\s+commit\b/.test(s)) {
    key = "correction:commit"
    summary = "User corrections mention missed commits."
  } else if (/\b(this took too long|too slow|took too long)\b/.test(s)) {
    key = "correction:latency"
    summary = "User corrections mention slow task completion."
  }
  if (key) recordFrictionPattern(key, summary)
}

function promotedProjectPatterns(fp) {
  try {
    const p = loadProjectState().project_hashes?.[fp]
    const out = []
    const collect = (rows, label) => {
      for (const row of Object.values(rows || {})) {
        const sessions = new Set(row?.sessions || [])
        if (sessions.size >= 3) out.push({ label, summary: row.summary, sessions: sessions.size, lastSeen: row.lastSeen || "" })
      }
    }
    collect(p?.userPatterns?.friction, "friction")
    collect(p?.userPatterns?.routines, "routine")
    out.sort((a, b) => b.sessions - a.sessions || String(b.lastSeen).localeCompare(String(a.lastSeen)))
    return out.slice(0, 3)
  } catch {
    return []
  }
}

function projectPatternRows(fp) {
  try {
    const p = loadProjectState().project_hashes?.[fp]
    const rows = []
    for (const [kind, label] of [["friction", "friction"], ["routines", "routine"]]) {
      for (const [key, row] of Object.entries(p?.userPatterns?.[kind] || {})) {
        const sessions = new Set(row?.sessions || [])
        rows.push({
          key,
          label,
          summary: row?.summary || key,
          count: Number(row?.count || 0),
          sessions: sessions.size,
          lastSeen: row?.lastSeen || "",
        })
      }
    }
    rows.sort((a, b) => b.sessions - a.sessions || b.count - a.count || String(b.lastSeen).localeCompare(String(a.lastSeen)))
    return rows
  } catch {
    return []
  }
}

function clearProjectPatterns(fp) {
  try {
    const pstate = loadProjectState()
    const bucket = pstate.project_hashes?.[fp]
    if (!bucket?.userPatterns) return 0
    const count = Object.keys(bucket.userPatterns.friction || {}).length + Object.keys(bucket.userPatterns.routines || {}).length
    bucket.userPatterns = { friction: {}, routines: {} }
    bucket.lastSeen = new Date().toISOString()
    saveProjectState(pstate)
    return count
  } catch (err) {
    console.error(`[vibeOS] pattern learner clear failed: ${err.message}`)
    return 0
  }
}

const _patternFiredKeys = new Set()

export function observeToolPattern(toolName, input, output, directory) {
  try {
    const t = String(toolName || "").toLowerCase()
    const args = input?.args || {}
    const filePath = args.filePath || args.file_path || args.path || ""
    const observedPath = normalizeObservedPath(filePath, directory)
    let target = observedPath
    if (t === "bash") target = commandFamily(args.command || args.cmd || args.script || "")
    if (t === "task") target = extractFirstWordFromArgs(t, args) || "task"
    const event = { tool: t, target, at: Date.now() }
    recentToolEvents.push(event)
    if (recentToolEvents.length > 20) recentToolEvents.shift()
    let repeat = 0
    for (let i = recentToolEvents.length - 1; i >= 0; i--) {
      const e = recentToolEvents[i]
      if (e.tool !== event.tool || e.target !== event.target) break
      repeat++
    }
    if (repeat === 3) {
      recordFrictionPattern(`repeat-tool:${t}:${target}`, `Repeated ${t} calls against ${target} in one session.`, { family: t, path: target })
      _patternFiredKeys.add(`repeat-tool:${t}:${target}`)
    }
    if (repeat > 3) {
      // User keeps doing the same thing after pattern fired — ignored suggestion
      try {
        updateGlobalLearning((gl) => {
          gl.patternQuality ??= { ignoredCount: 0, trustedCount: 0 }
          gl.patternQuality.ignoredCount = (gl.patternQuality.ignoredCount || 0) + 1
          return gl
        })
      } catch {}
    }
    if (repeat === 0 && _patternFiredKeys.size > 0) {
      // User switched to a different action — could be following a suggestion
      try {
        updateGlobalLearning((gl) => {
          gl.patternQuality ??= { ignoredCount: 0, trustedCount: 0 }
          gl.patternQuality.trustedCount = (gl.patternQuality.trustedCount || 0) + 1
          return gl
        })
      } catch {}
    }

    if (["write", "edit", "multiedit", "notebookedit"].includes(t) && observedPath !== "unknown") {
      lastMutationEvent = { at: Date.now(), path: observedPath, tool: t }
      return
    }

    if (t === "bash") {
      const family = commandFamily(args.command || args.cmd || args.script || "")
      if (lastMutationEvent && Date.now() - lastMutationEvent.at <= 10 * 60 * 1000) {
        if (["syntax-check", "typecheck", "test", "build"].includes(family) && commandFailed(output)) {
          recordFrictionPattern(
            `post-edit-failure:${lastMutationEvent.path}:${family}`,
            `After editing ${lastMutationEvent.path}, ${family} failed soon after.`,
            { family, path: lastMutationEvent.path }
          )
        } else if (["syntax-check", "typecheck", "test", "build", "git-status"].includes(family) && !commandFailed(output)) {
          recordRoutinePattern(
            `post-edit-routine:${lastMutationEvent.path}:${family}`,
            `After editing ${lastMutationEvent.path}, ${family} is a recurring verification step.`,
            { family, path: lastMutationEvent.path }
          )
        }
      }
    }
  } catch (err) {
    console.error(`[vibeOS] pattern learner observe failed: ${err.message}`)
  }
}

function backupFile(path, label = "backup") {
  try {
    if (!existsSync(path)) return null
    const ts = new Date().toISOString().replace(/[:.]/g, "-")
    const dst = `${path}.${label}.${ts}.bak`
    copyFileSync(path, dst)
    return dst
  } catch { return null }
}

function buildProjectBriefing(dir) {
  try {
    const fp = projectFingerprint(dir)
    const state = loadProjectState()
    const p = state.project_hashes?.[fp]
    if (!p || !p.lastSeen) return null
    const name = dir ? dir.split("/").pop() : "unknown"
    const lines = [
      `[project-memory] Previously seen in "${name}":`,
      `  • ${p.totalSessions || 0} past sessions, last ${p.lastSeen.slice(0, 10)}`,
    ]
    if (p.researchChains) lines.push(`  • ${p.researchChains} research domain chains found`)
    if (p.context7Bypasses) lines.push(`  • ${p.context7Bypasses} context7-bypass warnings`)
    if (p.commonTopics?.length) {
      const topics = p.commonTopics.slice(0, 5).join(", ")
      lines.push(`  • Common fetch topics: ${topics}`)
    }
    const hints = promotedProjectPatterns(fp)
    if (hints.length) {
      lines.push("  • Learned patterns:")
      for (const h of hints) lines.push(`    - ${h.summary}`)
    }
    return lines.join("\n")
  } catch { return null }
}

// Refresh currentModel/currentTier from disk config.
// Called per-hook so trinity slot changes take effect without restart.
const PLACEHOLDER_RE = /^(provider|opencode)\/[a-z-]+-model$/i
function _refreshModel(directory) {
  try {
    const sel = loadSelection()
    if (!sel.enabled) return
    const tiersData = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
    const activeSlot = sel.active_slot || "brain"
    let slotOcModel = tiersData?.trinity?.[activeSlot]?.oc || ""
    // Skip placeholder models (e.g. "provider/high-tier-model") — use auto-detected model instead
    if (slotOcModel && PLACEHOLDER_RE.test(slotOcModel)) {
      slotOcModel = ""
      console.error(`[vibeOS] placeholder model detected in ${activeSlot} slot — skipping, will auto-detect`)
    }
    if (slotOcModel) {
      // Always derive tier from active slot so footer/env reflect slot changes,
      // even when multiple slots point to the same model ID.
      const nextTier = activeSlot === "brain" ? "high" : classify(slotOcModel)
      const modelChanged = currentModel !== slotOcModel
      const tierChanged = currentTier !== nextTier
      if (modelChanged || tierChanged) {
        const oldModel = currentModel
        const oldTier = currentTier
        currentModel = slotOcModel
        currentTier = nextTier
        console.error(`[vibeOS] model refresh: ${oldModel}(${oldTier}) → ${currentModel}(${currentTier}) (slot=${activeSlot})`)
      }
    }
    // If no model from tiers and no existing currentModel, try to auto-detect
    if (!currentModel) {
      const detected = readConfig(directory) || readConfig(join(USER_HOME, ".config/opencode")) || process?.env?.OPENCODE_MODEL || ""
      if (detected) {
        currentModel = detected
        currentTier = classify(currentModel)
        console.error(`[vibeOS] auto-detected model: ${currentModel} (tier=${currentTier})`)
      }
    }
    // Reconcile with the actual OpenCode config model (handles manual model switches)
    // When model lock is active, skip auto-reconcile — user must explicitly switch via trinity.
    if (!_modelLocked) {
      const cfgModel = readConfig(directory) || readConfig(join(USER_HOME, ".config/opencode")) || ""
      if (cfgModel && cfgModel !== currentModel) {
        const oldModel = currentModel
        const oldTier = currentTier
        currentModel = cfgModel
        currentTier = classify(cfgModel)
        console.error(`[vibeOS] model refresh (config): ${oldModel}(${oldTier}) → ${currentModel}(${currentTier})`)
        try {
          if (existsSync(TIERS_FILE)) {
            const t = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
            for (const s of ["brain", "medium", "cheap"]) {
              if (t?.trinity?.[s]?.oc === cfgModel) {
                t.selection.active_slot = s
                const _tmp = TIERS_FILE + ".tmp." + Date.now()
                writeFileSync(_tmp, JSON.stringify(t, null, 2) + "\n", "utf-8")
                renameSync(_tmp, TIERS_FILE)
                console.error(`[vibeOS] model refresh (config): synced active_slot → ${s}`)
                break
              }
            }
          }
        } catch {}
      }
    }
  } catch {}
}

export async function DelegationEnforcer({ client, directory }: { client?: unknown; directory?: string } = {}) {
  console.error(`[vibeOS] LOADED cwd=${directory}`)
  registerSessionCleanupHandlers()
  pruneScratchpadOnce()

  // Detect model: project opencode.json → global ~/.config/opencode/opencode.json → env.
  // (client.config.get() can hang during sidecar boot — proven failure mode, do not call.)
  currentModel = readConfig(directory)
  if (!currentModel) {
    const home = process.env.HOME || ""
    if (home) currentModel = readConfig(join(home, ".config/opencode"))
  }
  if (!currentModel) currentModel = process?.env?.OPENCODE_MODEL || ""
  if (currentModel) {
    currentTier = classify(currentModel)
    // Override: only for brain slot — bump sonnet (classified mid by regex) to high
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
  // Sniffs ALL models from the user's opencode.json (provider dropdown + model field).
  if (currentModel || !existsSync(TIERS_FILE)) {
    try {
      let _tiersData
      if (existsSync(TIERS_FILE)) {
        try {
          _tiersData = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
        } catch {
          // Corrupted or empty file — replace with fresh skeleton
          _tiersData = { selection: { enabled: true, active_slot: "brain", delegation_enforce: true, tdd_strict: true }, trinity: {} }
        }
      } else {
        _tiersData = { selection: { enabled: true, active_slot: "brain", delegation_enforce: true, tdd_strict: true }, trinity: {} }
      }
      // Sniff available models from opencode desktop provider config
      const _providers = _loadOpenCodeProviders()
      const _allModels = []
      for (const [providerName, cfg] of Object.entries(_providers)) {
        if (cfg?.models && typeof cfg.models === "object") {
          for (const rawId of Object.keys(cfg.models)) {
            const id = rawId.includes("/") ? rawId : providerName + "/" + rawId
            if (!_allModels.some(m => m.id === id)) {
              _allModels.push({ id, cost: _modelCost(id), tier: _modelTier(id) })
            }
          }
        }
      }
      // Also add currentModel if not already in the list (covers the top-level "model" field)
      if (!_allModels.some(m => m.id === currentModel)) {
        _allModels.push({ id: currentModel, cost: _modelCost(currentModel), tier: _modelTier(currentModel) })
      }
      // Classify and assign slots
      const _ranked = classifyAndRankModels(_allModels)
      const _brain  = _ranked?.brain  || { id: currentModel, cost: _modelCost(currentModel), tier: _modelTier(currentModel) }
      let _medium = _ranked?.medium
      let _cheap  = _ranked?.cheap
      // Derive medium/cheap from brain only when truly missing.
      // Never overwrite existing valid (non-placeholder) models from the config
      // with provider-prefix-guessed IDs (e.g. "anthropic/deepseek-v4-flash").
      const _existing = _tiersData?.trinity || {}
      const _existingMedium = _existing.medium?.oc || ""
      const _existingCheap  = _existing.cheap?.oc  || ""
      const _isPlaceholder = (id) => !id || PLACEHOLDER_RE.test(id)
      const _preferExistingOrRanked = (ranked, existingId) => {
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
      // If still no distinct medium/cheap (only one model discovered) and no existing config,
      // set all three to brain so first-install doesn't leave slots empty.
      if (_medium.id === _brain.id) _medium = { ..._brain }
      if (_cheap.id === _brain.id || _cheap.id === _medium.id) _cheap = { ..._brain }
      // Only set missing slots — never overwrite non-placeholder existing entries
      // with auto-guessed provider-prefixed IDs.
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
        // Refresh in-memory trinity models immediately so routing works this session
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
  // Ensure mcp_port is set in model-tiers.json
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

  // ── Project memory: increment session counter ───────────────────
  const fp = projectFingerprint(directory)
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
    console.error(`[vibeOS] project-memory init failed for ${fp}: ${err.message}`)
  }

  // ── Project Guard: ensure AGENTS.md and README.md exist ──────────
  try {
    if (directory && existsSync(directory)) {
      const techStack = detectTechStack(directory)
      const result = ensureProjectDocs(directory, techStack)
      if (result.created.length > 0) {
        console.error(`[vibeOS] Project Guard: created ${result.created.join(", ")}`)
      }
    }
  } catch (err) {
    console.error(`[vibeOS] Project Guard init failed: ${err.message}`)
  }

  // ── Shared footer logic for text.complete + message.updated ──────
  async function _appendFooter(input, output, directory) {
    if (!loadSelection().enabled) return
    _refreshModel(directory)
    let _footerStress = 0
    if (latestUserIntent) _footerStress = scoreStress(latestUserIntent)
    // Lazy model detection: try client API once
    if (!currentModel) {
      try {
        const cfg = await client.config.get("model")
        if (cfg) {
          currentModel = String(cfg)
          currentTier = classify(currentModel)
          console.error(`[vibeOS] client-detected model: ${currentModel} (tier=${currentTier})`)
        }
      } catch { /* client.config may not be available */ }
    }
    try {
      const messageID =
        input?.messageID ||
        input?.messageId ||
        input?.message?.id ||
        output?.messageID ||
        output?.messageId ||
        output?.message?.id ||
        null
      if (messageID && textCompletePainted.has(messageID)) return

      const text =
        typeof output?.text === "string" ? output.text :
        typeof output?.result === "string" ? output.result :
        typeof output?.content === "string" ? output.content :
        ""
      const { ltTasks, ltCache, ltCost, count, sesTasks, sesEdit, sesCredit, sesC7, sesQuota, sesTaskDelegations, sesDuration, sesRatePerHour, sesTrend, sesToolBreakdown, sesModelTurns, quality_avg } = readLifetimeSavings()

      const brainModel = TRINITY_BRAIN || currentModel || ""
      let modelTag = `[${shortModelName(brainModel)}]`
      const _workerModel = (currentTier === "high" && TRINITY_MEDIUM) ? TRINITY_MEDIUM : TRINITY_CHEAP
      const totalTurns = (sesModelTurns?.brain || 0) + (sesModelTurns?.worker || 0)
      if (_workerModel && _workerModel !== brainModel) {
        const brainPct = Math.round(((sesModelTurns?.brain || 0) / (totalTurns || 1)) * 100)
        modelTag = `[${shortModelName(brainModel)} ${brainPct}% → ${shortModelName(_workerModel)} ${100 - brainPct}%]`
      }

      _autoReportCount = (_autoReportCount || 0) + 1
      if (_autoReportCount % 5 === 0) {
        try {
          saveReport({
            type: "session",
            summary: "Session cost: $" + formatUsd(ltCost) + " | cache saved: $" + formatUsd(ltCache) + " | delegation saved: $" + formatUsd(Number(sesTasks || 0)) + " | task delegations: " + Number(sesTaskDelegations || 0),
            metrics: {
              sessionId: _OC_SID,
              projectFingerprint: currentProjectFingerprint || "unknown",
              projectName: currentProjectName || "unknown",
              sessionCost: ltCost,
              cacheSavings: ltCache,
              delegationSavingsUsd: sesTasks,
              taskDelegationCount: sesTaskDelegations,
              // Backward compatibility (legacy field historically misnamed)
              tasksDelegated: sesTaskDelegations,
              model: currentModel,
              slot: loadSelection().active_slot || "unknown",
              editSavings: sesEdit,
              creditSavings: sesCredit,
              context7Savings: sesC7,
              quotaSavings: sesQuota,
            },
            tags: ["auto", "cost"],
          })
        } catch (e) { console.error("[vibeOS] auto-report:", e.message) }
      }

      // Enforcement state tags for footer — dynamically adjusted by control vector
      const selNowFooter = loadSelection()
      const enfTagsFooter = []
      const bbMode = resolveEnforcementMode()
      if (bbMode === "relaxed") {
        enfTagsFooter.push("[Q&A]")
      } else {
        if (selNowFooter.delegation_enforce) enfTagsFooter.push("[ENF ON]")
        if (selNowFooter.flow_enforce) enfTagsFooter.push("[FLOW ON]")
        if (selNowFooter.tdd_enforce) enfTagsFooter.push("[TDD ON]")
        if (bbMode === "strict") enfTagsFooter.push("[STRICT]")
      }
      if (_modelLocked) enfTagsFooter.push("[LOCK ON]")
      let enfSuffixFooter = enfTagsFooter.length > 0 ? ` ${enfTagsFooter.join(" ")}` : ""
      if (quality_avg > 0) {
        enfSuffixFooter = ` QA:${Math.round(quality_avg)}% ${enfTagsFooter.join(" ")}`
      }
      modelTag = `${modelTag}${enfSuffixFooter || ""}`

      const stripped = text.replace(/\n\n— .+(?: —)?$/, "")
      if (stripped !== text) return
      const ltTotal = ltTasks + ltCache
      const trendIcon = sesTrend === "down" ? "↓" : sesTrend === "up" ? "↑" : "→"
      const brainModelCost = currentModel ? (modelCostPerTurn(currentModel) ?? 0) : 0
      const cheapModelCost = _workerModel ? (modelCostPerTurn(_workerModel) ?? 0) : 0
      const imputedMultiplier = (brainModelCost > SAVE_EST.WRITE_EDIT && cheapModelCost > 0 && brainModelCost > cheapModelCost) ? (brainModelCost / cheapModelCost) : 0
      let footerText
      if (ltTotal > 0) {
        let savingsDisplay = `vibeOS: ${formatUsd(ltTotal)} saved ${trendIcon}`
        if (imputedMultiplier > 2) {
          const imputedActual = ltTotal * imputedMultiplier
          savingsDisplay += ` (${formatUsd(imputedActual)} actual)`
        }
        const selGoal = loadSelection()
        const goalUsd = selGoal.savings_goal_usd || 0
        if (goalUsd > 0) {
          const pct = Math.min(100, Math.round((ltTotal / goalUsd) * 100))
          const filled = Math.floor(pct / 10)
          const bar = "\u2588".repeat(filled) + "\u2591".repeat(10 - filled)
          savingsDisplay += ` | ${formatUsd(ltTotal)} / ${formatUsd(goalUsd)} [${bar}]`
        }
        const stressBar = _footerStress > 0.85 ? "█" : _footerStress > 0.7 ? "▆" : _footerStress > 0.5 ? "▅" : _footerStress > 0.3 ? "▃" : _footerStress > 0.1 ? "▂" : "▁"
        const stressLabel = _footerStress > 0.7 ? "high" : _footerStress > 0.4 ? "elevated" : "calm"
        footerText = stripped + `\n\n— ${modelTag} | ${savingsDisplay} | stress: ${stressBar} ${stressLabel} —`
      } else {
        footerText = stripped + `\n\n— ${modelTag} —`
      }

      if (_blackboxEnabled) {
        try {
          const prevText = _prevOutputText
          _prevOutputText = typeof output?.text === "string" ? output.text : typeof output?.result === "string" ? output.result : ""
          if (_prevOutputText && prevText && _prevOutputText !== prevText) {
            const outcome = detectOutcomeSignal(_prevOutputText)
            if (outcome) {
              const tracker = getBlackboxTracker()
              tracker.recordOutcome(outcome)
              syncOutcomeToApi(outcome)
            }
          }
        } catch {}
      }
      if (typeof output?.text === "string") output.text = footerText
      else if (typeof output?.result === "string") output.result = footerText
      else if (typeof output?.content === "string") output.content = footerText
      else output.text = footerText

      textCompletePainted.add(messageID)
      if (textCompletePainted.size > 500) {
        const it = textCompletePainted.values()
        for (let i = 0; i < 100; i++) textCompletePainted.delete(it.next().value)
      }
    } catch (err) {
      console.error(`[vibeOS] footer failed: ${err.message}`)
    }
  }

function scoreTaskQuality(outputText, promptText) {
  if (typeof outputText !== "string" || outputText.length === 0) return 0
  if (typeof promptText !== "string") promptText = ""

  let score = 50
  if (promptText.length > 0 && outputText.length > promptText.length * 0.5) score += 10
  if (outputText.length < 50) score -= 20
  if (/error|failed|unable|cannot|could not/i.test(outputText)) score -= 10
  if (/TODO|FIXME|placeholder/i.test(outputText) && outputText.length < 200) score -= 15
  const codeBlocks = (outputText.match(/```/g) || []).length
  if (codeBlocks >= 2) score += 10
  if (outputText.length > 500) score += 10
  if (outputText.length > 1000) score += 5

  return Math.max(0, Math.min(100, score))
}

  const pluginHooks = {
    "tool.execute.before": async (input, output) => {
      if (!loadSelection().enabled) return
      _refreshModel(directory)
      const t = input?.tool ?? ""
      const args = output?.args
      const inArgs = input?.args
      let _cacheSave = 0
      let _prompt = ""

      // Scratchpad observation (all tiers) — read-only, never blocks.
      if (SCRATCHPAD_TOOLS.has(t)) {
        const hit = getScratchpadHit(t, args)
        if (hit && !scratchpadHitsSeen.has(hit.hash)) {
          scratchpadHitsSeen.add(hit.hash)
          const total = recordScratchpadObservation()
          // Persist cache savings as a first-class savings type.
          // Compute from actual scratchpad file size: inputs that would
          // have been charged at miss rate are served from cache.
          const _inputTokens = Math.max(1, Math.round(hit.sizeBytes / BYTES_PER_TOKEN))
          _cacheSave = Math.round(_inputTokens * CACHE_SAVED_PER_1M_INPUT_TOKENS / 1_000_000 * 1000) / 1000
          const cacheSaved = recordCacheSaving(t, _cacheSave, { hash: hit.hash })
          const sumNote = hit.summaryPath ? ` (summary: ${hit.summaryPath})` : ""
          const cacheNote = cacheSaved ? `, cache+$${(cacheSaved.lifetime || 0).toFixed(3)} lt` : ""
          console.error(`[vibeOS] 📦 scratchpad hit for ${t}: ${hit.fullPath} ${hit.sizeBytes}B ${hit.ageSec}s old${sumNote} — total observed: ${total ?? "?"}${cacheNote}`)
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
                if (prediction.shouldWarm && prediction.confidence >= 0.6) {
                  console.error(`[vibeOS] 🔮 Smart cache: ${t} may benefit from caching — ${prediction.reason} (conf: ${(prediction.confidence * 100).toFixed(0)}%)`)
                }
              }
            }
          } catch (scErr) {
            console.error(`[vibeOS] Smart cache error: ${scErr.message}`)
          }
        }
      }

      // Credit < 40% + Task: force to cheap slot (mirrors CC's rwh path).
      const _credit = loadCredit()
      if (_credit < 40 && t === "task" && TRINITY_CHEAP && args && typeof args === "object") {
        if (args.model !== TRINITY_CHEAP) {
          args.model = TRINITY_CHEAP
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
        let _target = _exploratoryTarget ?? _tierTarget

        const stressScore = latestUserIntent ? scoreStress(latestUserIntent) : 0
        const apiRoute = await remoteCall("routeModel", [_prompt, currentTier, TRINITY_CHEAP, TRINITY_MEDIUM, LEARNED_EXPLORATORY, stressScore], null)
        if (apiRoute?.target) {
          _target = apiRoute.target
        } else if (_target === TRINITY_CHEAP && TRINITY_MEDIUM) {
          if (stressScore > 0.5) {
            _target = TRINITY_MEDIUM
            console.error(`[vibeOS] 🧘 Stress ${stressScore.toFixed(2)} → preserving medium tier for Task quality`)
          }
        }

        // ML Router: difficulty prediction + confidence cascading.
        if (ML_ENABLED) {
          try {
            const mlDifficulty = computeDifficulty(_prompt)
            const mlHash = hashQuery(_prompt)
            const mlGraphPrediction = predictBestModel(_mlGraph, _firstWord, currentTier)
            if (mlDifficulty.confidence >= ML_CONFIDENCE_THRESHOLD && mlDifficulty.level !== "moderate") {
              const mlTarget = mlDifficulty.suggestedTier === "cheap" ? TRINITY_CHEAP
                : mlDifficulty.suggestedTier === "medium" ? TRINITY_MEDIUM
                : null
              if (mlTarget && mlTarget !== currentModel) {
                const tierRank = { budget: 0, cheap: 1, mid: 2, medium: 2, high: 3, brain: 3 }
                const mlRank = tierRank[mlDifficulty.suggestedTier] || 0
                const curRank = _target ? (tierRank[classify(_target)] || 0) : 0
                if (!_target) {
                  _target = mlTarget
                  console.error(`[vibeOS] 🧠 ML difficulty: ${mlDifficulty.level} (score ${mlDifficulty.score.toFixed(2)}, conf ${mlDifficulty.confidence.toFixed(2)}) → ${mlTarget}`)
                } else if (mlRank > curRank && mlDifficulty.confidence >= 0.75) {
                  _target = mlTarget
                  console.error(`[vibeOS] 🧠 ML upgrade: ${mlDifficulty.level} (score ${mlDifficulty.score.toFixed(2)}, conf ${mlDifficulty.confidence.toFixed(2)}) → ${mlTarget}`)
                }
              }
            }
            if (mlGraphPrediction && mlGraphPrediction !== currentModel) {
              const graphNode = _mlGraph.nodes[_firstWord]
              if (graphNode && graphNode.count >= 3) {
                if (!_target) {
                  _target = mlGraphPrediction
                  console.error(`[vibeOS] 🕸 ML graph: ${_firstWord} → ${mlGraphPrediction} (${graphNode.count} samples)`)
                }
              }
            }
            if (_target) {
              const _mlTier = classify(_target) === "budget" ? "cheap" : classify(_target) === "mid" ? "medium" : classify(_target)
              addRouteEdge(_mlGraph, _firstWord, _target, _mlTier, true)
            }
          } catch (mlErr) {
            console.error(`[vibeOS] ML router error: ${mlErr.message}`)
          }
        }

        if (_target) noteTaskRoutingLearning(_firstWord, _target, _exploratoryTarget ? "exploratory" : `tier:${currentTier}`)
        if (_target && targetArgs?.model !== _target) {
          const _reason = _exploratoryTarget ? `exploratory ('${_firstWord}')` : `tier=${currentTier}`
          const _setModel = (obj) => {
            if (!obj || typeof obj !== "object") return
            obj.model = _target
            obj.modelID = _target
            obj.modelId = _target
          }
          _setModel(targetArgs)
          _setModel(args)
          _setModel(inArgs)
          // Workaround: some OpenCode builds ignore per-task model args.
          // Force delegation by temporarily switching global slot for this task.
          try {
            const selNow = loadSelection()
            const desiredSlot = _target === TRINITY_CHEAP ? "cheap" : _target === TRINITY_MEDIUM ? "medium" : null
            if (selNow.delegation_enforce && currentTier === "high" && desiredSlot && selNow.active_slot !== desiredSlot) {
              taskSlotRestore = selNow.active_slot || "brain"
              const switched = applySlot(desiredSlot)
              if (switched?.ok) {
                currentModel = switched.ocModel
                currentTier = classify(currentModel)
                console.error(`[vibeOS] 🔁 task workaround: switched global slot ${taskSlotRestore} → ${desiredSlot}`)
              } else {
                taskSlotRestore = null
              }
            }
          } catch {}
          console.error(`[vibeOS] 🔀 Task → ${_target} (${_reason}, orchestrator: ${currentModel})`)
        }
      }

      if (FREE.has(t)) return
      // Free models have no per-turn cost — no savings to enforce.
      if (isModelFree(currentModel)) return

      // Dynamic save estimates derived from actual model pricing.
      const _brainCost  = modelCostPerTurn(currentModel)
      const _workerModel = TRINITY_CHEAP || TRINITY_MEDIUM || null
      const _workerCost  = _workerModel ? (modelCostPerTurn(_workerModel) ?? 0) : 0
      // Keep precision high to avoid dropping tiny but real per-event savings to zero.
      const _rawEdit    = _brainCost !== null
        ? Math.max(0, _brainCost - _workerCost)
        : SAVE_EST.WRITE_EDIT
      const _estEdit    = Math.max(_rawEdit, SAVE_EST.WRITE_EDIT * 0.1)
      const _estOpus    = _brainCost !== null ? Math.max(_brainCost, _estEdit) : SAVE_EST.OPUS_DISABLE
      const _estC7      = _brainCost !== null ? Math.max(_brainCost, SAVE_EST.CONTEXT7) : SAVE_EST.CONTEXT7
      const _tierWord   = currentTier === "high" ? "Brain" : currentTier === "mid" ? "Medium" : "Budget"
      const _firstWord = extractFirstWordFromArgs(t, args || inArgs)

      // Credit < 40%: non-task tool — record and nudge to step aside.
      if (_credit < 40) {
        const total = recordSaving(t, "credit<40% high-tier", _estOpus, { firstWord: _firstWord })
        const trend = trendDisplay(readLifetimeSavings().sesTrend)
        const msg = `⚠ [vibeOS] Credit: ${_credit}% — switching to medium saves ~$${_estOpus.toFixed(3)}/turn. Run \`trinity medium\`.`
        if (shouldLogWarn(`${t}|credit|${_tierWord}`)) console.error(`[vibeOS] [delegation] ${msg}`)
        pendingUiNote = msg
        return
      }

      // Write/Edit/NotebookEdit: enforce delegation on high tier when delegation_enforce is on.
      if (WARN_ON_DIRECT.has(String(t || "").toLowerCase())) {
        const sel = loadSelection()
        console.error(`[vibeOS] [enforce-debug] tool=${t} tier=${currentTier} enforce=${sel?.delegation_enforce} argsType=${typeof args} argsExists=${!!args}`)
        const tLower = String(t || "").toLowerCase()
        if (sel.delegation_enforce && currentTier === "high" && args && typeof args === "object") {
          const actualArgs = args || (output && output.args) || {}
          const originalPath = actualArgs.filePath || actualArgs.file_path || ""
          const basename = originalPath.split("/").pop() || "blocked"

          const apiResult = await remoteCall("delegateCheck", [tLower, currentTier, currentModel, _prompt], () => ({
            blocked: true,
            savings: _estEdit,
          }))

          const isBlocked = apiResult?.blocked !== false
          const savings = apiResult?.savings ?? _estEdit

          if (isBlocked) {
            if (tLower === "write") {
              actualArgs.filePath = `/tmp/vibeos-enforcement-blocked-${basename}`
              if (actualArgs.file_path !== undefined) actualArgs.file_path = actualArgs.filePath
            } else if (tLower === "edit" || tLower === "notebookedit") {
              actualArgs.oldString = `__THE_SAVER_ENFORCEMENT_BLOCK_${Date.now()}__`
            }
            const total = recordSaving(t, "delegation enforced", savings, { firstWord: _firstWord })
            pendingUiNote = `🚫 Direct ${t} blocked on Brain tier → delegate via Task or run \`trinity medium\`.`
            enforcementBlocked = true
            if (shouldLogWarn(`${t}|enforced|${_tierWord}`)) console.error(`[vibeOS] [enforcement] BLOCKED direct ${t} on high tier → delegate via Task`)
            return
          }
        }
        const total = recordSaving(t, "direct edit", _estEdit, { firstWord: _firstWord })
        const msg = `[vibeOS] ${_tierWord} tier direct ${t} — save ~$${_estEdit.toFixed(3)} by delegating to Task. Run \`trinity medium\`.`
        if (shouldLogWarn(`${t}|direct|${_tierWord}`)) console.error(`[vibeOS] [delegation] ${msg}`)
        pendingUiNote = msg
        return
      }

      if (SOFT_QUOTA.has(t)) {
        // Context7 nudge / install-suggestion / per-session alert (WebFetch/WebSearch only).
        if (t !== "bash") {
          const target = args?.url || args?.query || ""
          if (isDocsTarget(target) && !context7Seen.has(target)) {
            context7Seen.add(target)
            // Re-check each time — context7 might be added mid-session
            if (detectContext7()) {
              const total = recordSaving(t, "docs-target without context7", _estC7, { firstWord: _firstWord })
              console.error(`[vibeOS] [cost policy] Context7 available — prefer over webfetch for docs lookups (~$0.06/turn saved).`)
            } else {
              const missed = recordMissedContext7(_estC7)
              if (!existsSync(CONTEXT7_INSTALL_FLAG)) {
                try {
                  mkdirSync(dirname(CONTEXT7_INSTALL_FLAG), { recursive: true })
                  writeFileSync(CONTEXT7_INSTALL_FLAG, "")
                } catch {}
                console.error(`[vibeOS] 💡 Install context7 MCP to save ~$0.06/turn on docs: \`claude mcp add context7 npx @upstash/context7-mcp\``)
              } else if (!context7AlertedThisSession) {
                context7AlertedThisSession = true
                console.error(`[vibeOS] 💸 context7 not installed — missed ~$${(missed ?? 0).toFixed(2)} savings this session.`)
              }
            }
          }
        }
        // Soft quota: track per-tool, fire exactly once at QUOTA+1 (tool still runs).
        softQuotaCounts[t] = (softQuotaCounts[t] ?? 0) + 1
        const n = softQuotaCounts[t]
        if (n === SOFT_QUOTA_LIMIT + 1) {
          const total = recordSaving(t, `soft quota exceeded (limit ${SOFT_QUOTA_LIMIT})`, SAVE_EST.SOFT_QUOTA)
          console.error(`[vibeOS] Bash usage high (${n}/${SOFT_QUOTA_LIMIT}) — delegate to Task subagent.`)
        } else if (n <= SOFT_QUOTA_LIMIT) {
          console.error(`[vibeOS] ${t} ${n}/${SOFT_QUOTA_LIMIT}`)
        }
        return
      }
    },

    "tool.execute.after": async (input, output) => {
      if (!loadSelection().enabled) return
      _refreshModel(directory)

      // ── Generate footer alert (prepended to tool result, visible in chat) ──
      let _footerText = ""
      try {
        const { ltTasks, ltCache, ltCost, sesTrend, sesModelTurns } = readLifetimeSavings()
        const ltTotal = ltTasks + ltCache
        const trendIcon = sesTrend === "down" ? "↓" : sesTrend === "up" ? "↑" : "→"
        const selNow = loadSelection()
        const tags = [`[${shortModelName(currentModel)}]`]
        const bbMode = resolveEnforcementMode()
        if (bbMode === "relaxed") {
          tags.push("[Q&A]")
        } else {
          if (selNow.delegation_enforce) tags.push("[ENF ON]")
          if (selNow.flow_enforce) tags.push("[FLOW ON]")
          if (selNow.tdd_enforce) tags.push("[TDD ON]")
          if (bbMode === "strict") tags.push("[STRICT]")
        }
        if (_modelLocked) tags.push("[LOCK ON]")
        const workerModel = (currentTier === "high" && TRINITY_MEDIUM) ? TRINITY_MEDIUM : TRINITY_CHEAP
        const totalTurns = (sesModelTurns?.brain || 0) + (sesModelTurns?.worker || 0)
        if (totalTurns > 0 && workerModel && workerModel !== currentModel) {
          const brainPct = Math.round((sesModelTurns.brain / totalTurns) * 100)
          tags[0] = `[${shortModelName(currentModel)} ${brainPct}% > ${shortModelName(workerModel)} ${100 - brainPct}%]`
        }
        const statusLine = tags.join(" ")
        let stressTag = ""
        if (latestUserIntent) {
          const ss = scoreStress(latestUserIntent)
          if (ss > 0.1) {
            const label = ss > 0.7 ? "high" : ss > 0.4 ? "elevated" : "calm"
            stressTag = ` stress:${label}`
          }
        }
        if (ltTotal > 0) {
          _footerText = `vibeOS: ${formatUsd(ltTotal)} saved ${trendIcon} | ${statusLine}${stressTag}\n\n`
        } else {
          _footerText = `${statusLine}${stressTag}\n\n`
        }
        output.title = _footerText.trim()
        if (typeof output?.output === "string") output.output = _footerText + output.output
        else if (typeof output?.result === "string") output.result = _footerText + output.result
        else if (typeof output?.text === "string") output.text = _footerText + output.text
        else if (typeof output?.content === "string") output.content = _footerText + output.content
        else output.output = _footerText

        _autoReportCount = (_autoReportCount || 0) + 1
        if (_autoReportCount % 5 === 0 && ltTotal > 0) {
          saveReport({
            type: "session", summary: `Session cost: $${formatUsd(ltCost)} | cache saved: $${formatUsd(ltCache)} | delegation saved: $${formatUsd(ltTasks)}`,
            metrics: { sessionId: _OC_SID, sessionCost: ltCost, cacheSavings: ltCache, delegationSavingsUsd: ltTasks, model: currentModel, slot: selNow.active_slot || "unknown" },
            tags: ["auto", "cost"],
          })
        }
      } catch {}
      // ── End footer ──

      const t = input?.tool ?? ""

      // Save ML state after Task or key tools (throttled to avoid excessive I/O).
      if ((t === "task" || t === "bash" || t === "edit" || t === "write") && !_mlSavePending) {
        _mlSavePending = true
        setTimeout(() => { saveMLState(); _mlSavePending = false }, 5000)
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
        const quality = scoreTaskQuality(output?.result || output?.text || "", input?.args?.prompt || "")
        try {
          appendFileSync(SAVINGS_LEDGER_FILE, JSON.stringify({
            at: new Date().toISOString(),
            kind: "quality",
            score: quality,
            tool: t,
            sid: _OC_SID,
            v: 2
          }) + "\n")
        } catch {}
        updateState((s) => {
          s.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" }
          s.lifetime.quality_total_score = (s.lifetime.quality_total_score || 0) + quality
          s.lifetime.quality_total_count = (s.lifetime.quality_total_count || 0) + 1
          s.lifetime.last_updated = new Date().toISOString()
          return s
        })
      }

      // Inject pending delegation UI note (set in tool.execute.before).
      // This surfaces the warning in the OC chat transcript, not just stderr.
      if (pendingUiNote) {
        if (enforcementBlocked) {
          if (typeof output?.result === "string") output.result = pendingUiNote
          else if (typeof output?.text === "string") output.text = pendingUiNote
          else if (typeof output?.content === "string") output.content = pendingUiNote
          else output.result = pendingUiNote
        } else {
          const note = `\n\n${pendingUiNote}`
          if (typeof output?.result === "string") output.result += note
          else if (typeof output?.text === "string") output.text += note
          else if (typeof output?.content === "string") output.content += note
          else output.result = pendingUiNote
        }
        pendingUiNote = null
      }

      // Restore original slot after a forced task-slot workaround.
      if (t === "task" && taskSlotRestore) {
        try {
          const back = applySlot(taskSlotRestore)
          if (back?.ok) {
            currentModel = back.ocModel
            currentTier = classify(currentModel)
            console.error(`[vibeOS] 🔁 task workaround: restored global slot → ${taskSlotRestore}`)
          }
        } catch {}
        taskSlotRestore = null
      }

      // Skip test-reminder, TDD, flow enforcement, and compression for blocked tools
      if (enforcementBlocked) { enforcementBlocked = false; return }
      observeToolPattern(t, input, output, directory)

      // TDD enforcement for task subagent results: scan task output for
      // file paths with source extensions and create skeletons (same logic
      // as the write/edit handler below, but for files written by subagents).
      if (t === "task") {
        const outputText = (output?.result ?? output?.text ?? output?.content ?? "")
        if (typeof outputText === "string" && outputText.length > 0) {
          const TASK_FILE_RE = /((?:\.?[\w@][\w.\-]*\/)+[\w.\-]+\.(?:py|js|ts|mjs|tsx|jsx|cjs|mts|sh|go|rs|rb|java|kt))/gi
          const sel = loadSelection()
          const explicitTestIntent = isUserAskingForTests(latestUserIntent)
          const seen = new Set()
          let match
          while ((match = TASK_FILE_RE.exec(outputText)) !== null) {
            const fp = match[1]
            if (seen.has(fp)) continue
            seen.add(fp)
            const isTestPath = /(^|\/)(tests?|spec)\//i.test(fp) || /\.(test|spec)\./i.test(fp)
            if (sel.tdd_enforce && !isTestPath) {
              const createdPath = enforceTestFile(fp)
              if (createdPath) {
                const ext = createdPath.split('.').pop()
                const fileName = createdPath.split('/').pop()
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
        const explicitTestIntent = isUserAskingForTests(latestUserIntent)
        const isTestPath = /(^|\/)(tests?|spec)\//i.test(fp) || /\.(test|spec)\./i.test(fp)
        if (sel.tdd_enforce && !isTestPath) {
          const createdPath = enforceTestFile(fp)
          if (createdPath) {
            const ext = createdPath.split('.').pop()
            const fileName = createdPath.split('/').pop()
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
                state.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" }
                state.lifetime.tdd_followup_completions = (state.lifetime.tdd_followup_completions || 0) + 1
                state.lifetime.last_updated = new Date().toISOString()
                return state
              })
            } catch {}
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
            const { recordFlowTodo } = await import("./vibeOS-lib/flow-enforcer.js")
            for (const h of flowHits) {
              if (h.id === "todo-comment" && !h.deduped) {
                recordFlowTodo({ filePath, content })
              }
            }
          }
        }
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
    },

    // Worker-to-Brain Report Protocol — injected via the cleaner side-channel.
    // For every chat turn the orchestrator is about to take, find any user
    // message that contains a tool_result for a Task call and append a
    // *separate* text content block with the synthesis directive. Worker
    // output and protocol stay cleanly distinct (mirrors how Claude Code's
    // `additionalContext` works for PostToolUse).
    //
    // Idempotent: marker `[wbp-v1]` prevents duplicate injection across
    // subsequent turns that revisit the same message list.
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!loadSelection().enabled) return
      try {
        const messages = output?.messages
        if (!Array.isArray(messages)) return

        // OC message format: { info: Message, parts: Part[] }
        // Tool results live in ToolPart: { type: "tool", tool: string, callID: string, state: ToolState }
        // ToolStateCompleted: { status: "completed", output: string, ... }

        // ── Context compression ────────────────────────────────────────────
        const COMPRESS_THRESHOLD = 2000
        const KEEP_HOT = 10  // last 10 messages (~5 turns) stay verbatim
        const COMPRESS_MARKER = "[ctx-compressed-v1]"
        const hotStart = Math.max(0, messages.length - KEEP_HOT)
        let compressedBytes = 0

        for (let i = 0; i < messages.length; i++) {
          const { info, parts } = messages[i]
          if (!Array.isArray(parts)) continue
          const isCold = i < hotStart

          for (const part of parts) {
            if (part?.type !== "tool") continue
            const state = part.state
            if (state?.status !== "completed") continue
            const raw = state.output
            if (!raw || typeof raw !== "string" || raw.length < COMPRESS_THRESHOLD) continue
            if (raw.includes(COMPRESS_MARKER)) continue

            // Always write to disk — hot or cold.
            const hash = createHash("sha256")
              .update(`tool_result\n${raw}\n`).digest("hex").slice(0, 16)
            const fullPath = join(getSessionScratchpadDir(), `${hash}.txt`)
            try {
              ensureSessionScratchpadDirs()
              if (!existsSync(fullPath)) {
                writeFileSync(fullPath, raw)
                indexAppend(hash, part.tool, raw.length)
              }
            } catch (err) {
              console.error(`[vibeOS] ctx-compress write failed: ${err.message}`)
              continue
            }

            if (!isCold) continue  // hot: disk backup only, keep full content in context

            const summary = raw.slice(0, 200).replace(/\n+/g, " ").trim() + (raw.length > 200 ? "…" : "")
            const ref =
              `${COMPRESS_MARKER} [${raw.length} chars compressed — cold storage at ${fullPath}] ` +
              `[summary] ${summary}`

            state.output = ref
            compressedBytes += raw.length - ref.length
            console.error(`[vibeOS] 📦 ctx-compress: ${raw.length}→${ref.length} chars (hash: ${hash})`)
          }
        }
        if (compressedBytes > 0) {
          console.error(`[vibeOS] 📦 ctx-compress total saved this transform: ~${Math.round(compressedBytes / 4)} tokens`)
        }

        // ── Worker-to-Brain Report Protocol ───────────────────────────────
        // Find assistant messages containing a completed task ToolPart; inject
        // WBP directive into the next user message's first TextPart.
        const PROTOCOL_MARKER = "[wbp-v1]"
        const PROTOCOL_TEXT =
          PROTOCOL_MARKER +
          " [Worker-to-Brain Report Protocol] When synthesizing the preceding Task output: " +
          "1) EXTRACT core findings/data. " +
          "2) REFORMAT into bullet points. " +
          "3) VERIFY against the original ask. " +
          "4) SYNTHESIZE into final response."

        for (let i = 0; i < messages.length - 1; i++) {
          const { info, parts } = messages[i]
          if (!Array.isArray(parts)) continue
          const hasTask = parts.some(p => p?.type === "tool" && p?.tool === "task" && p?.state?.status === "completed")
          if (!hasTask) continue

          const nextMsg = messages[i + 1]
          if (!Array.isArray(nextMsg?.parts)) continue
          const alreadyHas = nextMsg.parts.some(p => p?.type === "text" && p?.text?.includes(PROTOCOL_MARKER))
          if (alreadyHas) continue

          // Append WBP to the first TextPart of the next message, or create a synthetic one.
          const textPart = nextMsg.parts.find(p => p?.type === "text")
          if (textPart) {
            textPart.text = textPart.text + "\n\n" + PROTOCOL_TEXT
          } else {
            nextMsg.parts.push({ type: "text", text: PROTOCOL_TEXT, synthetic: true })
          }
        }

        // ── Progressive decadence — age-based cache rotation ──────
        applyDecadence()
      } catch (err) {
        console.error(`[vibeOS] messages.transform failed: ${err.message}`)
      }
    },

    "experimental.text.complete": async (input, output) => { await _appendFooter(input, output, directory) },
    "message.updated": async (input, output) => { await _appendFooter(input, output, directory) },

    // Scratchpad-aware compaction. When OpenCode is about to compact a session,
    // remind the compactor that tool results are persisted on disk in the
    // session cache tree and to preserve hash/path refs in
    // the summary. The model can Read those paths back post-compact, so we
    // can compact more aggressively without losing recoverable detail.
    "experimental.session.compacting": async (_input, output) => {
      if (!loadSelection().enabled) return
      try {
        const indexPath = getSessionIndexPath()
        let recent = ""
        if (existsSync(indexPath)) {
          try {
            const lines = readFileSync(indexPath, "utf-8").trim().split("\n").slice(-30)
            recent = lines
              .map((l) => { try { return JSON.parse(l) } catch { return null } })
              .filter((e) => e && e.hash)
              .map((e) => `  • ${e.tool} → ~/.claude/scratch/sessions/${_OC_SID}/by-hash/${e.hash}.txt (${e.size}B)`)
              .join("\n")
          } catch {}
        }
        if (!recent) recent = "  (no recent scratchpad entries)"

        const note =
          `[scratchpad-aware compaction] Tool results from this session live on disk at ~/.claude/scratch/sessions/${_OC_SID}/by-hash/<hash>.txt ` +
          "(plus .meta.json metadata and optional .summary.txt Haiku digest). WHEN COMPACTING: " +
          "(1) drop verbose tool result bodies — the bulk lives on disk; " +
          "(2) PRESERVE every <hash> reference, file path, and pointer in the summary; " +
          "(3) note which on-disk artifacts the model may want to Read back later.\n\n" +
          "Recent cached entries:\n" + recent +
          "\nTo recall any of these post-compact, use the read/grep tools on the listed path."

        if (output && Array.isArray(output.context)) {
          output.context.push({ role: "user", content: note })
          output.context.push({ role: "user", content: `[vibeOS] session cache dir: ${getSessionScratchpadDir()} (cleanup on exit enabled)` })
        } else if (output) {
          output.context = [
            { role: "user", content: note },
            { role: "user", content: `[vibeOS] session cache dir: ${getSessionScratchpadDir()} (cleanup on exit enabled)` },
          ]
        }
      } catch (err) {
        console.error(`[vibeOS] session.compacting failed: ${err.message}`)
      }
    },

    // Inject a standing context7 directive into every system prompt turn.
    // Always fires (no config-file gate) — the model self-determines whether
    // mcp__context7__* tools are callable. If they're not registered, the
    // instruction is harmless; if they are, the model uses them automatically.
    "experimental.chat.system.transform": async (_input, output) => {
      if (!loadSelection().enabled) return
      try {
        const userText = extractLastUserText(_input) || extractLastUserText(output)
        latestUserIntent = typeof userText === "string" ? userText : null
        if (latestUserIntent) observeUserCorrection(latestUserIntent)

        // Blackbox resolution tracking — local stub + async API enrichment
        let _controlVector = null
        if (latestUserIntent) {
          try {
            if (_blackboxEnabled) {
              const tracker = getBlackboxTracker()
              const localState = tracker.update(latestUserIntent)
              const state = loadBlackboxState()
              const sid = _OC_SID
              const serialized = tracker.serialize()
              serialized.project_fingerprint = currentProjectFingerprint || ""

              _controlVector = computeControlVector(localState)

              if (!state.sessions[sid]) state.sessions[sid] = {}
              state.sessions[sid].control_history ??= []
              state.sessions[sid].control_history.push(buildControlHistoryEntry(
                state.sessions[sid].control_history.length + 1,
                localState.sub_regime || "INIT",
                _controlVector,
              ))

              if (state.sessions[sid].control_history.length > 100) {
                state.sessions[sid].control_history = state.sessions[sid].control_history.slice(-100)
              }

              state.sessions[sid] = serialized
              saveBlackboxState(state)
              _latestBlackboxState = localState
              fetchBlackboxEnrichment(sid, localState).then(enriched => {
                if (enriched) _latestBlackboxState = enriched
              }).catch(() => {})
            } else {
              _controlVector = computeControlVector({ sub_regime: classifyTurnSimple(latestUserIntent) })
            }
          } catch {}
        }

        // Context7 directive — model self-determines tool availability.
        const c7urgency = _controlVector?.context7_urgency || "preferred"
        const c7directive =
          "[cost policy] If mcp__context7__resolve-library-id and mcp__context7__get-library-docs " +
          "tools are available in this session, ALWAYS use them instead of WebFetch or WebSearch " +
          "when looking up library or framework documentation " +
          "(docs.*, readthedocs.*, npmjs.com/package/*, pypi.org/project/*, pkg.go.dev, /api/reference/). " +
          "Do not fetch those URLs directly when context7 can serve the same content. " +
          "This saves ~$0.06/turn on average." +
          (c7urgency === "required" ? " CRITICAL: context7 usage is REQUIRED this turn." : "") +
          (c7urgency === "optional" ? " (context7 is optional this turn — use if helpful but not required.)" : "")

        // Thinking-level directive — always inject when set (default is "brief" for cost savings).
        const sel = loadSelection()
        const { thinking_level: explicitLevel } = sel
        if (explicitLevel && explicitLevel !== "full" && Array.isArray(output?.system)) {
          const credit = loadCredit()
          const creditNote = `credit ${credit}%`
          const directives = {
            brief: `[thinking policy] Reasoning depth: BRIEF (manually set, ${creditNote}). Use extended thinking only for genuinely complex multi-step problems. Keep reasoning concise — skip exploratory scratch work and restatement.`,
            off:   `[thinking policy] Reasoning depth: OFF (manually set, ${creditNote}). Skip extended thinking entirely. Respond directly and concisely. Every thinking token costs money — save it for when the user explicitly asks.`,
          }
          const d = directives[explicitLevel]
          if (d) output.system.push(d)
        }

        if (Array.isArray(output?.system)) {
          output.system.push(c7directive)
        }

        if (latestUserIntent) {
          const stressMult = _controlVector?.stress_multiplier ?? 1.0
          const _s = scoreStress(latestUserIntent) * stressMult
          if (_s > 0.7) {
            if (Array.isArray(output?.system)) output.system.push(
              "[stress mitigation: CRITICAL] The user's message shows very high stress indicators. " +
              "Stay calm, structured, and thorough. Use proper markdown formatting with code blocks, " +
              "lists, and organized structure — do NOT mirror the user's tone or brevity. " +
              "This is the most important directive in your system prompt for this turn."
            )
          } else if (_s > 0.4) {
            if (Array.isArray(output?.system)) output.system.push(
              "[stress mitigation: elevated] The user's message has elevated stress indicators. " +
              "Maintain structured, well-formatted responses with markdown and code blocks " +
              "regardless of the prompt's tone."
            )
          }
        }

        // Unified control vector directives (v2 meta-controller)
        if (_controlVector && _controlVector.directives.length > 0) {
          for (const directive of _controlVector.directives) {
            if (Array.isArray(output?.system)) output.system.push(directive)
          }
        } else if (_blackboxEnabled && _latestBlackboxState && _latestBlackboxState.n_interactions > 0) {
          // Fallback: legacy ad-hoc blackbox directives (pre-v2)
          try {
            const res = _latestBlackboxState
            const decisionDirective =
              `[decision engine] Current resolution: ${res.resolution || "unresolved"} (${res.sub_regime || "EXPLORING"}). ` +
              `Momentum: ${(res.momentum || 0) > 0 ? "positive" : (res.momentum || 0) < 0 ? "negative" : "neutral"}. ` +
              `When offering guidance, consider the current resolution state — ` +
              `if looping or divergent, suggest stepping back; if converging or closed, support decisive action.`
            if (Array.isArray(output?.system)) output.system.push(decisionDirective)

            if (res.is_looping && res.loop_intervention_level && res.loop_intervention_level !== "none") {
              const severity = res.loop_intervention_level === "escalated" ? "CRITICAL"
                : res.loop_intervention_level === "assertive" ? "WARNING" : "NOTICE"
              const loopDirective =
                `[loop prevention: ${severity}] ${_latestBlackboxLoopMsg || "The conversation may be looping — try a different approach."} ` +
                `(level: ${res.loop_intervention_level})`
              if (Array.isArray(output?.system)) output.system.push(loopDirective)
            }

            if (res.pivot_detected && _latestBlackboxPivotMsg) {
              if (Array.isArray(output?.system)) output.system.push(`[context switch: PIVOT] ${_latestBlackboxPivotMsg}`)
            }
          } catch {}
        }

        const projectJob = getActiveJobForProject() || activeJob
        if (latestUserIntent && projectJob && isLikelyOffTopic(latestUserIntent, projectJob)) {
          const offTopicDirective =
            `[job-focus] Active job context exists: "${(projectJob.prompt || "").slice(0, 140)}...". ` +
            `The latest user request appears off-topic relative to this running job. ` +
            `Before taking write/edit/task actions, ask one concise confirmation question to validate switching scope.`
          if (Array.isArray(output?.system)) output.system.push(offTopicDirective)
          console.error("[vibeOS] [job-focus] off-topic request detected vs active job context")
        }

        // AI ORCHESTRATOR AGENT — only when delegation enforcement is active
        // and enforcement is not relaxed (meta-controller already covers relaxed mode).
        if (sel.delegation_enforce && _controlVector?.enforcement_mode !== "relaxed" && Array.isArray(output?.system)) {
          const tierBias = _controlVector?.tier_bias || "auto"
          const cheapModel = TRINITY_CHEAP || "the cheaper model"
          const mediumModel = TRINITY_MEDIUM || "the medium model"
          let brainModel = "(brain)"
          try { brainModel = safeJsonParse(readFileSync(TIERS_FILE, "utf-8")).trinity?.brain?.oc || brainModel } catch {}
          const targetModel = tierBias === "cheap" ? cheapModel : tierBias === "medium" ? mediumModel : tierBias === "brain" ? brainModel : `${cheapModel} or ${mediumModel}`
          const orcDirective =
            `[AI ORCHESTRATOR AGENT] You are an AI orchestrator agent. ` +
            `Delegate heavy work to Task subagents (runs on ${targetModel}). ` +
            `Your role: verify, fill gaps, synthesize. CRITICAL: Write/Edit tools are BLOCKED on this tier. You MUST delegate ALL implementation work to Task subagents. ` +
            `Always display the vibeOS cost footer.` +
            (tierBias !== "auto" ? ` [tier routing] This turn is biased toward ${tierBias} tier.` : "")
          output.system.push(orcDirective)
        }

        // Batch task execution helper — encourage parallel subagent calls.
        // Skip when enforcement is relaxed (orchestrator is de-emphasized).
        if (_controlVector?.enforcement_mode !== "relaxed" && Array.isArray(output?.system)) {
          output.system.push(
            "[batch execution] When you need to run multiple independent Task subagent calls, " +
            "invoke them ALL in parallel rather than sequentially. " +
            "Parallel tasks complete faster and reduce total session cost. " +
            "Only sequence tasks when one depends on the output of another."
          )
        }

        // TDD directive — only when TDD enforcement is enabled
        // and not in lazy mode (meta-controller already covers lazy mode).
        if (sel.tdd_enforce && _controlVector?.tdd_mode !== "lazy" && Array.isArray(output?.system)) {
          const tddMode = _controlVector?.tdd_mode || (sel.tdd_strict ? "strict" : "normal")
          const tddFocus = _controlVector?.tdd_focus || []
          const modeNotes = {
            lazy: " Skeletons only when explicitly requested.",
            strict: " STRICT mode: TODO tests MUST pass before considering work complete.",
            quality: " QUALITY mode: Full coverage including edge cases.",
          }
          const focusNote = tddFocus.length > 0 ? ` Focus: ${tddFocus.join(", ")}.` : ""
          output.system.push(
            `[tdd enforcement: ${tddMode}] Auto-create skeleton tests for source files being written/edited.${modeNotes[tddMode] || ""}${focusNote} ` +
            "When creating or modifying source files, ensure corresponding test files exist with proper assertions."
          )
        }

        // Flow directive — only when flow enforcer is enabled
        // and not in audit mode (meta-controller already covers audit mode).
        if (sel.flow_enabled && _controlVector?.flow_mode !== "audit" && Array.isArray(output?.system)) {
          const flowMode = _controlVector?.flow_mode || (sel.flow_enforce ? "normal" : "audit")
          const flowFocus = _controlVector?.flow_focus || []
          const enforceNote = sel.flow_enforce ? " TODO/FIXME extraction is active." : ""
          const focusNote = flowFocus.length > 0 ? ` Focus rules: ${flowFocus.join(", ")}.` : ""
          output.system.push(
            `[flow enforcement: ${flowMode}] Development flow rules are active: write/edit operations are checked against project conventions.${enforceNote}${focusNote} ` +
            "Follow existing code patterns, naming conventions, and project structure."
          )
        }

        // Project Guard directive — maintain AGENTS.md and README.md
        if (Array.isArray(output?.system)) {
          output.system.push(
            "[project guard: CRITICAL] AGENTS.md and README.md are protected by vibeOS. " +
            "Do NOT modify either file without explicit user permission. " +
            "When implementing new features, update README.md to document them. " +
            "AGENTS.md defines that AI agents must ask before changing code — respect this rule."
          )
        }

        // Context window budget warning — estimate usage and warn when approaching limits.
        if (Array.isArray(output?.system)) {
          const ctxBudget = estimateContextBudget(_input, output)
          if (ctxBudget && ctxBudget.pct > 70) {
            const severity = ctxBudget.pct > 90 ? "CRITICAL" : "WARNING"
            output.system.push(
              `[context budget: ${severity}] Context window is ${ctxBudget.pct}% full (~${ctxBudget.estimatedTokens} tokens). ` +
              "Consider using Task subagents for heavy work, compressing tool outputs, or starting a new session to avoid context overflow."
            )
          }
        }

        // Project memory briefing: one-shot per session
        if (!briefedProjects.has(fp)) {
          const briefing = buildProjectBriefing(directory)
          if (briefing && Array.isArray(output?.system)) {
            output.system.push(briefing)
            briefedProjects.add(fp)
            console.error(`[vibeOS] project-memory: briefing injected for ${fp}`)
          }
        }

        // vibeOS welcome banner — one-shot per project fingerprint
        if (!briefedProjects.has("trinity_welcome_" + fp)) {
          if (Array.isArray(output?.system)) {
            const sel = loadSelection()
            let tiers = {}
            try { tiers = safeJsonParse(readFileSync(TIERS_FILE, "utf-8")).trinity || {} } catch {}
            const active = sel.active_slot || "medium"
            const current = currentModel || "(unknown)"
            const trinityTip =
              "[vibeOS] Active plugin. Slot: " + active + " (" + current + "). " +
              "Use trinity command to switch slots, rebuild, or check status. " +
              "Run \`trinity help\` for all commands."
            output.system.push(trinityTip)
            briefedProjects.add("trinity_welcome_" + fp)
          }
        }

        // vibeOS Dashboard display directive — ask once, instruct permanently
        if (!briefedProjects.has("vibeos_dashboard_instruct")) {
          if (Array.isArray(output?.system)) {
            output.system.push(
              "[vibeOS dashboard display] When the trinity tool returns output starting with '[vibeOS-dashboard]', " +
              "you MUST use the question tool to display that data in a clean, human-readable format. " +
              "Use the question field (not the header) to show the dashboard data. " +
              "Format it with clear sections separated by blank lines, aligned columns with spaces, " +
              "and plain text only (no emojis, no markdown). " +
              "The header should be 'vibeOS Dashboard'. " +
              "Include only one option in options: {label: 'Dismiss', description: ''}. " +
              "Strip the '[vibeOS-dashboard]' marker line before displaying."
            )
            briefedProjects.add("vibeos_dashboard_instruct")
          }
        }
      } catch (err) {
        console.error(`[vibeOS] system.transform failed: ${err.message}`)
      }
    },

    "shell.env": async (_input, output) => {
      try {
        _refreshModel(directory)
        output.env ??= {}
        output.env.OPENCODE_MODEL_TIER = currentTier || "unknown"
        output.env.OPENCODE_MODEL = currentModel || "unknown"
      } catch (e) { console.error("[vibeOS] shell.env error:", e) }
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
          // Kick off credit API background fetch on any trinity command.
          if (typeof _lazyRefresh === "function") _lazyRefresh()
          if (!action) action = "status"
          if (["brain", "medium", "cheap"].includes(action)) { slot = action; action = "set" }
          if (action === "status") {
            const sel = loadSelection()
            let tiers = {}
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
            const topTools = Object.entries(toolBreakdown).filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]).slice(0, 5)

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
              return "❌ No model configured for " + slot + " slot. Run \`trinity rebuild\` first."
            }
            const auth = _readAuth()
            const ok = await probeModel(targetModel, auth)
            if (!ok) {
              return "❌ " + targetModel + " failed API probe. Cannot switch to " + slot + " slot.\nCheck API key or run \`trinity rebuild\` to rediscover working models."
            }
            const result = applySlot(slot)
            if (!result.ok) return `❌ Failed to set slot: ${result.reason}`
            return `✅ Switched to ${slot} slot (${result.ocModel}). Active now (no restart needed).`
          }
          if (action === "thinking") {
            if (!level || !["full", "brief", "off"].includes(level)) {
              return `❌ Provide level: full | brief | off`
            }
            // "full" clears the override (let credit-based logic take over)
            const stored = level
            const ok = writeSelection("thinking_level", stored)
            if (!ok) return `❌ Failed to write model-tiers.json`
            const desc = {
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
            // Audit: show current session flow warnings
            const flowWarns = getFlowWarns()
            const sid = String(process.pid || "?")
            const sessionWarns = flowWarns.filter(w => String(w.sid) === sid)
            const bySev = { warn: 0, hint: 0, flag: 0 }
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
              console.error(`[vibeOS] model LOCKED — ${_tiersData?.trinity?.[_tiersData?.selection?.active_slot || "brain"]?.oc || currentModel || "?"} (${currentTier}) will not auto-reconcile with config`)
              const lockModel = _tiersData?.trinity?.[_tiersData?.selection?.active_slot || "brain"]?.oc || currentModel || "detected model"
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
            // Audit: show TDD enforcement stats
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
            const lines = [`\ud83d\udcca Project profile \u2014 ${currentProjectName || (directory ? directory.split("/").pop() : "unknown")}`]
            lines.push(L.repeat(40))
            const fp = currentProjectFingerprint || projectFingerprint(directory)

            // 1. Project memory from project-states.json
            const pstate = loadProjectState()
            const proj = pstate.project_hashes?.[fp]
            if (proj) {
              lines.push(`\n\ud83d\udcc5 Sessions: ${proj.totalSessions || 0} | Last: ${(proj.lastSeen || "").slice(0, 10)}`)
              if (proj.researchChains) lines.push(`\ud83d\udd0d Research chains detected: ${proj.researchChains}`)
              if (proj.context7Bypasses) lines.push(`\ud83d\udcb8 Context7 bypasses: ${proj.context7Bypasses}`)
              if (proj.commonTopics?.length) {
                const topics = proj.commonTopics.slice(0, 5).join(", ")
                lines.push(`\ud83c\udf10 Common fetch domains: ${topics}`)
              }
              const promoted = promotedProjectPatterns(fp)
              if (promoted.length) {
                lines.push(`\nLearned patterns:`)
                for (const ptn of promoted) lines.push(`  [${ptn.label}] ${ptn.summary}`)
              }
            } else {
              lines.push(`\n  (no project memory yet \u2014 first session)`)
            }

            // 2. Current session tool breakdown
            const sv = readLifetimeSavings()
            const totalTurns = (sv.sesModelTurns?.brain || 0) + (sv.sesModelTurns?.worker || 0)
            const brainPct = totalTurns > 0 ? Math.round((sv.sesModelTurns.brain / totalTurns) * 100) : 0
            if (totalTurns > 0) {
              const workerPct = 100 - brainPct
              lines.push(`\n\ud83d\udd04 Model usage: Brain ${brainPct}% (${sv.sesModelTurns.brain} turns) / Worker ${workerPct}% (${sv.sesModelTurns.worker} tasks)`)
            }
            if (sv.sesTasks > 0.01 || sv.ltCache > 0.01) {
              lines.push(`\ud83d\udcb0 Session savings: $${sv.sesTasks.toFixed(2)} delegation + $${sv.ltCache.toFixed(2)} cache`)
            }
            if (sv.sesDuration > 0) {
              const hrs = Math.floor(sv.sesDuration / 3600)
              const mins = Math.floor((sv.sesDuration % 3600) / 60)
              lines.push(`\u23f1  Duration: ${hrs}h ${mins}m | Rate: $${sv.sesRatePerHour.toFixed(2)}/hr | Trend: ${sv.sesTrend === "down" ? "\u2193" : sv.sesTrend === "up" ? "\u2191" : "\u2192"}`)
            }

            // 3. Tool breakdown
            const toolEntries = Object.entries(sv.sesToolBreakdown || {}).filter(([_, v]) => v > 0.005).sort((a, b) => b[1] - a[1])
            if (toolEntries.length > 0) {
              lines.push(`\n\ud83d\udd27 Per-tool savings:`)
              for (const [tool, savings] of toolEntries) {
                lines.push(`  ${tool.padEnd(14)} \u2014$${savings.toFixed(2)}`)
              }
            }

            // 4. Flow enforcer stats
            const flowWarns = getFlowWarns()
            const sid = String(process.pid || "?")
            const sessionFlowWarns = flowWarns.filter(w => String(w.sid) === sid)
            const byRule = {}
            for (const w of sessionFlowWarns) {
              const key = w.rule_id || "unknown"
              byRule[key] = (byRule[key] || 0) + 1
            }
            if (Object.keys(byRule).length > 0) {
              lines.push(`\n\u26a0\ufe0f Flow violations (this session):`)
              for (const [rule, count] of Object.entries(byRule)) {
                lines.push(`  ${rule.padEnd(22)} ${count}`)
              }
            }

            // 5. Optimization suggestions
            const suggestions = []
            // High direct-edit ratio → delegate more
            if (totalTurns > 10 && sv.sesModelTurns.brain > sv.sesModelTurns.worker * 2) {
              if (!loadSelection().delegation_enforce) {
                suggestions.push(`\ud83d\udca1 High direct brain usage (${brainPct}%) — enable enforcement with \`trinity enforce on\` to block direct writes/edits`)
              } else {
                suggestions.push(`\ud83d\udca1 High direct brain usage (${brainPct}%) — enforcement is ON but brain keeps editing directly; check plugin logs`)
              }
            }
            // Context7 bypasses
            if (proj?.context7Bypasses > 3) {
              suggestions.push(`\ud83d\udca1 ${proj.context7Bypasses} context7 bypasses \u2014 install context7 MCP to save ~$0.05/turn`)
            }
            // Research chains
            if (proj?.researchChains > 2) {
              suggestions.push(`\ud83d\udca1 ${proj.researchChains} research domain chains \u2014 consider caching or batching doc lookups`)
            }
            // Frequent webfetch users
            if ((sv.sesToolBreakdown?.webfetch || 0) > 0.1 || (sv.sesToolBreakdown?.websearch || 0) > 0.1) {
              suggestions.push(`\ud83d\udca1 High webfetch/websearch usage \u2014 use context7 tools or scratchpad caching`)
            }
            // Flow: new-md-file violations
            if ((byRule["new-md-file"] || 0) > 2) {
              suggestions.push(`\ud83d\udca1 ${byRule["new-md-file"]} new .md files \u2014 verify explicit user request for docs`)
            }
            // Flow: todo-comment accumulation
            if ((byRule["todo-comment"] || 0) > 5) {
              suggestions.push(`\ud83d\udca1 ${byRule["todo-comment"]} TODO/FIXME left \u2014 clean up or track in issue tracker`)
            }
            // No flow enforcer enabled
            if (loadSelection().flow_enabled === false) {
              suggestions.push(`\ud83d\udca1 Flow enforcer is OFF \u2014 enable with \`trinity flow on\` to catch anti-patterns`)
            }
            for (const ptn of promotedProjectPatterns(fp)) {
              suggestions.push(`Learned ${ptn.label} pattern: ${ptn.summary}`)
            }
            // Credit low
            const credit = loadCredit()
            if (credit < 40) {
              suggestions.push(`\ud83d\udca1 Credit at ${credit}% \u2014 switch to medium/cheap slot with \`trinity medium\``)
            }

            if (suggestions.length > 0) {
              lines.push(`\n\ud83c\udfaf Optimization suggestions:`)
              for (const s of suggestions) lines.push(`  ${s}`)
            } else {
              lines.push(`\n\u2705 No optimization suggestions \u2014 looking good!`)
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

            // By tool: read ledger entries
            const toolTotals = {}
            let entryCount = 0
            try {
              if (existsSync(SAVINGS_LEDGER_FILE)) {
                const raw = readFileSync(SAVINGS_LEDGER_FILE, "utf-8")
                for (const ln of raw.trim().split("\n")) {
                  if (!ln.trim()) continue
                  let rec = null
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

            // By day: read ledger entries
            const dayTotals = {}
            try {
              if (existsSync(SAVINGS_LEDGER_FILE)) {
                const raw = readFileSync(SAVINGS_LEDGER_FILE, "utf-8")
                for (const ln of raw.trim().split("\n")) {
                  if (!ln.trim()) continue
                  let rec = null
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

            // Lifetime totals
            lines.push(`\nLifetime:`)
            lines.push(`  Delegation savings: $${sv.ltTasks.toFixed(4)}`)
            lines.push(`  Cache savings:     $${(sv.ltCache || 0).toFixed(4)}`)
            lines.push(`  Total:             $${ltTotal.toFixed(4)}`)
            lines.push(`  Ledger entries:    ${entryCount}`)
            lines.push(`\n${L.repeat(40)}`)
            return lines.join("\n")
          }

          if (action === "target") {
            const goalVal = parseFloat(slot)
            if (!Number.isFinite(goalVal) || goalVal <= 0) {
              return `Usage: trinity target <amount>\nExample: trinity target 5.00`
            }
            const ok = writeSelection("savings_goal_usd", Math.round(goalVal * 100) / 100)
            return ok
              ? `Savings goal set to $${goalVal.toFixed(2)}. Track progress in the footer.`
              : `Failed to write savings goal.`
          }

          if (action === "patterns") {
            const fp = currentProjectFingerprint || projectFingerprint(directory)
            const name = currentProjectName || (directory ? directory.split("/").pop() : "unknown")
            if (slot === "clear") {
              const count = clearProjectPatterns(fp)
              return `Pattern memory cleared for "${name}" (${count} pattern${count === 1 ? "" : "s"} removed).`
            }
            if (slot === "suggest") {
              const pstate = loadProjectState()
              const currentBucket = pstate.project_hashes?.[fp]
              const currentTech = currentBucket?.techStack || []
              const currentKeys = new Set([
                ...Object.keys(currentBucket?.userPatterns?.friction || {}),
                ...Object.keys(currentBucket?.userPatterns?.routines || {}),
              ])
              const candidates = []
              for (const [otherFp, bucket] of Object.entries(pstate.project_hashes || {})) {
                if (otherFp === fp) continue
                const otherTech = bucket?.techStack || []
                if (!otherTech.some(t => currentTech.includes(t))) continue
                for (const [kind, label] of [["friction", "friction"], ["routines", "routine"]]) {
                  for (const [key, row] of Object.entries(bucket?.userPatterns?.[kind] || {})) {
                    if (currentKeys.has(key)) continue
                    const sessions = new Set(row?.sessions || []).size
                    candidates.push({ key, label, summary: row?.summary || key, count: Number(row?.count || 0), sessions, lastSeen: row?.lastSeen || "" })
                  }
                }
              }
              candidates.sort((a, b) => b.count - a.count || b.sessions - a.sessions)
              const top = candidates.slice(0, 5)
              const lines = ["[\u26a1 From similar tech stack projects]"]
              if (top.length === 0) {
                lines.push("  No cross-project suggestions available yet.")
                return lines.join("\n")
              }
              for (const c of top) {
                const tag = c.sessions >= 3 ? "promoted" : "learning"
                lines.push(`  [${c.label}/${tag}] ${c.summary} (${c.count} hit${c.count === 1 ? "" : "s"}, ${c.sessions} session${c.sessions === 1 ? "" : "s"})`)
              }
              lines.push("")
              lines.push("Use `trinity patterns` to see this project's own patterns.")
              return lines.join("\n")
            }
            const rows = projectPatternRows(fp)
            const lines = [`Project patterns - ${name}`]
            if (rows.length === 0) {
              lines.push("  No learned patterns yet.")
              lines.push("  Patterns promote into briefings after 3 separate sessions.")
              return lines.join("\n")
            }
            const promoted = rows.filter(r => r.sessions >= 3).length
            lines.push(`  ${rows.length} stored, ${promoted} promoted`)
            for (const r of rows.slice(0, 15)) {
              const tag = r.sessions >= 3 ? "promoted" : "learning"
              lines.push(`  [${r.label}/${tag}] ${r.summary} (${r.sessions} session${r.sessions === 1 ? "" : "s"}, ${r.count} hit${r.count === 1 ? "" : "s"})`)
            }
            lines.push("")
            lines.push("Use `trinity patterns clear` to clear project pattern memory.")
            return lines.join("\n")
          }

          if (action === "guard") {
            if (!directory || !existsSync(directory)) return "Working directory not accessible."
            const techStack = detectTechStack(directory)
            const result = ensureProjectDocs(directory, techStack)
            if (result.created.length === 0 && result.skipped.length > 0) {
              return `AGENTS.md and README.md already exist. Use \`trinity guard\` to check for missing features.`
            }
            const lines = [`Project Guard: ${directory.split("/").pop() || "unknown"}`]
            for (const f of result.created) lines.push(`  Created ${f}`)
            for (const f of result.skipped) lines.push(`  Already exists: ${f}`)
            lines.push("")
            lines.push("AGENTS.md: defines AI agent behavioral rules — ASK BEFORE changing code.")
            lines.push("README.md: auto-maintained feature documentation — keep it updated.")
            return lines.join("\n")
          }

          if (action === "rebuild") {
            const providers = _loadOpenCodeProviders()
            const auth = _readAuth()
            const models = await discoverAvailableModels(providers, auth)
            const ranked = classifyAndRankModels(models)
            if (!ranked) {
              return "\u274c No models discovered from any configured provider."
            }
            const probed = { brain: null, medium: null, cheap: null }
            const failed = []
            const candidates = [...new Set([ranked.brain.id, ranked.medium.id, ranked.cheap.id, ...models.map(m => m.id)])]
            for (const id of candidates) {
              if (probed.brain) break
              const ok = await probeModel(id, auth)
              if (ok) probed.brain = models.find(m => m.id === id) || { id, cost: _modelCost(id), tier: _modelTier(id) }
              else failed.push("brain: " + id)
            }
            const byCost = [...models].sort((a, b) => a.cost - b.cost)
            for (const m of byCost) {
              if (probed.cheap) break
              if (m.id === probed.brain?.id) continue
              const ok = await probeModel(m.id, auth)
              if (ok) probed.cheap = m
              else if (!failed.some(f => f.endsWith(m.id))) failed.push("cheap: " + m.id)
            }
            for (const id of candidates) {
              if (probed.medium) break
              if (id === probed.brain?.id || id === probed.cheap?.id) continue
              const ok = await probeModel(id, auth)
              if (ok) probed.medium = models.find(m => m.id === id) || { id, cost: _modelCost(id), tier: _modelTier(id) }
              else if (!failed.some(f => f.endsWith(id))) failed.push("medium: " + id)
            }
            if (!probed.brain) {
              return "\u274c No models responded to probe. Try checking your API keys.\n" + (failed.length > 0 ? "Failed:\n  " + failed.join("\n  ") : "No models discovered.")
            }
            if (!probed.medium) probed.medium = probed.brain
            if (!probed.cheap) probed.cheap = probed.brain
            try {
              const tiers = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
              tiers.trinity = {
                brain: { oc: probed.brain.id, cc: modelToCcAlias(probed.brain.id) },
                medium: { oc: probed.medium.id, cc: modelToCcAlias(probed.medium.id) },
                cheap: { oc: probed.cheap.id, cc: modelToCcAlias(probed.cheap.id) },
              }
              const _tmp = TIERS_FILE + ".tmp." + Date.now()
              writeFileSync(_tmp, JSON.stringify(tiers, null, 2) + "\n", "utf-8")
              renameSync(_tmp, TIERS_FILE)
            } catch (err) {
              return "\u274c Failed to write model-tiers.json: " + err.message
            }
            try { applySlot("brain") } catch (e) { console.error("[vibeOS] auto-activate brain failed:", e.message) }
            const lines = [
              "\ud83d\udd0d Auto-detected models from configured providers:",
              "  \ud83e\udde0 brain  \u2192 " + probed.brain.id + " (tier: " + probed.brain.tier + ", $" + probed.brain.cost.toFixed(4) + "/turn) \u2705",
              "  \u2699  medium \u2192 " + probed.medium.id + " (tier: " + probed.medium.tier + ", $" + probed.medium.cost.toFixed(4) + "/turn) \u2705",
              "  \u26a1 cheap  \u2192 " + probed.cheap.id + " (tier: " + probed.cheap.tier + ", $" + probed.cheap.cost.toFixed(4) + "/turn) \u2705",
            ]
            if (failed.length > 0) {
              lines.push("", "Probe failures (skipped):")
              for (const f of failed) lines.push("  \u274c " + f)
            }
            lines.push("", "\u2705 model-tiers.json updated.", "\ud83e\udde0 Brain slot auto-activated: " + probed.brain.id)
            return lines.join("\n")
          }

          if (action === "diagnose") {
            const results = []
            const ocConfig = join(USER_HOME, ".config/opencode/opencode.json")

            // 1. Required files
            const checks = [
              { path: TIERS_FILE,                                        label: "model-tiers.json"       },
              { path: ocConfig,                                            label: "opencode.json"          },
              { path: STATE_FILE,                                          label: "delegation-state.json" },
            ]
            for (const c of checks) {
              results.push({
                ok: existsSync(c.path),
                okLabel: existsSync(c.path) ? "\u2705" : "\u274c",
                label: c.label,
                detail: existsSync(c.path) ? "exists" : "missing",
                fix: existsSync(c.path) ? null : (c.label === "model-tiers.json" ? "run `trinity rebuild` to create it" : undefined),
              })
            }

            // 2. Slot population
            try {
              const tiers = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
              for (const s of ["brain","medium","cheap"]) {
                const m = tiers?.trinity?.[s]?.oc || ""
                const ok = m.length > 0 && !m.toLowerCase().includes("placeholder")
                results.push({
                  ok, okLabel: ok ? "\u2705" : "\u274c",
                  label: `${s} slot`,
                  detail: ok ? m : (m.length > 0 ? `placeholder: ${m}` : "unset"),
                  fix: ok ? null : "run `trinity rebuild` to auto-assign",
                })
              }
            } catch {
              for (const s of ["brain","medium","cheap"]) {
                results.push({ ok: false, okLabel: "\u274c", label: `${s} slot`, detail: "cannot read model-tiers.json", fix: "run `trinity rebuild` to create it" })
              }
            }

            // 3. Model probe
  if (currentModel || !existsSync(TIERS_FILE)) {
              try {
                const auth = _readAuth()
                const ok = await probeModel(currentModel, auth)
                results.push({
                  ok, okLabel: ok ? "\u2705" : "\u274c",
                  label: "model probe",
                  detail: ok ? "API responsive" : `probe failed: ${currentModel}`,
                })
              } catch {
                results.push({ ok: false, okLabel: "\u274c", label: "model probe", detail: "exception during probe" })
              }
            } else {
              results.push({ ok: false, okLabel: "\u274c", label: "model probe", detail: "no current model detected" })
            }

            // 4. Credits
            const credit = loadCredit()
            let budget = 50
            let totalBal = 0
            try {
              const j = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
              if (j?.selection?.monthly_budget_usd) budget = j.selection.monthly_budget_usd
            } catch {}
            try {
              const cache = safeJsonParse(readFileSync(CREDIT_CACHE_F, "utf-8"))
              if (cache?.total != null) totalBal = cache.total
            } catch {}
            const remaining = budget > 0 ? ((Math.min(credit, 150) / 100) * budget).toFixed(2) : "?"
            const creditOk = credit >= 40
            results.push({
              ok: creditOk, okLabel: creditOk ? "\u2705" : "\u274c",
              label: "credits",
              detail: `${credit}%${totalBal > 0 ? ` ($${totalBal.toFixed(2)} of $${budget})` : ` (of $${budget})`}`,
              fix: creditOk ? null : "run `trinity medium` to reduce spend",
            })

            // 5. Session stats
            try {
              const state = safeJsonParse(readFileSync(STATE_FILE, "utf-8"))
              const sid = String(process.pid || "?")
              const ses = state?.sessions?.[sid]
              const delegationCount = ses?.warns?.length || 0
              const cacheSavings = formatUsd(state?.lifetime?.cache_savings_usd || 0)
              const fw = (state?.flow_warns || []).filter(w => String(w.sid) === sid)
              const flowW = fw.filter(w => w.severity === "warn").length
              const flowH = fw.filter(w => w.severity === "hint").length
              const tdd = state?.lifetime?.tdd_enforced ?? 0
              const enf = loadSelection().delegation_enforce ? " ENFORCE" : ""
              results.push({
                ok: true, okLabel: "\u2705",
                label: "session",
                detail: `${delegationCount} delegates, $${cacheSavings} cache, ${flowW}w/${flowH}h flow, ${tdd} TDD${enf}`,
              })
            } catch {
              results.push({ ok: true, okLabel: "\u2705", label: "session", detail: "no state file yet" })
            }

            const okCount = results.filter(r => r.ok).length
            // Sort: failures first
            results.sort((a, b) => (a.ok === b.ok ? 0 : a.ok ? 1 : -1))
            const lines = [
              "\ud83d\udd0d  vibeOS \u2014 Self Diagnostic",
              "=".repeat(40),
              ""
            ]
            for (const r of results) {
              lines.push(`  ${r.okLabel} ${r.label}: ${r.detail}`)
              if (!r.ok && r.fix) lines.push(`    \u2192 ${r.fix}`)
            }
            if (okCount === results.length) {
              lines.push("", `\u2705 All ${results.length} checks passed`)
            } else {
              const failCount = results.length - okCount
              lines.push("", `\u274c ${failCount}/${results.length} checks failed \u2014 fix items above`)
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
              .filter(([fp2, count]) => fp2 && fp2 !== dstFp && count > 0)
              .sort((a, b) => b[1] - a[1])
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

            const backups = []
            const b1 = backupFile(PROJECT_STATE_FILE, "repair-state")
            if (b1) backups.push(b1)
            const b2 = backupFile(REPORTS_INDEX, "repair-state")
            if (b2) backups.push(b2)

            // 1) Merge project-state buckets
            pstate.project_hashes ??= {}
            pstate.project_hashes[dstFp] = merged
            delete pstate.project_hashes[srcFp]
            saveProjectState(pstate)

            // 2) Relabel report index
            let relabeled = 0
            for (const r of idx.reports || []) {
              if (r.project === name && r.fingerprint === srcFp) {
                r.fingerprint = dstFp
                relabeled++
              }
            }
            saveReportsIndex(idx)

            // 3) Relabel report files metadata (best-effort)
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
              _blackboxTracker = null
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
                  const projectSessions = Object.entries(bbState.sessions || {}).filter(([k, v]) => v.project_fingerprint === currentProjectFingerprint)
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
        async execute({ hours } = {}) {
          const report = researchAudit({ hours: hours ?? 24 })

          // Update project memory with findings
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
            // Keep topics bounded
            if (bucket.commonTopics.length > 20) {
              bucket.commonTopics = bucket.commonTopics.slice(-20)
            }
            saveProjectState(state)
          } catch (err) {
            console.error(`[vibeOS] project-memory update failed: ${err.message}`)
          }

          // Auto-save as report (must be BEFORE early return for totalFetches=0)
          try {
            const findings = []
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
            for (const [d, n] of Object.entries(report.byDomain).sort((a, b) => b[1] - a[1])) {
              if (d.startsWith("_")) continue
              const label = d.length > 55 ? d.slice(0, 55) + "…" : d
              lines.push(`    ${n.toString().padStart(3)}  ${label}`)
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
        async execute({ summary, findings, metrics, narrative, tags } = {}) {
          let parsedFindings = []; let parsedMetrics = {}
          // 1. Try JSON parse first (for programmatic callers like auto-save)
          try { if (findings) parsedFindings = JSON.parse(findings) } catch {
            // 2. Fallback: plain-text parser
            if (findings) {
              for (const line of findings.split("\n").map(l => l.trim()).filter(Boolean)) {
                const m = line.match(/^(warn|info|hint)\s*:\s*(.+?)\s*:\s*(.+)/i)
                if (m) parsedFindings.push({ severity: m[1].toLowerCase(), topic: m[2].trim(), detail: m[3].trim() })
                else parsedFindings.push({ severity: "info", topic: "Note", detail: line })
              }
            }
          }
          // Metrics: JSON first, fallback key=value lines
          try { if (metrics) parsedMetrics = JSON.parse(metrics) } catch {
            if (metrics) {
              for (const line of metrics.split("\n").map(l => l.trim()).filter(Boolean)) {
                const m = line.match(/^([\w-]+)\s*=\s*([\d.]+)/)
                if (m) parsedMetrics[m[1]] = parseFloat(m[2])
              }
            }
          }
          const tagList = tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : []
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
        async execute({ type, project, hours, fingerprint } = {}) {
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
        async execute({ id } = {}) {
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

  try {
    const port = loadMcpPort()
    if (port !== 0) {
      if (!_mcpServerRuntime) {
        _mcpServerRuntime = createMcpServer({
          getState: () => ({ ...computeStatusPayload(), sessions_raw: readFullState()?.sessions || {} }),
          getSavings: () => computeSavingsPayload(),
          getSessionMetrics: () => computeSessionMetrics(readFullState(), _OC_SID),
          listReports: (filter) => {
            if (!existsSync(REPORTS_DIR)) {
              const err = new Error("reports dir not found")
              err.status = 404
              throw err
            }
            return listReports(filter || {})
          },
          readReport: (id) => readReport(id),
          runDiagnose: async () => {
            const raw = await pluginHooks.tool.trinity.execute({ action: "diagnose" })
            return diagnoseStructuredFromText(raw)
          },
          runProject: async () => {
            const raw = await pluginHooks.tool.trinity.execute({ action: "project" })
            return projectStructuredFromText(raw)
          },
          runTrinity: async (action, params = {}) => pluginHooks.tool.trinity.execute({ action, slot: params.slot, level: params.level }),
          runResearchAudit: (hours) => researchAudit({ hours: hours ?? 24 }),
          saveReport: (data) => saveReport(data),
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
    console.error(`[vibeOS] MCP server startup failed: ${err.message}`)
  }

  return pluginHooks
}

export const id = "vibeOS"
export const server = DelegationEnforcer
export default { id: "vibeOS", server: DelegationEnforcer }

// ── Research audit — lightweight session scan ───────────────────────
// Scans the scratchpad index and session state for WebFetch/WebSearch
// patterns: domain chains, redundant queries, context7 bypass.
// Returns a structured report object.
const FETCH_TOOLS = new Set(["WebFetch", "WebSearch", "webfetch", "websearch"])

export function researchAudit({ hours = 24, session: sessionFilter } = {}) {
  const cutoff = Date.now() - hours * 3600 * 1000
  const report = { totalFetches: 0, totalBytes: 0, estCost: 0, chains: [], byDomain: {}, sessions: 0, redundant: 0 }

  // 1. Scratchpad index entries (recent WebFetch/WebSearch only)
  try {
    const indexPath = getGlobalIndexPath()
    if (existsSync(indexPath)) {
      const lines = readFileSync(indexPath, "utf-8").trim().split("\n").filter(Boolean)
      const domainCache = {}

      for (const line of lines) {
        const e = JSON.parse(line)
        if (!FETCH_TOOLS.has(e.tool)) continue
        const ts = new Date(e.ts).getTime()
        if (ts < cutoff) continue
        if (sessionFilter && e.session !== sessionFilter) continue

        report.totalFetches++
        report.totalBytes += e.size || 0

        // Extract domain from summary if available
        const hash = e.hash
        const summaryPathSession = join(getSessionScratchpadDir(), hash + ".summary.txt")
        const summaryPathGlobal = join(SCRATCHPAD_GLOBAL_DIR, hash + ".summary.txt")
        const summaryPath = existsSync(summaryPathSession) ? summaryPathSession : summaryPathGlobal
        if (existsSync(summaryPath)) {
          const summary = readFileSync(summaryPath, "utf-8").slice(0, 200)
          const urlMatch = summary.match(/https?:\/\/([^\/\s\)]+)/i)
          const queryMatch = summary.match(/"query":"([^"]+)"/)
          let domain
          if (urlMatch) {
            // Extract registered domain (last 2 hostname parts) for grouping
            const parts = urlMatch[1].replace(/[\)\.,;:>]+$/, "").split(".")
            domain = parts.length >= 2 ? parts.slice(-2).join(".") : parts[0]
          } else if (queryMatch) {
            domain = queryMatch[1].split(/\s+/).slice(0, 3).join(" ")
          } else {
            // Fallback: extract first capitalized word sequence (e.g. "LDraw.org Library Spec")
            const wordSeq = summary.match(/^([A-Z][a-zA-Z.&-]+(?:\s+[A-Z][a-zA-Z.&-]+)*)/)
            domain = wordSeq?.[1] || (e.tool === "WebSearch" ? "web-search" : "unknown")
          }
          const domainKey = typeof domain === "string" ? domain : "unknown"
          domainCache[hash] = domainKey
          report.byDomain[domainKey] = (report.byDomain[domainKey] || 0) + 1
        } else {
          report.byDomain.unknown = (report.byDomain.unknown || 0) + 1
        }
      }
      // Warn if too many unknown domains
      const unknownCount = report.byDomain.unknown || 0
      if (unknownCount > report.totalFetches * 0.3 && report.totalFetches > 5) {
        console.error(`[vibeOS] ${unknownCount}/${report.totalFetches} fetches have unknown domain — summary files may be missing or fetches failed silently`)
      }

      // Detect chains: 3+ fetches to same domain within 5 entries
      const entries = lines
        .map(l => JSON.parse(l))
        .filter(e => FETCH_TOOLS.has(e.tool) && new Date(e.ts).getTime() >= cutoff)
        .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

      const domainSeq = entries.map(e => domainCache[e.hash] || "unknown")
      let chainStart = -1
      for (let i = 2; i < domainSeq.length; i++) {
        if (domainSeq[i] === domainSeq[i-1] && domainSeq[i-1] === domainSeq[i-2]) {
          if (chainStart === -1 || domainSeq[i] !== domainSeq[chainStart]) {
            chainStart = i - 2
            const domain = domainSeq[i]
            // Count how many consecutive
            let chainEnd = i
            while (chainEnd < domainSeq.length && domainSeq[chainEnd] === domain) chainEnd++
            report.chains.push({ domain, count: chainEnd - chainStart, startIdx: chainStart })
            i = chainEnd
            chainStart = -1
          }
        }
      }
    }
  } catch (err) {
    console.error(`[vibeOS] researchAudit index scan failed: ${err.message}`)
  }

  // 2. Session state for tool_counts and context7 bypass
  try {
    if (existsSync(STATE_FILE)) {
      const state = safeJsonParse(readFileSync(STATE_FILE, "utf-8"))
      for (const [sid, s] of Object.entries(state.sessions || {})) {
        if (sessionFilter && sid !== sessionFilter) continue
        report.sessions++
        const tc = s.tool_counts || {}
        const fetchCount = (tc.WebFetch || 0) + (tc.WebSearch || 0) + (tc.webfetch || 0) + (tc.websearch || 0)
        const c7Warns = (s.warns || []).filter(w => w.reason?.includes("context7")).length
        if (fetchCount > 0) {
          report.byDomain["_session"] = (report.byDomain["_session"] || 0) + 1
        }
        report.redundant += c7Warns
      }
    }
  } catch (err) {
    console.error(`[vibeOS] researchAudit state scan failed: ${err.message}`)
  }

  // 3. Estimated cost: ~$0.001 per fetch for brain model
  const brainCost = currentModel ? (modelCostPerTurn(currentModel) ?? 0.003) : 0.003
  report.estCost = Math.round(report.totalFetches * brainCost * 100) / 100

  return report
}

// ── Reporting framework — persistent reports with consistent schema ─
//   ~/.claude/reports/
//     index.json              — quick-lookup index
//     {id}.json               — individual report files
//
// Schema:
//   meta: { id, project, fingerprint, type, created, sessionId }
//   summary: string
//   findings: [{ severity, topic, detail }]
//   metrics: { [key]: number }
//   narrative: string (markdown)
//   tags: string[]
const REPORTS_DIR = join(USER_HOME, ".claude/reports")
const REPORTS_INDEX = join(REPORTS_DIR, "index.json")

function reportsIndex() {
  const idx = readJsonOrEmpty(REPORTS_INDEX)
  if (!idx || !Array.isArray(idx.reports)) return { reports: [] }
  return idx
}

function saveReportsIndex(idx) {
  try {
    withFileLock(REPORTS_INDEX, () => {
      mkdirSync(REPORTS_DIR, { recursive: true })
      writeFileSync(REPORTS_INDEX, JSON.stringify(idx, null, 2) + "\n")
    })
  } catch (err) {
    console.error(`[vibeOS] reports index write failed: ${err.message}`)
  }
}

function reportId(type, fp) {
  const ts = new Date().toISOString().replace(/[:-]/g, "").replace(/\..+/, "")
  const rnd = Math.random().toString(36).slice(2, 6)
  return `${ts}-${(fp || "unknown").slice(0, 6)}-${type}-${rnd}`
}

// Dedup: skip save if last report of same type has identical summary within 5 min
const _reportDedupWindow = new Map()

function _wouldBeDuplicate(type, summary) {
  if (typeof summary !== "string") return false
  const trunc = Math.min(summary.length, 240)
  const key = `${type || ""}::${summary.slice(0, trunc)}`
  const last = _reportDedupWindow.get(key)
  if (last && (Date.now() - last) < 5 * 60 * 1000) return true
  _reportDedupWindow.set(key, Date.now())
  if (_reportDedupWindow.size > 200) {
    const oldest = [..._reportDedupWindow.entries()].sort((a, b) => a[1] - b[1])[0]
    if (oldest) _reportDedupWindow.delete(oldest[0])
  }
  return false
}

// Prune old reports: delete >90d, keep max 200
function _pruneReports() {
  try {
    const idx = reportsIndex()
    const now = Date.now()
    const keep = []
    for (const r of idx.reports) {
      const created = new Date(r.created).getTime()
      if (isNaN(created)) continue
      // >90d: delete
      if (now - created > 90 * 24 * 3600 * 1000) {
        try { rmSync(join(REPORTS_DIR, `${r.id}.json`)) } catch {}
        continue
      }
      keep.push(r)
    }
    // Keep max 200 (newest)
    const pruned = keep.sort((a, b) => b.created.localeCompare(a.created)).slice(0, 200)
    if (pruned.length !== idx.reports.length) {
      idx.reports = pruned
      saveReportsIndex(idx)
      console.error(`[vibeOS] reports pruned: ${idx.reports.length} kept (from ${keep.length})`)
    }
  } catch (err) {
    console.error(`[vibeOS] reports prune failed: ${err.message}`)
  }
}

// Auto-parse findings (string → array) for callers that pass plain text directly to saveReport
function _parseFindings(v) {
  if (Array.isArray(v)) return v
  if (typeof v !== "string" || !v.trim()) return []
  try { return JSON.parse(v) } catch {}
  const result = []
  for (const line of v.split("\n").map(l => l.trim()).filter(Boolean)) {
    const m = line.match(/^(warn|info|hint)\s*:\s*(.+?)\s*:\s*(.+)/i)
    if (m) result.push({ severity: m[1].toLowerCase(), topic: m[2].trim(), detail: m[3].trim() })
    else result.push({ severity: "info", topic: "Note", detail: line })
  }
  return result
}

function _parseMetrics(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) return v
  if (typeof v !== "string" || !v.trim()) return {}
  try { return JSON.parse(v) } catch {}
  const result = {}
  for (const line of v.split("\n").map(l => l.trim()).filter(Boolean)) {
    const m = line.match(/^([\w-]+)\s*=\s*([\d.]+)/)
    if (m) result[m[1]] = parseFloat(m[2])
  }
  return result
}

export function saveReport({ type = "manual", summary = "", findings = null, metrics = null, narrative = "", tags = [], fingerprint = null }: { type?: string; summary?: string; findings?: unknown; metrics?: unknown; narrative?: string; tags?: unknown[]; fingerprint?: string | null } = {}) {
  // Auto-parse findings + metrics (supports array, JSON string, plain-text lines)
  const parsedFindings = _parseFindings(findings)
  const parsedMetrics = _parseMetrics(metrics)

  // Dedup: skip if last same-type report has same summary within 5 min
  if (_wouldBeDuplicate(type, summary)) return null

  const fp = fingerprint || currentProjectFingerprint || "unknown"
  const id = reportId(type, fp)
  const report = {
    meta: { id, project: currentProjectName || "unknown", fingerprint: fp, type, created: new Date().toISOString(), sessionId: _OC_SID },
    summary, findings: parsedFindings, metrics: parsedMetrics, narrative, tags,
  }
  try {
    withFileLock(REPORTS_INDEX, () => {
      mkdirSync(REPORTS_DIR, { recursive: true })
      writeFileSync(join(REPORTS_DIR, `${id}.json`), JSON.stringify(report, null, 2) + "\n")
      const idx = reportsIndex()
      const _sum = (summary || "").slice(0, 80)
      idx.reports.push({ id, type, project: report.meta.project, fingerprint: fp, created: report.meta.created, summary: _sum })
      writeFileSync(REPORTS_INDEX, JSON.stringify(idx, null, 2) + "\n")
    })
  } catch (err) {
    console.error(`[vibeOS] report/index write failed: ${err.message}`)
    return null
  }
  // Opportunistic TTL prune (once per process ≈ every save)
  _pruneReports()
  return id
}

export function listReports({ type, project, hours = 168, fingerprint }: { type?: string; project?: string; hours?: number; fingerprint?: string } = {}) {
  const cutoff = Date.now() - hours * 3600 * 1000
  const idx = reportsIndex()
  return idx.reports.filter(r => {
    if (type && r.type !== type) return false
    if (project && r.project !== project) return false
    if (fingerprint && r.fingerprint !== fingerprint) return false
    const created = new Date(r.created).getTime()
    if (isNaN(created) || created < cutoff) return false
    return true
  }).sort((a, b) => b.created.localeCompare(a.created))
}

export function readReport(id) {
  if (!id) return null
  if (!/^[\w-]+$/.test(String(id))) return null
  const path = join(REPORTS_DIR, `${id}.json`)
  try {
    if (!existsSync(path)) return null
    return safeJsonParse(readFileSync(path, "utf-8"))
  } catch { return null }
}

// ── Credit API: fetch real balances from provider APIs ───────────────
const AUTH_F = join(USER_HOME, ".local", "share", "opencode", "auth.json")
const CREDIT_CACHE_F = join(USER_HOME, ".claude/credit-snapshot.json")
const BALANCE_APIS = {
  deepseek: {
    url: "https://api.deepseek.com/user/balance",
    parse(d) {
      const b = d?.balance_infos?.find(b => b.currency === "USD")
      return b ? parseFloat(b.total_balance) : 0
    }
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/credits",
    parse(d) { return parseFloat(d?.data?.total_credits) || 0 }
  }
}
let _creditTimer = null
let _mcpServerRuntime = null
export function closeMcpServer() {
    if (!_mcpServerRuntime) return Promise.resolve()
    return _mcpServerRuntime.close()
}
let _mcpServerHooked = false

function _readAuth() {
  try { return existsSync(AUTH_F) ? safeJsonParse(readFileSync(AUTH_F, "utf-8")) : {} } catch { return {} }
}

async function _fetchBal(provider, key) {
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

async function _snapshot() {
  const auth = _readAuth()
  let total = 0; const provs = []
  for (const [p, c] of Object.entries(auth)) {
    if (!c?.key || !BALANCE_APIS[p]) continue
    const { balance } = await _fetchBal(p, c.key)
    if (balance > 0) { provs.push({ provider: p, balance }); total += balance }
  }
  try { writeFileSync(CREDIT_CACHE_F, JSON.stringify({ total, providers: provs, ts: Date.now() })) } catch {}
}

function _cachedPct() {
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


// Lazy background refresh — only starts when a hook calls loadCredit() for the first time.
let _started = false
let _autoReportCount = 0
function _lazyRefresh() {
  if (_started) return
  _started = true
  _snapshot()
  _creditTimer = setInterval(_snapshot, 60 * 60 * 1000)
  if (_creditTimer.unref) _creditTimer.unref()
}


// ── trinity rebuild helpers: discover, classify, probe ────────────────

const MODEL_RANK = { high: 3, mid: 2, budget: 1 }

const OPENCODE_GO_CATALOG = [
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-chat",
  "deepseek/deepseek-reasoner",
]

function _loadOpenCodeProviders() {
  try {
    const cfg = readOpenCodeConfigObject(join(USER_HOME, ".config", "opencode"))
    return cfg?.provider || {}
  } catch { return {} }
}

function _modelCost(id) {
  if (!id) return 0
  const c = modelCostPerTurn(id)
  if (c != null) return c
  const stripped = id.replace(/^(openrouter|opencode|deepseek)\//, "")
  return modelCostPerTurn(stripped) ?? modelCostPerTurn("deepseek/" + stripped) ?? 0
}

function _modelTier(id) {
  if (!id) return "budget"
  const high = HIGH_TIER_RE?.test?.(id)
  if (high) return "high"
  const mid = MID_TIER_RE?.test?.(id)
  return mid ? "mid" : "budget"
}

async function discoverAvailableModels(providers, auth) {
  const all = []
  const seen = new Set()

  const push = (m) => {
    if (seen.has(m.id)) return
    seen.add(m.id)
    all.push(m)
  }

  const pushIfNew = (id, provider) => push({ id, provider, cost: _modelCost(id), tier: _modelTier(id) })

  if (providers.deepseek?.models) {
    for (const rawId of Object.keys(providers.deepseek.models)) {
      const id = rawId.includes("/") ? rawId : "deepseek/" + rawId
      pushIfNew(id, "deepseek")
    }
  }

  if (auth.deepseek?.key) {
    try {
      const res = await fetch("https://api.deepseek.com/models", {
        headers: { Authorization: "Bearer " + auth.deepseek.key },
        signal: AbortSignal.timeout(4000)
      })
      if (res.ok) {
        const body = await res.json()
        const list = body?.data || body?.models || []
        for (const m of list) {
          const rawId = (typeof m === "string" ? m : m.id) || ""
          if (!rawId) continue
          const id = rawId.includes("/") ? rawId : "deepseek/" + rawId
          pushIfNew(id, "deepseek")
        }
      }
    } catch {}
  }

  if (auth.openrouter?.key) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: "Bearer " + auth.openrouter.key },
        signal: AbortSignal.timeout(5000)
      })
      if (res.ok) {
        const body = await res.json()
        const list = body?.data || []
        const pricingMap = {}
        for (const m of list) {
          const rawId = m.id
          if (!rawId) continue
          const dynTurnCost = _parseOpenRouterTurnCost(m)
          if (dynTurnCost != null && Number.isFinite(dynTurnCost)) {
            pricingMap[normalizeModelId(rawId)] = dynTurnCost
          }
          const id = "openrouter/" + rawId
          pushIfNew(id, "openrouter")
        }
        if (Object.keys(pricingMap).length > 0) _writeDynamicPricingCache(pricingMap)
      }
    } catch (e) {
      console.error("[vibeOS] OpenRouter probe failed:", e.message)
    }
  }

  for (const id of OPENCODE_GO_CATALOG) {
    pushIfNew(id, "opencode")
  }

  return all
}

export function classifyAndRankModels(models) {
  if (!models || models.length === 0) return null

  const unique = []
  const seen = new Set()
  for (const m of models) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    unique.push({ ...m })
  }

  if (unique.length === 0) return null

  unique.sort((a, b) => {
    const ra = MODEL_RANK[a.tier] || 0
    const rb = MODEL_RANK[b.tier] || 0
    return rb !== ra ? rb - ra : b.cost - a.cost
  })

  const cheapest = [...unique].sort((a, b) => {
    return a.cost !== b.cost ? a.cost - b.cost : (MODEL_RANK[b.tier] || 0) - (MODEL_RANK[a.tier] || 0)
  })

  return {
    brain: unique[0],
    medium: unique.length > 1 ? unique[1] : unique[0],
    cheap: cheapest[0],
  }
}

export function modelToCcAlias(modelId) {
  if (!modelId) return "haiku"
  let m = String(modelId).toLowerCase()
    .replace(/\./g, "-")  // normalize dots to dashes
    .replace(/^(openrouter|opencode|deepseek|anthropic|google)\//, "")  // strip known prefixes
  // Strip nested provider prefix (e.g. "anthropic/claude-sonnet" → "claude-sonnet")
  m = m.replace(/^(anthropic|google|openai|meta-llama|mistralai|qwen)\//, "")

  const map = {
    "deepseek-v4-pro": "deepseek-reasoner",
    "deepseek-v4-flash": "haiku",
    "deepseek-chat": "haiku",
    "deepseek-reasoner": "deepseek-reasoner",
    "deepseek-r1": "deepseek-reasoner",
    "sonnet": "sonnet",
    "claude-sonnet": "sonnet",
    "opus": "opus",
    "claude-opus": "opus",
    "haiku": "haiku",
    "claude-haiku": "haiku",
    "gemini": "sonnet",
    "gpt": "sonnet",
    "qwq": "sonnet",
  }

  if (map[m]) return map[m]
  if (m.length < 3) return "haiku"
  for (const [k, v] of Object.entries(map)) {
    if (!k || k.length < 3) continue
    if (m.startsWith(k) || k.startsWith(m)) return v
  }
  return "haiku"
}

async function probeModel(modelId, auth) {
  if (!modelId || !auth) return true

  const id = String(modelId || "")
  if (id.startsWith("opencode/")) return true

  let apiUrl, apiKey, reqModel

  if (id.startsWith("deepseek/")) {
    apiUrl = "https://api.deepseek.com/chat/completions"
    apiKey = auth.deepseek?.key
    reqModel = id.replace("deepseek/", "")
  }

 else if (id.startsWith("openrouter/")) {
    apiUrl = "https://openrouter.ai/api/v1/chat/completions"
    apiKey = auth.openrouter?.key
    reqModel = id.replace("openrouter/", "")
  } else {
    return true
  }

  if (!apiKey) {
    console.error("[vibeOS] probeModel: no API key for " + id)
    return false
  }

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: reqModel,
        messages: [{ role: "user", content: "ok" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => "")
      console.error("[vibeOS] probeModel FAIL " + id + ": HTTP " + res.status + " " + errBody.slice(0, 200))
      return false
    }
    return true
  } catch (err) {
    console.error("[vibeOS] probeModel ERROR " + id + ": " + err.message)
    return false
  }
}
