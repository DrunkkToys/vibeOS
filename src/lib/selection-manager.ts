import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, copyFileSync, renameSync } from "node:fs"
import { join, basename } from "node:path"
import { homedir, tmpdir } from "node:os"
import { withFileLock, _handleStateCorruption } from "./state.js"
import { memoCompute } from "./turn-memo.js"

const USER_HOME = (() => { try { return homedir() } catch { return tmpdir() } })()
function getVibeOSHome() {
  return process.env.VIBEOS_HOME || join(process.env.HOME || homedir(), ".claude")
}

function safeJsonParse(raw: string): any {
  if (raw == null || raw === "") return null
  try { return JSON.parse(raw) } catch {}

  let cleaned = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1")
  try { return JSON.parse(cleaned) } catch (e) { throw e }
}

const DFLT_SEL = { enabled: true, active_slot: null, slot_locked: false, thinking_level: "off", flow_enabled: true, tdd_enforce: false, tdd_strict: false, tdd_quality: true, flow_enforce: true, delegation_enforce: true, onboarding_mode: null, requested_optimization_mode: null, previous_default_agent: null, previous_optimization_mode: null }
const SHADOW_SELECTION_KEYS = new Set(["selected_provider", "selected_quality_tier", "selected_model", "executed_provider", "executed_quality_tier", "executed_model"])

// mtime-based cache for loadSelection — single stat() per turn (microseconds),
// no stale data even when other code writes directly to model-tiers.json
let _selCache: any = null
let _selLastStamp = ""

const SEL_CACHE_KEY = "selection-manager:loadSelection"

const TIERS_FILE_PATH = () => join(getVibeOSHome(), "model-tiers.json")

export function _resetSelectionCacheForTest(): void {
  _selCache = null
  _selLastStamp = ""
}

function loadSelectionImpl(): any {
  const TIERS_FILE = TIERS_FILE_PATH()
  try {
    if (!existsSync(TIERS_FILE)) return DFLT_SEL
    const st = statSync(TIERS_FILE)
    if (st.size > 10485760) { _handleStateCorruption(TIERS_FILE); return DFLT_SEL }
    const j = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
    const activePipelineRaw = j?.selection?.active_pipeline
    const activePipeline = Array.isArray(activePipelineRaw)
      ? activePipelineRaw
      : typeof activePipelineRaw === "string"
        ? safeJsonParse(activePipelineRaw)
        : null
    return {
      enabled:            j?.selection?.enabled !== false,
      active_slot:        j?.selection?.active_slot || null,
      slot_locked:        j?.selection?.slot_locked === true,
      active_pipeline:    Array.isArray(activePipeline) ? activePipeline : null,
      optimization_mode:  j?.selection?.optimization_mode || null,
      thinking_level:     j?.selection?.thinking_level || "off",
      flow_enabled:       j?.selection?.flow_enabled === true,
      tdd_enforce:        j?.selection?.tdd_enforce === true,
      tdd_strict:         j?.selection?.tdd_strict === true,
      tdd_quality:        j?.selection?.tdd_quality !== false,
      flow_enforce:       j?.selection?.flow_enforce === true,
      delegation_enforce: j?.selection?.delegation_enforce !== false,
      onboarding_mode:    j?.selection?.onboarding_mode || null,
      requested_optimization_mode: j?.selection?.requested_optimization_mode || null,
      previous_default_agent: j?.selection?.previous_default_agent || null,
      previous_optimization_mode: j?.selection?.previous_optimization_mode || null,
    }
  } catch { _handleStateCorruption(TIERS_FILE); return DFLT_SEL }
}

export function loadSelection(): any {
  const TIERS_FILE = TIERS_FILE_PATH()
  if (!existsSync(TIERS_FILE)) {
    _selCache = DFLT_SEL
    _selLastStamp = ""
    return _selCache
  }
  const st = statSync(TIERS_FILE, { bigint: true })
  const curStamp = `${st.ino}:${st.mtimeNs}:${st.size}`
  if (_selCache && _selLastStamp === curStamp) return _selCache
  _selCache = loadSelectionImpl()
  _selLastStamp = curStamp
  return _selCache
}

export function writeSelection(key: string, value: any): boolean {
  const TIERS_FILE = join(getVibeOSHome(), "model-tiers.json")
  try {
    const result = withFileLock(TIERS_FILE, () => {
      const j = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
      if (!j.selection) j.selection = {}
      for (const shadowKey of SHADOW_SELECTION_KEYS) delete j.selection[shadowKey]
      j.selection[key] = value
      const tmp = TIERS_FILE + ".tmp." + Date.now() + "." + Math.random().toString(36).slice(2, 8)
      writeFileSync(tmp, JSON.stringify(j, null, 2) + "\n")
      renameSync(tmp, TIERS_FILE)
      return true
    })
    return result
  } catch (err) {
    console.error(`[vibeOS] writeSelection failed: ${err.message}`)
    return false
  }
}

export function sanitizeSelection(selection: any): any {
  if (!selection || typeof selection !== "object") return selection
  for (const shadowKey of SHADOW_SELECTION_KEYS) delete selection[shadowKey]
  return selection
}

function readSessionRecord(sid: string): any {
  const BLACKBOX_FILE = join(getVibeOSHome(), "blackbox-state.json")
  try {
    if (!existsSync(BLACKBOX_FILE)) return null
    const j = safeJsonParse(readFileSync(BLACKBOX_FILE, "utf-8"))
    return j?.sessions?.[sid] || null
  } catch {
    return null
  }
}

function writeSessionRecord(sid: string, updater: (record: any) => void): boolean {
  const BLACKBOX_FILE = join(getVibeOSHome(), "blackbox-state.json")
  try {
    const j = existsSync(BLACKBOX_FILE)
      ? safeJsonParse(readFileSync(BLACKBOX_FILE, "utf-8"))
      : {}
    if (!j.sessions) j.sessions = {}
    if (!j.sessions[sid]) j.sessions[sid] = {}
    updater(j.sessions[sid])
    const tmp = BLACKBOX_FILE + ".tmp"
    writeFileSync(tmp, JSON.stringify(j, null, 2) + "\n")
    renameSync(tmp, BLACKBOX_FILE)
    return true
  } catch (err) {
    console.error("[vibeOS] writeSessionRecord failed: " + err.message)
    return false
  }
}

export function loadSessionSlot(sid: string): string | null {
  const record = readSessionRecord(sid)
  return record?.active_slot || null
}

export function writeSessionSlot(sid: string, slot: string): boolean {
  return writeSessionRecord(sid, (record) => {
    record.active_slot = slot
  })
}

export function loadSessionOptMode(sid: string): string | null {
  const record = readSessionRecord(sid)
  return record?.optimization_mode || null
}

export function loadGlobalOptMode(): string | null {
  try {
    const sel = loadSelection()
    return sel.optimization_mode || null
  } catch { return null }
}

export function saveGlobalOptMode(mode: string): boolean {
  return writeSelection("optimization_mode", mode)
}

export function writeSessionOptMode(sid: string, mode: string): boolean {
  return writeSessionRecord(sid, (record) => {
    record.optimization_mode = mode
  })
}

export { DFLT_SEL }
