// @ts-nocheck
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { ensureProjectBucket, touchProjectBucket, loadProjectState, saveProjectState, getCurrentSessionId, currentProjectFingerprint, currentProjectName } from "./state.js"

export function upsertProjectPattern(
  kind: string,
  key: string,
  summary: string,
  meta: Record<string, any> = {}
): Record<string, any> | null {
  const fingerprint = String(meta?.fingerprint || currentProjectFingerprint || "").trim()
  if (!fingerprint || fingerprint === "unknown" || !key || !summary) return null

  const pstate = loadProjectState()
  const bucket = ensureProjectBucket(pstate, fingerprint)
  bucket.userPatterns ??= { friction: {}, routines: {} }
  bucket.userPatterns.friction ??= {}
  bucket.userPatterns.routines ??= {}

  const target = kind === "routine" ? bucket.userPatterns.routines : bucket.userPatterns.friction
  const now = new Date().toISOString()
  const row = target[key] || { kind, summary, count: 0, sessions: [], firstSeen: now, lastSeen: null }

  row.kind = kind
  row.summary = summary
  row.count = Number(row.count || 0) + 1
  row.sessions = [...new Set([...(row.sessions || []), ...(meta?.sessions || [getCurrentSessionId()])])].slice(-10)
  row.lastSeen = now

  if (meta?.family) row.family = meta.family
  if (meta?.path) row.path = meta.path

  target[key] = row
  touchProjectBucket(pstate, fingerprint, {
    sessionId: meta?.sessionId || getCurrentSessionId(),
    projectName: meta?.projectName || currentProjectName || "",
    topic: key,
  })

  const entries = Object.entries(target)
  if (entries.length > 50) {
    entries.sort((a, b) => String(b[1]?.lastSeen || "").localeCompare(String(a[1]?.lastSeen || "")))
    const kept = Object.fromEntries(entries.slice(0, 50))
    for (const k of Object.keys(target)) delete target[k]
    Object.assign(target, kept)
  }

  bucket.lastSeen = now
  saveProjectState(pstate)
  return row
}

interface PatternEntry {
  key: string
  kind: "friction" | "routine"
  summary: string
  count: number
  firstSeen: string
  lastSeen: string
  sessions: string[]
  meta: Record<string, any>
}

interface ToolEvent {
  tool: string
  timestamp: number
  target: string
  directory?: string
  isError?: boolean
}

interface OutcomeEvent {
  timestamp: number
  outcome: string
  toolEvents: ToolEvent[]
  context: Record<string, any>
}

const PATTERNS_PATH = join(homedir(), ".opencode", "learned-patterns.json")
const RECENT_EVENTS_PATH = join(homedir(), ".opencode", "recent-events.jsonl")

export class PatternStore {
  private patterns: Map<string, PatternEntry> = new Map()
  private recentToolEvents: ToolEvent[] = []
  private outcomes: OutcomeEvent[] = []
  private maxPatterns = 100
  private maxRecent = 30

  constructor(private sessionId: string = "default") {
    this.load()
  }

  load(): void {
    try {
      if (existsSync(PATTERNS_PATH)) {
        const raw = readFileSync(PATTERNS_PATH, "utf-8")
        const data = JSON.parse(raw)
        if (data.patterns) {
          for (const [key, val] of Object.entries(data.patterns)) {
            this.patterns.set(key, val as PatternEntry)
          }
        }
      }
      if (existsSync(RECENT_EVENTS_PATH)) {
        const raw = readFileSync(RECENT_EVENTS_PATH, "utf-8").trim()
        if (raw) {
          this.recentToolEvents = raw.split("\n").filter(Boolean).map(l => JSON.parse(l))
        }
      }
    } catch { /* best-effort */ }
  }

  save(): void {
    try {
      mkdirSync(dirname(PATTERNS_PATH), { recursive: true })
      const data = { patterns: Object.fromEntries(this.patterns) }
      writeFileSync(PATTERNS_PATH, JSON.stringify(data, null, 2), "utf-8")
    } catch { /* best-effort */ }
  }

  recordPattern(kind: "friction" | "routine", key: string, summary: string, meta: Record<string, any> = {}): void {
    const now = new Date().toISOString()
    const existing = this.patterns.get(key)

    if (existing) {
      existing.count++
      existing.lastSeen = now
      existing.sessions = [...new Set([...existing.sessions, this.sessionId])].slice(-10)
      existing.meta = { ...existing.meta, ...meta }
    } else {
      this.patterns.set(key, {
        key,
        kind,
        summary,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        sessions: [this.sessionId],
        meta,
      })
    }

    if (this.patterns.size > this.maxPatterns) {
      const sorted = [...this.patterns.entries()].sort(
        (a, b) => a[1].lastSeen.localeCompare(b[1].lastSeen)
      )
      const toRemove = sorted.slice(0, this.patterns.size - this.maxPatterns)
      for (const [k] of toRemove) this.patterns.delete(k)
    }

    this.save()
  }

  observeToolEvent(toolName: string, input: any, output?: any, directory?: string): void {
    const event: ToolEvent = {
      tool: toolName,
      timestamp: Date.now(),
      target: this.extractTarget(toolName, input),
      directory,
      isError: this.isErrorOutput(output),
    }

    this.recentToolEvents.push(event)
    if (this.recentToolEvents.length > this.maxRecent) {
      this.recentToolEvents = this.recentToolEvents.slice(-this.maxRecent)
    }

    try {
      mkdirSync(dirname(RECENT_EVENTS_PATH), { recursive: true })
      appendFileSync(RECENT_EVENTS_PATH, JSON.stringify(event) + "\n")
    } catch { /* best-effort */ }

    this.detectAndRecord()
  }

