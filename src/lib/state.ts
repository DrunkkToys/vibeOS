// @ts-nocheck
// DOC: Flattened from state/global-learning.ts, state/todos.ts, state/project-memory.ts
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, readdirSync, openSync, readSync, closeSync, rmSync, copyFileSync, renameSync } from "node:fs"
import { join, dirname, basename, isAbsolute } from "node:path"
import { createHash } from "node:crypto"
import { loadSelection, writeSelection, DFLT_SEL } from "./selection-manager.js"
import { reconcileStickyLoopState } from "./loop-state.js"
import { mergeProjectBucket, _computeSessionMetrics, _pruneOldSessions } from "./pattern-helpers.js"
import { getOcSessionId, setOcSessionId } from "./runtime-state.js"
import { safeJsonParse, appendJsonlWithRotation } from "../utils/fs-helpers.js"
import { USER_HOME, getVibeOSHome as runtimeGetVibeOSHome, getOpenCodeHome as runtimeGetOpenCodeHome, getOpenCodeHomes as runtimeGetOpenCodeHomes, resolveVibeOSHome, resolveOpenCodeHome, setVibeOSHomeContext as runtimeSetVibeOSHomeContext } from "./runtime-paths.js"
import {
  getSessionRoot,
  getSessionScratchpadDir,
  getSessionIndexPath,
  getGlobalIndexPath,
  ensureSessionScratchpadDirs,
  safeCopyIntoSession,
  cleanupCurrentSessionScratchpad,
  indexAppend,
  scratchpadHitsSeen,
  scanRecentScratchpad,
  getScratchpadHit,
  recordScratchpadObservation,
  _pruneScratchpadDir,
  runDecadenceCycle,
  applyDecadence,
  cleanupStaleSessionScratchpads,
  pruneScratchpadOnce,
  _sessionCacheCleaned,
  prunedThisProcess,
  _lastDecadenceRun,
  loadScrapbookIndex,
  saveScrapbookIndex,
  rebuildScrapbookIndex,
} from "./state/scratchpad-cache.js"

// ── Global Learning (inlined from state/global-learning.ts) ──

