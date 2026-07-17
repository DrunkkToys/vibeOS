// SPDX-License-Identifier: MIT
// Live-reproduced on a real dev machine: chat-params.ts already computes and
// persists cheap_first_degraded/cheap_first_reason correctly whenever the
// configured trinity model for a slot is on a different provider than the
// live primary model (e.g. trinity.cheap = "opencode/big-pickle" but the
// live primary agent is bound to "deepseek/deepseek-chat") -- in that state
// the free same-provider param-switch path is unusable and every turn is
// forced through the more expensive cross-provider Task-delegation route.
// trinity-tool.ts already read this signal for `vibe status`/diagnose, but
// the automatic footer never did, so a user paying for cross-provider
// delegation on every single turn saw the footer say "cheap" with no
// indication their cost-saving path was structurally disabled.

import test from "node:test"
import assert from "node:assert/strict"

test("buildFooterAlert surfaces cheap_first_degraded as a visible cross-provider warning", async () => {
  const footer = await import("../src/lib/hooks/footer.js?cheapfirst1=" + Date.now())
  const alert = footer.buildFooterAlert({ cheapFirstDegraded: true })
  assert.match(alert, /cross-provider/i)
})

test("buildFooterAlert stays silent when cheap-first routing is healthy", async () => {
  const footer = await import("../src/lib/hooks/footer.js?cheapfirst2=" + Date.now())
  const alert = footer.buildFooterAlert({ cheapFirstDegraded: false })
  assert.doesNotMatch(alert, /cross-provider/i)
})
