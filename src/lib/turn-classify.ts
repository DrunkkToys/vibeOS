// @ts-nocheck

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, copyFileSync, renameSync, openSync, closeSync, rmSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import { homedir, tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { safeJsonParse, _blackboxEnabled, setBlackboxEnabled as _setGlobalBlackboxEnabled } from "./state.js"
import { loadSessionOptMode, writeSessionOptMode } from "./selection-manager.js"
import { getApiClient, isApiFallback } from "./api-client.js"

type OptimizationMode = "audit" | "balanced" | "budget" | "quality" | "speed" | "longrun" | "auto"

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

const USER_HOME = (() => { try { return homedir() } catch { return tmpdir() } })()

const FILE_LOCK_DIR = join(USER_HOME, ".claude/.vibeOS-locks")
const BLACKBOX_STATE_FILE = join(USER_HOME, ".claude/blackbox-state.json")
const GLOBAL_LEARNING_FILE = join(USER_HOME, ".claude/global-learning.json")
const STATE_FILE = join(USER_HOME, ".claude/delegation-state.json")
const PROJECT_STATE_FILE = join(USER_HOME, ".claude/project-states.json")

export const DFLT_GL = { exploratory_words: {}, task_first_words: {}, updatedAt: null }

let _blackboxTracker = null
const _OC_SID = "opencode-" + (process.pid || "x") + "-" + Date.now()
let currentProjectFingerprint = ""
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

function _handleStateCorruption(path) {
  const backupDir = join(USER_HOME, ".claude", ".backups")
  mkdirSync(backupDir, { recursive: true })
  const backupPath = join(backupDir, basename(path) + ".corrupted." + Date.now())
  try { copyFileSync(path, backupPath) } catch {}
  const logPath = join(USER_HOME, ".claude", ".state-corruption-log.jsonl")
  try { appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), path, backup: backupPath }) + "\n") } catch {}
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
  throw new Error("[vibeOS] lock not acquired for " + filePath + " after " + timeoutMs + "ms")
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

function validateState(state, path) {
  if (!state || typeof state !== "object") {
    console.error("[vibeOS] State validation failed: not an object at " + path)
    return
  }
  if (state.session_started_at && isNaN(Date.parse(state.session_started_at))) {
    console.error("[vibeOS] State validation warning: invalid session_started_at at " + path + ", resetting")
    state.session_started_at = new Date().toISOString()
  }
  if (state.sessions && Array.isArray(state.sessions)) {
    console.error("[vibeOS] State validation: converting legacy sessions array to object at " + path)
    state.sessions = {}
  } else if (state.sessions && !Array.isArray(state.sessions) && (typeof state.sessions !== "object" || state.sessions === null)) {
    console.error("[vibeOS] State validation warning: sessions is invalid type at " + path + ", resetting")
    state.sessions = {}
  }
  if (state.lifetime && typeof state.lifetime !== "object") {
    console.error("[vibeOS] State validation warning: lifetime is not object at " + path + ", resetting")
    state.lifetime = {}
  }
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
    console.error("[vibeOS] saveBlackboxState failed: " + err.message)
  }
}

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

export function detectOutcomeSignal(text) {
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

export function scoreStress(text) {
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

export function estimateContextBudget(_input, output) {
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

export function classifyTurnSimple(userText) {
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

export function extractLastUserText(obj) {
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

export function isLikelyOffTopic(userText, job) {
  if (!userText || !job?.keywords?.length) return false
  if (/\b(new task|switch task|different task|ignore previous|start over)\b/i.test(userText)) return false
  const now = Date.now()
  const updatedAt = Date.parse(job.updatedAt || "")
  if (!Number.isFinite(updatedAt) || now - updatedAt > 5 * 60 * 1000) return false
  const userWords = new Set(topKeywords(userText, 12))
  const overlap = job.keywords.filter((k) => userWords.has(k))
  return overlap.length === 0 && userWords.size >= 3
}

export function loadGlobalLearning() {
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

export function updateGlobalLearning(mutator) {
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

export function getLearnedExploratoryWords() {
  const out = new Set()
  try {
    const gl = loadGlobalLearning()
    for (const [w, meta] of Object.entries(gl.exploratory_words || {})) {
      if ((meta?.count || 0) >= 1) out.add(String(w))
    }
  } catch {}
  return out
}

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
    console.error("[vibeOS] project state write failed: " + err.message)
  }
}

export function detectTechStack(dir) {
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

// Soft counter for hypothetical missed savings (no locking — drift acceptable
// for a hypothetical metric). Mirrors bash record_missed_c7().
function recordMissedContext7(saveEst) {
  try {
    const state = updateState((s) => {
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" }
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
  // Turn classification
  estimateContextBudget,
  classifyTurnSimple,
  tokenizeWords,
  topKeywords,
  // Blackbox
  getBlackboxTracker,
  getBlackboxResolution,
  resolveEnforcementMode,
  detectOutcomeSignal,
  syncOutcomeToApi,
  fetchBlackboxEnrichment,
  // Warnings
  extractFirstWordFromArgs,
  shouldLogWarn,
  // Context detection
  extractLastUserText,
  isUserAskingForTests,
  isLikelyOffTopic,
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
}
