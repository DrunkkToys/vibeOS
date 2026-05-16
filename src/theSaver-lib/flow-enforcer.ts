// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 theSaver <https://github.com/DrunkkToys/theSaver-oc>
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync, appendFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

type FlowSeverity = "warn" | "hint" | "flag"

type FlowRule = {
  id: string
  trigger: string
  pattern: string
  severity: FlowSeverity
  description?: string
}

type FlowHit = FlowRule & {
  filePath?: string
  deduped: boolean
}

type CheckFlowRulesInput = {
  tool: string
  filePath?: string
  content?: string
}

type RecordFlowWarnInput = {
  id: string
  severity: FlowSeverity
  filePath?: string
  description?: string
}

type FlowTodoInput = {
  filePath?: string
  content: string
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const RULES_PATH = join(__dirname, "flow-rules.json")
const STATE_FILE = join(homedir(), ".claude/delegation-state.json")
const FLOW_TODO_FILE = join(homedir(), ".claude/flow-todo-queue.jsonl")
const MAX_FLOW_TODOS = 200

const _flowWarnsSeen = new Set<string>()

let _cachedRules: FlowRule[] | null = null
let _rulesMtime = 0

function loadRules(): FlowRule[] {
  try {
    const mtime = _cachedRules ? statSync(RULES_PATH).mtimeMs : 0
    if (_cachedRules && mtime === _rulesMtime) return _cachedRules
    if (!existsSync(RULES_PATH)) { _cachedRules = []; return _cachedRules }
    const j = JSON.parse(readFileSync(RULES_PATH, "utf-8")) as { rules?: FlowRule[] }
    _cachedRules = j.rules || []
    _rulesMtime = mtime
    return _cachedRules
  } catch {
    _cachedRules = []
    return _cachedRules
  }
}

function recordFlowWarn(hit: RecordFlowWarnInput): void {
  try {
    let state: any = {}
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

export function checkFlowRules({ tool, filePath, content }: CheckFlowRulesInput): FlowHit[] {
  const rules = loadRules()
  const hits: FlowHit[] = []

  for (const rule of rules) {
    if (rule.trigger !== tool) continue
    const target = tool === "Write" ? (filePath || "") : (content || filePath || "")
    let re: RegExp
    try { re = new RegExp(rule.pattern) } catch { continue }
    if (!re.test(target)) continue

    const key = `${rule.id}::${filePath || ""}`
    if (_flowWarnsSeen.has(key)) {
      hits.push({ ...rule, filePath, deduped: true })
      continue
    }
    _flowWarnsSeen.add(key)
    const hit: FlowHit = { ...rule, filePath, deduped: false }
    hits.push(hit)
    recordFlowWarn(hit)
  }

  return hits
}

export function getFlowWarns(): any[] {
  try {
    if (!existsSync(STATE_FILE)) return []
    const s = JSON.parse(readFileSync(STATE_FILE, "utf-8"))
    return s?.flow_warns || []
  } catch { return [] }
}

export function getSessionFlowCounts(): Record<FlowSeverity, number> {
  const counts: Record<FlowSeverity, number> = { warn: 0, hint: 0, flag: 0 }
  for (const key of _flowWarnsSeen) {
    const rules = loadRules()
    const [ruleId] = key.split("::")
    const rule = rules.find((r) => r.id === ruleId)
    if (rule && counts[rule.severity] !== undefined) counts[rule.severity]++
  }
  return counts
}

export function resetForTest(rules: FlowRule[]): void {
  _cachedRules = rules
  _flowWarnsSeen.clear()
  // Sync mtime so loadRules() returns test rules instead of reloading from file.
  try { _rulesMtime = statSync(RULES_PATH).mtimeMs } catch {}
}

export function recordFlowTodo({ filePath, content }: FlowTodoInput): number {
  try {
    mkdirSync(dirname(FLOW_TODO_FILE), { recursive: true })
    // Extract TODO/FIXME lines from content (line-by-line for reliability).
    const todoRe = /(TODO|FIXME|HACK)[\s:]+(.+)$/i
    const todos: Array<{ type: string; text: string }> = []
    for (const line of content.split("\n")) {
      const m = line.match(todoRe)
      if (m) {
        todos.push({ type: m[1], text: m[2].trim() })
      }
    }
    if (todos.length === 0) return 0
    const entry = JSON.stringify({
      at: new Date().toISOString(),
      filePath,
      todos,
    }) + "\n"
    appendFileSync(FLOW_TODO_FILE, entry)
    // Prune to keep file bounded.
    try {
      const lines = readFileSync(FLOW_TODO_FILE, "utf-8").trim().split("\n").filter(Boolean)
      if (lines.length > MAX_FLOW_TODOS) {
        writeFileSync(FLOW_TODO_FILE, lines.slice(-Math.floor(MAX_FLOW_TODOS / 2)).join("\n") + "\n")
      }
    } catch {}
    console.error(`[flow-enforcer] 📋 Extracted ${todos.length} TODO(s) from ${filePath} → flow-todo-queue.jsonl`)
    return todos.length
  } catch { return 0 }
}
