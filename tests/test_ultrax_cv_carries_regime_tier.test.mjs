// SPDX-License-Identifier: MIT
//
// The regime_tier channel was added so a hard regime could escalate the
// vibeultrax primary past the prompt-text scorer's medium cap. The unit wiring
// was proved by test_ultrax_regime_escalation.test.mjs, which hands
// syncControlSettings a control vector carrying regime_tier. Nothing upstream
// ever set it.
//
// Measured, not inferred. .ml-run18 vibeultrax-0 persisted its live control
// vector to blackbox-state.json every turn:
//
//   cv.regime_tier   = undefined   (on all five sessions)
//   cv.tier_bias     = "cheap"
//   cv.selected_slot = "cheap" | "medium"
//
// while loop-audit.jsonl recorded the session sitting in LOOPING for 12 of its
// regime transitions -- REGIME_AXIS_BASE.LOOPING.tier === "brain". The trial ran
// ranModels=[cheap,medium]; brain never once executed, against a raw arm on brain
// for every turn.
//
// The cause is that computeControlVector routes vibeultrax to
// buildUltraxControlVector, which builds the whole vector from cascadeDecide(text)
// and drops the regime on the floor. buildOfflineControlVector -- the branch every
// other mode takes -- sets regime_tier from its axis bundle. The one mode that
// needs the channel is the one mode that never populated it.
import test from "node:test"
import assert from "node:assert/strict"

const cascade = await import("../src/lib/cascade.js")
const { computeControlVector, REGIME_AXIS_BASE } = cascade

const cv = (subRegime, text = "fix the failing test") =>
  computeControlVector({ sub_regime: subRegime, latest_stress_multiplier: 0, user_text: text }, undefined, "vibeultrax")

test("the vibeultrax control vector carries the regime's tier verdict", () => {
  const v = cv("LOOPING")
  assert.equal(v.optimization_mode, "vibeultrax", "this test must exercise the vibeultrax branch")
  assert.equal(v.regime_tier, "brain", "LOOPING is a brain regime and must say so on the channel the primary reads")
})

test("every regime's verdict reaches the vibeultrax vector", () => {
  for (const [regime, bundle] of Object.entries(REGIME_AXIS_BASE)) {
    assert.equal(cv(regime).regime_tier, bundle.tier, `${regime} must publish regime_tier=${bundle.tier}`)
  }
})

// EXPLORING is cheap. Without this the escalation is a one-way ratchet: every
// turn ends on brain and vibeultrax is raw with extra latency.
test("a cheap regime still says cheap, so vibeultrax can de-escalate", () => {
  assert.equal(cv("EXPLORING").regime_tier, "cheap")
})

// The entry floor is the deliberate part of vibeultrax and ~20 test files assert
// it. regime_tier is an added channel, not a relaxation of the clamp.
test("tier_bias stays pinned to the cheap entry floor", () => {
  for (const regime of ["LOOPING", "IMPLEMENTING", "EXPLORING", "INIT"]) {
    assert.equal(cv(regime).tier_bias, "cheap", `${regime} must not move the vibeultrax entry floor`)
  }
})
