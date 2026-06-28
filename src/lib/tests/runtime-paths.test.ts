import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as paths from "../runtime-paths.js"

describe("runtime-paths", () => {
  beforeEach(() => {
    delete process.env.VIBEOS_HOME
    delete process.env.VIBEOS_OPENCODE_HOME
    delete process.env.OPENCODE_HOME
    paths.resetRuntimePathsForTest()
  })

  it("tracks the vibeOS home through the explicit context helper", () => {
    const home = "/tmp/vibeos-home-test"
    paths.setVibeOSHomeContext(home)
    assert.equal(paths.getVibeOSHome(), home)
  })

  it("prefers the explicit opencode override", () => {
    process.env.OPENCODE_HOME = "/tmp/opencode-home"
    assert.equal(paths.getOpenCodeHome(), "/tmp/opencode-home")
    assert.deepEqual(paths.getOpenCodeHomes(), ["/tmp/opencode-home"])
  })
})
