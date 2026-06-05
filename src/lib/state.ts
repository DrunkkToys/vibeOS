// @ts-nocheck
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, readdirSync, openSync, readSync, closeSync, rmSync, copyFileSync, renameSync } from "node:fs"
import { join, dirname, relative, basename } from "node:path"
import { spawn } from "node:child_process"
import { homedir, tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { AsyncLocalStorage } from "node:async_hooks"
import { loadSelection, writeSelection, DFLT_SEL } from "./selection-manager.js"
import { normalizeObservedPath, commandFamily, commandFailed, mergeProjectBucket, _computeSessionMetrics, _pruneOldSessions } from "./pattern-helpers.js"
import { getOcSessionId } from "./runtime-state.js"

// ── File system constants ────────────────────────────────────────────
const USER_HOME = (() => { try { return homedir() } catch { return tmpdir() } })()
const VIBEOS_CONTEXT = new AsyncLocalStorage<{ home?: string }>()
const VIBEOS_HOME = process.env.VIBEOS_HOME || join(USER_HOME, ".claude")
const OPENCODE_HOME = process.env.VIBEOS_OPENCODE_HOME || join(USER_HOME, ".config", "opencode")
const FILE_LOCK_DIR = join(VIBEOS_HOME, ".vibeOS-locks")
const DELEGATION_STATE_FILE = join(VIBEOS_HOME, "delegation-state.json")
const SAVINGS_LEDGER_FILE = join(VIBEOS_HOME, "savings-ledger.jsonl")
const GLOBAL_LEARNING_FILE = join(VIBEOS_HOME, "global-learning.json")
const PRICING_CACHE_FILE = join(VIBEOS_HOME, "model-pricing-cache.json")
const BLACKBOX_STATE_FILE = join(VIBEOS_HOME, "blackbox-state.json")
const PROJECT_STATE_FILE = join(VIBEOS_HOME, "project-states.json")
const TIERS_FILE = join(VIBEOS_HOME, "model-tiers.json")
const ACTIVE_JOBS_FILE = join(VIBEOS_HOME, "active-jobs.json")
const AUTH_F = join(USER_HOME, ".local", "share", "opencode", "auth.json")
const CREDIT_CACHE_F = join(VIBEOS_HOME, "credit-snapshot.json")
const FLOW_TODO_QUEUE_FILE = join(VIBEOS_HOME, ".flow-todo-queue.jsonl")
const FLOW_DEDUP_FILE = join(VIBEOS_HOME, ".flow-dedup-keys.json")
const ENFORCEMENT_COOLDOWN_FILE = join(VIBEOS_HOME, ".enforcement-cooldown.jsonl")
const TODOS_FILE = join(VIBEOS_HOME, "todos.json")
const REPORTS_DIR = join(VIBEOS_HOME, "reports")
const CONTEXT7_INSTALL_FLAG = join(VIBEOS_HOME, ".context7-install-suggested")
const TRINITY_OPENCODE_CONFIG = join(OPENCODE_HOME, "opencode.json")
const TRINITY_OPENCODE_CONFIGC = join(OPENCODE_HOME, "opencode.jsonc")

// ── Scratchpad paths ─────────────────────────────────────────────────
const SCRATCHPAD_ROOT = join(VIBEOS_HOME, "scratch")
const SCRATCHPAD_GLOBAL_DIR = join(SCRATCHPAD_ROOT, "by-hash")
const SCRATCHPAD_SESSIONS_DIR = join(SCRATCHPAD_ROOT, "sessions")
const SCRATCHPAD_SESSION_TTL_MS = 48 * 60 * 60 * 1000
const SCRATCHPAD_MAX_AGE_SEC = Number(process.env.CLAUDE_SCRATCHPAD_MAX_AGE_SEC || 86400)
const MAX_SCRATCHPAD_FILES  = 1000
const MAX_SCRATCHPAD_BYTES  = 10 * 1024 * 1024
const MAX_SESSION_SCRATCHPAD_FILES = 200
const MAX_SESSION_SCRATCHPAD_BYTES = 2 * 1024 * 1024
const MAX_PTR_CANDIDATES = 50
const SUMMARY_HEAD_TRUNCATE = 500

function getVibeOSHome(): string {
  return VIBEOS_CONTEXT.getStore()?.home || process.env.VIBEOS_HOME || join(process.env.HOME || "", ".claude")
}

function getOpenCodeHome(): string {
  return process.env.VIBEOS_OPENCODE_HOME || join(VIBEOS_CONTEXT.getStore()?.home || process.env.HOME || USER_HOME, ".config", "opencode")
}

export function setVibeOSHomeContext(home: string): void {
  VIBEOS_CONTEXT.enterWith({ home: String(home || "") })
}

// ── Scratchpad decadence thresholds ──────────────────────────────────
const DECADENCE_FRESH_MS    = 5 * 60 * 1000
const DECADENCE_WARM_MS     = 60 * 60 * 1000
const DECADENCE_COLD_MS     = 24 * 60 * 60 * 1000
const DECADENCE_EXPIRE_MS   = 48 * 60 * 60 * 1000
const DECADENCE_THROTTLE_MS = 60 * 1000
const DECADENCE_GLOBAL_THROTTLE_MS = 5 * 60 * 1000

// ── Tool name normalization for scratchpad cache keys ─────────────────
const TOOL_NAME_NORMALIZE: Record<string, string> = {
  read: "Read", bash: "Bash", grep: "Grep", glob: "Glob",
  webfetch: "WebFetch", websearch: "WebSearch", list: "LS",
  "context7_query-docs": "Context7QueryDocs",
  "context7_resolve-library-id": "Context7ResolveLibrary",
  obsidian: "Obsidian",
}
const SCRATCHPAD_TOOLS = new Set(Object.keys(TOOL_NAME_NORMALIZE))

// ── Warning constants ────────────────────────────────────────────────
const WARN_DEDUPE_WINDOW_MS = 120 * 1000
const WARN_MAX_PER_SESSION = 3
const WARN_COALESCE_THRESHOLD = 10
const MAX_LOG_LINES = 500

// ── Soft quota ──────────────────────────────────────────────────────
const SOFT_QUOTA_LIMIT = 5

// ── Session identity ─────────────────────────────────────────────────
const _OC_SID = getOcSessionId()
let currentSessionId = _OC_SID
const _sessionStart = Date.now()
const _sessionTimer = function () { return Date.now() - _sessionStart }
function getSessionTimer() { return Date.now() - _sessionStart }

// ── Module-level state ───────────────────────────────────────────────
let currentTier: string | null = null
let currentModel: string | null = null
let currentProjectFingerprint = ""
let currentProjectName = ""

export function setCurrentTier(v: string | null) { currentTier = v }
export function setCurrentModel(v: string | null) { currentModel = v }
export function setCurrentProjectFingerprint(v: string) { currentProjectFingerprint = v }
export function setCurrentProjectName(v: string) { currentProjectName = v }
export function setCurrentSessionId(v: string) { currentSessionId = String(v || _OC_SID) }
export function getCurrentSessionId(): string { return currentSessionId || _OC_SID }
const textCompletePainted = new Set()
const softQuotaCounts: Record<string, number> = {}

// ── Warning/coalescing state ─────────────────────────────────────────
const warnLogThrottle = new Map<string, number>()
const recentToolEvents: Array<{ tool: string, target: string, at: number }> = []
const frictionSessionKeys = new Set<string>()
const routineSessionKeys = new Set<string>()
let lastMutationEvent: string | null = null
export function setLastMutationEvent(v: typeof lastMutationEvent) { lastMutationEvent = v }
const warnPerSession = new Map<string, number>()
const warnCoalesceCounters = new Map<string, number>()

// ── Savings cache (cross-process guard) ──────────────────────────────
let _savingsCache: any = null
let _savingsCacheMtime = 0
let _ledgerReconciledMtime = 0

function invalidateSavingsCache(): void {
  _savingsCache = null
  _savingsCacheMtime = 0
}

// ── ML Router state ──────────────────────────────────────────────────
import { createPatternGraph, deserializeGraph, addRouteEdge, ensureNode, computeDifficulty, cascadeDecide, predictBestModel, hashQuery } from "../vibeOS-lib/ml-router.js"
import { createCacheDatabase, addCacheEntry, recordCacheStats, predictCacheHit, evictStaleEntries, deserializeCacheDb } from "../vibeOS-lib/smart-cache.js"

let _mlGraph: any = createPatternGraph()
let _cacheDb: any = createCacheDatabase()
const ML_ENABLED = true
const ML_CONFIDENCE_THRESHOLD = 0.6
let _mlSavePending = false
export function setMlSavePending(v: boolean) { _mlSavePending = v }

// ── Blackbox state ──────────────────────────────────────────────────
let _blackboxTracker: any = null
let _blackboxEnabled = true
export function setBlackboxEnabled(val: boolean) { _blackboxEnabled = val }
let _latestBlackboxState: any = null
let _latestBlackboxLoopMsg: string | null = null
let _latestBlackboxPivotMsg: string | null = null
let _modelLocked = false
let _lockedSlot: string | null = null
let _lockedModel: string | null = null
let _detectedFramework: string | null = null

// ── Log rotation mtime guard ─────────────────────────────────────────
let _lastLogRotated = 0

// ── Pattern learning state ──────────────────────────────────────────
const _patternFiredKeys = new Set<string>()

// ── One-shot flags ──────────────────────────────────────────────────
let context7AlertedThisSession = false
let _sessionCleanupRegistered = false
let _sessionCacheCleaned = false
let prunedThisProcess = false
let _lastDecadenceRun = 0
let _lastGlobalDecadenceRun = 0
let enforcementBlocked = false
let taskSlotRestore: any = null
let pendingUiNote: string | null = null
const briefedProjects = new Set<string>()

// ── Ledger write buffer ─────────────────────────────────────────────
let _ledgerBuffer: string[] = []
let _ledgerBufferTimer: ReturnType<typeof setTimeout> | null = null
export function setLedgerBufferTimer(val: ReturnType<typeof setTimeout> | null) { _ledgerBufferTimer = val }
const LEDGER_BUFFER_MAX = 10
const LEDGER_BUFFER_FLUSH_MS = 5000

// ── Test reminder state ──────────────────────────────────────────────
const testReminderSeen = new Set<string>()

// ── Default selection & global learning ──────────────────────────────
// DFLT_SEL is imported from selection-manager
const DFLT_GL = {
  exploratory_words: {},
  task_first_words: {},
  context7_bypasses: 0,
  context7_missed_usd: 0,
  context7_last_seen: null,
  updatedAt: null,
}

// ── Tool helper (minimal, avoids @opencode-ai/plugin dependency) ──────
function _zType(base: any): any {
  return Object.assign((...a: any[]) => _zType({ ...base, args: a }), {
    optional: () => _zType({ ...base, optional: true }),
    _isZod: true, _base: base,
  })
}
const tool: any = Object.assign((def: any) => def, {
  schema: {
    string: (o?: any) => _zType({ kind: "string", ...(o || {}) }),
    number: (o?: any) => _zType({ kind: "number", ...(o || {}) }),
    enum: (values: string[]) => _zType({ kind: "enum", values }),
  },
})

// ── State corruption handler ─────────────────────────────────────────
function _handleStateCorruption(path: string): void {
  const backupDir = join(VIBEOS_HOME, ".backups")
  mkdirSync(backupDir, { recursive: true })
  const backupPath = join(backupDir, basename(path) + ".corrupted." + Date.now())
  try { copyFileSync(path, backupPath) } catch {}
  const logPath = join(VIBEOS_HOME, ".state-corruption-log.jsonl")
  try { appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), path, backup: backupPath }) + "\n") } catch {}
}

