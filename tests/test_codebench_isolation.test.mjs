// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { ISOLATION_PERMISSION, leakedAccess } from "../scripts/e2e/codebench/isolation.mjs"

const PROJ = "/tmp/cb-trial/proj"
const ev = (tool, input, status = "completed") => JSON.stringify({ type: "tool_use", part: { type: "tool", tool, state: { status, input } } })

test("the trial config denies web access and directories outside the project", () => {
  assert.equal(ISOLATION_PERMISSION.webfetch, "deny")
  assert.equal(ISOLATION_PERMISSION.websearch, "deny")
  assert.equal(ISOLATION_PERMISSION.external_directory, "deny")
})

test("reads, greps and globs inside the project are not leaks", () => {
  const log = [
    ev("read", { filePath: `${PROJ}/react.py` }),
    ev("grep", { pattern: "InputCell", path: PROJ }),
    ev("glob", { pattern: "**/*.py" }),
    ev("bash", { command: `cd ${PROJ} && python3 -c "import react"` }),
    ev("bash", { command: "ls -la /usr/bin/python3" }),
  ].join("\n")
  assert.deepEqual(leakedAccess(log, PROJ), [])
})

test("a read or grep outside the project is a leak, as when the agent found old trials' hidden tests", () => {
  const log = [
    ev("grep", { pattern: "InputCell", path: "/Users/x/repo" }),
    ev("read", { filePath: "/Users/x/repo/.pg-dev/trials/raw-weak-python_react-0/proj/react_test.py" }),
  ].join("\n")
  assert.equal(leakedAccess(log, PROJ).length, 2)
})

test("a bash command touching a path outside the project is a leak", () => {
  const log = ev("bash", { command: "cat /var/folders/k5/T/polyglot-grade-Jh/zipper_test.py" })
  assert.equal(leakedAccess(log, PROJ).length, 1)
})

test("a completed web fetch is a leak; a failed or denied one got nothing and is not", () => {
  assert.equal(leakedAccess(ev("webfetch", { url: "https://raw.githubusercontent.com/exercism/python/main/x_test.py" }), PROJ).length, 1)
  assert.equal(leakedAccess(ev("webfetch", { url: "https://example.com" }, "error"), PROJ).length, 0)
})

test("a sibling directory sharing the project's prefix is outside it", () => {
  assert.equal(leakedAccess(ev("read", { filePath: "/tmp/cb-trial/proj2/x_test.py" }), PROJ).length, 1)
})

test("non-json lines are ignored", () => {
  assert.deepEqual(leakedAccess("garbage\n{not json", PROJ), [])
})

test("url routes inside code strings are not paths", () => {
  assert.deepEqual(leakedAccess(ev("bash", { command: `python3 -c "api.post('/add', {}); api.get('/users')"` }), PROJ), [])
})

test("searching the home directory or parent directories from bash is a leak", () => {
  assert.equal(leakedAccess(ev("bash", { command: `find ~ -maxdepth 4 -iname "*domino*"` }), PROJ).length, 1)
  assert.equal(leakedAccess(ev("bash", { command: "ls -la ..; ls -la ../.." }), PROJ).length, 1)
  assert.equal(leakedAccess(ev("bash", { command: "ls $HOME/.cache" }), PROJ).length, 1)
  assert.deepEqual(leakedAccess(ev("bash", { command: `python3 -c 'print(10 // 2, "a...b", x[1:-1])'` }), PROJ), [])
})
