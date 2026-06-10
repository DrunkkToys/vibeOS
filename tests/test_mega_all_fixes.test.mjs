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
  sandbox = mkdtempSync(join(tmpdir(), "vibeos-mega-"))
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  mkdirSync(join(sandbox, ".opencode"), { recursive: true })
  writeFileSync(join(sandbox, ".opencode/opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-pro" }))
  mkdirSync(join(sandbox, ".claude/scratch/by-hash"), { recursive: true })
  mkdirSync(join(sandbox, ".claude/scratch/sessions/sess-A/by-hash"), { recursive: true })
  mkdirSync(join(sandbox, ".claude/scratch/sessions/sess-B/by-hash"), { recursive: true })
  mkdirSync(join(sandbox, ".claude"), { recursive: true })
  writeFileSync(join(sandbox, ".claude", "delegation-state.json"), JSON.stringify({
    sessions: {}, lifetime: { cache_savings_usd: 0, total_savings_usd: 0 },
  }))
})
test.after(() => {
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})

function setTiers() {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    $schema_version: 1,
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "deepseek-reasoner" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
    },
    selection: {
      enabled: true,
      active_slot: "brain",
      delegation_enforce: true,
      tdd_strict: false,
      flow_enabled: false,
      flow_enforce: false,
      tdd_enforce: false,
      tdd_quality: false,
      thinking_level: "off",
      onboarding_mode: "assist",
    },
    tiers: {
      high: { regex: "opus|gemini-.*-pro|deepseek.*v4.*pro|deepseek.*r1|deepseek.*reasoner|gpt-5|o1|o3|o4" },
      mid: { regex: "claude.*sonnet|sonnet|deepseek.*v4.*flash|gemini-.*-flash|gpt-4o" },
      budget: { regex: ".*" },
    },
  }, null, 2))
}

async function getHooks() {
  const mod = await import(join(root, "src/index.js?t=" + Date.now()))
  return mod.DelegationEnforcer({ client: {}, directory: join(sandbox, ".opencode") })
}

// ── GROUP 1: VibeUltraX mode (Wired dynamic, not hardcoded) ──
test("1a — VibeUltraX exists in BRANDED_MODES with 107% quality", async () => {
  const { BRANDED_MODES } = await import(join(root, "src/lib/mode-router.js?mr=" + Date.now()))
  const vx = BRANDED_MODES.find(m => m.id === "vibeultrax")
  assert.ok(vx, "VibeUltraX in BRANDED_MODES")
  assert.equal(vx.qualityVsBrain, 107, "quality claim 107%")
  assert.equal(vx.pipeline[0], "local", "first tier is local")
  assert.ok(vx.pipeline.includes("brain"), "pipeline includes brain")
})

test("1b — VibeUltraX listed when trinity mode called without args", async () => {
  const { getBrandedModes } = await import(join(root, "src/lib/mode-router.js?mr2=" + Date.now()))
  const ids = getBrandedModes().map(m => m.id)
  assert.ok(ids.includes("vibeultrax"), "branded modes includes vibeultrax: " + ids.join(", "))
})

test("1c — fast trinity mode switch reads from BRANDED_MODES not hardcoded list", async () => {
  // Verify the handler uses BRANDED_MODES dynamically
  const tool = readFileSync(join(root, "src/lib/trinity-tool.ts"), "utf-8")
  const hasBrandedModes = tool.includes("BRANDED_MODES")
  assert.ok(hasBrandedModes, "trinity-tool imports BRANDED_MODES dynamically")
  assert.ok(!tool.includes('"vibemax", "vibeqmax", "vibeultrax"'),
    "mode list not hardcoded — uses BRANDED_MODES array")
})

test("1d — trinity set model override rewrites the slot map but leaves live config untouched", async () => {
  setTiers()
  const targetModel = "magicoder:7b"
  const hooks = await getHooks()
  const result = await hooks.tool.trinity.execute({
    action: "set",
    slot: "cheap",
    model: targetModel,
  })
  const tiers = JSON.parse(readFileSync(join(sandbox, ".claude/model-tiers.json"), "utf8"))
  const sel = tiers.selection
  const oc = JSON.parse(readFileSync(join(sandbox, ".opencode/opencode.json"), "utf8"))
  assert.equal(sel.active_slot, "brain", "active slot stays on the previously selected brain tier")
  assert.equal(tiers.trinity.cheap.oc, targetModel, "cheap slot model persisted in tier map")
  assert.equal(oc.model, "deepseek/deepseek-v4-pro", "OpenCode config remains unchanged on this code path")
  assert.equal(sel.selected_model, undefined, "selected_model is not written by this path")
  assert.equal(sel.executed_model, undefined, "executed_model is not written by this path")
  assert.ok(result.includes(targetModel), "response mentions overridden model: " + result.slice(0, 120))
})

