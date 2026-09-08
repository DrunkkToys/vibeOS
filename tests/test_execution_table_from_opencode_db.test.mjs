// SPDX-License-Identifier: MIT
// Contract: every trial records what OpenCode actually ran, not what vibeOS
// decided to run.
//
// Criterion 1 of the measurement plan is ">= 2 distinct models per vibeultrax
// session", and it was unanswerable from results.json: `evidence.ranModels` and
// `evidence.slots` are the plugin's own account of its intentions. Scoring
// run21 by hand against opencode.db showed both vibeultrax trials had run the
// cheap model and nothing else for all five turns, which no field in the trial
// record said.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { readExecution, defaultDbPath } from "../scripts/e2e/ml-task/execution.mjs"

const hasSqlite = (() => {
  try { execFileSync("sqlite3", ["-version"], { stdio: "ignore" }); return true } catch { return false }
})()

function buildDb(dir, rows) {
  const db = join(dir, "opencode.db")
  const stmts = ["create table message (id text, session_id text, data text);"]
  for (const [i, r] of rows.entries()) {
    stmts.push("insert into message values ('m" + i + "','" + r.sid + "','" +
      JSON.stringify(r.data).replace(/'/g, "''") + "');")
  }
  const sqlFile = join(dir, "seed.sql")
  writeFileSync(sqlFile, stmts.join("\n"))
  execFileSync("sqlite3", [db, ".read " + sqlFile], { stdio: "ignore" })
  return db
}

const assistant = (model, provider, input, output, cacheRead) => ({
  role: "assistant", modelID: model, providerID: provider,
  tokens: { input, output, reasoning: 0, cache: { read: cacheRead, write: 0 } },
})

test("no session id means no execution record", () => {
  assert.equal(readExecution(null), null)
  assert.equal(readExecution(""), null)
})

test("a missing database reports the reason instead of throwing", () => {
  const res = readExecution("ses_x", { db: join(tmpdir(), "does-not-exist-" + Date.now(), "opencode.db") })
  assert.equal(res.error, "database not found")
})

test("the execution table groups the session's assistant turns by model", { skip: !hasSqlite }, () => {
  const dir = mkdtempSync(join(tmpdir(), "exec-table-"))
  try {
    const db = buildDb(dir, [
      { sid: "ses_a", data: assistant("cheap-model", "p", 100, 10, 1000) },
      { sid: "ses_a", data: assistant("cheap-model", "p", 200, 20, 2000) },
      { sid: "ses_a", data: assistant("brain-model", "p", 50, 5, 500) },
      { sid: "ses_a", data: { role: "user", modelID: "cheap-model" } },
      { sid: "ses_other", data: assistant("noise-model", "p", 999, 999, 999) },
    ])
    const res = readExecution("ses_a", { db })
    assert.equal(res.error, undefined, res.error)
    assert.equal(res.distinctModels, 2, "both models the session ran must appear")
    assert.deepEqual(res.models, ["cheap-model", "brain-model"], "ordered by message count")
    assert.equal(res.totals.messages, 3, "user rows are not assistant turns")
    assert.equal(res.totals.input, 350)
    assert.equal(res.totals.cacheRead, 3500)
    const cheap = res.rows.find((r) => r.model === "cheap-model")
    assert.equal(cheap.messages, 2)
    assert.equal(cheap.input, 300)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a single-model session is visible as such", { skip: !hasSqlite }, () => {
  const dir = mkdtempSync(join(tmpdir(), "exec-table-one-"))
  try {
    const db = buildDb(dir, [
      { sid: "ses_b", data: assistant("only-model", "p", 10, 1, 100) },
      { sid: "ses_b", data: assistant("only-model", "p", 10, 1, 100) },
    ])
    const res = readExecution("ses_b", { db })
    assert.equal(res.distinctModels, 1, "criterion 1 fails on exactly this shape")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the database path is overridable, so it is not pinned to one machine", () => {
  const prev = process.env.VIBEOS_OPENCODE_DB
  try {
    process.env.VIBEOS_OPENCODE_DB = "/somewhere/else/opencode.db"
    assert.equal(defaultDbPath(), "/somewhere/else/opencode.db")
  } finally {
    if (prev === undefined) delete process.env.VIBEOS_OPENCODE_DB
    else process.env.VIBEOS_OPENCODE_DB = prev
  }
})

test("the rig attaches the execution table to every trial record", async () => {
  const { readFileSync } = await import("node:fs")
  const rig = readFileSync(new URL("../scripts/e2e/ml-impact.mjs", import.meta.url), "utf8")
  assert.match(rig, /readExecution/, "ml-impact must call readExecution")
  // Shorthand or not: the record must carry the key, the syntax is not the contract.
  assert.match(rig, /\n\s*execution[,:]/, "the trial record must carry an execution key")
})
