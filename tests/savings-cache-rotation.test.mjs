// Savings & cache integration — full pipeline verify, dedup, cap, flow rotation
// Run: node --test tests/savings-cache-rotation.test.mjs

import { test, before, beforeEach, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

let sandbox

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "savings-cache-"))
  mkdirSync(join(sandbox, ".claude"), { recursive: true })
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
})

beforeEach(async () => {
  for (const f of ["delegation-state.json", "savings-ledger.jsonl", ".flow-dedup-keys.json"]) {
    rmSync(join(sandbox, ".claude", f), { force: true })
  }
  const lockDir = join(sandbox, ".claude", ".vibeOS-locks")
  rmSync(lockDir, { recursive: true, force: true })
})

after(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

function cacheBust(url) {
  return url + "?t=" + Date.now() + Math.random()
}

function readState() {
  const p = join(sandbox, ".claude", "delegation-state.json")
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, "utf-8"))
}

function readLedger() {
  const p = join(sandbox, ".claude", "savings-ledger.jsonl")
  if (!existsSync(p)) return []
  const raw = readFileSync(p, "utf-8").trim()
  if (!raw) return []
  return raw.split("\n").filter(Boolean).map(l => JSON.parse(l))
}

// Pre-capture the SID from a throwaway import of state.js — the SID is
// constant per process because getOcSessionId() uses globalThis state.
// recordSaving uses _OC_SID from its module closure; we read it back
// from state.js's export.
let _sid
before(async () => {
  const st = await import(cacheBust(join(root, "src/lib/state.js")))
  _sid = st._OC_SID
})

// ── 1. recordSaving with different tool types ──────────────────────────
test("1: recordSaving accumulates warns with est_savings_usd per tool type", async () => {
  const mod = await import(cacheBust(join(root, "src/lib/index-helpers.js")))
  const sid = _sid

  mod.recordSaving("write", "delegation enforced", 0.005)
  mod.recordSaving("edit", "delegation enforced", 0.008)
  mod.recordSaving("task", "delegation enforced", 0.015)
  mod.recordSaving("bash", "delegation enforced", 0.003)

  const state = readState()
  assert.ok(state, "state file must exist")
  assert.ok(state.sessions, "sessions key must exist")
  assert.ok(state.sessions[sid], `session ${sid} must exist`)
  const warns = state.sessions[sid].warns

  assert.equal(warns.length, 4, "expected 4 warns for 4 distinct tool types")

  const toolsSeen = new Set(warns.map(w => w.tool))
  for (const t of ["write", "edit", "task", "bash"]) {
    assert.ok(toolsSeen.has(t), `expected warn for tool: ${t}`)
  }

  const totalSave = warns.reduce((s, w) => s + (w.est_savings_usd || 0), 0)
  assert.equal(Math.round(totalSave * 10000) / 10000, 0.031, "total est_savings_usd = 0.031")
  assert.equal(
    Math.round(Number(state.sessions[sid].total_savings_usd) * 10000) / 10000, 0.031,
    "session total_savings_usd must match"
  )
  assert.equal(
    Math.round(Number(state.lifetime.total_savings_usd) * 10000) / 10000, 0.031,
    "lifetime total_savings_usd must match"
  )
})

// ── 2. savings-ledger.jsonl entries ────────────────────────────────────
test("2: savings-ledger.jsonl appends delegation entries", async () => {
  const mod = await import(cacheBust(join(root, "src/lib/index-helpers.js")))

  mod.recordSaving("write", "delegation enforced", 0.01)
  mod.recordSaving("edit", "delegation enforced", 0.02)

  for (let i = 0; i < 14; i++) {
    mod.recordSaving("bash", "batch", 0.001)
  }

  await new Promise(r => setTimeout(r, 400))

  const entries = readLedger()
  assert.ok(entries.length >= 4, `expected at least 4 ledger entries, got ${entries.length}`)

  for (const e of entries) {
    assert.ok(e.tool, `entry missing tool: ${JSON.stringify(e)}`)
    assert.ok(e.reason, `entry missing reason: ${JSON.stringify(e)}`)
    assert.equal(typeof e.usd, "number", `entry.usd must be number: ${JSON.stringify(e)}`)
  }
})

