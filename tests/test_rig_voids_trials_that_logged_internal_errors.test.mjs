// SPDX-License-Identifier: MIT
// Protocol rule 5: a run that logs internal errors is void, not scored.
//
// It was unenforceable. run20 logged 40 ReferenceErrors, 38 API failures and 5
// lost state writes, and scored 0.933 -- the same as raw -- because nothing
// downstream of the console guard ever read the rows it persisted. The rig
// creates $HOME/session-events for every plugin trial and then never opens it.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { readInternalErrors } from "../scripts/e2e/ml-task/internal-errors.mjs"
import { voidReason } from "../scripts/e2e/ml-task/score.mjs"

function homeWith(rows) {
  const home = mkdtempSync(join(tmpdir(), "internal-errors-"))
  if (rows) {
    mkdirSync(join(home, "session-events"), { recursive: true })
    for (const [file, lines] of Object.entries(rows)) {
      writeFileSync(join(home, "session-events", file), lines.map((l) => JSON.stringify(l)).join("\n") + "\n")
    }
  }
  return home
}

const err = (message, hook = "footer") => ({ ts: "t", kind: "footer-error", hook, stage: "s", message })

test("a home with no session-events directory reports no internal errors", () => {
  const home = homeWith(null)
  try {
    const res = readInternalErrors(home)
    assert.equal(res.count, 0)
    assert.deepEqual(res.messages, [])
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("footer-error rows are counted across every session file, other rows are not", () => {
  const home = homeWith({
    "ses_a.jsonl": [
      err("userText is not defined"),
      err("userText is not defined"),
      { ts: "t", kind: "footer-line", footer_line: "| OK" },
    ],
    "ses_b.jsonl": [err("lock not acquired for model-tiers.json")],
  })
  try {
    const res = readInternalErrors(home)
    assert.equal(res.count, 3, "every footer-error row counts, including repeats")
    assert.deepEqual(res.byMessage["userText is not defined"], 2, "repeats are grouped so the cause is readable")
    assert.equal(res.messages.length, 2, "distinct messages")
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("a truncated final line does not lose the rows before it", () => {
  const home = homeWith({ "ses_a.jsonl": [err("first")] })
  try {
    const file = join(home, "session-events", "ses_a.jsonl")
    writeFileSync(file, readFileSync(file, "utf8") + '{"kind":"footer-err')
    assert.equal(readInternalErrors(home).count, 1)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test("a plugin trial that logged internal errors is void", () => {
  const turns = [{ id: "diagnose", status: 0 }]
  const ev = { chatParamsRows: 5, slots: ["cheap", "brain"], modes: ["vibeultrax"], internalErrors: 3,
    internalErrorMessages: ["userText is not defined"] }
  const reason = voidReason("vibeultrax", turns, ev)
  assert.match(String(reason), /internal error/i, "the trial must be void, not scored")
  assert.match(String(reason), /userText is not defined/, "and it must name the cause")
})

test("a clean plugin trial is not void", () => {
  const turns = [{ id: "diagnose", status: 0 }]
  const ev = { chatParamsRows: 5, slots: ["cheap", "brain"], modes: ["vibeultrax"], internalErrors: 0 }
  assert.equal(voidReason("vibeultrax", turns, ev), null)
})

test("the rig collects the internal-error count into every trial's evidence", () => {
  const rig = readFileSync(new URL("../scripts/e2e/ml-impact.mjs", import.meta.url), "utf8")
  assert.match(rig, /readInternalErrors/, "ml-impact must read the session event log")
  assert.match(rig, /internalErrors/, "and put the count in the evidence it scores")
})
