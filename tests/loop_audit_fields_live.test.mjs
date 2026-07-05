// SPDX-License-Identifier: MIT
// Pins down that the 5 "loop telemetry" session fields (loop_consecutive,
// loop_detector_kind, loop_detector_confidence, loop_source_reason,
// loop_authority) are load-bearing, not dead write-only telemetry: they are
// read directly off session state by appendLoopTransitionAudit() (state.ts)
// every time saveBlackboxState() runs, and written to loop-audit.jsonl.
//
// This documents the outcome of a simplification-pass investigation: these
// fields were flagged as candidates for removal, verified live, and kept —
// so a future cleanup pass doesn't re-flag and delete them.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-loop-audit-"))
const prevHome = process.env.VIBEOS_HOME
process.env.VIBEOS_HOME = join(sandbox, ".claude")

const state = await import("../src/lib/state.js?loop-audit=" + Date.now())
const auditFile = join(sandbox, ".claude", "loop-audit.jsonl")

after(() => {
  try { process.env.VIBEOS_HOME = prevHome } catch {}
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})

function readAuditEntries() {
  if (!existsSync(auditFile)) return []
  return readFileSync(auditFile, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
}

test("saveBlackboxState writes a loop-audit.jsonl entry sourced from session loop fields on a real transition", () => {
  const sid = "sess-loop-audit-1"

  // First save: not looping, no prior audit-relevant state.
  state.saveBlackboxState({
    enabled: true,
    sessions: {
      [sid]: {
        sessionId: sid,
        sub_regime: "REFINING",
        is_looping: false,
      },
    },
  })
  const afterFirst = readAuditEntries()

  // Second save: session transitions into a detected loop with detector metadata
  // set directly on session state (exactly what a future cleanup pass might
  // consider deleting as "unread telemetry").
  state.saveBlackboxState({
    enabled: true,
    sessions: {
      [sid]: {
        sessionId: sid,
        sub_regime: "LOOPING",
        is_looping: true,
        loop_authority: "backend",
        loop_detector_kind: "repetition",
        loop_detector_confidence: 0.92,
        loop_source_reason: "repeated identical tool calls",
        loop_consecutive: 3,
      },
    },
  })
  const afterSecond = readAuditEntries()

  assert.ok(afterSecond.length > afterFirst.length, "a loop transition must append a new audit entry")
  const entry = afterSecond[afterSecond.length - 1]
  assert.equal(entry.session_id, sid)
  assert.equal(entry.next_regime, "LOOPING")
  assert.equal(entry.loop_authority, "backend", "loop_authority must be read from session state into the audit payload")
  assert.equal(entry.loop_detector_kind, "repetition", "loop_detector_kind must be read from session state into the audit payload")
  assert.equal(entry.loop_detector_confidence, 0.92, "loop_detector_confidence must be read from session state into the audit payload")
  assert.equal(entry.reason, "repeated identical tool calls", "loop_source_reason must be read from session state into the audit payload")
})

test("saveBlackboxState does not append a duplicate audit entry when the loop signature is unchanged", () => {
  const sid = "sess-loop-audit-2"
  const record = {
    sessionId: sid,
    sub_regime: "LOOPING",
    is_looping: true,
    loop_authority: "backend",
    loop_detector_kind: "repetition",
    loop_detector_confidence: 0.8,
    loop_source_reason: "same reason",
  }
  state.saveBlackboxState({ enabled: true, sessions: { [sid]: { ...record } } })
  const afterFirst = readAuditEntries().length
  state.saveBlackboxState({ enabled: true, sessions: { [sid]: { ...record } } })
  const afterSecond = readAuditEntries().length
  assert.equal(afterSecond, afterFirst, "an unchanged loop signature must not append a duplicate audit entry")
})
