// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, realpathSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const root = realpathSync(mkdtempSync(join(tmpdir(), "vibeos-turn-cfg-")))
const home = join(root, "home")
const proj = join(root, "proj")
const preset = join(root, "preset")
mkdirSync(home, { recursive: true })
mkdirSync(proj, { recursive: true })
mkdirSync(preset, { recursive: true })
process.env.HOME = home
process.env.VIBEOS_HOME = join(home, ".vibeos")
process.env.VIBEOS_ROUTER_ONLY = "0"
process.env.VIBEOS_API_URL = "http://127.0.0.1:9"
process.env.VIBEOS_AGENT_GATE = "off"

const stub = new Proxy(() => {}, { get: (t, k) => (k === "then" ? undefined : stub), apply: async () => ({ data: {} }) })
const { default: plugin } = await import(join(ROOT, "dist", "vibeOS.js"))

async function turn(directory, sid) {
  const hooks = await plugin.server({ client: stub, directory, worktree: directory, project: { id: "p" }, $: stub })
  const user = { id: `${sid}_u`, sessionID: sid, role: "user", agent: "vibe", model: { providerID: "opencode", modelID: "x" } }
  const parts = [{ type: "text", text: "fix the failing test in parser.ts and run npm test" }]
  await hooks["chat.message"]?.({ sessionID: sid, agent: "vibe", model: user.model, messageID: user.id }, { message: user, parts })
  await hooks["chat.params"]?.({ sessionID: sid, agent: "vibe", model: { providerID: "opencode", id: "x" }, provider: {}, message: user }, { temperature: 0, topP: 1, options: {} })
  await hooks["experimental.chat.system.transform"]?.({ sessionID: sid }, { system: ["You are OpenCode."] })
  await hooks["experimental.chat.messages.transform"]?.({ sessionID: sid }, { messages: [{ info: user, parts }] })
  await hooks["experimental.text.complete"]?.({ sessionID: sid, messageID: `${sid}_a`, partID: "p1" }, { text: "Done." })
}

test("a turn in a project without opencode.json does not create one", async () => {
  await turn(proj, "ses_turn_cfg_1")
  assert.equal(existsSync(join(proj, "opencode.json")), false)
  assert.equal(existsSync(join(proj, ".opencode", "opencode.json")), false)
})

test("a turn does not rewrite a project's existing opencode.json", async () => {
  const before = JSON.stringify({ $schema: "https://opencode.ai/config.json", model: "opencode/x" }, null, 2)
  writeFileSync(join(preset, "opencode.json"), before)
  await turn(preset, "ses_turn_cfg_2")
  assert.equal(readFileSync(join(preset, "opencode.json"), "utf8"), before)
  assert.equal(existsSync(join(preset, ".opencode", "opencode.json")), false)
})
