// SPDX-License-Identifier: MIT
// Canonical blackbox record contract (PR: make-cascade-real).
//
// Live VIBEOS_HOME blackbox-state.json showed schema drift: 331/388 sessions
// had NO decision_source and n_interactions was absent on ALL of them, because
// several writers assemble session records independently and the single choke
// point (normalizeBlackboxRecord, used by both load and save) never backfilled
// those fields. The file had also grown to 6 MB / 388 unpruned sessions,
// approaching the 10 MB corruption-wipe guard. These tests pin the fix at the
// choke point: every persisted record carries decision_source + n_interactions,
// and saveBlackboxState caps the session count (never dropping the active sid).
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-bb-canonical-"))
const prevHome = process.env.VIBEOS_HOME
process.env.VIBEOS_HOME = join(sandbox, ".claude")

const state = await import("../src/lib/state.js?bbcanon=" + Date.now())
const stateFile = join(sandbox, ".claude", "blackbox-state.json")

after(() => {
  try { process.env.VIBEOS_HOME = prevHome } catch {}
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})

function writeRaw(sessions) {
  writeFileSync(stateFile, JSON.stringify({ enabled: true, sessions }, null, 2))
}
function readBack() {
  return JSON.parse(readFileSync(stateFile, "utf-8")).sessions || {}
}

test("[canonical] load backfills decision_source + n_interactions on a raw-serialize record", () => {
  // Shape of the 331 "missing-source" records: raw tracker.serialize(), no
  // decision_source, no n_interactions; has history + turn_counter.
  writeRaw({
    "sess-raw-1": {
      sessionId: "sess-raw-1",
      sub_regime: "LOOPING",
      regime: "LOOPING",
      resolution: "solved",
      turn_counter: 5,
      history: [{ text: "a" }, { text: "b" }, { text: "c" }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  })
  const reloaded = state.loadBlackboxState().sessions["sess-raw-1"]
  assert.equal(reloaded.decision_source, "local", "missing decision_source must default to 'local'")
  assert.equal(reloaded.n_interactions, 3, "n_interactions must be backfilled from history length")
})

test("[canonical] backfill preserves an existing api decision_source", () => {
  writeRaw({
    "sess-api": {
      sessionId: "sess-api",
      sub_regime: "CONVERGING",
      decision_source: "api",
      turn_counter: 9,
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  })
  const reloaded = state.loadBlackboxState().sessions["sess-api"]
  assert.equal(reloaded.decision_source, "api", "existing 'api' source must not be overwritten")
  // history empty -> fall back to turn_counter
  assert.equal(reloaded.n_interactions, 9, "n_interactions falls back to turn_counter when history empty")
})

test("[canonical] saveBlackboxState caps session count and keeps the active session", () => {
  const sessions = {}
  const base = Date.now() - 1000 * 60 * 60 * 24 * 400
  for (let i = 0; i < 400; i++) {
    sessions["old-" + i] = {
      sessionId: "old-" + i,
      sub_regime: "INIT",
      turn_counter: 1,
      history: [],
      createdAt: new Date(base + i * 1000).toISOString(),
      updatedAt: new Date(base + i * 1000).toISOString(),
    }
  }
  // Active session is the live _OC_SID and must survive pruning even though it
  // is the "newest"; also make it clearly recent.
  const activeSid = state._OC_SID
  sessions[activeSid] = {
    sessionId: activeSid,
    sub_regime: "REFINING",
    turn_counter: 3,
    history: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  state.saveBlackboxState({ enabled: true, sessions })
  const out = readBack()
  const count = Object.keys(out).length
  assert.ok(count < 400, `session count must be capped (got ${count})`)
  assert.ok(out[activeSid], "the active session must never be pruned")
})
