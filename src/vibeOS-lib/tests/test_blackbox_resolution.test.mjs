import test from "node:test"
import assert from "node:assert/strict"
import { ResolutionTracker } from "../blackbox/resolution-tracker.js"

test("ResolutionTracker — INIT state on first update", () => {
  const tracker = new ResolutionTracker("test-session")
  const state = tracker.update("I'm thinking about something", { info: 0.5, time: 0.3 }, "explore", 1.0, 50)
  assert.equal(state.sub_regime, "INIT")
  assert.equal(state.n_interactions, 1)
})

test("ResolutionTracker — tracks multiple interactions", () => {
  const tracker = new ResolutionTracker("test-session")
  tracker.update("msg1", { info: 0.5 }, "explore", 1.0, 50)
  tracker.update("msg2", { info: 0.6 }, "explore", 0.9, 45)
  tracker.update("msg3", { info: 0.7 }, "act", 0.7, 35)
  const state = tracker.snapshot()
  assert.equal(state.n_interactions, 3)
})

test("ResolutionTracker — respects maxHistory", () => {
  const tracker = new ResolutionTracker("test-session", 3)
  for (let i = 0; i < 10; i++) {
    tracker.update(`msg${i}`, { info: 0.5 }, "explore", 1.0, 50)
  }
  const state = tracker.snapshot()
  assert.ok(state.n_interactions <= 3)
})

test("ResolutionTracker — detects looping", () => {
  const tracker = new ResolutionTracker("test-session")
  const repeatedText = "I keep going back and forth on this same decision over and over again"
  tracker.update("first message here with some words", { info: 0.5 }, "defer", 1.5, 70)
  tracker.update(repeatedText, { info: 0.5 }, "defer", 1.5, 70)
  tracker.update("third different message here with other words", { info: 0.6 }, "explore", 1.4, 65)
  tracker.update("fourth another unrelated thing to consider now", { info: 0.55 }, "defer", 1.3, 60)
  tracker.update(repeatedText, { info: 0.5 }, "defer", 1.5, 70)
  const state = tracker.snapshot()
  assert.equal(state.is_looping, true)
})

test("ResolutionTracker — converging state with consistent actions", () => {
  const tracker = new ResolutionTracker("test-session")
  tracker.update("looking at options", { info: 0.5 }, "explore", 1.2, 50)
  tracker.update("narrowing down", { info: 0.6 }, "explore", 1.0, 45)
  tracker.update("almost decided", { info: 0.7 }, "act", 0.8, 35)
  tracker.update("ready to go", { info: 0.8 }, "act", 0.6, 25)
  tracker.update("doing it now", { info: 0.9 }, "act", 0.4, 20)
  const state = tracker.snapshot()
  assert.ok(["CONVERGING", "CLOSED", "REFINING"].includes(state.sub_regime))
})

test("ResolutionTracker — reset clears history", () => {
  const tracker = new ResolutionTracker("test-session")
  tracker.update("msg1", { info: 0.5 }, "explore", 1.0, 50)
  tracker.reset()
  const state = tracker.snapshot()
  assert.equal(state.n_interactions, 0)
  assert.equal(state.sub_regime, "INIT")
})

test("ResolutionTracker — serialize/deserialize roundtrip", () => {
  const tracker = new ResolutionTracker("test-session")
  tracker.update("msg1", { info: 0.5 }, "explore", 1.0, 50)
  tracker.update("msg2", { info: 0.6 }, "act", 0.8, 35)
  const serialized = tracker.serialize()
  const restored = ResolutionTracker.deserialize(serialized)
  const state = restored.snapshot()
  assert.equal(state.n_interactions, 2)
  assert.equal(restored.sessionId, "test-session")
})

test("ResolutionTracker — getHistory returns entries", () => {
  const tracker = new ResolutionTracker("test-session")
  tracker.update("msg1", { info: 0.5 }, "explore", 1.0, 50)
  tracker.update("msg2", { info: 0.6 }, "act", 0.8, 35)
  const history = tracker.getHistory()
  assert.equal(history.length, 2)
  assert.equal(history[0].text, "msg1")
  assert.equal(history[1].text, "msg2")
})

test("ResolutionTracker — detectOverconfident static method", () => {
  assert.equal(ResolutionTracker.detectOverconfident({ confidence: 0.8, entropy: 1.6 }), true)
  assert.equal(ResolutionTracker.detectOverconfident({ confidence: 0.5, entropy: 1.0 }), false)
  assert.equal(ResolutionTracker.detectOverconfident({ confidence: 0.9, entropy: 0.3 }), false)
})

test("ResolutionTracker — momentum calculation", () => {
  const tracker = new ResolutionTracker("test-session")
  tracker.update("msg1", { info: 0.5 }, "explore", 1.2, 50)
  tracker.update("msg2", { info: 0.6 }, "explore", 1.0, 45)
  tracker.update("msg3", { info: 0.7 }, "act", 0.8, 35)
  const state = tracker.snapshot()
  assert.ok(state.momentum >= -1.0 && state.momentum <= 1.0)
})

test("ResolutionTracker — looping has negative momentum", () => {
  const tracker = new ResolutionTracker("test-session")
  const repeatedText = "I keep going back and forth on this same decision over and over again"
  tracker.update("first message here with some words", { info: 0.5 }, "defer", 1.5, 70)
  tracker.update(repeatedText, { info: 0.5 }, "defer", 1.5, 70)
  tracker.update("third different message here with other words", { info: 0.6 }, "explore", 1.4, 65)
  tracker.update("fourth another unrelated thing to consider now", { info: 0.55 }, "defer", 1.3, 60)
  tracker.update(repeatedText, { info: 0.5 }, "defer", 1.5, 70)
  const state = tracker.snapshot()
  assert.equal(state.is_looping, true)
  assert.ok(state.momentum < 0)
})

test("ResolutionTracker — continuity state calculation", () => {
  const tracker = new ResolutionTracker("test-session")
  for (let i = 0; i < 5; i++) {
    tracker.update(`consistent message ${i}`, { info: 0.7 }, "act", 0.5, 25)
  }
  const state = tracker.snapshot()
  assert.ok(["HIGH", "MEDIUM", "LOW"].includes(state.continuity_state))
})
