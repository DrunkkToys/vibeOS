// SPDX-License-Identifier: MIT
// Criterion 2 -- "escalation is answer-driven: escalations correlate with
// recorded gate verdicts" -- was unanswerable, and not because the verdicts
// were missing.
//
// runQualityGate persists every verdict to $VIBEOS_HOME/quality-gate/<sid>.jsonl.
// The rig created the directory for each plugin trial and never read it. Reading
// run21's by hand after the fact: 21 verdicts across its two vibeultrax trials,
// every one of them passed:true. The cascade never had a failure to escalate on,
// which is a different diagnosis from the one the run was scored against.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { readGateOutcomes } from "../scripts/e2e/ml-task/gate-verdicts.mjs"

function homeWith(files) {
  const home = mkdtempSync(join(tmpdir(), "gate-verdicts-"))
  if (files) {
    mkdirSync(join(home, "quality-gate"), { recursive: true })
    for (const [name, rows] of Object.entries(files)) {
      writeFileSync(join(home, "quality-gate", name), rows.map((r) => JSON.stringify(r)).join("\n") + "\n")
    }
  }
  return home
}

test("a home with no quality-gate directory reports no verdicts", () => {
  const home = homeWith(null)
  try {
    const res = readGateOutcomes(home)
    assert.equal(res.verdicts, 0)
    assert.equal(res.failed, 0)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("the run21 shape is legible: every verdict passed, so nothing could escalate", () => {
  const home = homeWith({ "ses_a.jsonl": [
    { passed: true, flow: "none", ts: 1 },
    ...Array.from({ length: 9 }, (_, i) => ({ passed: true, flow: "code", ts: i + 2 })),
  ] })
  try {
    const res = readGateOutcomes(home)
    assert.equal(res.verdicts, 10)
    assert.equal(res.passed, 10)
    assert.equal(res.failed, 0, "zero failures means the escalation path was never entered")
    assert.deepEqual(res.flows, { none: 1, code: 9 })
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("failures are counted with their reasons, so criterion 2 can be checked against them", () => {
  const home = homeWith({ "ses_a.jsonl": [
    { passed: true, flow: "code", ts: 1 },
    { passed: false, flow: "code", reasons: ["claimed a test run with no test tool call"], ts: 2 },
    { passed: false, flow: "code", reasons: ["claimed a test run with no test tool call"], ts: 3 },
  ] })
  try {
    const res = readGateOutcomes(home)
    assert.equal(res.failed, 2)
    assert.equal(res.reasons["claimed a test run with no test tool call"], 2)
    assert.deepEqual(res.failedAt, [2, 3], "the timestamps are what an escalation is correlated against")
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("verdicts from every session file in the home are included", () => {
  const home = homeWith({
    "ses_a.jsonl": [{ passed: true, flow: "code", ts: 1 }],
    "ses_b.jsonl": [{ passed: false, flow: "code", ts: 2 }],
  })
  try {
    const res = readGateOutcomes(home)
    assert.equal(res.verdicts, 2)
    assert.equal(res.failed, 1)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("the rig puts the gate outcomes in every trial's evidence", () => {
  const rig = readFileSync(new URL("../scripts/e2e/ml-impact.mjs", import.meta.url), "utf8")
  assert.match(rig, /readGateOutcomes/, "ml-impact must read the gate verdicts")
  assert.match(rig, /gateVerdicts/, "and record them in the evidence")
})
