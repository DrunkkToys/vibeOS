// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-plan-gate-"))
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, "state")
process.env.VIBEOS_API_URL = "http://127.0.0.1:9"
process.env.VIBEOS_UNINSTALLED_MARKER_DIR = join(sandbox, "marker")
mkdirSync(process.env.VIBEOS_UNINSTALLED_MARKER_DIR, { recursive: true })
delete process.env.VIBEOS_ROUTER_ONLY
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
  selection: { enabled: true, active_slot: "brain" },
  trinity: { brain: { oc: "google/b" }, medium: { oc: "google/m" }, cheap: { oc: "google/c" } },
}))

const TASK = "Implement the zipper module in zipper.cpp and zipper.h following INSTRUCTIONS.md, handling focus moves, value updates and tree reconstruction"
const MODEL = { providerID: "google", modelID: "b" }

async function setup({ gate = "1" } = {}) {
  if (gate === null) delete process.env.VIBEOS_PLAN_GATE
  else process.env.VIBEOS_PLAN_GATE = gate
  const sent = []
  const client = { session: { promptAsync: async (req) => { sent.push(req) } } }
  const { DelegationEnforcer } = await import("../src/index.js")
  const h = await DelegationEnforcer({ client, directory: join(sandbox, "proj") })
  return { h, sent }
}

const user = (h, sid, text, agent = "vibe") =>
  h["chat.message"]({ sessionID: sid, agent, model: MODEL }, { message: { role: "user", model: { ...MODEL } }, parts: [{ type: "text", text }] })
const todos = (h, sid, list) => h.event({ event: { type: "todo.updated", properties: { sessionID: sid, todos: list } } })
const idle = (h, sid) => h.event({ event: { type: "session.idle", properties: { sessionID: sid } } })
const write = (h, sid) => h["tool.execute.before"]({ tool: "write", sessionID: sid, callID: "c" }, { args: { filePath: "/p/zipper.cpp", content: "x" } })
const bash = (h, sid, command, exit) => h["tool.execute.after"]({ tool: "bash", sessionID: sid, callID: "c", args: { command } }, { title: "", output: "", metadata: { exit } })
const edit = (h, sid) => h["tool.execute.after"]({ tool: "edit", sessionID: sid, callID: "c", args: { filePath: "/p/zipper.cpp" } }, { title: "", output: "", metadata: {} })
const td = (content, status) => ({ content, status, priority: "medium" })
const textOf = (req) => req.body.parts.map((p) => p.text).join("\n")

test("with the gate on, a write before any plan on a non-trivial task is blocked", async () => {
  const { h } = await setup()
  await user(h, "pg-1", TASK)
  await assert.rejects(write(h, "pg-1"), /plan/i)
  await todos(h, "pg-1", [td("Implement zipper", "in_progress"), td("Verify with tests", "pending")])
  await write(h, "pg-1")
})

test("the system prompt asks for a plan with a verify step when the gate is on", async () => {
  const { h } = await setup()
  await user(h, "pg-sys", TASK)
  const sys = { system: ["BASE"] }
  await h["experimental.chat.system.transform"]({ sessionID: "pg-sys", model: MODEL }, sys)
  assert.equal(sys.system[0], "BASE")
  assert.match(sys.system.slice(1).join("\n"), /todo/i)
  assert.match(sys.system.slice(1).join("\n"), /verify/i)
})

test("idle with pending steps sends one continuation naming the next step", async () => {
  const { h, sent } = await setup()
  await user(h, "pg-2", TASK)
  await todos(h, "pg-2", [td("Implement zipper", "completed"), td("Handle set_value", "pending"), td("Verify with tests", "pending")])
  await idle(h, "pg-2")
  assert.equal(sent.length, 1)
  assert.equal(sent[0].path.id, "pg-2")
  assert.match(textOf(sent[0]), /Handle set_value/)
})

test("continuations stop at three per user turn and reset on the next real user message", async () => {
  const { h, sent } = await setup()
  await user(h, "pg-3", TASK)
  await todos(h, "pg-3", [td("Implement zipper", "pending")])
  for (let i = 0; i < 5; i++) {
    await idle(h, "pg-3")
    if (sent.length > i) await user(h, "pg-3", textOf(sent[sent.length - 1]))
  }
  assert.equal(sent.length, 3)
  await user(h, "pg-3", "try again please, it still does not compile")
  await idle(h, "pg-3")
  assert.equal(sent.length, 4)
})

