/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2026 theSaver <https://github.com/DrunkkToys/theSaver-oc>
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
 * Sister hook: ~/.claude/hooks/delegation-enforcer.sh (Claude Code).
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, readdirSync, openSync, readSync, closeSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { tool } from "@opencode-ai/plugin"
import { checkFlowRules, getFlowWarns, getSessionFlowCounts } from "./flow-enforcer.js"

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
const STATE_FILE = join(homedir(), ".claude/delegation-state.json")

// Dedupe set: assistantMessageIds that already had the savings tag appended
// during this sidecar's lifetime.
const textCompletePainted = new Set()

// Max lines before rotating session-reports.log.
const MAX_LOG_LINES = 500

// Tier regexes — load from ~/.claude/model-tiers.json (single source of truth
// shared with the bash hook). Falls back to inline regexes if file missing or
// malformed, so the plugin never fails to load due to tier-config issues.
const FALLBACK_HIGH = /opus|gemini-.*-pro|deepseek\/deepseek-v4-pro|gpt-5|(^|\/)o[134]($|-|\/)/i
const FALLBACK_MID  = /deepseek\/deepseek-v4-flash|claude.*sonnet|gemini-.*-flash|gpt-4o(?!-mini)/i
function loadTierRegexes() {
  try {
    const p = join(homedir(), ".claude/model-tiers.json")
    if (!existsSync(p)) return { high: FALLBACK_HIGH, mid: FALLBACK_MID }
    const j = JSON.parse(readFileSync(p, "utf-8"))
    return {
      high: new RegExp(j?.tiers?.high?.regex ?? FALLBACK_HIGH.source, "i"),
      mid:  new RegExp(j?.tiers?.mid?.regex  ?? FALLBACK_MID.source,  "i"),
    }
  } catch { return { high: FALLBACK_HIGH, mid: FALLBACK_MID } }
}
const { high: HIGH_TIER_RE, mid: MID_TIER_RE } = loadTierRegexes()

function loadTrinityModels() {
  try {
    const p = join(homedir(), ".claude/model-tiers.json")
    if (!existsSync(p)) return { cheap: "", medium: "" }
    const j = JSON.parse(readFileSync(p, "utf-8"))
    return {
      cheap:  j?.trinity?.cheap?.oc  || j?.trinity?.cheap  || "",
      medium: j?.trinity?.medium?.oc || j?.trinity?.medium || "",
    }
  } catch { return { cheap: "", medium: "" } }
}
const { cheap: TRINITY_CHEAP, medium: TRINITY_MEDIUM } = loadTrinityModels()

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
    const f = join(homedir(), ".claude/credit-percent")
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

// Read plugin enabled flag + active_slot fresh from model-tiers.json.
// Called per-hook so live edits (trinity on/off) take effect without restart.
const TIERS_FILE = join(homedir(), ".claude/model-tiers.json")
function loadSelection() {
  try {
    if (!existsSync(TIERS_FILE)) return { enabled: true, active_slot: null, thinking_level: null, flow_enabled: true }
    const j = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
    return {
      enabled:        j?.selection?.enabled !== false,
      active_slot:    j?.selection?.active_slot || null,
      thinking_level: j?.selection?.thinking_level || null,
      flow_enabled:   j?.selection?.flow_enabled !== false,
    }
  } catch { return { enabled: true, active_slot: null, thinking_level: null, flow_enabled: true } }
}

// Write a single key into selection block of model-tiers.json.
function writeSelection(key, value) {
  try {
    const j = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
    j.selection[key] = value
    writeFileSync(TIERS_FILE, JSON.stringify(j, null, 2) + "\n")
    return true
  } catch (err) {
    console.error(`[delegation-enforcer] writeSelection failed: ${err.message}`)
    return false
  }
}

// Write active_slot AND update opencode.json model to the matching oc model.
function applySlot(slot) {
  try {
    const j = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
    const ocModel = j?.trinity?.[slot]?.oc
    if (!ocModel) return { ok: false, reason: `slot '${slot}' has no oc model` }
    j.selection.active_slot = slot
    writeFileSync(TIERS_FILE, JSON.stringify(j, null, 2) + "\n")
    // Also write to opencode.json so next session picks it up.
    const ocConfig = join(homedir(), ".config/opencode/opencode.json")
    if (existsSync(ocConfig)) {
      const oc = JSON.parse(readFileSync(ocConfig, "utf-8"))
      oc.model = ocModel
      writeFileSync(ocConfig, JSON.stringify(oc, null, 2) + "\n")
    }
    return { ok: true, ocModel }
  } catch (err) {
    return { ok: false, reason: err.message }
  }
}

// Map a model ID to a human-readable label with tier icon.
// Provider prefix is stripped before matching (everything before last "/").
function modelToSlotLabel(modelId, effectiveTier) {
  const tier = effectiveTier ?? classify(modelId)
  const icon = tier === "high" ? "🧠" : tier === "mid" ? "⚙" : "⚡"
  return `[${icon} ${tier.charAt(0).toUpperCase() + tier.slice(1)}]`
}

function classify(m) {
  const s = String(m || "").toLowerCase()
  if (HIGH_TIER_RE.test(s)) return "high"
  if (MID_TIER_RE.test(s))  return "mid"
  return "budget"
}

// Memory mode: never throw / never stop. Track "would-have-blocked" events
// and surface cumulative savings to the GUI via experimental.text.complete.
const WARN_ON_DIRECT = new Set(["write", "edit", "notebookedit"])
const SOFT_QUOTA     = new Set(["bash", "webfetch", "websearch"])
const FREE           = new Set(["task","todowrite","question","skill","read","glob","grep","list"])

// Estimated $ savings per warn — fallback constants (used when model is unknown).
// Dynamic estimates are computed via modelCostPerTurn() below.
const SAVE_EST = {
  WRITE_EDIT:   0.07,  // fallback: high-tier model doing one edit turn
  SOFT_QUOTA:   0.00,  // tool runs regardless — no real saving
  CONTEXT7:     0.05,  // fallback: webfetch turn cost for a high-tier model
  OPUS_DISABLE: 0.14,  // fallback: full-turn cost for a high-tier model
}

// Models available at $0 on OpenCode's platform.
const FREE_MODELS = new Set([
  "deepseek/deepseek-chat",
  "deepseek-chat",
  "deepseek/deepseek-v3",       // free on some providers
])

