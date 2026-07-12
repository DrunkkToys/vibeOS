import { describe, it } from "node:test"
import assert from "node:assert/strict"

const mod = await import("../blackbox/resolution-tracker.js?ci-poll=" + Date.now())

describe("ResolutionTracker — CI-wait polling must not be misclassified as LOOPING", () => {
  it("does not flag two routine gh pr checks polls while waiting for CI as looping", () => {
    const tracker = new mod.ResolutionTracker("test-session-ci-wait")
    const activity = { tool: "bash", target: "gh pr checks 427" }
    let state
    state = tracker.update("gh pr checks 427", {}, "act", 0.5, 50, null, activity)
    state = tracker.update("gh pr checks 427", {}, "act", 0.5, 50, null, activity)

    assert.notEqual(
      state.sub_regime,
      "LOOPING",
      "two routine CI-status polls while waiting for CI is normal workflow, not a stuck loop",
    )
    assert.equal(state.is_looping, false)
  })

  it("still flags genuinely runaway CI polling (many repeats) as looping", () => {
    const tracker = new mod.ResolutionTracker("test-session-ci-runaway")
    const activity = { tool: "bash", target: "gh pr checks 427" }
    let state
    for (let i = 0; i < 6; i++) {
      state = tracker.update("gh pr checks 427", {}, "act", 0.5, 50, null, activity)
    }

    assert.equal(state.is_looping, true, "sustained repeated polling must still be caught as a runaway loop")
    assert.equal(state.loop_detector_kind, "poll-repeat")
  })
})
