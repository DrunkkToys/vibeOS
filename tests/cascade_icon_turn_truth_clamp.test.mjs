// SPDX-License-Identifier: MIT
// Regression test for the live-observed bug: footer showed "▸▸▸" (brain-depth
// cascade icon) while the model badge still showed "cheap | Big Pickle".
//
// This is the SECOND iteration of this fix. The first iteration trusted
// turn-ledger's merged `finalized.cascadeDepth` / `executedRoute` as ground
// truth -- but real production data (VIBEOS_HOME/turn-ledger.jsonl) proved
// that signal is ITSELF polluted: a single real Task dispatch to brain at
// 08:15 got its turnId reused by 28 subsequent turn.finalize writes over the
// next 45 minutes (turnId is keyed off the last routing decision, not the
// current conversational turn), so `finalized.cascadeDepth` kept reporting 3
// long after the model had gone back to cheap. Trusting it (as the first fix
// did) would NOT have fixed the live bug.
//
// The real fix: clampCascadeDepthToTurnTruth requires the RAW turn.route
// event's own timestamp (getLatestRouteEvent) to be recent (within
// CASCADE_ROUTE_RECENCY_MS), not just "most recently touched." Otherwise it
// falls back to classifying the model actually shown -- never the
// route-path-derived tier, which is the same polluted signal.

import test from "node:test"
import assert from "node:assert/strict"

test("clampCascadeDepthToTurnTruth: exact live repro -- 45-minute-stale brain route must not inflate the icon", async () => {
  const te = await import("../src/lib/hooks/tool-execute.js?turntruth1=" + Date.now())

  // Real values pulled from VIBEOS_HOME/turn-ledger.jsonl for the session
  // that produced the user's bug report: one real turn.route dispatch to
  // brain at 08:15:24, then finalize events reusing that turnId all the way
  // to 09:00:18 -- 45 minutes later -- still carrying cascadeDepth: 3.
  const rawCascadeDepth = 3
  const liveModelDepth = 0 // displayed model classifies as cheap (opencode/big-pickle)
  const recentRoute = {
    ts: "2026-07-13T08:15:24.310Z",
    executedRoute: { cascadeDepth: 3 },
  }
  const now = Date.parse("2026-07-13T09:00:18.693Z") // the moment of the buggy finalize write

  const result = te.clampCascadeDepthToTurnTruth(rawCascadeDepth, liveModelDepth, recentRoute, now)
  assert.equal(result, 0, "a route dispatched 45 minutes ago must not inflate the icon above the live cheap tier")
})

test("clampCascadeDepthToTurnTruth: a delegation dispatched moments ago is trusted", async () => {
  const te = await import("../src/lib/hooks/tool-execute.js?turntruth2=" + Date.now())

  const now = Date.parse("2026-07-13T08:15:26.000Z") // 1.7s after dispatch
  const recentRoute = { ts: "2026-07-13T08:15:24.310Z", executedRoute: { cascadeDepth: 3 } }

  const result = te.clampCascadeDepthToTurnTruth(3, 0, recentRoute, now)
  assert.equal(result, 3, "a delegation dispatched moments ago should still show its real depth")
})

test("clampCascadeDepthToTurnTruth: route exactly at the recency boundary is still trusted, past it is not", async () => {
  const te = await import("../src/lib/hooks/tool-execute.js?turntruth3=" + Date.now())
  const dispatchTs = "2026-07-13T08:15:24.000Z"
  const windowMs = 30_000

  const atBoundary = Date.parse(dispatchTs) + windowMs
  assert.equal(te.clampCascadeDepthToTurnTruth(3, 0, { ts: dispatchTs, executedRoute: { cascadeDepth: 3 } }, atBoundary, windowMs), 3)

  const pastBoundary = Date.parse(dispatchTs) + windowMs + 1
  assert.equal(te.clampCascadeDepthToTurnTruth(3, 0, { ts: dispatchTs, executedRoute: { cascadeDepth: 3 } }, pastBoundary, windowMs), 0)
})

test("clampCascadeDepthToTurnTruth: no route event at all falls back to the live model tier", async () => {
  const te = await import("../src/lib/hooks/tool-execute.js?turntruth4=" + Date.now())

  const result = te.clampCascadeDepthToTurnTruth(3, 2, null)
  assert.equal(result, 2, "brand-new session with no route history should reflect only the live model tier")
})

test("clampCascadeDepthToTurnTruth: never inflates above the raw planned depth even with a recent deep route", async () => {
  const te = await import("../src/lib/hooks/tool-execute.js?turntruth5=" + Date.now())

  const now = Date.now()
  const recentRoute = { ts: new Date(now - 1000).toISOString(), executedRoute: { cascadeDepth: 3 } }
  const result = te.clampCascadeDepthToTurnTruth(1, 0, recentRoute, now)
  assert.equal(result, 1, "clamp must never exceed the raw planned depth")
})

test("getLatestRouteEvent returns the raw route event's own timestamp, not a merged/re-touched one", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs")
  const { join } = await import("node:path")
  const { tmpdir } = await import("node:os")

  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-route-event-"))
  process.env.VIBEOS_HOME = sandbox
  const sid = "test-session-route-event"
  const ledgerPath = join(sandbox, "turn-ledger.jsonl")
  const routeTs = "2026-07-13T08:15:24.310Z"
  const lines = [
    JSON.stringify({ _ts: routeTs, kind: "turn.route", sessionId: sid, turnId: "t1", executedRoute: { cascadeDepth: 3, selectedSlot: "brain" } }),
    // 28 finalize events reusing turnId "t1", each bumping _ts forward --
    // exactly what happened in the real production ledger.
    ...Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ _ts: new Date(Date.parse(routeTs) + (i + 1) * 60_000).toISOString(), kind: "turn.finalize", sessionId: sid, turnId: "t1", finalized: { cascadeDepth: 3, finalVisibleSlot: "cheap" } })),
  ]
  writeFileSync(ledgerPath, lines.join("\n") + "\n")

  const tl = await import("../src/lib/turn-ledger.js?routeevent1=" + Date.now())
  const event = tl.getLatestRouteEvent(sid, 50)
  assert.ok(event, "route event found")
  assert.equal(event.ts, routeTs, "must return the ORIGINAL turn.route timestamp, not one of the later finalize timestamps")
})
