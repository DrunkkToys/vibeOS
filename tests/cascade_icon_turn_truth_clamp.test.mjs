// SPDX-License-Identifier: MIT
// Regression test for the live-observed bug: footer showed "▸▸▸" (brain-depth
// cascade icon) while the model badge still showed "cheap | Big Pickle".
// Root cause: the footer's cascadeDepth was read straight from blackbox
// control_vector.cascade_depth -- a planned ROUTE that may never have been
// confirmed to execute -- instead of being corroborated against turn-ledger's
// actual per-turn history. clampCascadeDepthToTurnTruth() is the fix.

import test from "node:test"
import assert from "node:assert/strict"

test("clampCascadeDepthToTurnTruth clamps an unconfirmed brain route to the live active tier", async () => {
  const te = await import("../src/lib/hooks/tool-execute.js?turntruth1=" + Date.now())

  // Exact live scenario: control vector says cascade_depth=3 (brain), but no
  // turn in the ledger ever confirms a delegation contributed to the final
  // answer -- the plan was dispatched (or never dispatched) but not executed.
  const rawCascadeDepth = 3
  const activeSlotDepth = 0 // live model is cheap
  const turns = [
    {
      finalized: null,
      executedRoute: { contributedToFinalAnswer: false, cascadeDepth: 3 },
    },
  ]

  const result = te.clampCascadeDepthToTurnTruth(rawCascadeDepth, activeSlotDepth, turns)
  assert.equal(result, 0, "unconfirmed brain route must not inflate the icon past the live cheap tier")
})

test("clampCascadeDepthToTurnTruth trusts a confirmed finalized depth", async () => {
  const te = await import("../src/lib/hooks/tool-execute.js?turntruth2=" + Date.now())

  const turns = [
    { finalized: { cascadeDepth: 2 }, executedRoute: null },
  ]

  const result = te.clampCascadeDepthToTurnTruth(3, 0, turns)
  assert.equal(result, 2, "confirmed finalized depth of 2 should be honored even though live tier looks like cheap")
})

test("clampCascadeDepthToTurnTruth trusts a confirmed-executed route without a finalize event", async () => {
  const te = await import("../src/lib/hooks/tool-execute.js?turntruth3=" + Date.now())

  const turns = [
    { finalized: null, executedRoute: { contributedToFinalAnswer: true, cascadeDepth: 2 } },
  ]

  const result = te.clampCascadeDepthToTurnTruth(3, 0, turns)
  assert.equal(result, 2, "confirmed-executed route depth should be honored")
})

test("clampCascadeDepthToTurnTruth falls back to the raw depth when it's shallower than the live tier", async () => {
  const te = await import("../src/lib/hooks/tool-execute.js?turntruth4=" + Date.now())

  const result = te.clampCascadeDepthToTurnTruth(1, 3, [])
  assert.equal(result, 1, "never inflate depth above what was actually planned, even if live tier is deeper")
})

test("clampCascadeDepthToTurnTruth with no turn-ledger history at all falls back to live active tier", async () => {
  const te = await import("../src/lib/hooks/tool-execute.js?turntruth5=" + Date.now())

  const result = te.clampCascadeDepthToTurnTruth(3, 2, [])
  assert.equal(result, 2, "brand-new session with no ledger history should reflect only the live tier, not a stale plan")
})
