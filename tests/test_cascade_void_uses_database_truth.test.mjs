// SPDX-License-Identifier: MIT
// Criterion 1 -- ">= 2 distinct models per vibeultrax session" -- judged by the
// instrument outside the subject.
//
// voidReason asked ev.slots, which is the slot the plugin wrote into its own
// audit rows. run21 passed that check with slots ["cheap","medium","brain"]
// while opencode.db showed one model, muse-spark, for all five turns of both
// vibeultrax trials. The trial was scored, and its 0.949 qscore was reported as
// evidence about a cascade that never ran.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { voidReason } from "../scripts/e2e/ml-task/score.mjs"

const turns = [{ id: "diagnose", status: 0 }]
const base = { chatParamsRows: 5, modes: ["vibeultrax"], internalErrors: 0 }

test("the run21 shape is void: three slots claimed, one model run", () => {
  const ev = { ...base, slots: ["cheap", "medium", "brain"] }
  const execution = { distinctModels: 1, models: ["muse-spark"], totals: { messages: 42 } }
  const reason = voidReason("vibeultrax", turns, ev, execution)
  assert.match(String(reason), /cascade did not cascade/, "one model run is not a cascade")
  assert.match(String(reason), /muse-spark/, "the reason must name what actually ran")
})

test("two models in the database is a cascade, whatever the slots say", () => {
  const ev = { ...base, slots: ["cheap"] }
  const execution = { distinctModels: 2, models: ["muse-spark", "mimo-v2.5"], totals: { messages: 42 } }
  assert.equal(voidReason("vibeultrax", turns, ev, execution), null,
    "the database outranks the plugin's account in both directions")
})

test("an unreadable database falls back to the plugin's account rather than voiding blind", () => {
  const ev = { ...base, slots: ["cheap", "brain"] }
  assert.equal(voidReason("vibeultrax", turns, ev, { error: "database not found" }), null)
  assert.equal(voidReason("vibeultrax", turns, ev, null), null)
  const single = { ...base, slots: ["cheap"] }
  assert.match(String(voidReason("vibeultrax", turns, single, null)), /cascade did not cascade/)
})

test("a database with no rows for the session is not proof of a single model", () => {
  const ev = { ...base, slots: ["cheap", "brain"] }
  const execution = { distinctModels: 0, models: [], totals: { messages: 0 } }
  assert.equal(voidReason("vibeultrax", turns, ev, execution), null,
    "zero assistant rows means the session was not found, not that it ran one model")
})

test("the rig passes the execution table to voidReason", () => {
  const rig = readFileSync(new URL("../scripts/e2e/ml-impact.mjs", import.meta.url), "utf8")
  assert.match(rig, /voidReason\(arm, turns, ev, \w+\)/, "voidReason must be given the execution table")
})
