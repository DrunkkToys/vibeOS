import { describe, it } from "node:test"
import assert from "node:assert/strict"

const state = await import("../state.js?record-recent-tool-event=" + Date.now())

describe("recordRecentToolEvent — wires real tool/target into recentToolEvents (loop detector data path)", () => {
  it("is exported as a function from state.ts", () => {
    assert.equal(typeof state.recordRecentToolEvent, "function", "recordRecentToolEvent must be exported from state.ts")
  })

  it("pushes tool and target extracted from tool args onto recentToolEvents", () => {
    const before = state.recentToolEvents.length
    state.recordRecentToolEvent("bash", { command: "npm test" })
    const events = state.recentToolEvents
    assert.equal(events.length, before + 1, "recentToolEvents must grow by one")
    const last = events[events.length - 1]
    assert.equal(last.tool, "bash")
    assert.equal(last.target, "npm test")
    assert.ok(typeof last.at === "number")
  })

  it("extracts target from filePath for file-based tools", () => {
    state.recordRecentToolEvent("read", { filePath: "/tmp/foo.ts" })
    const last = state.recentToolEvents[state.recentToolEvents.length - 1]
    assert.equal(last.tool, "read")
    assert.equal(last.target, "/tmp/foo.ts")
  })

  it("caps recentToolEvents at 20 entries", () => {
    for (let i = 0; i < 25; i++) state.recordRecentToolEvent("bash", { command: `cmd-${i}` })
    assert.ok(state.recentToolEvents.length <= 20, "recentToolEvents must not grow unbounded")
  })
})
