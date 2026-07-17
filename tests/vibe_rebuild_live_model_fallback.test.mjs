// SPDX-License-Identifier: MIT
// Live-reproduced on a real dev machine: opencode.json's static
// agent.build.model / top-level model fields were completely empty (the
// live model is chosen entirely at runtime via the chat dropdown, never
// persisted to that static config), so `vibe rebuild`'s provider seed fell
// through to an in-memory currentModel cache that is itself empty until a
// real chat turn has run. Running `vibe rebuild` as the very first message
// of a session had zero live-model context and silently defaulted to
// whichever provider happened to be first in the discovered models list
// (unrelated to, and unreachable compared to, what the user actually runs).
// getLiveOpenCodeModel() queries OpenCode's own session DB -- the
// authoritative record of what actually ran most recently -- so rebuild can
// seed its provider correctly even on a session's first message.

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"

function makeFakeOpenCodeDb(dbPath) {
  const sql = `
    CREATE TABLE message (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      data text NOT NULL
    );
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES ('msg1', 'ses_fake', 1000, 1000, '${JSON.stringify({ role: "assistant", providerID: "deepseek", modelID: "deepseek-v4-flash" }).replace(/'/g, "''")}');
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES ('msg2', 'ses_fake', 2000, 2000, '${JSON.stringify({ role: "assistant", providerID: "opencode", modelID: "big-pickle" }).replace(/'/g, "''")}');
  `
  execFileSync("sqlite3", [dbPath], { input: sql })
}

test("getLiveOpenCodeModel reads the most recent assistant message's real provider/model from the OpenCode DB", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-live-model-"))
  const dbPath = join(sandbox, "opencode.db")
  makeFakeOpenCodeDb(dbPath)
  const prevDbPath = process.env.OPENCODE_DB_PATH
  process.env.OPENCODE_DB_PATH = dbPath
  try {
    const mod = await import("../src/lib/session-health.js?livemodel1=" + Date.now())
    const live = mod.getLiveOpenCodeModel()
    assert.deepEqual(live, { provider: "opencode", model: "big-pickle" }, "must return the MOST RECENT assistant message's provider/model, not an earlier one")
  } finally {
    if (prevDbPath === undefined) delete process.env.OPENCODE_DB_PATH
    else process.env.OPENCODE_DB_PATH = prevDbPath
  }
})

test("getLiveOpenCodeModel returns null when no OpenCode DB exists", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-live-model-none-"))
  const prevDbPath = process.env.OPENCODE_DB_PATH
  process.env.OPENCODE_DB_PATH = join(sandbox, "does-not-exist.db")
  try {
    const mod = await import("../src/lib/session-health.js?livemodel2=" + Date.now())
    assert.equal(mod.getLiveOpenCodeModel(), null)
  } finally {
    if (prevDbPath === undefined) delete process.env.OPENCODE_DB_PATH
    else process.env.OPENCODE_DB_PATH = prevDbPath
  }
})