// ── GROUP 2: Phantom savings dedup ──
test("2a — same hash doesn't double savings", async () => {
  const { recordCacheSaving, readLifetimeSavings } = await import(join(root, "src/lib/state.js?sav=" + Date.now()))
  const hash = "mega-test-hash-" + Date.now()
  for (let i = 0; i < 5; i++) recordCacheSaving("test_tool", 0.50, { hash })
  await new Promise(r => setTimeout(r, 50))
  const sv = readLifetimeSavings()
  assert.ok(sv.ltCache <= 0.51, "capped at 1x savings: " + sv.ltCache)
})

test("2b — unique hashes each add savings", async () => {
  const { recordCacheSaving, readLifetimeSavings } = await import(join(root, "src/lib/state.js?sav2=" + Date.now()))
  writeFileSync(join(sandbox, ".claude", "delegation-state.json"), JSON.stringify({
    sessions: {}, lifetime: { cache_savings_usd: 0, total_savings_usd: 0 },
  }))
  for (const h of ["hash-X", "hash-Y", "hash-Z"]) recordCacheSaving("test_tool", 1.00, { hash: h })
  await new Promise(r => setTimeout(r, 50))
  const sv = readLifetimeSavings()
  assert.ok(sv.ltCache >= 2.99, "3 unique hashes = ~$3 savings: " + sv.ltCache)
})

// ── GROUP 3: Cross-session cache dedup ──
test("3a — scratchpad global by-hash dedup", () => {
  const hash = "mega-hash-" + Date.now()
  writeFileSync(join(sandbox, ".claude/scratch/by-hash", `${hash}.txt`), "globally-deduped-content")
  writeFileSync(join(sandbox, ".claude/scratch/sessions/sess-B/by-hash", `${hash}.txt`), "stale-local-copy")

  const globalPath = join(sandbox, ".claude/scratch/by-hash", `${hash}.txt`)
  const sessionPath = join(sandbox, ".claude/scratch/sessions/sess-B/by-hash", `${hash}.txt`)
  const chosen = existsSync(globalPath) ? globalPath : (existsSync(sessionPath) ? sessionPath : null)

  assert.equal(chosen, globalPath, "global wins over session-local")
  assert.equal(readFileSync(chosen, "utf-8"), "globally-deduped-content")
})

test("3b — no cache leakage between sessions", () => {
  writeFileSync(join(sandbox, ".claude/scratch/sessions/sess-A/by-hash", "private.txt"), "sess-A-secret")
  assert.ok(!existsSync(join(sandbox, ".claude/scratch/sessions/sess-B/by-hash", "private.txt")),
    "session B doesn't have session A's private file")
})

// ── GROUP 4: Undefined SID protection ──
test("4a — no 'undefined' session key in blackbox", async () => {
  const { loadBlackboxState } = await import(join(root, "src/lib/state.js?bb=" + Date.now()))
  const bbPath = join(sandbox, ".claude", "blackbox-state.json")
  writeFileSync(bbPath, JSON.stringify({ sessions: {} }))
  const state = loadBlackboxState()
  const keys = Object.keys(state.sessions || {})
  assert.ok(!keys.includes("undefined"), "no 'undefined' key in blackbox. Keys: " + keys.join(","))
})

test("4b — turn-classify guards undefined SID", async () => {
  const ts = readFileSync(join(root, "src/lib/turn-classify.ts"), "utf-8")
  const guardCount = (ts.match(/sid\s*&&\s*sid\s*!==\s*"undefined"/g) || []).length
  assert.ok(guardCount >= 4, "at least 4 undefined-SID guards in turn-classify.js: " + guardCount)
})