test("blocked, cancelled or in-progress steps and an empty plan never trigger a continuation", async () => {
  const { h, sent } = await setup()
  await user(h, "pg-4", TASK)
  await idle(h, "pg-4")
  await todos(h, "pg-4", [td("Implement zipper", "completed"), td("Run tests", "blocked"), td("Docs", "cancelled"), td("Refine", "in_progress")])
  await idle(h, "pg-4")
  assert.equal(sent.length, 0)
})

test("a verify step marked done without a passing test run continues; with one it stops", async () => {
  const { h, sent } = await setup()
  await user(h, "pg-5", TASK)
  await todos(h, "pg-5", [td("Implement zipper", "completed"), td("Verify with tests", "completed")])
  await edit(h, "pg-5")
  await idle(h, "pg-5")
  assert.equal(sent.length, 1)
  assert.match(textOf(sent[0]), /test/i)
  await user(h, "pg-5", textOf(sent[0]))
  await bash(h, "pg-5", "make test", 0)
  await idle(h, "pg-5")
  assert.equal(sent.length, 1)
})

test("a passing run of a self-built test program counts as verification", async () => {
  const { h, sent } = await setup()
  await user(h, "pg-bin", TASK)
  await todos(h, "pg-bin", [td("Implement zipper", "completed"), td("Verify with a test program", "completed")])
  await edit(h, "pg-bin")
  await bash(h, "pg-bin", "g++ -std=c++17 -o test_zipper test_zipper.cpp zipper.cpp && ./test_zipper", 0)
  await idle(h, "pg-bin")
  assert.equal(sent.length, 0)
  await bash(h, "pg-bin", "ls -la", 0)
  await bash(h, "pg-bin", "cat test_zipper.cpp", 0)
  await idle(h, "pg-bin")
  assert.equal(sent.length, 0)
})

test("a failing test run after the verify step is done also continues", async () => {
  const { h, sent } = await setup()
  await user(h, "pg-6", TASK)
  await todos(h, "pg-6", [td("Implement zipper", "completed"), td("Run the tests", "completed")])
  await bash(h, "pg-6", "python3 -m unittest zipper_test", 1)
  await idle(h, "pg-6")
  assert.equal(sent.length, 1)
})

test("the gate is off by default and then changes nothing", async () => {
  const { h, sent } = await setup({ gate: null })
  await user(h, "pg-7", TASK)
  await write(h, "pg-7")
  await todos(h, "pg-7", [td("Implement zipper", "pending")])
  await idle(h, "pg-7")
  const sys = { system: ["BASE"] }
  await h["experimental.chat.system.transform"]({ sessionID: "pg-7", model: MODEL }, sys)
  assert.deepEqual(sys.system, ["BASE"])
  assert.equal(sent.length, 0)
})

test("sessions of another agent are untouched", async () => {
  const { h, sent } = await setup()
  await user(h, "pg-8", TASK, "build")
  await write(h, "pg-8")
  await todos(h, "pg-8", [td("Implement zipper", "pending")])
  await idle(h, "pg-8")
  assert.equal(sent.length, 0)
})

test("after vibe uninstall the gate does nothing", async () => {
  const { h, sent } = await setup()
  await user(h, "pg-9", TASK)
  const { resetUninstalledMarkerCache } = await import("../src/lib/runtime-config.js")
  const marker = join(process.env.VIBEOS_UNINSTALLED_MARKER_DIR, "vibeOS-uninstalled")
  writeFileSync(marker, "x")
  resetUninstalledMarkerCache()
  try {
    await write(h, "pg-9")
    await todos(h, "pg-9", [td("Implement zipper", "pending")])
    await idle(h, "pg-9")
    assert.equal(sent.length, 0)
  } finally {
    const { rmSync } = await import("node:fs")
    rmSync(marker, { force: true })
    resetUninstalledMarkerCache()
  }
})

test("a trivial question is not blocked from writing without a plan", async () => {
  const { h } = await setup()
  await user(h, "pg-10", "list the files in src")
  await write(h, "pg-10")
})

test("vibe flow gate on|off persists the toggle", async () => {
  const { h } = await setup({ gate: null })
  const r = await h.tool.vibe.execute({ action: "flow", slot: "gate", level: "on" }, { sessionID: "pg-11" })
  assert.match(String(r), /gate/i)
  const { readFileSync } = await import("node:fs")
  assert.equal(JSON.parse(readFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), "utf8")).selection.plan_gate, true)
  await h.tool.vibe.execute({ action: "flow", slot: "gate", level: "off" }, { sessionID: "pg-11" })
  assert.equal(JSON.parse(readFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), "utf8")).selection.plan_gate, false)
})