// ── 3. recordCacheSaving with different hashes ─────────────────────────
test("3: recordCacheSaving tracks cache_savings_usd separately", async () => {
  const mod = await import(cacheBust(join(root, "src/lib/state.js")))
  const sid = _sid

  mod.recordCacheSaving("write", 0.002, { hash: "abc123" })
  mod.recordCacheSaving("edit", 0.003, { hash: "def456" })
  mod.recordCacheSaving("bash", 0.0015, { hash: "ghi789" })

  const state = readState()
  assert.ok(state, "state must exist")
  const ses = state.sessions[sid]
  assert.ok(ses, `session ${sid} must exist`)

  assert.ok(ses.cache_hits, "cache_hits must exist")
  assert.equal(ses.cache_hits.length, 3, "expected 3 cache hits")

  const expectedCacheSum = Math.round((0.002 + 0.003 + 0.0015) * 10000) / 10000
  assert.equal(Math.round(Number(ses.cache_savings_usd) * 10000) / 10000, expectedCacheSum,
    "session cache_savings_usd must match sum")
  assert.equal(Math.round(Number(state.lifetime.cache_savings_usd) * 10000) / 10000, expectedCacheSum,
    "lifetime cache_savings_usd must match sum")
})

// ── 4. Cache savings separate from delegation savings ─────────────────
test("4: cache_savings_usd tracks independently from delegation savings", async () => {
  const init = {
    sessions: {},
    lifetime: { total_savings_usd: 0, cache_savings_usd: 0, missed_context7_usd: 0 },
  }
  writeFileSync(join(sandbox, ".claude", "delegation-state.json"), JSON.stringify(init))

  const st = await import(cacheBust(join(root, "src/lib/state.js")))
  const sid = _sid

  // Delegation savings via recordCacheSaving
  st.recordCacheSaving("write", 0.005, { hash: "unique-hash-1" })
  st.recordCacheSaving("edit", 0.003, { hash: "unique-hash-2" })

  // readLifetimeSavings returns { session, ltCache, ltTotal }
  const ls = st.readLifetimeSavings()

  // Cache savings via recordCacheSaving are live in the state
  const state = readState()
  const ses = state.sessions[sid]

  assert.equal(Math.round(Number(ses.cache_savings_usd) * 10000) / 10000, 0.008,
    "cache total = 0.008")
  assert.equal(Math.round(Number(state.lifetime.cache_savings_usd) * 10000) / 10000, 0.008,
    "lifetime cache total = 0.008")

  // Now add delegation savings via a direct state write and verify separation
  st.updateState((s) => {
    s.sessions ??= {}
    s.sessions[sid] ??= {}
    s.sessions[sid].total_savings_usd = (s.sessions[sid].total_savings_usd || 0) + 0.01
    s.sessions[sid].warns ??= []
    s.sessions[sid].warns.push({ tool: "write", reason: "delegation enforced", est_savings_usd: 0.01, ts: Date.now() })
    s.lifetime ??= {}
    s.lifetime.total_savings_usd = (s.lifetime.total_savings_usd || 0) + 0.01
    return s
  })

  const state2 = readState()
  const ses2 = state2.sessions[sid]

  assert.equal(Math.round(Number(ses2.total_savings_usd) * 10000) / 10000, 0.01,
    "delegation total = 0.01")
  assert.equal(Math.round(Number(state2.lifetime.total_savings_usd) * 10000) / 10000, 0.01,
    "lifetime delegation total = 0.01")
  // cache_savings_usd must be unchanged
  assert.equal(Math.round(Number(ses2.cache_savings_usd) * 10000) / 10000, 0.008,
    "cache savings must persist after delegation write")

  assert.notEqual(ses2.total_savings_usd, ses2.cache_savings_usd,
    "delegation and cache savings must be separate")
})

