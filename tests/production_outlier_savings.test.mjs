import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { computeSessionMetrics, aggregateWarns, getSessionCost } from "../src/vibeOS-lib/session-metrics.js"
import { buildFooterLine, resolveBrand, formatModeLabel, formatEnforcementPulse, resolveTierIcon } from "../src/lib/hooks/shared-footer.js"

describe("production: outlier savings values", () => {
  it("handles $20 outlier savings correctly", () => {
    const warns = [
      { tool: "write", reason: "delegation enforced", est_savings_usd: 20.00 },
    ]
    const state = {
      sessions: {
        "sid-1": { warns },
      },
      lifetime: { total_savings_usd: 20.00, cache_savings_usd: 0, missed_context7_usd: 0 },
    }
    const metrics = computeSessionMetrics(state, "sid-1")
    assert.equal(metrics.ltTasks, 20)
    assert.equal(metrics.sesTasks, 20)
    assert.equal(metrics.count, 1)
    assert.ok(Number.isFinite(metrics.ltTasks))
  })

  it("applies pricing cap without overflow (A10)", () => {
    const warns = [
      { tool: "write", reason: "delegation enforced", est_savings_usd: 999999 },
      { tool: "edit", reason: "direct edit", est_savings_usd: 999999 },
    ]
    const total = aggregateWarns(warns)
    assert.equal(total, 1999998)
    assert.ok(Number.isFinite(total))
    assert.ok(!Number.isNaN(total))
    assert.ok(total !== Infinity)

    const state = {
      sessions: {
        "sid-1": { warns },
      },
      lifetime: { total_savings_usd: 1999998, cache_savings_usd: 0, missed_context7_usd: 0 },
    }
    const metrics = computeSessionMetrics(state, "sid-1")
    assert.equal(metrics.ltTasks, 1999998)
    assert.ok(Number.isFinite(metrics.ltTasks))
    assert.ok(!Number.isNaN(metrics.ltTasks))
    assert.ok(metrics.ltTasks !== Infinity)
  })

  it("enforces $0.0001 minimum rounding (A12)", () => {
    const warns = [
      { tool: "bash", reason: "delegation enforced", est_savings_usd: 0.00005 },
    ]
    const raw = aggregateWarns(warns)
    assert.equal(raw, 0.00005)
    const state = {
      sessions: {
        "sid-1": { warns },
      },
      lifetime: { total_savings_usd: 0.00005, cache_savings_usd: 0, missed_context7_usd: 0 },
    }
    const metrics = computeSessionMetrics(state, "sid-1")
    // ltTasks rounds to 4 decimals: Math.round(0.00005 * 10000) / 10000 = 0.0001
    assert.equal(metrics.ltTasks, 0.0001)
    assert.equal(metrics.sesTasks, 0.00005)
    assert.ok(Number.isFinite(metrics.ltTasks))
  })

  it("sets quality-related fields to 0 when no quality data exists (A13)", () => {
    const warns = [
      { tool: "bash", reason: "delegation enforced", est_savings_usd: 0.01 },
    ]
    const state = {
      sessions: {
        "sid-1": { warns },
      },
      lifetime: { total_savings_usd: 0.01, cache_savings_usd: 0, missed_context7_usd: 0 },
    }
    const metrics = computeSessionMetrics(state, "sid-1")
    assert.equal(metrics.sesEdit, 0)
    assert.equal(metrics.sesCredit, 0)
    assert.equal(metrics.sesC7, 0)
    assert.equal(metrics.sesQuota, 0)
    assert.ok(Number.isFinite(metrics.sesEdit))
    assert.ok(Number.isFinite(metrics.sesCredit))
    assert.ok(Number.isFinite(metrics.sesC7))
    assert.ok(Number.isFinite(metrics.sesQuota))
  })

  it("handles mixed magnitude savings spanning 4 orders of magnitude", () => {
    const warns = [
      { tool: "write", reason: "delegation enforced", est_savings_usd: 20 },
      { tool: "edit", reason: "direct edit", est_savings_usd: 0.50 },
      { tool: "bash", reason: "delegation enforced", est_savings_usd: 0.003 },
      { tool: "read", reason: "context7", est_savings_usd: 0.0001 },
    ]
    const total = aggregateWarns(warns)
    assert.equal(total, 20.5031)
    const state = {
      sessions: {
        "sid-1": { warns },
      },
      lifetime: { total_savings_usd: 20.5031, cache_savings_usd: 0, missed_context7_usd: 0 },
    }
    const metrics = computeSessionMetrics(state, "sid-1")
    assert.equal(metrics.ltTasks, 20.5031)
    assert.equal(metrics.sesTasks, 20.5031)
    assert.equal(metrics.sesEdit, 0.50)
    assert.equal(metrics.sesC7, 0.0001)
  })

  it("does not break on negative est_savings_usd values", () => {
    const warns = [
      { tool: "write", reason: "delegation enforced", est_savings_usd: -5.0 },
      { tool: "edit", reason: "direct edit", est_savings_usd: -0.001 },
    ]
    const total = aggregateWarns(warns)
    assert.equal(total, -5.001)
    assert.ok(Number.isFinite(total))

    const state = {
      sessions: {
        "sid-1": { warns },
      },
      lifetime: { total_savings_usd: 0, cache_savings_usd: 0, missed_context7_usd: 0 },
    }
    const metrics = computeSessionMetrics(state, "sid-1")
    assert.ok(Number.isFinite(metrics.ltTasks))
    assert.ok(Number.isFinite(metrics.sesTasks))
    assert.ok(Number.isFinite(metrics.sesEdit))
    assert.ok(Number.isFinite(metrics.ltCache))
    assert.ok(Number.isFinite(metrics.ltCost))
  })

  it("legacy lifetime delegation is used when larger than computed sum", () => {
    const warns = [
      { tool: "bash", reason: "delegation enforced", est_savings_usd: 0.01 },
    ]
    const state = {
      sessions: {
        "sid-1": { warns },
      },
      lifetime: { total_savings_usd: 20.00, cache_savings_usd: 0, missed_context7_usd: 0 },
    }
    const metrics = computeSessionMetrics(state, "sid-1")
    // ltTasks uses Math.max(computedSum(0.01), legacyLifetime(20.00))
    assert.equal(metrics.ltTasks, 20.00)
  })

  it("shared-footer imports work with extreme outlier values", () => {
    const brand = resolveBrand("quality", "brain")
    assert.equal(brand, "VibeQMaX")

    const label = formatModeLabel("quality")
    assert.equal(label, "Quality")

    const icon = resolveTierIcon("brain")
    assert.ok(typeof icon === "string")

    const pulse = formatEnforcementPulse(["[ENF ON]", "[FLOW ON]"])
    assert.equal(pulse, "guarded · flow steady")
  })

  it("getSessionCost returns 0 for sessions without cost data", () => {
    const state = {
      sessions: {
        "sid-1": { warns: [] },
      },
    }
    const cost = getSessionCost(state, "sid-1")
    assert.equal(cost, 0)
    assert.ok(Number.isFinite(cost))
  })
})