  recordOutcome(outcome: string, context: Record<string, any> = {}): void {
    this.outcomes.push({
      timestamp: Date.now(),
      outcome,
      toolEvents: [...this.recentToolEvents],
      context,
    })

    if (this.outcomes.length > 20) {
      this.outcomes = this.outcomes.slice(-20)
    }

    this.detectOutcomePattern()
  }

  private detectAndRecord(): void {
    const stuck = this.detectStuckLoop()
    if (stuck) this.recordPattern("friction", stuck.key, stuck.summary, { tool: stuck.tool })

    const topicRepeat = this.detectTopicRepetition()
    if (topicRepeat) this.recordPattern("friction", topicRepeat.key, topicRepeat.summary, { tool: topicRepeat.tool })

    const repeated = this.detectRepeatedCalls()
    if (repeated) this.recordPattern("friction", repeated.key, repeated.summary, { tool: repeated.tool })
  }

  private detectStuckLoop(): { key: string; summary: string; tool: string } | null {
    if (this.recentToolEvents.length < 4) return null

    const recent = this.recentToolEvents.slice(-8)
    const sameToolCount = recent.filter(e => e.tool === "read").length

    if (sameToolCount >= 5) {
      const lastDir = recent[recent.length - 1]?.directory
      return {
        key: "stuck_reading_loop",
        summary: `Stuck reading loop: ${sameToolCount}x reads without action${lastDir ? ` in ${lastDir}` : ""}`,
        tool: "read",
      }
    }

    const sameTarget = recent.filter(
      (e, _i, arr) => e.tool === "bash" && arr.filter(p => p.tool === "bash" && p.target === e.target).length >= 3
    )
    if (sameTarget.length >= 3) {
      return {
        key: "stuck_bash_loop",
        summary: `Repeating same command ${sameTarget.length}x: "${sameTarget[0]?.target?.substring(0, 60)}"`,
        tool: "bash",
      }
    }

    return null
  }

  private detectTopicRepetition(): { key: string; summary: string; tool: string } | null {
    if (this.recentToolEvents.length < 5) return null

    const recent = this.recentToolEvents.slice(-5)
    const targets = recent.map(e => e.target).filter(Boolean)
    if (targets.length < 3) return null

    const counts: Record<string, number> = {}
    for (const t of targets) {
      const key = t.substring(0, 50)
      counts[key] = (counts[key] || 0) + 1
    }

    for (const [target, count] of Object.entries(counts)) {
      if (count >= 3) {
        return {
          key: `topic_repeat_${target.substring(0, 20)}`,
          summary: `Topic repetition: "${target.substring(0, 40)}" accessed ${count}x in last 5 events`,
          tool: recent[0]?.tool || "unknown",
        }
      }
    }

    return null
  }

  private detectRepeatedCalls(): { key: string; summary: string; tool: string } | null {
    if (this.recentToolEvents.length < 4) return null

    const recent = this.recentToolEvents.slice(-4)
    const first = recent[0]
    if (recent.every(e => e.tool === first.tool && e.target === first.target)) {
      return {
        key: `repeat_${first.tool}_${first.target?.substring(0, 20)}`,
        summary: `Repeated "${first.tool} ${first.target?.substring(0, 50)}" ${recent.length}x`,
        tool: first.tool,
      }
    }

    return null
  }

  private detectOutcomePattern(): void {
    if (this.outcomes.length < 3) return

    const recent = this.outcomes.slice(-5)
    const successCount = recent.filter(o => o.outcome === "success").length
    const failCount = recent.filter(o => o.outcome === "failure" || o.outcome === "error").length

    if (successCount >= 3) {
      const lastEvent = recent[recent.length - 1]
      const lastTool = lastEvent?.toolEvents?.slice(-1)?.[0]?.tool || "unknown"
      this.recordPattern("routine", `outcome_success_${lastTool}`, `${successCount}/${recent.length} recent outcomes successful`, { tool: lastTool, outcome: "success" })
    }

    if (failCount >= 2) {
      const lastFail = recent.filter(o => o.outcome === "failure" || o.outcome === "error").pop()
      const lastTool = lastFail?.toolEvents?.slice(-1)?.[0]?.tool || "unknown"
      this.recordPattern("friction", `outcome_failure_${lastTool}`, `${failCount}/${recent.length} recent outcomes failed`, { tool: lastTool, outcome: "failure" })
    }
  }

  private extractTarget(toolName: string, input: any): string {
    if (!input) return "unknown"
    if (typeof input === "string") return input.substring(0, 100)
    if (typeof input === "object") {
      return input.filePath || input.file_path || input.command || input.url || JSON.stringify(input).substring(0, 100)
    }
    return "unknown"
  }

  private isErrorOutput(output: any): boolean {
    if (!output) return false
    const s = typeof output === "string" ? output : JSON.stringify(output)
    return /error|fail|traceback|exception|not found|cannot find/i.test(s)
  }

  getPatterns(kind?: "friction" | "routine"): PatternEntry[] {
    const all = [...this.patterns.values()]
    if (kind) return all.filter(p => p.kind === kind)
    return all
  }

  clear(): void {
    this.patterns.clear()
    this.recentToolEvents = []
    this.outcomes = []
    try {
      if (existsSync(PATTERNS_PATH)) writeFileSync(PATTERNS_PATH, JSON.stringify({ patterns: {} }), "utf-8")
      if (existsSync(RECENT_EVENTS_PATH)) writeFileSync(RECENT_EVENTS_PATH, "", "utf-8")
    } catch { /* best-effort */ }
  }
}