export function loadGlobalLearning(): unknown {
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

const MAX_LEXICON_WORDS = 2000

function _capLexiconMap(map: unknown, max: number): boolean {
  if (!map || typeof map !== "object") return false
  const entries = Object.entries(map)
  if (entries.length <= max) return false
  entries.sort((a, b) => {
    const av = Date.parse(String((a[1] as unknown)?.lastSeen || "")) || 0
    const bv = Date.parse(String((b[1] as unknown)?.lastSeen || "")) || 0
    return bv - av
  })
  let changed = false
  for (const [key] of entries.slice(max)) {
    delete (map as Record<string, unknown>)[key]
    changed = true
  }
  return changed
}

export function updateGlobalLearning(mutator: (gl: unknown) => unknown): unknown {
  const globalLearningFile = join(getVibeOSHome(), "global-learning.json")
  return withFileLock(globalLearningFile, () => {
    const s = loadGlobalLearning()
    const next = mutator(s) ?? s
    _capLexiconMap((next as unknown)?.exploratory_words, MAX_LEXICON_WORDS)
    _capLexiconMap((next as unknown)?.task_first_words, MAX_LEXICON_WORDS)
    next.updatedAt = new Date().toISOString()
    mkdirSync(dirname(globalLearningFile), { recursive: true })
    const tmp = globalLearningFile + ".tmp"
    writeFileSync(tmp, JSON.stringify(next, null, 2))
    renameSync(tmp, globalLearningFile)
    return next
  })
}

export function getLearnedExploratoryWords(): Set<string> {
  const out = new Set<string>()
  try {
    const gl = loadGlobalLearning()
    for (const [w, meta] of Object.entries(gl.exploratory_words || {})) {
      if ((meta as unknown)?.count >= 1) out.add(String(w))
    }
  } catch {}
  return out
}

// ── Todos persistence (inlined from state/todos.ts) ──

type TodoEntry = {
  id: string
  content: string
  status: "pending" | "done" | "wontfix"
  filePath: string
  priority: "low" | "medium" | "high" | "critical"
  source: "manual" | "flow" | "intercepted"
  createdAt: string
  updatedAt: string
  projectFingerprint?: string
}

function getTodosFile(): string { return join(getVibeOSHome(), "todos.json") }

export function loadTodos(): TodoEntry[] {
  try {
    const todosFile = getTodosFile()
    if (!existsSync(todosFile)) return []
    const raw = readFileSync(todosFile, "utf-8")
    const parsed = safeJsonParse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

// todos.json is a single global file with no project scoping -- entries from
// every project ever used with vibeOS accumulate together forever (confirmed
// live: 1609 pending todos in one project's session, most from unrelated
// repos, none from the current project). Scope the default view to the
// current project; legacy entries with no projectFingerprint at all (written
// before this field existed) are excluded from the scoped view since they
// can't be attributed to any specific project.
export function loadTodosForCurrentProject(): TodoEntry[] {
  const fp = currentProjectFingerprint
  if (!fp) return loadTodos()
  return loadTodos().filter((t) => t.projectFingerprint === fp)
}

export function saveTodos(todos: TodoEntry[]): void {
  try {
    const todosFile = getTodosFile()
    mkdirSync(dirname(todosFile), { recursive: true })
    const tmp = todosFile + ".tmp." + Date.now()
    writeFileSync(tmp, JSON.stringify(todos, null, 2), "utf-8")
    renameSync(tmp, todosFile)
  } catch {}
}

export function upsertTodo(entry: Partial<TodoEntry> & { content: string }): void {
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
    projectFingerprint: entry.projectFingerprint || currentProjectFingerprint || undefined,
  }
  if (existing >= 0) {
    todos[existing] = { ...todos[existing], ...newEntry, updatedAt: new Date().toISOString() }
  } else {
    todos.push(newEntry)
  }
  saveTodos(todos)
}

export function markTodoDone(id: string): void {
  const todos = loadTodos()
  const found = todos.find(t => t.id === id)
  if (found) { found.status = "done"; found.updatedAt = new Date().toISOString(); saveTodos(todos) }
}

export function getTodos(): TodoEntry[] {
  return loadTodos()
}

// ── Project Memory (inlined from state/project-memory.ts) ──

export function projectFingerprint(dir: string): string {
  if (!dir) return "unknown"
  return createHash("sha256").update(dir).digest("hex").slice(0, 12)
}

export function loadProjectState(): unknown {
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

export function saveProjectState(state: unknown): void {
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

// ── Tech stack detection ─────────────────────────────────────────────
export function detectTechStack(dir: string): string[] {
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

export function ensureProjectBucket(state: unknown, fp: string): unknown {
  state.project_hashes ??= {}
  if (!state.project_hashes[fp]) {
    state.project_hashes[fp] = {
      totalSessions: 0,
      researchChains: 0,
      context7Bypasses: 0,
      commonTopics: [],
      sessions: [],
      reports: [],
      updatedAt: null,
      lastSeen: null,
      techStack: detectTechStack(process.cwd()),
    }
  }
  return state.project_hashes[fp]
}

export function touchProjectBucket(state: unknown, fp: string, meta: { sessionId?: string; reportId?: string; topic?: string; projectName?: string } = {}): unknown {
  if (!fp || fp === "unknown") return null
  const bucket = ensureProjectBucket(state, fp)
  const now = new Date().toISOString()
  bucket.updatedAt = now
  bucket.lastSeen = now
  if (typeof meta.projectName === "string" && meta.projectName.trim()) {
    bucket.projectName = meta.projectName.trim()
  }
  if (typeof meta.sessionId === "string" && meta.sessionId.trim()) {
    bucket.sessions ??= []
    if (!bucket.sessions.includes(meta.sessionId)) {
      bucket.sessions.push(meta.sessionId)
      bucket.sessions = bucket.sessions.slice(-30)
      bucket.totalSessions = Number(bucket.totalSessions || 0) + 1
    }
    bucket.totalSessions = Math.max(Number(bucket.totalSessions || 0), bucket.sessions.length, 1)
  }
  if (typeof meta.reportId === "string" && meta.reportId.trim()) {
    bucket.reports ??= []
    if (!bucket.reports.includes(meta.reportId)) {
      bucket.reports.push(meta.reportId)
      bucket.reports = bucket.reports.slice(-50)
    }
  }
  if (typeof meta.topic === "string" && meta.topic.trim()) {
    bucket.commonTopics ??= []
    if (!bucket.commonTopics.includes(meta.topic)) {
      bucket.commonTopics.push(meta.topic)
      bucket.commonTopics = bucket.commonTopics.slice(-20)
    }
  }
  return bucket
}

// ── Pattern learning ─────────────────────────────────────────────────
export function promotedProjectPatterns(fp: string): unknown[] {
  try {
    const p = loadProjectState().project_hashes?.[fp]
    const out: unknown[] = []
    const collect = (rows: unknown, label: string) => {
      for (const row of Object.values(rows || {})) {
        const r = row as unknown
        const sessions = new Set(r?.sessions || [])
        const minSessions = label === "routine" ? 2 : 3
        if (sessions.size >= minSessions) out.push({ label, summary: r.summary, sessions: sessions.size, lastSeen: r.lastSeen || "" })
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

export function projectPatternRows(fp: string): unknown[] {
  try {
    const p = loadProjectState().project_hashes?.[fp]
    const rows: unknown[] = []
    for (const [kind, label] of [["friction", "friction"], ["routines", "routine"]]) {
      for (const [key, row] of Object.entries(p?.userPatterns?.[kind] || {})) {
        const r = row as unknown
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

export function clearProjectPatterns(fp: string): number {
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

type AnyObject = Record<string, any>

// ── Delegation-state contract ────────────────────────────────────────
// The real shape of delegation-state.json. Known fields are typed; the index
// signature carries the dynamic tail (per-session bookkeeping that varies by
// feature) without falling back to `any`.
export interface SessionWarn {
  key?: string
  reason?: string
  saveEst?: number
  est_savings_usd?: number
  firstWord?: string
  ts?: number
  count?: number
  tool?: string
}
export interface SessionCacheHit {
  at: number
  tool: string
  hash: string
  est_savings_usd: number
}
export interface StressSample { ts: string; score: number; level: string }
export interface SessionRecord {
  total_savings_usd?: number
  cache_savings_usd?: number
  cost_usd?: number
  project_name?: string
  project_fingerprint?: string
  warns?: SessionWarn[]
  cache_hits?: SessionCacheHit[]
  seenWarnKeys?: Record<string, boolean>
  stress_history?: StressSample[]
  maxSessionStress?: number
  avgSessionStress?: number
  last_reason?: string
  last_save_est?: number
  started?: string
  active_slot?: string
  n_interactions?: number
  [key: string]: unknown
}
export interface LifetimeTotals {
  total_savings_usd: number
  cache_savings_usd: number
  missed_context7_usd: number
  session_count: number
  warn_count: number
}
export interface DelegationState {
  sessions?: Record<string, SessionRecord>
  lifetime?: LifetimeTotals
  last_updated?: string
  _gen?: number
  [key: string]: unknown
}

// ── File system constants ────────────────────────────────────────────
let VIBEOS_HOME = resolveVibeOSHome()
let OPENCODE_HOME = resolveOpenCodeHome()
let FILE_LOCK_DIR = join(VIBEOS_HOME, ".vibeOS-locks")
let DELEGATION_STATE_FILE = join(VIBEOS_HOME, "delegation-state.json")
let SAVINGS_LEDGER_FILE = join(VIBEOS_HOME, "savings-ledger.jsonl")
let GLOBAL_LEARNING_FILE = join(VIBEOS_HOME, "global-learning.json")
let PRICING_CACHE_FILE = join(VIBEOS_HOME, "model-pricing-cache.json")
let BLACKBOX_STATE_FILE = join(VIBEOS_HOME, "blackbox-state.json")
let PROJECT_STATE_FILE = join(VIBEOS_HOME, "project-states.json")
let TIERS_FILE = join(VIBEOS_HOME, "model-tiers.json")
let ACTIVE_JOBS_FILE = join(VIBEOS_HOME, "active-jobs.json")
const AUTH_F = join(USER_HOME, ".local", "share", "opencode", "auth.json")
let CREDIT_CACHE_F = join(VIBEOS_HOME, "credit-snapshot.json")
let FLOW_TODO_QUEUE_FILE = join(VIBEOS_HOME, ".flow-todo-queue.jsonl")
let FLOW_DEDUP_FILE = join(VIBEOS_HOME, ".flow-dedup-keys.json")
let ENFORCEMENT_COOLDOWN_FILE = join(VIBEOS_HOME, ".enforcement-cooldown.jsonl")
let TODOS_FILE = join(VIBEOS_HOME, "todos.json")
let REPORTS_DIR = join(VIBEOS_HOME, "reports")
let CONTEXT7_INSTALL_FLAG = join(VIBEOS_HOME, ".context7-install-suggested")
let TRINITY_OPENCODE_CONFIG = join(OPENCODE_HOME, "opencode.json")
let TRINITY_OPENCODE_CONFIGC = join(OPENCODE_HOME, "opencode.jsonc")

// ── Scratchpad paths ─────────────────────────────────────────────────
let SCRATCHPAD_ROOT = join(VIBEOS_HOME, "scratch")
let SCRATCHPAD_GLOBAL_DIR = join(SCRATCHPAD_ROOT, "by-hash")
let SCRATCHPAD_SESSIONS_DIR = join(SCRATCHPAD_ROOT, "sessions")
const SCRATCHPAD_SESSION_TTL_MS = 48 * 60 * 60 * 1000
const SCRATCHPAD_MAX_AGE_SEC = Number(process.env.CLAUDE_SCRATCHPAD_MAX_AGE_SEC || 86400)
const MAX_SCRATCHPAD_FILES  = 1000
const MAX_SCRATCHPAD_BYTES  = 10 * 1024 * 1024
const MAX_SESSION_SCRATCHPAD_FILES = 200
const MAX_SESSION_SCRATCHPAD_BYTES = 2 * 1024 * 1024
// The completion footer reads this state on its hot path. Keep it bounded so
// a long-lived desktop session cannot turn into multi-megabyte JSON parsing.
const MAX_BLACKBOX_SESSIONS = 30
const MAX_BLACKBOX_CONTROL_HISTORY = 25
const MAX_BLACKBOX_OUTCOME_HISTORY = 25
const MAX_BLACKBOX_EVENT_HISTORY = 50
const CORRUPTION_BACKUP_MAX = 5
const CORRUPTION_BACKUP_TTL_MS = 24 * 60 * 60 * 1000
const LEDGER_ROTATE_MAX_BYTES = 256 * 1024
const LEDGER_ROTATE_MAX_LINES = 10_000
const LEDGER_ROTATE_MAX_AGE_MS = 48 * 60 * 60 * 1000
const ACTIVE_JOBS_STALE_MS = 72 * 60 * 60 * 1000

export function getVibeOSHome(): string {
  return runtimeGetVibeOSHome()
}

export function getOpenCodeHome(): string {
  return runtimeGetOpenCodeHome()
}

export function getOpenCodeHomes(): string[] {
  return runtimeGetOpenCodeHomes()
}

function ensureCascadeAuditFiles(): void {
  try {
    const vibeHome = getVibeOSHome()
    if (!vibeHome || vibeHome === "undefined" || vibeHome.startsWith("undefined")) return
    const dir = join(vibeHome, "cascade-audit")
    mkdirSync(dir, { recursive: true })
    for (const file of ["claim-audit.jsonl", "cascade-audit.jsonl"]) {
      const path = join(dir, file)
      if (!existsSync(path)) {
        writeFileSync(path, "")
      }
    }
  } catch {}
}

ensureCascadeAuditFiles()

function syncVibeOSPathBindings(home = resolveVibeOSHome()): void {
  VIBEOS_HOME = home
  OPENCODE_HOME = resolveOpenCodeHome()
  FILE_LOCK_DIR = join(VIBEOS_HOME, ".vibeOS-locks")
  DELEGATION_STATE_FILE = join(VIBEOS_HOME, "delegation-state.json")
  SAVINGS_LEDGER_FILE = join(VIBEOS_HOME, "savings-ledger.jsonl")
  GLOBAL_LEARNING_FILE = join(VIBEOS_HOME, "global-learning.json")
  PRICING_CACHE_FILE = join(VIBEOS_HOME, "model-pricing-cache.json")
  BLACKBOX_STATE_FILE = join(VIBEOS_HOME, "blackbox-state.json")
  PROJECT_STATE_FILE = join(VIBEOS_HOME, "project-states.json")
  TIERS_FILE = join(VIBEOS_HOME, "model-tiers.json")
  ACTIVE_JOBS_FILE = join(VIBEOS_HOME, "active-jobs.json")
  CREDIT_CACHE_F = join(VIBEOS_HOME, "credit-snapshot.json")
  FLOW_TODO_QUEUE_FILE = join(VIBEOS_HOME, ".flow-todo-queue.jsonl")
  FLOW_DEDUP_FILE = join(VIBEOS_HOME, ".flow-dedup-keys.json")
  ENFORCEMENT_COOLDOWN_FILE = join(VIBEOS_HOME, ".enforcement-cooldown.jsonl")
  TODOS_FILE = join(VIBEOS_HOME, "todos.json")
  REPORTS_DIR = join(VIBEOS_HOME, "reports")
  CONTEXT7_INSTALL_FLAG = join(VIBEOS_HOME, ".context7-install-suggested")
  TRINITY_OPENCODE_CONFIG = join(OPENCODE_HOME, "opencode.json")
  TRINITY_OPENCODE_CONFIGC = join(OPENCODE_HOME, "opencode.jsonc")
  SCRATCHPAD_ROOT = join(VIBEOS_HOME, "scratch")
  SCRATCHPAD_GLOBAL_DIR = join(SCRATCHPAD_ROOT, "by-hash")
  SCRATCHPAD_SESSIONS_DIR = join(SCRATCHPAD_ROOT, "sessions")
}

export function setVibeOSHomeContext(home: string): void {
  // `String(home || "").trim() || resolveVibeOSHome()` accepted the literal
  // strings "undefined"/"null" — both truthy — and syncVibeOSPathBindings then
  // rebound every state file to `undefined/...`, relative to the user's project
  // directory. runtime-paths.ts (envPath) has always rejected them, so the two
  // resolvers disagreed: getVibeOSHome() returned the real home while the
  // exported bindings pointed at ./undefined. Observed live as an
  // `undefined/session-events/` tree written into a repo working tree.
  // Widened from the two literals to every relative path: both are resolved against
  // whichever cwd the writer has, so they split the state tree the same way. See
  // runtime-paths.ts envPath and tests/test_vibeos_home_relative_guard.test.mjs.
  const trimmed = String(home || "").trim()
  const resolved = (!trimmed || !isAbsolute(trimmed)) ? resolveVibeOSHome() : trimmed
  try {
    process.env.VIBEOS_HOME = resolved
  } catch {}
  runtimeSetVibeOSHomeContext(resolved)
  syncVibeOSPathBindings(resolved)
}

syncVibeOSPathBindings()

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
export let _OC_SID = getOcSessionId()
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
export function setCurrentSessionId(v: string) {
  currentSessionId = String(v || _OC_SID)
  // _OC_SID is a live module export read DIRECTLY (not via getCurrentSessionId())
  // by trackBlackbox (chat-transform.ts) and getBlackboxTracker (cascade.ts). Before
  // this fix only `currentSessionId` was updated here, so _OC_SID stayed pinned to
  // the per-process fallback id (getOcSessionId()) for the whole process lifetime --
  // live-reproduced: trackBlackbox kept writing real turn history under the stale
  // fallback key while recordLiveSessionSnapshot (which uses getCurrentSessionId())
  // wrote to the REAL session key, leaving every actual session's blackbox record
  // frozen at n_interactions=0 forever and the blackbox regime stuck at INIT.
  _OC_SID = currentSessionId
  // Keep the scratchpad cache's session scoping (getOcSessionId, read by
  // scratchpad-cache.ts's getSessionRoot()) in sync with the real conversation
  // identity -- otherwise it stays pinned to the stale per-process placeholder
  // set once at plugin init, and cache entries get scoped to the wrong session.
  setOcSessionId(currentSessionId)
}
export function getCurrentSessionId(): string { return currentSessionId || _OC_SID }
export function resetSessionId(sessionId: string): void {
  _OC_SID = String(sessionId || getOcSessionId())
  setOcSessionId(_OC_SID)
  currentSessionId = _OC_SID
}
const textCompletePainted = new Set()
const softQuotaCounts: Record<string, number> = {}

// ── Warning/coalescing state ─────────────────────────────────────────
const warnLogThrottle = new Map<string, number>()
const recentToolEvents: Array<{ tool: string, target: string, at: number }> = []
export function recordRecentToolEvent(tool: string, args: Record<string, unknown>): void {
  const a = args || {}
  const target = String(a.filePath || a.file_path || a.path || a.command || a.url || a.pattern || a.query || "")
  recentToolEvents.push({ tool: String(tool || ""), target, at: Date.now() })
  if (recentToolEvents.length > 20) recentToolEvents.shift()
}
const frictionSessionKeys = new Set<string>()
const routineSessionKeys = new Set<string>()
let lastMutationEvent: string | null = null
export function setLastMutationEvent(v: typeof lastMutationEvent) { lastMutationEvent = v }
const warnPerSession = new Map<string, number>()
const warnCoalesceCounters = new Map<string, number>()

// ── Savings cache (cross-process guard) ──────────────────────────────
let _savingsCache: unknown = null
let _savingsCacheMtime = 0
let _ledgerReconciledMtime = 0
let _ledgerTotalsCache = {
  mtime: 0,
  size: 0,
  delegation: 0,
  cache: 0,
  context7: 0,
  entries: 0,
}
const _liveSnapshotFingerprints = new Map<string, string>()

function invalidateSavingsCache(): void {
  _savingsCache = null
  _savingsCacheMtime = 0
}

// ── ML Router state ──────────────────────────────────────────────────
import { createCacheDatabase, evictStaleEntries, deserializeCacheDb } from "../vibeOS-lib/smart-cache.js"
import { applySessionAction, normalizeSessionOrchestration } from "./session-orchestrator.js"

let _cacheDb: unknown = createCacheDatabase()
const ML_ENABLED = true
const ML_CONFIDENCE_THRESHOLD = 0.6
let _mlSavePending = false
export function setMlSavePending(v: boolean) { _mlSavePending = v }

// ── Blackbox state ──────────────────────────────────────────────────
let _blackboxTracker: unknown = null
let _blackboxEnabled = true
export function setBlackboxEnabled(val: boolean) { _blackboxEnabled = val }
export let _modelLocked = false
export let _lockedSlot: string | null = null
export let _lockedModel: string | null = null
export function setModelLocked(val: boolean) { _modelLocked = !!val }
export function setLockedSlot(val: string | null) { _lockedSlot = val ? String(val) : null }
export function setLockedModel(val: string | null) { _lockedModel = val ? String(val) : null }
let _detectedFramework: string | null = null

// ── Log rotation mtime guard ─────────────────────────────────────────
let _lastLogRotated = 0

// ── Pattern learning state ──────────────────────────────────────────
const _patternFiredKeys = new Set<string>()

// ── One-shot flags ──────────────────────────────────────────────────
let context7AlertedThisSession = false
let _sessionCleanupRegistered = false
let _lastGlobalDecadenceRun = 0
let enforcementBlocked = false
let taskSlotRestore: unknown = null
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
function _zType(base: unknown): unknown {
  return Object.assign((...a: unknown[]) => _zType({ ...base, args: a }), {
    optional: () => _zType({ ...base, optional: true }),
    _isZod: true, _base: base,
  })
}
const tool: unknown = Object.assign((def: unknown) => def, {
  schema: {
    string: (o?: unknown) => _zType({ kind: "string", ...(o || {}) }),
    number: (o?: unknown) => _zType({ kind: "number", ...(o || {}) }),
    enum: (values: string[]) => _zType({ kind: "enum", values }),
  },
})

// ── State corruption handler ─────────────────────────────────────────
function _pruneCorruptionBackups(backupDir: string): void {
  try {
    if (!existsSync(backupDir)) return
    const now = Date.now()
    const backups = readdirSync(backupDir)
      .map((name) => {
        const path = join(backupDir, name)
        try {
          const st = statSync(path)
          return { name, path, mtimeMs: st.mtimeMs }
        } catch {
          return null
        }
      })
      .filter((entry): entry is { name: string, path: string, mtimeMs: number } => !!entry && entry.name.includes(".corrupted."))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
    const keep = new Set(backups.slice(0, CORRUPTION_BACKUP_MAX).map((b) => b.path))
    for (const backup of backups) {
      const isExpired = now - backup.mtimeMs > CORRUPTION_BACKUP_TTL_MS
      if (isExpired || !keep.has(backup.path)) {
        try { rmSync(backup.path, { force: true }) } catch {}
      }
    }
  } catch {}
}

let _startupMaintenanceHome = ""

const ORPHAN_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000

function _sessionHasActivity(session: unknown): boolean {
  if (!session || typeof session !== "object") return false
  return [
    Array.isArray(session.warns) ? session.warns.length : 0,
    Array.isArray(session.cache_hits) ? session.cache_hits.length : 0,
    Array.isArray(session.notes) ? session.notes.length : 0,
    Array.isArray(session.tags) ? session.tags.length : 0,
    Array.isArray(session.history) ? session.history.length : 0,
    Array.isArray(session.dashboard_vectors) ? session.dashboard_vectors.length : 0,
    Array.isArray(session.dashboard_outcomes) ? session.dashboard_outcomes.length : 0,
    Number(session.total_savings_usd || 0),
    Number(session.cache_savings_usd || 0),
    Number(session.turn_counter || 0),
  ].some((value) => Number(value) > 0)
}

function pruneInactiveSessions(state: unknown): number {
  if (!state || typeof state !== "object" || !state.sessions || typeof state.sessions !== "object") return 0
  const now = Date.now()
  let removed = 0
  for (const [sid, session] of Object.entries(state.sessions)) {
    if (!session || typeof session !== "object") {
      delete state.sessions[sid]
      removed++
      continue
    }
    if (sid === _OC_SID) continue
    const startedAt = Date.parse(String(session.started || session.session_started_at || session.updatedAt || ""))
    const ageMs = Number.isFinite(startedAt) ? now - startedAt : Number.POSITIVE_INFINITY
    if (! _sessionHasActivity(session) && ageMs > ORPHAN_SESSION_TTL_MS) {
      delete state.sessions[sid]
      removed++
    }
  }
  _pruneOldSessions(state)
  return removed
}

export function runStartupMaintenanceOnce(): void {
  try {
    const home = getVibeOSHome()
    if (!home || home === _startupMaintenanceHome) return
    _startupMaintenanceHome = home
    _pruneCorruptionBackups(join(home, ".backups"))
    loadActiveJobs()
    updateState((state) => {
      pruneInactiveSessions(state)
      return state
    })
    _compactSavingsLedgerIfNeeded()
  } catch {}
}

function _ensureVibeOSHomeDir(): string {
  try {
    if (!existsSync(VIBEOS_HOME)) {
      mkdirSync(VIBEOS_HOME, { recursive: true })
      return VIBEOS_HOME
    }
    const st = statSync(VIBEOS_HOME)
    if (!st.isDirectory()) {
      const backup = VIBEOS_HOME + ".backup." + Date.now()
      renameSync(VIBEOS_HOME, backup)
      mkdirSync(VIBEOS_HOME, { recursive: true })
    }
    return VIBEOS_HOME
  } catch {
    return VIBEOS_HOME
  }
}

function _handleStateCorruption(path: string): string | null {
  _ensureVibeOSHomeDir()
  const backupDir = join(VIBEOS_HOME, ".backups")
  try { mkdirSync(backupDir, { recursive: true }) } catch {}
  const backupPath = join(backupDir, basename(path) + ".corrupted." + Date.now())
  try { copyFileSync(path, backupPath) } catch {}
  const logPath = join(VIBEOS_HOME, ".state-corruption-log.jsonl")
  try { appendJsonlWithRotation(logPath, JSON.stringify({ ts: new Date().toISOString(), path, backup: backupPath }) + "\n", 500, 50) } catch {}
  _pruneCorruptionBackups(backupDir)
  return backupPath
}

// ── File locking ─────────────────────────────────────────────────────
function _lockPathFor(filePath: string): string {
  const hash = createHash("sha1").update(String(filePath || "")).digest("hex")
  return join(FILE_LOCK_DIR, `${hash}.lock`)
}

export function withFileLock<T>(filePath: string, fn: () => T, opts: { staleMs?: number, timeoutMs?: number } = {}): T {
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
    } catch {
      try {
        if (existsSync(lockPath)) {
          const age = Date.now() - statSync(lockPath).mtimeMs
          if (age > staleMs) {
            try { rmSync(lockPath, { force: true }) } catch {}
          }
        }
      } catch {}
      // Avoid burning a full CPU core while another hook holds this shared
      // lock. These state helpers are synchronous, so yield briefly before
      // retrying instead of hot-spinning until the timeout expires.
      try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
      } catch {}
    }
  }
  throw new Error(`[vibeOS] lock not acquired for ${filePath} after ${timeoutMs}ms`)
}

// ── State validation ─────────────────────────────────────────────────
function validateState(state: unknown, path: string): void {
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
function readJsonOrEmpty(filePath: string): unknown {
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

function appendLoopTransitionAudit(previousSession: unknown, nextSession: unknown, sid: string): void {
  try {
    const next = nextSession && typeof nextSession === "object" ? nextSession as AnyObject : {}
    const previous = previousSession && typeof previousSession === "object" ? previousSession as AnyObject : {}
    const nextSource = String(next.decision_source || next.source || "").trim().toLowerCase()
    const nextAuthority = String(next.loop_authority || "").trim()
    const previousRelevant = Boolean(previous.is_looping === true
      || String(previous.sub_regime || previous.regime || "").trim().toUpperCase() === "LOOPING"
      || String(previous.loop_authority || "").trim())
    const nextRelevant = Boolean(next.is_looping === true
      || String(next.sub_regime || next.regime || "").trim().toUpperCase() === "LOOPING"
      || nextAuthority)
    if (!previousRelevant && !nextRelevant) return
    const prevSignature = JSON.stringify({
      regime: previous.sub_regime || previous.regime || "",
      looping: Boolean(previous.is_looping),
      source: String(previous.decision_source || previous.source || ""),
      authority: String(previous.loop_authority || ""),
      kind: String(previous.loop_detector_kind || ""),
      confidence: Number(previous.loop_detector_confidence || 0) || 0,
      reason: String(previous.loop_source_reason || ""),
    })
    const nextSignature = JSON.stringify({
      regime: next.sub_regime || next.regime || "",
      looping: Boolean(next.is_looping),
      source: nextSource,
      authority: nextAuthority,
      kind: String(next.loop_detector_kind || ""),
      confidence: Number(next.loop_detector_confidence || 0) || 0,
      reason: String(next.loop_source_reason || ""),
    })
    if (prevSignature === nextSignature) return
    const auditPath = join(getVibeOSHome(), "loop-audit.jsonl")
    const payload = {
      _ts: new Date().toISOString(),
      session_id: sid,
      previous_regime: String(previous.sub_regime || previous.regime || "INIT"),
      next_regime: String(next.sub_regime || next.regime || "INIT"),
      decision_source: nextSource || "local",
      loop_authority: nextAuthority || null,
      loop_detector_kind: next.loop_detector_kind || null,
      loop_detector_confidence: Number.isFinite(Number(next.loop_detector_confidence)) ? Number(next.loop_detector_confidence) : null,
      reason: String(next.loop_source_reason || next.resolution_reason || ""),
    }
    appendJsonlWithRotation(auditPath, JSON.stringify(payload) + "\n")
  } catch {}
}

export function updateState(mutator: (state: DelegationState) => DelegationState | void): DelegationState {
  const delegationStateFile = join(getVibeOSHome(), "delegation-state.json")
  const MAX_RETRIES = 3
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = withFileLock(delegationStateFile, () => {
        const preState = readJsonOrEmpty(delegationStateFile)
        const preGen = Number(preState?._gen || 0)
        let state = preState
        if (!state || typeof state !== "object") state = {}
        _compactDelegationSessions(state)
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
        _compactDelegationSessions(next)
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
        // Always surface this: updateState is the canonical writer for
        // delegation-state.json (savings, warns, telemetry, orchestration), so
        // exhausting retries silently loses user-visible data. The console
        // guard persists it to session-events; keep stderr noisy too.
        const message = (err as Error)?.message || String(err)
        console.error(`[vibeOS] updateState failed after ${MAX_RETRIES} retries: ${message}`)
        return null
      }
    }
  }
  return null
}

function _compactDelegationSessions(state: DelegationState): void {
  if (!state || typeof state !== "object") return
  state.sessions ??= {}
  const activeSessionId = getCurrentSessionId()
  const entries = Object.entries(state.sessions)
  if (entries.length > 30) {
    entries.sort((a, b) => {
      const aUpdated = String(a[1]?.last_updated || a[1]?.started || a[1]?.last_costed || "")
      const bUpdated = String(b[1]?.last_updated || b[1]?.started || b[1]?.last_costed || "")
      return bUpdated.localeCompare(aUpdated)
    })
    const kept = entries.slice(0, 30)
    if (activeSessionId && state.sessions[activeSessionId] && !kept.some(([id]) => id === activeSessionId)) {
      kept[kept.length - 1] = [activeSessionId, state.sessions[activeSessionId]]
    }
    state.sessions = Object.fromEntries(kept)
  }
  for (const session of Object.values(state.sessions)) {
    if (!session || typeof session !== "object") continue
    const cap = (key: string, limit: number) => {
      if (Array.isArray(session[key]) && session[key].length > limit) {
        session[key] = session[key].slice(-limit)
      }
    }
    cap("history", MAX_BLACKBOX_EVENT_HISTORY)
    cap("pivotHistory", MAX_BLACKBOX_EVENT_HISTORY)
    cap("outcomeHistory", MAX_BLACKBOX_OUTCOME_HISTORY)
    cap("control_history", MAX_BLACKBOX_CONTROL_HISTORY)
    cap("cache_hits", MAX_BLACKBOX_EVENT_HISTORY)
    cap("stress_history", MAX_BLACKBOX_EVENT_HISTORY)
  }
}

function readFullState(): DelegationState {
  const delegationStateFile = join(getVibeOSHome(), "delegation-state.json")
  try {
    if (!existsSync(delegationStateFile)) return {}
    const st = statSync(delegationStateFile)
    if (st.size > 10485760) { _handleStateCorruption(delegationStateFile); return {} }
    return safeJsonParse(readFileSync(delegationStateFile, "utf-8"))
  } catch { _handleStateCorruption(delegationStateFile); return {} }
}

function writeFullState(state: unknown): void {
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
const FALLBACK_HIGH = /opus|gemini-.*-pro|gpt-5|(^|\/)o[134]($|-|\/)|claude.*opus|reasoner|r1/i
const FALLBACK_MID  = /sonnet|gemini-.*-flash|gpt-4o(?!-mini)|haiku|flash|4o/i
export function _safeRegex(cfg: unknown, fallback: RegExp, label: string): RegExp {
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

// ── ML Router state ──────────────────────────────────────────────────
function loadMLState(): void {
  try {
    const gl = loadGlobalLearning()
    if (gl.ml_cache_raw) _cacheDb = deserializeCacheDb(gl.ml_cache_raw)
    evictStaleEntries(_cacheDb, 86400 * 7)
  } catch {}
}

function saveMLState(): boolean {
  if (!ML_ENABLED) return false
  try {
    updateGlobalLearning((gl: unknown) => {
      gl.ml_cache_raw = JSON.stringify(_cacheDb)
      return gl
    })
    return true
  } catch { return false }
}
loadMLState()

// ── Blackbox state management ───────────────────────────────────────
let _blackboxStateCache: { file: string, mtimeMs: number, size: number, state: DelegationState } | null = null

function loadBlackboxState(): DelegationState {
  const blackboxFile = join(getVibeOSHome(), "blackbox-state.json")
  try {
    if (!existsSync(blackboxFile)) return { enabled: true, sessions: {} }
    const st = statSync(blackboxFile)
    if (st.size > 10485760) { _handleStateCorruption(blackboxFile); return { enabled: false, sessions: {} } }
    if (_blackboxStateCache?.file === blackboxFile && _blackboxStateCache.mtimeMs === st.mtimeMs && _blackboxStateCache.size === st.size) {
      return _blackboxStateCache.state
    }
    const raw = safeJsonParse(readFileSync(blackboxFile, "utf-8")) || { enabled: false, sessions: {} }
    if (!raw.sessions || typeof raw.sessions !== "object") raw.sessions = {}
    const now = Date.now()
    let changed = false
    for (const [sid, session] of Object.entries(raw.sessions)) {
      if (!session || typeof session !== "object") {
        delete raw.sessions[sid]; changed = true; continue
      }
      const { record: next, changed: recordChanged } = normalizeBlackboxRecord(session as unknown, sid, now)
      raw.sessions[sid] = next
      if (recordChanged) changed = true
    }
    const beforeSessionCount = Object.keys(raw.sessions).length
    _capBlackboxSessions(raw)
    if (Object.keys(raw.sessions).length !== beforeSessionCount) changed = true
    if (_normalizeVibeUltraXBlackboxState(raw)) changed = true
    if (_mirrorLiveControlVector(raw)) changed = true
    _blackboxStateCache = { file: blackboxFile, mtimeMs: st.mtimeMs, size: st.size, state: raw }
    if (changed) {
      try { saveBlackboxState(raw) } catch {}
    }
    return raw
  } catch { _handleStateCorruption(blackboxFile); return { enabled: false, sessions: {} } }
}

function _capBlackboxSessions(state: unknown): void {
  if (!state || typeof state !== "object" || !state.sessions || typeof state.sessions !== "object") return
  const sids = Object.keys(state.sessions)
  if (sids.length <= MAX_BLACKBOX_SESSIONS) return
  const ts = (sid: string): number => {
    const s = state.sessions[sid]
    const v = Date.parse(String(s?.updatedAt || s?.createdAt || s?.session_started_at || ""))
    return Number.isFinite(v) ? v : 0
  }
  // Keep the active session plus the most-recently-updated up to the cap.
  const ranked = sids
    .filter((sid) => sid !== _OC_SID)
    .sort((a, b) => ts(b) - ts(a))
  const keepBudget = Math.max(0, MAX_BLACKBOX_SESSIONS - (state.sessions[_OC_SID] ? 1 : 0))
  const keep = new Set(ranked.slice(0, keepBudget))
  if (state.sessions[_OC_SID]) keep.add(_OC_SID)
  for (const sid of sids) {
    if (!keep.has(sid)) delete state.sessions[sid]
  }
}

function saveBlackboxState(state: unknown): void {
  const blackboxFile = join(getVibeOSHome(), "blackbox-state.json")
  try {
    withFileLock(blackboxFile, () => {
      const next = state && typeof state === "object" ? state : { enabled: true, sessions: {} }
      const previous = readJsonOrEmpty(blackboxFile) as AnyObject
      next.sessions ??= {}
      const now = Date.now()
      for (const [sid, session] of Object.entries(next.sessions)) {
        if (!session || typeof session !== "object") continue
        const normalized = normalizeBlackboxRecord(session as unknown, sid, now).record
        appendLoopTransitionAudit(previous?.sessions?.[sid], normalized, sid)
        next.sessions[sid] = normalized
      }
      _capBlackboxSessions(next)
      _normalizeVibeUltraXBlackboxState(next)
      _mirrorLiveControlVector(next)
      mkdirSync(dirname(blackboxFile), { recursive: true })
      const tmp = blackboxFile + ".tmp"
      writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n")
      renameSync(tmp, blackboxFile)
      const st = statSync(blackboxFile)
      _blackboxStateCache = { file: blackboxFile, mtimeMs: st.mtimeMs, size: st.size, state: next as DelegationState }
    }, { timeoutMs: 4000 })
  } catch (err) {
    console.error(`[vibeOS] saveBlackboxState failed: ${err.message}`)
  }
}

function getBlackboxTracker(): unknown {
  return _blackboxTracker
}

function getBlackboxResolution(): unknown {
  return _blackboxTracker?.resolution || null
}

function _pushControlHistoryEntry(session: unknown, entry: unknown): void {
  if (!session || typeof session !== "object" || !entry || typeof entry !== "object") return
  session.control_history ??= []
  const fingerprint = JSON.stringify({
    regime: entry.regime || "",
    reward: entry.reward ?? null,
    outcome: entry.outcome ?? null,
    next_action: entry.next_action ?? null,
    control: entry.control || {},
  })
  const last = session.control_history[session.control_history.length - 1]
  if (last?.fingerprint === fingerprint) return
  session.control_history.push({ ...entry, fingerprint })
  if (session.control_history.length > MAX_BLACKBOX_CONTROL_HISTORY) {
    session.control_history = session.control_history.slice(-MAX_BLACKBOX_CONTROL_HISTORY)
  }
}

function _isPlainObject(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function _normalizeSnapshotRewardBreakdown(input: unknown): unknown {
  const breakdown = input?.rewardBreakdown
  if (!_isPlainObject(breakdown)) return null
  try {
    return JSON.parse(JSON.stringify(breakdown))
  } catch {
    return { ...breakdown }
  }
}

function _buildLiveSnapshotFingerprint(input: unknown, resolutionState: string, resolutionReason: string, nextAction: string | null): string {
  return stableJson({
    sessionId: String(input?.sessionId || ""),
    projectFingerprint: String(input?.projectFingerprint || ""),
    projectName: String(input?.projectName || ""),
    outcome: typeof input?.outcome === "string" ? input.outcome : null,
    rewardCredits: Number.isFinite(Number(input?.rewardCredits)) ? Number(input.rewardCredits || 0) : null,
    savingsUsd: Number.isFinite(Number(input?.savingsUsd)) ? roundUsd(Number(input.savingsUsd || 0)) : null,
    footerLine: String(input?.footerLine || ""),
    control: input?.control && typeof input.control === "object" ? input.control : null,
    subRegime: String(input?.subRegime || ""),
    resolutionState,
    resolutionReason,
    nextAction,
    loopInterventionLevel: String(input?.loopInterventionLevel || ""),
    pivotDetected: Boolean(input?.pivotDetected),
    stress: Number.isFinite(Number(input?.stress)) ? Number(input.stress) : null,
    rewardBreakdown: _normalizeSnapshotRewardBreakdown(input),
    source: String(input?.source || ""),
  })
}

function _mergeLiveLoopSnapshot(existing: unknown, input: unknown, derived: { resolutionState: string; resolutionReason: string; now?: number }): unknown {
  return reconcileStickyLoopState(existing as AnyObject, {
    ...((input && typeof input === "object") ? input : {}),
    source: String((input as AnyObject)?.source || "footer"),
    sub_regime: typeof (input as AnyObject)?.subRegime === "string" && String((input as AnyObject).subRegime).trim()
      ? String((input as AnyObject).subRegime).trim()
      : "INIT",
    regime: typeof (input as AnyObject)?.subRegime === "string" && String((input as AnyObject).subRegime).trim()
      ? String((input as AnyObject).subRegime).trim()
      : "INIT",
    resolution: derived.resolutionState === "working"
      ? "solved"
      : derived.resolutionState === "intervened"
        ? "looping"
        : String((input as AnyObject)?.resolution || "unresolved"),
    resolution_state: derived.resolutionState,
    resolution_reason: derived.resolutionReason,
    loop_intervention_level: typeof (input as AnyObject)?.loopInterventionLevel === "string"
      ? String((input as AnyObject).loopInterventionLevel)
      : String((existing as AnyObject)?.loop_intervention_level || "none"),
    loop_consecutive: Number((input as AnyObject)?.loopConsecutive ?? (existing as AnyObject)?.loop_consecutive ?? (existing as AnyObject)?.loopCount ?? 0) || 0,
    is_looping: typeof (input as AnyObject)?.isLooping === "boolean"
      ? Boolean((input as AnyObject).isLooping)
      : derived.resolutionState === "intervened",
    loop_notice_signature: typeof (input as AnyObject)?.loopNoticeSignature === "string"
      ? String((input as AnyObject).loopNoticeSignature)
      : typeof (existing as AnyObject)?.loop_notice_signature === "string"
        ? String((existing as AnyObject).loop_notice_signature)
        : null,
    loop_notice_at: typeof (input as AnyObject)?.loopNoticeAt === "string"
      ? String((input as AnyObject).loopNoticeAt)
      : typeof (existing as AnyObject)?.loop_notice_at === "string"
        ? String((existing as AnyObject).loop_notice_at)
        : null,
    loop_notice_hold_until: typeof (input as AnyObject)?.loopNoticeHoldUntil === "string"
      ? String((input as AnyObject).loopNoticeHoldUntil)
      : typeof (existing as AnyObject)?.loop_notice_hold_until === "string"
        ? String((existing as AnyObject).loop_notice_hold_until)
        : null,
    loop_notice_count: Number((input as AnyObject)?.loopNoticeCount ?? (existing as AnyObject)?.loop_notice_count ?? 0) || 0,
  }, { now: derived.now })
}

function _normalizeVibeUltraXControlVector(control: unknown): boolean {
  if (!control || typeof control !== "object") return false
  const mode = String(control.optimization_mode || control.mode_root || control.requested_mode || "").toLowerCase()
  if (mode !== "vibeultrax") return false
  const root = ["cheap", "medium", "brain"]
  const previousPipeline = Array.isArray(control.pipeline_root) ? control.pipeline_root.filter(Boolean) : []
  let changed = false
  if (!Array.isArray(control.route_path) || control.route_path.length === 0) {
    control.route_path = previousPipeline.length ? previousPipeline : ["cheap"]
    changed = true
  }
  if (JSON.stringify(control.cascade_root || []) !== JSON.stringify(root)) {
    control.cascade_root = root
    changed = true
  }
  if (JSON.stringify(control.pipeline_root || []) !== JSON.stringify(root)) {
    control.pipeline_root = root
    changed = true
  }
  if (control.tier_bias !== "cheap") {
    control.tier_bias = "cheap"
    changed = true
  }
  if (!control.selected_slot) {
    const route = Array.isArray(control.route_path) && control.route_path.length ? control.route_path : ["cheap"]
    control.selected_slot = route[route.length - 1] || "cheap"
    changed = true
  }
  // NOTE: despite looking like a duplicate of selected_slot, cascade_tier has its
  // own real reader — src/index.ts's degraded-mode footer path reads
  // control_vector.cascade_tier directly. Do not remove in a future cleanup pass.
  if (!control.cascade_tier) {
    const route = Array.isArray(control.route_path) && control.route_path.length ? control.route_path : ["cheap"]
    control.cascade_tier = route[route.length - 1] || "cheap"
    changed = true
  }
  const depth = Array.isArray(control.route_path) && control.route_path.length ? control.route_path.length : 1
  if (control.cascade_depth !== depth) {
    control.cascade_depth = depth
    changed = true
  }
  return changed
}

function _normalizeVibeUltraXBlackboxState(state: unknown): boolean {
  if (!state || typeof state !== "object") return false
  let changed = false
  for (const key of ["cv", "control_vector", "live_control"]) {
    if (_normalizeVibeUltraXControlVector(state[key])) changed = true
  }
  const sessions = state.sessions && typeof state.sessions === "object" ? state.sessions : null
  if (!sessions) return changed
  for (const session of Object.values(sessions)) {
    if (!session || typeof session !== "object") continue
    for (const key of ["cv", "control_vector", "live_control"]) {
      if (_normalizeVibeUltraXControlVector(session[key])) changed = true
    }
    const history = Array.isArray(session.control_history) ? session.control_history : []
    for (const entry of history) {
      if (!entry || typeof entry !== "object") continue
      if (_normalizeVibeUltraXControlVector(entry.control)) changed = true
      if (_normalizeVibeUltraXControlVector(entry.cv)) changed = true
    }
  }
  return changed
}

function _mirrorLiveControlVector(state: unknown): boolean {
  if (!state || typeof state !== "object") return false
  const currentSid = getCurrentSessionId()
  if (!currentSid) return false
  const rootControl = state.cv || state.control_vector || state.live_control || null
  const sessions = state.sessions && typeof state.sessions === "object" ? state.sessions : null
  const currentSession = sessions?.[currentSid] && typeof sessions[currentSid] === "object" ? sessions[currentSid] : null
  const sessionControl = currentSession?.cv || currentSession?.control_vector || currentSession?.live_control || null
  const liveControl = rootControl || sessionControl
  if (!liveControl) return false
  let changed = false
  if (!state.cv) { state.cv = liveControl; changed = true }
  if (!state.control_vector) { state.control_vector = liveControl; changed = true }
  if (!state.live_control) { state.live_control = liveControl; changed = true }
  if (_normalizeVibeUltraXBlackboxState(state)) changed = true
  if (state.latest_control_vector_ts && currentSession && !currentSession.latest_control_vector_ts) {
    currentSession.latest_control_vector_ts = state.latest_control_vector_ts
    changed = true
  }
  if (!state.sessions || typeof state.sessions !== "object") {
    state.sessions = { [currentSid]: {} }
    changed = true
  }
  if (!state.sessions[currentSid] || typeof state.sessions[currentSid] !== "object") {
    state.sessions[currentSid] = {
      tier: currentTier || "",
      model: currentModel || "",
      provider: String(currentModel || "").split("/")[0] || "",
      mode: "",
    }
    changed = true
  }
  const targetSession = state.sessions[currentSid]
  if (!targetSession.cv) { targetSession.cv = liveControl; changed = true }
  if (!targetSession.control_vector) { targetSession.control_vector = liveControl; changed = true }
  if (!targetSession.live_control) { targetSession.live_control = liveControl; changed = true }
  if (state.latest_control_vector_ts && !targetSession.latest_control_vector_ts) {
    targetSession.latest_control_vector_ts = state.latest_control_vector_ts
    changed = true
  }
  return changed
}

function _deriveLiveResolutionState(input: unknown): { resolution_state: string; resolution_reason: string } {
  const outcome = String(input?.outcome || "").toLowerCase()
  const loopLevel = String(input?.loopInterventionLevel || "").toLowerCase()
  const pivotDetected = Boolean(input?.pivotDetected)
  if (input?.resolutionState || input?.resolutionReason) {
    return {
      resolution_state: String(input?.resolutionState || "unresolved"),
      resolution_reason: String(input?.resolutionReason || "live snapshot"),
    }
  }
  if (outcome === "positive") return { resolution_state: "working", resolution_reason: "positive outcome" }
  if (outcome === "negative") {
    return {
      resolution_state: loopLevel === "escalated" ? "intervened" : "needs_attention",
      resolution_reason: "negative outcome",
    }
  }
  if (loopLevel && loopLevel !== "none") return { resolution_state: "intervened", resolution_reason: `loop intervention: ${loopLevel}` }
  if (pivotDetected) return { resolution_state: "pivoted", resolution_reason: "context pivot detected" }
  return { resolution_state: "unresolved", resolution_reason: "no outcome yet" }
}

export function recordLiveSessionSnapshot(input: {
  sessionId?: string
  projectFingerprint?: string
  projectName?: string
  outcome?: string | null
  rewardCredits?: number
  savingsUsd?: number
  footerLine?: string
  control?: unknown
  subRegime?: string
  resolutionState?: string
  resolutionReason?: string
  nextAction?: string
  loopInterventionLevel?: string
  pivotDetected?: boolean
  stress?: number
  rewardBreakdown?: unknown
  source?: string
  loopAuthority?: string | null
  loopDetectorKind?: string | null
  loopDetectorConfidence?: number | null
  loopSourceReason?: string | null
}): { sessionId: string; updatedAt: string; resolutionState: string; resolutionReason: string } {
  const explicitSessionId = typeof input?.sessionId === "string" ? input.sessionId.trim() : ""
  if (input && Object.prototype.hasOwnProperty.call(input, "sessionId") && !explicitSessionId) {
    return { sessionId: "", updatedAt: new Date().toISOString(), resolutionState: "unresolved", resolutionReason: "missing session id" }
  }
  const sid = explicitSessionId || getCurrentSessionId() || _OC_SID || ""
  const updatedAt = new Date().toISOString()
  const derivedResolution = _deriveLiveResolutionState(input)
  const resolutionState = String(input?.resolutionState || derivedResolution.resolution_state || "unresolved")
  const resolutionReason = String(input?.resolutionReason || derivedResolution.resolution_reason || "no outcome yet")
  const control = input?.control && typeof input.control === "object" ? { ...input.control } : null
  const nextAction = typeof input?.nextAction === "string" && input.nextAction.trim() ? input.nextAction.trim() : null
  const snapshotFingerprint = _buildLiveSnapshotFingerprint(input, resolutionState, resolutionReason, nextAction)

  if (!sid) {
    return { sessionId: "", updatedAt, resolutionState, resolutionReason }
  }
  if (_liveSnapshotFingerprints.get(sid) === snapshotFingerprint) {
    return { sessionId: sid, updatedAt, resolutionState, resolutionReason }
  }

  try {
    updateState((state) => {
      state.sessions ??= {}
      state.lifetime ??= {}
      if (!state.sessions[sid]) {
        state.sessions[sid] = { warns: [], cache_hits: [], tier: currentTier || "", model: currentModel || "", provider: String(currentModel || "").split("/")[0] || "", mode: "" }
      }
      const ses = state.sessions[sid]
      const loopSnapshot = _mergeLiveLoopSnapshot(ses, input, { resolutionState, resolutionReason, now: Date.now() })
      if (ses.live_snapshot_fingerprint === snapshotFingerprint) {
        ses.live_updated_at = updatedAt
        _liveSnapshotFingerprints.set(sid, snapshotFingerprint)
        return state
      }
      if (currentTier) ses.tier = currentTier
      if (currentModel) { ses.model = currentModel; ses.provider = String(currentModel).split("/")[0] || ses.provider || "" }
      ses.last_updated = updatedAt
      if (input.projectFingerprint) ses.project_fingerprint = input.projectFingerprint
      if (input.projectName) ses.project_name = input.projectName
      if (typeof input.savingsUsd === "number" && Number.isFinite(input.savingsUsd)) {
        ses.live_savings_usd = roundUsd(Number(input.savingsUsd || 0))
      }
      if (typeof input.rewardCredits === "number" && Number.isFinite(input.rewardCredits)) {
        ses.reward_credits = roundUsd(Number(ses.reward_credits || 0) + Number(input.rewardCredits || 0))
        state.lifetime.reward_credits = roundUsd(Number(state.lifetime.reward_credits || 0) + Number(input.rewardCredits || 0))
      }
      const rewardBreakdown = _normalizeSnapshotRewardBreakdown(input)
      if (rewardBreakdown) ses.live_reward_breakdown = rewardBreakdown
      if (typeof input.outcome === "string" && input.outcome) ses.last_outcome = input.outcome
      if (input.footerLine) ses.last_footer_line = input.footerLine
      ses.decision_source = loopSnapshot.decision_source || ses.decision_source || "footer"
      ses.live_sub_regime = loopSnapshot.sub_regime || ses.live_sub_regime || "INIT"
      ses.live_is_looping = loopSnapshot.is_looping
      ses.live_resolution_state = loopSnapshot.resolution_state || resolutionState
      ses.live_resolution_reason = loopSnapshot.resolution_reason || resolutionReason
      ses.live_loop_intervention_level = loopSnapshot.loop_intervention_level || ses.live_loop_intervention_level || "none"
      ses.live_loop_consecutive = Number(loopSnapshot.loop_consecutive ?? 0) || 0
      ses.live_loop_authority = loopSnapshot.loop_authority ?? null
      ses.live_loop_detector_kind = loopSnapshot.loop_detector_kind ?? null
      ses.live_loop_detector_confidence = loopSnapshot.loop_detector_confidence ?? null
      ses.live_loop_source_reason = loopSnapshot.loop_source_reason ?? null
      if (loopSnapshot.loop_hold_until !== undefined) ses.live_loop_hold_until = loopSnapshot.loop_hold_until
      if (loopSnapshot.loop_release_streak !== undefined) ses.live_loop_release_streak = loopSnapshot.loop_release_streak
      if (loopSnapshot.loop_notice_signature !== undefined) ses.live_loop_notice_signature = loopSnapshot.loop_notice_signature
      if (loopSnapshot.loop_notice_at !== undefined) ses.live_loop_notice_at = loopSnapshot.loop_notice_at
      if (loopSnapshot.loop_notice_hold_until !== undefined) ses.live_loop_notice_hold_until = loopSnapshot.loop_notice_hold_until
      if (loopSnapshot.loop_notice_count !== undefined) ses.live_loop_notice_count = loopSnapshot.loop_notice_count
      if (typeof input.stress === "number" && Number.isFinite(input.stress)) ses.live_stress = Number(input.stress)
      if (typeof input.pivotDetected === "boolean") ses.live_pivot_detected = input.pivotDetected
      if (control) {
        ses.cv = control
        ses.control_vector = control
        ses.live_control = control
      }
      if (nextAction) ses.live_next_action = nextAction
      ses.live_updated_at = updatedAt
      ses.live_snapshot_fingerprint = snapshotFingerprint
      _liveSnapshotFingerprints.set(sid, snapshotFingerprint)
      if (control) {
        ses.live_control = control
        _pushControlHistoryEntry(ses, {
          turn: Number(ses.turn_counter || 0) + 1,
          regime: input.subRegime || ses.sub_regime || ses.regime || "INIT",
          control,
          reward: typeof input.rewardCredits === "number" && Number.isFinite(input.rewardCredits) ? Number(input.rewardCredits || 0) : null,
          outcome: typeof input.outcome === "string" ? input.outcome : null,
          next_action: nextAction,
          resolution_state: resolutionState,
          resolution_reason: resolutionReason,
          source: input.source || "footer",
        })
      }
      return state
    })
  } catch {}

  try {
    const bb = loadBlackboxState()
    bb.sessions ??= {}
    if (!bb.sessions[sid]) {
      bb.sessions[sid] = {}
    }
    const ses = bb.sessions[sid]
    const mergedLoop = _mergeLiveLoopSnapshot(ses, input, { resolutionState, resolutionReason, now: Date.now() })
    if (ses.live_snapshot_fingerprint === snapshotFingerprint) {
      _liveSnapshotFingerprints.set(sid, snapshotFingerprint)
      return { sessionId: sid, updatedAt, resolutionState, resolutionReason }
    }
    if (input.projectFingerprint) ses.project_fingerprint = input.projectFingerprint
    if (input.projectName) ses.project_name = input.projectName
    if (input.footerLine) ses.last_footer_line = input.footerLine
    ses.sub_regime = mergedLoop.sub_regime || ses.sub_regime || "INIT"
    ses.regime = mergedLoop.regime || ses.regime || ses.sub_regime || "INIT"
    ses.resolution = mergedLoop.resolution || ses.resolution || "unresolved"
    ses.resolution_state = mergedLoop.resolution_state || resolutionState
    ses.resolution_reason = mergedLoop.resolution_reason || resolutionReason
    ses.is_looping = mergedLoop.is_looping
    ses.updatedAt = updatedAt
    ses.last_snapshot_at = updatedAt
    if (typeof input.savingsUsd === "number" && Number.isFinite(input.savingsUsd)) {
      ses.live_savings_usd = roundUsd(Number(input.savingsUsd || 0))
    }
    if (typeof input.rewardCredits === "number" && Number.isFinite(input.rewardCredits)) {
      ses.reward_credits = roundUsd(Number(ses.reward_credits || 0) + Number(input.rewardCredits || 0))
    }
    const rewardBreakdown = _normalizeSnapshotRewardBreakdown(input)
    if (rewardBreakdown) ses.reward_breakdown = rewardBreakdown
    if (typeof input.outcome === "string" && input.outcome) {
      ses.outcome = input.outcome
      ses.outcomeHistory ??= []
      const outcomeFingerprint = JSON.stringify({
        outcome: input.outcome,
        reason: resolutionReason,
        next_action: nextAction,
      })
      const lastOutcome = ses.outcomeHistory[ses.outcomeHistory.length - 1]
      if (lastOutcome?.fingerprint !== outcomeFingerprint) {
        ses.outcomeHistory.push({
          turn: Number(ses.turn_counter || ses.outcomeHistory.length || 0) + 1,
          outcome: input.outcome,
          timestamp: updatedAt,
          source: input.source || "footer",
          fingerprint: outcomeFingerprint,
        })
        if (ses.outcomeHistory.length > MAX_BLACKBOX_OUTCOME_HISTORY) {
          ses.outcomeHistory = ses.outcomeHistory.slice(-MAX_BLACKBOX_OUTCOME_HISTORY)
        }
      }
    }
    if (control) {
      ses.cv = control
      ses.control_vector = control
      ses.live_control = control
      _pushControlHistoryEntry(ses, {
        turn: Number(ses.turn_counter || 0) + 1,
        regime: input.subRegime || ses.sub_regime || ses.regime || "INIT",
        control,
        reward: typeof input.rewardCredits === "number" && Number.isFinite(input.rewardCredits) ? Number(input.rewardCredits || 0) : null,
        outcome: typeof input.outcome === "string" ? input.outcome : null,
        next_action: nextAction,
        resolution_state: resolutionState,
        resolution_reason: resolutionReason,
        source: input.source || "footer",
      })
    }
    if (nextAction) ses.live_next_action = nextAction
    if (typeof input.pivotDetected === "boolean") ses.pivot_detected = input.pivotDetected
    ses.live_is_looping = mergedLoop.is_looping
    ses.loop_intervention_level = mergedLoop.loop_intervention_level || ses.loop_intervention_level || "none"
    ses.loop_consecutive = Number(mergedLoop.loop_consecutive ?? 0) || 0
    ses.loop_authority = mergedLoop.loop_authority ?? null
    ses.loop_detector_kind = mergedLoop.loop_detector_kind ?? null
    ses.loop_detector_confidence = mergedLoop.loop_detector_confidence ?? null
    ses.loop_source_reason = mergedLoop.loop_source_reason ?? null
    ses.loop_hold_until = mergedLoop.loop_hold_until ?? ses.loop_hold_until ?? null
    ses.loop_release_streak = Number(mergedLoop.loop_release_streak ?? 0) || 0
    ses.loop_notice_signature = mergedLoop.loop_notice_signature ?? ses.loop_notice_signature ?? null
    ses.loop_notice_at = mergedLoop.loop_notice_at ?? ses.loop_notice_at ?? null
    ses.loop_notice_hold_until = mergedLoop.loop_notice_hold_until ?? ses.loop_notice_hold_until ?? null
    ses.loop_notice_count = Number(mergedLoop.loop_notice_count ?? ses.loop_notice_count ?? 0) || 0
    ses.decision_source = mergedLoop.decision_source || ses.decision_source || "footer"
    if (typeof input.stress === "number" && Number.isFinite(input.stress)) ses.stress_level = Number(input.stress)
    ses.live_snapshot_fingerprint = snapshotFingerprint
    _liveSnapshotFingerprints.set(sid, snapshotFingerprint)
    saveBlackboxState(bb)
  } catch {}

  return { sessionId: sid, updatedAt, resolutionState, resolutionReason }
}

function normalizeBlackboxRecord(record: unknown, sid: string, now: number): { record: unknown; changed: boolean } {
  const next = { ...(record || {}) }
  let changed = false
  const createdAtRaw = typeof next.createdAt === "string" ? next.createdAt : ""
  const updatedAtRaw = typeof next.updatedAt === "string" ? next.updatedAt : ""
  const startedRaw = typeof next.started === "string" ? next.started : ""
  const sessionStartedRaw = typeof next.session_started_at === "string" ? next.session_started_at : ""
  const anchorRaw = [createdAtRaw, updatedAtRaw, startedRaw, sessionStartedRaw].find((v) => v && !Number.isNaN(Date.parse(v)))
  const anchorMs = anchorRaw ? Date.parse(anchorRaw) : NaN
  if (!Number.isFinite(Date.parse(createdAtRaw))) {
    next.createdAt = Number.isFinite(anchorMs) ? new Date(anchorMs).toISOString() : new Date(now).toISOString()
    changed = true
  }
  if (!Number.isFinite(Date.parse(updatedAtRaw))) {
    next.updatedAt = next.createdAt || new Date(now).toISOString()
    changed = true
  }
  if (typeof next.sessionId !== "string" || !next.sessionId.trim()) {
    next.sessionId = String(sid || "")
    changed = true
  }
  if (typeof next.project_fingerprint !== "string" || !next.project_fingerprint.trim()) {
    if (typeof currentProjectFingerprint === "string" && currentProjectFingerprint.trim()) {
      next.project_fingerprint = currentProjectFingerprint.trim()
      changed = true
    }
  }
  if (typeof next.project_name !== "string" || !next.project_name.trim()) {
    if (typeof currentProjectName === "string" && currentProjectName.trim()) {
      next.project_name = currentProjectName.trim()
      changed = true
    }
  }
  if (typeof next.regime !== "string" || !next.regime.trim()) {
    next.regime = typeof next.sub_regime === "string" && next.sub_regime.trim() ? next.sub_regime.trim() : "INIT"
    changed = true
  }
  if (typeof next.sub_regime !== "string" || !next.sub_regime.trim()) {
    next.sub_regime = "INIT"
    changed = true
  }
  if (typeof next.resolution !== "string" || !next.resolution.trim()) {
    next.resolution = "unresolved"
    changed = true
  }
  if (!Number.isFinite(Number(next.momentum))) { next.momentum = 0; changed = true }
  if (!Number.isFinite(Number(next.turn_counter))) { next.turn_counter = 0; changed = true }
  if (!Number.isFinite(Number(next.loopCount))) { next.loopCount = 0; changed = true }
  if (!Number.isFinite(Number(next.loop_consecutive))) { next.loop_consecutive = Number(next.loopCount || 0); changed = true }
  if (typeof next.loop_authority !== "string" || !next.loop_authority.trim()) { next.loop_authority = null; changed = true }
  if (typeof next.loop_detector_kind !== "string" || !next.loop_detector_kind.trim()) { next.loop_detector_kind = null; changed = true }
  if (!Number.isFinite(Number(next.loop_detector_confidence))) { next.loop_detector_confidence = null; changed = true }
  if (typeof next.loop_source_reason !== "string" || !next.loop_source_reason.trim()) { next.loop_source_reason = null; changed = true }
  const explicitLoopShape = String(next.sub_regime || next.regime || "").trim().toUpperCase() === "LOOPING"
    || String(next.resolution || "").trim().toUpperCase() === "LOOPING"
    || String(next.resolution_state || "").trim().toUpperCase() === "INTERVENED"
  if (next.decision_source === "local" && next.is_looping === true && !next.loop_authority && !explicitLoopShape) {
    next.is_looping = false
    changed = true
  }
  if (next.decision_source === "api" && next.is_looping === true && next.loop_authority !== "api") {
    next.loop_authority = "api"
    changed = true
  } else if (next.decision_source === "local" && next.is_looping === true && !next.loop_authority) {
    next.loop_authority = "authoritative-local"
    changed = true
  }
  if (!Array.isArray(next.history)) { next.history = []; changed = true }
  if (!Array.isArray(next.pivotHistory)) { next.pivotHistory = []; changed = true }
  if (!Array.isArray(next.outcomeHistory)) { next.outcomeHistory = []; changed = true }
  if (!Array.isArray(next.control_history)) { next.control_history = []; changed = true }
  const capHistory = (key: string, limit: number) => {
    if (next[key].length > limit) {
      next[key] = next[key].slice(-limit)
      changed = true
    }
  }
  capHistory("history", MAX_BLACKBOX_EVENT_HISTORY)
  capHistory("pivotHistory", MAX_BLACKBOX_EVENT_HISTORY)
  capHistory("outcomeHistory", MAX_BLACKBOX_OUTCOME_HISTORY)
  capHistory("control_history", MAX_BLACKBOX_CONTROL_HISTORY)
  const liveControl = next.cv || next.control_vector || next.live_control || null
  if (liveControl && !next.cv) { next.cv = liveControl; changed = true }
  if (liveControl && !next.control_vector) { next.control_vector = liveControl; changed = true }
  if (liveControl && !next.live_control) { next.live_control = liveControl; changed = true }
  if (next.decision_source !== "api" && next.decision_source !== "local") {
    next.decision_source = "local"
    changed = true
  }
  if (!Number.isFinite(Number(next.n_interactions))) {
    const histLen = Array.isArray(next.history) ? next.history.length : 0
    next.n_interactions = histLen > 0 ? histLen : Number(next.turn_counter || 0)
    changed = true
  }
  return { record: next, changed }
}

function registerSessionCleanupHandlers(): void {
  if (_sessionCleanupRegistered) return
  _sessionCleanupRegistered = true
  if ((process as unknown)._vibeOS_cleanupRegistered) return
  (process as unknown)._vibeOS_cleanupRegistered = true
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
  try {
    appendFileSync(SAVINGS_LEDGER_FILE, joined)
    _compactSavingsLedgerIfNeeded()
  } catch (err) {
    // Do NOT drop the lines: the ledger is the reconciler source of truth, so a
    // lost append silently shrinks every savings figure. Re-queue the batch and
    // retry on the next flush (bounded by LEDGER_BUFFER_MAX via re-splice).
    const requeued = _ledgerBuffer.concat(lines)
    _ledgerBuffer.length = 0
    _ledgerBuffer.push(...requeued.slice(0, LEDGER_BUFFER_MAX * 2))
    console.error(`[vibeOS] savings ledger flush failed, ${lines.length} line(s) re-queued: ${(err as Error)?.message || err}`)
    if (!_ledgerBufferTimer) _ledgerBufferTimer = setTimeout(_flushLedgerBuffer, LEDGER_BUFFER_FLUSH_MS)
  }
}

function recordSavingsLedgerEntry(entry: unknown): void {
  try {
    _ledgerBuffer.push(JSON.stringify(entry) + "\n")
    if (_ledgerBuffer.length >= LEDGER_BUFFER_MAX) _flushLedgerBuffer()
    else if (!_ledgerBufferTimer) _ledgerBufferTimer = setTimeout(_flushLedgerBuffer, LEDGER_BUFFER_FLUSH_MS)
  } catch {}
}

function loadSavingsLedger(limit: number = 1000): unknown[] {
  try {
    if (!existsSync(SAVINGS_LEDGER_FILE)) return []
    const raw = readFileSync(SAVINGS_LEDGER_FILE, "utf-8")
    if (!raw.trim()) return []
    const lines = raw.split("\n").filter(Boolean)
    const recent = limit ? lines.slice(-limit) : lines
    const entries: unknown[] = []
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

function _newTelemetryBucket(): unknown {
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

function _bucketChars(value: unknown): string {
  return _bucketNumeric(Number(value || 0), [
    [0, "0"],
    [63, "1-63"],
    [255, "64-255"],
    [1023, "256-1k"],
    [4095, "1k-4k"],
  ], "4k+")
}

function _bucketMs(value: unknown): string {
  return _bucketNumeric(Number(value || 0), [
    [49, "0-49ms"],
    [199, "50-199ms"],
    [999, "200-999ms"],
    [4999, "1-4.9s"],
    [14999, "5-14.9s"],
  ], "15s+")
}

function _telemetrySizeEstimate(telemetry: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(telemetry || {}), "utf8")
  } catch {
    return 0
  }
}

export function recordPrivacyTelemetry(event: unknown): unknown {
  try {
    if (!event || typeof event !== "object") return null
    return updateState((state) => {
      const now = new Date().toISOString()
      state.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" }
      state.sessions ??= {}
      const sid = String(event.session_id || _OC_SID || "unknown")
      state.sessions[sid] ??= { started: now, session_started_at: now, source: "opencode", tool_counts: {}, warns: [], cache_hits: [], seenWarnKeys: {}, tier: currentTier || "", model: currentModel || "", provider: String(currentModel || "").split("/")[0] || "", last_updated: now }
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
      const record = (bucket: unknown) => {
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
      lifetime.retained_sessions = Object.values(state.sessions).filter((ses: unknown) => Number(ses?.telemetry?.events || 0) > 0).length
      session.retained_sessions = 1
      state.lifetime.last_updated = now
      return state
    })
  } catch {
    return null
  }
}

function readTelemetrySummary(state: unknown, sid: string = _OC_SID): unknown {
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
function stableJson(obj: unknown): string {
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

// ── Active jobs ──────────────────────────────────────────────────────
// active jobs older than this are considered finished and no longer active

function _readActiveJobsRaw(): unknown {
  try {
    if (!existsSync(ACTIVE_JOBS_FILE)) return {}
    const raw = safeJsonParse(readFileSync(ACTIVE_JOBS_FILE, "utf-8"))
    return raw && typeof raw === "object" ? raw : {}
  } catch {
    _handleStateCorruption(ACTIVE_JOBS_FILE)
    return {}
  }
}

function _writeActiveJobsRaw(jobs: unknown): void {
  try {
    mkdirSync(dirname(ACTIVE_JOBS_FILE), { recursive: true })
    const tmp = ACTIVE_JOBS_FILE + ".tmp"
    writeFileSync(tmp, JSON.stringify(jobs, null, 2) + "\n")
    renameSync(tmp, ACTIVE_JOBS_FILE)
  } catch {}
}

function _normalizeActiveJobRecord(record: unknown, now: number = Date.now(), _strict: boolean = false): { record: unknown | null, changed: boolean, stale: boolean } {
  if (!record || typeof record !== "object") return { record: null, changed: false, stale: false }
  const next = { ...record }
  let changed = false
  const updatedAtRaw = typeof next.updatedAt === "string" ? next.updatedAt : ""
  const createdAtRaw = typeof next.createdAt === "string" ? next.createdAt : ""
  const updatedAtMs = Date.parse(updatedAtRaw)
  const createdAtMs = Date.parse(createdAtRaw)
  const anchorMs = Number.isFinite(updatedAtMs) ? updatedAtMs : createdAtMs
  const stale = Number.isFinite(anchorMs) && now - anchorMs > ACTIVE_JOBS_STALE_MS
  if (!Number.isFinite(createdAtMs)) {
    next.createdAt = Number.isFinite(anchorMs) ? new Date(anchorMs).toISOString() : new Date(now).toISOString()
    changed = true
  }
  if (!Number.isFinite(updatedAtMs)) {
    next.updatedAt = next.createdAt || new Date(now).toISOString()
    changed = true
  }
  if (typeof next.status !== "string" || !next.status.trim()) {
    next.status = "active"
    changed = true
  }
  if (stale && next.status !== "completed") {
    next.status = "completed"
    next.completedAt = new Date(now).toISOString()
    changed = true
  }
  return { record: next, changed, stale }
}

function _isSessionBridgeRecord(record: unknown): boolean {
  if (!record || typeof record !== "object") return false
  const kind = String(record.kind || "").trim().toLowerCase()
  const status = String(record.status || "").trim().toLowerCase()
  const prompt = String(record.prompt || record.prompt_prefix || "").trim()
  return kind === "session-bridge" || status === "handoff" || prompt.startsWith("[session bridge]")
}

function loadActiveJobs(): unknown {
  try {
    return withFileLock(ACTIVE_JOBS_FILE, () => {
      const raw = _readActiveJobsRaw()
      const next: Record<string, unknown> = {}
      let changed = false
      const now = Date.now()
      for (const [key, value] of Object.entries(raw || {})) {
        const norm = _normalizeActiveJobRecord(value, now, true)
        if (norm.record && _isSessionBridgeRecord(norm.record)) { changed = true; continue }
        if (!norm.record || (norm.stale && norm.record.status === "completed" && norm.record.completedAt)) { changed = true; continue }
        next[key] = norm.record
        if (norm.changed) changed = true
      }
      if (changed) _writeActiveJobsRaw(next)
      return next
    })
  } catch {
    _handleStateCorruption(ACTIVE_JOBS_FILE)
    return {}
  }
}

function getActiveJobForProject(fp: string = currentProjectFingerprint): unknown {
  if (!fp) return null
  const jobs = loadActiveJobs()
  const job = jobs[fp]
  if (!job || typeof job !== "object") return null
  return job
}

function saveActiveJobForProject(job: unknown, fp: string = currentProjectFingerprint): void {
  if (!fp || !job || typeof job !== "object") return
  try {
    withFileLock(ACTIVE_JOBS_FILE, () => {
      const jobs = _readActiveJobsRaw()
      const norm = _normalizeActiveJobRecord(job)
      jobs[fp] = norm.record || job
      _writeActiveJobsRaw(jobs)
    })
  } catch {}
}

function saveJobRecord(jobId: string, record: unknown): void {
  try {
    withFileLock(ACTIVE_JOBS_FILE, () => {
      const jobs = _readActiveJobsRaw()
      const norm = _normalizeActiveJobRecord(record)
      jobs[jobId] = norm.record || record
      _writeActiveJobsRaw(jobs)
    })
  } catch {}
}

function removeJobRecord(jobId: string): boolean {
  if (!jobId) return false
  try {
    let removed = false
    withFileLock(ACTIVE_JOBS_FILE, () => {
      const jobs = _readActiveJobsRaw()
      if (Object.prototype.hasOwnProperty.call(jobs, jobId)) {
        delete jobs[jobId]
        removed = true
        _writeActiveJobsRaw(jobs)
      }
    })
    return removed
  } catch {
    return false
  }
}

function loadJobRecord(jobId: string): unknown {
  try {
    const jobs = loadActiveJobs()
    return jobs[jobId] || null
  } catch { return null }
}

try { loadActiveJobs() } catch {}

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

// ── Legacy aliases (backward compat) ──────────────────────────────────────
// These provide the interface the task requested even if the old code used
// different function names.
const STATE_FILE = DELEGATION_STATE_FILE
function recordDelegation(tool: string, saveEst: number, _meta: unknown = {}): unknown {
  // Delegation savings are recorded via updateState
  // This wrapper provides the legacy interface expected by callers
  try {
    return updateState((s) => {
      const now = new Date().toISOString()
      const delta = Number(saveEst || 0)
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" }
      s.lifetime.total_savings_usd = roundUsd(Number(s.lifetime.total_savings_usd || 0) + delta)
      s.lifetime.last_updated = now
      s.sessions ??= {}
      const sid = _OC_SID
      s.sessions[sid] ??= { started: now, session_started_at: now, source: "opencode", tool_counts: {}, warns: [], tier: currentTier || "", model: currentModel || "", provider: String(currentModel || "").split("/")[0] || "", last_updated: now }

      if (currentProjectFingerprint && !s.sessions[sid].project_fingerprint) s.sessions[sid].project_fingerprint = currentProjectFingerprint

      if (currentProjectName && !s.sessions[sid].project_name) s.sessions[sid].project_name = currentProjectName

      s.sessions[sid].total_savings_usd = roundUsd(Number(s.sessions[sid].total_savings_usd || 0) + delta)
      try {
        if (currentProjectFingerprint) {
          const pstate = loadProjectState()
          touchProjectBucket(pstate, currentProjectFingerprint, {
            sessionId: sid,
            projectName: currentProjectName || "",
          })
          saveProjectState(pstate)
        }
      } catch {}
      _pruneOldSessions(s)
      return s
    })
  } catch (err) {
    console.error(`[vibeOS] recordDelegation failed: ${err.message}`)
    return null
  }
}

function recordCacheSaving(tool: string, saveEst: number, meta: unknown = {}): unknown {
  try {
    const state = updateState((s) => {
      const now = new Date().toISOString()
      const delta = Number(saveEst || 0)
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" }
      s.lifetime.last_updated = now
      s.sessions ??= {}
      const sid = _OC_SID
      s.sessions[sid] ??= { started: now, session_started_at: now, source: "opencode", tool_counts: {}, warns: [], tier: currentTier || "", model: currentModel || "", provider: String(currentModel || "").split("/")[0] || "", last_updated: now }
      if (currentProjectFingerprint && !s.sessions[sid].project_fingerprint) s.sessions[sid].project_fingerprint = currentProjectFingerprint
      if (currentProjectName && !s.sessions[sid].project_name) s.sessions[sid].project_name = currentProjectName
      s.sessions[sid].session_cache_dir = getSessionScratchpadDir()
      s.sessions[sid].tool_counts[tool] = (s.sessions[sid].tool_counts[tool] || 0) + 1
      if (meta?.hash) {
        s.sessions[sid].cache_hits ??= []
        if (!s.sessions[sid].cache_hits.some((h: unknown) => h.hash === meta.hash)) {
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
      try {
        if (currentProjectFingerprint) {
          const pstate = loadProjectState()
          touchProjectBucket(pstate, currentProjectFingerprint, {
            sessionId: sid,
            projectName: currentProjectName || "",
            topic: meta?.hash ? String(meta.hash).slice(0, 16) : "cache",
          })
          saveProjectState(pstate)
        }
      } catch {}
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

function recordMissedContext7(saveEst: number): unknown {
  try {
    const state = updateState((s) => {
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
      try {
        if (currentProjectFingerprint) {
          const pstate = loadProjectState()
          const bucket = touchProjectBucket(pstate, currentProjectFingerprint, {
            sessionId: sid,
            projectName: currentProjectName || "",
            topic: "context7",
          })
          if (bucket) bucket.context7Bypasses = (bucket.context7Bypasses || 0) + 1
          saveProjectState(pstate)
        }
      } catch {}
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
      updateGlobalLearning((gl: unknown) => {
        gl.context7_bypasses = Number(gl.context7_bypasses || 0) + 1
        gl.context7_missed_usd = Math.round((Number(gl.context7_missed_usd || 0) + Number(saveEst || 0)) * 100) / 100
        gl.context7_last_seen = new Date().toISOString()
        return gl
      })
    } catch {}
    return state?.lifetime?.missed_context7_usd ?? null
  } catch { return null }
}

function _compactSavingsLedgerIfNeeded(): void {
  try {
    if (!existsSync(SAVINGS_LEDGER_FILE)) return
    const st = statSync(SAVINGS_LEDGER_FILE)
    if (st.size <= LEDGER_ROTATE_MAX_BYTES) return
    withFileLock(SAVINGS_LEDGER_FILE, () => {
      if (!existsSync(SAVINGS_LEDGER_FILE)) return
      const lockedStat = statSync(SAVINGS_LEDGER_FILE)
      if (lockedStat.size <= LEDGER_ROTATE_MAX_BYTES) return
      const raw = readFileSync(SAVINGS_LEDGER_FILE, "utf-8")
      if (!raw.trim()) return
      const now = Date.now()
      const rows = raw.split("\n").filter(Boolean).map((line) => {
        let rec: unknown = null
        try { rec = JSON.parse(line) } catch { rec = null }
        const atRaw = rec && typeof rec === "object" ? String(rec.at || rec.ts || "") : ""
        const atMs = Date.parse(atRaw)
        return { raw: line.trim(), atMs: Number.isFinite(atMs) ? atMs : null }
      }).filter((row) => row.raw)
      const recent = rows.filter((row) => row.atMs != null && now - Number(row.atMs) <= LEDGER_ROTATE_MAX_AGE_MS)
      const pool = recent.length > 0 ? recent : rows
      const capped = pool.length > LEDGER_ROTATE_MAX_LINES ? pool.slice(-LEDGER_ROTATE_MAX_LINES) : pool
      let size = 0
      const kept: string[] = []
      for (let i = capped.length - 1; i >= 0; i--) {
        const line = capped[i].raw
        const lineBytes = Buffer.byteLength(line + "\n", "utf-8")
        if (kept.length > 0 && size + lineBytes > LEDGER_ROTATE_MAX_BYTES) break
        kept.push(line)
        size += lineBytes
      }
      const compacted = kept.reverse().join("\n") + "\n"
      if (compacted.trim() && compacted !== raw) {
        const tmp = SAVINGS_LEDGER_FILE + ".tmp." + Date.now()
        writeFileSync(tmp, compacted, "utf-8")
        renameSync(tmp, SAVINGS_LEDGER_FILE)
      }
    }, { timeoutMs: 4000 })
  } catch {}
}

// ── Savings ledger reconciliation ────────────────────────────────────
function readLedgerTotals(): { delegation: number, cache: number, context7: number, total: number, entries: number } {
  const empty = { delegation: 0, cache: 0, context7: 0, total: 0, entries: 0 }
  try {
    if (!existsSync(SAVINGS_LEDGER_FILE)) {
      _ledgerTotalsCache = { mtime: 0, size: 0, delegation: 0, cache: 0, context7: 0, entries: 0 }
      return empty
    }
    const st = statSync(SAVINGS_LEDGER_FILE)
    if (st.size === 0) {
      _ledgerTotalsCache = { mtime: st.mtimeMs, size: 0, delegation: 0, cache: 0, context7: 0, entries: 0 }
      return empty
    }
    if (st.size > LEDGER_ROTATE_MAX_BYTES) {
      _compactSavingsLedgerIfNeeded()
    }
    const currentStat = statSync(SAVINGS_LEDGER_FILE)
    if (currentStat.size === 0) {
      _ledgerTotalsCache = { mtime: currentStat.mtimeMs, size: 0, delegation: 0, cache: 0, context7: 0, entries: 0 }
      return empty
    }
    if (_ledgerTotalsCache.mtime === currentStat.mtimeMs && _ledgerTotalsCache.size === currentStat.size) {
      return {
        delegation: Math.round(_ledgerTotalsCache.delegation * 1000) / 1000,
        cache: Math.round(_ledgerTotalsCache.cache * 1000) / 1000,
        context7: Math.round(_ledgerTotalsCache.context7 * 1000) / 1000,
        total: Math.round((_ledgerTotalsCache.delegation + _ledgerTotalsCache.cache) * 1000) / 1000,
        entries: _ledgerTotalsCache.entries,
      }
    }

    let delegation = 0
    let cache = 0
    let context7 = 0
    let entries = 0
    let raw = ""
    let incremental = _ledgerTotalsCache.size > 0 && currentStat.size >= _ledgerTotalsCache.size && _ledgerTotalsCache.mtime > 0
    if (incremental) {
      const deltaSize = currentStat.size - _ledgerTotalsCache.size
      if (deltaSize > 0) {
        const fd = openSync(SAVINGS_LEDGER_FILE, "r")
        try {
          const buf = Buffer.allocUnsafe(deltaSize)
          const bytesRead = readSync(fd, buf, 0, deltaSize, _ledgerTotalsCache.size)
          raw = buf.toString("utf-8", 0, bytesRead)
        } finally {
          try { closeSync(fd) } catch {}
        }
      } else {
        incremental = false
      }
      delegation = _ledgerTotalsCache.delegation
      cache = _ledgerTotalsCache.cache
      context7 = _ledgerTotalsCache.context7
      entries = _ledgerTotalsCache.entries
    }
    if (!incremental) {
      raw = readFileSync(SAVINGS_LEDGER_FILE, "utf-8")
    }
    if (!raw.trim()) {
      _ledgerTotalsCache = {
        mtime: currentStat.mtimeMs,
        size: currentStat.size,
        delegation,
        cache,
        context7,
        entries,
      }
      return {
        delegation: Math.round(delegation * 1000) / 1000,
        cache: Math.round(cache * 1000) / 1000,
        context7: Math.round(context7 * 1000) / 1000,
        total: Math.round((delegation + cache) * 1000) / 1000,
        entries,
      }
    }
    const lines = raw.split("\n")
    if (raw.endsWith("\n")) lines.pop()
    for (const line of lines) {
      const ln = line.trim()
      if (!ln) continue
      let rec: unknown = null
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
    _ledgerTotalsCache = { mtime: currentStat.mtimeMs, size: currentStat.size, delegation, cache, context7, entries }
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

// Cheap probe for the footer's display debounce: lets a cached footer skip its
// expensive state resolution UNLESS the savings ledger actually changed (the
// same mtime+size gate reconcileStateFromLedger uses), so new savings entries
// are never hidden for the debounce window.
export function ledgerStatNow(): { mtime: number; size: number } {
  try {
    const st = existsSync(SAVINGS_LEDGER_FILE) ? statSync(SAVINGS_LEDGER_FILE) : null
    return { mtime: st?.mtimeMs || 0, size: st?.size || 0 }
  } catch {
    return { mtime: 0, size: 0 }
  }
}

function reconcileStateFromLedger(): void {
  try {
    const ledgerStat = existsSync(SAVINGS_LEDGER_FILE) ? statSync(SAVINGS_LEDGER_FILE) : null
    const ledgerMtime = ledgerStat?.mtimeMs || 0
    const ledgerSize = ledgerStat?.size || 0
    if (ledgerMtime === _ledgerReconciledMtime && ledgerSize === (_savingsCache?._ledgerSize || 0)) return
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
    updateState((s) => {
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" }
      s.lifetime.total_savings_usd = l.delegation
      s.lifetime.cache_savings_usd = l.cache
      s.lifetime.missed_context7_usd = l.context7
      s.lifetime.last_updated = new Date().toISOString()
      s.lifetime.rebuilt_from_ledger = true
      s.lifetime.ledger_entries_reconciled = l.entries
      return s
    })
    _savingsCache = null
    _savingsCacheMtime = 0
    invalidateSavingsCache()
  } catch {}
}

function readLifetimeSavings(): unknown {
  const empty = { ltTasks: 0, ltCache: 0, ltCost: 0, count: 0, scratchpadHits: 0, missedC7: 0, sesTasks: 0, sesEdit: 0, sesCredit: 0, sesC7: 0, sesQuota: 0, sesTaskDelegations: 0, sesDuration: 0, sesRatePerHour: 0, sesTrend: "stable", sesToolBreakdown: {}, sesModelTurns: { brain: 0, worker: 0 }, quality_avg: 0, telemetry: readTelemetrySummary({}, _OC_SID) }
  try {
    reconcileStateFromLedger()
    const delegationStateFile = join(getVibeOSHome(), "delegation-state.json")
    if (!existsSync(delegationStateFile)) return empty
    const stat = statSync(delegationStateFile)
    const mtime = stat.mtimeMs
    const size = stat.size
    if (_savingsCache && mtime === _savingsCacheMtime && size === Number(_savingsCache?._stateSize || 0)) return _savingsCache
    const s = safeJsonParse(readFileSync(delegationStateFile, "utf-8"))
    const ledgerSize = existsSync(SAVINGS_LEDGER_FILE) ? statSync(SAVINGS_LEDGER_FILE).size : 0
    _savingsCache = { ..._computeSessionMetrics(s, _OC_SID), telemetry: readTelemetrySummary(s, _OC_SID), _ledgerSize: ledgerSize, _stateSize: size }
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

function loadSessionOrchestration(sessionId: string): unknown {
  try {
    const state = readFullState()
    const session = state?.sessions?.[sessionId] || {}
    return normalizeSessionOrchestration(session?.orchestration || null, sessionId)
  } catch {
    return normalizeSessionOrchestration(null, sessionId)
  }
}

function mutateSessionOrchestration(sessionId: string, mutator: (current: unknown) => unknown): unknown {
  try {
    return updateState((state) => {
      state.sessions ??= {}
      state.sessions[sessionId] ??= {}
      const current = normalizeSessionOrchestration(state.sessions[sessionId].orchestration || null, sessionId)
      const next = mutator(current) || current
      state.sessions[sessionId].orchestration = normalizeSessionOrchestration(next, sessionId)
      return state
    })
  } catch {
    return null
  }
}

function updateSessionOrchestration(sessionId: string, action: string, payload: unknown = {}): unknown {
  return mutateSessionOrchestration(sessionId, (current) => applySessionAction(current, action, { ...payload, session_id: sessionId }))
}

function getLatestCacheEvent(sid: string): { hit: boolean; est_savings_usd: number } {
  try {
    const s = readFullState()
    const hits = s?.sessions?.[sid]?.cache_hits
    if (!Array.isArray(hits) || hits.length === 0) return { hit: false, est_savings_usd: 0 }
    const last = hits[hits.length - 1]
    return { hit: true, est_savings_usd: Number(last?.est_savings_usd || 0) }
  } catch { return { hit: false, est_savings_usd: 0 } }
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
  textCompletePainted,
  softQuotaCounts,
  warnLogThrottle,
  recentToolEvents,
  frictionSessionKeys,
  routineSessionKeys,
  lastMutationEvent,
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

  // Blackbox state
  _blackboxTracker,
  _blackboxEnabled,
  _detectedFramework,

  // JSONC parsing
  safeJsonParse,

  // State management
  validateState,
  readJsonOrEmpty,
  readFullState,
  writeFullState,
  loadSessionOrchestration,
  mutateSessionOrchestration,
  updateSessionOrchestration,
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
  removeJobRecord,
  loadJobRecord,

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
  readLedgerTotals,
  reconcileStateFromLedger,
  readLifetimeSavings,
  getLatestCacheEvent,
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
}

// ── Status / Savings Payload Stubs ────────────────────────────────────
// These are defined inline in index.ts but imported from state.js.
// The import in index.ts evaluates first; index.ts then shadows with its own definitions.
// These stubs throw if index.ts is not loaded (isolated module test).

// ── Alias exports for hooks/tool-execute.ts compatibility ───────────
export {
  textCompletePainted as _textCompletePainted,
  writeSelection as _writeSelection,
  withFileLock as _withFileLock,
  safeJsonParse as _safeJsonParse,
  getSessionIndexPath as _getSessionIndexPath,
  indexAppend as _indexAppend,
  loadActiveJobs as _loadActiveJobs,
  detectTechStack as _detectTechStack,
  projectFingerprint as _projectFingerprint,
  loadProjectState as _loadProjectState,
  saveProjectState as _saveProjectState,
  ensureProjectBucket as _ensureProjectBucket,
  mergeProjectBucket,
  loadTodos as _loadTodos,
  loadMLState as _loadMLState,
  saveMLState as _saveMLState,
  mergeProjectBucket as _mergeProjectBucket,
  readJsonOrEmpty as _readJsonOrEmpty,
  getLearnedExploratoryWords as _getLearnedExploratoryWords,
  updateState as _updateState,
  scratchpadHitsSeen as _scratchpadHitsSeen,
  readLifetimeSavings as _readLifetimeSavings,
}
