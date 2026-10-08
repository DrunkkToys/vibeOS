// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { loadPolyglot, writeExercise, gradeExercise, turnsForExercise, hiddenTurn, feedbackTurn } from "../scripts/e2e/codebench/polyglot.mjs"

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

const CPP_CMAKE = "get_filename_component(exercise ${CMAKE_CURRENT_SOURCE_DIR} NAME)\ncmake_minimum_required(VERSION 3.5.1)\nproject(${exercise} CXX)\nstring(REPLACE \"-\" \"_\" file ${exercise})\nadd_executable(${exercise} ${file}_test.cpp ${file}.cpp ${file}.h)\nadd_custom_target(test_${exercise} ALL DEPENDS ${exercise} COMMAND ${exercise})\n"
const CPP_HEADER = "#pragma once\nint add(int a, int b);\n"
const CPP_STUB = "#include \"two_fer.h\"\nint add(int a, int b) { return 0; }\n"
const CPP_EXAMPLE = "#include \"two_fer.h\"\nint add(int a, int b) { return a + b; }\n"
const CPP_TEST = "#include \"two_fer.h\"\n#include \"test/check.h\"\nint main() { return check(add(2, 3) == 5) && check(add(-1, 1) == 0) ? 0 : 1; }\n"

function cppFixture(names = ["two-fer"]) {
  const root = mkdtempSync(join(tmpdir(), "polyglot-cpp-"))
  for (const name of names) {
    const dir = join(root, "cpp", "exercises", "practice", name)
    mkdirSync(join(dir, ".meta"), { recursive: true })
    mkdirSync(join(dir, ".docs"), { recursive: true })
    mkdirSync(join(dir, "test"), { recursive: true })
    writeFileSync(join(dir, "CMakeLists.txt"), CPP_CMAKE)
    writeFileSync(join(dir, "two_fer.h"), CPP_HEADER)
    writeFileSync(join(dir, "two_fer.cpp"), CPP_STUB)
    writeFileSync(join(dir, "two_fer_test.cpp"), CPP_TEST)
    writeFileSync(join(dir, "test", "check.h"), "#pragma once\ninline bool check(bool ok) { return ok; }\n")
    writeFileSync(join(dir, ".meta", "example.cpp"), CPP_EXAMPLE)
    writeFileSync(join(dir, ".meta", "config.json"), JSON.stringify({ files: { solution: ["two_fer.cpp", "two_fer.h"], test: ["two_fer_test.cpp"], example: [".meta/example.cpp"] } }))
    writeFileSync(join(dir, ".docs", "instructions.md"), "# Two fer\n\nAdd two numbers.\n")
  }
  return root
}

test("loadPolyglot reads the cpp track and skips the exercises that need Boost", () => {
  const ex = loadPolyglot(cppFixture(["two-fer", "gigasecond", "meetup"]), { language: "cpp" })
  assert.deepEqual(ex.map((e) => e.task_id), ["cpp/two-fer"])
  assert.equal(ex[0].language, "cpp")
  assert.deepEqual(loadPolyglot(fixture()).map((e) => e.language), ["python"])
})

test("cpp writeExercise copies the test directory, pins the exercise name in CMakeLists and adds a make test target", () => {
  const [ex] = loadPolyglot(cppFixture(), { language: "cpp" })
  const proj = mkdtempSync(join(tmpdir(), "polyglot-proj-"))
  writeExercise(proj, ex)
  assert.ok(existsSync(join(proj, "test", "check.h")))
  assert.match(readFileSync(join(proj, "CMakeLists.txt"), "utf8"), /^set\(exercise two-fer\)/)
  assert.match(readFileSync(join(proj, "Makefile"), "utf8"), /^test:/m)
  assert.ok(!existsSync(join(proj, ".meta")))
})

test("cpp turns tell the agent to run make test, which the cascade counts as a test command", async () => {
  const [ex] = loadPolyglot(cppFixture(), { language: "cpp" })
  const { isTestCommand } = await import("../src/lib/router-only.js").catch(() => import("../dist-ts/lib/router-only.js"))
  for (const t of turnsForExercise(ex)) {
    assert.match(t.prompt, /`make test`/)
    assert.ok(isTestCommand("make test"))
  }
})

test("cpp gradeExercise fails the stub and passes the reference, in a project dir with any name", { skip: !process.env.PATH.split(":").some((p) => existsSync(join(p, "cmake"))) }, () => {
  const [ex] = loadPolyglot(cppFixture(), { language: "cpp" })
  const proj = mkdtempSync(join(tmpdir(), "polyglot-proj-"))
  writeExercise(proj, ex)
  assert.equal(gradeExercise(proj, ex).pass, false)
  writeFileSync(join(proj, "two_fer.cpp"), CPP_EXAMPLE)
  writeFileSync(join(proj, "two_fer_test.cpp"), "int main() { return 1; }\n")
  assert.equal(gradeExercise(proj, ex).pass, true)
})

test("hidden-tests mode gives the agent the stub and instructions but no test file, as in Aider's protocol", () => {
  const [ex] = loadPolyglot(fixture())
  const proj = mkdtempSync(join(tmpdir(), "polyglot-proj-"))
  writeExercise(proj, ex, { hideTests: true })
  assert.ok(existsSync(join(proj, "adder.py")))
  assert.ok(existsSync(join(proj, "INSTRUCTIONS.md")))
  assert.ok(!existsSync(join(proj, "adder_test.py")))
  assert.equal(gradeExercise(proj, ex).pass, false)
  writeFileSync(join(proj, "adder.py"), EXAMPLE)
  assert.equal(gradeExercise(proj, ex).pass, true)
})

test("hidden-tests turns: the first never mentions a test command, the retry carries the failing output", () => {
  const [ex] = loadPolyglot(fixture())
  const first = hiddenTurn(ex)
  assert.match(first.prompt, /INSTRUCTIONS\.md/)
  assert.match(first.prompt, /adder\.py/)
  assert.doesNotMatch(first.prompt, /unittest|adder_test/)
  assert.match(first.prompt, /hidden/)
  assert.match(first.prompt, /outside this directory/)
  const proj = mkdtempSync(join(tmpdir(), "polyglot-proj-"))
  writeExercise(proj, ex, { hideTests: true })
  const g = gradeExercise(proj, ex, { tail: 4000 })
  const retry = feedbackTurn(ex, g.error)
  assert.equal(retry.id, "fix")
  assert.ok(retry.prompt.includes(g.error.trim().slice(-200)))
  assert.ok(g.error.length > 0)
})
