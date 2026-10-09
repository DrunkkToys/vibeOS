// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { gunzipSync } from "node:zlib"
import { ARM_DEFS } from "../ml-task/score.mjs"
import { python } from "./python.mjs"

export const TURNS = [
  { id: "implement", prompt: "Implement the function in solution.py so it is correct for all inputs its docstring describes, not only the examples. Then run the tests with `python3 -m unittest` and fix any failures." },
  { id: "fix", prompt: "Run the tests with `python3 -m unittest`, check edge cases the docstring implies, and fix any failures." },
]

export const ARMS = {
  "raw-weak": { def: ARM_DEFS.raw, model: "weak" },
  "raw-strong": { def: ARM_DEFS.raw, model: "strong" },
  cascade: { def: ARM_DEFS.cascade, model: "weak" },
}

export function armTiers(arm, models) {
  const a = ARMS[arm]
  return {
    model: models[a.model],
    tiers: { cheap: models.weak, medium: models.strong, brain: models.strong },
  }
}

export function loadTasks(path) {
  return gunzipSync(readFileSync(path)).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
}

function seedInt(seed) {
  let h = 2166136261
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

function rng(seed) {
  let s = seedInt(seed)
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function selectSubset(tasks, { n = 30, seed = "codebench-1" } = {}) {
  const ids = tasks.map((t) => t.task_id)
  const next = rng(seed)
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  const picked = ids.slice(0, n)
  return { dev: picked.slice(0, Math.floor(n / 2)), holdout: picked.slice(Math.floor(n / 2)) }
}

const VISIBLE_TEST = `import doctest
import unittest

import solution

class TestExamples(unittest.TestCase):
    def test_docstring_examples(self):
        result = doctest.testmod(solution)
        self.assertEqual(result.failed, 0)

if __name__ == "__main__":
    unittest.main()
`

export function writeTask(proj, task) {
  writeFileSync(join(proj, "solution.py"), task.prompt + "    raise NotImplementedError\n")
  writeFileSync(join(proj, "test_solution.py"), VISIBLE_TEST)
}

export function gradeTask(proj, task, { timeoutMs = 30000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "codebench-grade-"))
  try {
    writeFileSync(join(dir, "solution.py"), readFileSync(join(proj, "solution.py"), "utf8"))
    writeFileSync(join(dir, "hidden_check.py"), `from solution import *\n${task.test}\n\ncheck(${task.entry_point})\n`)
    const r = spawnSync(python(), ["hidden_check.py"], { cwd: dir, timeout: timeoutMs, killSignal: "SIGKILL", encoding: "utf8" })
    return { pass: r.status === 0, status: r.status, error: (r.stderr || "").slice(-400) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function strongShare(execution, strongModel) {
  if (!execution || execution.error || !Array.isArray(execution.rows)) return null
  const id = String(strongModel).split("/").pop()
  const total = execution.rows.reduce((s, r) => s + (r.messages || 0), 0)
  if (!total) return null
  const strong = execution.rows.filter((r) => r.model === id).reduce((s, r) => s + (r.messages || 0), 0)
  return strong / total
}

export function sessionTokens(execution) {
  if (!execution || execution.error || !execution.totals) return null
  const t = execution.totals
  const reasoning = (execution.rows || []).reduce((s, r) => s + (r.reasoning || 0), 0)
  return t.input + t.output + t.cacheRead + t.cacheWrite + reasoning
}

export function budgetLeft(results, cap) {
  const spent = results.reduce((s, r) => s + (r.tokens || 0), 0)
  if (!cap) return { spent, stop: false }
  const unmetered = results.some((r) => r.tokens == null && r.sessionId)
  return { spent, stop: unmetered || spent >= cap }
}
