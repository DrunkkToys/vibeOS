// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { ISOLATION_PERMISSION, leakedAccess } from "../scripts/e2e/codebench/isolation.mjs"

const PROJ = "/var/folders/k5/T/codebench-ab12/proj"
const CTX = { proj: PROJ, sensitive: ["/Users/x/repo", "/private/tmp/scratch/polyglot"], testFiles: ["react_test.py"], home: "/Users/x" }
const ev = (tool, input, status = "completed") => JSON.stringify({ type: "tool_use", part: { type: "tool", tool, state: { status, input } } })
const leaks = (...events) => leakedAccess(events.join("\n"), CTX)

test("the trial config denies web access and directories outside the project", () => {
  assert.equal(ISOLATION_PERMISSION.webfetch, "deny")
  assert.equal(ISOLATION_PERMISSION.websearch, "deny")
  assert.equal(ISOLATION_PERMISSION.external_directory, "deny")
})

test("ordinary work inside the project and scratch files in temp dirs are not leaks", () => {
  assert.deepEqual(leaks(
    ev("read", { filePath: `${PROJ}/react.py` }),
    ev("grep", { pattern: "InputCell", path: PROJ }),
    ev("glob", { pattern: "**/*.py" }),
    ev("bash", { command: `cd ${PROJ} && python3 -c "import react"` }),
    ev("bash", { command: "g++ -o /tmp/test_dnd /tmp/test_dnd.cpp && /tmp/test_dnd" }),
    ev("bash", { command: "cat > /var/folders/k5/T/opencode/probe1.py <<'EOF'\nprint(1)\nEOF" }),
    ev("read", { filePath: "/Users/x/.local/share/opencode/tool-output/tool_11e7" }),
    ev("bash", { command: "ls -la ..; ls -la ../.." }),
    ev("bash", { command: `python3 -c "api.post('/add', {}); api.get('/users')"` }),
  ), [])
})

test("reading or grepping the repo that holds old trials is a leak", () => {
  assert.equal(leaks(
    ev("grep", { pattern: "InputCell", path: "/Users/x/repo" }),
    ev("read", { filePath: "/Users/x/repo/.pg-dev/trials/raw-weak-python_react-0/proj/foo.py" }),
  ).length, 2)
})

test("the dataset clone is a leak under its /System/Volumes/Data and /private aliases", () => {
  assert.equal(leaks(ev("read", { filePath: "/System/Volumes/Data/private/tmp/scratch/polyglot/python/x.py" })).length, 1)
  assert.equal(leaks(ev("bash", { command: "ls /tmp/scratch/polyglot/python" })).length, 1)
})

test("the exercise's test file named anywhere outside the project is a leak", () => {
  assert.equal(leaks(ev("bash", { command: "cat /var/folders/k5/T/polyglot-grade-Jh/react_test.py" })).length, 1)
  assert.equal(leaks(ev("read", { filePath: "/opt/elsewhere/react_test.py" })).length, 1)
  assert.deepEqual(leaks(ev("write", { filePath: `${PROJ}/react_test.py` })), [])
})

test("grader folders are a leak", () => {
  assert.equal(leaks(ev("bash", { command: "ls -la /private/var/folders/k5/T/polyglot-grade-PZQ/" })).length, 1)
})

test("searching the whole home directory or disk is a leak", () => {
  assert.equal(leaks(ev("bash", { command: `find ~ -maxdepth 4 -iname "*react*"` })).length, 1)
  assert.equal(leaks(ev("bash", { command: "ls $HOME" })).length, 1)
  assert.equal(leaks(ev("bash", { command: "find /Users/x -name '*react*'" })).length, 1)
  assert.equal(leaks(ev("bash", { command: "find / -name '*_test.py' 2>/dev/null" })).length, 1)
  assert.equal(leaks(ev("bash", { command: "mdfind react_test" })).length, 1)
})

test("a completed web call is a leak; a failed or denied one got nothing and is not", () => {
  assert.equal(leaks(ev("webfetch", { url: "https://raw.githubusercontent.com/exercism/python/main/x_test.py" })).length, 1)
  assert.equal(leaks(ev("websearch", { query: "exercism react tests" })).length, 1)
  assert.equal(leaks(ev("webfetch", { url: "https://example.com" }, "error")).length, 0)
})

test("non-json lines are ignored", () => {
  assert.deepEqual(leakedAccess("garbage\n{not json", CTX), [])
})