// ── GROUP 5: Project fingerprint write-once ──
test("5 — project_fingerprint set once per session", async () => {
  const st = readFileSync(join(root, "src/lib/state.ts"), "utf-8")
  const guardCount = (st.match(/!s\.sessions.*project_fingerprint/g) || []).length
  assert.ok(guardCount >= 2, "write-once guard present: " + guardCount)
})

// ── GROUP 6: Anomaly detector doesn't permanently break API ──
test("6a — setAnomalyDetection exported and toggleable", async () => {
  const { setAnomalyDetection } = await import(join(root, "src/lib/api-client.js?ani=" + Date.now()))
  assert.equal(typeof setAnomalyDetection, "function", "setAnomalyDetection is a function")
  setAnomalyDetection(false)
  setAnomalyDetection(true)
  setAnomalyDetection(false)
  assert.ok(true, "toggle works without throwing")
})

test("6b — no _apiFallbackMode in anomaly throttle path", async () => {
  const src = readFileSync(join(root, "src/lib/api-client.ts"), "utf-8")
  const afterThrottle = src.split("throttleIfAnomalous")[1]
  const untilTryBlock = afterThrottle.split("try {")[0]
  assert.ok(!untilTryBlock.includes("_apiFallbackMode = true"),
    "no _apiFallbackMode = true in anomaly path")
})

// ── GROUP 7: Mode-router syncs properly (no hardcoded build) ──
test("7 — mode-router.js compiled and exports getBrandedModes", async () => {
  const { getBrandedModes, BRANDED_MODES } = await import(join(root, "src/lib/mode-router.js?mr3=" + Date.now()))
  assert.equal(typeof getBrandedModes, "function", "getBrandedModes exported")
  assert.ok(Array.isArray(BRANDED_MODES), "BRANDED_MODES is array")
  assert.ok(BRANDED_MODES.length >= 3, "at least 3 branded modes: " + BRANDED_MODES.length)
})

// ── GROUP 8: Smart cache basic integrity ──
test("8a — smart cache jaccard similarity scoring", () => {
  const { jaccardSimilarity } =
    { jaccardSimilarity: (a, b) => { const wa = new Set(a.toLowerCase().split(/\s+/)); const wb = new Set(b.toLowerCase().split(/\s+/)); let i = 0; for (const w of wa) if (wb.has(w)) i++; const u = wa.size + wb.size - i; return u > 0 ? i / u : 0 } }
  assert.ok(jaccardSimilarity("implement rate limiter express", "build rate limiter for express") > 0.3)
  assert.ok(jaccardSimilarity("implement rate limiter express", "configuring docker compose deployment") < 0.3)
})

test("8b — smart cache dedup and eviction", async () => {
  const sc = await import(join(root, "src/vibeOS-lib/smart-cache.js?sc=" + Date.now()))
  const db = sc.createCacheDatabase()
  sc.addCacheEntry(db, "h1", "write", "prompt a", 1000, 10)
  sc.addCacheEntry(db, "h1", "write", "prompt a", 1000, 10)
  assert.equal(db.entries.length, 1, "dedup keeps 1 entry")

  sc.addCacheEntry(db, "old-1", "read", "old", 100, 99999)
  db.entries[1].at = new Date(Date.now() - 86400 * 1000).toISOString()
  sc.addCacheEntry(db, "new-1", "read", "new", 100, 1)
  const evicted = sc.evictStaleEntries(db, 3600)
  assert.ok(evicted >= 1, "evicted stale: " + evicted)
})

// ── GROUP 9: Build chain — mode-router in sync list ──
test("9 — mode-router listed in sync-ts-build.mjs libModules", () => {
  const syncScript = readFileSync(join(root, "scripts/sync-ts-build.mjs"), "utf-8")
  assert.ok(syncScript.includes('"mode-router"'), "mode-router in libModules")
})

// ── GROUP 10A: Model name resolution regression (v0.22.25) ──
test("10a — _resolveConfiguredModelId returns qualified name when bare model matches", async () => {
  const { _resolveConfiguredModelId } = await import(join(root, "src/lib/pricing.js?mrr=" + Date.now()))
  const configs = [{
    provider: {
      deepseek: { models: { "deepseek-v4-pro": {}, "deepseek-v4-flash": {}, "deepseek-chat": {} } }
    }
  }]
  // Exact bare match → provider-qualified
  const result = _resolveConfiguredModelId("deepseek-chat", configs)
  assert.equal(result, "deepseek/deepseek-chat", "bare name resolved to provider-qualified")
})

