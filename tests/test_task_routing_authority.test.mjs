// SPDX-License-Identifier: MIT
import { test } from "node:test"
import assert from "node:assert/strict"

import { shouldUseLocalTaskRouting } from "../src/lib/hooks/tool-execute.js"

test("task routing uses local ML only when the API is unavailable", () => {
  assert.equal(shouldUseLocalTaskRouting(false, true, null), true)
  assert.equal(shouldUseLocalTaskRouting(false, false, null), true)
  assert.equal(shouldUseLocalTaskRouting(true, false, null), false)
  assert.equal(shouldUseLocalTaskRouting(true, true, null), true)
})

test("task routing keeps backend target authoritative when present", () => {
  assert.equal(shouldUseLocalTaskRouting(true, true, { target: "opencode/big-pickle" }), false)
  assert.equal(shouldUseLocalTaskRouting(false, true, { target: "opencode/big-pickle" }), false)
})
