// The cascade escalates on a pre-hoc guess (computeDifficulty on the prompt) and
// never on evidence. The deterministic quality gate already knows when an answer
// made claims that tool evidence does not back -- runQualityGate returns
// verdict.passed === false -- but index.ts only records it, reports it, and posts
// an outcome. The tier does not move.
//
// The routing strategy that scores 107.9% of raw brain in the research simulation
// (chain-experiment.ts "Adaptive") escalates only when a stage FAILS. This is the
// missing half of that: turn a failed gate verdict into the next rung up.
//
// Run: node --test tests/test_gate_escalation.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import { gateEscalationTarget } from "../src/vibeOS-lib/quality-gate.js"

const FAIL = { passed: false, flow: "code", claims: [], missing: ["tests pass"], reasons: ["unbacked"] }
const PASS = { passed: true, flow: "code", claims: [], missing: [], reasons: [] }
const PIPE = ["cheap", "medium", "brain"]

test("a failed verdict on the cheap rung escalates one step up", () => {
  assert.equal(gateEscalationTarget({ verdict: FAIL, activeSlot: "cheap", pipeline: PIPE }), "medium")
})

test("a failed verdict on the middle rung escalates to the top", () => {
  assert.equal(gateEscalationTarget({ verdict: FAIL, activeSlot: "medium", pipeline: PIPE }), "brain")
})

test("a passing verdict never escalates", () => {
  assert.equal(gateEscalationTarget({ verdict: PASS, activeSlot: "cheap", pipeline: PIPE }), null)
})

test("the top rung has nowhere to go", () => {
  assert.equal(gateEscalationTarget({ verdict: FAIL, activeSlot: "brain", pipeline: PIPE }), null)
})

test("escalation is clamped to the mode's envelope", () => {
  // vibeqmax runs a single-rung envelope; a failure must not invent a tier.
  assert.equal(gateEscalationTarget({ verdict: FAIL, activeSlot: "brain", pipeline: ["brain"] }), null)
})

test("a locked slot is never moved by the gate", () => {
  // vibe lock on is a user promise that the model will not change.
  assert.equal(gateEscalationTarget({ verdict: FAIL, activeSlot: "cheap", pipeline: PIPE, locked: true }), null)
})

test("a verdict with no flow to judge does not escalate", () => {
  const none = { ...FAIL, flow: "none" }
  assert.equal(gateEscalationTarget({ verdict: none, activeSlot: "cheap", pipeline: PIPE }), null)
})

test("a missing or malformed pipeline is inert, not a crash", () => {
  assert.equal(gateEscalationTarget({ verdict: FAIL, activeSlot: "cheap", pipeline: null }), null)
  assert.equal(gateEscalationTarget({ verdict: FAIL, activeSlot: null, pipeline: PIPE }), null)
  assert.equal(gateEscalationTarget({ verdict: FAIL, activeSlot: "nonsense", pipeline: PIPE }), null)
})
