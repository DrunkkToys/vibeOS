// SPDX-License-Identifier: MIT
// Tests for:
// 1. Footer honesty: active_slot (not session_slot) is the primary display label
// 2. Pivot cache TTL: stale entries (>4h) are skipped in detectPivotBack
// 3. Pivot cache accessBonus removed: access_count no longer inflates confidence
// 4. syncControlSettings quality floor: requested_optimization_mode=quality blocks cheap/medium auto-downgrade
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-fixes-"))
const vibeHome = join(sandbox, ".claude")
mkdirSync(vibeHome, { recursive: true })
mkdirSync(join(sandbox, ".opencode"), { recursive: true })

const prevVibeHome = process.env.VIBEOS_HOME
const prevHome = process.env.HOME
process.env.VIBEOS_HOME = vibeHome
process.env.HOME = sandbox

writeFileSync(join(vibeHome, "model-tiers.json"), JSON.stringify({
  selection: { enabled: true, active_slot: "brain", optimization_mode: "quality", requested_optimization_mode: "quality" },
  trinity: {
    cheap: { oc: "opencode/big-pickle", cc: "opencode/big-pickle" },
    medium: { oc: "opencode-go/deepseek-v4-flash", cc: "opencode-go/deepseek-v4-flash" },
    brain: { oc: "opencode-go/mimo-v2.5", cc: "opencode-go/mimo-v2.5" },
  },
}))
writeFileSync(join(vibeHome, "delegation-state.json"), JSON.stringify({ sessions: {}, lifetime: {} }))
writeFileSync(join(vibeHome, "blackbox-state.json"), JSON.stringify({ sessions: {} }))

after(() => {
  process.env.VIBEOS_HOME = prevVibeHome !== undefined ? prevVibeHome : ""
  process.env.HOME = prevHome !== undefined ? prevHome : ""
})

// ── §1 Footer: active_slot is primary when session_slot > active_slot ─────────

test("buildFooterLine: active_slot=cheap renders cheap as primary (not brain)", async () => {
  const { buildFooterLine } = await import("../src/lib/hooks/shared-footer.js")
  const line = buildFooterLine({
    activeSlot: "cheap",
    sessionSlot: "brain",
    providerLabel: "Deepseek",
    modelName: "V4 Flash",
    vibeBrand: "vibeOS",
    optMode: "quality",
    flashIcon: "",
    enfTags: [],
  })
  assert.ok(line.includes("cheap"), `footer must show 'cheap' as primary tier, got: ${line}`)
  assert.ok(!line.match(/^— 🧠 brain/), `footer must NOT start with brain icon when active_slot=cheap, got: ${line}`)
})

test("buildFooterLine: shows downgrade tag [↓ brain] when active=cheap session=brain", async () => {
  const { buildFooterLine } = await import("../src/lib/hooks/shared-footer.js")
  const line = buildFooterLine({
    activeSlot: "cheap",
    workerSlot: "↓ brain",
    providerLabel: "Deepseek",
    modelName: "V4 Flash",
    vibeBrand: "vibeOS",
    optMode: "quality",
    flashIcon: "",
    enfTags: [],
  })
  assert.ok(line.includes("[↓ brain]"), `footer must show downgrade tag, got: ${line}`)
})

// ── §2 Pivot cache TTL: stale entries skipped in detectPivotBack ──────────────

test("PivotCache.detectPivotBack: entry older than 4h is skipped", async () => {
  const { PivotCache } = await import("../src/vibeOS-lib/blackbox/pivot-cache.js")
  const cache = new PivotCache(vibeHome)

  const staleTime = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
  const freshTime = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  cache.index.pivots["stale-wf"] = { id: "stale-wf", captured_at: staleTime, tokens: ["debug", "git"], intent: "fix bug", access_count: 0 }
  cache.index.pivots["fresh-wf"] = { id: "fresh-wf", captured_at: freshTime, tokens: ["test", "create"], intent: "write tests", access_count: 0 }
  cache.index.sequence = ["stale-wf", "fresh-wf", "current-wf"]
  cache.index.pivots["current-wf"] = { id: "current-wf", captured_at: new Date().toISOString(), tokens: ["inspect"], intent: "check", access_count: 0 }

  const tokens = new Set(["debug", "git"])
  const result = cache.detectPivotBack(tokens, 0.3)
  assert.notEqual(result.matchedId, "stale-wf", "stale entry must not match even with token overlap")
})

