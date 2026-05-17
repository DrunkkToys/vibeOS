import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { aggregateWarns, computeSessionMetrics, getSessionCost } from "../session-metrics.js"

describe("session-metrics (TypeScript smoke + contract)", () => {
  it("exports expected functions", () => {
    assert.equal(typeof computeSessionMetrics, "function")
    assert.equal(typeof getSessionCost, "function")
    assert.equal(typeof aggregateWarns, "function")
  })

  it("computeSessionMetrics returns zeroed defaults for nullish input", () => {
    const m1 = computeSessionMetrics(null, "sid")
    const m2 = computeSessionMetrics(undefined, "sid")
    assert.equal(m1.ltTasks, 0)
    assert.equal(m1.count, 0)
    assert.equal(m1.sesTrend, "stable")
    assert.deepEqual(m1, m2)
  })

  it("getSessionCost reads known session and defaults unknown to 0", () => {
    const state = {
      sessions: {
        "sid-1": { cost_usd: 1.25 },
      },
    }
    assert.equal(getSessionCost(state, "sid-1"), 1.25)
    assert.equal(getSessionCost(state, "missing"), 0)
  })

  it("aggregateWarns sums est_savings_usd and supports filter", () => {
    const warns = [
      { tool: "edit", reason: "direct edit", est_savings_usd: 1.5 },
      { tool: "bash", reason: "delegation", est_savings_usd: 0.5 },
    ]
    assert.equal(aggregateWarns(warns), 2)
    assert.equal(aggregateWarns(warns, w => Boolean(w.reason?.includes("direct"))), 1.5)
    assert.equal(aggregateWarns(null), 0)
  })
})
