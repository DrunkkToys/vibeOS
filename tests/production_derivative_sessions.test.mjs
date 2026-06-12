import { test } from "node:test"
import assert from "node:assert/strict"
import { computeSessionMetrics, getSessionCost } from "../src/vibeOS-lib/session-metrics.js"

function makeOptSession(overrides = {}) {
  return {
    warns: [],
    cache_savings_usd: 0,
    cost_usd: 0,
    started: new Date(Date.now() - 86400000).toISOString(),
    ...overrides,
  }
}

function baseState(sessions = {}) {
  return { sessions, lifetime: { total_savings_usd: 0, cache_savings_usd: 0 } }
}

test("1 — primary and _opt session have independent getSessionCost values", () => {
  const state = baseState({
    "sid-1": makeOptSession({ cost_usd: 5.0 }),
    "sid-1_opt": makeOptSession({ cost_usd: 2.5 }),
  })
  assert.equal(getSessionCost(state, "sid-1"), 5.0)
  assert.equal(getSessionCost(state, "sid-1_opt"), 2.5)
  assert.notEqual(getSessionCost(state, "sid-1"), getSessionCost(state, "sid-1_opt"))
})

test("1b — computeSessionMetrics aggregates both primary and _opt into lifetime totals", () => {
  const state = baseState({
    "sid-1": makeOptSession({
      cost_usd: 5.0,
      warns: [{ est_savings_usd: 10 }],
    }),
    "sid-1_opt": makeOptSession({
      cost_usd: 2.5,
      warns: [{ est_savings_usd: 4 }],
    }),
  })
  const m = computeSessionMetrics(state, "sid-1")
  assert.equal(m.ltTasks, 14, "ltTasks = 10 + 4")
  assert.equal(m.ltCost, 7.5, "ltCost = 5.0 + 2.5")
  assert.equal(m.sesTasks, 10, "sesTasks only from sid-1")
})

test("2 — derivative sessions persist in lifetime totals across unrelated sessions", () => {
  const state = baseState({
    "sid-1": makeOptSession({
      cost_usd: 3.0,
      warns: [{ est_savings_usd: 7 }],
    }),
    "sid-1_opt": makeOptSession({
      cost_usd: 1.5,
      warns: [{ est_savings_usd: 3 }],
    }),
    "other-session": makeOptSession({
      cost_usd: 2.0,
      warns: [{ est_savings_usd: 5 }],
    }),
  })
  const m = computeSessionMetrics(state, "sid-1")
  assert.equal(m.ltTasks, 15, "ltTasks = 7 + 3 + 5")
  assert.equal(m.ltCost, 6.5, "ltCost = 3.0 + 1.5 + 2.0")
})

test("3 — cache savings attributed to correct session and aggregated", () => {
  const state = baseState({
    "sid-1": makeOptSession({
      cache_savings_usd: 1.5,
      warns: [{ est_savings_usd: 10 }],
    }),
    "sid-1_opt": makeOptSession({
      cache_savings_usd: 0.75,
      warns: [{ est_savings_usd: 4 }],
    }),
    "other": makeOptSession({
      cache_savings_usd: 2.25,
      warns: [{ est_savings_usd: 6 }],
    }),
  })
  const m = computeSessionMetrics(state, "sid-1")
  assert.equal(m.ltCache, 4.5, "ltCache = 1.5 + 0.75 + 2.25")
  assert.equal(m.ltTasks, 20, "ltTasks = 10 + 4 + 6")

  const mOpt = computeSessionMetrics(state, "sid-1_opt")
  assert.equal(mOpt.sesTasks, 4, "sesTasks from sid-1_opt only")
  assert.equal(mOpt.ltCache, 4.5, "ltCache from all sessions is same")

  const mOther = computeSessionMetrics(state, "other")
  assert.equal(mOther.sesTasks, 6, "sesTasks from other only")
})

test("4 — 500+ sessions with derivatives shows no performance degradation", () => {
  const sessions = {}
  const now = Date.now()
  for (let i = 0; i < 300; i++) {
    sessions[`sess-${i}`] = makeOptSession({
      cost_usd: Math.random() * 10,
      warns: [{ est_savings_usd: Math.random() * 5 }],
      started: new Date(now - (i + 1) * 3600000).toISOString(),
    })
    sessions[`sess-${i}_opt`] = makeOptSession({
      cost_usd: Math.random() * 5,
      warns: [{ est_savings_usd: Math.random() * 3 }],
      started: new Date(now - (i + 1) * 3600000 - 1800000).toISOString(),
    })
  }
  assert.equal(Object.keys(sessions).length, 600, "600 sessions total")

  const state = baseState(sessions)
  const start = performance.now()
  const m = computeSessionMetrics(state, "sess-0")
  const elapsed = performance.now() - start

  assert.ok(elapsed < 200, `computeSessionMetrics completed in ${elapsed.toFixed(1)}ms (expected <200ms)`)
  assert.ok(m.ltTasks > 0, "ltTasks aggregated across 600 sessions")
  assert.ok(m.ltCost > 0, "ltCost aggregated across 600 sessions")
  assert.ok(Number.isFinite(m.ltTasks), "ltTasks is finite")
  assert.ok(Number.isFinite(m.ltCost), "ltCost is finite")
})