test("PivotCache.detectPivotBack: fresh entry within 4h can still match", async () => {
  const { PivotCache } = await import("../src/vibeOS-lib/blackbox/pivot-cache.js")
  const cache = new PivotCache(vibeHome)

  const freshTime = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  cache.index.pivots["fresh-wf-2"] = { id: "fresh-wf-2", captured_at: freshTime, tokens: ["refactor", "create"], intent: "refactor module", access_count: 0 }
  cache.index.pivots["current-wf-2"] = { id: "current-wf-2", captured_at: new Date().toISOString(), tokens: ["inspect"], intent: "check", access_count: 0 }
  cache.index.sequence = ["fresh-wf-2", "current-wf-2"]

  const tokens = new Set(["refactor", "create"])
  const result = cache.detectPivotBack(tokens, 0.3)
  assert.equal(result.matchedId, "fresh-wf-2", "fresh entry with matching tokens should match")
})

// ── §3 Pivot cache: access_count no longer inflates confidence ────────────────

test("PivotCache.detectPivotBack: high access_count does not guarantee match over low-access fresh entry", async () => {
  const { PivotCache } = await import("../src/vibeOS-lib/blackbox/pivot-cache.js")
  const cache = new PivotCache(vibeHome)

  const freshTime = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const alsoFreshTime = new Date(Date.now() - 20 * 60 * 1000).toISOString()

  cache.index.pivots["high-access"] = { id: "high-access", captured_at: alsoFreshTime, tokens: ["misc"], intent: "old task", access_count: 50 }
  cache.index.pivots["low-access"] = { id: "low-access", captured_at: freshTime, tokens: ["debug", "git", "create"], intent: "real task", access_count: 0 }
  cache.index.pivots["current-wf-3"] = { id: "current-wf-3", captured_at: new Date().toISOString(), tokens: ["inspect"], intent: "check", access_count: 0 }
  cache.index.sequence = ["high-access", "low-access", "current-wf-3"]

  const tokens = new Set(["debug", "git", "create"])
  const result = cache.detectPivotBack(tokens, 0.1)
  assert.equal(result.matchedId, "low-access", "token-relevant low-access entry should win over high-access irrelevant entry")
})

// ── §4 syncControlSettings: quality floor blocks cheap/medium downgrade ────────

test("syncControlSettings: requested_optimization_mode=quality blocks auto-downgrade to cheap", async () => {
  const { syncControlSettings } = await import("../src/lib/hooks/chat-transform.js")
  const { loadSelection } = await import("../src/lib/state.js")

  const controlVector = {
    optimization_mode: "budget",
    tier_bias: "cheap",
    selected_slot: "cheap",
    enforcement_mode: "relaxed",
    flow_mode: "audit",
    tdd_mode: "lazy",
    thinking_mode: "off",
    route_path: ["cheap"],
    pipeline_root: ["cheap"],
    cascade_root: ["cheap"],
  }

  syncControlSettings(controlVector, { authoritative: true, persistOptimizationMode: false })

  const sel = loadSelection()
  assert.notEqual(sel.active_slot, "cheap", `quality floor must block slot downgrade to cheap, got: ${sel.active_slot}`)
})

test("syncControlSettings: requested_optimization_mode=quality blocks auto-downgrade to medium", async () => {
  const { syncControlSettings } = await import("../src/lib/hooks/chat-transform.js")
  const { loadSelection } = await import("../src/lib/state.js")

  const controlVector = {
    optimization_mode: "vibemax",
    tier_bias: "medium",
    selected_slot: "medium",
    enforcement_mode: "strict",
    flow_mode: "audit",
    tdd_mode: "lazy",
    thinking_mode: "brief",
    route_path: ["medium"],
    pipeline_root: ["medium"],
    cascade_root: ["medium"],
  }

  syncControlSettings(controlVector, { authoritative: true, persistOptimizationMode: false })

  const sel = loadSelection()
  assert.notEqual(sel.active_slot, "medium", `quality floor must block slot downgrade to medium, got: ${sel.active_slot}`)
})

// ── §5 pruneStale removes stale pivot cache entries on construction ───────────

test("PivotCache.pruneStale: removes entries older than TTL from index", async () => {
  const { PivotCache } = await import("../src/vibeOS-lib/blackbox/pivot-cache.js")
  const cache = new PivotCache(vibeHome)

  const staleTime = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  cache.index.pivots["very-stale"] = { id: "very-stale", captured_at: staleTime, tokens: ["debug"], intent: "old", access_count: 0 }
  cache.index.sequence = [...cache.index.sequence, "very-stale"]

  cache.pruneStale()

  assert.equal(cache.index.pivots["very-stale"], undefined, "stale entry must be removed from index.pivots")
  assert.ok(!cache.index.sequence.includes("very-stale"), "stale entry must be removed from index.sequence")
})