// Approximate USD per typical ~1 K-token turn (blended input+output).
// Add entries as new models appear; unknown models fall back to SAVE_EST constants.
const MODEL_USD_PER_TURN = {
  "anthropic/claude-opus-4-7":            0.12,
  "anthropic/claude-opus-4-5":            0.12,
  "anthropic/claude-sonnet-4-6":          0.024,
  "anthropic/claude-sonnet-4-5":          0.024,
  "anthropic/claude-haiku-4-5":           0.005,
  "anthropic/claude-haiku-4-5-20251001":  0.005,
  "deepseek/deepseek-chat":               0,
  "deepseek-chat":                        0,
  "deepseek/deepseek-v3":                 0,
  "deepseek/deepseek-r1":                 0.001,
  "deepseek/deepseek-v4-pro":             0.0003,
  "deepseek/deepseek-v4-flash":           0.0001,
  "google/gemini-2.5-pro":                0.005,
  "google/gemini-2.5-flash":              0.0005,
  "google/gemini-2.0-flash":              0.0003,
  "openai/gpt-4o":                        0.009,
  "openai/gpt-4.1":                       0.009,
  "openai/gpt-4o-mini":                   0.0003,
  "openai/gpt-4.1-mini":                  0.0003,
  "openai/o3":                            0.05,
  "openai/o4-mini":                       0.003,
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

export function modelCostPerTurn(model) {
  if (!model) return 0
  const key = normalizeModelId(model)
  if (key in MODEL_USD_PER_TURN) return MODEL_USD_PER_TURN[key]
  // Prefix match for versioned model IDs (e.g. "claude-opus-4-7-20251001")
  for (const [k, v] of Object.entries(MODEL_USD_PER_TURN)) {
    if (key.startsWith(k) || k.startsWith(key)) return v
  }
  // Log unknown models so we can add entries
  console.error(`[delegation-enforcer] modelCostPerTurn: unknown model '${model}' (normalized: '${key}') — add to MODEL_USD_PER_TURN`)
  return null  // unknown — callers fall back to SAVE_EST constants
}

export function isModelFree(model) {
  const cost = modelCostPerTurn(model)
  return cost !== null && cost === 0
}

// Context7 detection — scan known config files for the string "context7".
// Cheap (one-time at module load); falsy → docs nudge stays dormant.
const CONTEXT7_CONFIG_FILES = [
  join(homedir(), ".claude/settings.json"),
  join(homedir(), ".claude.json"),
  join(homedir(), ".config/opencode/opencode.json"),
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
const SCRATCHPAD_DIR = join(homedir(), ".claude/scratch/by-hash")
const SCRATCHPAD_MAX_AGE_SEC = Number(process.env.CLAUDE_SCRATCHPAD_MAX_AGE_SEC || 86400)
const TOOL_NAME_NORMALIZE = {
  read: "Read", bash: "Bash", grep: "Grep", glob: "Glob",
  webfetch: "WebFetch", websearch: "WebSearch", list: "LS",
}
const SCRATCHPAD_TOOLS = new Set(Object.keys(TOOL_NAME_NORMALIZE))
// Per-process dedup so the same hit isn't logged 5x in one turn.
const scratchpadHitsSeen = new Set()

export function getScratchpadHit(toolLower, args, baseDir = SCRATCHPAD_DIR) {
  if (!SCRATCHPAD_TOOLS.has(toolLower)) return null
  const titleCase = TOOL_NAME_NORMALIZE[toolLower]
  // Use stable JSON (sorted keys) so OC and CC produce the same hash
  // regardless of property insertion order.
  const inputJson = stableJson(args ?? {})
  const hash = createHash("sha256").update(`${titleCase}\n${inputJson}\n`).digest("hex").slice(0, 16)
  const fullPath = join(baseDir, `${hash}.txt`)
  if (!existsSync(fullPath)) {
    // Fallback: scan for any file created in the last 2s (cross-runtime hash mismatch recovery)
    const recent = scanRecentScratchpad(baseDir, titleCase, 2000)
    if (recent) return recent
    return null
  }
  try {
    const st = statSync(fullPath)
    const ageSec = (Date.now() - st.mtimeMs) / 1000
    if (ageSec > SCRATCHPAD_MAX_AGE_SEC) return null
    const summaryPath = join(baseDir, `${hash}.summary.txt`)
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
    let state = {}
    if (existsSync(STATE_FILE)) {
      try { state = JSON.parse(readFileSync(STATE_FILE, "utf-8")) } catch {}
    } else { mkdirSync(dirname(STATE_FILE), { recursive: true }) }
    state.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" }
    state.lifetime.scratchpad_hits_observed = (state.lifetime.scratchpad_hits_observed || 0) + 1
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
    return state.lifetime.scratchpad_hits_observed
  } catch { return null }
}

// One-time install-suggestion flag (persisted across processes) and
// per-session alert flag (process lifetime is fine — sidecar == session).
const CONTEXT7_INSTALL_FLAG = join(homedir(), ".claude/.context7-install-suggested")
let context7AlertedThisSession = false

// Pending UI note: set in tool.execute.before, consumed in tool.execute.after.
// Lets the delegation warning appear in the OC chat transcript (tool result),
// not just in stderr debug output.
let pendingUiNote = null

// Soft counter for hypothetical missed savings (no locking — drift acceptable
// for a hypothetical metric). Mirrors bash record_missed_c7().
function recordMissedContext7(saveEst) {
  try {
    let state = {}
    if (existsSync(STATE_FILE)) {
      try { state = JSON.parse(readFileSync(STATE_FILE, "utf-8")) } catch {}
    } else {
      mkdirSync(dirname(STATE_FILE), { recursive: true })
    }
    state.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" }
    state.lifetime.missed_context7_usd = Math.round(
      ((state.lifetime.missed_context7_usd || 0) + saveEst) * 100
    ) / 100
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
    return state.lifetime.missed_context7_usd
  } catch { return null }
}

// Test-reminder: per-process dedup so we don't nudge for the same file twice.
const testReminderSeen = new Set()
const SOURCE_EXT_RE = /\.(py|js|ts|mjs|tsx|jsx|sh|go|rs|rb|java|kt)$/i
const SKIP_PATH_RE = /(\/(node_modules|\.venv|dist|build|__pycache__)\/|\/(tests?|spec)\/|test_[^/]+\.py$|_test\.py$|\.test\.[a-z]+$|\.spec\.[a-z]+$|\.config\/opencode\/plugins\/)/i

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
  return `🧪 Code changed at ${filePath} — add/update tests (suggested: ${suggest}) before marking complete.`
}

function recordSaving(tool, reason, saveEst) {
  try {
    let state = {}
    if (existsSync(STATE_FILE)) {
      try { state = JSON.parse(readFileSync(STATE_FILE, "utf-8")) } catch {}
    } else {
      mkdirSync(dirname(STATE_FILE), { recursive: true })
    }
    const now = new Date().toISOString()
    state.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" }
    state.lifetime.warn_count = (state.lifetime.warn_count || 0) + 1
    state.lifetime.est_savings_usd = Math.round(((state.lifetime.est_savings_usd || 0) + saveEst) * 1000) / 1000
    state.lifetime.last_updated = now
    state.sessions ??= {}
    const sid = "opencode-" + (process.pid || "x")
    state.sessions[sid] ??= { started: now, source: "opencode", tool_counts: {}, warns: [] }
    state.sessions[sid].tool_counts[tool] = (state.sessions[sid].tool_counts[tool] || 0) + 1
    state.sessions[sid].warns.push({ at: now, tool, reason, est_savings_usd: saveEst })
    if (state.sessions[sid].warns.length > 200) {
      state.sessions[sid].warns = state.sessions[sid].warns.slice(-200)
    }
    _pruneOldSessions(state)
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
    return state.lifetime.est_savings_usd
  } catch (err) {
    console.error(`[delegation-enforcer] state write failed: ${err.message}`)
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
    const { bytesRead } = readSync(fd, buf, 0, bufSize, pos)
    closeSync(fd)
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
const _OC_SID = "opencode-" + (process.pid || "x")
function readLifetimeSavings() {
  const empty = { ltTasks: 0, ltCache: 0, ltCost: 0, count: 0, scratchpadHits: 0, missedC7: 0, sesTasks: 0, sesEdit: 0, sesCredit: 0, sesC7: 0, sesQuota: 0 }
  try {
    if (!existsSync(STATE_FILE)) return empty
    const mtime = statSync(STATE_FILE).mtimeMs
    if (_savingsCache && mtime === _savingsCacheMtime) return _savingsCache
    const s = JSON.parse(readFileSync(STATE_FILE, "utf-8"))

    // Compute ALL totals from session data atomically — never from separate lifetime fields
    // written by different processes. This eliminates the savings-counter bounce.
    let ltTasks = 0; let ltCache = 0; let ltCost = 0; let totalWarnCount = 0
    for (const [, ses] of Object.entries(s?.sessions || {})) {
      // Delegation savings from warns
      const warns = Array.isArray(ses?.warns) ? ses.warns : []
      totalWarnCount += warns.length
      for (const w of warns) ltTasks += Number(w.est_savings_usd ?? 0)
      // Cache savings and costs from costed sessions
      ltCache += Number(ses?.cache_savings_usd ?? 0)
      ltCost  += Number(ses?.cost_usd ?? 0)
    }

    // Per-warn-type session totals (current process only)
    const ses = s?.sessions?.[_OC_SID]
    const warns = Array.isArray(ses?.warns) ? ses.warns : []
    const sesTasks = warns.reduce((a, w) => a + Number(w.est_savings_usd ?? 0), 0)
    const sesEdit   = warns.filter(w => w.reason?.includes("direct edit")).reduce((a, w) => a + Number(w.est_savings_usd ?? 0), 0)
    const sesCredit = warns.filter(w => w.reason?.includes("credit")).reduce((a, w)    => a + Number(w.est_savings_usd ?? 0), 0)
    const sesC7     = warns.filter(w => w.reason?.includes("context7")).reduce((a, w)  => a + Number(w.est_savings_usd ?? 0), 0)
    const sesQuota  = warns.filter(w => w.reason?.includes("quota")).reduce((a, w)     => a + Number(w.est_savings_usd ?? 0), 0)

    _savingsCache = {
      ltTasks: Math.round(ltTasks * 100) / 100,
      ltCache: Math.round(ltCache * 100) / 100,
      ltCost:  Math.round(ltCost * 100) / 100,
      count:   totalWarnCount,
      scratchpadHits: Number(s?.lifetime?.scratchpad_hits_observed ?? 0),
      missedC7:       Number(s?.lifetime?.missed_context7_usd      ?? 0),
      sesTasks, sesEdit, sesCredit, sesC7, sesQuota,
    }
    _savingsCacheMtime = mtime
    return _savingsCache
  } catch { return empty }
}

function readConfig(dir) {
  try {
    const raw = readFileSync(join(dir, "opencode.json"), "utf-8")
    const c = JSON.parse(raw)
    return c?.agent?.build?.model || c?.model || ""
  } catch { return "" }
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
const DECADENCE_THROTTLE_MS = 60 * 1000              // run max once per minute
const MAX_SCRATCHPAD_FILES  = 1000
const MAX_SCRATCHPAD_BYTES  = 10 * 1024 * 1024       // 10MB
let _lastDecadenceRun = 0
const INDEX_PATH = join(homedir(), ".claude/scratch/index.jsonl")

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

function indexAppend(hash, tool, size, extra) {
  try {
    mkdirSync(dirname(INDEX_PATH), { recursive: true })
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      hash, tool, size,
      pid: process.pid || 0,
      source: "opencode",
      ...extra,
    }) + "\n"
    appendFileSync(INDEX_PATH, entry)
  } catch (err) {
    console.error(`[delegation-enforcer] index write failed: ${err.message}`)
  }
}

function applyDecadence() {
  const now = Date.now()
  if (now - _lastDecadenceRun < DECADENCE_THROTTLE_MS) return
  _lastDecadenceRun = now
  try {
    if (!existsSync(SCRATCHPAD_DIR)) return
    const entries = readdirSync(SCRATCHPAD_DIR)
    let dataFiles = 0; let totalBytes = 0; let deleted = 0; let rotated = 0
    for (const entry of entries) {
      if (entry.endsWith(".meta.json") || entry.endsWith(".summary.txt")) continue
      const fullPath = join(SCRATCHPAD_DIR, entry)
      let st
      try { st = statSync(fullPath) } catch { continue }
      const age = now - st.mtimeMs
      const hash = entry.replace(/\.txt$/, "")
      // >48h: delete all associated files
      if (age > DECADENCE_EXPIRE_MS) {
        rmSync(fullPath)
        const meta = join(SCRATCHPAD_DIR, hash + ".meta.json")
        if (existsSync(meta)) rmSync(meta)
        const summary = join(SCRATCHPAD_DIR, hash + ".summary.txt")
        if (existsSync(summary)) rmSync(summary)
        deleted++; continue
      }
      dataFiles++; totalBytes += st.size
      // 24-48h: COLD — replace full content with compact summary pointer
      if (age > DECADENCE_COLD_MS) {
        const summaryPath = join(SCRATCHPAD_DIR, hash + ".summary.txt")
        if (!existsSync(summaryPath)) {
          const content = readFileSync(fullPath, "utf-8")
          writeFileSync(summaryPath, content.slice(0, 200).replace(/\n+/g, " ").trim() + (content.length > 200 ? "…" : ""))
        }
        const head = _readHead(fullPath)
        if (!head.includes("[cold-storage]")) {
          writeFileSync(fullPath, `[cold-storage] ${st.size}B original → ${hash}.summary.txt`)
          rotated++
        }
        continue
      }
      // 5min-24h: WARM — rotate large files (>1KB) to summary-only
      if (age > DECADENCE_FRESH_MS && st.size > 1024) {
        const summaryPath = join(SCRATCHPAD_DIR, hash + ".summary.txt")
        if (!existsSync(summaryPath)) {
          const content = readFileSync(fullPath, "utf-8")
          writeFileSync(summaryPath, content.slice(0, 500).replace(/\n+/g, " ").trim() + (content.length > 500 ? "…" : ""))
        }
        const head = _readHead(fullPath)
        if (!head.includes("[warm-storage]") && !head.includes("[cold-storage]")) {
          writeFileSync(fullPath, `[warm-storage] ${st.size}B original at ${hash}.summary.txt`)
          rotated++
        }
      }
    }
    // Hard eviction if count or size still exceeds limits
    if (dataFiles > MAX_SCRATCHPAD_FILES || totalBytes > MAX_SCRATCHPAD_BYTES) {
      const candidates = entries
        .filter(e => !e.endsWith(".meta.json") && !e.endsWith(".summary.txt"))
        .map(e => {
          try { return { name: e, mtime: statSync(join(SCRATCHPAD_DIR, e)).mtimeMs } }
          catch { return null }
        })
        .filter(Boolean)
        .sort((a, b) => a.mtime - b.mtime)
      const toRemove = Math.ceil(candidates.length * 0.3)
      for (let i = 0; i < toRemove; i++) {
        const base = join(SCRATCHPAD_DIR, candidates[i].name)
        try { rmSync(base) } catch {}
        const meta = base.replace(".txt", ".meta.json")
        if (existsSync(meta)) try { rmSync(meta) } catch {}
        const summary = base.replace(".txt", ".summary.txt")
        if (existsSync(summary)) try { rmSync(summary) } catch {}
        deleted++
      }
    }
    if (deleted > 0 || rotated > 0) {
      const action = []
      if (rotated > 0) action.push(`rotated=${rotated}`)
      if (deleted > 0) action.push(`deleted=${deleted}`)
      console.error(`[delegation-enforcer] 📦 decadence: ${action.join(" ")} (${dataFiles} files, ${Math.round(totalBytes/1024)}KB)`)
    }
  } catch (err) {
    console.error(`[delegation-enforcer] decadence error: ${err.message}`)
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
    console.error(`[delegation-enforcer] COMPRESS: ${text.length}→${result.length} chars (${removed} verbose lines stripped)`)
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
    const script = join(homedir(), ".claude/hooks/scratchpad-prune.sh")
    if (existsSync(script)) {
      const child = spawn("bash", [script], { detached: true, stdio: "ignore" })
      child.unref()
    }
  } catch { /* prune is best-effort */ }
  // Inline size cap: use decadence thresholds, remove oldest 30%
  try {
    const dir = SCRATCHPAD_DIR
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
    console.error(`[delegation-enforcer] pruned ${remove} scratchpad files (${txtFiles.length} → ${txtFiles.length - remove})`)
  } catch {}
}

// ── Project memory — cross-session continuity ───────────────────────
const PROJECT_STATE_FILE = join(homedir(), ".claude/project-states.json")
const briefedProjects = new Set()

function projectFingerprint(dir) {
  if (!dir) return "unknown"
  return createHash("sha256").update(dir).digest("hex").slice(0, 12)
}

function loadProjectState() {
  try {
    if (existsSync(PROJECT_STATE_FILE)) {
      return JSON.parse(readFileSync(PROJECT_STATE_FILE, "utf-8"))
    }
  } catch {}
  return { project_hashes: {} }
}

function saveProjectState(state) {
  try {
    writeFileSync(PROJECT_STATE_FILE, JSON.stringify(state, null, 2) + "\n")
  } catch (err) {
    console.error(`[delegation-enforcer] project state write failed: ${err.message}`)
  }
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
    return lines.join("\n")
  } catch { return null }
}

// Refresh currentModel/currentTier from disk config.
// Called per-hook so trinity slot changes take effect without restart.
function _refreshModel(directory) {
  try {
    const sel = loadSelection()
    if (!sel.enabled) return
    const tiersData = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
    const activeSlot = sel.active_slot || "brain"
    const slotOcModel = tiersData?.trinity?.[activeSlot]?.oc || ""
    if (slotOcModel && currentModel !== slotOcModel) {
      const old = currentModel
      currentModel = slotOcModel
      // Brain slot → enforce delegation (treat as high even for mid-classified models like sonnet)
      // Medium/cheap slots → skip high-tier enforcement (no point warning on $0.0001/turn models)
      currentTier = activeSlot === "brain" ? "high" : classify(currentModel)
      console.error(`[delegation-enforcer] model refresh: ${old} → ${currentModel} (slot=${activeSlot} tier=${currentTier})`)
    }
  } catch {}
}

export async function DelegationEnforcer({ client, directory }) {
  console.error(`[delegation-enforcer] LOADED cwd=${directory}`)
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
      const _tiersData = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
      const _activeSlot = _tiersData?.selection?.active_slot || "brain"
      if (_activeSlot === "brain") {
        const _brainOcModel = _tiersData?.trinity?.brain?.oc || ""
        if (_brainOcModel && currentModel === _brainOcModel) {
          currentTier = "high"
          console.error(`[delegation-enforcer] tier override → high (brain slot)`)
        }
      }
    } catch {}
    console.error(`[delegation-enforcer] ACTIVE: model=${currentModel} tier=${currentTier}`)
  } else {
    console.error("[delegation-enforcer] NO MODEL — enforcement disabled")
  }
  if (detectContext7()) console.error(`[delegation-enforcer] context7 detected — docs nudge enabled`)

  // ── Project memory: increment session counter ───────────────────
  const fp = projectFingerprint(directory)
  currentProjectFingerprint = fp
  currentProjectName = directory ? directory.split("/").pop() : "unknown"
  try {
    const state = loadProjectState()
    state.project_hashes[fp] ??= { totalSessions: 0, researchChains: 0, context7Bypasses: 0, commonTopics: [] }
    state.project_hashes[fp].totalSessions = (state.project_hashes[fp].totalSessions || 0) + 1
    state.project_hashes[fp].lastSeen = new Date().toISOString()
    saveProjectState(state)
    console.error(`[delegation-enforcer] project-memory: ${fp} now ${state.project_hashes[fp].totalSessions} sessions`)
  } catch (err) {
    console.error(`[delegation-enforcer] project-memory init failed: ${err.message}`)
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (!loadSelection().enabled) return
      _refreshModel(directory)
      const t = input?.tool ?? ""
      const args = output?.args

      // Scratchpad observation (all tiers) — read-only, never blocks.
      if (SCRATCHPAD_TOOLS.has(t)) {
        const hit = getScratchpadHit(t, args)
        if (hit && !scratchpadHitsSeen.has(hit.hash)) {
          scratchpadHitsSeen.add(hit.hash)
          const total = recordScratchpadObservation()
          const sumNote = hit.summaryPath ? ` (summary: ${hit.summaryPath})` : ""
          console.error(`[delegation-enforcer] 📦 scratchpad hit for ${t}: ${hit.fullPath} ${hit.sizeBytes}B ${hit.ageSec}s old${sumNote} — total observed: ${total ?? "?"}`)
        }
      }

      // Credit < 40% + Task: force to cheap slot (mirrors CC's rwh path).
      const _credit = loadCredit()
      if (_credit < 40 && t === "task" && TRINITY_CHEAP && args && typeof args === "object") {
        if (args.model !== TRINITY_CHEAP) {
          args.model = TRINITY_CHEAP
          console.error(`[delegation-enforcer] 🔀 Credit ${_credit}%: forcing Task → cheap slot (${TRINITY_CHEAP})`)
        }
        return
      }

      // Trinity rule: route Task subagents based on orchestrator tier.
      // Exploratory first-word detection → cheap (mirrors CC exploratory routing).
      // Then: high-tier brain → medium slot; mid-tier brain → cheap slot.
      if (t === "task" && currentModel && args && typeof args === "object") {
        const _prompt = (args?.prompt ?? "").trim().toLowerCase()
        const _firstWord = _prompt.split(/\s+/)[0]
        const EXPLORATORY = new Set(["check","find","list","search","does","verify","look","count","show","get","read","grep","scan","detect","inspect"])
        const _exploratoryTarget = EXPLORATORY.has(_firstWord) ? TRINITY_CHEAP : null
        const _tierTarget = (currentTier === "high" && TRINITY_MEDIUM) ? TRINITY_MEDIUM
                          : TRINITY_CHEAP ? TRINITY_CHEAP
                          : null
        const _target = _exploratoryTarget ?? _tierTarget
        if (_target && args.model !== _target) {
          const _reason = _exploratoryTarget ? `exploratory ('${_firstWord}')` : `tier=${currentTier}`
          args.model = _target
          console.error(`[delegation-enforcer] 🔀 Task → ${_target} (${_reason}, orchestrator: ${currentModel})`)
        }
      }

      if (currentTier !== "high") return
      if (FREE.has(t)) return
      // Free models have no per-turn cost — no savings to enforce.
      if (isModelFree(currentModel)) return

      // Dynamic save estimates derived from actual model pricing.
      const _brainCost  = modelCostPerTurn(currentModel)
      const _workerModel = TRINITY_CHEAP || TRINITY_MEDIUM || null
      const _workerCost  = _workerModel ? (modelCostPerTurn(_workerModel) ?? 0) : 0
      // Floor at SAVE_EST.WRITE_EDIT — never report $0 for a real enforcement event
      const _rawEdit    = _brainCost !== null
        ? Math.max(0, Math.round((_brainCost - _workerCost) * 1000) / 1000)
        : SAVE_EST.WRITE_EDIT
      const _estEdit    = Math.max(_rawEdit, SAVE_EST.WRITE_EDIT * 0.1)  // at least $0.007
      const _estOpus    = _brainCost !== null ? Math.max(_brainCost, _estEdit) : SAVE_EST.OPUS_DISABLE
      const _estC7      = _brainCost !== null ? Math.max(_brainCost, SAVE_EST.CONTEXT7) : SAVE_EST.CONTEXT7

      // Credit < 40%: high-tier non-task tool — record and nudge to step aside.
      if (_credit < 40) {
        const total = recordSaving(t, "credit<40% high-tier", _estOpus)
        const msg = `⚠ [theSaver] Credit ${_credit}% — brain model doing ${t} directly. Run \`trinity medium\` to switch. (~$${_estOpus.toFixed(3)}/turn, cumulative: $${(total ?? 0).toFixed(2)})`
        console.error(`[delegation-enforcer] [delegation] ${msg}`)
        pendingUiNote = msg
        return
      }

      // Write/Edit/NotebookEdit on high tier: warn and allow (memory mode).
      if (WARN_ON_DIRECT.has(t)) {
        const total = recordSaving(t, "high-tier direct edit", _estEdit)
        const msg = `⚠ [theSaver] Brain model doing ${t} directly — delegate via Task to save ~$${_estEdit.toFixed(3)}/turn. (cumulative: $${(total ?? 0).toFixed(2)})`
        console.error(`[delegation-enforcer] [delegation] ${msg}`)
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
              const total = recordSaving(t, "docs-target without context7", _estC7)
              console.error(`[delegation-enforcer] [cost policy] context7 MCP is available — if this ${t} is for library/framework docs, use context7 tools instead. Saves ~$${_estC7.toFixed(3)}/turn. (cumulative: $${(total ?? 0).toFixed(2)})`)
            } else {
              const missed = recordMissedContext7(_estC7)
              if (!existsSync(CONTEXT7_INSTALL_FLAG)) {
                try {
                  mkdirSync(dirname(CONTEXT7_INSTALL_FLAG), { recursive: true })
                  writeFileSync(CONTEXT7_INSTALL_FLAG, "")
                } catch {}
                console.error(`[delegation-enforcer] 💡 [one-time tip] Installing context7 MCP would save ~$${_estC7.toFixed(3)}/turn on docs lookups. Setup: \`claude mcp add context7 npx @upstash/context7-mcp\`. Won't ask again.`)
              } else if (!context7AlertedThisSession) {
                context7AlertedThisSession = true
                console.error(`[delegation-enforcer] 💸 [context7] Missed savings so far: $${(missed ?? 0).toFixed(2)} across docs lookups. Install when ready.`)
              }
            }
          }
        }
        // Soft quota: track per-tool, fire exactly once at QUOTA+1 (tool still runs).
        softQuotaCounts[t] = (softQuotaCounts[t] ?? 0) + 1
        const n = softQuotaCounts[t]
        if (n === SOFT_QUOTA_LIMIT + 1) {
          const total = recordSaving(t, `soft quota exceeded (limit ${SOFT_QUOTA_LIMIT})`, SAVE_EST.SOFT_QUOTA)
          console.error(`[delegation-enforcer] [delegation] ${t} #${n} (limit ${SOFT_QUOTA_LIMIT}) — consider Task subagent.`)
        } else if (n <= SOFT_QUOTA_LIMIT) {
          console.error(`[delegation-enforcer] ${t} ${n}/${SOFT_QUOTA_LIMIT}`)
        }
        return
      }
    },

    "tool.execute.after": async (input, output) => {
      if (!loadSelection().enabled) return
      _refreshModel(directory)
      const t = input?.tool ?? ""

      // Show human-friendly slot label in the UI title for Task subagents.
      if (t === "task") {
        const m = input?.args?.model
        if (m && typeof output?.title === "string") {
          const label = modelToSlotLabel(m)
          output.title = output.title.replace(/\[agent\]|\[general\]/gi, label)
          if (!output.title.includes(label)) output.title = `${output.title} ${label}`
        }
      }

      // Inject pending delegation UI note (set in tool.execute.before).
      // This surfaces the warning in the OC chat transcript, not just stderr.
      if (pendingUiNote) {
        const note = `\n\n${pendingUiNote}`
        if (typeof output?.result === "string") output.result += note
        else if (typeof output?.text === "string") output.text += note
        else output.result = pendingUiNote
        pendingUiNote = null
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
          else console.error(`[delegation-enforcer] ${reminder}`)
        }

        // Flow enforcer: check Write/Edit against development-flow rules.
        if (loadSelection().flow_enabled) {
          const toolName = t === "edit" ? "Edit" : "Write"
          const filePath = input?.args?.filePath || input?.args?.file_path || input?.args?.path || ""
          const content = t === "edit" ? (input?.args?.newString || "") : (input?.args?.content || "")
          const flowHits = checkFlowRules({ tool: toolName, filePath, content })
          for (const h of flowHits) {
            if (h.deduped) continue
            const icon = h.severity === "warn" ? "⚠" : "💡"
            console.error(`[flow-enforcer] ${icon} [${h.severity}] ${h.id}: ${h.description} — ${filePath}`)
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
            const fullPath = join(SCRATCHPAD_DIR, `${hash}.txt`)
            try {
              mkdirSync(SCRATCHPAD_DIR, { recursive: true })
              if (!existsSync(fullPath)) {
                writeFileSync(fullPath, raw)
                indexAppend(hash, part.tool, raw.length)
              }
            } catch (err) {
              console.error(`[delegation-enforcer] ctx-compress write failed: ${err.message}`)
              continue
            }

            if (!isCold) continue  // hot: disk backup only, keep full content in context

            const summary = raw.slice(0, 200).replace(/\n+/g, " ").trim() + (raw.length > 200 ? "…" : "")
            const ref =
              `${COMPRESS_MARKER} [${raw.length} chars compressed — cold storage at ${fullPath}] ` +
              `[summary] ${summary}`

            state.output = ref
            compressedBytes += raw.length - ref.length
            console.error(`[delegation-enforcer] 📦 ctx-compress: ${raw.length}→${ref.length} chars (hash: ${hash})`)
          }
        }
        if (compressedBytes > 0) {
          console.error(`[delegation-enforcer] 📦 ctx-compress total saved this transform: ~${Math.round(compressedBytes / 4)} tokens`)
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
        console.error(`[delegation-enforcer] messages.transform failed: ${err.message}`)
      }
    },

    // Hard-guaranteed GUI savings display.
    // `experimental.text.complete` fires when an assistant text part finishes
    // streaming, and whatever we return becomes the literal displayed text in
    // the OpenCode GUI. No instruction-following required.
    //
    // We append the cumulative savings tag exactly once per assistantMessageId
    // (the first text-end fires per message gets it; subsequent text parts in
    // the same message are skipped to avoid duplication).
    "experimental.text.complete": async (input, output) => {
      if (!loadSelection().enabled) return
      _refreshModel(directory)
      try {
        const messageID = input?.messageID
        if (!messageID) return
        if (textCompletePainted.has(messageID)) return

        const text = (output?.text ?? "")
        const { ltTasks, ltCache, ltCost, count, scratchpadHits, missedC7, sesTasks, sesEdit, sesCredit, sesC7, sesQuota } = readLifetimeSavings()
        const brainTag = currentModel ? modelToSlotLabel(currentModel, currentTier) : ""
        if (!brainTag && count === 0 && ltCache === 0) return

        textCompletePainted.add(messageID)
        // Bound the cache so a long-running sidecar doesn't grow it unbounded.
        if (textCompletePainted.size > 500) {
          const it = textCompletePainted.values()
          for (let i = 0; i < 100; i++) textCompletePainted.delete(it.next().value)
        }

        // Show brain → worker tier routing (two-tier aware)
        let modelTag = brainTag
        const _workerModel = (currentTier === "high" && TRINITY_MEDIUM) ? TRINITY_MEDIUM : TRINITY_CHEAP
        if (_workerModel && _workerModel !== currentModel) {
          const workerTag = modelToSlotLabel(_workerModel)
          if (workerTag !== brainTag) {
            const brainInner = brainTag.replace(/^\[|\]$/g, "")
            const workerInner = workerTag.replace(/^\[|\]$/g, "")
            modelTag = `[${brainInner} → ${workerInner}]`
          }
        }

        // ── Savings tag — mirrors CC session-report-writer format ────────
        // Strip any footer a stale hot-reloaded plugin instance already wrote
        // so we never accumulate two "— … —" lines in the same message.
        const stripped = text.replace(/\n\n— .+ —$/, "")
        const ltTotal  = ltTasks + ltCache

        // Per-session breakdown parts (only emit if > $0.01, same threshold as CC)
        const parts = []
        if (sesEdit   > 0.01) parts.push(`edit -$${sesEdit.toFixed(2)}`)
        if (sesCredit > 0.01) parts.push(`credit -$${sesCredit.toFixed(2)}`)
        if (sesC7     > 0.01) parts.push(`context7 -$${sesC7.toFixed(2)}`)
        if (sesQuota  > 0.01) parts.push(`quota -$${sesQuota.toFixed(2)}`)
        const partsStr = parts.length > 0 ? parts.join(" | ") + " | " : ""

        const flowCounts = getSessionFlowCounts()
        const flowStr = (flowCounts.warn > 0 || flowCounts.hint > 0)
          ? `flow ${flowCounts.warn}w ${flowCounts.hint}h | ` : ""

        const savingsTag = ltTotal > 0
          ? ` ${flowStr}${partsStr}theSaver: $${ltTotal.toFixed(2)} saved`
          : ""

        output.text = stripped + `\n\n— ${modelTag}${savingsTag} —`

            // Write session-report-pending.md for CC to display at next session start.
            if (ltTotal > 0 || ltCache > 0) {
              try {
                const _ltFmt = ltTotal.toFixed(2)
                const _reportLine = `— ${modelTag} theSaver: $${_ltFmt} saved —`
                writeFileSync(join(homedir(), ".claude/session-report-pending.md"), _reportLine)
                const logPath = join(homedir(), ".claude/session-reports.log")
                const pid = process.pid || "?"
                const ts = new Date().toISOString().slice(0, 16).replace("T", " ")
                const newLine = `[${ts} pid=${pid}] ${_reportLine}`
                // Cross-process dedup: check last 5 lines (200-byte tail was unreliable for 3+ writers)
                if (!getLastLines(logPath, 5, 1024).includes(newLine)) {
                  _rotateLog(logPath, MAX_LOG_LINES)
                  appendFileSync(logPath, newLine + "\n")
                }
              } catch {}
            }
      } catch (err) {
        console.error(`[delegation-enforcer] text.complete failed: ${err.message}`)
      }
    },

    // Scratchpad-aware compaction. When OpenCode is about to compact a session,
    // remind the compactor that tool results are persisted on disk at the
    // shared ~/.claude/scratch/by-hash/ tree and to preserve hash/path refs in
    // the summary. The model can Read those paths back post-compact, so we
    // can compact more aggressively without losing recoverable detail.
    "experimental.session.compacting": async (_input, output) => {
      if (!loadSelection().enabled) return
      try {
        const indexPath = join(homedir(), ".claude/scratch/index.jsonl")
        let recent = ""
        if (existsSync(indexPath)) {
          try {
            const lines = readFileSync(indexPath, "utf-8").trim().split("\n").slice(-30)
            recent = lines
              .map((l) => { try { return JSON.parse(l) } catch { return null } })
              .filter((e) => e && e.hash)
              .map((e) => `  • ${e.tool} → ~/.claude/scratch/by-hash/${e.hash}.txt (${e.size}B)`)
              .join("\n")
          } catch {}
        }
        if (!recent) recent = "  (no recent scratchpad entries)"

        const note =
          "[scratchpad-aware compaction] Tool results from this session live on disk at ~/.claude/scratch/by-hash/<hash>.txt " +
          "(plus .meta.json metadata and optional .summary.txt Haiku digest). WHEN COMPACTING: " +
          "(1) drop verbose tool result bodies — the bulk lives on disk; " +
          "(2) PRESERVE every <hash> reference, file path, and pointer in the summary; " +
          "(3) note which on-disk artifacts the model may want to Read back later.\n\n" +
          "Recent cached entries:\n" + recent +
          "\nTo recall any of these post-compact, use the read/grep tools on the listed path."

        if (output && Array.isArray(output.context)) {
          output.context.push({ role: "user", content: note })
        } else if (output) {
          output.context = [{ role: "user", content: note }]
        }
      } catch (err) {
        console.error(`[delegation-enforcer] session.compacting failed: ${err.message}`)
      }
    },

    // Inject a standing context7 directive into every system prompt turn.
    // Always fires (no config-file gate) — the model self-determines whether
    // mcp__context7__* tools are callable. If they're not registered, the
    // instruction is harmless; if they are, the model uses them automatically.
    "experimental.chat.system.transform": async (_input, output) => {
      if (!loadSelection().enabled) return
      try {
        // Context7 directive — model self-determines tool availability.
        const c7directive =
          "[cost policy] If mcp__context7__resolve-library-id and mcp__context7__get-library-docs " +
          "tools are available in this session, ALWAYS use them instead of WebFetch or WebSearch " +
          "when looking up library or framework documentation " +
          "(docs.*, readthedocs.*, npmjs.com/package/*, pypi.org/project/*, pkg.go.dev, /api/reference/). " +
          "Do not fetch those URLs directly when context7 can serve the same content. " +
          "This saves ~$0.06/turn on average."

        // Thinking-level directive — only when manually set via `trinity thinking`.
        // Never auto-injected: credit-based thinking caused model stalls.
        const { thinking_level: explicitLevel } = loadSelection()
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

        // Judge-pattern directive — brain orchestrates and judges, worker does heavy lifting.
        // Only injected for high-tier brain (mid/budget brains don't need delegation nudge).
        if (currentTier === "high") {
          const cheapModel = TRINITY_CHEAP || "the cheaper model"
          const judgeDirective =
            `[judge pattern] You are the orchestrator and judge. For heavy tasks: ` +
            `delegate to a Task subagent (runs on ${cheapModel} — fast and cheap). ` +
            `Your role: verify correctness, fill gaps, synthesize the final answer.`

          if (Array.isArray(output?.system)) output.system.push(judgeDirective)
        }

        // Project memory briefing: one-shot per session
        if (!briefedProjects.has(fp)) {
          const briefing = buildProjectBriefing(directory)
          if (briefing && Array.isArray(output?.system)) {
            output.system.push(briefing)
            briefedProjects.add(fp)
            console.error(`[delegation-enforcer] project-memory: briefing injected for ${fp}`)
          }
        }
      } catch (err) {
        console.error(`[delegation-enforcer] system.transform failed: ${err.message}`)
      }
    },

    "shell.env": async (_input, output) => {
      output.env ??= {}
      output.env.OPENCODE_MODEL_TIER = currentTier || "unknown"
      output.env.OPENCODE_MODEL = currentModel || "unknown"
    },

    tool: {
      trinity: tool({
        description:
          "Control the delegation-enforcer plugin and active model slot. " +
          "Use action='status' to see current state. " +
          "Use action='enable' or 'disable' to toggle the plugin (takes effect immediately, no restart needed). " +
          "Use action='set' with slot='brain'|'medium'|'cheap' to switch model tiers " +
          "(writes opencode.json — takes effect on next session restart). " +
          "Use action='flow' with slot='on'|'off' to toggle flow enforcer, or action='flow' alone for audit. " +
          "Call this when the user says things like 'switch to medium', 'use cheap model', 'disable plugin', 'trinity status'.",
        args: {
          action: tool.schema.enum(["status", "enable", "disable", "set", "thinking", "flow"]),
          slot: tool.schema.enum(["brain", "medium", "cheap", "on", "off"]).optional(),
          level: tool.schema.enum(["full", "brief", "off"]).optional(),
        },
        async execute({ action, slot, level } = {}) {
          // Kick off credit API background fetch on any trinity command.
          if (typeof _lazyRefresh === "function") _lazyRefresh()
          if (action === "status") {
            const sel = loadSelection()
            let tiers = {}
            try { tiers = JSON.parse(readFileSync(TIERS_FILE, "utf-8")).trinity || {} } catch {}
            const credit = loadCredit()
            const effectiveLevel = sel.thinking_level || thinkingLevel(credit)
            const thinkSrc = sel.thinking_level ? "manual" : `credit ${credit}%`
            const lines = [
              `🔌 Plugin: ${sel.enabled ? "ENABLED ✅" : "DISABLED ❌"}`,
              `🎯 Active slot: ${sel.active_slot || "(unset)"}`,
              `🧠 Thinking: ${effectiveLevel.toUpperCase()} (${thinkSrc})`,
              `🔀 Flow enforcer: ${sel.flow_enabled !== false ? "ON" : "OFF"}`,
            ]
            for (const s of ["brain", "medium", "cheap"]) {
              const icon = s === "brain" ? "🧠" : s === "medium" ? "⚙ " : "⚡"
              const oc = tiers[s]?.oc || "(unset)"
              const mark = sel.active_slot === s ? " ← active" : ""
              lines.push(`  ${icon} ${s}: ${oc}${mark}`)
            }
            lines.push(`\nNote: slot changes take effect on next session restart.`)
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
            const result = applySlot(slot)
            if (!result.ok) return `❌ Failed to set slot: ${result.reason}`
            return `✅ Switched to ${slot} slot (${result.ocModel}). Takes effect on next session restart.\nTip: restart OpenCode to activate.`
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
            state.project_hashes[fp] ??= { totalSessions: 0, researchChains: 0, context7Bypasses: 0, commonTopics: [] }
            state.project_hashes[fp].lastSeen = new Date().toISOString()
            state.project_hashes[fp].researchChains = Math.max(
              state.project_hashes[fp].researchChains || 0, report.chains.length
            )
            state.project_hashes[fp].context7Bypasses = (state.project_hashes[fp].context7Bypasses || 0) + report.redundant
            for (const [d] of Object.entries(report.byDomain)) {
              if (!d.startsWith("_") && !state.project_hashes[fp].commonTopics.includes(d)) {
                state.project_hashes[fp].commonTopics.push(d)
              }
            }
            // Keep topics bounded
            if (state.project_hashes[fp].commonTopics.length > 20) {
              state.project_hashes[fp].commonTopics = state.project_hashes[fp].commonTopics.slice(-20)
            }
            saveProjectState(state)
          } catch (err) {
            console.error(`[delegation-enforcer] project-memory update failed: ${err.message}`)
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
        },
        async execute({ type, project, hours } = {}) {
          const reports = listReports({ type, project, hours: hours ?? 168 })
          if (reports.length === 0) return `📋 No reports found.`
          const lines = [`📋 Reports (last ${hours ?? 168}h, ${reports.length} total):`]
          for (const r of reports.slice(0, 30)) {
            const d = r.created.slice(0, 16).replace("T", " ")
            lines.push(`  [${d}] ${r.type} ${r.id.slice(0, 24)}…  ${(r.summary || "").slice(0, 60)}`)
          }
          if (reports.length > 30) lines.push(`  … and ${reports.length - 30} more`)
          lines.push(`\nUse report-read id=<id> to view full report.`)
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
          const report = readReport(id)
          if (!report) return `❌ Report not found: ${id}`
          const lines = [
            `📄 ${report.meta.id}`,
            `  ${report.meta.project} | ${report.meta.type} | ${report.meta.created.slice(0, 16).replace("T", " ")}`,
            `  ${report.summary}`,
          ]
          if (report.findings?.length > 0) {
            lines.push(`\nFindings:`)
            for (const f of report.findings) {
              const icon = f.severity === "warn" ? "⚠" : f.severity === "info" ? "ℹ" : "💡"
              lines.push(`  ${icon} [${f.topic}] ${f.detail}`)
            }
          }
          if (report.metrics && Object.keys(report.metrics).length > 0) {
            lines.push(`\nMetrics:`)
            for (const [k, v] of Object.entries(report.metrics)) {
              if (typeof v === "number" && v < 0.01) continue
              lines.push(`  ${k}: ${v}`)
            }
          }
          if (report.tags?.length > 0) lines.push(`\nTags: ${report.tags.join(", ")}`)
          if (report.narrative) lines.push(`\n---\n${report.narrative}`)
          return lines.join("\n")
        },
      }),
    },
  }
}

