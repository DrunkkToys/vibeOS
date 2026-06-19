// Smart cache reuse predictor for vibeOS scratchpad cache.
// Pure TypeScript — no external ML dependencies.
//
// Features:
//   1. Query similarity scoring for cache hit prediction
//   2. Per-tool hit rate tracking with exponential decay
//   3. Cache warming suggestions based on query patterns
//   4. Batch similarity matching for proactive pre-fetch
//
// Integrates into src/index.js scratchpad cache observation logic.

// ── Types ───────────────────────────────────────────────────────────

export interface CacheStats {
  tool: string
  hits: number
  total: number
  bytesSaved: number
  lastHit: string
  hitRate: number
}

export interface CacheEntry {
  hash: string
  tool: string
  prompt: string
  sizeBytes: number
  at: string
  ageSec: number
  words: string[]
}

export interface CacheDatabase {
  entries: CacheEntry[]
  stats: Record<string, CacheStats>
}

export interface SimilarityResult {
  hash: string
  score: number
  entry: CacheEntry
  index?: number
}

export interface CachePrediction {
  shouldCache: boolean
  shouldWarm: boolean
  confidence: number
  reason: string
  similarEntries: SimilarityResult[]
  estimatedSavings: number
}

function cacheEntryValue(entry: CacheEntry, stats?: CacheStats): number {
  const hitRate = Number(stats?.hitRate ?? 0)
  const bytes = Math.max(1, Number(entry?.sizeBytes || 0))
  const ageSec = Math.max(1, Number(entry?.ageSec || 0))
  return (hitRate * Math.log10(bytes + 10) * Math.log10(bytesSavedFactor(stats) + 10)) / Math.log10(ageSec + 10)
}

function bytesSavedFactor(stats?: CacheStats): number {
  const saved = Number(stats?.bytesSaved ?? 0)
  const hits = Math.max(1, Number(stats?.hits ?? 0))
  return saved / hits
}

// ── Jaccard similarity ──────────────────────────────────────────────

function tokenize(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 1)
}

function wordSet(words: string[]): Set<string> {
  return new Set(words)
}

export function jaccardSimilarity(a: string, b: string): number {
  const wa = wordSet(tokenize(a))
  const wb = wordSet(tokenize(b))
  if (wa.size === 0 && wb.size === 0) return 0

  let intersection = 0
  for (const w of wa) {
    if (wb.has(w)) intersection++
  }

  const union = wa.size + wb.size - intersection
  return union > 0 ? intersection / union : 0
}

// ── Cosine similarity on bigram features ────────────────────────────

function bigrams(words: string[]): Set<string> {
  const bg = new Set<string>()
  for (let i = 0; i < words.length - 1; i++) {
    bg.add(`${words[i]}_${words[i + 1]}`)
  }
  return bg
}

export function cosineSimilarity(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (ta.length === 0 || tb.length === 0) return 0

  const ba = bigrams(ta)
  const bb = bigrams(tb)

  if (ba.size === 0 && bb.size === 0) return 0

  const allBigrams = new Set([...ba, ...bb])
  let dotProduct = 0
  let magA = 0
  let magB = 0

  for (const bg of allBigrams) {
    const inA = ba.has(bg) ? 1 : 0
    const inB = bb.has(bg) ? 1 : 0
    dotProduct += inA * inB
    magA += inA * inA
    magB += inB * inB
  }

  const denominator = Math.sqrt(magA) * Math.sqrt(magB)
  return denominator > 0 ? dotProduct / denominator : 0
}

// ── Weighted keyword overlap ────────────────────────────────────────

const CACHE_HIGH_WEIGHT_WORDS = new Set([
  "test", "tests", "build", "lint", "typecheck", "deploy", "install",
  "npm", "yarn", "docker", "compose", "api", "endpoint", "schema",
  "migration", "database", "query", "config", "package.json", "tsconfig",
  "readme", "changelog", "agent", "index", "main", "app", "server",
])

function keywordOverlapScore(a: string, b: string): number {
  const wa = tokenize(a)
  const wb = tokenize(b)
  if (wa.length === 0 || wb.length === 0) return 0

  let score = 0
  let maxScore = 0

  for (const w of wa) {
    const weight = CACHE_HIGH_WEIGHT_WORDS.has(w) ? 3 : 1
    maxScore += weight
    if (wb.includes(w)) score += weight
  }

  return maxScore > 0 ? score / maxScore : 0
}

// ── Composite similarity (weighted average) ─────────────────────────

export function compositeSimilarity(a: string, b: string): number {
  return (
    jaccardSimilarity(a, b) * 0.35 +
    cosineSimilarity(a, b) * 0.35 +
    keywordOverlapScore(a, b) * 0.30
  )
}

// ── Cache tool output export for PIVOT snapshot ────────────────────

export function extractRecentCacheOutputs(db: CacheDatabase, limit: number = 10): { hash: string; tool: string; prompt: string; sizeBytes: number; ageSec: number }[] {
  if (!db?.entries || !Array.isArray(db.entries)) return []
  const now = Date.now()
  return db.entries
    .slice(-limit)
    .map(e => ({
      hash: e.hash || "",
      tool: e.tool || "",
      prompt: e.prompt?.slice(0, 120) || "",
      sizeBytes: e.sizeBytes || 1024,
      ageSec: e.at ? Math.round((now - new Date(e.at).getTime()) / 1000) : 3600,
    }))
}

// ── Cache database management ───────────────────────────────────────

export function createCacheDatabase(): CacheDatabase {
  return { entries: [], stats: {} }
}

