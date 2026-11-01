// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-ultrax-selftest-"))
const proj = join(sandbox, "proj")
mkdirSync(proj, { recursive: true })
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, "state")
process.env.VIBEOS_API_URL = "http://127.0.0.1:9"
process.env.VIBEOS_ROUTER_ONLY = "0"
process.env.VIBEOS_AGENT_GATE = "off"
process.env.VIBEOS_PLAN_GATE = "0"
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
const TIERS_FILE = join(process.env.VIBEOS_HOME, "model-tiers.json")
function setSelection(extra = {}) {
  writeFileSync(TIERS_FILE, JSON.stringify({
    selection: { enabled: true, active_slot: "cheap", optimization_mode: "vibeultrax", setup_completed_at: "2026-11-01T00:00:00.000Z", ...extra },
    trinity: { cheap: { oc: "freeprov/cheap-m" }, medium: { oc: "gopro/flash-m" }, brain: { oc: "gopro/pro-m" } },
  }))
}
setSelection()

const sent = []
const client = { session: { promptAsync: async (req) => { sent.push(req) } } }
const { DelegationEnforcer } = await import("../src/index.js")
const hooks = await DelegationEnforcer({ client, directory: proj, worktree: proj })
const PRO = { providerID: "gopro", modelID: "pro-m" }
const COMPILE_ERROR = "dnd_character_test.cpp:12:5: error: 'ability' was not declared in this scope\nmake: *** [Makefile:8: test] Error 1"

async function send(sid, text) {
  const message = { id: `${sid}_${Math.random()}`, sessionID: sid, role: "user", agent: "vibe", model: { ...PRO } }
  await hooks["chat.message"]({ sessionID: sid, agent: "vibe", model: { ...PRO } }, { message, parts: [{ type: "text", text }] })
  return `${message.model.providerID}/${message.model.modelID}`
}
async function runTests(sid, exit, output) {
  await hooks["tool.execute.after"]({ tool: "bash", sessionID: sid, callID: `c${Math.random()}`, args: { command: "make test" } }, { title: "", output, metadata: { exit } })
}
async function idle(sid) {
  const before = sent.length
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: sid } } })
  return sent.slice(before)
}

test("when the cheap tier stops on its own failing test, the turn continues on the next tier with the failure", async () => {
  setSelection()
  const sid = "ses_ux_self_1"
  assert.equal(await send(sid, "Implement the dnd character exercise in dnd_character.cpp"), "freeprov/cheap-m")
  await runTests(sid, 2, COMPILE_ERROR)
  const out = await idle(sid)
  assert.equal(out.length, 1)
  const text = out[0].body.parts[0].text
  assert.match(text, /error: 'ability' was not declared/)
  assert.equal(await send(sid, text), "gopro/flash-m")
  await runTests(sid, 2, COMPILE_ERROR)
  const again = await idle(sid)
  assert.equal(again.length, 1)
  assert.equal(await send(sid, again[0].body.parts[0].text), "gopro/pro-m")
  await runTests(sid, 2, COMPILE_ERROR)
  assert.equal((await idle(sid)).length, 0, "brain is the top of the ladder")
})

test("a passing test run, or no test run, sends nothing", async () => {
  setSelection()
  const sid = "ses_ux_self_2"
  await send(sid, "Implement the dnd character exercise in dnd_character.cpp")
  assert.equal((await idle(sid)).length, 0)
  await runTests(sid, 2, COMPILE_ERROR)
  await runTests(sid, 0, "All tests passed")
  assert.equal((await idle(sid)).length, 0)
})

test("one failing run escalates once, not on every idle", async () => {
  setSelection()
  const sid = "ses_ux_self_3"
  await send(sid, "Implement the dnd character exercise in dnd_character.cpp")
  await runTests(sid, 2, COMPILE_ERROR)
  assert.equal((await idle(sid)).length, 1)
  assert.equal((await idle(sid)).length, 0)
})

test("other modes, a locked model and tier subagents never escalate", async () => {
  setSelection({ optimization_mode: "vibeqmax" })
  await send("ses_ux_self_4", "Implement the dnd character exercise")
  await runTests("ses_ux_self_4", 2, COMPILE_ERROR)
  assert.equal((await idle("ses_ux_self_4")).length, 0)
  setSelection({ slot_locked: true })
  await send("ses_ux_self_5", "Implement the dnd character exercise")
  await runTests("ses_ux_self_5", 2, COMPILE_ERROR)
  assert.equal((await idle("ses_ux_self_5")).length, 0)
  setSelection()
  const child = "ses_ux_self_child"
  await hooks["chat.message"]({ sessionID: child, agent: "vibe-medium", model: { ...PRO } }, { message: { role: "user", agent: "vibe-medium", model: { ...PRO } }, parts: [{ type: "text", text: "fix it" }] })
  await runTests(child, 2, COMPILE_ERROR)
  assert.equal((await idle(child)).length, 0)
})