// ── File locking ─────────────────────────────────────────────────────
function _lockPathFor(filePath: string): string {
  const hash = createHash("sha1").update(String(filePath || "")).digest("hex")
  return join(FILE_LOCK_DIR, `${hash}.lock`)
}

function withFileLock(filePath: string, fn: () => any, opts: { staleMs?: number, timeoutMs?: number } = {}): any {
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

// ── JSONC-tolerant JSON.parse ────────────────────────────────────────
function safeJsonParse(raw: string): any {
  if (raw == null || raw === "") return null
  try {
    return JSON.parse(raw)
  } catch {}

  let cleaned = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1")
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

// ── State validation ─────────────────────────────────────────────────
function validateState(state: any, path: string): void {
  if (!state || typeof state !== "object") {
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
  if (state.lifetime && typeof state.lifetime !== "object") {
    console.error(`[vibeOS] State validation warning: lifetime is not object at ${path}, resetting`)
    state.lifetime = {}
  }
}

// ── JSON file readers / writers ─────────────────────────────────────
function readJsonOrEmpty(filePath: string): any {
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

function updateState(mutator: (state: any) => any): any {
  const delegationStateFile = join(getVibeOSHome(), "delegation-state.json")
  const MAX_RETRIES = 3
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = withFileLock(delegationStateFile, () => {
        const preGen = (readJsonOrEmpty(delegationStateFile)._gen || 0)
        let state = readJsonOrEmpty(delegationStateFile)
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
        validateState(next, delegationStateFile)
        mkdirSync(dirname(delegationStateFile), { recursive: true })
        const tmp = delegationStateFile + ".tmp"
        writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n")
        renameSync(tmp, delegationStateFile)
        invalidateSavingsCache()
        return next
      })
      return result
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) {
        if (process.env.VIBEOS_DEBUG_INTERNALS === "1") {
          console.error(`[vibeOS] updateState failed after ${MAX_RETRIES} retries: ${err.message}`)
        }
        return null
      }
    }
  }
  return null
}

function readFullState(): any {
  const delegationStateFile = join(getVibeOSHome(), "delegation-state.json")
  try {
    if (!existsSync(delegationStateFile)) return {}
    const st = statSync(delegationStateFile)
    if (st.size > 10485760) { _handleStateCorruption(delegationStateFile); return {} }
    return safeJsonParse(readFileSync(delegationStateFile, "utf-8"))
  } catch { _handleStateCorruption(delegationStateFile); return {} }
}

function writeFullState(state: any): void {
  const delegationStateFile = join(getVibeOSHome(), "delegation-state.json")
  try {
    withFileLock(delegationStateFile, () => {
      validateState(state, delegationStateFile)
      mkdirSync(dirname(delegationStateFile), { recursive: true })
      const tmp = delegationStateFile + ".tmp"
      writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n")
      renameSync(tmp, delegationStateFile)
      invalidateSavingsCache()
    })
  } catch (err) {
    console.error(`[vibeOS] writeFullState failed: ${err.message}`)
  }
}

// ── Round to 4 decimal places ────────────────────────────────────────
function roundUsd(v: number): number {
  return Math.round((Number(v) || 0) * 10000) / 10000
}

// ── Tier regexes ─────────────────────────────────────────────────────
const FALLBACK_HIGH = /opus|gemini-.*-pro|deepseek\/deepseek-v4-pro|\bdeepseek-v4-pro\b|gpt-5|(^|\/)o[134]($|-|\/)/i
const FALLBACK_MID  = /deepseek\/deepseek-v4-flash|\bdeepseek-v4-flash\b|claude.*sonnet|gemini-.*-flash|gpt-4o(?!-mini)/i
export function _safeRegex(cfg: any, fallback: RegExp, label: string): RegExp {
  if (!cfg) return fallback
  try { return new RegExp(cfg, "i") }
  catch (e) {
    console.error(`[vibeOS] Invalid ${label}-tier regex in model-tiers.json: ${e.message}. Falling back.`)
    return fallback
  }
}
function loadTierRegexes(): { high: RegExp, mid: RegExp } {
  try {
    const p = join(getVibeOSHome(), "model-tiers.json")
    if (!existsSync(p)) return { high: FALLBACK_HIGH, mid: FALLBACK_MID }
    const j = safeJsonParse(readFileSync(p, "utf-8"))
    const highRe = _safeRegex(j?.tiers?.high?.regex, FALLBACK_HIGH, "high")
    const midRe  = _safeRegex(j?.tiers?.mid?.regex,  FALLBACK_MID,  "mid")
    return { high: highRe, mid: midRe }
  } catch { return { high: FALLBACK_HIGH, mid: FALLBACK_MID } }
}
const { high: HIGH_TIER_RE, mid: MID_TIER_RE } = loadTierRegexes()

// ── Selection management (model-tiers.json) ──────────────────────────
// loadSelection, writeSelection, and DFLT_SEL are imported from selection-manager

// ── Global learning ──────────────────────────────────────────────────
function loadGlobalLearning(): any {
  const globalLearningFile = join(getVibeOSHome(), "global-learning.json")
  try {
    if (!existsSync(globalLearningFile)) return DFLT_GL
    const st = statSync(globalLearningFile)
    if (st.size > 10485760) { _handleStateCorruption(globalLearningFile); return DFLT_GL }
    const j = safeJsonParse(readFileSync(globalLearningFile, "utf-8"))
    if (!j || typeof j !== "object") return DFLT_GL
    j.exploratory_words ??= {}
    j.task_first_words ??= {}
    j.context7_bypasses ??= 0
    j.context7_missed_usd ??= 0
    j.context7_last_seen ??= null
    return j
  } catch {
    _handleStateCorruption(globalLearningFile)
    return DFLT_GL
  }
}

function updateGlobalLearning(mutator: (gl: any) => any): any {
  const globalLearningFile = join(getVibeOSHome(), "global-learning.json")
  return withFileLock(globalLearningFile, () => {
    const s = loadGlobalLearning()
    const next = mutator(s) ?? s
    next.updatedAt = new Date().toISOString()
    mkdirSync(dirname(globalLearningFile), { recursive: true })
    const tmp = globalLearningFile + ".tmp"
    writeFileSync(tmp, JSON.stringify(next, null, 2))
    renameSync(tmp, globalLearningFile)
    return next
  })
}

function getLearnedExploratoryWords(): Set<string> {
  const out = new Set<string>()
  try {
    const gl = loadGlobalLearning()
    for (const [w, meta] of Object.entries(gl.exploratory_words || {})) {
      if ((meta as any)?.count >= 1) out.add(String(w))
    }
  } catch {}
  return out
}

// ── ML Router state ──────────────────────────────────────────────────
function loadMLState(): void {
  try {
    const gl = loadGlobalLearning()
    if (gl.ml_graph_raw) _mlGraph = deserializeGraph(gl.ml_graph_raw)
    if (gl.ml_cache_raw) _cacheDb = deserializeCacheDb(gl.ml_cache_raw)
    evictStaleEntries(_cacheDb, 86400 * 7)
  } catch {}
}

function saveMLState(): boolean {
  if (!ML_ENABLED) return false
  try {
    updateGlobalLearning((gl: any) => {
      gl.ml_graph_raw = JSON.stringify(_mlGraph)
      gl.ml_cache_raw = JSON.stringify(_cacheDb)
      return gl
    })
    return true
  } catch { return false }
}
loadMLState()

// ── Blackbox state management ───────────────────────────────────────
function loadBlackboxState(): any {
  const blackboxFile = join(getVibeOSHome(), "blackbox-state.json")
  try {
    if (!existsSync(blackboxFile)) return { enabled: true, sessions: {} }
    const st = statSync(blackboxFile)
    if (st.size > 10485760) { _handleStateCorruption(blackboxFile); return { enabled: false, sessions: {} } }
    return safeJsonParse(readFileSync(blackboxFile, "utf-8")) || { enabled: false, sessions: {} }
  } catch { _handleStateCorruption(blackboxFile); return { enabled: false, sessions: {} } }
}

function saveBlackboxState(state: any): void {
  const blackboxFile = join(getVibeOSHome(), "blackbox-state.json")
  try {
    mkdirSync(dirname(blackboxFile), { recursive: true })
    const tmp = blackboxFile + ".tmp"
    writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n")
    renameSync(tmp, blackboxFile)
  } catch (err) {
    console.error(`[vibeOS] saveBlackboxState failed: ${err.message}`)
  }
}

function getBlackboxTracker(): any {
  return _blackboxTracker
}

function getBlackboxResolution(): any {
  return _blackboxTracker?.resolution || null
}

// ── Session scratchpad helpers ──────────────────────────────────────
function getSessionRoot(): string { return join(SCRATCHPAD_SESSIONS_DIR, _OC_SID) }
function getSessionScratchpadDir(): string { return join(getSessionRoot(), "by-hash") }
function getSessionIndexPath(): string { return join(getSessionRoot(), "index.jsonl") }
function getGlobalIndexPath(): string { return join(SCRATCHPAD_ROOT, "index.jsonl") }
function ensureSessionScratchpadDirs(): boolean {
  try {
    mkdirSync(getSessionScratchpadDir(), { recursive: true })
    return true
  } catch { return false }
}

function safeCopyIntoSession(hash: string, fromPath: string): void {
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

function cleanupCurrentSessionScratchpad(): void {
  if (_sessionCacheCleaned) return
  _sessionCacheCleaned = true
  try {
    rmSync(getSessionRoot(), { recursive: true, force: true })
  } catch {}
}

function registerSessionCleanupHandlers(): void {
  if (_sessionCleanupRegistered) return
  _sessionCleanupRegistered = true
  if ((process as any)._vibeOS_cleanupRegistered) return
  (process as any)._vibeOS_cleanupRegistered = true
  process.setMaxListeners(20)
  ensureSessionScratchpadDirs()
  process.on("exit", () => { _flushLedgerBuffer(); cleanupCurrentSessionScratchpad() })
  process.on("SIGINT", () => {
    cleanupCurrentSessionScratchpad()
    process.exit(130)
  })
}

// ── Ledger buffer ────────────────────────────────────────────────────
function _flushLedgerBuffer(): void {
  if (_ledgerBufferTimer) { clearTimeout(_ledgerBufferTimer); _ledgerBufferTimer = null }
  if (_ledgerBuffer.length === 0) return
  const batch = _ledgerBuffer.splice(0)
  const lines = batch.map(e => typeof e === "string" ? e.trimEnd() : String(e).trimEnd())
  const joined = lines.filter(Boolean).map(l => l + "\n").join("")
  try { appendFileSync(SAVINGS_LEDGER_FILE, joined) } catch {}
}

function recordSavingsLedgerEntry(entry: any): void {
  try {
    _ledgerBuffer.push(JSON.stringify(entry) + "\n")
    if (_ledgerBuffer.length >= LEDGER_BUFFER_MAX) _flushLedgerBuffer()
    else if (!_ledgerBufferTimer) _ledgerBufferTimer = setTimeout(_flushLedgerBuffer, LEDGER_BUFFER_FLUSH_MS)
  } catch {}
}

function loadSavingsLedger(limit: number = 1000): any[] {
  try {
    if (!existsSync(SAVINGS_LEDGER_FILE)) return []
    const raw = readFileSync(SAVINGS_LEDGER_FILE, "utf-8")
    if (!raw.trim()) return []
    const lines = raw.split("\n").filter(Boolean)
    const recent = limit ? lines.slice(-limit) : lines
    const entries: any[] = []
    for (const line of recent) {
      try { const rec = JSON.parse(line); if (rec && typeof rec === "object") entries.push(rec) } catch {
        const matches = line.match(/\{[^{}]*\{[^}]*}[^{}]*\}|\{[^}]+\}/g)
        if (matches) {
          for (const m of matches) {
            try { const rec = JSON.parse(m); if (rec && typeof rec === "object") entries.push(rec) } catch {}
          }
        }
      }
    }
    return entries
  } catch { return [] }
}

