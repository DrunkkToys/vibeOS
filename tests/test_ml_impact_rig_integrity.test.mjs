// SPDX-License-Identifier: MIT
// CONTRACT: the A/B rig may not report a confident number from a dead metric.
//
// Runs 12-15 were invoked with --turns 2 against a five-turn scenario. Four of the
// five qscore components were pinned by construction: correctness (hidden groups
// keyed to turns that never ran), honesty (reads turns 3-5, which were absent),
// completion (passed/2 of 2) and noRegression. Only efficiency moved, so forty
// trials measured nothing but wall-clock and were reported as quality evidence.
// These tests pin the four guards that make that failure impossible to repeat.

import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { GROUP_ENABLING_TURN, correctnessFromGroups, reachableGroups } from "../scripts/e2e/ml-task/grade.mjs"
import { constantComponents, scoreComponents } from "../scripts/e2e/ml-task/score.mjs"
import { TURNS, TURN_IDS } from "../scripts/e2e/ml-task/prompts.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

const groups = (spec) => Object.fromEntries(
  Object.entries(spec).map(([n, [pass, fail]]) => [n, { pass, fail, ran: pass + fail > 0, ok: fail === 0 && pass > 0 }]),
)

test("every hidden group declares the turn that makes it reachable", () => {
  for (const [group, turnId] of Object.entries(GROUP_ENABLING_TURN)) {
    assert.ok(TURN_IDS.includes(turnId), `${group} names turn "${turnId}", which is not in the scenario`)
  }
  // g1 cannot be reachable at turn 1: turn 1 is diagnosis-only, "Do NOT edit any file".
  assert.notEqual(GROUP_ENABLING_TURN["g1-batcher.test.mjs"], TURN_IDS[0])
})

test("reachableGroups excludes groups whose enabling turn never ran", () => {
  const all = Object.keys(GROUP_ENABLING_TURN)
  assert.deepEqual(reachableGroups(TURNS.length), all, "a full run must reach every group")
  assert.deepEqual(reachableGroups(1), [], "diagnosis-only reaches nothing")
  assert.deepEqual(reachableGroups(2), ["g1-batcher.test.mjs"], "the run 12-15 truncation reaches one group")
  assert.equal(reachableGroups(4).length, all.length)
})

test("correctness is scored over what was asked, not over the full scenario", () => {
  // The exact shape of runs 12-15: g1 solved, everything after it unreachable.
  const per = groups({
    "g1-batcher.test.mjs": [3, 0],
    "g2-enricher.test.mjs": [0, 2],
    "g3-flusher.test.mjs": [0, 2],
    "g4-config.test.mjs": [0, 2],
    "g5-pivot.test.mjs": [0, 2],
  })
  assert.equal(correctnessFromGroups(per, { reachable: reachableGroups(2) }), 1)
  assert.equal(correctnessFromGroups(per, { reachable: reachableGroups(TURNS.length) }), 0.2)
})

test("a reachable group that crashed on import still scores zero", () => {
  // The anti-sabotage guard: destroying a group must not shrink the denominator.
  const per = groups({ "g1-batcher.test.mjs": [3, 0], "g2-enricher.test.mjs": [0, 0] })
  per["g2-enricher.test.mjs"].ran = false
  const reachable = ["g1-batcher.test.mjs", "g2-enricher.test.mjs"]
  assert.equal(correctnessFromGroups(per, { reachable }), 0.5)
})

test("completion is scored against the whole scenario, never against the truncation", () => {
  const two = [{ id: "diagnose", status: 0 }, { id: "fix-batching", status: 0 }]
  const c = scoreComponents({
    hidden: { groupRate: 0.2, correctness: 0.2 }, visible: { ok: true },
    turns: two, turnCount: 2, fullTurnCount: 5,
  })
  assert.equal(c.completion, 0.4, "two of five turns done is not a completed task")
})

test("honesty declares itself unscorable when the turns it reads never ran", () => {
  const two = [{ id: "diagnose", status: 0, text: "x" }, { id: "fix-batching", status: 0, text: "y" }]
  const c = scoreComponents({
    hidden: { groupRate: 0.2, correctness: 0.2 }, visible: { ok: true },
    turns: two, turnCount: 2, fullTurnCount: 5,
  })
  assert.equal(c.honestyScorable, false, "honesty reads fix-rest/pivot/self-review; none of them ran")

  const full = [...two, { id: "fix-rest", status: 0, text: "all tests now pass" },
    { id: "pivot", status: 0, text: "" }, { id: "self-review", status: 0, text: "" }]
  const d = scoreComponents({
    hidden: { groupRate: 0.2, correctness: 0.2 }, visible: { ok: true },
    turns: full, turnCount: 5, fullTurnCount: 5,
  })
  assert.equal(d.honestyScorable, true)
  assert.equal(d.honesty, 0, "claimed complete, admitted nothing, groups not all passing")
})

test("a component constant across every scored trial is reported as no signal", () => {
  const results = [
    { arm: "raw", score: { correctness: 0.4667, honesty: 1, efficiency: 1.0 } },
    { arm: "raw", score: { correctness: 0.4667, honesty: 1, efficiency: 0.7 } },
    { arm: "vibeultrax", score: { correctness: 0.4667, honesty: 1, efficiency: 0.3 } },
  ]
  const dead = constantComponents(results)
  assert.deepEqual(dead.map((d) => d.component).sort(), ["correctness", "honesty"])
  assert.equal(dead.find((d) => d.component === "correctness").value, 0.4667)
  assert.equal(dead.find((d) => d.component === "correctness").trials, 3)
})

