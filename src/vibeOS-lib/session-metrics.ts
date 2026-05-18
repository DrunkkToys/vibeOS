// Session metrics computation — extracted from readLifetimeSavings() in src/index.js.
// Takes a parsed delegation-state object + session ID, returns the same metrics shape
// that the footer display expects. Pure computation — no file I/O, no caching.

type WarnEntry = {
  est_savings_usd?: number | string
  reason?: string
  tool?: string
}

type SessionEntry = {
  warns?: WarnEntry[]
  cache_savings_usd?: number | string
  cost_usd?: number | string
  started?: string
  tool_counts?: Record<string, number | string>
}

type MetricsState = {
  sessions?: Record<string, SessionEntry>
  lifetime?: {
    est_savings_usd?: number | string
    cache_savings_usd?: number | string
    scratchpad_hits_observed?: number | string
    missed_context7_usd?: number | string
  }
}

function formatDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return `${hours}h ${minutes}m ${seconds}s`
}

export function aggregateWarns(
  warns: WarnEntry[] | null | undefined,
  filterFn?: ((warn: WarnEntry) => boolean),
): number {
  const list = Array.isArray(warns) ? warns : []
  const filtered = filterFn ? list.filter(filterFn) : list
  let sum = 0
  for (const w of filtered) {
    const v = Number(w?.est_savings_usd ?? 0)
    if (Number.isFinite(v)) sum += v
  }
  return sum
}

export function getSessionCost(state: MetricsState | null | undefined, sessionId: string): number {
  const cost = state?.sessions?.[sessionId]?.cost_usd
  return cost != null ? Number(cost) : 0
}

export function computeSessionMetrics(state: unknown, sessionId: string) {
  const s: MetricsState | null = (state && typeof state === "object" && !Array.isArray(state))
    ? state as MetricsState
    : null

  const empty = {
    ltTasks: 0, ltCache: 0, ltCost: 0, count: 0,
    scratchpadHits: 0, missedC7: 0,
    sesTasks: 0, sesEdit: 0, sesCredit: 0, sesC7: 0, sesQuota: 0,
    sesDuration: 0, sesRatePerHour: 0, sesTrend: "stable",
    sesToolBreakdown: {} as Record<string, number>, sesModelTurns: { brain: 0, worker: 0 }
  }

  if (!s) return empty

  // ── Lifetime aggregation across ALL sessions ──
  let ltTasks = 0; let ltCache = 0; let ltCost = 0; let totalWarnCount = 0
  const sessionRates = []

  for (const [sid, ses] of Object.entries(s?.sessions || {})) {
    const warns = Array.isArray(ses?.warns) ? ses.warns : []
    totalWarnCount += warns.length
    for (const w of warns) ltTasks += Number.isFinite(Number(w.est_savings_usd ?? 0)) ? Number(w.est_savings_usd ?? 0) : 0
    const cacheVal = Number(ses?.cache_savings_usd ?? 0)
    ltCache += Number.isFinite(cacheVal) ? cacheVal : 0
    const costVal = Number(ses?.cost_usd ?? 0)
    ltCost += Number.isFinite(costVal) ? costVal : 0

    if (ses?.started) {
      const elapsed = (Date.now() - new Date(ses.started).getTime()) / 3600000
      const sesTotal = aggregateWarns(warns) + Number(ses?.cache_savings_usd ?? 0)
      if (elapsed > 0.05) sessionRates.push(sesTotal / elapsed)
    }
  }

  const legacyLifetimeDelegation = Number(s?.lifetime?.est_savings_usd ?? 0)
  if (legacyLifetimeDelegation > 0) {
    ltTasks = Math.max(ltTasks, legacyLifetimeDelegation)
  }
  const legacyLifetimeCache = Number(s?.lifetime?.cache_savings_usd ?? 0)
  if (legacyLifetimeCache > 0) {
    ltCache = Math.max(ltCache, legacyLifetimeCache)
  }

  // ── Session-specific stats ──
  const ses = s?.sessions?.[sessionId]
  const warns = Array.isArray(ses?.warns) ? ses.warns : []
  const sesTasks = aggregateWarns(warns)
  const sesEdit = aggregateWarns(warns, w => Boolean(w.reason?.includes("direct edit")))
  const sesCredit = aggregateWarns(warns, w => Boolean(w.reason?.includes("credit")))
  const sesC7 = aggregateWarns(warns, w => Boolean(w.reason?.includes("context7")))
  const sesQuota = aggregateWarns(warns, w => Boolean(w.reason?.includes("quota")))

  // Per-tool breakdown
  const sesToolBreakdown: Record<string, number> = {}
  for (const w of warns) {
    const tool = w.tool || "unknown"
    sesToolBreakdown[tool] = (sesToolBreakdown[tool] || 0) + Number(w.est_savings_usd ?? 0)
  }
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
    const threshold = 0.15
    if (avgPrev > 0) {
      const pctChange = diff / avgPrev
      if (pctChange > threshold) sesTrend = "up"
      else if (pctChange < -threshold) sesTrend = "down"
    }
  }

  // Model turn tracking
  const sesModelTurns = { brain: 0, worker: 0 }
  if (ses?.tool_counts) {
    const brainTools = ["write", "edit", "notebookedit", "bash", "webfetch", "websearch"]
    for (const t of brainTools) {
      sesModelTurns.brain += Number(ses.tool_counts[t] || 0)
    }
    sesModelTurns.worker = Number(ses.tool_counts.task || 0)
  }

  return {
    ltTasks: Math.round(ltTasks * 100) / 100,
    ltCache: Math.round(ltCache * 100) / 100,
    ltCost: Math.round(ltCost * 100) / 100,
    count: totalWarnCount,
    scratchpadHits: Number(s?.lifetime?.scratchpad_hits_observed ?? 0),
    missedC7: Number(s?.lifetime?.missed_context7_usd ?? 0),
    sesTasks, sesEdit, sesCredit, sesC7, sesQuota,
    sesDuration: Math.round(sesDuration),
    sesDurationFormatted: formatDuration(Math.round(sesDuration)),
    sesRatePerHour: Math.round(sesRatePerHour * 100) / 100,
    sesTrend,
    sesToolBreakdown,
    sesModelTurns,
  }
}
