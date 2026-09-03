import { test } from "node:test"
import assert from "node:assert/strict"
import {
  planForDifficulty,
  resolveVote,
  agreementRatio,
  ADAPTIVE_VOTE_CEILING,
} from "../src/vibeOS-lib/adaptive-router.js"

const FULL = ["cheap", "medium", "brain"]

test("easy queries get a vote, not a single cheap call", () => {
  const plan = planForDifficulty(0.20, FULL)
  assert.equal(plan.kind, "vote")
  assert.equal(plan.slot, "cheap")
  assert.ok(plan.samples >= 3, `expected a real vote, got ${plan.samples} samples`)
})

test("the vote ceiling matches the benchmark's easy/hard split", () => {
  assert.equal(ADAPTIVE_VOTE_CEILING, 0.40)
  assert.equal(planForDifficulty(0.40, FULL).kind, "vote")
  assert.equal(planForDifficulty(0.41, FULL).kind, "pipeline")
})

test("hard queries get the staged pipeline, cheapest stage first", () => {
  const plan = planForDifficulty(0.80, FULL)
  assert.equal(plan.kind, "pipeline")
  assert.deepEqual(plan.stages.map((s) => s.slot), ["cheap", "medium", "brain"])
  assert.equal(plan.stages[0].kind, "vote")
  assert.equal(plan.stages[1].kind, "debate")
  assert.equal(plan.stages[2].kind, "single")
})

test("a single-rung envelope collapses to one single-sample stage", () => {
  const plan = planForDifficulty(0.90, ["brain"])
  assert.equal(plan.kind, "pipeline")
  assert.equal(plan.stages.length, 1)
  assert.equal(plan.stages[0].slot, "brain")
  assert.equal(plan.stages[0].kind, "single")
  assert.equal(plan.stages[0].samples, 1)
})

test("an envelope without cheap never plans a cheap stage", () => {
  const plan = planForDifficulty(0.80, ["medium", "brain"])
  assert.ok(plan.stages.every((s) => s.slot !== "cheap"))
})

test("an easy query in a brain-only envelope does not vote on brain", () => {
  const plan = planForDifficulty(0.10, ["brain"])
  assert.equal(plan.kind, "pipeline")
  assert.equal(plan.stages[0].samples, 1)
})

test("a clear majority resolves the vote and reports its margin", () => {
  const r = resolveVote(["42", "42", "7"], 0.5)
  assert.equal(r.agreed, true)
  assert.equal(r.answer, "42")
  assert.ok(Math.abs(r.agreement - 2 / 3) < 1e-9)
})

test("a split vote does not resolve, so the caller escalates", () => {
  const r = resolveVote(["a", "b", "c"], 0.5)
  assert.equal(r.agreed, false)
  assert.equal(r.answer, null)
})

test("agreement ignores formatting the models did not mean", () => {
  assert.equal(agreementRatio(["  42 ", "42", "42\n"]), 1)
})

test("an empty or malformed vote never claims agreement", () => {
  assert.equal(resolveVote([], 0.5).agreed, false)
  assert.equal(resolveVote(["", "", ""], 0.5).agreed, false)
  assert.equal(resolveVote(null, 0.5).agreed, false)
})

test("a unanimous two-model vote still counts as agreement", () => {
  const r = resolveVote(["ok", "ok"], 0.5)
  assert.equal(r.agreed, true)
  assert.equal(r.answer, "ok")
})

test("the plan carries a reason naming the strategy and the score", () => {
  assert.match(planForDifficulty(0.2, FULL).reason, /vote/)
  assert.match(planForDifficulty(0.9, FULL).reason, /pipeline/)
})