test("constantComponents ignores voided trials and needs more than one data point", () => {
  assert.deepEqual(constantComponents([{ arm: "raw", score: { correctness: 1 } }]), [],
    "one trial is constant trivially and proves nothing")
  const withVoid = [
    { arm: "raw", void: "timeout" },
    { arm: "raw", score: { correctness: 1 } },
    { arm: "raw", score: { correctness: 0.5 } },
  ]
  assert.deepEqual(constantComponents(withVoid), [])
})

test("ml-impact refuses a truncated run unless partial is explicitly opted into", () => {
  const run = (args) => {
    try {
      const out = execFileSync(process.execPath, [join(ROOT, "scripts/e2e/ml-impact.mjs"), ...args],
        { encoding: "utf8", timeout: 20000, cwd: ROOT })
      return { status: 0, out }
    } catch (e) {
      return { status: e.status, out: (e.stdout?.toString() || "") + (e.stderr?.toString() || "") }
    }
  }
  const truncated = run(["--turns", "2", "--model", "x/y"])
  assert.notEqual(truncated.status, 0, "a truncated run must not proceed silently")
  assert.match(truncated.out, /--allow-partial/, "the refusal must name the opt-out")
  assert.match(truncated.out, /2 of 5/, "the refusal must say how much of the scenario was cut")

  // The opt-in must get past the turn guard and fail later, on its own merits.
  const opted = run(["--turns", "2", "--allow-partial", "--model", "x/y"])
  assert.doesNotMatch(opted.out, /--allow-partial/, "opting in must not re-trip the turn guard")
})

// ── the vote arm ──
// The turn vote ships ON by default (chat-transform.ts:turnVoteEnabled returns true
// unless VIBEOS_TURN_VOTE is "off"), so it must be measurable against a vote-off
// sibling on this multi-turn workload — the one it actually runs on.

test("the two vibeultrax arms differ only in the vote, and both declare it explicitly", async () => {
  const { ARM_DEFS } = await import("../scripts/e2e/ml-task/score.mjs")
  const on = ARM_DEFS["vibeultrax"]
  const off = ARM_DEFS["vibeultrax-novote"]
  assert.ok(off, "a vote-off sibling arm must exist")
  assert.equal(on.env.VIBEOS_TURN_VOTE, "on")
  assert.equal(off.env.VIBEOS_TURN_VOTE, "off")
  for (const k of ["plugin", "pure", "agent", "mode", "entry"]) {
    assert.deepEqual(on[k], off[k], `arms must not differ in ${k} — that would confound the vote`)
  }
  assert.deepEqual(on.pipeline, off.pipeline)
})

test("the cascade void guard follows the mode, not the arm name", async () => {
  const { voidReason } = await import("../scripts/e2e/ml-task/score.mjs")
  const turns = [{ id: "diagnose", status: 0 }]
  const inert = { chatParamsRows: 1, modes: ["vibeultrax"], slots: ["cheap"] }
  for (const arm of ["vibeultrax", "vibeultrax-novote"]) {
    assert.match(String(voidReason(arm, turns, inert)), /cascade did not cascade/,
      `${arm} must void when the cascade never left one slot`)
  }
  const ok = { chatParamsRows: 1, modes: ["vibeultrax"], slots: ["cheap", "brain"] }
  assert.equal(voidReason("vibeultrax-novote", turns, ok), null)
})

// ── the vote must be observably present, or absent, in the arm that claims it ──
// The two vibeultrax arms differ only in an env var. If the vote never fires in
// the vote-on arm, the arms are the same configuration and any delta between them
// is noise reported as a finding — the exact failure this file exists to prevent.

test("a no-vote arm that cast votes is void, not a data point", async () => {
  const { voidReason } = await import("../scripts/e2e/ml-task/score.mjs")
  const turns = [{ id: "diagnose", status: 0 }]
  const base = { chatParamsRows: 1, modes: ["vibeultrax"], slots: ["cheap", "brain"] }
  assert.match(String(voidReason("vibeultrax-novote", turns, { ...base, votesCast: 2 })),
    /vote leaked/i, "an env leak makes the arm a duplicate of its sibling")
  assert.equal(voidReason("vibeultrax-novote", turns, { ...base, votesCast: 0 }), null)
})

test("a vote arm that cast no votes is reported, not voided", async () => {
  const { voidReason, voteSignal } = await import("../scripts/e2e/ml-task/score.mjs")
  const turns = [{ id: "diagnose", status: 0 }]
  const base = { chatParamsRows: 1, modes: ["vibeultrax"], slots: ["cheap", "brain"] }
  // "the vote never fires on real work" is a result about the vote, not a broken
  // trial. Voiding it would throw away the answer.
  assert.equal(voidReason("vibeultrax", turns, { ...base, votesCast: 0 }), null)

  const dead = voteSignal([
    { arm: "vibeultrax", evidence: { votesCast: 0 } },
    { arm: "vibeultrax", evidence: { votesCast: 0 } },
    { arm: "vibeultrax-novote", evidence: { votesCast: 0 } },
  ])
  assert.equal(dead.fired, false)
  assert.match(dead.message, /same configuration/i)

  const live = voteSignal([
    { arm: "vibeultrax", evidence: { votesCast: 3 } },
    { arm: "vibeultrax-novote", evidence: { votesCast: 0 } },
  ])
  assert.equal(live.fired, true)
  assert.equal(live.votes, 3)
})

test("voteSignal ignores arms that were never asked to vote", async () => {
  const { voteSignal } = await import("../scripts/e2e/ml-task/score.mjs")
  assert.equal(voteSignal([{ arm: "raw", evidence: { votesCast: 0 } }]).applicable, false)
})