export const id = "delegation-enforcer"
export const server = DelegationEnforcer
export default { id: "delegation-enforcer", server: DelegationEnforcer }

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
    if (existsSync(INDEX_PATH)) {
      const lines = readFileSync(INDEX_PATH, "utf-8").trim().split("\n").filter(Boolean)
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
        const summaryPath = join(SCRATCHPAD_DIR, hash + ".summary.txt")
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
    console.error(`[delegation-enforcer] researchAudit index scan failed: ${err.message}`)
  }

  // 2. Session state for tool_counts and context7 bypass
  try {
    if (existsSync(STATE_FILE)) {
      const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"))
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
    console.error(`[delegation-enforcer] researchAudit state scan failed: ${err.message}`)
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
const REPORTS_DIR = join(homedir(), ".claude/reports")
const REPORTS_INDEX = join(REPORTS_DIR, "index.json")

function reportsIndex() {
  try {
    if (existsSync(REPORTS_INDEX)) return JSON.parse(readFileSync(REPORTS_INDEX, "utf-8"))
  } catch {}
  return { reports: [] }
}

function saveReportsIndex(idx) {
  try {
    mkdirSync(REPORTS_DIR, { recursive: true })
    writeFileSync(REPORTS_INDEX, JSON.stringify(idx, null, 2) + "\n")
  } catch (err) {
    console.error(`[delegation-enforcer] reports index write failed: ${err.message}`)
  }
}

function reportId(type, fp) {
  const ts = new Date().toISOString().replace(/[:-]/g, "").replace(/\..+/, "")
  return `${ts}-${(fp || "unknown").slice(0, 6)}-${type}`
}

// Dedup: skip save if last report of same type has identical summary within 5 min
const _reportDedupWindow = new Map()

function _wouldBeDuplicate(type, summary) {
  if (typeof summary !== "string") return false
  const key = `${type || ""}::${summary.slice(0, 60)}`
  const last = _reportDedupWindow.get(key)
  if (last && (Date.now() - last) < 5 * 60 * 1000) return true
  _reportDedupWindow.set(key, Date.now())
  // Bounded map: evict oldest entries beyond 200
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
      console.error(`[delegation-enforcer] reports pruned: ${idx.reports.length} kept (from ${keep.length})`)
    }
  } catch (err) {
    console.error(`[delegation-enforcer] reports prune failed: ${err.message}`)
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

export function saveReport({ type = "manual", summary = "", findings, metrics, narrative = "", tags = [], fingerprint } = {}) {
  // Auto-parse findings + metrics (supports array, JSON string, plain-text lines)
  const parsedFindings = _parseFindings(findings)
  const parsedMetrics = _parseMetrics(metrics)

  // Dedup: skip if last same-type report has same summary within 5 min
  if (_wouldBeDuplicate(type, summary)) return null

  const fp = fingerprint || currentProjectFingerprint || "unknown"
  const id = reportId(type, fp)
  const report = {
    meta: { id, project: currentProjectName || "unknown", fingerprint: fp, type, created: new Date().toISOString(), sessionId: `opencode-${process.pid || "?"}` },
    summary, findings: parsedFindings, metrics: parsedMetrics, narrative, tags,
  }
  // Write report file
  try {
    mkdirSync(REPORTS_DIR, { recursive: true })
    writeFileSync(join(REPORTS_DIR, `${id}.json`), JSON.stringify(report, null, 2) + "\n")
  } catch (err) {
    console.error(`[delegation-enforcer] report write failed: ${err.message}`)
    return null
  }
  // Update index
  try {
    const idx = reportsIndex()
    const _sum = (summary || "").slice(0, 80)
    idx.reports.push({ id, type, project: report.meta.project, fingerprint: fp, created: report.meta.created, summary: _sum })
    saveReportsIndex(idx)
  } catch (err) {
    console.error(`[delegation-enforcer] report index update failed: ${err.message}`)
  }
  // Opportunistic TTL prune (once per process ≈ every save)
  _pruneReports()
  return id
}

export function listReports({ type, project, hours = 168, fingerprint } = {}) {
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
  const path = join(REPORTS_DIR, `${id}.json`)
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch { return null }
}

// ── Credit API: fetch real balances from provider APIs ───────────────
const AUTH_F = join(homedir(), ".local", "share", "opencode", "auth.json")
const CREDIT_CACHE_F = join(homedir(), ".claude/credit-snapshot.json")
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

function _readAuth() {
  try { return existsSync(AUTH_F) ? JSON.parse(readFileSync(AUTH_F, "utf-8")) : {} } catch { return {} }
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
    const s = JSON.parse(readFileSync(CREDIT_CACHE_F, "utf-8"))
    if (s?.total == null || !s.ts) return null
    let budget = 50
    try {
      const p = join(homedir(), ".claude/model-tiers.json")
      if (existsSync(p)) {
        const j = JSON.parse(readFileSync(p, "utf-8"))
        if (j?.selection?.monthly_budget_usd) budget = j.selection.monthly_budget_usd
      }
    } catch {}
    return budget > 0 ? Math.min(150, Math.max(0, Math.round((s.total / budget) * 100))) : null
  } catch { return null }
}

// Lazy background refresh — only starts when a hook calls loadCredit() for the first time.
let _started = false
function _lazyRefresh() {
  if (_started) return
  _started = true
  _snapshot()
  _creditTimer = setInterval(_snapshot, 60 * 60 * 1000)
  if (_creditTimer.unref) _creditTimer.unref()
}
