import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildVotePrompt,
  parseVoteReport,
  VOTE_MARKER,
} from "../src/vibeOS-lib/adaptive-router.js"

test("the vote prompt asks for independent attempts, not one answer restated", () => {
  const p = buildVotePrompt("Fix the batching bug.", 3)
  assert.match(p, /Fix the batching bug\./)
  assert.match(p, /independent/i)
  assert.match(p, /3/)
})

test("the vote prompt demands the agreement marker so the router can read it", () => {
  const p = buildVotePrompt("anything", 4)
  assert.ok(p.includes(VOTE_MARKER), "prompt must name the marker it will be parsed for")
})

test("a reported unanimous vote parses as full agreement", () => {
  const r = parseVoteReport(`done\n${VOTE_MARKER} 3/3`)
  assert.equal(r.agreement, 1)
  assert.equal(r.samples, 3)
  assert.equal(r.agreed, true)
})

test("a reported split vote parses as disagreement", () => {
  const r = parseVoteReport(`hmm\n${VOTE_MARKER} 1/3`)
  assert.ok(r.agreement < 0.5)
  assert.equal(r.agreed, false)
})

test("a majority above half agrees", () => {
  const r = parseVoteReport(`${VOTE_MARKER} 3/4`)
  assert.equal(r.agreed, true)
})

test("an exact half is not a majority", () => {
  const r = parseVoteReport(`${VOTE_MARKER} 2/4`)
  assert.equal(r.agreed, false)
})

test("a missing marker is unknown, never a silent pass", () => {
  const r = parseVoteReport("the model ignored the instruction")
  assert.equal(r.reported, false)
  assert.equal(r.agreed, false)
})

test("a nonsense marker is unknown, not agreement", () => {
  for (const bad of [`${VOTE_MARKER} 5/3`, `${VOTE_MARKER} 0/0`, `${VOTE_MARKER} x/y`]) {
    const r = parseVoteReport(bad)
    assert.equal(r.agreed, false, `"${bad}" must not agree`)
  }
})

test("parsing survives null and non-string input", () => {
  assert.equal(parseVoteReport(null).agreed, false)
  assert.equal(parseVoteReport(undefined).reported, false)
})

test("a single sample is not a vote and is never wrapped", () => {
  assert.equal(buildVotePrompt("x", 1), "x")
})
