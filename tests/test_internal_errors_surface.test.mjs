// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// The plugin's internal failures were unreadable. console.error routes every
// "[vibeOS] ..." failure into $VIBEOS_HOME/session-events/<sid>.jsonl as a
// footer-error row, and nothing read that file: verificationEvidenceFromEvents
// skips the rows by design (an error is not verification evidence), and
// `vibe diagnose`, the MCP server and runtime-surface never referenced it at all.
//
// A live 5-turn benchmark logged 106 of them -- 40 ReferenceErrors, 38 API
// failures, 5 dropped state writes -- and reported success. These tests pin the
// reader that makes that impossible.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "internal-errors-"))
process.env.VIBEOS_HOME = sandbox

const { getInternalErrorSummary } = await import("../src/lib/session-health.js")

function writeEvents(sessionId, rows) {
  mkdirSync(join(sandbox, "session-events"), { recursive: true })
  writeFileSync(
    join(sandbox, "session-events", `${sessionId}.jsonl`),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  )
}

const err = (message) => ({ ts: new Date().toISOString(), kind: "footer-error", hook: "console-error-guard", stage: "vibeos-internal", message })

test("a session with no event log reports no internal errors", () => {
  const s = getInternalErrorSummary("no-such-session", sandbox)
  assert.equal(s.total, 0)
  assert.equal(s.distinct, 0)
  assert.deepEqual(s.top, [])
})

test("footer-error rows are counted", () => {
  writeEvents("s1", [err("[vibeOS] boom"), err("[vibeOS] boom"), err("[vibeOS] other")])
  const s = getInternalErrorSummary("s1", sandbox)
  assert.equal(s.total, 3)
  assert.equal(s.distinct, 2)
})

test("rows that are not footer-error are ignored", () => {
  writeEvents("s2", [
    { kind: "footer-probe", message: "[vibeOS] probe" },
    { kind: "cache", message: "[vibeOS] cached" },
    err("[vibeOS] real failure"),
  ])
  const s = getInternalErrorSummary("s2", sandbox)
  assert.equal(s.total, 1)
  assert.equal(s.top[0].count, 1)
})

test("the same failure groups even when paths and numbers differ", () => {
  // This is the run20 shape: the same lock defect on three different files,
  // with a different timeout printed each time. Reported as one defect, not three.
  writeEvents("s3", [
    err("[vibeOS] updateState failed after 3 retries: lock not acquired for /a/delegation-state.json after 2000ms"),
    err("[vibeOS] updateState failed after 3 retries: lock not acquired for /b/model-tiers.json after 2000ms"),
    err("[vibeOS] updateState failed after 9 retries: lock not acquired for /c/project-states.json after 4000ms"),
  ])
  const s = getInternalErrorSummary("s3", sandbox)
  assert.equal(s.total, 3)
  assert.equal(s.distinct, 1, "one defect, three occurrences")
  assert.equal(s.top[0].count, 3)
})

test("the most frequent failure is reported first and the list is capped", () => {
  writeEvents("s4", [
    ...Array(5).fill(0).map(() => err("[vibeOS] frequent")),
    ...Array(2).fill(0).map(() => err("[vibeOS] occasional")),
    err("[vibeOS] rare a"), err("[vibeOS] rare b"), err("[vibeOS] rare c"), err("[vibeOS] rare d"),
  ])
  const s = getInternalErrorSummary("s4", sandbox, 3)
  assert.equal(s.total, 11)
  assert.equal(s.top.length, 3, "capped at the requested limit")
  assert.match(s.top[0].message, /frequent/)
  assert.equal(s.top[0].count, 5)
  assert.equal(s.top[1].count, 2)
})

test("a corrupt line does not lose the rest of the log", () => {
  mkdirSync(join(sandbox, "session-events"), { recursive: true })
  writeFileSync(
    join(sandbox, "session-events", "s5.jsonl"),
    JSON.stringify(err("[vibeOS] first")) + "\n{ not json\n" + JSON.stringify(err("[vibeOS] second")) + "\n",
  )
  const s = getInternalErrorSummary("s5", sandbox)
  assert.equal(s.total, 2)
})
