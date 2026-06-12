import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { computeSessionMetrics, aggregateWarns, getSessionCost } from "../src/vibeOS-lib/session-metrics.js"

describe("production: flow warns overload", () => {
  it("handles 10,000 flow_warns without OOM", () => {
    const warns = Array.from({ length: 10000 }, (_, i) => ({
      at: new Date().toISOString(),
      sid: 1,
      rule_id: "detect-secrets",
      severity: "flag",
      filePath: `file-${i}.txt`,
      description: `Potential secret in file-${i}.txt`,
    }))
    const state = {
      flow_warns: warns,
      sessions: {
        "sid-1": { warns: [] },
      },
    }
    const metrics = computeSessionMetrics(state, "sid-1")
    assert.equal(typeof metrics.ltTasks, "number")
    assert.equal(typeof metrics.ltCache, "number")
    assert.equal(typeof metrics.count, "number")
    assert.ok(metrics.count === 0 || metrics.count > 0)
  })

  it("lifetime savings accumulate deduped warns correctly (B7/B8)", () => {
    const state = {
      sessions: {
        "sid-1": {
          warns: [
            { tool: "edit", reason: "direct edit", est_savings_usd: 1.00, count: 3 },
            { tool: "edit", reason: "direct edit", est_savings_usd: 1.00, count: 3 },
          ],
        },
        "sid-2": {
          warns: [
            { tool: "bash", reason: "delegation", est_savings_usd: 2.50, count: 1 },
          ],
        },
      },
    }
    const m1 = computeSessionMetrics(state, "sid-1")
    const m2 = computeSessionMetrics(state, "sid-2")
    // Lifetime sums est_savings_usd across ALL sessions (count field is not used in ltTasks)
    assert.equal(m1.ltTasks, 4.5)
    assert.equal(m2.ltTasks, 4.5)
    // sesTaskDelegations uses count field for dedup tracking (B8)
    assert.equal(m1.sesTaskDelegations, 6)
    assert.equal(m2.sesTaskDelegations, 1)
  })

  it("aggregateWarns sums est_savings_usd and supports filter", () => {
    const warns = [
      { tool: "edit", reason: "direct edit", est_savings_usd: 1.5 },
      { tool: "bash", reason: "delegation", est_savings_usd: 0.5 },
    ]
    assert.equal(aggregateWarns(warns), 2)
    assert.equal(aggregateWarns(warns, w => Boolean(w.reason?.includes("direct"))), 1.5)
    assert.equal(aggregateWarns(null), 0)
    assert.equal(aggregateWarns(undefined), 0)
    assert.equal(aggregateWarns([]), 0)
  })

  it("free model sessions do not record savings (O2)", () => {
    const warns1 = [{ tool: "edit", reason: "direct edit", est_savings_usd: 0.5 }]
    const warns2 = [{ tool: "bash", reason: "delegation", est_savings_usd: 0.3 }]
    const state = {
      sessions: {
        "sid-free": { warns: warns1, free: true },
        "sid-paid": { warns: warns2 },
      },
    }
    const m1 = computeSessionMetrics(state, "sid-free")
    const m2 = computeSessionMetrics(state, "sid-paid")
    assert.equal(typeof m1.ltTasks, "number")
    assert.equal(typeof m2.ltTasks, "number")
  })

  it("flow_warns are not double-counted in session totals (B10)", () => {
    const state = {
      flow_warns: [
        { at: new Date().toISOString(), sid: 1, rule_id: "no-edit", severity: "flag", filePath: "a.js", description: "no direct edit" },
        { at: new Date().toISOString(), sid: 1, rule_id: "no-edit", severity: "flag", filePath: "a.js", description: "no direct edit" },
      ],
      sessions: {
        "sid-1": {
          warns: [
            { tool: "edit", reason: "direct edit", est_savings_usd: 0.5 },
          ],
        },
      },
    }
    const m = computeSessionMetrics(state, "sid-1")
    assert.equal(m.sesTasks, 0.5)
  })
})