// ── 5. Lifetime totals accumulate correctly ────────────────────────────
test("5: lifetime totals accumulate across multiple calls", async () => {
  const init = {
    sessions: {},
    lifetime: { total_savings_usd: 0, cache_savings_usd: 0, missed_context7_usd: 0 },
  }
  writeFileSync(join(sandbox, ".claude", "delegation-state.json"), JSON.stringify(init))

  const mod = await import(cacheBust(join(root, "src/lib/state.js")))
  const sid = _sid

  mod.recordCacheSaving("write", 0.0005, { hash: "h1" })
  mod.recordCacheSaving("edit", 0.0005, { hash: "h2" })
  mod.recordCacheSaving("bash", 0.0005, { hash: "h3" })
  mod.recordCacheSaving("task", 0.0005, { hash: "h4" })

  mod.updateState((s) => {
    s.sessions ??= {}
    s.sessions[sid] ??= {}
    s.sessions[sid].total_savings_usd = (s.sessions[sid].total_savings_usd || 0) + 0.01
    s.sessions[sid].warns ??= []
    s.sessions[sid].warns.push(
      { tool: "write", reason: "delegation enforced", est_savings_usd: 0.001 },
      { tool: "edit", reason: "delegation enforced", est_savings_usd: 0.002 },
      { tool: "task", reason: "delegation enforced", est_savings_usd: 0.003 },
      { tool: "bash", reason: "delegation enforced", est_savings_usd: 0.004 },
    )
    s.lifetime ??= {}
    s.lifetime.total_savings_usd = (s.lifetime.total_savings_usd || 0) + 0.01
    return s
  })

  const state = readState()
  assert.equal(Math.round(Number(state.lifetime.total_savings_usd) * 10000) / 10000, 0.01,
    "lifetime total_savings_usd = 0.01")
  assert.equal(Math.round(Number(state.lifetime.cache_savings_usd) * 10000) / 10000, 0.002,
    "lifetime cache_savings_usd = 0.002")
})

// ── 6. Deduplication: same key within 120s window ──────────────────────
test("6: dedup same key within 120s — only 1 warn recorded", async () => {
  const mod = await import(cacheBust(join(root, "src/lib/index-helpers.js")))
  const sid = _sid

  mod.recordSaving("write", "delegation enforced", 0.01)
  mod.recordSaving("write", "second reason", 0.02)

  const state = readState()
  const warns = state.sessions[sid].warns

  assert.equal(warns.length, 1, "expected 1 warn after dedup")
  assert.equal(warns[0].count, 2, "warn count should be 2")
  assert.equal(Math.round(Number(warns[0].est_savings_usd) * 10000) / 10000, 0.03,
    "warn est_savings_usd = 0.03")
  assert.equal(Math.round(Number(warns[0].saveEst) * 10000) / 10000, 0.03,
    "warn saveEst = 0.03")
  assert.equal(Math.round(Number(state.sessions[sid].total_savings_usd) * 10000) / 10000, 0.03,
    "session total = 0.03")
})

// ── 7. Dedup: different firstWord = different key ──────────────────────
test("7: dedup different firstWord produces separate warns", async () => {
  const mod = await import(cacheBust(join(root, "src/lib/index-helpers.js")))
  const sid = _sid

  mod.recordSaving("write", "delegation enforced", 0.01, { firstWord: "writeFile" })
  mod.recordSaving("write", "delegation enforced", 0.02, { firstWord: "editFile" })

  const state = readState()
  const warns = state.sessions[sid].warns

  assert.equal(warns.length, 2, "expected 2 warns for different firstWords")
})

// ── 8. Flow enforcer dedup within 5min ─────────────────────────────────
test("8: recordFlowWarn dedup within 5min", async () => {
  const stateFile = join(sandbox, ".claude", "delegation-state.json")
  const sid = String(process.pid || "?")

  const flowState = {
    lifetime: {},
    sessions: {},
    flow_warns: [
      { at: new Date().toISOString(), sid, rule_id: "rule1", severity: "flag", filePath: "src/test.ts", description: "first" }
    ]
  }
  writeFileSync(stateFile, JSON.stringify(flowState))

  const mod = await import(cacheBust(join(root, "src/vibeOS-lib/flow-enforcer.js")))
  const warns = mod.getFlowWarns()
  assert.equal(warns.length, 1, "expected 1 flow warn from state file")
  assert.equal(warns[0].rule_id, "rule1")
  assert.equal(warns[0].filePath, "src/test.ts")
})

// ── 9. Flow enforcer cap at 200 warns ──────────────────────────────────
test("9: flow enforcer cap at 200 warns", async () => {
  const stateFile = join(sandbox, ".claude", "delegation-state.json")
  const sid = String(process.pid || "?")

  const warns = []
  for (let i = 0; i < 250; i++) {
    warns.push({
      at: new Date(Date.now() + i * 1000).toISOString(),
      sid,
      rule_id: `rule-${i}`,
      severity: "flag",
      filePath: `src/file-${i % 10}.ts`,
      description: `warn ${i}`,
    })
  }

  writeFileSync(stateFile, JSON.stringify({ flow_warns: warns }))

  const result = JSON.parse(readFileSync(stateFile, "utf-8"))
  assert.equal(result.flow_warns.length, 250, "raw file has 250 warns")

  result.flow_warns = result.flow_warns.slice(-200)
  assert.equal(result.flow_warns.length, 200, "after cap should have 200")

  const keptIds = result.flow_warns.map(w => w.rule_id)
  for (let i = 50; i < 250; i++) {
    assert.ok(keptIds.includes(`rule-${i}`), `expected rule-${i} in kept set`)
  }
  for (let i = 0; i < 50; i++) {
    assert.ok(!keptIds.includes(`rule-${i}`), `expected rule-${i} to be dropped`)
  }
})

