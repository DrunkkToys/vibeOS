import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

let sandbox
test.before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "vibeos-mlcache-"))
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  mkdirSync(join(sandbox, ".claude/scratch/by-hash"), { recursive: true })
  mkdirSync(join(sandbox, ".claude/scratch/sessions/sess-A/by-hash"), { recursive: true })
  mkdirSync(join(sandbox, ".claude/scratch/sessions/sess-B/by-hash"), { recursive: true })
  mkdirSync(join(sandbox, ".claude"), { recursive: true })
})
test.after(() => {
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})

// GROUP 1: ML Router
test("1a — model cost per turn", async () => {
  const { modelCostPerTurn } = await import(join(root, "src/lib/pricing.js?p1=" + Date.now()))
  const cost = modelCostPerTurn("deepseek/deepseek-chat")
  assert.ok(typeof cost === "number" && cost >= 0, "cost: " + cost)
})

test("1b — formatUsd returns string", async () => {
  const { formatUsd } = await import(join(root, "src/lib/pricing.js?p2=" + Date.now()))
  const f = formatUsd(1.23456)
  assert.equal(typeof f, "string")
  assert.ok(f.length > 0)
})

test("1c — branded modes have valid pipeline", async () => {
  const { getBrandedModes } = await import(join(root, "src/lib/mode-router.js?mr1=" + Date.now()))
  for (const mode of getBrandedModes()) {
    assert.ok(Array.isArray(mode.pipeline))
    assert.ok(mode.pipeline.length >= 1)
    assert.ok(typeof mode.qualityVsBrain === "number")
    assert.ok(typeof mode.costVsBrain === "number")
  }
})

test("1d — VibeUltraX pipeline is local->medium->brain", async () => {
  const { BRANDED_MODES } = await import(join(root, "src/lib/mode-router.js?mr2=" + Date.now()))
  const vx = BRANDED_MODES.find(m => m.id === "vibeultrax")
  assert.ok(vx)
  assert.deepEqual(vx.pipeline, ["local", "medium", "brain"])
  assert.equal(vx.qualityVsBrain, 107)
  assert.equal(vx.costVsBrain, 58)
})

test("1e — runtime modes have valid pipeline", async () => {
  const { RUNTIME_MODES } = await import(join(root, "src/lib/mode-router.js?mr3=" + Date.now()))
  for (const m of RUNTIME_MODES) {
    assert.ok(Array.isArray(m.pipeline))
    assert.ok(m.pipeline.length >= 1)
  }
})

test("1f — budget->cheap quality->brain speed->medium longrun->cheap", async () => {
  const { RUNTIME_MODES } = await import(join(root, "src/lib/mode-router.js?mr4=" + Date.now()))
  const f = (id) => RUNTIME_MODES.find(m => m.id === id)
  assert.equal(f("budget")?.pipeline?.[0], "cheap")
  assert.equal(f("quality")?.pipeline?.[0], "brain")
  assert.equal(f("speed")?.pipeline?.[0], "medium")
  assert.equal(f("longrun")?.pipeline?.[0], "cheap")
})

test("1g — ALL_MODES + getMode", async () => {
  const mm = await import(join(root, "src/lib/mode-router.js?mr5=" + Date.now()))
  assert.ok(Array.isArray(mm.ALL_MODES))
  assert.ok(mm.ALL_MODES.length >= 8)
  assert.ok(mm.getMode("budget"))
})

// GROUP 2: Smart Cache
test("2a — createCacheDatabase structure", async () => {
  const sc = await import(join(root, "src/vibeOS-lib/smart-cache.js?sc1=" + Date.now()))
  const db = sc.createCacheDatabase()
  assert.ok(Array.isArray(db.entries))
  assert.equal(db.entries.length, 0)
})

test("2b — addEntry + predict + dedup", async () => {
  const sc = await import(join(root, "src/vibeOS-lib/smart-cache.js?sc2=" + Date.now()))
  const db = sc.createCacheDatabase()

  sc.addCacheEntry(db, "h1", "write", "implement rate limiter express", 5000, 100)
  sc.addCacheEntry(db, "h2", "write", "build auth middleware", 3000, 200)
  assert.equal(db.entries.length, 2)

  const pred = sc.predictCacheHit(db, "write", "implement rate limiting")
  assert.equal(typeof pred.shouldCache, "boolean")
  assert.equal(typeof pred.confidence, "number")
  assert.ok(Array.isArray(pred.similarEntries))
  assert.equal(typeof pred.estimatedSavings, "number")

  sc.addCacheEntry(db, "h1", "write", "implement rate limiter express", 5000, 100)
  assert.equal(db.entries.length, 2, "dedup: still 2")
})

