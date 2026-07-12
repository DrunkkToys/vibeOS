import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { getVibeOSHome, getCurrentSessionId } from "../../lib/state.js"

// PivotCache used to default to a single $VIBEOS_HOME-wide file with no
// session scoping at all -- every OpenCode conversation, past or present,
// shared one pool of captured "workflows." Scope it per-session by default
// so pivot-back matches (and the context they inject into the prompt) only
// ever come from the CURRENT conversation, never an unrelated one.
export function pivotCacheDirForSession(sessionId?: string): string {
  const sid = sessionId || getCurrentSessionId() || "default"
  return join(getVibeOSHome(), "pivot-cache", sid)
}

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
  sequence?: string[]
  version: number
}

interface PivotIndexEntry {
  id: string
  captured_at: string
  tokens: string[]
  intent: string
  access_count: number
}

interface PivotIndexStore {
  pivots: Record<string, PivotIndexEntry>
  sequence: string[]
  version: number
}

const PIVOT_INDEX_VERSION = 1
const MAX_INDEXED_PIVOTS = 2048
const PIVOT_TTL_MS = 4 * 60 * 60 * 1000

export class PivotCache {
  private store: PivotStore | null
  private index: PivotIndexStore
  private baseDir: string
  private pivotSequence: string[]
  private currentWorkflow: string | null
  private lastTokens: Set<string>

  constructor(baseDir?: string) {
    this.baseDir = baseDir || getVibeOSHome()
    this.pivotSequence = []
    this.currentWorkflow = null
    this.lastTokens = new Set()
    this.store = null
    this.index = this._loadIndex()
    this.pivotSequence = [...this.index.sequence]
    this.pruneStale()
  }

  private _storePath(): string {
    return join(this.baseDir, ".vibeos-pivot-cache.json")
  }

  private _indexPath(): string {
    return join(this.baseDir, ".vibeos-pivot-cache.index.json")
  }

  private _loadStore(): PivotStore {
    try {
      const p = this._storePath()
      if (existsSync(p)) {
        const parsed = JSON.parse(readFileSync(p, "utf-8"))
        if (parsed && typeof parsed === "object") {
          parsed.pivots ??= {}
          parsed.sequence = Array.isArray(parsed.sequence) ? parsed.sequence : Object.keys(parsed.pivots)
          parsed.version = Number(parsed.version || 3)
          return parsed
        }
      }
    } catch {}
    return { pivots: {}, sequence: [], version: 3 }
  }

  private _normalizeIndex(raw: Partial<PivotIndexStore> | null | undefined): PivotIndexStore {
    const pivots: Record<string, PivotIndexEntry> = {}
    if (raw?.pivots && typeof raw.pivots === "object") {
      for (const [id, value] of Object.entries(raw.pivots)) {
        const entry = value as Partial<PivotIndexEntry>
        const key = String(id || entry?.id || "").trim()
        if (!key) continue
        pivots[key] = {
          id: key,
          captured_at: String(entry?.captured_at || new Date(0).toISOString()),
          tokens: Array.isArray(entry?.tokens) ? entry.tokens.map((t) => String(t || "").trim()).filter(Boolean) : [],
          intent: String(entry?.intent || ""),
          access_count: Number(entry?.access_count || 0),
        }
      }
    }
    const sequence = Array.isArray(raw?.sequence)
      ? raw.sequence.map((v: unknown) => String(v || "").trim()).filter(Boolean).filter((id: string) => !!pivots[id])
      : Object.keys(pivots)
    return {
      version: Number(raw?.version || PIVOT_INDEX_VERSION),
      pivots,
      sequence,
    }
  }

  private _entrySignalScore(entry: PivotEntry, recencyIndex = 0, total = 1): number {
    const tokenCount = Array.isArray(entry.tokens) ? entry.tokens.filter(Boolean).length : 0
    const intent = String(entry.intent || "").trim()
    const intentScore = Math.min(3, Math.floor(intent.length / 32))
    const accessScore = Math.min(20, Number(entry.access_count || 0)) * 4
    const miscPenalty = tokenCount === 1 && entry.tokens[0] === "misc" ? 8 : 0
    const recencyScore = total > 0 ? (recencyIndex / total) * 2 : 0
    return tokenCount * 3 + intentScore + accessScore + recencyScore - miscPenalty
  }

