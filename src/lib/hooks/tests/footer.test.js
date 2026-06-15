// SPDX-License-Identifier: MIT
import { test, describe } from "node:test"
import assert from "node:assert/strict"

test("footer module exports", async () => {
  const mod = await import("../footer.js")
  assert.equal(typeof mod._appendFooter, "function")
  assert.ok(mod)
})
