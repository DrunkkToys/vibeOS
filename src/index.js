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
 * Sister hook: ~/.claude/hooks/theSaver (Claude Code).
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, readdirSync, openSync, readSync, closeSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { checkFlowRules, getFlowWarns, getSessionFlowCounts } from "./theSaver-lib/flow-enforcer.js"

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
let { cheap: TRINITY_CHEAP, medium: TRINITY_MEDIUM } = loadTrinityModels()

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
    if (!existsSync(TIERS_FILE)) return { enabled: true, active_slot: null, thinking_level: null, flow_enabled: true, tdd_enforce: false, flow_enforce: false, delegation_enforce: true }
    const j = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
    return {
      enabled:            j?.selection?.enabled !== false,
      active_slot:        j?.selection?.active_slot || null,
      thinking_level:     j?.selection?.thinking_level || null,
      flow_enabled:       j?.selection?.flow_enabled !== false,
      tdd_enforce:        j?.selection?.tdd_enforce === true,
      flow_enforce:       j?.selection?.flow_enforce === true,
      delegation_enforce: j?.selection?.delegation_enforce !== false,
    }
  } catch { return { enabled: true, active_slot: null, thinking_level: null, flow_enabled: true, tdd_enforce: false, flow_enforce: false, delegation_enforce: true } }
}

// Write a single key into selection block of model-tiers.json.
function writeSelection(key, value) {
  try {
    const j = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
    j.selection[key] = value
    writeFileSync(TIERS_FILE, JSON.stringify(j, null, 2) + "\n")
    return true
  } catch (err) {
    console.error(`[theSaver] writeSelection failed: ${err.message}`)
    return false
  }
}

// Write active_slot AND update opencode.json model to the matching oc model.
export function applySlot(slot) {
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
    _refreshModel('')
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

function shortModelName(modelId) {
  const raw = String(modelId || "").trim()
  if (!raw) return "unknown"
  const parts = raw.split("/")
  return parts[parts.length - 1] || raw
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
  console.error(`[theSaver] modelCostPerTurn: unknown model '${model}' (normalized: '${key}') — add to MODEL_USD_PER_TURN`)
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
  // Deterministic OpenCode-native tools — same input = same output
  "context7_query-docs": "Context7QueryDocs",
  "context7_resolve-library-id": "Context7ResolveLibrary",
  obsidian: "Obsidian",   // read action: note content is immutable for same query
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
let enforcementBlocked = false

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
      // public/private/protected type name(
      for (const m of sourceContent.matchAll(/(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?\S+\s+([a-zA-Z_$]\w*)\s*\(/g)) add(m[1])
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
function generateTestCaseNames(funcName, _type) {
  const base = funcName.replace(/^[_$]+/, "")
  return [
    `should ${base} with valid input`,
    `should handle empty input for ${base}`,
    `should handle edge cases in ${base}`,
  ]
}

const TEST_SKELETONS = {
  py: (name, exports = [], depth = "full") => {
    const moduleImport = name.replace(/-/g, "_")
    let content = `# [theSaver-enforced] Skeleton test — replace with real assertions\n`
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
        const cases = generateTestCaseNames(exp.name, exp.type)
        content += `# TODO: implement tests for ${exp.name}\n`
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `def test_${caseFunc}():\n`
          content += `    pytest.skip("TODO: implement ${caseName}")\n\n`
        }
      }
      if (exports.length === 0) {
        content += `def test_${name}_placeholder():\n`
        content += `    pytest.skip("TODO: implement tests for ${name}")\n\n`
      }
    }
    return content
  },
  js: (name, exports = [], depth = "full") => {
    const importPath = `../${name}`
    let content = `// [theSaver-enforced] Skeleton test — replace with real assertions\n`
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
        const cases = generateTestCaseNames(exp.name, exp.type)
        content += `  // TODO: implement tests for ${exp.name}\n`
        for (const caseName of cases) {
          content += `  test('${caseName}', () => {\n`
          content += `    // TODO: implement ${caseName}\n`
          content += `    expect(mod.${exp.name}).toBeDefined();\n`
          content += `  });\n\n`
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
  mjs: (name, exports = [], depth = "full") => {
    const importPath = `../${name}`
    let content = `// [theSaver-enforced] Skeleton test — replace with real assertions\n`
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
        const cases = generateTestCaseNames(exp.name, exp.type)
        content += `  // TODO: implement tests for ${exp.name}\n`
        for (const caseName of cases) {
          content += `  test('${caseName}', () => {\n`
          content += `    // TODO: implement ${caseName}\n`
          content += `    expect(mod.${exp.name}).toBeDefined();\n`
          content += `  });\n\n`
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
  ts: (name, exports = [], depth = "full") => {
    const importPath = `../${name}`
    let content = `// [theSaver-enforced] Skeleton test — replace with real assertions\n`
    content += `import { describe, it, expect } from 'vitest';\n`
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
        const cases = generateTestCaseNames(exp.name, exp.type)
        content += `  // TODO: implement tests for ${exp.name}\n`
        for (const caseName of cases) {
          content += `  it('${caseName}', () => {\n`
          content += `    // TODO: implement ${caseName}\n`
          content += `    expect(mod.${exp.name}).toBeDefined();\n`
          content += `  });\n\n`
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
  tsx: (name, exports = [], depth = "full") => TEST_SKELETONS.ts(name, exports, depth),
  jsx: (name, exports = [], depth = "full") => TEST_SKELETONS.mjs(name, exports, depth),
  go: (name, exports = [], depth = "full") => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1)
    let content = `// [theSaver-enforced] Skeleton test — replace with real assertions\n`
    content += `package main\n\n`
    content += `import "testing"\n\n`
    if (depth === "minimal") {
      content += `func Test${cap}Smoke(t *testing.T) {\n`
      content += `    // Smoke test: package compiles\n`
      content += `    if false {\n`
      content += `        t.Fatal("unreachable")\n`
      content += `    }\n`
      content += `}\n`
    } else {
      content += `func Test${cap}Smoke(t *testing.T) {\n`
      content += `    // Smoke test: package compiles\n`
      content += `    if false {\n`
      content += `        t.Fatal("unreachable")\n`
      content += `    }\n`
      content += `}\n\n`
      for (const exp of exports) {
        content += `// TODO: implement tests for ${exp.name}\n`
        const cases = generateTestCaseNames(exp.name, exp.type)
        for (const caseName of cases) {
          const testName = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `func Test${cap}_${testName}(t *testing.T) {\n`
          content += `    t.Skip("TODO: implement ${caseName}")\n`
          content += `}\n\n`
        }
      }
      if (exports.length === 0) {
        content += `func Test${cap}Placeholder(t *testing.T) {\n`
        content += `    t.Skip("TODO: implement tests for ${name}")\n`
        content += `}\n`
      }
    }
    return content
  },
  sh: (name, exports = [], depth = "full") => {
    let content = `#!/bin/bash\n`
    content += `# [theSaver-enforced] Skeleton test — replace with real assertions\n`
    content += `set -e\n\n`
    content += `# Source the script under test\n`
    content += `SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\n`
    content += `source "$SCRIPT_DIR/../${name}.sh"\n\n`
    if (depth === "minimal") {
      content += `test_smoke() {\n`
      content += `    echo "PASS: smoke test"\n`
      content += `}\n\n`
      content += `test_smoke\n`
    } else {
      content += `# Smoke test\n`
      content += `test_smoke() {\n`
      content += `    echo "PASS: smoke test"\n`
      content += `}\n\n`
      for (const exp of exports) {
        content += `# TODO: implement tests for ${exp.name}\n`
        const cases = generateTestCaseNames(exp.name, exp.type)
        for (const caseName of cases) {
          const testFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `test_${testFunc}() {\n`
          content += `    echo "TODO: implement ${caseName}"\n`
          content += `    return 1\n`
          content += `}\n\n`
        }
      }
      if (exports.length === 0) {
        content += `test_placeholder() {\n`
        content += `    echo "TODO: implement tests for ${name}"\n`
        content += `    return 1\n`
        content += `}\n\n`
      }
      content += `# Run all tests\n`
      content += `test_smoke\n`
    }
    return content
  },
  rs: (name, exports = [], depth = "full") => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1)
    let content = `// [theSaver-enforced] Skeleton test — replace with real assertions\n`
    content += `#[cfg(test)]\n`
    content += `mod tests {\n`
    content += `    use super::*;\n\n`
    if (depth === "minimal") {
      content += `    #[test]\n`
      content += `    fn test_${name}_smoke() {\n`
      content += `        // Smoke test: module compiles\n`
      content += `        assert!(true);\n`
      content += `    }\n`
    } else {
      content += `    #[test]\n`
      content += `    fn test_${name}_smoke() {\n`
      content += `        // Smoke test: module compiles\n`
      content += `        assert!(true);\n`
      content += `    }\n\n`
      for (const exp of exports) {
        content += `    // TODO: implement tests for ${exp.name}\n`
        const cases = generateTestCaseNames(exp.name, exp.type)
        for (const caseName of cases) {
          const testFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `    #[test]\n`
          content += `    fn test_${testFunc}() {\n`
          content += `        panic!("TODO: implement ${caseName}");\n`
          content += `    }\n\n`
        }
      }
      if (exports.length === 0) {
        content += `    #[test]\n`
        content += `    fn test_${name}_placeholder() {\n`
        content += `        panic!("TODO: implement tests for ${name}");\n`
        content += `    }\n`
      }
    }
    content += `}\n`
    return content
  },
  rb: (name, exports = [], depth = "full") => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1)
    let content = `# [theSaver-enforced] Skeleton test — replace with real assertions\n`
    content += `require 'minitest/autorun'\n`
    content += `require_relative '../${name}'\n\n`
    content += `class Test${cap} < Minitest::Test\n`
    if (depth === "minimal") {
      content += `  def test_smoke\n`
      content += `    assert true\n`
      content += `  end\n`
    } else {
      content += `  def test_smoke\n`
      content += `    assert true\n`
      content += `  end\n\n`
      for (const exp of exports) {
        content += `  # TODO: implement tests for ${exp.name}\n`
        const cases = generateTestCaseNames(exp.name, exp.type)
        for (const caseName of cases) {
          const testFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `  def test_${testFunc}\n`
          content += `    skip "TODO: implement ${caseName}"\n`
          content += `  end\n\n`
        }
      }
      if (exports.length === 0) {
        content += `  def test_placeholder\n`
        content += `    skip "TODO: implement tests for ${name}"\n`
        content += `  end\n`
      }
    }
    content += `end\n`
    return content
  },
  java: (name, exports = [], depth = "full") => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1)
    let content = `// [theSaver-enforced] Skeleton test — replace with real assertions\n`
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
        const cases = generateTestCaseNames(exp.name, exp.type)
        for (const caseName of cases) {
          const testFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `    @Test\n`
          content += `    void test${testFunc.charAt(0).toUpperCase() + testFunc.slice(1)}() {\n`
          content += `        fail("TODO: implement ${caseName}");\n`
          content += `    }\n\n`
        }
      }
      if (exports.length === 0) {
        content += `    @Test\n`
        content += `    void testPlaceholder() {\n`
        content += `        fail("TODO: implement tests for ${name}");\n`
        content += `    }\n`
      }
    }
    content += `}\n`
    return content
  },
  kt: (name, exports = [], depth = "full") => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1)
    let content = `// [theSaver-enforced] Skeleton test — replace with real assertions\n`
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
        const cases = generateTestCaseNames(exp.name, exp.type)
        for (const caseName of cases) {
          const testFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")
          content += `    @Test\n`
          content += `    fun test${testFunc.charAt(0).toUpperCase() + testFunc.slice(1)}() {\n`
          content += `        fail("TODO: implement ${caseName}")\n`
          content += `    }\n\n`
        }
      }
      if (exports.length === 0) {
        content += `    @Test\n`
        content += `    fun testPlaceholder() {\n`
        content += `        fail("TODO: implement tests for ${name}")\n`
        content += `    }\n`
      }
    }
    content += `}\n`
    return content
  },
}

