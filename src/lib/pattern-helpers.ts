// SPDX-License-Identifier: MIT
// @ts-nocheck
import { relative, basename } from "node:path"

export function normalizeObservedPath(filePath: string, directory: string): string {
  if (!filePath || typeof filePath !== "string") return "unknown"
  let p = filePath
  try {
    if (directory && p.startsWith("/")) {
      const rel = relative(directory, p)
      if (rel && !rel.startsWith("..") && !rel.startsWith("/")) p = rel
    }
  } catch {}
  p = p.replace(/\\/g, "/").replace(/^\.\/+/, "")
  if (/^(src\/index\.js|package\.json|README\.md|CHANGELOG\.md|tsconfig\.json)$/i.test(p)) return p
  const m = p.match(/\.([a-z0-9]+)$/i)
  if (p.startsWith("src/") && m) return `src/*.${m[1].toLowerCase()}`
  if (p.startsWith("tests/") && m) return `tests/*.${m[1].toLowerCase()}`
  return basename(p) || "unknown"
}

export function commandFamily(command: string): string {
  const c = String(command || "").trim().toLowerCase()
  if (!c) return "unknown"
  if (/\bnode\s+--check\b/.test(c)) return "syntax-check"
  if (/\bnpm\s+run\s+typecheck\b|\btsc\b.*--noemit/.test(c)) return "typecheck"
  if (/\bnpm\s+test\b|\bnode\s+--test\b|\bvitest\b|\bjest\b|\bpytest\b/.test(c)) return "test"
  if (/\bnpm\s+run\s+build\b|\btsc\s+-p\b/.test(c)) return "build"
  if (/\bgit\s+status\b/.test(c)) return "git-status"
  if (/\bgit\s+commit\b/.test(c)) return "git-commit"
  const first = c.replace(/^[a-z_][a-z0-9_]*=\S+\s+/g, "").split(/\s+/)[0]
  return /^[a-z0-9._/-]{1,30}$/.test(first) ? first : "command"
}

export function commandFailed(output: unknown): boolean {
  // OpenCode's real bash tool output carries the exit code at
  // output.metadata.exit, not output.exitCode/statusCode/code -- see
  // semantic-observer.ts's deriveTags for the live-reproduced detail.
  const code = output?.metadata?.exit ?? output?.exitCode ?? output?.statusCode ?? output?.code
  if (Number.isFinite(Number(code)) && Number(code) !== 0) return true
  const raw = output?.result ?? output?.text ?? output?.content ?? output?.data ?? ""
  if (typeof raw !== "string") return false
  return /\b(exit code|exited with code)\s*[:=]?\s*[1-9]\b|\b(assertionerror|syntaxerror|typeerror|referenceerror)\b|\b(failed|error:|err!)\b/i.test(raw)
}

export function mergeProjectBucket(dst: unknown, src: unknown): unknown {
  const a = dst || {}
  const b = src || {}
  const topics = [...new Set([...(a.commonTopics || []), ...(b.commonTopics || [])])].slice(-20)
  const mergePatterns = (kind: string) => {
    const out: unknown = {}
    for (const srcObj of [a.userPatterns?.[kind], b.userPatterns?.[kind]]) {
      for (const [key, val] of Object.entries(srcObj || {})) {
        const v = val as unknown
        const row = out[key] || { count: 0, sessions: [], lastSeen: null, summary: v?.summary || "" }
        row.count += Number(v?.count || 0)
        row.sessions = [...new Set([...(row.sessions || []), ...(v?.sessions || [])])].slice(-10)
        row.lastSeen = [row.lastSeen, v?.lastSeen].filter(Boolean).sort().slice(-1)[0] || null
        row.summary = row.summary || v?.summary || ""
        if (v?.kind) row.kind = v.kind
        out[key] = row
      }
    }
    return out
  }
  return {
    totalSessions: (a.totalSessions || 0) + (b.totalSessions || 0),
    researchChains: Math.max(a.researchChains || 0, b.researchChains || 0),
    context7Bypasses: (a.context7Bypasses || 0) + (b.context7Bypasses || 0),
    commonTopics: topics,
    userPatterns: {
      friction: mergePatterns("friction"),
      routines: mergePatterns("routines"),
    },
    lastSeen: [a.lastSeen, b.lastSeen].filter(Boolean).sort().slice(-1)[0] || new Date().toISOString(),
  }
}

export function _pruneOldSessions(state: unknown): void {
  if (!state?.sessions) return
  const entries = Object.entries(state.sessions)
  if (entries.length <= 30) return
  entries.sort((a: unknown, b: unknown) => {
    const da = a[1]?.started || a[1]?.last_costed || ""
    const db = b[1]?.started || b[1]?.last_costed || ""
    return db.localeCompare(da)
  })
  state.sessions = Object.fromEntries(entries.slice(0, 30))
}

export function _computeSessionMetrics(state: unknown, sid: string): unknown {
  const session = state?.sessions?.[sid] || {}
  const warns = Array.isArray(session?.warns) ? session.warns : []
  const toolCounts = session?.tool_counts || {}
  const toolBreakdown: Record<string, number> = {}
  for (const [t, c] of Object.entries(toolCounts)) {
    toolBreakdown[String(t)] = Number(c || 0)
  }
  const startedAt = session?.started ? new Date(session.started).getTime() : Date.now()
  const durationSec = Math.floor((Date.now() - startedAt) / 1000)
  const hours = Math.max(durationSec / 3600, 0.001)
  return {
    ltTasks: Number(state?.lifetime?.total_savings_usd || state?.lifetime?.est_savings_usd || 0),
    ltCache: Number(state?.lifetime?.cache_savings_usd || 0),
    missedC7: Number(state?.lifetime?.missed_context7_usd || 0),
    count: warns.length,
    sesTasks: Number(session?.total_savings_usd || 0),
    sesDuration: durationSec,
    sesRatePerHour: Number((((session?.warns?.reduce((sum, w) => sum + Number(w?.est_savings_usd || 0), 0) || 0) + Number(session?.cache_savings_usd || 0)) / hours).toFixed(4)),
    sesTrend: "stable",
    sesToolBreakdown: toolBreakdown,
    sesModelTurns: session?.model_turns || { brain: 0, worker: 0 },
    sesFlowWarns: Array.isArray(state?.flow_warns) ? state.flow_warns.filter((w: unknown) => String((w as Record<string, unknown>)?.sid || "") === sid) : [],
    sesTier: session?.tier || "",
    sesModel: session?.model || "",
    sesProvider: session?.provider || "",
    sesLastUpdated: session?.last_updated || session?.live_updated_at || null,
    quality_avg: state?.lifetime?.quality_total_count > 0
      ? Math.round((state?.lifetime?.quality_total_score || 0) / state?.lifetime?.quality_total_count)
      : 0,
  }
}

export function hasBypassFlag(command: string): boolean {
  const c = String(command || "")
  return /--no-verify|--force|--skip-hooks|--admin|--bypass/.test(c)
}

export function targetsProtectedBranch(command: string): boolean {
  const c = String(command || "")
  return /\borigin\s+master\b|\borigin\s+main\b|--branch\s+master|--branch\s+main/.test(c)
}

export function isDeployCommand(command: string): boolean {
  const c = String(command || "").trim().toLowerCase()
  return /\bgit\s+push\b|\bgh\s+pr\s+merge\b|\bnpm\s+publish\b|\bnpm\s+run\s+deploy\b/.test(c)
}
