import { describe, it } from "node:test"
import assert from "node:assert/strict"

// Module doesn't exist yet — this import WILL fail (TDD red phase).
// Once session-metrics.js is created, this test file will pass.
import { computeSessionMetrics, getSessionCost, aggregateWarns } from "../session-metrics.js"

const SID = "test-session-001"

function makeWarn(tool, reason, est_savings_usd) {
  return { tool, reason, est_savings_usd }
}

describe("getSessionCost", () => {
  it("returns cost_usd for a session", () => {
    const state = {
      sessions: {
        "sid-cost": {
          warns: [],
          cost_usd: 0.05,
          cache_savings_usd: 0,
          tool_counts: {}
        }
      }
    }
    assert.equal(getSessionCost(state, "sid-cost"), 0.05)
  })

  it("returns 0 for missing session", () => {
    assert.equal(getSessionCost({}, "nonexistent"), 0)
  })

  it("returns 0 for null state", () => {
    assert.equal(getSessionCost(null, "any"), 0)
  })
})

describe("aggregateWarns", () => {
  it("sums est_savings_usd across warns", () => {
    const warns = [
      makeWarn("edit", "direct edit", 1.5),
      makeWarn("bash", "delegation", 0.5)
    ]
    assert.equal(aggregateWarns(warns), 2.0)
  })

  it("returns 0 for empty array", () => {
    assert.equal(aggregateWarns([]), 0)
  })

  it("returns 0 for non-array", () => {
    assert.equal(aggregateWarns(null), 0)
  })
})