// Cross-process lock directory for test file creation coordination.
const ENFORCEMENT_LOCK_DIR = join(homedir(), ".claude/.enforcement-lock")
const LOCK_EXPIRE_MS = 30_000

// Cross-process cooldown to avoid duplicate enforcement across processes.
const ENFORCEMENT_COOLDOWN_FILE = join(homedir(), ".claude/.enforcement-cooldown.jsonl")
const COOLDOWN_MS = 60_000

// Per-process recursion guard.
const _enforcementCooldown = new Set()

function _acquireLock(testPath) {
  try {
    mkdirSync(ENFORCEMENT_LOCK_DIR, { recursive: true })
    const hash = createHash("sha256").update(testPath).digest("hex").slice(0, 16)
    const lockPath = join(ENFORCEMENT_LOCK_DIR, `${hash}.lock`)
    if (existsSync(lockPath)) {
      const st = statSync(lockPath)
      if (Date.now() - st.mtimeMs < LOCK_EXPIRE_MS) return false
      rmSync(lockPath)
    }
    writeFileSync(lockPath, `${process.pid}\n${new Date().toISOString()}`)
    return true
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

export function buildTestSkeleton(filePath, sourceContent = "") {
  if (!filePath || typeof filePath !== "string") return null
  if (!SOURCE_EXT_RE.test(filePath)) return null
  if (SKIP_PATH_RE.test(filePath)) return null
  const m = filePath.match(/([^/]+)\.([^.]+)$/)
  if (!m) return null
  const [, name, ext] = m
  const extLower = ext.toLowerCase()
  const skeletonFn = TEST_SKELETONS[extLower]
  if (!skeletonFn) return null
  const m2 = filePath.match(/^(.*\/)?([^/]+)\.([^.]+)$/)
  const dir = m2 ? (m2[1] || "") : ""
  let testPath
  switch (extLower) {
    case "py": testPath = dir + "tests/test_" + name + ".py"; break
    case "sh": testPath = dir + "tests/test_" + name + ".sh"; break
    case "js": case "mjs": case "ts": case "jsx": case "tsx":
      testPath = dir + "tests/" + name + ".test." + ext; break
    case "go": testPath = dir + name + "_test.go"; break
    case "rs": testPath = dir + "tests/" + name + "_test.rs"; break
    case "rb": testPath = dir + "test/" + name + "_test.rb"; break
    case "java": case "kt": testPath = dir + "src/test/" + name.charAt(0).toUpperCase() + name.slice(1) + "Test." + ext; break
    default: return null
  }
  const exports = extractExports(sourceContent, extLower)
  return { path: testPath, content: skeletonFn(name, exports), dir: dirname(testPath) }
}

export function enforceTestFile(filePath) {
  // Read source file content to extract exports
  let sourceContent = ""
  try {
    if (existsSync(filePath)) {
      sourceContent = readFileSync(filePath, "utf-8")
    }
  } catch {}
  const skeleton = buildTestSkeleton(filePath, sourceContent)
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
    // Record in state file for audit stats
    try {
      let state = {}
      if (existsSync(STATE_FILE)) {
        try { state = JSON.parse(readFileSync(STATE_FILE, "utf-8")) } catch {}
      } else { mkdirSync(dirname(STATE_FILE), { recursive: true }) }
      state.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" }
      state.lifetime.tdd_enforced = (state.lifetime.tdd_enforced || 0) + 1
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
    } catch {}
    console.error(`[theSaver] [tdd-enforce] Created skeleton: ${skeleton.path}`)
    return skeleton.path
  } catch (err) {
    console.error(`[theSaver] [tdd-enforce] Failed to create ${skeleton.path}: ${err.message}`)
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
    console.error(`[theSaver] state write failed: ${err.message}`)
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
  const empty = { ltTasks: 0, ltCache: 0, ltCost: 0, count: 0, scratchpadHits: 0, missedC7: 0, sesTasks: 0, sesEdit: 0, sesCredit: 0, sesC7: 0, sesQuota: 0, sesDuration: 0, sesRatePerHour: 0, sesTrend: "stable", sesToolBreakdown: {}, sesModelTurns: { brain: 0, worker: 0 } }
  try {
    if (!existsSync(STATE_FILE)) return empty
    const mtime = statSync(STATE_FILE).mtimeMs
    if (_savingsCache && mtime === _savingsCacheMtime) return _savingsCache
    const s = JSON.parse(readFileSync(STATE_FILE, "utf-8"))

    // Compute ALL totals from session data atomically — never from separate lifetime fields
    // written by different processes. This eliminates the savings-counter bounce.
    let ltTasks = 0; let ltCache = 0; let ltCost = 0; let totalWarnCount = 0
    const sessionRates = []
    for (const [sid, ses] of Object.entries(s?.sessions || {})) {
      // Delegation savings from warns
      const warns = Array.isArray(ses?.warns) ? ses.warns : []
      totalWarnCount += warns.length
      for (const w of warns) ltTasks += Number(w.est_savings_usd ?? 0)
      // Cache savings and costs from costed sessions
      ltCache += Number(ses?.cache_savings_usd ?? 0)
      ltCost  += Number(ses?.cost_usd ?? 0)
      // Compute session rate for trend analysis
      if (ses?.started) {
        const elapsed = (Date.now() - new Date(ses.started).getTime()) / 3600000
        const sesTotal = warns.reduce((a, w) => a + Number(w.est_savings_usd ?? 0), 0) + Number(ses?.cache_savings_usd ?? 0)
        if (elapsed > 0.05) sessionRates.push(sesTotal / elapsed)
      }
    }

    // Per-warn-type session totals (current process only)
    const ses = s?.sessions?.[_OC_SID]
    const warns = Array.isArray(ses?.warns) ? ses.warns : []
    const sesTasks = warns.reduce((a, w) => a + Number(w.est_savings_usd ?? 0), 0)
    const sesEdit   = warns.filter(w => w.reason?.includes("direct edit")).reduce((a, w) => a + Number(w.est_savings_usd ?? 0), 0)
    const sesCredit = warns.filter(w => w.reason?.includes("credit")).reduce((a, w)    => a + Number(w.est_savings_usd ?? 0), 0)
    const sesC7     = warns.filter(w => w.reason?.includes("context7")).reduce((a, w)  => a + Number(w.est_savings_usd ?? 0), 0)
    const sesQuota  = warns.filter(w => w.reason?.includes("quota")).reduce((a, w)     => a + Number(w.est_savings_usd ?? 0), 0)

    // Per-tool breakdown for current session
    const sesToolBreakdown = {}
    for (const w of warns) {
      const tool = w.tool || "unknown"
      sesToolBreakdown[tool] = (sesToolBreakdown[tool] || 0) + Number(w.est_savings_usd ?? 0)
    }
    // Round and sort by savings descending
    for (const k of Object.keys(sesToolBreakdown)) {
      sesToolBreakdown[k] = Math.round(sesToolBreakdown[k] * 100) / 100
    }

    // Session duration
    let sesDuration = 0
    let sesRatePerHour = 0
    if (ses?.started) {
      sesDuration = (Date.now() - new Date(ses.started).getTime()) / 1000
      const sesTotal = sesTasks + Number(ses?.cache_savings_usd ?? 0)
      const hours = sesDuration / 3600
      sesRatePerHour = hours > 0 ? sesTotal / hours : 0
    }

    // Trend: compare current session rate vs average of previous sessions
    let sesTrend = "stable"
    if (sessionRates.length >= 2) {
      const currentRate = sessionRates[sessionRates.length - 1]
      const prevRates = sessionRates.slice(0, -1)
      const avgPrev = prevRates.reduce((a, b) => a + b, 0) / prevRates.length
      const diff = currentRate - avgPrev
      const threshold = 0.15 // 15% change to trigger trend
      if (avgPrev > 0) {
        const pctChange = diff / avgPrev
        if (pctChange > threshold) sesTrend = "up"
        else if (pctChange < -threshold) sesTrend = "down"
      }
    }

    // Model turn tracking (from tool_counts heuristics)
    const sesModelTurns = { brain: 0, worker: 0 }
    if (ses?.tool_counts) {
      // Brain turns: direct tool usage (write, edit, bash, webfetch, websearch)
      const brainTools = ["write", "edit", "notebookedit", "bash", "webfetch", "websearch"]
      for (const t of brainTools) {
        sesModelTurns.brain += Number(ses.tool_counts[t] || 0)
      }
      // Worker turns: task delegations
      sesModelTurns.worker = Number(ses.tool_counts.task || 0)
    }

    _savingsCache = {
      ltTasks: Math.round(ltTasks * 100) / 100,
      ltCache: Math.round(ltCache * 100) / 100,
      ltCost:  Math.round(ltCost * 100) / 100,
      count:   totalWarnCount,
      scratchpadHits: Number(s?.lifetime?.scratchpad_hits_observed ?? 0),
      missedC7:       Number(s?.lifetime?.missed_context7_usd      ?? 0),
      sesTasks, sesEdit, sesCredit, sesC7, sesQuota,
      sesDuration: Math.round(sesDuration),
      sesRatePerHour: Math.round(sesRatePerHour * 100) / 100,
      sesTrend,
      sesToolBreakdown,
      sesModelTurns,
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
    console.error(`[theSaver] index write failed: ${err.message}`)
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
      console.error(`[theSaver] 📦 decadence: ${action.join(" ")} (${dataFiles} files, ${Math.round(totalBytes/1024)}KB)`)
    }
  } catch (err) {
    console.error(`[theSaver] decadence error: ${err.message}`)
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
    console.error(`[theSaver] COMPRESS: ${text.length}→${result.length} chars (${removed} verbose lines stripped)`)
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
    console.error(`[theSaver] pruned ${remove} scratchpad files (${txtFiles.length} → ${txtFiles.length - remove})`)
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
    console.error(`[theSaver] project state write failed: ${err.message}`)
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
const PLACEHOLDER_RE = /^(provider|opencode)\/[a-z-]+-model$/i
function _refreshModel(directory) {
  try {
    const sel = loadSelection()
    if (!sel.enabled) return
    const tiersData = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
    const activeSlot = sel.active_slot || "brain"
    let slotOcModel = tiersData?.trinity?.[activeSlot]?.oc || ""
    // Skip placeholder models (e.g. "provider/high-tier-model") — use auto-detected model instead
    if (slotOcModel && PLACEHOLDER_RE.test(slotOcModel)) {
      slotOcModel = ""
      console.error(`[theSaver] placeholder model detected in ${activeSlot} slot — skipping, will auto-detect`)
    }
    if (slotOcModel && currentModel !== slotOcModel) {
      const old = currentModel
      currentModel = slotOcModel
      // Brain slot → enforce delegation (treat as high even for mid-classified models like sonnet)
      // Medium/cheap slots → skip high-tier enforcement (no point warning on $0.0001/turn models)
      currentTier = activeSlot === "brain" ? "high" : classify(currentModel)
      console.error(`[theSaver] model refresh: ${old} → ${currentModel} (slot=${activeSlot} tier=${currentTier})`)
    }
    // If no model from tiers and no existing currentModel, try to auto-detect
    if (!currentModel) {
      const detected = readConfig(directory) || readConfig(join(homedir(), ".config/opencode")) || process?.env?.OPENCODE_MODEL || ""
      if (detected) {
        currentModel = detected
        currentTier = classify(currentModel)
        console.error(`[theSaver] auto-detected model: ${currentModel} (tier=${currentTier})`)
      }
    }
  } catch {}
}

export async function DelegationEnforcer({ client, directory }) {
  console.error(`[theSaver] LOADED cwd=${directory}`)
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
        if (_brainOcModel && currentModel === _brainOcModel && !PLACEHOLDER_RE.test(_brainOcModel)) {
          currentTier = "high"
          console.error(`[theSaver] tier override → high (brain slot)`)
        }
      }
    } catch {}
    console.error(`[theSaver] ACTIVE: model=${currentModel} tier=${currentTier}`)
  } else {
    console.error("[theSaver] NO MODEL — enforcement disabled, will auto-detect on first hook")
  }
  // Auto-configure model-tiers.json — always syncs with opencode desktop config.
  // Sniffs ALL models from the user's opencode.json (provider dropdown + model field).
  if (currentModel) {
    try {
      let _tiersData
      if (existsSync(TIERS_FILE)) {
        _tiersData = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
      } else {
        _tiersData = { selection: { enabled: true, active_slot: "brain", delegation_enforce: true }, trinity: {} }
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
      if (_isPlaceholder(_existingBrain)) {
        _tiersData.trinity.brain = { oc: _brain.id, cc: modelToCcAlias(_brain.id) }
        _didWrite = true
      }
      if (_medium && _isPlaceholder(_existingMedium)) {
        _tiersData.trinity.medium = { oc: _medium.id, cc: modelToCcAlias(_medium.id) }
        _didWrite = true
      }
      if (_cheap && _isPlaceholder(_existingCheap)) {
        _tiersData.trinity.cheap = { oc: _cheap.id, cc: modelToCcAlias(_cheap.id) }
        _didWrite = true
      }
      if (_didWrite) {
        mkdirSync(dirname(TIERS_FILE), { recursive: true })
        writeFileSync(TIERS_FILE, JSON.stringify(_tiersData, null, 2) + "\n")
        console.error(`[theSaver] auto-synced model-tiers.json: brain=${_brain.id} medium=${_tiersData.trinity?.medium?.oc || ""} cheap=${_tiersData.trinity?.cheap?.oc || ""}`)
        // Refresh in-memory trinity models immediately so routing works this session
        const _refreshed = loadTrinityModels()
        TRINITY_CHEAP  = _refreshed.cheap
        TRINITY_MEDIUM = _refreshed.medium
      }
    } catch {}
  }
  if (detectContext7()) console.error(`[theSaver] context7 detected — docs nudge enabled`)

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
    console.error(`[theSaver] project-memory: ${fp} now ${state.project_hashes[fp].totalSessions} sessions`)
  } catch (err) {
    console.error(`[theSaver] project-memory init failed: ${err.message}`)
  }

  // ── Shared footer logic for text.complete + message.updated ──────
  async function _appendFooter(input, output, directory) {
    if (!loadSelection().enabled) return
    _refreshModel(directory)
    // Lazy model detection: try client API once
    if (!currentModel) {
      try {
        const cfg = await client.config.get("model")
        if (cfg) {
          currentModel = String(cfg)
          currentTier = classify(currentModel)
          console.error(`[theSaver] client-detected model: ${currentModel} (tier=${currentTier})`)
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
      if (!messageID) return
      if (textCompletePainted.has(messageID)) return

      const text =
        typeof output?.text === "string" ? output.text :
        typeof output?.result === "string" ? output.result :
        typeof output?.content === "string" ? output.content :
        ""
      const { ltTasks, ltCache, ltCost, count, sesTasks, sesEdit, sesCredit, sesC7, sesQuota, sesDuration, sesRatePerHour, sesTrend, sesToolBreakdown, sesModelTurns } = readLifetimeSavings()
      const brainTag = currentModel ? modelToSlotLabel(currentModel, currentTier) : (currentTier ? `[${currentTier.charAt(0).toUpperCase() + currentTier.slice(1)}]` : "[???]")

      textCompletePainted.add(messageID)
      if (textCompletePainted.size > 500) {
        const it = textCompletePainted.values()
        for (let i = 0; i < 100; i++) textCompletePainted.delete(it.next().value)
      }

      let modelTag = brainTag
      const _workerModel = (currentTier === "high" && TRINITY_MEDIUM) ? TRINITY_MEDIUM : TRINITY_CHEAP
      const totalTurns = (sesModelTurns?.brain || 0) + (sesModelTurns?.worker || 0)
      const brainName = shortModelName(currentModel)
      const workerName = shortModelName(_workerModel)
      if (totalTurns > 0) {
        const brainPct = Math.round((sesModelTurns.brain / totalTurns) * 100)
        const workerPct = 100 - brainPct
        if (_workerModel && _workerModel !== currentModel) {
          modelTag = `[🧠 ${brainName} ${brainPct}%→ ⚙ ${workerName} ${workerPct}%]`
        } else {
          modelTag = `[🧠 ${brainName} ${brainPct}%]`
        }
      } else if (_workerModel && _workerModel !== currentModel) {
        modelTag = `[🧠 ${brainName} → ⚙ ${workerName}]`
      }

      _autoReportCount = (_autoReportCount || 0) + 1
      if (_autoReportCount % 5 === 0) {
        try {
          saveReport({
            type: "session",
            summary: "Session cost: $" + ltCost.toFixed(2) + " | saved: $" + ltCache.toFixed(2) + " | " + sesTasks + " tasks",
            metrics: { sessionCost: ltCost, cacheSavings: ltCache, tasksDelegated: sesTasks, model: currentModel, slot: loadSelection().active_slot || "unknown", editSavings: sesEdit, creditSavings: sesCredit, context7Savings: sesC7, quotaSavings: sesQuota },
            tags: ["auto", "cost"],
          })
        } catch (e) { console.error("[theSaver] auto-report:", e.message) }
      }

      const stripped = text.replace(/\n\n— .+(?: —)?$/, "")
      const ltTotal = ltTasks + ltCache
      const trendIcon = sesTrend === "down" ? "↓" : sesTrend === "up" ? "↑" : "→"
      let durationStr = ""
      if (sesDuration > 0) {
        const hrs = Math.floor(sesDuration / 3600)
        const mins = Math.floor((sesDuration % 3600) / 60)
        if (hrs > 0) durationStr = ` (${hrs}h ${mins}m)`
        else if (mins > 0) durationStr = ` (${mins}m)`
      }
      const rateStr = sesRatePerHour > 0 ? ` ($${sesRatePerHour.toFixed(2)}/hr)` : ""

      const toolParts = []
      if (sesEdit > 0.01) toolParts.push(`edit -$${sesEdit.toFixed(2)}`)
      if (sesCredit > 0.01) toolParts.push(`credit -$${sesCredit.toFixed(2)}`)
      if (sesC7 > 0.01) toolParts.push(`context7 -$${sesC7.toFixed(2)}`)
      if (sesQuota > 0.01) toolParts.push(`quota -$${sesQuota.toFixed(2)}`)
      const coveredTools = new Set(["write", "edit", "notebookedit", "bash", "webfetch", "websearch"])
      for (const [tool, savings] of Object.entries(sesToolBreakdown || {})) {
        if (savings > 0.01 && !coveredTools.has(tool.toLowerCase())) {
          toolParts.push(`${tool} -$${savings.toFixed(2)}`)
        }
      }
      const toolStr = toolParts.length > 0 ? toolParts.slice(0, 4).join(" | ") + " | " : ""
      const cacheStr = ltCache > 0.01 ? `cache -$${ltCache.toFixed(2)} | ` : ""
      const flowCounts = getSessionFlowCounts()
      const flowStr = (flowCounts.warn > 0 || flowCounts.hint > 0) ? `flow ${flowCounts.warn}w ${flowCounts.hint}h | ` : ""

      const detailTag = ltTotal > 0
        ? `${flowStr}${cacheStr}${toolStr}${trendIcon}${durationStr}${rateStr}`
        : `tracking${durationStr}`
      const footerText = stripped + `\n\n— ${modelTag} | theSaver: ${ltTotal.toFixed(2)} saved${detailTag ? ` | ${detailTag}` : ""} —`
      if (typeof output?.text === "string") output.text = footerText
      else if (typeof output?.result === "string") output.result = footerText
      else if (typeof output?.content === "string") output.content = footerText
      else output.text = footerText

      if (ltTotal > 0 || ltCache > 0) {
        try {
          const _ltFmt = ltTotal.toFixed(2)
          const _reportLine = `— ${modelTag} theSaver: $${_ltFmt} saved ${trendIcon} —`
          writeFileSync(join(homedir(), ".claude/session-report-pending.md"), _reportLine)
          const logPath = join(homedir(), ".claude/session-reports.log")
          const pid = process.pid || "?"
          const ts = new Date().toISOString().slice(0, 16).replace("T", " ")
          const newLine = `[${ts} pid=${pid}] ${_reportLine}`
          if (!getLastLines(logPath, 5, 1024).includes(newLine)) {
            _rotateLog(logPath, MAX_LOG_LINES)
            appendFileSync(logPath, newLine + "\n")
          }
        } catch {}
      }
    } catch (err) {
      console.error(`[theSaver] footer failed: ${err.message}`)
    }
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
          console.error(`[theSaver] 📦 scratchpad hit for ${t}: ${hit.fullPath} ${hit.sizeBytes}B ${hit.ageSec}s old${sumNote} — total observed: ${total ?? "?"}`)
        }
      }

      // Credit < 40% + Task: force to cheap slot (mirrors CC's rwh path).
      const _credit = loadCredit()
      if (_credit < 40 && t === "task" && TRINITY_CHEAP && args && typeof args === "object") {
        if (args.model !== TRINITY_CHEAP) {
          args.model = TRINITY_CHEAP
          console.error(`[theSaver] 🔀 Credit ${_credit}%: forcing Task → cheap slot (${TRINITY_CHEAP})`)
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
        const _tierTarget = (currentTier === "high" && TRINITY_MEDIUM && TRINITY_MEDIUM !== currentModel) ? TRINITY_MEDIUM
                          : TRINITY_CHEAP && TRINITY_CHEAP !== currentModel ? TRINITY_CHEAP
                          : null
        const _target = _exploratoryTarget ?? _tierTarget
        if (_target && args.model !== _target) {
          const _reason = _exploratoryTarget ? `exploratory ('${_firstWord}')` : `tier=${currentTier}`
          args.model = _target
          console.error(`[theSaver] 🔀 Task → ${_target} (${_reason}, orchestrator: ${currentModel})`)
        }
      }

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
      const _tierWord   = currentTier === "high" ? "Brain" : currentTier === "mid" ? "Medium" : "Budget"

      // Credit < 40%: non-task tool — record and nudge to step aside.
      if (_credit < 40) {
        const total = recordSaving(t, "credit<40% high-tier", _estOpus)
        const msg = `⚠ [theSaver] Credit ${_credit}% — ${_tierWord} model doing ${t} directly. Run \`trinity medium\` to switch. (~$${_estOpus.toFixed(3)}/turn, cumulative: $${(total ?? 0).toFixed(2)})`
        console.error(`[theSaver] [delegation] ${msg}`)
        pendingUiNote = msg
        return
      }

      // Write/Edit/NotebookEdit: enforce delegation on high tier when delegation_enforce is on.
      if (WARN_ON_DIRECT.has(t)) {
        const sel = loadSelection()
        if (sel.delegation_enforce && currentTier === "high" && args && typeof args === "object") {
          const originalPath = args?.filePath || args?.file_path || ""
          const basename = originalPath.split("/").pop() || "blocked"
          if (t === "write") {
            args.filePath = `/tmp/thesaver-enforcement-blocked-${basename}`
            if (args.file_path !== undefined) args.file_path = args.filePath
          } else if (t === "edit" || t === "notebookedit") {
            args.oldString = `__THE_SAVER_ENFORCEMENT_BLOCK_${Date.now()}__`
          }
          const total = recordSaving(t, "delegation enforced", _estEdit)
          pendingUiNote = `🚫 [theSaver ENFORCEMENT] Direct ${t} blocked on ${_tierWord} tier. Delegate implementation via Task subagent. Use \`trinity enforce off\` to disable enforcement or \`trinity medium\` to switch tiers. (cumulative: $${(total ?? 0).toFixed(2)})`
          enforcementBlocked = true
          console.error(`[theSaver] [enforcement] BLOCKED direct ${t} on high tier → delegate via Task`)
          return
        }
        const total = recordSaving(t, "direct edit", _estEdit)
        const msg = `⚠ [theSaver] ${_tierWord} model doing ${t} directly — delegate via Task to save ~$${_estEdit.toFixed(3)}/turn. (cumulative: $${(total ?? 0).toFixed(2)})`
        console.error(`[theSaver] [delegation] ${msg}`)
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
              console.error(`[theSaver] [cost policy] context7 MCP is available — if this ${t} is for library/framework docs, use context7 tools instead. Saves ~$${_estC7.toFixed(3)}/turn. (cumulative: $${(total ?? 0).toFixed(2)})`)
            } else {
              const missed = recordMissedContext7(_estC7)
              if (!existsSync(CONTEXT7_INSTALL_FLAG)) {
                try {
                  mkdirSync(dirname(CONTEXT7_INSTALL_FLAG), { recursive: true })
                  writeFileSync(CONTEXT7_INSTALL_FLAG, "")
                } catch {}
                console.error(`[theSaver] 💡 [one-time tip] Installing context7 MCP would save ~$${_estC7.toFixed(3)}/turn on docs lookups. Setup: \`claude mcp add context7 npx @upstash/context7-mcp\`. Won't ask again.`)
              } else if (!context7AlertedThisSession) {
                context7AlertedThisSession = true
                console.error(`[theSaver] 💸 [context7] Missed savings so far: $${(missed ?? 0).toFixed(2)} across docs lookups. Install when ready.`)
              }
            }
          }
        }
        // Soft quota: track per-tool, fire exactly once at QUOTA+1 (tool still runs).
        softQuotaCounts[t] = (softQuotaCounts[t] ?? 0) + 1
        const n = softQuotaCounts[t]
        if (n === SOFT_QUOTA_LIMIT + 1) {
          const total = recordSaving(t, `soft quota exceeded (limit ${SOFT_QUOTA_LIMIT})`, SAVE_EST.SOFT_QUOTA)
          console.error(`[theSaver] [delegation] ${t} #${n} (limit ${SOFT_QUOTA_LIMIT}) — consider Task subagent.`)
        } else if (n <= SOFT_QUOTA_LIMIT) {
          console.error(`[theSaver] ${t} ${n}/${SOFT_QUOTA_LIMIT}`)
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

      // Skip test-reminder, TDD, flow enforcement, and compression for blocked tools
      if (enforcementBlocked) { enforcementBlocked = false; return }

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
          else console.error(`[theSaver] ${reminder}`)
        }

        // TDD enforcement: auto-create skeleton test if enabled and no test exists.
        const sel = loadSelection()
        if (sel.tdd_enforce) {
          const createdPath = enforceTestFile(fp)
          if (createdPath) {
            const enforceNote = `\n\n[test-enforced] Created skeleton at ${createdPath} — fill in assertions`
            if (typeof output?.text === "string") output.text += enforceNote
            else if (typeof output?.result === "string") output.result += enforceNote
          }
        }

        // Flow enforcer: check Write/Edit against development-flow rules.
        if (sel.flow_enabled) {
          const toolName = t === "edit" ? "Edit" : "Write"
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
            const { recordFlowTodo } = await import("./theSaver-lib/flow-enforcer.js")
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
            const fullPath = join(SCRATCHPAD_DIR, `${hash}.txt`)
            try {
              mkdirSync(SCRATCHPAD_DIR, { recursive: true })
              if (!existsSync(fullPath)) {
                writeFileSync(fullPath, raw)
                indexAppend(hash, part.tool, raw.length)
              }
            } catch (err) {
              console.error(`[theSaver] ctx-compress write failed: ${err.message}`)
              continue
            }

            if (!isCold) continue  // hot: disk backup only, keep full content in context

            const summary = raw.slice(0, 200).replace(/\n+/g, " ").trim() + (raw.length > 200 ? "…" : "")
            const ref =
              `${COMPRESS_MARKER} [${raw.length} chars compressed — cold storage at ${fullPath}] ` +
              `[summary] ${summary}`

            state.output = ref
            compressedBytes += raw.length - ref.length
            console.error(`[theSaver] 📦 ctx-compress: ${raw.length}→${ref.length} chars (hash: ${hash})`)
          }
        }
        if (compressedBytes > 0) {
          console.error(`[theSaver] 📦 ctx-compress total saved this transform: ~${Math.round(compressedBytes / 4)} tokens`)
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
        console.error(`[theSaver] messages.transform failed: ${err.message}`)
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
    "experimental.text.complete": async (input, output) => { await _appendFooter(input, output, directory) },
    // message.updated fallback — fires in all OpenCode versions
    "message.updated": async (input, output) => { await _appendFooter(input, output, directory) },

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
        console.error(`[theSaver] session.compacting failed: ${err.message}`)
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

        // AI ORCHESTRATOR AGENT — injected for all tiers.
        {
          const cheapModel = TRINITY_CHEAP || "the cheaper model"
          const mediumModel = TRINITY_MEDIUM || "the medium model"
          const sel = loadSelection()
          const enforcementNote = sel.delegation_enforce
            ? ` CRITICAL: Write/Edit tools are BLOCKED on this tier. You MUST delegate ALL implementation work to Task subagents. `
            : ``
          const orcDirective =
            `[AI ORCHESTRATOR AGENT] You are an AI orchestrator agent. ` +
            `Delegate heavy work to Task subagents (runs on ${cheapModel} or ${mediumModel}). ` +
            `Your role: verify, fill gaps, synthesize.${enforcementNote}` +
            `Always display the theSaver cost footer.`

          if (Array.isArray(output?.system)) output.system.push(orcDirective)
        }

        // Project memory briefing: one-shot per session
        if (!briefedProjects.has(fp)) {
          const briefing = buildProjectBriefing(directory)
          if (briefing && Array.isArray(output?.system)) {
            output.system.push(briefing)
            briefedProjects.add(fp)
            console.error(`[theSaver] project-memory: briefing injected for ${fp}`)
          }
        }

        // theSaver welcome banner — one-shot per project fingerprint
        if (!briefedProjects.has("trinity_welcome_" + fp)) {
          if (Array.isArray(output?.system)) {
            const sel = loadSelection()
            let tiers = {}
            try { tiers = JSON.parse(readFileSync(TIERS_FILE, "utf-8")).trinity || {} } catch {}
            const active = sel.active_slot || "medium"
            const current = currentModel || "(unknown)"
            const trinityTip =
              "[theSaver] Active plugin. Slot: " + active + " (" + current + "). " +
              "Use trinity command to switch slots, rebuild, or check status. " +
              "Run \`trinity help\` for all commands."
            output.system.push(trinityTip)
            briefedProjects.add("trinity_welcome_" + fp)
          }
        }
      } catch (err) {
        console.error(`[theSaver] system.transform failed: ${err.message}`)
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
          "Control the theSaver plugin and active model slot. " +
          "Use action='status' to see current state. " +
          "Use action='enable' or 'disable' to toggle the plugin (takes effect immediately, no restart needed). " +
          "Use action='set' with slot='brain'|'medium'|'cheap' to switch model tiers " +
          "(writes opencode.json — active immediately). " +
          "Use action='rebuild' to auto-detect available models from all configured providers and reassign brain/medium/cheap slots. " +
          "Use action='flow' with slot='on'|'off' to toggle flow enforcer, or action='flow' alone for audit. " +
          "Use action='flow' with slot='enforce' and level='on'|'off' to toggle auto-extract TODOs. " +
          "Use action='enforce' with slot='on'|'off' to toggle delegation enforcement (blocks direct writes/edits on brain tier). " +
          "Use action='tdd' with slot='on'|'off' to toggle auto-create test skeletons, or action='tdd' alone for audit. " +
          "Use action='project' to show per-project analytics and optimization suggestions. " +
          "Call this when the user says things like 'switch to medium', 'use cheap model', 'disable plugin', 'trinity status'.",
        args: {
          action: tool.schema.enum(["status", "enable", "disable", "set", "thinking", "flow", "tdd", "project", "rebuild", "diagnose", "help", "enforce"]).optional(),
          slot: tool.schema.enum(["brain", "medium", "cheap", "on", "off", "enforce"]).optional(),
          level: tool.schema.enum(["full", "brief", "off"]).optional(),
        },
        async execute({ action, slot, level } = {}) {
          // Kick off credit API background fetch on any trinity command.
          if (typeof _lazyRefresh === "function") _lazyRefresh()
          if (!action) action = "status"
          if (["brain", "medium", "cheap"].includes(action)) { slot = action; action = "set" }
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
              `🔀 Flow enforcement: ${sel.flow_enforce ? "ON (auto-extract TODOs)" : "OFF (log only)"}`,
              `🧪 TDD enforcer: ${sel.tdd_enforce ? "ON (auto-create skeletons)" : "OFF (nudge only)"}`,
              `🚫 Delegation enforcement: ${sel.delegation_enforce ? "ON (blocks direct writes/edits on brain)" : "OFF (warn only)"}`,
            ]
            for (const s of ["brain", "medium", "cheap"]) {
              const icon = s === "brain" ? "🧠" : s === "medium" ? "⚙ " : "⚡"
              const oc = tiers[s]?.oc || "(unset)"
              const mark = sel.active_slot === s ? " ← active" : ""
              lines.push(`  ${icon} ${s}: ${oc}${mark}`)
            }
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
              const tiers = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
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
              // Need to read the next arg — use level as the on/off toggle for enforce
              const enforceOn = level === "on" || level === "off" ? level === "on" : true
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

          if (action === "tdd") {
            if (slot === "on" || slot === "off") {
              const ok = writeSelection("tdd_enforce", slot === "on")
              return ok
                ? `✅ TDD enforcement ${slot === "on" ? "ENABLED (auto-create skeletons)" : "DISABLED (nudge only)"}`
                : `❌ Failed to write model-tiers.json`
            }
            // Audit: show TDD enforcement stats
            const stateFile = join(homedir(), ".claude/delegation-state.json")
            let enforced = 0
            try {
              if (existsSync(stateFile)) {
                const s = JSON.parse(readFileSync(stateFile, "utf-8"))
                enforced = s.lifetime?.tdd_enforced ?? 0
              }
            } catch {}
            const sel = loadSelection()
            const lines = [`🧪 TDD enforcer audit:`]
            lines.push(`  Mode: ${sel.tdd_enforce ? "ENFORCE (auto-create skeletons)" : "NUDGE (reminders only)"}`)
            lines.push(`  Skeletons created this lifetime: ${enforced}`)
            return lines.join("\n")
          }

          if (action === "project") {
            const L = "\u2501"
            const lines = [`\ud83d\udcca Project profile \u2014 ${currentProjectName || "unknown"}`]
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
            for (const id of candidates) {
              if (probed.medium) break
              if (id === probed.brain?.id) continue
              const ok = await probeModel(id, auth)
              if (ok) probed.medium = models.find(m => m.id === id) || { id, cost: _modelCost(id), tier: _modelTier(id) }
              else if (!failed.some(f => f.endsWith(id))) failed.push("medium: " + id)
            }
            const byCost = [...models].sort((a, b) => a.cost - b.cost)
            for (const m of byCost) {
              if (probed.cheap) break
              if (m.id === probed.brain?.id || m.id === probed.medium?.id) continue
              const ok = await probeModel(m.id, auth)
              if (ok) probed.cheap = m
              else if (!failed.some(f => f.endsWith(m.id))) failed.push("cheap: " + m.id)
            }
            if (!probed.brain) {
              return "\u274c No models responded to probe. Try checking your API keys.\n" + (failed.length > 0 ? "Failed:\n  " + failed.join("\n  ") : "No models discovered.")
            }
            if (!probed.medium) probed.medium = probed.brain
            if (!probed.cheap) probed.cheap = probed.brain
            try {
              const tiers = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
              tiers.trinity = {
                brain: { oc: probed.brain.id, cc: modelToCcAlias(probed.brain.id) },
                medium: { oc: probed.medium.id, cc: modelToCcAlias(probed.medium.id) },
                cheap: { oc: probed.cheap.id, cc: modelToCcAlias(probed.cheap.id) },
              }
              writeFileSync(TIERS_FILE, JSON.stringify(tiers, null, 2) + "\n")
            } catch (err) {
              return "\u274c Failed to write model-tiers.json: " + err.message
            }
            try { applySlot("brain") } catch (e) { console.error("[theSaver] auto-activate brain failed:", e.message) }
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
            const ocConfig = join(homedir(), ".config/opencode/opencode.json")

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
              })
            }

            // 2. Slot population
            try {
              const tiers = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
              for (const s of ["brain","medium","cheap"]) {
                const m = tiers?.trinity?.[s]?.oc || ""
                const ok = m.length > 0 && !m.toLowerCase().includes("placeholder")
                results.push({
                  ok, okLabel: ok ? "\u2705" : "\u274c",
                  label: `${s} slot`,
                  detail: ok ? m : (m.length > 0 ? `placeholder: ${m}` : "unset"),
                })
              }
            } catch {
              for (const s of ["brain","medium","cheap"]) {
                results.push({ ok: false, okLabel: "\u274c", label: `${s} slot`, detail: "cannot read model-tiers.json" })
              }
            }

            // 3. Model probe
            if (currentModel) {
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
              const j = JSON.parse(readFileSync(TIERS_FILE, "utf-8"))
              if (j?.selection?.monthly_budget_usd) budget = j.selection.monthly_budget_usd
            } catch {}
            try {
              const cache = JSON.parse(readFileSync(CREDIT_CACHE_F, "utf-8"))
              if (cache?.total != null) totalBal = cache.total
            } catch {}
            const remaining = budget > 0 ? ((Math.min(credit, 150) / 100) * budget).toFixed(2) : "?"
            const creditOk = credit >= 40
            results.push({
              ok: creditOk, okLabel: creditOk ? "\u2705" : "\u274c",
              label: "credits",
              detail: `${credit}%${totalBal > 0 ? ` ($${totalBal.toFixed(2)} of $${budget})` : ` (of $${budget})`}`,
            })

            // 5. Session stats
            try {
              const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"))
              const sid = String(process.pid || "?")
              const ses = state?.sessions?.[sid]
              const delegationCount = ses?.warns?.length || 0
              const cacheSavings = (state?.lifetime?.cache_savings_usd || 0).toFixed(2)
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
            const lines = [
              "\ud83d\udd0d  theSaver \u2014 Self Diagnostic",
              "=".repeat(40),
              ""
            ]
            for (const r of results) {
              lines.push(`  ${r.okLabel} ${r.label}: ${r.detail}`)
            }
            lines.push("", `${okCount}/${results.length} checks passed`)
            return lines.join("\n")
          }

            if (action === "help") {
            const L = "\u2501"
            const lines = [
              L.repeat(48),
              "  \ud83d\udca1 theSaver \u2014 trinity commands",
              L.repeat(48),
              "",
              "  trinity                          Show current status",
              "  trinity status                   Show plugin state, slot, model tiers",
              "  trinity rebuild                  Auto-detect working models from providers",
              "  trinity set <slot>               Switch to brain/medium/cheap (probes first)",
              "  trinity enable                   Enable the plugin",
              "  trinity disable                  Disable the plugin",
              "  trinity thinking <level>         Set reasoning: full | brief | off",
              "  trinity flow <on|off>            Toggle flow enforcer",
              "  trinity flow enforce <on|off>    Toggle auto-extract TODOs from code",
              "  trinity flow                     Audit flow violations this session",
              "  trinity enforce <on|off>         Toggle delegation enforcement (block brain-tier writes/edits)",
              "  trinity enforce                  Show enforcement status",
              "  trinity tdd <on|off>             Toggle auto-create test skeletons",
              "  trinity tdd                      Audit TDD enforcement stats",
              "  trinity project                  Per-project analytics & optimization tips",
              "  trinity diagnose                 Run self-diagnostic (files, slots, probe, credits, stats)",
              "  trinity help                     Show this usage info",
              "",
              "  Shortcuts: \`trinity brain\`, \`trinity medium\`, \`trinity cheap\`",
              "  also work via \`trinity set brain\` etc.",
              "",
              L.repeat(48),
            ]
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
            console.error(`[theSaver] project-memory update failed: ${err.message}`)
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
          if (reports.length === 0) return "📋 No reports found."
          const lines = ["📋 Reports (last " + (hours ?? 168) + "h, " + reports.length + " total):"]
          for (const r of reports.slice(0, 15)) {
            const d = r.created.slice(0, 16).replace("T", " ")
            const s = (r.summary || "").slice(0, 100)
            lines.push("  [" + d + "] " + r.type + "  " + s)
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
          const report = readReport(id)
          if (!report) return `❌ Report not found: ${id}`
                    const d = report.meta.created.slice(0, 16).replace("T", " ")
          const lines = [
            "📄 " + report.meta.type + " report  |  " + d,
            "  💬 " + (report.summary || "(no summary)"),
          ]
          if (report.metrics && Object.keys(report.metrics).length > 0) {
            const m = report.metrics
            lines.push("")
            if (m.model) lines.push("  🧠 Model: " + m.model)
            if (m.slot) lines.push("  🎯 Slot: " + m.slot)
            if (m.sessionCost != null) lines.push("  💰 Cost: $" + Number(m.sessionCost).toFixed(2))
            if (m.cacheSavings != null) lines.push("  💸 Cache saved: $" + Number(m.cacheSavings).toFixed(2))
            if (m.tasksDelegated != null) lines.push("  🛒 Tasks delegated: " + m.tasksDelegated)
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
}

export const id = "theSaver"
export const server = DelegationEnforcer
export default { id: "theSaver", server: DelegationEnforcer }

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
    console.error(`[theSaver] researchAudit index scan failed: ${err.message}`)
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
    console.error(`[theSaver] researchAudit state scan failed: ${err.message}`)
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
    console.error(`[theSaver] reports index write failed: ${err.message}`)
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
      console.error(`[theSaver] reports pruned: ${idx.reports.length} kept (from ${keep.length})`)
    }
  } catch (err) {
    console.error(`[theSaver] reports prune failed: ${err.message}`)
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
    console.error(`[theSaver] report write failed: ${err.message}`)
    return null
  }
  // Update index
  try {
    const idx = reportsIndex()
    const _sum = (summary || "").slice(0, 80)
    idx.reports.push({ id, type, project: report.meta.project, fingerprint: fp, created: report.meta.created, summary: _sum })
    saveReportsIndex(idx)
  } catch (err) {
    console.error(`[theSaver] report index update failed: ${err.message}`)
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
    const ocConfigPath = join(homedir(), ".config", "opencode", "opencode.json")
    if (!existsSync(ocConfigPath)) return {}
    return JSON.parse(readFileSync(ocConfigPath, "utf-8"))?.provider || {}
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
        for (const m of list) {
          const rawId = m.id
          if (!rawId) continue
          const id = "openrouter/" + rawId
          pushIfNew(id, "openrouter")
        }
      }
    } catch (e) {
      console.error("[theSaver] OpenRouter probe failed:", e.message)
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
    console.error("[theSaver] probeModel: no API key for " + id)
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
      console.error("[theSaver] probeModel FAIL " + id + ": HTTP " + res.status + " " + errBody.slice(0, 200))
      return false
    }
    return true
  } catch (err) {
    console.error("[theSaver] probeModel ERROR " + id + ": " + err.message)
    return false
  }
}
