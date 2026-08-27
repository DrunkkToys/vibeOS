// SPDX-License-Identifier: MIT
//
// A connected backend that answers /api/v1/mode/classify with a 200 carrying no tier
// used to silently disable ML cascade routing. The response object was truthy, so it
// was accepted as authoritative; every tier field on it was undefined, so the session's
// resolved_tier was written as undefined and vanished on serialize; ultraXPrimarySlot
// needs that verdict and returns null without one, so vibeultrax stayed pinned to the
// envelope's entry slot for the whole session and never escalated. The local difficulty
// estimate that exists for exactly this case was unreachable, because it only ran when
// the API was disconnected -- not when it was connected and useless.
//
// These tests pin the two halves of the repair: a tier-less response yields no tier,
// and a session with no tier still escalates once the local estimate supplies one.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const { tierFromClassifyResponse, ultraXPrimarySlot } = await import("../src/lib/hooks/chat-transform.js")
const { computeDifficulty } = await import("../src/vibeOS-lib/ml-router.js")

test("a tier-less classify response yields no tier", () => {
  // The exact body scripts/e2e/mock.mjs used to return for every /api/v1/mode/ route.
  assert.equal(tierFromClassifyResponse({ ok: true }), null)
  assert.equal(tierFromClassifyResponse({}), null)
  assert.equal(tierFromClassifyResponse(null), null)
  assert.equal(tierFromClassifyResponse(undefined), null)
  assert.equal(tierFromClassifyResponse("ok"), null)
  assert.equal(tierFromClassifyResponse({ resolved_tier: "" }), null)
  assert.equal(tierFromClassifyResponse({ resolved_tier: "nonsense" }), null)
})

test("a real classify response yields its tier, in the documented precedence", () => {
  assert.equal(tierFromClassifyResponse({ resolved_tier: "brain" }), "brain")
  assert.equal(tierFromClassifyResponse({ resolved_tier: "BRAIN" }), "brain")
  assert.equal(tierFromClassifyResponse({ tier: "medium" }), "medium")
  assert.equal(tierFromClassifyResponse({ entry_tier: "cheap" }), "cheap")
  // resolved_tier outranks the web_search/loop_break force, which outranks tier/entry_tier.
  assert.equal(tierFromClassifyResponse({ resolved_tier: "cheap", web_search: true }), "cheap")
  assert.equal(tierFromClassifyResponse({ web_search: true, tier: "cheap" }), "brain")
  assert.equal(tierFromClassifyResponse({ loop_break: true, tier: "cheap" }), "brain")
  // An unusable value in a higher-precedence field must not shadow a usable lower one.
  assert.equal(tierFromClassifyResponse({ resolved_tier: "nonsense", tier: "medium" }), "medium")
})

test("the local estimate covers what a tier-less response leaves behind", () => {
  const prompt = "Refactor the cascade router to share one difficulty scorer across the "
    + "chat-transform and tool-execute hooks, keep the envelope clamp intact, and prove "
    + "with tests that no watched config file is written mid-turn."
  assert.equal(tierFromClassifyResponse({ ok: true }), null, "precondition: API gives nothing")
  const { suggestedTier } = computeDifficulty(prompt)
  assert.ok(["cheap", "medium", "brain"].includes(suggestedTier))
  // The estimate is always one of the three slots, so the fallback can never itself
  // re-create the undefined-verdict hole this test exists to close.
})

test("a verdict is what makes vibeultrax escalate off its entry slot", () => {
  const sel = { optimization_mode: "vibeultrax", active_slot: "cheap", axis_overrides: {} }
  const envelope = ["cheap", "medium", "brain"]
  // The broken state: no verdict, so the primary stays on cheap forever.
  assert.equal(ultraXPrimarySlot(sel, tierFromClassifyResponse({ ok: true }), envelope), null)
  // The repaired state: any verdict the local estimate can produce moves the primary.
  assert.equal(ultraXPrimarySlot(sel, "brain", envelope), "brain")
  assert.equal(ultraXPrimarySlot(sel, "medium", envelope), "medium")
})

test("the hook falls through to the local estimate on a tier-less response", () => {
  const src = readFileSync(join(ROOT, "src/lib/hooks/chat-transform.ts"), "utf8")
  const start = src.indexOf("const cascadeData = await client.classify(")
  assert.ok(start >= 0, "classify call must exist")
  const body = src.slice(start, start + 2600)
  assert.ok(/tierFromClassifyResponse\(/.test(body),
    "the classify response must be read through tierFromClassifyResponse")
  assert.ok(!/if \(cascadeData\) \{/.test(body),
    "a bare truthiness check on the response is what accepted {ok:true} as authoritative")
  // The local branch must not be gated behind the API being disconnected any more.
  assert.ok(!/\} else if \(latestUserIntent\) \{/.test(body),
    "the local estimate must run whenever no tier was resolved, not only when the API is down")
  assert.ok(/computeDifficulty\(latestUserIntent\)/.test(body),
    "the local estimate must still derive its tier from the shared difficulty scorer")
})

test("the e2e mock answers mode/classify with a real tier", () => {
  const mock = readFileSync(join(ROOT, "scripts/e2e/mock.mjs"), "utf8")
  const idx = mock.indexOf('"/api/v1/mode/classify"')
  assert.ok(idx >= 0, "mock must handle /api/v1/mode/classify explicitly")
  const catchAll = mock.indexOf("blackbox|vibemax|mode|stress")
  assert.ok(catchAll < 0 || idx < catchAll,
    "the explicit classify route must precede the catch-all that returns {ok:true}")
  assert.ok(/resolved_tier/.test(mock), "the mock response must carry resolved_tier")
})