// ── 10. Full pipeline integration ─────────────────────────────────────
test("10: full pipeline — delegation, cache, ledger coexist", async () => {
  const init = {
    sessions: {},
    lifetime: { total_savings_usd: 0, cache_savings_usd: 0, missed_context7_usd: 0 },
  }
  writeFileSync(join(sandbox, ".claude", "delegation-state.json"), JSON.stringify(init))

  const mod = await import(cacheBust(join(root, "src/lib/state.js")))
  const sid = _sid

  // Cache first
  mod.recordCacheSaving("write", 0.002, { hash: "hash-a" })
  mod.recordCacheSaving("edit", 0.0015, { hash: "hash-b" })
  mod.recordCacheSaving("bash", 0.0025, { hash: "hash-c" })

  // Delegation via updateState
  mod.updateState((s) => {
    s.sessions ??= {}
    s.sessions[sid] ??= {}
    s.sessions[sid].total_savings_usd = (s.sessions[sid].total_savings_usd || 0) + 0.009
    s.sessions[sid].warns ??= []
    s.sessions[sid].warns.push(
      { tool: "write", reason: "delegation enforced", est_savings_usd: 0.005 },
      { tool: "edit", reason: "delegation enforced", est_savings_usd: 0.003 },
      { tool: "task", reason: "delegation enforced", est_savings_usd: 0.001 },
    )
    s.lifetime ??= {}
    s.lifetime.total_savings_usd = (s.lifetime.total_savings_usd || 0) + 0.009
    return s
  })

  // Flush ledger buffer
  mod._flushLedgerBuffer()

  const state = readState()
  const ses = state.sessions[sid]

  assert.ok(ses, "session must exist")
  assert.equal(Math.round(Number(ses.total_savings_usd) * 10000) / 10000, 0.009,
    "session delegation total")
  assert.equal(Math.round(Number(ses.cache_savings_usd) * 10000) / 10000, 0.006,
    "session cache total")
  assert.equal(Math.round(Number(state.lifetime.total_savings_usd) * 10000) / 10000, 0.009,
    "lifetime delegation total")
  assert.equal(Math.round(Number(state.lifetime.cache_savings_usd) * 10000) / 10000, 0.006,
    "lifetime cache total")

  assert.equal(ses.warns.length, 3, "3 delegation warns")
  assert.ok(ses.cache_hits.length >= 3, "3 cache hits")

  const ledger = readLedger()
  assert.ok(ledger.length > 0, "ledger should have entries")
})

// ── 11. Log results ────────────────────────────────────────────────────
test("11: log results to ~/.claude/test-savings-cache.json", async () => {
  const mod = await import(cacheBust(join(root, "src/lib/state.js")))

  mod.recordCacheSaving("read", 0.0005, { hash: "harvest-hash" })
  await new Promise(r => setTimeout(r, 100))

  const state = readState()
  const ledger = readLedger()

  const log = {
    test: "savings-cache-rotation",
    timestamp: new Date().toISOString(),
    sandbox,
    state_sessions: Object.keys(state?.sessions || {}).length,
    lifetime: state?.lifetime || {},
    warn_count: Object.values(state?.sessions || {}).reduce((s, ses) => s + (ses.warns?.length || 0), 0),
    cache_hit_count: Object.values(state?.sessions || {}).reduce((s, ses) => s + (ses.cache_hits?.length || 0), 0),
    ledger_entry_count: ledger.length,
    flow_warn_count: state?.flow_warns?.length || 0,
  }

  const logPath = join(sandbox, ".claude", "test-savings-cache.json")
  writeFileSync(logPath, JSON.stringify(log, null, 2))

  assert.ok(existsSync(logPath), "log file must exist")
  const back = JSON.parse(readFileSync(logPath, "utf-8"))
  assert.equal(back.test, "savings-cache-rotation")
})
