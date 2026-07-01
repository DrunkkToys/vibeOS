// SPDX-License-Identifier: MIT
// Phase 4 contract: mode-policy auto-switcher is deleted.
// This test FAILS before deletion (module exists) and PASSES after (module gone).
import { test } from "node:test"
import assert from "node:assert/strict"

test("mode-policy module does not exist — auto-switcher removed", async () => {
  let threw = false
  try {
    await import("../src/lib/mode-policy.js?phase4=" + Date.now())
  } catch {
    threw = true
  }
  assert.ok(threw, "mode-policy.js must not exist after Phase 4 deletion")
})
