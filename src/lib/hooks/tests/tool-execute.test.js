import test from "node:test"
import assert from "node:assert/strict"
import * as mod from "../tool-execute.js"

test("tool-execute hook exports the live helpers", () => {
  assert.equal(typeof mod.onToolExecuteBefore, "function")
  assert.equal(typeof mod.onToolExecuteAfter, "function")
})