function _newTelemetryBucket(): any {
  return {
    events: 0,
    tool_counts: {},
    tier_counts: {},
    slot_counts: {},
    kind_counts: {},
    prompt_size_buckets: {},
    output_size_buckets: {},
    duration_buckets: {},
    result_counts: {},
    cache_hit_counts: { hit: 0, miss: 0 },
    enforcement_counts: {},
    flow_counts: {},
    tdd_counts: {},
    storage_bytes_estimate: 0,
    retained_sessions: 0,
    last_seen: null,
    last_compacted_at: null,
  }
}

function _incBucket(map: Record<string, number>, key: string, delta: number = 1): void {
  const bucket = String(key || "unknown")
  map[bucket] = Number(map[bucket] || 0) + delta
}

function _bucketNumeric(value: number, ranges: Array<[number, string]>, fallback: string = "unknown"): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  for (const [limit, label] of ranges) {
    if (n <= limit) return label
  }
  return ranges.length > 0 ? ranges[ranges.length - 1][1] : fallback
}

function _bucketChars(value: any): string {
  return _bucketNumeric(Number(value || 0), [
    [0, "0"],
    [63, "1-63"],
    [255, "64-255"],
    [1023, "256-1k"],
    [4095, "1k-4k"],
  ], "4k+")
}