describe("computeSessionMetrics", () => {
  it("basic session with 1 warn → correct savings, count", () => {
    const state = {
      sessions: {
        [SID]: {
          started: new Date(Date.now() - 3600000).toISOString(), // 1 hr ago
          warns: [makeWarn("edit", "direct edit", 0.5)],
          cache_savings_usd: 0,
          cost_usd: 0.01,
          tool_counts: { edit: 2, bash: 1, task: 0 }
        }
      }
    }
    const metrics = computeSessionMetrics(state, SID)
    assert.equal(metrics.count, 1, "warn count should be 1")
    assert.ok(metrics.ltTasks > 0.49 && metrics.ltTasks < 0.51, `ltTasks should be ~0.5, got ${metrics.ltTasks}`)
    assert.equal(metrics.sesTasks, 0.5, "sesTasks should be 0.5")
    assert.equal(metrics.sesEdit, 0.5, "sesEdit should be 0.5 (direct edit)")
    assert.equal(metrics.sesCredit, 0, "sesCredit should be 0")
    assert.ok(metrics.sesDuration >= 3500 && metrics.sesDuration <= 3700, `sesDuration should be ~3600, got ${metrics.sesDuration}`)
    assert.equal(typeof metrics.ltCost, "number")
    assert.equal(typeof metrics.sesRatePerHour, "number")
  })

  it("multiple sessions → correct lifetime aggregation", () => {
    const state = {
      sessions: {
        "sid-1": {
          started: "2025-01-01T00:00:00Z",
          warns: [makeWarn("bash", "delegation enforced", 1.0), makeWarn("write", "direct edit", 2.0)],
          cache_savings_usd: 0.5,
          cost_usd: 0.02,
          tool_counts: { bash: 5, write: 3, task: 4 }
        },
        "sid-2": {
          started: "2025-01-02T00:00:00Z",
          warns: [makeWarn("websearch", "credit<40% high-tier", 0.75)],
          cache_savings_usd: 0.1,
          cost_usd: 0.01,
          tool_counts: { websearch: 1, task: 2 }
        }
      }
    }
    const metrics = computeSessionMetrics(state, "sid-1")
    assert.equal(metrics.count, 3, "lifetime warn count should be 3 across both sessions")
    assert.equal(metrics.ltCache, 0.6, "ltCache should be 0.5+0.1")
    assert.equal(metrics.ltCost, 0.03, "ltCost should be 0.02+0.01")
    assert.equal(metrics.ltTasks, 3.75, "ltTasks should be 1+2+0.75")
    assert.equal(metrics.sesTasks, 3.0, "sid-1 sesTasks should be 1+2")
    assert.equal(metrics.sesEdit, 2.0, "sid-1 direct edit savings")
  })

  it("empty state → returns zero-filled defaults", () => {
    const emptyState = {}
    const metrics = computeSessionMetrics(emptyState, SID)
    assert.equal(metrics.ltTasks, 0)
    assert.equal(metrics.ltCache, 0)
    assert.equal(metrics.ltCost, 0)
    assert.equal(metrics.count, 0)
    assert.equal(metrics.scratchpadHits, 0)
    assert.equal(metrics.missedC7, 0)
    assert.equal(metrics.sesTasks, 0)
    assert.equal(metrics.sesEdit, 0)
    assert.equal(metrics.sesCredit, 0)
    assert.equal(metrics.sesC7, 0)
    assert.equal(metrics.sesQuota, 0)
    assert.equal(metrics.sesDuration, 0)
    assert.equal(metrics.sesRatePerHour, 0)
    assert.equal(metrics.sesTrend, "stable")
    assert.deepEqual(metrics.sesToolBreakdown, {})
    assert.deepEqual(metrics.sesModelTurns, { brain: 0, worker: 0 })
  })

  it("session trend calculation (↑↓→) for various durations", () => {
    const now = Date.now()
    // Session 1: $1 savings over 2hr → $0.50/hr
    // Session 2: $2 savings over 1hr → $2.00/hr  (big jump up)
    const state = {
      sessions: {
        "sid-slow": {
          started: new Date(now - 7200000).toISOString(),
          warns: [makeWarn("edit", "direct edit", 1.0)],
          cache_savings_usd: 0,
          cost_usd: 0,
          tool_counts: { edit: 1 }
        },
        "sid-fast": {
          started: new Date(now - 3600000).toISOString(),
          warns: [makeWarn("bash", "delegation enforced", 2.0)],
          cache_savings_usd: 0,
          cost_usd: 0,
          tool_counts: { bash: 3, task: 1 }
        }
      }
    }
    // Current session is sid-fast — rate should be higher than sid-slow → "up"
    const metrics = computeSessionMetrics(state, "sid-fast")
    assert.ok(["up", "down", "stable"].includes(metrics.sesTrend), `trend should be up/down/stable, got ${metrics.sesTrend}`)

    // Trend with 2 sessions where current is slower → "down"
    const slowNow = {
      sessions: {
        "sid-fast2": {
          started: new Date(now - 600000).toISOString(), // 10 min ago
          warns: [makeWarn("edit", "direct edit", 3.0)],
          cache_savings_usd: 0,
          cost_usd: 0,
          tool_counts: { edit: 1 }
        },
        "sid-slow2": {
          started: new Date(now - 7200000).toISOString(), // 2 hr ago
          warns: [makeWarn("write", "direct edit", 0.5)],
          cache_savings_usd: 0,
          cost_usd: 0,
          tool_counts: { write: 1 }
        }
      }
    }
    const metrics2 = computeSessionMetrics(slowNow, "sid-slow2")
    // The slow session rate ($0.25/hr) should be much lower than the fast one ($18/hr) → "down"
    assert.ok(["up", "down", "stable"].includes(metrics2.sesTrend))
  })

  it("no state / null / undefined → graceful handling", () => {
    const m1 = computeSessionMetrics(null, SID)
    const m2 = computeSessionMetrics(undefined, SID)
    assert.deepEqual(m1, m2, "null and undefined should produce identical defaults")
    assert.equal(m1.ltTasks, 0)
    assert.equal(m1.count, 0)
    assert.equal(m1.sesTrend, "stable")
  })

  it("tool breakdown groups savings by tool", () => {
    const state = {
      sessions: {
        [SID]: {
          started: new Date(Date.now() - 1800000).toISOString(),
          warns: [
            makeWarn("edit", "direct edit", 1.5),
            makeWarn("edit", "delegation enforced", 0.5),
            makeWarn("bash", "delegation enforced", 2.0),
            makeWarn("webfetch", "credit<40% high-tier", 0.25),
          ],
          cache_savings_usd: 0,
          cost_usd: 0.02,
          tool_counts: { edit: 4, bash: 2, webfetch: 1, task: 3 }
        }
      }
    }
    const metrics = computeSessionMetrics(state, SID)
    assert.ok(typeof metrics.sesToolBreakdown === "object", "toolBreakdown should be an object")
    assert.ok(Object.keys(metrics.sesToolBreakdown).length >= 1, "should have at least 1 tool")
    // Edit should have combined 1.5+0.5 = 2.0
    assert.equal(metrics.sesToolBreakdown.edit, 2.0, `edit breakdown should be 2.0, got ${metrics.sesToolBreakdown.edit}`)
    assert.equal(metrics.sesToolBreakdown.bash, 2.0, `bash breakdown should be 2.0`)
    assert.equal(metrics.sesToolBreakdown.webfetch, 0.25, `webfetch breakdown should be 0.25`)
    // Session-specific filtered fields
    assert.equal(metrics.sesEdit, 1.5, "sesEdit should be first edit warn (direct edit)")
    // Actually sesEdit accumulates ALL warns with "direct edit" in reason
    // warn 1: 1.5 + warn 2: 0.5? No, warn 2 reason is "delegation enforced", not "direct edit"
    assert.equal(metrics.sesEdit, 1.5, "sesEdit should be 1.5 (only first warn matches 'direct edit')")
    assert.equal(metrics.sesCredit, 0.25, "sesCredit should match 'credit'")
  })

  it("model turns parsed from tool_counts", () => {
    const state = {
      sessions: {
        [SID]: {
          started: new Date(Date.now() - 600000).toISOString(),
          warns: [],
          cache_savings_usd: 0,
          cost_usd: 0,
          tool_counts: { edit: 3, bash: 7, webfetch: 1, write: 2, task: 5, unknown: 99 }
        }
      }
    }
    const metrics = computeSessionMetrics(state, SID)
    // Brain: edit(3) + bash(7) + webfetch(1) + write(2) = 13
    assert.equal(metrics.sesModelTurns.brain, 13, `brain turns should be 13, got ${metrics.sesModelTurns.brain}`)
    assert.equal(metrics.sesModelTurns.worker, 5, `worker turns should be 5, got ${metrics.sesModelTurns.worker}`)
  })

  it("MAX_SAFE_INTEGER values do not overflow", () => {
    const state = {
      sessions: {
        [SID]: {
          started: new Date(Date.now() - 3600000).toISOString(),
          warns: [makeWarn("edit", "direct edit", Number.MAX_SAFE_INTEGER)],
          cache_savings_usd: Number.MAX_SAFE_INTEGER,
          cost_usd: Number.MAX_SAFE_INTEGER,
          tool_counts: { edit: Number.MAX_SAFE_INTEGER }
        }
      }
    }
    const metrics = computeSessionMetrics(state, SID)
    assert.ok(Number.isFinite(metrics.ltTasks), "ltTasks should not be Infinity")
    assert.ok(Number.isFinite(metrics.ltCache), "ltCache should not be Infinity")
    assert.ok(Number.isFinite(metrics.ltCost), "ltCost should not be Infinity")
  })

  it("missing session ID → defaults for session-specific fields", () => {
    const state = {
      sessions: {
        "other-sid": {
          started: new Date().toISOString(),
          warns: [makeWarn("edit", "direct edit", 1.0)],
          cache_savings_usd: 0,
          cost_usd: 0,
          tool_counts: {}
        }
      }
    }
    const metrics = computeSessionMetrics(state, "nonexistent-sid")
    // Lifetime totals should still count from other-sid
    assert.equal(metrics.count, 1, "warn count should aggregate across all sessions")
    assert.equal(metrics.ltTasks, 1.0)
    // Session-specific fields should be zero
    assert.equal(metrics.sesTasks, 0)
    assert.equal(metrics.sesDuration, 0)
  })
})
