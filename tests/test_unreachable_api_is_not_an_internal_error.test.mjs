// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-api-down-"))
const proj = join(sandbox, "proj")
mkdirSync(proj, { recursive: true })
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, "state")
process.env.VIBEOS_API_URL = "http://127.0.0.1:1"
process.env.VIBEOS_API_TOKEN = "vos_" + "a".repeat(64)
process.env.VIBEOS_ROUTER_ONLY = "0"
process.env.VIBEOS_AGENT_GATE = "off"
process.env.VIBEOS_API_FALLBACK_COOLDOWN_MS = "0"
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
  selection: { enabled: true, active_slot: "cheap", optimization_mode: "vibeultrax", setup_completed_at: "2026-11-01T00:00:00.000Z" },
  trinity: { cheap: { oc: "p/cheap-m" }, medium: { oc: "p/medium-m" }, brain: { oc: "p/brain-m" } },
}))

const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  if (String(url).includes("classify")) throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" }) })
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
}

const { DelegationEnforcer, _escalateOnGateFailureForTest } = await import("../src/index.js")
const { loadSelection } = await import("../src/lib/selection-manager.js")
const hooks = await DelegationEnforcer({ client: null, directory: proj, worktree: proj })

function internalErrors() {
  const dir = join(process.env.VIBEOS_HOME, "session-events")
  return existsSync(dir)
    ? readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))).filter((r) => r.kind === "footer-error").map((r) => String(r.message))
    : []
}

test("the vibeOS API dropping mid-session falls back without filing internal errors", async () => {
  const sid = "ses_api_down_1"
  const model = { providerID: "p", modelID: "cheap-m" }
  try {
    for (const text of ["Implement the parser in src/parser.ts and make the tests pass", "The tests failed:\nparser.ts:3:1: error: expected ';'"]) {
      const message = { id: `${sid}_${text.length}`, sessionID: sid, role: "user", agent: "vibe", model: { ...model } }
      const parts = [{ type: "text", text }]
      await hooks["chat.message"]({ sessionID: sid, agent: "vibe", model }, { message, parts })
      await hooks["experimental.chat.system.transform"]({ sessionID: sid, model: { id: "cheap-m", providerID: "p" } }, { system: ["BASE"] })
      await hooks["experimental.chat.messages.transform"]({ sessionID: sid }, { messages: [{ info: message, parts }] })
    }
  } finally {
    globalThis.fetch = realFetch
  }
  assert.deepEqual(internalErrors().filter((m) => /reach API|ECONNREFUSED|fetch failed/i.test(m)), [])
})

test("escalating after a failed quality gate is routing, not an internal error", () => {
  _escalateOnGateFailureForTest({ passed: false, score: 0.1, reasons: ["tests failed"] }, loadSelection(), "ses_api_down_2")
  assert.deepEqual(internalErrors().filter((m) => /quality gate/i.test(m)), [])
})
