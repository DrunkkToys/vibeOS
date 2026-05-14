import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES_PATH = join(__dirname, "flow-rules.json")
const STATE_FILE = join(homedir(), ".claude/delegation-state.json")

const _flowWarnsSeen = new Set()

let _cachedRules = null
let _rulesMtime = 0

function loadRules() {
  try {
    const mtime = _cachedRules ? statSync(RULES_PATH).mtimeMs : 0
    if (_cachedRules && mtime === _rulesMtime) return _cachedRules
    if (!existsSync(RULES_PATH)) { _cachedRules = []; return _cachedRules }
    const j = JSON.parse(readFileSync(RULES_PATH, "utf-8"))
    _cachedRules = j.rules || []
    _rulesMtime = mtime
    return _cachedRules
  } catch {
    _cachedRules = []
    return _cachedRules
  }
}

function recordFlowWarn(hit) {
  try {
    let state = {}
    if (existsSync(STATE_FILE)) {
      try { state = JSON.parse(readFileSync(STATE_FILE, "utf-8")) } catch {}
    } else {
      mkdirSync(dirname(STATE_FILE), { recursive: true })
    }
    state.flow_warns ??= []
    state.flow_warns.push({
      at: new Date().toISOString(),
      sid: process.pid || "?",
      rule_id: hit.id,
      severity: hit.severity,
      filePath: hit.filePath,
      description: hit.description,
    })
    if (state.flow_warns.length > 500) {
      state.flow_warns = state.flow_warns.slice(-500)
    }
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch {}
}

export function checkFlowRules({ tool, filePath, content }) {
  const rules = loadRules()
  const hits = []

  for (const rule of rules) {
    if (rule.trigger !== tool) continue
    const target = tool === "Write" ? (filePath || "") : (content || filePath || "")
    let re
    try { re = new RegExp(rule.pattern) } catch { continue }
    if (!re.test(target)) continue

    const key = `${rule.id}::${filePath || ""}`
    if (_flowWarnsSeen.has(key)) {
      hits.push({ ...rule, filePath, deduped: true })
      continue
    }
    _flowWarnsSeen.add(key)
    const hit = { ...rule, filePath, deduped: false }
    hits.push(hit)
    recordFlowWarn(hit)
  }

  return hits
}

export function getFlowWarns() {
  try {
    if (!existsSync(STATE_FILE)) return []
    const s = JSON.parse(readFileSync(STATE_FILE, "utf-8"))
    return s?.flow_warns || []
  } catch { return [] }
}

export function getSessionFlowCounts() {
  const counts = { warn: 0, hint: 0, flag: 0 }
  for (const key of _flowWarnsSeen) {
    const rules = loadRules()
    const [ruleId] = key.split("::")
    const rule = rules.find(r => r.id === ruleId)
    if (rule && counts[rule.severity] !== undefined) counts[rule.severity]++
  }
  return counts
}

export function resetForTest(rules) {
  _cachedRules = rules
  _flowWarnsSeen.clear()
  // Sync mtime so loadRules() returns test rules instead of reloading from file
  try { _rulesMtime = statSync(RULES_PATH).mtimeMs } catch {}
}
