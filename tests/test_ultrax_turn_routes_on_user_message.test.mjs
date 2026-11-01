// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-ultrax-turn-"))
const proj = join(sandbox, "proj")
mkdirSync(proj, { recursive: true })
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, "state")
process.env.VIBEOS_API_URL = "http://127.0.0.1:9"
process.env.VIBEOS_ROUTER_ONLY = "0"
process.env.VIBEOS_AGENT_GATE = "off"
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
const TIERS_FILE = join(process.env.VIBEOS_HOME, "model-tiers.json")
const TRINITY = {
  cheap: { oc: "freeprov/cheap-m" },
  medium: { oc: "gopro/flash-m" },
  brain: { oc: "gopro/pro-m" },
}
function setSelection(extra = {}) {
  writeFileSync(TIERS_FILE, JSON.stringify({
    selection: { enabled: true, active_slot: "cheap", optimization_mode: "vibeultrax", setup_completed_at: "2026-11-01T00:00:00.000Z", ...extra },
    trinity: TRINITY,
  }))
}
setSelection()

const PRO = { providerID: "gopro", modelID: "pro-m" }
const FAILURE = "The tests failed:\n/work/dnd_character_test.cpp:12: error: 'ability' was not declared in this scope\nmake: *** [Makefile:8: test] Error 1\nPlease fix the code."

const { DelegationEnforcer } = await import("../src/index.js")
const hooks = await DelegationEnforcer({ client: null, directory: proj, worktree: proj })

async function send(sid, text) {
  const message = { id: `${sid}_${Math.random()}`, sessionID: sid, role: "user", agent: "vibe", model: { ...PRO } }
  await hooks["chat.message"]({ sessionID: sid, agent: "vibe", model: { ...PRO } }, { message, parts: [{ type: "text", text }] })
  return `${message.model.providerID}/${message.model.modelID}`
}

test("a vibeultrax turn starts on the cheap tier even when the cheap tier is on another provider", async () => {
  setSelection()
  assert.equal(await send("ses_ux_turn_1", "say ok"), "freeprov/cheap-m")
})

test("a follow-up carrying failure output moves the next turn up one tier, then to brain, then stays", async () => {
  setSelection()
  const sid = "ses_ux_turn_2"
  assert.equal(await send(sid, "say ok"), "freeprov/cheap-m")
  assert.equal(await send(sid, FAILURE), "gopro/flash-m")
  assert.equal(await send(sid, FAILURE), "gopro/pro-m")
  assert.equal(await send(sid, FAILURE), "gopro/pro-m")
})

test("the first message of a session is never escalated by failure text alone", async () => {
  setSelection()
  assert.equal(await send("ses_ux_turn_3", FAILURE), "freeprov/cheap-m")
})

test("vibe lock and an explicit tier pin keep the model the user picked", async () => {
  setSelection({ slot_locked: true })
  assert.equal(await send("ses_ux_turn_4", "say ok"), "gopro/pro-m")
  setSelection({ axis_overrides: { tier: "brain" } })
  assert.equal(await send("ses_ux_turn_5", "say ok"), "gopro/pro-m")
})

test("other modes keep the model the user picked", async () => {
  setSelection({ optimization_mode: "vibeqmax" })
  assert.equal(await send("ses_ux_turn_6", "say ok"), "gopro/pro-m")
})

test("routing the turn writes no watched config file", async () => {
  setSelection()
  await send("ses_ux_turn_7", "say ok")
  assert.equal(existsSync(join(proj, "opencode.json")), false)
  assert.equal(existsSync(join(proj, "config.json")), false)
  assert.equal(existsSync(join(proj, ".opencode", "opencode.json")), false)
  assert.equal(JSON.parse(readFileSync(TIERS_FILE, "utf8")).selection.active_slot, "cheap")
})
