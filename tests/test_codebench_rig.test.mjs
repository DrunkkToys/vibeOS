// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { gzipSync } from "node:zlib"

import { loadTasks, selectSubset, writeTask, gradeTask, TURNS, ARMS, armTiers, strongShare, sessionTokens, budgetLeft } from "../scripts/e2e/codebench/tasks.mjs"

const TASK = {
  task_id: "HumanEval/0",
  prompt: "def add(a, b):\n    \"\"\" Add two numbers.\n    >>> add(2, 3)\n    5\n    \"\"\"\n",
  entry_point: "add",
  canonical_solution: "    return a + b\n",
  test: "\n\ndef check(candidate):\n    assert candidate(2, 3) == 5\n    assert candidate(-1, 1) == 0\n    assert candidate(10, 5) == 15\n",
}

function fixtureFile(n) {
  const dir = mkdtempSync(join(tmpdir(), "codebench-data-"))
  const rows = []
  for (let i = 0; i < n; i++) rows.push(JSON.stringify({ ...TASK, task_id: `HumanEval/${i}` }))
  const path = join(dir, "HumanEval.jsonl.gz")
  writeFileSync(path, gzipSync(rows.join("\n") + "\n"))
  return path
}

test("loadTasks reads the gzipped jsonl", () => {
  const tasks = loadTasks(fixtureFile(5))
  assert.equal(tasks.length, 5)
  assert.equal(tasks[2].task_id, "HumanEval/2")
})

test("selectSubset is seeded, disjoint and split into dev and holdout halves", () => {
  const tasks = loadTasks(fixtureFile(164))
  const a = selectSubset(tasks, { n: 30, seed: "codebench-1" })
  const b = selectSubset(tasks, { n: 30, seed: "codebench-1" })
  assert.deepEqual(a, b)
  assert.equal(a.dev.length, 15)
  assert.equal(a.holdout.length, 15)
  assert.equal(new Set([...a.dev, ...a.holdout]).size, 30)
  assert.notDeepEqual(selectSubset(tasks, { n: 30, seed: "other" }), a)
})

test("writeTask gives the agent a stub and a visible doctest suite, never the hidden check", () => {
  const proj = mkdtempSync(join(tmpdir(), "codebench-proj-"))
  writeTask(proj, TASK)
  const sol = readFileSync(join(proj, "solution.py"), "utf8")
  assert.ok(sol.includes("def add(a, b):"))
  assert.ok(sol.includes("raise NotImplementedError"))
  assert.ok(existsSync(join(proj, "test_solution.py")))
  const all = sol + readFileSync(join(proj, "test_solution.py"), "utf8")
  assert.ok(!all.includes("def check("))
  assert.ok(!all.includes("candidate(-1, 1)"))
})

test("gradeTask fails the untouched stub and passes a correct solution", () => {
  const proj = mkdtempSync(join(tmpdir(), "codebench-proj-"))
  writeTask(proj, TASK)
  assert.equal(gradeTask(proj, TASK).pass, false)
  writeFileSync(join(proj, "solution.py"), TASK.prompt + TASK.canonical_solution)
  assert.equal(gradeTask(proj, TASK).pass, true)
})

test("gradeTask uses the pristine hidden check even when the agent rewrote the tests", () => {
  const proj = mkdtempSync(join(tmpdir(), "codebench-proj-"))
  writeTask(proj, TASK)
  writeFileSync(join(proj, "solution.py"), TASK.prompt + "    return 5\n")
  writeFileSync(join(proj, "test_solution.py"), "")
  writeFileSync(join(proj, "check.py"), "def check(candidate):\n    pass\n")
  assert.equal(gradeTask(proj, TASK).pass, false)
})

test("gradeTask fails a solution that hangs instead of blocking the run", () => {
  const proj = mkdtempSync(join(tmpdir(), "codebench-proj-"))
  writeTask(proj, TASK)
  writeFileSync(join(proj, "solution.py"), TASK.prompt + "    while True:\n        pass\n")
  const r = gradeTask(proj, TASK, { timeoutMs: 3000 })
  assert.equal(r.pass, false)
})

test("every arm gets the same two turns, and the second asks for a test run", () => {
  assert.equal(TURNS.length, 2)
  assert.match(TURNS[0].prompt, /solution\.py/)
  assert.match(TURNS[1].prompt, /python3 -m unittest/)
  assert.deepEqual(Object.keys(ARMS).sort(), ["cascade", "raw-strong", "raw-weak"])
})

test("arm tiers: raw arms pin one model, the cascade starts weak and escalates to strong", () => {
  const m = { weak: "p/weak", strong: "p/strong" }
  assert.equal(armTiers("raw-weak", m).model, "p/weak")
  assert.equal(armTiers("raw-strong", m).model, "p/strong")
  const c = armTiers("cascade", m)
  assert.deepEqual(c.tiers, { cheap: "p/weak", medium: "p/strong", brain: "p/strong" })
  assert.equal(ARMS.cascade.def.env.VIBEOS_CASCADE, "1")
  assert.equal(ARMS["raw-weak"].def.plugin, false)
})

test("strongShare counts assistant messages on the strong model from opencode.db rows", () => {
  const execution = { rows: [{ model: "strong", messages: 3 }, { model: "weak", messages: 9 }] }
  assert.equal(strongShare(execution, "p/strong"), 0.25)
  assert.equal(strongShare({ error: "x" }, "p/strong"), null)
})

test("sessionTokens sums input, output, reasoning and cache tokens from opencode.db, null when unreadable", () => {
  const execution = { totals: { messages: 4, input: 1000, output: 200, cacheRead: 5000, cacheWrite: 300 }, rows: [{ reasoning: 50 }, { reasoning: null }] }
  assert.equal(sessionTokens(execution), 6550)
  assert.equal(sessionTokens({ error: "locked" }), null)
  assert.equal(sessionTokens(null), null)
})

test("budgetLeft stops the run once recorded tokens reach the cap, and never stops without a cap", () => {
  const results = [{ tokens: 400 }, { tokens: 500 }, { tokens: null }]
  assert.deepEqual(budgetLeft(results, 0), { spent: 900, stop: false })
  assert.deepEqual(budgetLeft(results, 1000), { spent: 900, stop: false })
  assert.deepEqual(budgetLeft(results, 900), { spent: 900, stop: true })
})

test("budgetLeft stops when a trial's tokens could not be read, so an unreadable database never runs unmetered", () => {
  assert.equal(budgetLeft([{ tokens: 10 }, { tokens: null, sessionId: "ses_x" }], 1000).stop, true)
  assert.equal(budgetLeft([{ tokens: null, sessionId: "ses_x" }], 0).stop, false)
})