  private _buildIndex(store: PivotStore): PivotIndexStore {
    const sourceSequence = Array.isArray(store?.sequence) && store.sequence.length > 0
      ? [...store.sequence]
      : Object.keys(store?.pivots || {})
    const ranked = sourceSequence.map((id, idx) => {
      const entry = store?.pivots?.[id]
      if (!entry) return null
      return {
        id,
        score: this._entrySignalScore(entry, idx, sourceSequence.length),
        summary: {
          id,
          captured_at: entry.captured_at || new Date(0).toISOString(),
          tokens: Array.isArray(entry.tokens) ? [...entry.tokens] : [],
          intent: String(entry.intent || ""),
          access_count: Number(entry.access_count || 0),
        } satisfies PivotIndexEntry,
      }
    }).filter(Boolean) as Array<{ id: string; score: number; summary: PivotIndexEntry }>

    ranked.sort((a, b) => b.score - a.score || a.summary.captured_at.localeCompare(b.summary.captured_at))
    const keep = ranked
      .filter((item) => item.summary.tokens.length > 0 && !(item.summary.tokens.length === 1 && item.summary.tokens[0] === "misc" && item.summary.access_count <= 0))
      .slice(0, MAX_INDEXED_PIVOTS)

    const pivots: Record<string, PivotIndexEntry> = {}
    for (const item of keep) pivots[item.id] = item.summary
    const keepIds = new Set(keep.map((item) => item.id))
    const sequence = sourceSequence.filter((id) => keepIds.has(id))

    return {
      version: PIVOT_INDEX_VERSION,
      pivots,
      sequence,
    }
  }

  private _loadIndex(): PivotIndexStore {
    try {
      const p = this._indexPath()
      if (existsSync(p)) return this._normalizeIndex(JSON.parse(readFileSync(p, "utf-8")))
    } catch {}
    const store = this._loadStore()
    const index = this._buildIndex(store)
    this._saveIndex(index)
    return index
  }

  private _saveIndex(index: PivotIndexStore): void {
    try {
      const p = this._indexPath()
      const dir = dirname(p)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(p, JSON.stringify(index), "utf-8")
    } catch {}
  }

  private _ensureStore(): PivotStore {
    if (!this.store) {
      this.store = this._loadStore()
    }
    this.store.pivots ??= {}
    this.store.sequence = Array.isArray(this.store.sequence) ? this.store.sequence : Object.keys(this.store.pivots)
    return this.store
  }

  private _touchIndexEntry(entry: PivotEntry): void {
    this.index.pivots[entry.id] = {
      id: entry.id,
      captured_at: entry.captured_at,
      tokens: Array.isArray(entry.tokens) ? [...entry.tokens] : [],
      intent: String(entry.intent || ""),
      access_count: Number(entry.access_count || 0),
    }
    if (!this.index.sequence.includes(entry.id)) {
      this.index.sequence.push(entry.id)
    }
    this.index = this._buildIndex({
      pivots: Object.fromEntries(Object.entries(this.index.pivots).map(([id, summary]) => [id, {
        id: summary.id,
        captured_at: summary.captured_at,
        tokens: summary.tokens,
        intent: summary.intent,
        decisions: [],
        files: [],
        code_snippets: [],
        blockers: [],
        toolOutputs: [],
        access_count: summary.access_count,
        useful_sections: [],
        skip_sections: [],
      }])),
      sequence: this.index.sequence,
      version: this.index.version,
    })
    this.pivotSequence = [...this.index.sequence]
  }

  save(): void {
    try {
      const store = this._ensureStore()
      const p = this._storePath()
      const dir = dirname(p)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      store.sequence = [...this.index.sequence]
      writeFileSync(p, JSON.stringify(store, null, 2), "utf-8")
      this._saveIndex(this.index)
    } catch {}
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
    const store = this._ensureStore()
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
    store.pivots[workflowId] = entry
    if (!this.index.sequence.includes(workflowId)) {
      this.index.sequence.push(workflowId)
    }
    this._touchIndexEntry(entry)
    this.save()
  }

  pruneStale(ttlMs: number = PIVOT_TTL_MS): void {
    const cutoff = Date.now() - ttlMs
    const staleIds = new Set<string>()
    for (const [id, entry] of Object.entries(this.index.pivots)) {
      if (entry.captured_at && new Date(entry.captured_at).getTime() < cutoff) staleIds.add(id)
    }
    if (staleIds.size === 0) return
    for (const id of staleIds) {
      delete this.index.pivots[id]
      if (this.store?.pivots) delete this.store.pivots[id]
    }
    this.index.sequence = this.index.sequence.filter(id => !staleIds.has(id))
    this.pivotSequence = [...this.index.sequence]
  }