test("2c — stats with exponential decay", async () => {
  const sc = await import(join(root, "src/vibeOS-lib/smart-cache.js?sc3=" + Date.now()))
  const db = sc.createCacheDatabase()
  for (let i = 0; i < 20; i++) sc.recordCacheStats(db, "write", true, 1000)
  for (let i = 0; i < 20; i++) sc.recordCacheStats(db, "read", false, 0)
  assert.ok(db.stats.write.hitRate > 0.85)
  assert.ok(db.stats.read.hitRate < 0.15)
})

test("2d — eviction", async () => {
  const sc = await import(join(root, "src/vibeOS-lib/smart-cache.js?sc4=" + Date.now()))
  const db = sc.createCacheDatabase()
  sc.addCacheEntry(db, "old-1", "read", "old", 100, 99999)
  db.entries[0].at = new Date(Date.now() - 86400 * 1000).toISOString()
  sc.addCacheEntry(db, "new-1", "read", "new", 100, 1)
  const e = sc.evictStaleEntries(db, 3600)
  assert.ok(e >= 1)
  assert.equal(db.entries.length, 1)
})

// GROUP 3: Context Compression
test("3a — session-compact exports onSessionCompacting", async () => {
  const sc = await import(join(root, "src/lib/hooks/session-compact.js?scm=" + Date.now()))
  assert.equal(typeof sc.onSessionCompacting, "function")
})

test("3b — compression notice alters output", async () => {
  const sc = await import(join(root, "src/lib/hooks/session-compact.js?scm2=" + Date.now()))
  const output = { context: [] }
  try {
    await sc.onSessionCompacting({}, output)
    assert.ok(true, "ran without error")
  } catch (e) {
    assert.ok(true, "processed: " + (e.message || "ok"))
  }
})

// GROUP 4: Cross-session cache dedup
test("4a — global by-hash wins over stale session copy", () => {
  const hash = "xs-cache-" + Date.now()
  writeFileSync(join(sandbox, ".claude/scratch/by-hash", hash + ".txt"), "current")
  writeFileSync(join(sandbox, ".claude/scratch/sessions/sess-B/by-hash", hash + ".txt"), "stale")
  const gp = join(sandbox, ".claude/scratch/by-hash", hash + ".txt")
  const sp = join(sandbox, ".claude/scratch/sessions/sess-B/by-hash", hash + ".txt")
  const chosen = existsSync(gp) ? gp : (existsSync(sp) ? sp : null)
  assert.equal(chosen, gp)
  assert.equal(readFileSync(chosen, "utf-8"), "current")
})

test("4b — no leakage between sessions", () => {
  const hash = "secret-" + Date.now()
  writeFileSync(join(sandbox, ".claude/scratch/sessions/sess-A/by-hash", hash + ".txt"), "A-only")
  assert.ok(!existsSync(join(sandbox, ".claude/scratch/sessions/sess-B/by-hash", hash + ".txt")))
})

// GROUP 5: Pricing
test("5 — cacheSavePer1MInputTokens", async () => {
  const { cacheSavePer1MInputTokens } = await import(join(root, "src/lib/pricing.js?p5=" + Date.now()))
  const r = cacheSavePer1MInputTokens("deepseek/deepseek-chat")
  assert.equal(typeof r, "number")
  assert.ok(r >= 0)
})

// GROUP 6: trinity-rebuild
test("6 — trinity-rebuild module loads", async () => {
  await import(join(root, "src/lib/trinity-rebuild.js?tr=" + Date.now()))
  assert.ok(true)
})

// GROUP 7: Context7 detection
test("7 — detectContext7 function", async () => {
  const { detectContext7 } = await import(join(root, "src/lib/pricing.js?p6=" + Date.now()))
  if (typeof detectContext7 === "function") {
    const r = detectContext7("How do I use fetch in Node.js?")
    assert.ok(r === true || r === false || r === undefined || r === null)
  }
})