function _bucketMs(value: any): string {
  return _bucketNumeric(Number(value || 0), [
    [49, "0-49ms"],
    [199, "50-199ms"],
    [999, "200-999ms"],
    [4999, "1-4.9s"],
    [14999, "5-14.9s"],
  ], "15s+")
}

function _telemetrySizeEstimate(telemetry: any): number {
  try {
    return Buffer.byteLength(JSON.stringify(telemetry || {}), "utf8")
  } catch {
    return 0
  }
}

export function recordPrivacyTelemetry(event: any): any {
  try {
    if (!event || typeof event !== "object") return null
    return updateState((state: any) => {
      const now = new Date().toISOString()
      state.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" }
      state.sessions ??= {}
      const sid = String(event.session_id || _OC_SID || "unknown")
      state.sessions[sid] ??= { started: now, session_started_at: now, source: "opencode", tool_counts: {}, warns: [], cache_hits: [], seenWarnKeys: {} }
      const lifetime = state.lifetime.telemetry ??= _newTelemetryBucket()
      const session = state.sessions[sid].telemetry ??= _newTelemetryBucket()
      const tool = String(event.tool || "unknown").toLowerCase()
      const tier = String(event.tier || "unknown").toLowerCase()
      const slot = String(event.slot || "unknown").toLowerCase()
      const kind = String(event.kind || "unknown").toLowerCase()
      const promptSize = String(event.prompt_size_bucket || "unknown")
      const outputSize = String(event.output_size_bucket || "unknown")
      const duration = String(event.duration_bucket || "unknown")
      const result = String(event.result || "unknown").toLowerCase()
      const cache = event.cache_hit === true ? "hit" : event.cache_hit === false ? "miss" : "unknown"
      const enforcement = String(event.enforcement || "unknown").toLowerCase()
      const flow = String(event.flow || "unknown").toLowerCase()
      const tdd = String(event.tdd || "unknown").toLowerCase()
      const record = (bucket: any) => {
        bucket.events = Number(bucket.events || 0) + 1
        _incBucket(bucket.tool_counts, tool)
        _incBucket(bucket.tier_counts, tier)
        _incBucket(bucket.slot_counts, slot)
        _incBucket(bucket.kind_counts, kind)
        _incBucket(bucket.prompt_size_buckets, promptSize)
        _incBucket(bucket.output_size_buckets, outputSize)
        _incBucket(bucket.duration_buckets, duration)
        _incBucket(bucket.result_counts, result)
        _incBucket(bucket.enforcement_counts, enforcement)
        _incBucket(bucket.flow_counts, flow)
        _incBucket(bucket.tdd_counts, tdd)
        if (cache === "hit" || cache === "miss") {
          bucket.cache_hit_counts[cache] = Number(bucket.cache_hit_counts[cache] || 0) + 1
        }
        bucket.last_seen = now
        bucket.storage_bytes_estimate = _telemetrySizeEstimate(bucket)
      }
      record(lifetime)
      record(session)
      lifetime.retained_sessions = Object.values(state.sessions).filter((ses: any) => Number(ses?.telemetry?.events || 0) > 0).length
      session.retained_sessions = 1
      state.lifetime.last_updated = now
      return state
    })
  } catch {
    return null
  }
}

function readTelemetrySummary(state: any, sid: string = _OC_SID): any {
  const lifetime = state?.lifetime?.telemetry || {}
  const session = state?.sessions?.[sid]?.telemetry || {}
  return {
    lifetime_events: Number(lifetime.events || 0),
    current_session_events: Number(session.events || 0),
    storage_bytes_estimate: Number(lifetime.storage_bytes_estimate || 0),
    retained_sessions: Number(lifetime.retained_sessions || 0),
    tool_counts: lifetime.tool_counts || {},
    tier_counts: lifetime.tier_counts || {},
    slot_counts: lifetime.slot_counts || {},
    kind_counts: lifetime.kind_counts || {},
    prompt_size_buckets: lifetime.prompt_size_buckets || {},
    output_size_buckets: lifetime.output_size_buckets || {},
    duration_buckets: lifetime.duration_buckets || {},
    result_counts: lifetime.result_counts || {},
    cache_hit_counts: lifetime.cache_hit_counts || { hit: 0, miss: 0 },
    enforcement_counts: lifetime.enforcement_counts || {},
    flow_counts: lifetime.flow_counts || {},
    tdd_counts: lifetime.tdd_counts || {},
    last_seen: lifetime.last_seen || null,
    last_compacted_at: lifetime.last_compacted_at || null,
  }
}

// ── Stable JSON serialization (sorted keys, matches CC shasum) ──────
function stableJson(obj: any): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj)
  if (Array.isArray(obj)) return "[" + obj.map(stableJson).join(",") + "]"
  return "{" + Object.keys(obj).sort()
    .map(k => JSON.stringify(k) + ":" + stableJson(obj[k]))
    .join(",") + "}"
}

function _readHead(fullPath: string): string {
  try {
    const buf = Buffer.alloc(120)
    const fd = openSync(fullPath, "r")
    const { bytesRead } = readSync(fd, buf, 0, 120, 0)
    closeSync(fd)
    return buf.toString("utf-8", 0, bytesRead)
  } catch { return "" }
}

