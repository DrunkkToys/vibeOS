// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { continuationCount, toolEventLines, waitIdle } from "../scripts/e2e/codebench/serve.mjs"
import { leakedAccess } from "../scripts/e2e/codebench/isolation.mjs"

const msg = (role, parts) => ({ info: { role }, parts })
const tool = (name, input, status = "completed") => ({ type: "tool", tool: name, state: { status, input } })
const text = (t) => ({ type: "text", text: t })

test("session tool parts become the JSONL tool events the leak detector reads", () => {
  const messages = [
    msg("user", [text("do it")]),
    msg("assistant", [text("ok"), tool("read", { filePath: "/p/a.cpp" }), tool("bash", { command: "find / -name '*_test.cpp'" })]),
    msg("assistant", [tool("webfetch", { url: "https://x" }, "error")]),
  ]
  const lines = toolEventLines(messages)
  assert.equal(lines.split("\n").length, 3)
  const leaks = leakedAccess(lines, { proj: "/p", sensitive: [], testFiles: [], home: "/Users/x" })
  assert.equal(leaks.length, 1)
  assert.match(leaks[0], /disk search/)
})

test("continuations are user messages after the first that the rig did not send", () => {
  const messages = [
    msg("user", [text("Read INSTRUCTIONS.md")]),
    msg("assistant", [text("done")]),
    msg("user", [text("Your plan still has pending steps.")]),
    msg("assistant", [text("ok")]),
    msg("user", [text("The hidden tests failed with this output")]),
  ]
  assert.equal(continuationCount(messages, ["Read INSTRUCTIONS.md", "The hidden tests failed with this output"]), 1)
})

test("rig prompts that opencode run --attach stored wrapped in quotes are not continuations", () => {
  const messages = [
    msg("user", [text('"Read INSTRUCTIONS.md and implement x"')]),
    msg("user", [text('"The hidden tests failed with this output:\n\nerr"')]),
  ]
  assert.equal(continuationCount(messages, ["Read INSTRUCTIONS.md and implement x", "The hidden tests failed with this output:\n\nerr"]), 0)
})

test("waitIdle returns once the session stays idle for the quiet period", async () => {
  const states = ["busy", "busy", "idle", "busy", "idle", "idle", "idle"]
  let i = 0
  const fetchStatus = async () => ({ s1: { type: states[Math.min(i++, states.length - 1)] } })
  const r = await waitIdle(fetchStatus, "s1", { pollMs: 1, quietPolls: 3, timeoutMs: 5000 })
  assert.equal(r.idle, true)
  assert.equal(i, 7)
})

test("a session missing from the status map counts as idle", async () => {
  const r = await waitIdle(async () => ({}), "s1", { pollMs: 1, quietPolls: 2, timeoutMs: 5000 })
  assert.equal(r.idle, true)
})

test("waitIdle gives up at the timeout", async () => {
  const r = await waitIdle(async () => ({ s1: { type: "busy" } }), "s1", { pollMs: 2, quietPolls: 2, timeoutMs: 20 })
  assert.equal(r.idle, false)
})

test("a bench child dies with the bench when the bench is killed", async () => {
  const { tethered } = await import("../scripts/e2e/codebench/serve.mjs")
  const { spawn, spawnSync } = await import("node:child_process")
  const secs = `300.${process.pid}`
  const marker = `sleep ${secs}`
  const parent = spawn(process.execPath, ["-e", `
    const { spawnSync } = require("node:child_process")
    import(${JSON.stringify(new URL("../scripts/e2e/codebench/serve.mjs", import.meta.url).href)}).then(({ tethered }) => {
      const t = tethered("/bin/sleep", [${JSON.stringify(secs)}], process.pid)
      spawnSync(t.command, t.args, { stdio: "ignore" })
    })
  `], { stdio: "ignore" })
  const running = () => spawnSync("pgrep", ["-f", marker]).stdout.toString().trim()
  for (let i = 0; i < 50 && !running(); i++) await new Promise((r) => setTimeout(r, 100))
  assert.ok(running(), "child started")
  parent.kill("SIGKILL")
  for (let i = 0; i < 80 && running(); i++) await new Promise((r) => setTimeout(r, 100))
  assert.equal(running(), "")
  spawnSync("pkill", ["-9", "-f", marker])
})
