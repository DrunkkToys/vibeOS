import test from "node:test"
import assert from "node:assert/strict"
import * as mod from "../footer.js"

test("footer hook exports the live helpers", () => {
  assert.equal(typeof mod._appendFooter, "function")
  assert.equal(typeof mod.scoreTaskQuality, "function")
  assert.equal(typeof mod.readRewardSignals, "function")
})