function indexAppend(hash: string, tool: string, size: number, extra?: any): void {
  try {
    const entryObj: any = {
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

// ── Scratchpad hit detection ─────────────────────────────────────────
const scratchpadHitsSeen = new Set<string>()

function scanRecentScratchpad(dir: string, titleCase: string, maxScan: number = 2000): any {
  try {
    if (!existsSync(dir)) return null
    const entries = readdirSync(dir)
    const ptrFiles = entries.filter(e => e.endsWith(".ptr"))
    const ptrCandidates: Array<{ ptrPath: string, mtimeMs: number }> = []
    for (const pf of ptrFiles) {
      if (ptrCandidates.length >= MAX_PTR_CANDIDATES) break
      try {
        const st = statSync(join(dir, pf))
        ptrCandidates.push({ ptrPath: join(dir, pf), mtimeMs: st.mtimeMs })
      } catch {}
    }
    ptrCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
    let scanned = 0
    for (const { ptrPath } of ptrCandidates) {
      if (scanned++ >= maxScan) break
      try {
        const ptrData = safeJsonParse(readFileSync(ptrPath, "utf-8"))
        if (!ptrData?.contentHash) continue
        const ptrTool = typeof ptrData.tool === "string" ? (TOOL_NAME_NORMALIZE[ptrData.tool] || ptrData.tool) : null
        if (titleCase && ptrTool && ptrTool !== titleCase) continue
        const contentHash = String(ptrData.contentHash)
        const f = join(dir, `${contentHash}.txt`)
        if (!existsSync(f)) continue
        const st = statSync(f)
        const ageSec = (Date.now() - st.mtimeMs) / 1000
        if (ageSec > SCRATCHPAD_MAX_AGE_SEC) continue
        const sumPath = join(dir, `${contentHash}.summary.txt`)
        return { hash: contentHash, fullPath: f, sizeBytes: st.size, ageSec: Math.round(ageSec), summaryPath: existsSync(sumPath) ? sumPath : null }
      } catch {}
    }
    return null
  } catch {
    return null
  }
}

function getScratchpadHit(toolLower: string, args: any, baseDir: string | null = null): any {
  if (!SCRATCHPAD_TOOLS.has(toolLower)) return null
  const titleCase = TOOL_NAME_NORMALIZE[toolLower]
  const inputJson = stableJson(args ?? {})
  const hash = createHash("sha256").update(`${titleCase}\n${inputJson}\n`).digest("hex").slice(0, 16)
  const sessionDir = baseDir || getSessionScratchpadDir()
  const sessionPath = join(sessionDir, `${hash}.txt`)
  let fullPath = existsSync(sessionPath) ? sessionPath : null
  if (!fullPath) {
    // Try pointer files (created by compressToolOutputs mapping input hash -> content hash)
    const ptrSessionPath = join(sessionDir, `${hash}.ptr`)
    const ptrPath = existsSync(ptrSessionPath) ? ptrSessionPath : null
    let resolvedHash = hash
    if (ptrPath) {
      try {
        const ptrData = safeJsonParse(readFileSync(ptrPath, "utf-8"))
        if (ptrData?.contentHash) {
          resolvedHash = ptrData.contentHash
          const rSessionPath = join(sessionDir, `${resolvedHash}.txt`)
          fullPath = existsSync(rSessionPath) ? rSessionPath : null
        }
      } catch {}
    }
    if (!fullPath) {
      const recent = scanRecentScratchpad(sessionDir, titleCase, 2000)
      if (recent) return recent
      return null
    }
  }
  try {
    const st = statSync(fullPath)
    const ageSec = (Date.now() - st.mtimeMs) / 1000
    if (ageSec > SCRATCHPAD_MAX_AGE_SEC) return null
    const summaryPath = join(sessionDir, `${hash}.summary.txt`)
    const finalSummary = existsSync(summaryPath) ? summaryPath : null
    return {
      hash, fullPath, sizeBytes: st.size, ageSec: Math.round(ageSec),
      summaryPath: finalSummary,
    }
  } catch { return null }
}

function recordScratchpadObservation(toolLower: string, args: any, fileSize: number, meta: any = {}): void {
  if (!SCRATCHPAD_TOOLS.has(toolLower)) return
  try {
    const titleCase = TOOL_NAME_NORMALIZE[toolLower]
    const inputJson = stableJson(args ?? {})
    const hash = createHash("sha256").update(`${titleCase}\n${inputJson}\n`).digest("hex").slice(0, 16)
    const dedupeKey = `${toolLower}:${hash}`
    if (scratchpadHitsSeen.has(dedupeKey)) return
    scratchpadHitsSeen.add(dedupeKey)
    indexAppend(hash, toolLower, fileSize, { ...meta, input: inputJson.slice(0, 200) })
  } catch {}
}

// ── Scratchpad decadence pruning ──────────────────────────────────────────
function _pruneScratchpadDir(targetDir: string, opts: { maxFiles?: number, maxBytes?: number, rotate?: boolean } = {}): { dataFiles: number, totalBytes: number, deleted: number, rotated: number } {
  const { maxFiles = MAX_SCRATCHPAD_FILES, maxBytes = MAX_SCRATCHPAD_BYTES, rotate = true } = opts
  const now = Date.now()
  if (!existsSync(targetDir)) return { dataFiles: 0, totalBytes: 0, deleted: 0, rotated: 0 }
  const entries = readdirSync(targetDir)
  let dataFiles = 0; let totalBytes = 0; let deleted = 0; let rotated = 0
  for (const entry of entries) {
    if (entry.endsWith(".meta.json") || entry.endsWith(".summary.txt")) continue
    const fullPath = join(targetDir, entry)
    let st: any
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
        writeFileSync(summaryPath, content.slice(0, SUMMARY_HEAD_TRUNCATE).replace(/\n+/g, " ").trim() + (content.length > SUMMARY_HEAD_TRUNCATE ? "…" : ""))
      } catch {}
      const head = _readHead(fullPath)
      if (!head.includes("[warm-storage]") && !head.includes("[cold-storage]")) try {
        writeFileSync(fullPath, `[warm-storage] ${st.size}B original at ${hash}.summary.txt`)
        rotated++
      } catch {}
    }
  }
  return { dataFiles, totalBytes, deleted, rotated }
}

function runDecadenceCycle(): void {
  const now = Date.now()
  if (now - _lastDecadenceRun < DECADENCE_THROTTLE_MS) return
  _lastDecadenceRun = now
  try {
    const sessionDir = getSessionScratchpadDir()
    _pruneScratchpadDir(sessionDir, { maxFiles: MAX_SESSION_SCRATCHPAD_FILES, maxBytes: MAX_SESSION_SCRATCHPAD_BYTES, rotate: true })
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
        console.error(`[vibeOS] session-decadence: deleted=${ses.deleted} (${ses.dataFiles} files, ${Math.round(ses.totalBytes / 1024)}KB)`)
      }
    } catch (err) {
      console.error(`[vibeOS] session decadence error: ${err.message}`)
    }
  }
}

// ── Cleanup stale session scratchpads ──────────────────────────────────────
function cleanupStaleSessionScratchpads(): void {
  try {
    if (!existsSync(SCRATCHPAD_SESSIONS_DIR)) return
    const dirs = readdirSync(SCRATCHPAD_SESSIONS_DIR)
    const now = Date.now()
    for (const d of dirs) {
      const full = join(SCRATCHPAD_SESSIONS_DIR, d)
      try {
        const st = statSync(full)
        if (now - st.mtimeMs > SCRATCHPAD_SESSION_TTL_MS) {
          rmSync(full, { recursive: true, force: true })
        }
      } catch {}
    }
  } catch {}
}

// ── Plugin scratchpad prune ───────────────────────────────────────────────
function pruneScratchpadOnce(): void {
  if (prunedThisProcess) return
  prunedThisProcess = true
  try {
    const script = join(VIBEOS_HOME, "hooks/scratchpad-prune.sh")
    if (existsSync(script)) {
      const child = spawn("bash", [script], { detached: true, stdio: "ignore" })
      child.unref()
    }
  } catch { /* prune is best-effort */ }
  cleanupStaleSessionScratchpads()
}

