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
// ── Jaccard similarity ──────────────────────────────────────────────
function tokenize(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 1);
}
function wordSet(words) {
    return new Set(words);
}
export function jaccardSimilarity(a, b) {
    const wa = wordSet(tokenize(a));
    const wb = wordSet(tokenize(b));
    if (wa.size === 0 && wb.size === 0)
        return 0;
    let intersection = 0;
    for (const w of wa) {
        if (wb.has(w))
            intersection++;
    }
    const union = wa.size + wb.size - intersection;
    return union > 0 ? intersection / union : 0;
}
// ── Cosine similarity on bigram features ────────────────────────────
function bigrams(words) {
    const bg = new Set();
    for (let i = 0; i < words.length - 1; i++) {
        bg.add(`${words[i]}_${words[i + 1]}`);
    }
    return bg;
}
export function cosineSimilarity(a, b) {
    const ta = tokenize(a);
    const tb = tokenize(b);
    if (ta.length === 0 || tb.length === 0)
        return 0;
    const ba = bigrams(ta);
    const bb = bigrams(tb);
    if (ba.size === 0 && bb.size === 0)
        return 0;
    const allBigrams = new Set([...ba, ...bb]);
    let dotProduct = 0;
    let magA = 0;
    let magB = 0;
    for (const bg of allBigrams) {
        const inA = ba.has(bg) ? 1 : 0;
        const inB = bb.has(bg) ? 1 : 0;
        dotProduct += inA * inB;
        magA += inA * inA;
        magB += inB * inB;
    }
    const denominator = Math.sqrt(magA) * Math.sqrt(magB);
    return denominator > 0 ? dotProduct / denominator : 0;
}
// ── Weighted keyword overlap ────────────────────────────────────────
const CACHE_HIGH_WEIGHT_WORDS = new Set([
    "test", "tests", "build", "lint", "typecheck", "deploy", "install",
    "npm", "yarn", "docker", "compose", "api", "endpoint", "schema",
    "migration", "database", "query", "config", "package.json", "tsconfig",
    "readme", "changelog", "agent", "index", "main", "app", "server",
]);
function keywordOverlapScore(a, b) {
    const wa = tokenize(a);
    const wb = tokenize(b);
    if (wa.length === 0 || wb.length === 0)
        return 0;
    let score = 0;
    let maxScore = 0;
    for (const w of wa) {
        const weight = CACHE_HIGH_WEIGHT_WORDS.has(w) ? 3 : 1;
        maxScore += weight;
        if (wb.includes(w))
            score += weight;
    }
    return maxScore > 0 ? score / maxScore : 0;
}
// ── Composite similarity (weighted average) ─────────────────────────
export function compositeSimilarity(a, b) {
    return (jaccardSimilarity(a, b) * 0.35 +
        cosineSimilarity(a, b) * 0.35 +
        keywordOverlapScore(a, b) * 0.30);
}
// ── Cache database management ───────────────────────────────────────
export function createCacheDatabase() {
    return { entries: [], stats: {} };
}
export function addCacheEntry(db, hash, tool, prompt, sizeBytes, ageSec) {
    const now = new Date().toISOString();
    const idx = db.entries.findIndex(e => e.hash === hash);
    if (idx >= 0) {
        db.entries[idx].at = now;
        db.entries[idx].ageSec = ageSec;
        return;
    }
    db.entries.push({
        hash,
        tool,
        prompt,
        sizeBytes,
        at: now,
        ageSec,
        words: tokenize(prompt),
    });
    if (db.entries.length > 500) {
        db.entries.sort((a, b) => b.at.localeCompare(a.at));
        db.entries.length = 500;
    }
}
export function recordCacheStats(db, tool, hit, bytesSaved) {
    db.stats[tool] ??= { tool, hits: 0, total: 0, bytesSaved: 0, lastHit: "", hitRate: 0 };
    const s = db.stats[tool];
    s.total++;
    if (hit) {
        s.hits++;
        s.bytesSaved += bytesSaved;
        s.lastHit = new Date().toISOString();
    }
    // Exponential decay hit rate (alpha=0.9 weights recent events higher)
    s.hitRate = s.total > 0
        ? s.hitRate * 0.9 + (hit ? 0.1 : 0)
        : 0;
}
// ── Cache prediction ────────────────────────────────────────────────
export function predictCacheHit(db, tool, prompt) {
    const stats = db.stats[tool];
    const toolHitRate = stats?.hitRate ?? 0.3;
    const similarEntries = [];
    for (const entry of db.entries) {
        if (entry.tool !== tool)
            continue;
        const score = compositeSimilarity(prompt, entry.prompt);
        if (score > 0.4) {
            similarEntries.push({ hash: entry.hash, score, entry });
        }
    }
    similarEntries.sort((a, b) => b.score - a.score);
    if (similarEntries.length === 0) {
        return {
            shouldCache: toolHitRate > 0.4,
            shouldWarm: false,
            confidence: toolHitRate,
            reason: `no similar entries found; tool hit rate: ${(toolHitRate * 100).toFixed(0)}%`,
            similarEntries: [],
            estimatedSavings: 0,
        };
    }
    const best = similarEntries[0];
    if (best.score >= 0.75) {
        return {
            shouldCache: true,
            shouldWarm: true,
            confidence: best.score,
            reason: `high similarity (${(best.score * 100).toFixed(0)}%) with previous cache entry`,
            similarEntries: similarEntries.slice(0, 3),
            estimatedSavings: Math.round(best.entry.sizeBytes / 4 * 0.10 / 1_000_000 * 1000) / 1000,
        };
    }
    if (best.score >= 0.5) {
        return {
            shouldCache: true,
            shouldWarm: toolHitRate > 0.5,
            confidence: best.score,
            reason: `moderate similarity (${(best.score * 100).toFixed(0)}%) with previous entry`,
            similarEntries: similarEntries.slice(0, 2),
            estimatedSavings: Math.round(best.entry.sizeBytes / 4 * 0.10 / 1_000_000 * 1000) / 1000 * 0.5,
        };
    }
    return {
        shouldCache: toolHitRate > 0.3,
        shouldWarm: false,
        confidence: Math.max(0.2, toolHitRate),
        reason: `low similarity, relying on tool hit rate: ${(toolHitRate * 100).toFixed(0)}%`,
        similarEntries: [],
        estimatedSavings: 0,
    };
}
// ── Age-based cache eviction ────────────────────────────────────────
export function evictStaleEntries(db, maxAgeSec) {
    const now = Date.now();
    const before = db.entries.length;
    db.entries = db.entries.filter(e => {
        const entryTime = new Date(e.at).getTime();
        return (now - entryTime) / 1000 < maxAgeSec;
    });
    return before - db.entries.length;
}
// ── Serialization ───────────────────────────────────────────────────
export function serializeCacheDb(db) {
    return JSON.stringify(db);
}
export function deserializeCacheDb(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.entries)) {
            return parsed;
        }
    }
    catch { }
    return createCacheDatabase();
}