export function addCacheEntry(
  db: CacheDatabase,
  hash: string,
  tool: string,
  prompt: string,
  sizeBytes: number,
  ageSec: number,
): void {
  const now = new Date().toISOString()

  const idx = db.entries.findIndex(e => e.hash === hash)
  if (idx >= 0) {
    db.entries[idx].at = now
    db.entries[idx].ageSec = ageSec
    return
  }

  db.entries.push({
    hash,
    tool,
    prompt,
    sizeBytes,
    at: now,
    ageSec,
    words: tokenize(prompt),
  })

  if (db.entries.length > 500) {
    pruneCacheDbByValue(db, 500)
  }
}

export function recordCacheStats(
  db: CacheDatabase,
  tool: string,
  hit: boolean,
  bytesSaved: number,
): void {
  db.stats[tool] ??= { tool, hits: 0, total: 0, bytesSaved: 0, lastHit: "", hitRate: 0 }
  const s = db.stats[tool]
  s.total++

  if (hit) {
    s.hits++
    s.bytesSaved += bytesSaved
    s.lastHit = new Date().toISOString()
  }

  // Exponential decay hit rate (alpha=0.9 weights recent events higher)
  s.hitRate = s.total > 0
    ? s.hitRate * 0.9 + (hit ? 0.1 : 0)
    : 0
}

// ── Cache prediction ────────────────────────────────────────────────

export function predictCacheHit(
  db: CacheDatabase,
  tool: string,
  prompt: string,
): CachePrediction {
  const stats = db.stats[tool]
  const toolHitRate = stats?.hitRate ?? 0.3

  const similarEntries: SimilarityResult[] = []
  for (let i = 0; i < db.entries.length; i++) {
    const entry = db.entries[i]
    if (entry.tool !== tool) continue
    const score = compositeSimilarity(prompt, entry.prompt)
    if (score > 0.4) {
      similarEntries.push({ hash: entry.hash, score, entry, index: i })
    }
  }
  similarEntries.sort((a, b) => {
    const scoreDiff = b.score - a.score
    if (Math.abs(scoreDiff) > 1e-9) return scoreDiff
    const timeDiff = new Date(b.entry.at).getTime() - new Date(a.entry.at).getTime()
    if (timeDiff !== 0) return timeDiff
    return (b.index ?? 0) - (a.index ?? 0)
  })

  if (similarEntries.length === 0) {
    return {
      shouldCache: toolHitRate > 0.4,
      shouldWarm: false,
      confidence: toolHitRate,
      reason: `no similar entries found; tool hit rate: ${(toolHitRate * 100).toFixed(0)}%`,
      similarEntries: [],
      estimatedSavings: 0,
    }
  }

  const best = similarEntries[0]

  if (best.score >= 0.75) {
    return {
      shouldCache: true,
      shouldWarm: true,
      confidence: best.score,
      reason: `high similarity (${(best.score * 100).toFixed(0)}%) with previous cache entry`,
      similarEntries: similarEntries.slice(0, 3),
      estimatedSavings: Math.round(best.entry.sizeBytes / 4 * 0.10 / 1_000_000 * 1000) / 1000,
    }
  }

  if (best.score >= 0.5) {
    return {
      shouldCache: true,
      shouldWarm: toolHitRate > 0.5,
      confidence: best.score,
      reason: `moderate similarity (${(best.score * 100).toFixed(0)}%) with previous entry`,
      similarEntries: similarEntries.slice(0, 2),
      estimatedSavings: Math.round(best.entry.sizeBytes / 4 * 0.10 / 1_000_000 * 1000) / 1000 * 0.5,
    }
  }

  return {
    shouldCache: toolHitRate > 0.3,
    shouldWarm: false,
    confidence: Math.max(0.2, toolHitRate),
    reason: `low similarity, relying on tool hit rate: ${(toolHitRate * 100).toFixed(0)}%`,
    similarEntries: [],
    estimatedSavings: 0,
  }
}

// ── Age-based cache eviction ────────────────────────────────────────

export function evictStaleEntries(db: CacheDatabase, maxAgeSec: number): number {
  const now = Date.now()
  const before = db.entries.length
  db.entries = db.entries.filter(e => {
    const entryTime = new Date(e.at).getTime()
    return (now - entryTime) / 1000 < maxAgeSec
  })
  return before - db.entries.length
}

export function pruneCacheDbByValue(db: CacheDatabase, maxEntries: number = 500): number {
  if (!db?.entries || !Array.isArray(db.entries) || db.entries.length <= maxEntries) return 0
  const ranked = [...db.entries].sort((a, b) => {
    const scoreB = cacheEntryValue(b, db.stats?.[b.tool])
    const scoreA = cacheEntryValue(a, db.stats?.[a.tool])
    if (scoreB !== scoreA) return scoreB - scoreA
    if ((b.sizeBytes || 0) !== (a.sizeBytes || 0)) return (b.sizeBytes || 0) - (a.sizeBytes || 0)
    return new Date(b.at).getTime() - new Date(a.at).getTime()
  })
  const keep = new Set(ranked.slice(0, maxEntries).map(e => e.hash))
  const before = db.entries.length
  db.entries = db.entries.filter(e => keep.has(e.hash))
  return before - db.entries.length
}

// ── Serialization ───────────────────────────────────────────────────

export function serializeCacheDb(db: CacheDatabase): string {
  return JSON.stringify(db)
}

export function deserializeCacheDb(raw: string): CacheDatabase {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.entries)) {
      return parsed as CacheDatabase
    }
  } catch {}
  return createCacheDatabase()
}