// ── Active jobs ──────────────────────────────────────────────────────
function loadActiveJobs(): any {
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

function getActiveJobForProject(fp: string = currentProjectFingerprint): any {
  if (!fp) return null
  const jobs = loadActiveJobs()
  const job = jobs[fp]
  if (!job || typeof job !== "object") return null
  return job
}

function saveActiveJobForProject(job: any, fp: string = currentProjectFingerprint): void {
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

function saveJobRecord(jobId: string, record: any): void {
  try {
    const jobs = loadActiveJobs()
    jobs[jobId] = record
    mkdirSync(dirname(ACTIVE_JOBS_FILE), { recursive: true })
    const tmp = ACTIVE_JOBS_FILE + ".tmp"
    writeFileSync(tmp, JSON.stringify(jobs, null, 2))
    renameSync(tmp, ACTIVE_JOBS_FILE)
  } catch {}
}

function loadJobRecord(jobId: string): any {
  try {
    const jobs = loadActiveJobs()
    return jobs[jobId] || null
  } catch { return null }
}

// ── Project memory ───────────────────────────────────────────────────
function projectFingerprint(dir: string): string {
  if (!dir) return "unknown"
  return createHash("sha256").update(dir).digest("hex").slice(0, 12)
}

function loadProjectState(): any {
  const projectStateFile = join(getVibeOSHome(), "project-states.json")
  try {
    const state = readJsonOrEmpty(projectStateFile)
    if (state && typeof state === "object") {
      state.project_hashes ??= {}
      return state
    }
  } catch {}
  return { project_hashes: {} }
}

function saveProjectState(state: any): void {
  const projectStateFile = join(getVibeOSHome(), "project-states.json")
  try {
    withFileLock(projectStateFile, () => {
      mkdirSync(dirname(projectStateFile), { recursive: true })
      const _tmp = projectStateFile + ".tmp." + Date.now()
      writeFileSync(_tmp, JSON.stringify(state, null, 2) + "\n", "utf-8")
      renameSync(_tmp, projectStateFile)
    })
  } catch (err) {
    console.error(`[vibeOS] project state write failed: ${err.message}`)
  }
}

function ensureProjectBucket(state: any, fp: string): any {
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

// ── Tech stack detection ─────────────────────────────────────────────
function detectTechStack(dir: string): string[] {
  const stacks: string[] = []
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

// ── Pattern learning ─────────────────────────────────────────────────
function promotedProjectPatterns(fp: string): any[] {
  try {
    const p = loadProjectState().project_hashes?.[fp]
    const out: any[] = []
    const collect = (rows: any, label: string) => {
      for (const row of Object.values(rows || {})) {
        const r = row as any
        const sessions = new Set(r?.sessions || [])
        if (sessions.size >= 3) out.push({ label, summary: r.summary, sessions: sessions.size, lastSeen: r.lastSeen || "" })
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

function projectPatternRows(fp: string): any[] {
  try {
    const p = loadProjectState().project_hashes?.[fp]
    const rows: any[] = []
    for (const [kind, label] of [["friction", "friction"], ["routines", "routine"]]) {
      for (const [key, row] of Object.entries(p?.userPatterns?.[kind] || {})) {
        const r = row as any
        const sessions = new Set(r?.sessions || [])
        rows.push({
          key,
          label,
          summary: r?.summary || key,
          count: Number(r?.count || 0),
          sessions: sessions.size,
          lastSeen: r?.lastSeen || "",
        })
      }
    }
    rows.sort((a, b) => b.sessions - a.sessions || b.count - a.count || String(b.lastSeen).localeCompare(String(a.lastSeen)))
    return rows
  } catch {
    return []
  }
}

function clearProjectPatterns(fp: string): number {
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

// ── Log rotation helpers ──────────────────────────────────────────────
function _rotateLog(filePath: string, maxLines: number): void {
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

function getLastLines(filePath: string, n: number = 5, maxBytes: number = 1024): string[] {
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
    return lines.slice(-n).map((l: string) => l.trim())
  } catch { return [] }
}

function getLastLine(filePath: string): string {
  const lines = getLastLines(filePath, 1, 200)
  return lines[0] || ""
}

// ── Scrapbook index helpers ────────────────────────────────────────────────
interface ScrapbookIndexEntry {
  hash: string
  tool: string
  size: number
  ts: string
  session?: string
  [key: string]: any
}

function loadScrapbookIndex(): ScrapbookIndexEntry[] {
  try {
    const path = getGlobalIndexPath()
    if (!existsSync(path)) return []
    const raw = readFileSync(path, "utf-8")
    if (!raw.trim()) return []
    const entries: ScrapbookIndexEntry[] = []
    for (const line of raw.split("\n")) {
      const ln = line.trim()
      if (!ln) continue
      try {
        const rec = JSON.parse(ln)
        if (rec && typeof rec === "object" && rec.hash) entries.push(rec)
      } catch {}
    }
    return entries
  } catch { return [] }
}

function saveScrapbookIndex(index: ScrapbookIndexEntry[]): void {
  try {
    const path = getGlobalIndexPath()
    mkdirSync(dirname(path), { recursive: true })
    const tmp = path + ".tmp"
    writeFileSync(tmp, index.map(e => JSON.stringify(e)).join("\n") + "\n")
    renameSync(tmp, path)
  } catch {}
}

function _scanScrubpadDir(dir: string): ScrapbookIndexEntry[] {
  const entries: ScrapbookIndexEntry[] = []
  try {
    if (!existsSync(dir)) return entries
    const files = readdirSync(dir).filter((f: string) => f.endsWith(".txt") && !f.endsWith(".summary.txt"))
    for (const f of files) {
      const hash = f.replace(/\.txt$/, "")
      const full = join(dir, f)
      try {
        const st = statSync(full)
        const head = _readHead(full)
        entries.push({ hash, tool: "unknown", size: st.size, ts: new Date(st.mtimeMs).toISOString(), head: head.slice(0, 100) })
      } catch {}
    }
  } catch {}
  return entries
}

function rebuildScrapbookIndex(): ScrapbookIndexEntry[] {
  try {
    const sessionDir = getSessionScratchpadDir()
    const sessionEntries = _scanScrubpadDir(sessionDir)
    const index = Array.from(new Map(sessionEntries.map(e => [e.hash, e])).values())
    saveScrapbookIndex(index)
    return index
  } catch { return [] }
}

// ── Legacy aliases (backward compat) ──────────────────────────────────────
// These provide the interface the task requested even if the old code used
// different function names.
const STATE_FILE = DELEGATION_STATE_FILE
function recordDelegation(tool: string, saveEst: number, meta: any = {}): any {
  // Delegation savings are recorded via updateState
  // This wrapper provides the legacy interface expected by callers
  try {
    return updateState((s: any) => {
      const now = new Date().toISOString()
      const delta = Number(saveEst || 0)
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" }
      s.lifetime.total_savings_usd = roundUsd(Number(s.lifetime.total_savings_usd || 0) + delta)
      s.lifetime.last_updated = now
      s.sessions ??= {}
      const sid = _OC_SID
      s.sessions[sid] ??= { started: now, session_started_at: now, source: "opencode", tool_counts: {}, warns: [] }

      if (currentProjectFingerprint && !s.sessions[sid].project_fingerprint) s.sessions[sid].project_fingerprint = currentProjectFingerprint

      if (currentProjectName && !s.sessions[sid].project_name) s.sessions[sid].project_name = currentProjectName

      s.sessions[sid].total_savings_usd = roundUsd(Number(s.sessions[sid].total_savings_usd || 0) + delta)
      _pruneOldSessions(s)
      return s
    })
  } catch (err) {
    console.error(`[vibeOS] recordDelegation failed: ${err.message}`)
    return null
  }
}

function recordCacheSaving(tool: string, saveEst: number, meta: any = {}): any {
  try {
    const state = updateState((s: any) => {
      const now = new Date().toISOString()
      const delta = Number(saveEst || 0)
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" }
      s.lifetime.last_updated = now
      s.sessions ??= {}
      const sid = _OC_SID
      s.sessions[sid] ??= { started: now, session_started_at: now, source: "opencode", tool_counts: {}, warns: [] }
      if (currentProjectFingerprint && !s.sessions[sid].project_fingerprint) s.sessions[sid].project_fingerprint = currentProjectFingerprint
      if (currentProjectName && !s.sessions[sid].project_name) s.sessions[sid].project_name = currentProjectName
      s.sessions[sid].session_cache_dir = getSessionScratchpadDir()
      s.sessions[sid].tool_counts[tool] = (s.sessions[sid].tool_counts[tool] || 0) + 1
      if (meta?.hash) {
        s.sessions[sid].cache_hits ??= []
        if (!s.sessions[sid].cache_hits.some((h: any) => h.hash === meta.hash)) {
          s.sessions[sid].cache_hits.push({
            at: now,
            tool,
            hash: meta.hash,
            est_savings_usd: roundUsd(delta),
          })
          s.sessions[sid].cache_savings_usd = roundUsd(Number(s.sessions[sid].cache_savings_usd || 0) + delta)
          s.lifetime.cache_savings_usd = roundUsd(Number(s.lifetime.cache_savings_usd || 0) + delta)
          if (s.sessions[sid].cache_hits.length > 200) {
            console.error(`[vibeOS] session cache_hits truncated from ${s.sessions[sid].cache_hits.length} to 200 for ${sid}`)
            s.sessions[sid].cache_hits = s.sessions[sid].cache_hits.slice(-200)
          }
        }
      } else {
        s.sessions[sid].cache_savings_usd = roundUsd(Number(s.sessions[sid].cache_savings_usd || 0) + delta)
        s.lifetime.cache_savings_usd = roundUsd(Number(s.lifetime.cache_savings_usd || 0) + delta)
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
    return {
      lifetime: state?.lifetime?.cache_savings_usd || 0,
      session: state?.sessions?.[sid]?.cache_savings_usd || 0,
    }
  } catch (err) {
    console.error(`[vibeOS] cache state write failed: ${err.message}`)
    return null
  }
}

function recordMissedContext7(saveEst: number): any {
  try {
    const state = updateState((s: any) => {
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" }
      s.lifetime.missed_context7_usd = Math.round(
        ((s.lifetime.missed_context7_usd || 0) + saveEst) * 100,
      ) / 100
      s.sessions ??= {}
      const sid = _OC_SID
      s.sessions[sid] ??= { total_savings_usd: 0, cache_savings_usd: 0, project_name: "", warns: [], cache_hits: [], seenWarnKeys: {} }
      s.sessions[sid].context7_missed_usd = Math.round(
        ((s.sessions[sid].context7_missed_usd || 0) + saveEst) * 100,
      ) / 100
      return s
    })
    try {
      _ledgerBuffer.push(JSON.stringify({
        v: 2,
        at: new Date().toISOString(),
        kind: "context7",
        amount_usd: Number(saveEst || 0),
        sid: _OC_SID,
        tool: "context7",
        reason: "docs bypass",
      }) + "\n")
      if (_ledgerBuffer.length >= LEDGER_BUFFER_MAX) _flushLedgerBuffer()
      else if (!_ledgerBufferTimer) _ledgerBufferTimer = setTimeout(_flushLedgerBuffer, LEDGER_BUFFER_FLUSH_MS)
    } catch {}
    try {
      if (currentProjectFingerprint) {
        const pstate = loadProjectState()
        const bucket = ensureProjectBucket(pstate, currentProjectFingerprint)
        bucket.context7Bypasses = (bucket.context7Bypasses || 0) + 1
        bucket.lastSeen = new Date().toISOString()
        saveProjectState(pstate)
      }
    } catch {}
    try {
      updateGlobalLearning((gl: any) => {
        gl.context7_bypasses = Number(gl.context7_bypasses || 0) + 1
        gl.context7_missed_usd = Math.round((Number(gl.context7_missed_usd || 0) + Number(saveEst || 0)) * 100) / 100
        gl.context7_last_seen = new Date().toISOString()
        return gl
      })
    } catch {}
    return state?.lifetime?.missed_context7_usd ?? null
  } catch { return null }
}

// ── Todo entry type ──────────────────────────────────────────────────
type TodoEntry = {
  id: string
  content: string
  status: "pending" | "done" | "wontfix"
  filePath: string
  priority: "low" | "medium" | "high" | "critical"
  source: "manual" | "flow" | "intercepted"
  createdAt: string
  updatedAt: string
}

// ── Todo persistence ────────────────────────────────────────────────
function loadTodos(): TodoEntry[] {
  try {
    if (!existsSync(TODOS_FILE)) return []
    const raw = readFileSync(TODOS_FILE, "utf-8")
    const parsed = safeJsonParse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function saveTodos(todos: TodoEntry[]): void {
  try {
    mkdirSync(dirname(TODOS_FILE), { recursive: true })
    const tmp = TODOS_FILE + ".tmp." + Date.now()
    writeFileSync(tmp, JSON.stringify(todos, null, 2), "utf-8")
    renameSync(tmp, TODOS_FILE)
  } catch {}
}

function upsertTodo(entry: Partial<TodoEntry> & { content: string }): void {
  const todos = loadTodos()
  const existing = todos.findIndex(t =>
    t.content === entry.content &&
    (entry.filePath ? t.filePath === entry.filePath : true),
  )
  const newEntry: TodoEntry = {
    id: entry.id || crypto.randomUUID?.() || "todo-" + Date.now(),
    content: entry.content,
    status: (entry.status as TodoEntry["status"]) || "pending",
    filePath: entry.filePath || "",
    priority: (entry.priority as TodoEntry["priority"]) || "medium",
    source: (entry.source as TodoEntry["source"]) || "manual",
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  if (existing >= 0) {
    todos[existing] = { ...todos[existing], ...newEntry, updatedAt: new Date().toISOString() }
  } else {
    todos.push(newEntry)
  }
  saveTodos(todos)
}

function markTodoDone(id: string): void {
  const todos = loadTodos()
  const found = todos.find(t => t.id === id)
  if (found) { found.status = "done"; found.updatedAt = new Date().toISOString(); saveTodos(todos) }
}

function getTodos(): TodoEntry[] {
  return loadTodos()
}

// ── Savings ledger reconciliation ────────────────────────────────────
function readLedgerTotals(): { delegation: number, cache: number, context7: number, total: number, entries: number } {
  const empty = { delegation: 0, cache: 0, context7: 0, total: 0, entries: 0 }
  try {
    if (!existsSync(SAVINGS_LEDGER_FILE)) return empty
    const raw = readFileSync(SAVINGS_LEDGER_FILE, "utf-8")
    if (!raw.trim()) return empty
    let delegation = 0
    let cache = 0
    let context7 = 0
    let entries = 0
    for (const line of raw.split("\n")) {
      const ln = line.trim()
      if (!ln) continue
      let rec: any = null
      try { rec = JSON.parse(ln) } catch { continue }
      if (!rec || typeof rec !== "object") continue
      if (rec.v !== undefined && rec.v !== 2) continue
      const amt = Number(rec.amount_usd ?? rec.est_savings_usd ?? rec.savings_usd ?? rec.usd ?? 0)
      if (!Number.isFinite(amt) || amt <= 0) continue
      entries += 1
      const kind = String(rec.kind || rec.type || rec.category || rec.source || "").toLowerCase()
      if (kind.includes("cache")) cache += amt
      else if (kind.includes("context7")) context7 += amt
      else delegation += amt
    }
    const total = delegation + cache
    return {
      delegation: Math.round(delegation * 1000) / 1000,
      cache: Math.round(cache * 1000) / 1000,
      context7: Math.round(context7 * 1000) / 1000,
      total: Math.round(total * 1000) / 1000,
      entries,
    }
  } catch {
    return empty
  }
}

function reconcileStateFromLedger(): void {
  try {
    const ledgerMtime = existsSync(SAVINGS_LEDGER_FILE) ? statSync(SAVINGS_LEDGER_FILE).mtimeMs : 0
    if (ledgerMtime === _ledgerReconciledMtime) return
    _ledgerReconciledMtime = ledgerMtime
    _flushLedgerBuffer()
    const l = readLedgerTotals()
    if (l.total <= 0 && l.context7 <= 0) return
    const delegationStateFile = join(getVibeOSHome(), "delegation-state.json")
    const state = readJsonOrEmpty(delegationStateFile)
    const stDelegation = Number(state?.lifetime?.est_savings_usd ?? state?.lifetime?.total_savings_usd ?? 0)
    const stCache = Number(state?.lifetime?.cache_savings_usd ?? 0)
    const stMissedC7 = Number(state?.lifetime?.missed_context7_usd ?? 0)
    const stTotal = (Number.isFinite(stDelegation) ? stDelegation : 0) + (Number.isFinite(stCache) ? stCache : 0)
    if (Math.abs(stTotal - l.total) < 0.0005 && Math.abs(stMissedC7 - l.context7) < 0.0005) return
    updateState((s: any) => {
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" }
      s.lifetime.total_savings_usd = Math.max(l.delegation, stDelegation)
      s.lifetime.cache_savings_usd = Math.max(l.cache, stCache)
      s.lifetime.missed_context7_usd = Math.max(l.context7, stMissedC7)
      s.lifetime.last_updated = new Date().toISOString()
      s.lifetime.rebuilt_from_ledger = true
      s.lifetime.ledger_entries_reconciled = l.entries
      return s
    })
    invalidateSavingsCache()
  } catch {}
}

function readLifetimeSavings(): any {
  const empty = { ltTasks: 0, ltCache: 0, ltCost: 0, count: 0, scratchpadHits: 0, missedC7: 0, sesTasks: 0, sesEdit: 0, sesCredit: 0, sesC7: 0, sesQuota: 0, sesTaskDelegations: 0, sesDuration: 0, sesRatePerHour: 0, sesTrend: "stable", sesToolBreakdown: {}, sesModelTurns: { brain: 0, worker: 0 }, quality_avg: 0, telemetry: readTelemetrySummary({}, _OC_SID) }
  try {
    reconcileStateFromLedger()
    const delegationStateFile = join(getVibeOSHome(), "delegation-state.json")
    if (!existsSync(delegationStateFile)) return empty
    const mtime = statSync(delegationStateFile).mtimeMs
    if (_savingsCache && mtime === _savingsCacheMtime) return _savingsCache
    const s = safeJsonParse(readFileSync(delegationStateFile, "utf-8"))
    _savingsCache = { ..._computeSessionMetrics(s, _OC_SID), telemetry: readTelemetrySummary(s, _OC_SID) }
    _savingsCacheMtime = mtime
    return _savingsCache
  } catch { return empty }
}

function readPackageVersion(): string {
  try {
    const pkg = safeJsonParse(readFileSync(join(process.cwd(), "package.json"), "utf-8"))
    return String(pkg?.version || "")
  } catch { return "" }
}

function saveSessionCheckpoint(): void {
  try {
    const state = readFullState()
    const session = state.sessions?.[_OC_SID]
    if (!session) return
    const cp = {
      session_id: _OC_SID,
      ts: new Date().toISOString(),
      cost: session.cost_usd || 0,
      cache_savings: session.cache_savings_usd || 0,
      total_savings: session.total_savings_usd || 0,
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

// ── Export ───────────────────────────────────────────────────────────
export {
  // File system constants
  VIBEOS_HOME,
  OPENCODE_HOME,
  USER_HOME,
  FILE_LOCK_DIR,
  DELEGATION_STATE_FILE as DELEGATION_STATE_FILE,
  SAVINGS_LEDGER_FILE,
  GLOBAL_LEARNING_FILE,
  PRICING_CACHE_FILE,
  BLACKBOX_STATE_FILE,
  PROJECT_STATE_FILE,
  TIERS_FILE,
  ACTIVE_JOBS_FILE,
  FLOW_TODO_QUEUE_FILE,
  FLOW_DEDUP_FILE,
  ENFORCEMENT_COOLDOWN_FILE,
  TODOS_FILE,
  AUTH_F,
  CREDIT_CACHE_F,
  REPORTS_DIR,
  CONTEXT7_INSTALL_FLAG,
  TRINITY_OPENCODE_CONFIG,
  TRINITY_OPENCODE_CONFIGC,
  STATE_FILE,

  // Scratchpad paths
  SCRATCHPAD_ROOT,
  SCRATCHPAD_GLOBAL_DIR,
  SCRATCHPAD_SESSIONS_DIR,
  SCRATCHPAD_SESSION_TTL_MS,
  SCRATCHPAD_MAX_AGE_SEC,
  MAX_SCRATCHPAD_FILES,
  MAX_SCRATCHPAD_BYTES,
  MAX_SESSION_SCRATCHPAD_FILES,
  MAX_SESSION_SCRATCHPAD_BYTES,
  DECADENCE_FRESH_MS,
  DECADENCE_WARM_MS,
  DECADENCE_COLD_MS,
  DECADENCE_EXPIRE_MS,
  DECADENCE_THROTTLE_MS,
  DECADENCE_GLOBAL_THROTTLE_MS,
  TOOL_NAME_NORMALIZE,
  SCRATCHPAD_TOOLS,

  // Warning constants
  WARN_DEDUPE_WINDOW_MS,
  WARN_MAX_PER_SESSION,
  WARN_COALESCE_THRESHOLD,
  MAX_LOG_LINES,
  SOFT_QUOTA_LIMIT,

  // Session identity
  _OC_SID,
  getOcSessionId,
  getSessionTimer,

  // Tool helper
  tool,
  _zType,

  // Module state
  currentTier,
  currentModel,
  currentProjectFingerprint,
  currentProjectName,
  setCurrentTier,
  setCurrentModel,
  setCurrentProjectFingerprint,
  setCurrentProjectName,
  textCompletePainted,
  softQuotaCounts,
  warnLogThrottle,
  recentToolEvents,
  frictionSessionKeys,
  routineSessionKeys,
  lastMutationEvent, setLastMutationEvent,
  warnPerSession,
  warnCoalesceCounters,
  enforcementBlocked,
  taskSlotRestore,
  pendingUiNote,
  briefedProjects,
  testReminderSeen,
  context7AlertedThisSession,
  _sessionCleanupRegistered,
  _sessionCacheCleaned,
  prunedThisProcess,
  _lastDecadenceRun,
  _lastGlobalDecadenceRun,
  _patternFiredKeys,

  // Savings cache
  _savingsCache,
  _savingsCacheMtime,
  _ledgerReconciledMtime,
  _lastLogRotated,

  // ML Router state
  _mlGraph,
  _cacheDb,
  ML_ENABLED,
  ML_CONFIDENCE_THRESHOLD,
  _mlSavePending,
  loadMLState,
  saveMLState,

  // Tier regexes
  FALLBACK_HIGH,
  FALLBACK_MID,
  HIGH_TIER_RE,
  MID_TIER_RE,
  loadTierRegexes,

  // Selection
  DFLT_SEL,
  loadSelection,
  writeSelection,

  // Global learning
  DFLT_GL,
  loadGlobalLearning,
  updateGlobalLearning,
  getLearnedExploratoryWords,

  // Blackbox state
  _blackboxTracker,
  _blackboxEnabled,
  _latestBlackboxState,
  _latestBlackboxLoopMsg,
  _latestBlackboxPivotMsg,
  _modelLocked,
  _lockedSlot,
  _lockedModel,
  _detectedFramework,

  // JSONC parsing
  safeJsonParse,

  // State management
  validateState,
  readJsonOrEmpty,
  updateState,
  readFullState,
  writeFullState,
  withFileLock,
  _lockPathFor,
  _handleStateCorruption,

  // Session scratchpad
  getSessionRoot,
  getSessionScratchpadDir,
  getSessionIndexPath,
  getGlobalIndexPath,
  ensureSessionScratchpadDirs,
  safeCopyIntoSession,
  cleanupCurrentSessionScratchpad,
  registerSessionCleanupHandlers,

  // Ledger buffer
  LEDGER_BUFFER_MAX,
  LEDGER_BUFFER_FLUSH_MS,
  _ledgerBuffer,
  _ledgerBufferTimer,
  _flushLedgerBuffer,
  recordSavingsLedgerEntry,
  loadSavingsLedger,

  // Stable JSON
  stableJson,
  _readHead,
  indexAppend,

  // Scratchpad hits
  scratchpadHitsSeen,
  scanRecentScratchpad,
  getScratchpadHit,
  recordScratchpadObservation,
  _pruneScratchpadDir,
  runDecadenceCycle,
  applyDecadence,
  cleanupStaleSessionScratchpads,
  pruneScratchpadOnce,

  // Active jobs
  loadActiveJobs,
  getActiveJobForProject,
  saveActiveJobForProject,
  saveJobRecord,
  loadJobRecord,

  // Project memory
  projectFingerprint,
  loadProjectState,
  saveProjectState,
  ensureProjectBucket,
  mergeProjectBucket,
  detectTechStack,

  // Pattern learning
  promotedProjectPatterns,
  projectPatternRows,
  clearProjectPatterns,

  // Log rotation
  _rotateLog,
  getLastLines,
  getLastLine,

  // Scrapbook index
  loadScrapbookIndex,
  saveScrapbookIndex,
  rebuildScrapbookIndex,

  // Savings operations
  roundUsd,
  recordDelegation,
  recordCacheSaving,
  recordMissedContext7,
  loadTodos,
  saveTodos,
  upsertTodo,
  markTodoDone,
  getTodos,
  readLedgerTotals,
  reconcileStateFromLedger,
  readLifetimeSavings,
  recordPrivacyTelemetry,
  readTelemetrySummary,
  readPackageVersion,
  saveSessionCheckpoint,

  // Blackbox state functions
  loadBlackboxState,
  saveBlackboxState,
  getBlackboxTracker,
  getBlackboxResolution,

  // Status/savings payload — re-exported from index.ts at runtime.
  // These satisfy ESM import in index.ts before its own inline definitions shadow them.
  computeStatusPayload,
  computeSavingsPayload,
  computeSessionCheckout,
  diagnoseStructuredFromText,
  projectStructuredFromText,
  loadMcpPort,
  persistMcpPort,
}

// ── Status / Savings Payload Stubs ────────────────────────────────────
// These are defined inline in index.ts but imported from state.js.
// The import in index.ts evaluates first; index.ts then shadows with its own definitions.
// These stubs throw if index.ts is not loaded (isolated module test).
export function computeStatusPayload() { throw new Error("computeStatusPayload not initialized — import from index.ts") }
export function computeSavingsPayload() { throw new Error("computeSavingsPayload not initialized — import from index.ts") }
export function computeSessionCheckout() { throw new Error("computeSessionCheckout not initialized — import from index.ts") }
export function diagnoseStructuredFromText(raw: any) { throw new Error("diagnoseStructuredFromText not initialized — import from index.ts") }
export function projectStructuredFromText(raw: any) { throw new Error("projectStructuredFromText not initialized — import from index.ts") }
export function loadMcpPort(): number { throw new Error("loadMcpPort not initialized — import from index.ts") }
export function persistMcpPort(port: number): void { throw new Error("persistMcpPort not initialized — import from index.ts") }
