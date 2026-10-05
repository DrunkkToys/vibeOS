// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { loadPolyglot, writeExercise, gradeExercise, turnsForExercise } from "../scripts/e2e/codebench/polyglot.mjs"

const STUB = "def add(a, b):\n    pass\n"
const EXAMPLE = "def add(a, b):\n    return a + b\n"
const TESTS = "import unittest\n\nfrom adder import add\n\n\nclass AdderTest(unittest.TestCase):\n    def test_small(self):\n        self.assertEqual(add(2, 3), 5)\n\n    def test_negative(self):\n        self.assertEqual(add(-1, 1), 0)\n"

function fixture(names = ["adder"]) {
  const root = mkdtempSync(join(tmpdir(), "polyglot-"))
  for (const name of names) {
    const dir = join(root, "python", "exercises", "practice", name)
    mkdirSync(join(dir, ".meta"), { recursive: true })
    mkdirSync(join(dir, ".docs"), { recursive: true })
    writeFileSync(join(dir, "adder.py"), STUB)
    writeFileSync(join(dir, "adder_test.py"), TESTS)
    writeFileSync(join(dir, ".meta", "example.py"), EXAMPLE)
    writeFileSync(join(dir, ".meta", "config.json"), JSON.stringify({ files: { solution: ["adder.py"], test: ["adder_test.py"], example: [".meta/example.py"] } }))
    writeFileSync(join(dir, ".docs", "instructions.md"), "# Adder\n\nAdd two numbers.\n")
    writeFileSync(join(dir, ".docs", "instructions.append.md"), "Return the sum.\n")
  }
  return root
}

test("loadPolyglot lists python exercises with their solution, test and example files", () => {
  const ex = loadPolyglot(fixture(["adder", "other"]))
  assert.deepEqual(ex.map((e) => e.task_id), ["python/adder", "python/other"])
  assert.deepEqual(ex[0].solution, ["adder.py"])
  assert.deepEqual(ex[0].tests, ["adder_test.py"])
})

test("writeExercise gives the agent the stub, the tests and the instructions, but not the example", () => {
  const [ex] = loadPolyglot(fixture())
  const proj = mkdtempSync(join(tmpdir(), "polyglot-proj-"))
  writeExercise(proj, ex)
  assert.equal(readFileSync(join(proj, "adder.py"), "utf8"), STUB)
  assert.ok(existsSync(join(proj, "adder_test.py")))
  const doc = readFileSync(join(proj, "INSTRUCTIONS.md"), "utf8")
  assert.ok(doc.includes("Add two numbers.") && doc.includes("Return the sum."))
  assert.ok(!existsSync(join(proj, ".meta")))
  assert.ok(!existsSync(join(proj, "example.py")))
})

test("gradeExercise fails the stub and passes the reference solution", () => {
  const [ex] = loadPolyglot(fixture())
  const proj = mkdtempSync(join(tmpdir(), "polyglot-proj-"))
  writeExercise(proj, ex)
  assert.equal(gradeExercise(proj, ex).pass, false)
  writeFileSync(join(proj, "adder.py"), EXAMPLE)
  assert.equal(gradeExercise(proj, ex).pass, true)
})

test("gradeExercise runs the pristine tests even when the agent gutted them", () => {
  const [ex] = loadPolyglot(fixture())
  const proj = mkdtempSync(join(tmpdir(), "polyglot-proj-"))
  writeExercise(proj, ex)
  writeFileSync(join(proj, "adder.py"), "def add(a, b):\n    return 5\n")
  writeFileSync(join(proj, "adder_test.py"), "import unittest\n")
  assert.equal(gradeExercise(proj, ex).pass, false)
})

test("gradeExercise fails a hanging solution instead of blocking", () => {
  const [ex] = loadPolyglot(fixture())
  const proj = mkdtempSync(join(tmpdir(), "polyglot-proj-"))
  writeExercise(proj, ex)
  writeFileSync(join(proj, "adder.py"), "def add(a, b):\n    while True:\n        pass\n")
  assert.equal(gradeExercise(proj, ex, { timeoutMs: 3000 }).pass, false)
})

test("every arm gets the same two turns; both name the test command and the second asks to fix failures", () => {
  const [ex] = loadPolyglot(fixture())
  const turns = turnsForExercise(ex)
  assert.equal(turns.length, 2)
  for (const t of turns) assert.match(t.prompt, /python3 -m unittest adder_test/)
  assert.match(turns[0].prompt, /adder\.py/)
  assert.match(turns[0].prompt, /INSTRUCTIONS\.md/)
  assert.match(turns[1].prompt, /fix/i)
})
