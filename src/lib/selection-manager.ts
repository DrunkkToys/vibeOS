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

const DFLT_SEL = { enabled: true, active_slot: null, slot_locked: false, thinking_level: "off", flow_enabled: true, tdd_enforce: false, tdd_strict: false, tdd_quality: true, flow_enforce: true, delegation_enforce: true, onboarding_mode: null, selected_provider: null, selected_quality_tier: null, selected_model: null, executed_provider: null, executed_quality_tier: null, executed_model: null, requested_optimization_mode: null, previous_default_agent: null, previous_optimization_mode: null }

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
      selected_provider:  j?.selection?.selected_provider || null,
      selected_quality_tier: j?.selection?.selected_quality_tier || null,
      selected_model:     j?.selection?.selected_model || null,
      executed_provider:  j?.selection?.executed_provider || null,
      executed_quality_tier: j?.selection?.executed_quality_tier || null,
      executed_model:     j?.selection?.executed_model || null,
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

export function loadSessionSlot(sid: string): string | null {
  const BLACKBOX_FILE = join(getVibeOSHome(), "blackbox-state.json")
  try {
    if (!existsSync(BLACKBOX_FILE)) return null
    const j = safeJsonParse(readFileSync(BLACKBOX_FILE, "utf-8"))
    return j?.sessions?.[sid]?.active_slot || null
  } catch { return null }
}

export function writeSessionSlot(sid: string, slot: string): boolean {
  const BLACKBOX_FILE = join(getVibeOSHome(), "blackbox-state.json")
  try {
    const j = existsSync(BLACKBOX_FILE)
      ? safeJsonParse(readFileSync(BLACKBOX_FILE, "utf-8"))
      : {}
    if (!j.sessions) j.sessions = {}
    if (!j.sessions[sid]) j.sessions[sid] = {}
    j.sessions[sid].active_slot = slot
    const tmp = BLACKBOX_FILE + ".tmp"
    writeFileSync(tmp, JSON.stringify(j, null, 2) + "\n")
    renameSync(tmp, BLACKBOX_FILE)
    return true
  } catch (err) {
    console.error("[vibeOS] writeSessionSlot failed: " + err.message)
    return false
  }
}

export function loadSessionOptMode(sid: string): string | null {
  const BLACKBOX_FILE = join(getVibeOSHome(), "blackbox-state.json")
  try {
    if (!existsSync(BLACKBOX_FILE)) return null
    const j = safeJsonParse(readFileSync(BLACKBOX_FILE, "utf-8"))
    return j?.sessions?.[sid]?.optimization_mode || null
  } catch { return null }
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
  const BLACKBOX_FILE = join(getVibeOSHome(), "blackbox-state.json")
  try {
    const j = existsSync(BLACKBOX_FILE)
      ? safeJsonParse(readFileSync(BLACKBOX_FILE, "utf-8"))
      : {}
    if (!j.sessions) j.sessions = {}
    if (!j.sessions[sid]) j.sessions[sid] = {}
    j.sessions[sid].optimization_mode = mode
    const tmp = BLACKBOX_FILE + ".tmp"
    writeFileSync(tmp, JSON.stringify(j, null, 2) + "\n")
    renameSync(tmp, BLACKBOX_FILE)
    return true
  } catch (err) {
    console.error("[vibeOS] writeSessionOptMode failed: " + err.message)
    return false
  }
}

export { DFLT_SEL }
