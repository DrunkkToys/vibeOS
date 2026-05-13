/**
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

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { tool } from "@opencode-ai/plugin"

// ── Module state ────────────────────────────────────────────────────
let currentTier = null
let currentModel = null
// Per-tool soft-quota counters (same semantics as bash hook per-SID flag files).
// Main scope uses quota 20, sub-agent scope uses 5 — OC has no scope concept so
// use the more conservative sub-agent limit.
const softQuotaCounts = {}
const SOFT_QUOTA_LIMIT = 5
const STATE_FILE = join(homedir(), ".claude/delegation-state.json")

// Dedupe set: assistantMessageIds that already had the savings tag appended
// during this sidecar's lifetime.
const textCompletePainted = new Set()

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
  if (process.env.CLAUDE_CREDIT_PERCENT) {
    const n = parseInt(process.env.CLAUDE_CREDIT_PERCENT, 10)
    if (!isNaN(n)) return n
  }
  try {
    const f = join(homedir(), ".claude/credit-percent")
    if (existsSync(f)) {
      const n = parseInt(readFileSync(f, "utf-8").trim(), 10)
      if (!isNaN(n)) return n
    }
  } catch {}
  return 100
}

// Map credit to thinking level: full / brief / off.
function thinkingLevel(credit) {
  if (credit >= 70) return "full"
  if (credit >= 40) return "brief"
  return "off"
}

// Read plugin enabled flag + active_slot fresh from model-tiers.json.
// Called per-hook so live edits (trinity on/off) take effect without restart.
const TIERS_FILE = join(homedir(), ".claude/model-tiers.json")
function loadSelection() {
  try {
    if (!existsSync(TIERS_FILE)) return { enabled: true, active_slot: null, thinking_level: null }
    const j = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
    return {
      enabled:        j?.selection?.enabled !== false,
      active_slot:    j?.selection?.active_slot || null,
      thinking_level: j?.selection?.thinking_level || null,  // "full" | "brief" | "off" | null (→ credit-based)
    }
  } catch { return { enabled: true, active_slot: null, thinking_level: null } }
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
  // Match bash hashing exactly: shasum -a 256 of "<tool>\n<json>\n", first 16 chars.
  const inputJson = JSON.stringify(args ?? {})
  const hash = createHash("sha256").update(`${titleCase}\n${inputJson}\n`).digest("hex").slice(0, 16)
  const fullPath = join(baseDir, `${hash}.txt`)
  if (!existsSync(fullPath)) return null
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
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
    return state.lifetime.est_savings_usd
  } catch (err) {
    console.error(`[delegation-enforcer] state write failed: ${err.message}`)
    return null
  }
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
    const ses = s?.sessions?.[_OC_SID]
    const warns = Array.isArray(ses?.warns) ? ses.warns : []
    const sesTasks = warns.reduce((a, w) => a + Number(w.est_savings_usd ?? 0), 0)
    // Per-warn-type session totals (mirrors CC session-report-writer breakdown)
    const sesEdit   = warns.filter(w => w.reason?.includes("direct edit")).reduce((a, w) => a + Number(w.est_savings_usd ?? 0), 0)
    const sesCredit = warns.filter(w => w.reason?.includes("credit")).reduce((a, w)    => a + Number(w.est_savings_usd ?? 0), 0)
    const sesC7     = warns.filter(w => w.reason?.includes("context7")).reduce((a, w)  => a + Number(w.est_savings_usd ?? 0), 0)
    const sesQuota  = warns.filter(w => w.reason?.includes("quota")).reduce((a, w)     => a + Number(w.est_savings_usd ?? 0), 0)
    _savingsCache = {
      ltTasks:        Number(s?.lifetime?.est_savings_usd         ?? 0),
      ltCache:        Number(s?.lifetime?.total_cache_savings_usd ?? 0),
      ltCost:         Number(s?.lifetime?.total_cost_usd          ?? 0),
      count:          Number(s?.lifetime?.warn_count              ?? 0),
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

// ── Output compression ──────────────────────────────────────────────

const VERBOSE_LINE_RE = [
  /^\s*(I believe|Let me|Here is|Here are|Below is|The following|Based on).*?:?\s*$/i,
  /^\s*(Sure|Certainly|Absolutely|Of course|Great question)[!.,]?\s*$/i,
  /^\s*(I will|I'll|Let me|I can|I am going to)\s+.*$/i,
  /^\s*(Hope this helps|Let me know if|Feel free to|Happy to|Please let me know).*$/i,
]

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

  // Truncate if excessively long, preserving code blocks
  const MAX_LEN = 3000
  if (result.length > MAX_LEN) {
    // Try to find a good cutoff (end of paragraph/section)
    const cutoff = result.lastIndexOf("\n\n", MAX_LEN)
    if (cutoff > MAX_LEN * 0.5) {
      result = result.slice(0, cutoff) + `\n\n… [${result.length - cutoff} chars truncated]`
    } else {
      result = result.slice(0, MAX_LEN) + `… [${result.length - MAX_LEN} chars truncated]`
    }
  }

  if (removed > 0) {
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
    // Override: if current model matches the active brain slot's oc model, treat as high tier.
    // (regex may classify sonnet as mid, but user configured it as brain)
    try {
      const _tiersData = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
      const _activeSlot = _tiersData?.selection?.active_slot || "brain"
      const _brainOcModel = _tiersData?.trinity?.[_activeSlot]?.oc || ""
      if (_brainOcModel && currentModel === _brainOcModel) {
        currentTier = "high"
        console.error(`[delegation-enforcer] tier override → high (active_slot=${_activeSlot})`)
      }
    } catch {}
    console.error(`[delegation-enforcer] ACTIVE: model=${currentModel} tier=${currentTier}`)
  } else {
    console.error("[delegation-enforcer] NO MODEL — enforcement disabled")
  }
  const context7Available = detectContext7()
  if (context7Available) console.error(`[delegation-enforcer] context7 detected — docs nudge enabled`)

  return {
    "tool.execute.before": async (input, output) => {
      if (!loadSelection().enabled) return
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
      const _estEdit     = _brainCost !== null
        ? Math.max(0, Math.round((_brainCost - _workerCost) * 1000) / 1000)
        : SAVE_EST.WRITE_EDIT
      const _estOpus     = _brainCost !== null ? _brainCost : SAVE_EST.OPUS_DISABLE
      const _estC7       = _brainCost !== null ? _brainCost : SAVE_EST.CONTEXT7

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
            if (context7Available) {
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
      }

      // Compress verbose tool outputs before they bloat context
      if (t !== "task" && t !== "webfetch") return

      // Try multiple output paths (plugin API may vary)
      const raw = output?.result ?? output?.text ?? output?.content ?? output?.data
      if (!raw || typeof raw !== "string") return

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
              if (!existsSync(fullPath)) writeFileSync(fullPath, raw)
            } catch (err) {
              console.error(`[delegation-enforcer] ctx-compress write failed: ${err.message}`)
              continue
            }

            if (!isCold) continue  // hot: disk backup only, keep full content in context

            const summary = raw.slice(0, 200).replace(/\n+/g, " ").trim() + (raw.length > 200 ? "…" : "")
            const ref =
              `${COMPRESS_MARKER} [${raw.length} chars compressed to disk]\n` +
              `Summary: ${summary}\n` +
              `Full content: Read ${fullPath}`

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
          "1) STRIP preamble, confidence ratings, restated tasks. " +
          "2) EXTRACT core findings/data only. " +
          "3) REFORMAT into ≤5 bullets. " +
          "4) VERIFY against the original ask. " +
          "5) SYNTHESIZE into final response. " +
          "Discard worker reasoning narration."

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

        const savingsTag = ltTotal > 0
          ? ` ${partsStr}theSaver: $${ltTotal.toFixed(2)} saved`
          : ""

        output.text = stripped + `\n\n— ${modelTag}${savingsTag} —`

        // Write session-report-pending.md for CC to display at next session start.
        if (ltTotal > 0 || ltCache > 0) {
          try {
            const _ltFmt = ltTotal.toFixed(2)
            const _reportLine = `— ${modelTag} theSaver: $${_ltFmt} saved —`
            writeFileSync(join(homedir(), ".claude/session-report-pending.md"), _reportLine)
            appendFileSync(
              join(homedir(), ".claude/session-reports.log"),
              `[${new Date().toISOString().slice(0, 16).replace("T", " ")}] ${_reportLine}\n`
            )
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

        // Thinking-level directive — explicit selection overrides credit-based fallback.
        // Explicit: set via `trinity thinking full|brief|off` (stored in model-tiers.json).
        // Fallback: derived from ~/.claude/credit-percent (100% → full, 40–69% → brief, <40% → off).
        const { thinking_level: explicitLevel } = loadSelection()
        const credit = loadCredit()
        const level  = explicitLevel || thinkingLevel(credit)
        const creditNote = explicitLevel ? `manually set` : `credit ${credit}%`
        const thinkingDirectives = {
          brief: `[thinking policy] Reasoning depth: BRIEF (${creditNote}). Use extended thinking only for genuinely complex multi-step problems. Keep reasoning concise — skip exploratory scratch work and restatement.`,
          off:   `[thinking policy] Reasoning depth: OFF (${creditNote}). Skip extended thinking entirely. Respond directly and concisely. Every thinking token costs money — save it for when the user explicitly asks.`,
        }
        const thinkDirective = thinkingDirectives[level] // undefined for "full" → no injection

        // Judge-pattern directive — brain orchestrates and judges, worker does heavy lifting.
        // Uses the OC cheap model ID (not CC alias) — runtimes stay separated.
        const cheapModel = TRINITY_CHEAP || "the cheaper model"
        const judgeDirective =
          `[judge pattern] You are the orchestrator and judge. For tasks requiring research, reasoning, or code implementation: ` +
          `delegate to a Task subagent (runs on ${cheapModel} — fast and cheap). ` +
          `Your role: verify correctness, fill gaps, synthesize the final answer.`

        if (Array.isArray(output?.system)) {
          output.system.push(c7directive)
          if (thinkDirective) output.system.push(thinkDirective)
          output.system.push(judgeDirective)
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
          "Call this when the user says things like 'switch to medium', 'use cheap model', 'disable plugin', 'trinity status'.",
        args: {
          action: tool.schema.enum(["status", "enable", "disable", "set", "thinking"]),
          slot: tool.schema.enum(["brain", "medium", "cheap"]).optional(),
          level: tool.schema.enum(["full", "brief", "off"]).optional(),
        },
        async execute({ action, slot, level }) {
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
            const stored = level === "full" ? null : level
            const ok = writeSelection("thinking_level", stored)
            if (!ok) return `❌ Failed to write model-tiers.json`
            const desc = {
              full:  "full thinking (no restriction) — takes effect on next message",
              brief: "brief thinking (complex tasks only) — takes effect on next message",
              off:   "thinking OFF (respond directly) — takes effect on next message",
            }
            return `✅ Reasoning depth → ${desc[level]}`
          }

          return `❌ Unknown action: ${action}`
        },
      }),
    },
  }
}

export const id = "delegation-enforcer"
export const server = DelegationEnforcer
export default { id: "delegation-enforcer", server: DelegationEnforcer }