  detectPivotBack(tokens: Set<string>, confidenceThreshold: number = 0.5): { matchedId: string | null; confidence: number; reason: string } {
    if (this.index.sequence.length < 2) {
      return { matchedId: null, confidence: 0, reason: "not_enough_pivots" }
    }
    const cutoff = Date.now() - PIVOT_TTL_MS
    const candidates: Array<[string, number, number]> = []
    for (let i = 0; i < this.index.sequence.length; i++) {
      const pid = this.index.sequence[i]
      if (pid === this.index.sequence[this.index.sequence.length - 1]) continue
      const entry = this.index.pivots[pid]
      if (!entry) continue
      if (entry.captured_at && new Date(entry.captured_at).getTime() < cutoff) continue
      const cached = new Set(entry.tokens)
      if (cached.size === 0) continue
      const inter = new Set([...tokens].filter(x => cached.has(x)))
      const union = new Set([...tokens, ...cached])
      const jaccard = union.size === 0 ? 0 : inter.size / union.size
      const exactBonus = tokens.size === cached.size && [...tokens].every(t => cached.has(t)) ? 0.2 : 0
      const recency = i / Math.max(this.index.sequence.length, 1)
      const confidence = jaccard + exactBonus + recency * 0.1
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
    const indexEntry = this.index.pivots[bestId]
    if (indexEntry) {
      indexEntry.access_count = (indexEntry.access_count || 0) + 1
    }
    const storeEntry = this.store?.pivots?.[bestId]
    if (storeEntry) {
      storeEntry.access_count = (storeEntry.access_count || 0) + 1
    }
    return { matchedId: bestId, confidence: bestConf, reason: "matched" }
  }

  read(workflowId: string): PivotEntry | null {
    const store = this._ensureStore()
    return store.pivots[workflowId] || null
  }

  buildInjection(workflowId: string, maxSections: number = 4): string {
    const entry = this.read(workflowId)
    if (!entry) return ""
    const parts: string[] = []
    const skip = new Set(entry.skip_sections)
    const intent = entry.intent || entry.tokens.join(", ") || ""
    if (intent) {
      parts.push(`[PIVOT BACK] Returning to workflow: "${intent}". Context from previous session follows.`)
    }
    if (!skip.has("files") && entry.files.length > 0) {
      parts.push(`[files modified] ${entry.files.slice(0, 6).join(", ")}`)
    }
    if (!skip.has("decisions") && entry.decisions.length > 0) {
      const filtered = entry.decisions.filter(d => d !== "previous workflow captured at pivot point")
      if (filtered.length > 0) {
        parts.push(`[decisions] ${filtered.slice(0, 3).join(" | ")}`)
      }
    }
    if (!skip.has("blockers") && entry.blockers.length > 0) {
      parts.push(`[blockers] ${entry.blockers.slice(0, 2).join(" | ")}`)
    }
    if (entry.code_snippets.length > 0 && entry.useful_sections.includes("code") && !skip.has("code")) {
      parts.push(`[code context] ${entry.code_snippets.slice(0, 2).join(" | ")}`)
    }
    if (parts.length <= 1 && entry.tokens.length > 0) {
      return `[PIVOT BACK] Returning to workflow tagged: ${entry.tokens.join(", ")}. Intent: ${intent}`
    }
    return parts.slice(0, maxSections).join("\n")
  }

  learn(workflowId: string, usedSections: string[], unusedSections: string[]): void {
    const store = this._ensureStore()
    const entry = store.pivots[workflowId]
    if (!entry) return
    for (const s of usedSections) {
      if (!entry.useful_sections.includes(s)) entry.useful_sections.push(s)
    }
    for (const s of unusedSections) {
      if (!entry.skip_sections.includes(s) && (entry.access_count || 0) > 3) {
        entry.skip_sections.push(s)
      }
    }
    this._touchIndexEntry(entry)
    this.save()
  }

  resetSequence(): void {
    this.pivotSequence = []
    this.currentWorkflow = null
    this.lastTokens = new Set()
    this.index.sequence = []
  }

  getRecentPivots(n: number = 5): string[] {
    return this.index.sequence.slice(-n)
  }
}
