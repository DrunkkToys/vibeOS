import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"

interface PivotContext {
  tokens: string[]
  intent: string
  decisions: string[]
  files: string[]
  code_snippets: string[]
  blockers: string[]
  toolOutputs?: { hash: string; tool: string; prompt: string; sizeBytes?: number; ageSec?: number }[]
}

interface PivotEntry {
  id: string
  captured_at: string
  tokens: string[]
  intent: string
  decisions: string[]
  files: string[]
  code_snippets: string[]
  blockers: string[]
  toolOutputs?: { hash: string; tool: string; prompt: string; sizeBytes?: number; ageSec?: number }[]
  access_count: number
  useful_sections: string[]
  skip_sections: string[]
}

interface PivotStore {
  pivots: Record<string, PivotEntry>
  version: number
}

export class PivotCache {
  private store: PivotStore
  private baseDir: string
  private pivotSequence: string[]
  private currentWorkflow: string | null
  private lastTokens: Set<string>

  constructor(baseDir?: string) {
    this.baseDir = baseDir || join(homedir(), ".claude")
    this.pivotSequence = []
    this.currentWorkflow = null
    this.lastTokens = new Set()
    this.store = this._load()
  }

  private _storePath(): string {
    return join(this.baseDir, ".vibeos-pivot-cache.json")
  }

  private _load(): PivotStore {
    try {
      const p = this._storePath()
      if (existsSync(p)) {
        return JSON.parse(readFileSync(p, "utf-8"))
      }
    } catch { /* ignore */ }
    return { pivots: {}, version: 3 }
  }

  save(): void {
    try {
      const p = this._storePath()
      const dir = dirname(p)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(p, JSON.stringify(this.store, null, 2), "utf-8")
    } catch { /* ignore */ }
  }

  tokenize(text: string): Set<string> {
    const tl = text.toLowerCase()
    const tokens = new Set<string>()
    if (/deploy|redeploy|bundle|release|npm/.test(tl)) tokens.add("deploy")
    if (/(?:\bgit\b|\bcommit\b|\bpush\b|\bmerge\b|\bpr\b|\bpull\b|\brebase\b)/.test(tl)) tokens.add("git")
    if (/budget|cost|price|pricing/.test(tl)) tokens.add("pricing")
    if (/debug|fix|bug|error|broken/.test(tl)) tokens.add("debug")
    if (/context|cache|pivot|compression/.test(tl)) tokens.add("caching")
    if (/test|experiment|verify|validate/.test(tl)) tokens.add("test")
    if (/config|token|api|secret|env|auth/.test(tl)) tokens.add("config")
    if (/create|add|implement|build|write/.test(tl)) tokens.add("create")
    if (/read|check|see|show|status|list/.test(tl)) tokens.add("inspect")
    if (/refactor|clean|rename|move|restructure/.test(tl)) tokens.add("refactor")
    if (tokens.size === 0) tokens.add("misc")
    return tokens
  }

  detectPivot(current: string, previous: string, timeGap: number = 0): { isPivot: boolean; similarity: number } {
    const cur = this.tokenize(current)
    const prev = this.tokenize(previous)
    const inter = new Set([...cur].filter(x => prev.has(x)))
    const union = new Set([...cur, ...prev])
    const sim = union.size === 0 ? 1 : inter.size / union.size
    const timePenalty = Math.min(0.3, timeGap / 600)
    const adjusted = sim - timePenalty
    return { isPivot: adjusted < 0.3, similarity: Math.round(adjusted * 1000) / 1000 }
  }

  snapshot(workflowId: string, context: Partial<PivotContext>): void {
    const entry: PivotEntry = {
      id: workflowId,
      captured_at: new Date().toISOString(),
      tokens: context.tokens || [],
      intent: context.intent || "",
      decisions: context.decisions || [],
      files: context.files || [],
      code_snippets: context.code_snippets || [],
      blockers: context.blockers || [],
      access_count: 0,
      useful_sections: ["decisions", "files"],
      skip_sections: [],
      toolOutputs: context.toolOutputs || [],
    }
    this.store.pivots[workflowId] = entry
    if (!this.pivotSequence.includes(workflowId)) {
      this.pivotSequence.push(workflowId)
    }
    this.save()
  }

