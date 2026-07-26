// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-cascade-cost-"))
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })

import {
  setTrinityBrain,
  setTrinityMedium,
  setTrinityCheap,
  _resetTrinitySlotsForTest,
} from "../../lib/pricing.js"
import { cascadeCostInputs } from "../blackbox/vibeultrax.js"
import { computeSlotSuccessRate, ResolutionTracker } from "../blackbox/resolution-tracker.js"
import { saveBlackboxState } from "../../lib/state.js"

describe("cascadeCostInputs — real per-turn cost instead of hardcoded constants", () => {
  after(() => {
    _resetTrinitySlotsForTest()
  })

  it("uses the real modelCostPerTurn value once trinity slots are configured", () => {
    setTrinityCheap("deepseek/deepseek-v4-flash")
    setTrinityMedium("deepseek/deepseek-chat")
    setTrinityBrain("deepseek/deepseek-v4-pro")

    const costs = cascadeCostInputs()

    // Real prices from pricing.ts's cost map -- distinct from the previous
    // hardcoded CHEAP=0.0001 / BRAIN=0.01 constants passed unconditionally
    // to cascadeDecide() regardless of what models were actually configured.
    assert.equal(costs.cheap, 0.000182)
    assert.equal(costs.brain, 0.00057)
    assert.notEqual(costs.cheap, 0.0001)
    assert.notEqual(costs.brain, 0.01)
  })

  it("falls back to the fixed constants when no trinity slot is configured", () => {
    _resetTrinitySlotsForTest()
    const costs = cascadeCostInputs()
    assert.equal(costs.cheap, 0.0001)
    assert.equal(costs.medium, 0.001)
    assert.equal(costs.brain, 0.01)
  })
})

describe("computeSlotSuccessRate — real empirical success rate per tier", () => {
  it("falls back to the default rate with fewer than 5 samples for that slot", () => {
    saveBlackboxState({
      enabled: true,
      sessions: {
        s1: { outcomeHistory: [{ turn: 1, outcome: "positive", slot: "cheap" }] },
      },
    })
    assert.equal(computeSlotSuccessRate("cheap"), 0.85)
  })

  it("computes the real positive ratio once there is enough data for that slot", () => {
    saveBlackboxState({
      enabled: true,
      sessions: {
        s1: {
          outcomeHistory: [
            { turn: 1, outcome: "positive", slot: "cheap" },
            { turn: 2, outcome: "positive", slot: "cheap" },
            { turn: 3, outcome: "negative", slot: "cheap" },
            { turn: 4, outcome: "positive", slot: "cheap" },
            { turn: 5, outcome: "positive", slot: "cheap" },
            // Different slot: must not be counted toward "cheap"'s ratio.
            { turn: 6, outcome: "negative", slot: "brain" },
          ],
        },
      },
    })
    // 4 positive out of 5 cheap-tagged entries = 0.8, not the 0.85 default.
    assert.equal(computeSlotSuccessRate("cheap"), 0.8)
  })

  it("ignores untagged legacy outcome entries that predate slot tagging", () => {
    saveBlackboxState({
      enabled: true,
      sessions: {
        s1: {
          outcomeHistory: [
            { turn: 1, outcome: "positive" },
            { turn: 2, outcome: "positive" },
            { turn: 3, outcome: "positive" },
            { turn: 4, outcome: "positive" },
            { turn: 5, outcome: "positive" },
          ],
        },
      },
    })
    assert.equal(computeSlotSuccessRate("cheap"), 0.85)
  })
})

describe("ResolutionTracker.recordOutcome — tags the active slot", () => {
  it("stores the slot passed alongside the outcome", () => {
    const rt = new ResolutionTracker("cost-inputs-test", 12)
    rt.history.push({ text: "did it work?" })
    rt.recordOutcome("positive", "cheap")
    const last = rt.outcomeHistory[rt.outcomeHistory.length - 1]
    assert.equal(last.outcome, "positive")
    assert.equal(last.slot, "cheap")
  })

  it("omits the slot field when none is provided (backward compatible)", () => {
    const rt = new ResolutionTracker("cost-inputs-test-2", 12)
    rt.history.push({ text: "did it work?" })
    rt.recordOutcome("positive")
    const last = rt.outcomeHistory[rt.outcomeHistory.length - 1]
    assert.equal(last.outcome, "positive")
    assert.equal("slot" in last, false)
  })
})
