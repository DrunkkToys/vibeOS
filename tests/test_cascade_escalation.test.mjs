// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-cascade-"))
const prev = { HOME: process.env.HOME, VIBEOS_HOME: process.env.VIBEOS_HOME, VIBEOS_API_URL: process.env.VIBEOS_API_URL, VIBEOS_ROUTER_ONLY: process.env.VIBEOS_ROUTER_ONLY, VIBEOS_CASCADE: process.env.VIBEOS_CASCADE }
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, "state")
process.env.VIBEOS_API_URL = "http://127.0.0.1:9"
process.env.VIBEOS_ROUTER_ONLY = "1"
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
  selection: { enabled: true, active_slot: "brain" },
  trinity: {
    brain: { oc: "google/gemini-3.6-flash" },
    medium: { oc: "google/gemini-3.5-flash" },
    cheap: { oc: "other/qwen-3-mini" },
  },
}))

const CHOSEN = { providerID: "anthropic", modelID: "chosen" }
const CHEAP = { providerID: "other", modelID: "qwen-3-mini" }
const MEDIUM = { providerID: "google", modelID: "gemini-3.5-flash" }
const BRAIN = { providerID: "google", modelID: "gemini-3.6-flash" }
const TASK = "Refactor the parser in src/parse.ts and make the failing tests in tests/parse.test.ts pass"

async function hooks(cascade = "1") {
  if (cascade === null) delete process.env.VIBEOS_CASCADE
  else process.env.VIBEOS_CASCADE = cascade
  const { DelegationEnforcer } = await import("../src/index.js")
  return DelegationEnforcer({ client: null, directory: join(sandbox, "proj") })
}

async function send(h, sid, text = TASK, agent = "vibe") {
  const message = { role: "user", model: { ...CHOSEN } }
  await h["chat.message"]({ sessionID: sid, agent, model: CHOSEN }, { message, parts: [{ type: "text", text }] })
  return message.model
}

async function bash(h, sid, command, exit) {
  await h["tool.execute.after"]({ tool: "bash", sessionID: sid, callID: "c", args: { command } }, { title: command, output: "", metadata: { output: "", exit, truncated: false } })
}

test("cascade starts every task on the cheap slot", async () => {
  const h = await hooks()
  assert.deepEqual(await send(h, "s-start"), CHEAP)
})

test("a failing test run escalates the next message one slot", async () => {
  const h = await hooks()
  assert.deepEqual(await send(h, "s-esc"), CHEAP)
  await bash(h, "s-esc", "npm test", 1)
  assert.deepEqual(await send(h, "s-esc"), MEDIUM)
  await bash(h, "s-esc", "uv run pytest -q", 2)
  assert.deepEqual(await send(h, "s-esc"), BRAIN)
  await bash(h, "s-esc", "node --test tests/a.test.mjs", 1)
  assert.deepEqual(await send(h, "s-esc"), BRAIN)
})

test("only the last test run of a turn decides", async () => {
  const h = await hooks()
  await send(h, "s-last")
  await bash(h, "s-last", "pytest", 1)
  await bash(h, "s-last", "pytest", 0)
  assert.deepEqual(await send(h, "s-last"), CHEAP)
})

test("passing tests and non-test commands do not escalate", async () => {
  const h = await hooks()
  await send(h, "s-pass")
  await bash(h, "s-pass", "go test ./...", 0)
  await bash(h, "s-pass", "ls missing-dir", 1)
  await bash(h, "s-pass", "grep -r pytest .", 1)
  assert.deepEqual(await send(h, "s-pass"), CHEAP)
})

test("escalation is never undone within a session", async () => {
  const h = await hooks()
  await send(h, "s-sticky")
  await bash(h, "s-sticky", "cargo test", 101)
  assert.deepEqual(await send(h, "s-sticky"), MEDIUM)
  await bash(h, "s-sticky", "cargo test", 0)
  assert.deepEqual(await send(h, "s-sticky"), MEDIUM)
})

test("escalation survives a new process for the same session", async () => {
  const h1 = await hooks()
  await send(h1, "s-proc")
  await bash(h1, "s-proc", "npx vitest run", 1)
  assert.ok(existsSync(join(process.env.VIBEOS_HOME, "cascade-state.json")))
  const { DelegationEnforcer } = await import(`../src/index.js?fresh=${Date.now()}`)
  const h2 = await DelegationEnforcer({ client: null, directory: join(sandbox, "proj") })
  assert.deepEqual(await send(h2, "s-proc"), MEDIUM)
})

test("sessions do not share escalation", async () => {
  const h = await hooks()
  await send(h, "s-a")
  await bash(h, "s-a", "npm test", 1)
  assert.deepEqual(await send(h, "s-b"), CHEAP)
})

test("cascade leaves non-vibe agents on their chosen model", async () => {
  const h = await hooks()
  assert.deepEqual(await send(h, "s-build", TASK, "build"), CHOSEN)
})

test("cascade is off unless VIBEOS_CASCADE=1", async () => {
  const h = await hooks(null)
  assert.deepEqual(await send(h, "s-off"), CHOSEN)
})

test("cleanup", () => {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(sandbox, { recursive: true, force: true })
})