  detectPivotBack(tokens: Set<string>, confidenceThreshold: number = 0.5): { matchedId: string | null; confidence: number; reason: string } {
    if (this.pivotSequence.length < 2) {
      return { matchedId: null, confidence: 0, reason: "not_enough_pivots" }
    }
    const candidates: Array<[string, number, number]> = []
    for (let i = 0; i < this.pivotSequence.length; i++) {
      const pid = this.pivotSequence[i]
      if (pid === this.pivotSequence[this.pivotSequence.length - 1]) continue
      const entry = this.store.pivots[pid]
      if (!entry) continue
      const cached = new Set(entry.tokens)
      if (cached.size === 0) continue
      const inter = new Set([...tokens].filter(x => cached.has(x)))
      const union = new Set([...tokens, ...cached])
      const jaccard = union.size === 0 ? 0 : inter.size / union.size
      const exactBonus = tokens.size === cached.size && [...tokens].every(t => cached.has(t)) ? 0.2 : 0
      const recency = i / Math.max(this.pivotSequence.length, 1)
      const accessBonus = Math.min(0.1, (entry.access_count || 0) * 0.02)
      const confidence = jaccard + exactBonus + recency * 0.1 + accessBonus
      candidates.push([pid, confidence, jaccard])
    }
    if (candidates.length === 0) {
      return { matchedId: null, confidence: 0, reason: "no_candidates" }
    }
    candidates.sort((a, b) => b[1] - a[1])
    const [bestId, bestConf] = candidates[0]
    if (bestConf < confidenceThreshold) {
      return { matchedId: null, confidence: bestConf, reason: "low_confidence" }
    }
    if (this.store.pivots[bestId]) {
      this.store.pivots[bestId].access_count = (this.store.pivots[bestId].access_count || 0) + 1
    }
    this.save()
    return { matchedId: bestId, confidence: bestConf, reason: "matched" }
  }

  buildInjection(workflowId: string, maxSections: number = 3): string {
    const entry = this.store.pivots[workflowId]
    if (!entry) return ""
    const parts: string[] = []
    const skip = new Set(entry.skip_sections)

    // Intent — what was this workflow about
    const intent = entry.intent || entry.tokens.join(", ") || ""
    if (intent) {
      parts.push(`[PIVOT BACK] Returning to workflow: "${intent}". Context from previous session follows.`)
    }

    // Files — what was being modified
    if (!skip.has("files") && entry.files.length > 0) {
      parts.push(`[files modified] ${entry.files.slice(0, 6).join(", ")}`)
    }

    // Decisions — key choices made
    if (!skip.has("decisions") && entry.decisions.length > 0) {
      const filtered = entry.decisions.filter(d => d !== "previous workflow captured at pivot point")
      if (filtered.length > 0) {
        parts.push(`[decisions] ${filtered.slice(0, 3).join(" | ")}`)
      }
    }

    // Blockers — what was blocking progress
    if (!skip.has("blockers") && entry.blockers.length > 0) {
      parts.push(`[blockers] ${entry.blockers.slice(0, 2).join(" | ")}`)
    }

    // Code snippets — relevant context
    if (entry.code_snippets.length > 0 && entry.useful_sections.includes("code") && !skip.has("code")) {
      parts.push(`[code context] ${entry.code_snippets.slice(0, 2).join(" | ")}`)
    }

    // If nothing useful, return a minimal note
    if (parts.length <= 1 && entry.tokens.length > 0) {
      return `[PIVOT BACK] Returning to workflow tagged: ${entry.tokens.join(", ")}. Intent: ${intent}`
    }

    return parts.join("\n")
  }

  learn(workflowId: string, usedSections: string[], unusedSections: string[]): void {
    const entry = this.store.pivots[workflowId]
    if (!entry) return
    for (const s of usedSections) {
      if (!entry.useful_sections.includes(s)) entry.useful_sections.push(s)
    }
    for (const s of unusedSections) {
      if (!entry.skip_sections.includes(s) && (entry.access_count || 0) > 3) {
        entry.skip_sections.push(s)
      }
    }
    this.save()
  }

  resetSequence(): void {
    this.pivotSequence = []
    this.currentWorkflow = null
    this.lastTokens = new Set()
  }

  getRecentPivots(n: number = 5): string[] {
    return this.pivotSequence.slice(-n)
  }
}
