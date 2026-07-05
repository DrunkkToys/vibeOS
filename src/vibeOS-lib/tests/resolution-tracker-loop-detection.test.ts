import { describe, it } from "node:test"
import assert from "node:assert/strict"

const mod = await import("../blackbox/resolution-tracker.js?loop-detection=" + Date.now())

describe("ResolutionTracker — tool/target repetition loop detection", () => {
  it("escalates loop_intervention_level when the same tool+target repeats on non-inspection (mutation) activity", () => {
    const tracker = new mod.ResolutionTracker("test-session")
    const activity = { tool: "edit", target: "src/auth.ts" }
    let state
    state = tracker.update("fixing the auth bug", {}, "act", 0.5, 50, null, activity)
    state = tracker.update("still fixing the auth bug", {}, "act", 0.5, 50, null, activity)
    state = tracker.update("trying to fix the auth bug again", {}, "act", 0.5, 50, null, activity)

    assert.ok(state.target_repeat_streak >= 2, `expected target_repeat_streak >= 2, got ${state.target_repeat_streak}`)
    assert.ok(state.activity_repeat_streak >= 2, `expected activity_repeat_streak >= 2, got ${state.activity_repeat_streak}`)
    assert.notEqual(state.loop_intervention_level, "none", "loop_intervention_level must escalate past none")
  })

  it("does NOT accumulate a target repeat streak when tool/target are null (current dead-data-path bug)", () => {
    const tracker = new mod.ResolutionTracker("test-session-2")
    const nullActivity = { tool: null, target: null }
    let state
    state = tracker.update("fixing the auth bug", {}, "act", 0.5, 50, null, nullActivity)
    state = tracker.update("still fixing the auth bug", {}, "act", 0.5, 50, null, nullActivity)
    state = tracker.update("trying to fix the auth bug again", {}, "act", 0.5, 50, null, nullActivity)

    assert.equal(state.target_repeat_streak, 0, "null target must never accumulate a repeat streak")
  })
})