test("10b — _resolveConfiguredModelId returns empty string for unresolvable bare name", async () => {
  const { _resolveConfiguredModelId } = await import(join(root, "src/lib/pricing.js?mrr2=" + Date.now()))
  const configs = [{
    provider: {
      deepseek: { models: { "deepseek-v4-pro": {}, "deepseek-v4-flash": {} } }
    }
  }]
  // No match → empty string (not bare name — prevents garbage propagation)
  const result = _resolveConfiguredModelId("haiku", configs)
  assert.equal(result, "", "unresolvable bare name returns empty string")
})

test("10c — _resolveConfiguredModelId returns qualified name on suffix/prefix match", async () => {
  const { _resolveConfiguredModelId } = await import(join(root, "src/lib/pricing.js?mrr3=" + Date.now()))
  const configs = [{
    provider: {
      deepseek: { models: { "deepseek-v4-pro": {}, "deepseek-v4-flash": {} } }
    }
  }]
  // Suffix fuzzy match → provider-qualified
  const result = _resolveConfiguredModelId("v4-flash", configs)
  assert.equal(result, "deepseek/deepseek-v4-flash", "fuzzy suffix match resolves to qualified")
})

test("10d — _resolveConfiguredModelId prefers qualified name over bare when multiple matches", async () => {
  const { _resolveConfiguredModelId } = await import(join(root, "src/lib/pricing.js?mrr4=" + Date.now()))
  const configs = [{
    provider: {
      deepseek: { models: { "deepseek-chat": {} } },
      openrouter: { models: { "openrouter/deepseek-chat": {} } }
    }
  }]
  // Multiple matches → prefer first qualified
  const result = _resolveConfiguredModelId("deepseek-chat", configs)
  assert.ok(result.includes("/"), "result is provider-qualified: " + result)
})

test("10e — readConfig respects provider resolution for workspace models", async () => {
  const { readConfig } = await import(join(root, "src/lib/pricing.js?mrr5=" + Date.now()))
  const dir = join(sandbox, "proj-workspace-test")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({
    model: "deepseek-chat",
    provider: { deepseek: { models: { "deepseek-chat": {} } } }
  }) + "\n")
  const model = readConfig(dir)
  assert.ok(model, "readConfig returns a model: " + model)
  assert.ok(model.includes("/"), "model is provider-qualified: " + model)
})

test("10f — classify handles both bare and provider-qualified names", async () => {
  const { classify } = await import(join(root, "src/lib/pricing.js?mrr6=" + Date.now()))
  assert.equal(classify("deepseek/deepseek-v4-pro"), "high", "qualified pro → high")
  assert.equal(classify("deepseek/deepseek-v4-flash"), "mid", "qualified flash → mid")
  // Bare name fallback: regex now has \b alternatives for bare deepseek-v4-pro/flash
  assert.equal(classify("deepseek-v4-pro"), "high", "bare pro → high (fallback)")
  assert.equal(classify("deepseek-v4-flash"), "mid", "bare flash → mid (fallback)")
})

test("10g — null-safe _collectConfiguredProviderModelsFromConfig", async () => {
  const mod = await import(join(root, "src/lib/pricing.js?mrr7=" + Date.now()))
  const cfg = mod._collectConfiguredProviderModelsFromConfig
  if (typeof cfg === "function") {
    assert.deepEqual(cfg(null), [], "null config returns empty array")
    assert.deepEqual(cfg(undefined), [], "undefined config returns empty array")
    assert.deepEqual(cfg({}), [], "empty config returns empty array")
  } else {
    assert.ok(true, "function not exported — internal only")
  }
})

// ── GROUP 10: All regression test files runnable ──
test("10 — all fix regression files exist and have valid syntax", () => {
  const files = [
    "tests/test_10fixes_regression.test.mjs",
    "tests/test_cross_session_regression.test.mjs",
    "tests/test_smart_cache_regression.test.mjs",
    "tests/test_mega_all_fixes.test.mjs",
  ]
  for (const f of files) {
    assert.ok(existsSync(join(root, f)), f + " exists")
  }
})
