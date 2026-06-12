import { describe, it } from "node:test"
import assert from "node:assert/strict"

function rebuildFromLedger(ledgerLines) {
  const state = {
    sessions: {},
    lifetime: { total_savings_usd: 0, cache_savings_usd: 0, warn_count: 0 },
    rebuilt_from_ledger: true,
  }
  for (const line of ledgerLines) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      const sid = entry.sid || "unknown"
      if (!state.sessions[sid]) {
        state.sessions[sid] = { warns: [], cache_savings_usd: 0, cost_usd: 0, started: entry.at }
      }
      if (entry.kind === "cache") {
        state.sessions[sid].cache_savings_usd += entry.amount_usd || 0
        state.lifetime.cache_savings_usd += entry.amount_usd || 0
      } else if (entry.kind === "delegation") {
        state.sessions[sid].warns.push({
          tool: entry.tool || "unknown",
          est_savings_usd: entry.amount_usd || 0,
          reason: entry.reason || "delegation",
          at: entry.at,
        })
        state.lifetime.total_savings_usd += entry.amount_usd || 0
      }
    } catch {}
  }
  // Round to avoid floating point issues
  state.lifetime.total_savings_usd = Math.round(state.lifetime.total_savings_usd * 10000) / 10000
  state.lifetime.cache_savings_usd = Math.round(state.lifetime.cache_savings_usd * 10000) / 10000
  return state
}

describe("production: ledger rebuild", () => {
  it("rebuilt_from_ledger flag is set", () => {
    const state = rebuildFromLedger([])
    assert.equal(state.rebuilt_from_ledger, true)
  })

  it("empty ledger returns empty state with no sessions", () => {
    const state = rebuildFromLedger([])
    assert.equal(Object.keys(state.sessions).length, 0)
    assert.equal(state.lifetime.total_savings_usd, 0)
    assert.equal(state.lifetime.cache_savings_usd, 0)
  })

  it("cache entries accumulate per session", () => {
    const ledger = [
      '{"v":2,"at":"2026-06-12T15:08:48.607Z","kind":"cache","amount_usd":0.0001,"sid":"sid-1","tool":"Read"}',
      '{"v":2,"at":"2026-06-12T15:08:48.614Z","kind":"cache","amount_usd":0.0004,"sid":"sid-1","tool":"Read"}',
      '{"v":2,"at":"2026-06-12T15:08:48.621Z","kind":"cache","amount_usd":0.0003,"sid":"sid-2","tool":"Read"}',
    ]
    const state = rebuildFromLedger(ledger)
    assert.equal(state.sessions["sid-1"].cache_savings_usd, 0.0005)
    assert.equal(state.sessions["sid-2"].cache_savings_usd, 0.0003)
    assert.equal(state.lifetime.cache_savings_usd, 0.0008)
  })

  it("delegation entries accumulate per session", () => {
    const ledger = [
      '{"v":2,"at":"2026-06-12T15:00:00.000Z","kind":"delegation","amount_usd":1.50,"sid":"sid-1","tool":"edit","reason":"direct edit"}',
      '{"v":2,"at":"2026-06-12T15:01:00.000Z","kind":"delegation","amount_usd":0.75,"sid":"sid-1","tool":"bash","reason":"delegation"}',
    ]
    const state = rebuildFromLedger(ledger)
    assert.equal(state.sessions["sid-1"].warns.length, 2)
    assert.equal(state.lifetime.total_savings_usd, 2.25)
  })

  it("200+ ledger entries process without error", () => {
    const ledger = Array.from({ length: 200 }, (_, i) =>
      JSON.stringify({
        v: 2,
        at: new Date().toISOString(),
        kind: i % 2 === 0 ? "cache" : "delegation",
        amount_usd: i % 2 === 0 ? 0.0001 : 0.50,
        sid: `sid-${i % 3}`,
        tool: i % 2 === 0 ? "Read" : "edit",
      })
    )
    const state = rebuildFromLedger(ledger)
    assert.equal(state.rebuilt_from_ledger, true)
    assert.ok(Object.keys(state.sessions).length <= 3)
    assert.ok(state.lifetime.total_savings_usd > 0)
    assert.ok(state.lifetime.cache_savings_usd > 0)
  })

  it("mixed entry types produce correct totals", () => {
    const ledger = [
      '{"v":2,"at":"2026-06-12T15:00:00.000Z","kind":"cache","amount_usd":0.01,"sid":"sid-1","tool":"Read"}',
      '{"v":2,"at":"2026-06-12T15:01:00.000Z","kind":"delegation","amount_usd":2.00,"sid":"sid-1","tool":"edit","reason":"direct edit"}',
      '{"v":2,"at":"2026-06-12T15:02:00.000Z","kind":"delegation","amount_usd":1.50,"sid":"sid-1","tool":"bash","reason":"delegation"}',
    ]
    const state = rebuildFromLedger(ledger)
    assert.equal(state.lifetime.total_savings_usd, 3.50)
    assert.equal(state.lifetime.cache_savings_usd, 0.01)
  })
})
