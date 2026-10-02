// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-router-only-"))
const prev = { HOME: process.env.HOME, VIBEOS_HOME: process.env.VIBEOS_HOME, VIBEOS_API_URL: process.env.VIBEOS_API_URL, VIBEOS_ROUTER_ONLY: process.env.VIBEOS_ROUTER_ONLY }
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, "state")
process.env.VIBEOS_API_URL = "http://127.0.0.1:9"
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
  selection: { enabled: true, active_slot: "brain", optimization_mode: "vibeultrax" },
  trinity: {
    brain: { oc: "google/gemini-3.6-flash" },
    medium: { oc: "google/gemini-3.5-flash" },
    cheap: { oc: "google/gemini-3.5-flash-lite" },
  },
}))

const SIMPLE = "list the files in src"
const MODERATE = "Refactor the authentication module across src/auth.ts, src/session.ts, src/db.ts and src/api.ts to use async token rotation, then debug the failing integration tests, fix the race condition in the cache invalidation, and redesign the error handling architecture end to end"
const GOOGLE = { providerID: "google", modelID: "gemini-3.6-flash" }

async function hooks(flag = "1") {
  if (flag === null) delete process.env.VIBEOS_ROUTER_ONLY
  else process.env.VIBEOS_ROUTER_ONLY = flag
  const { DelegationEnforcer } = await import("../src/index.js")
  return DelegationEnforcer({ client: null, directory: join(sandbox, "proj") })
}

async function turn(h, sid, text, model = GOOGLE) {
  const message = { role: "user", model: { ...model } }
  await h["chat.message"]({ sessionID: sid, agent: "vibe", model }, { message, parts: [{ type: "text", text }] })
  const messages = [{ info: { role: "user", sessionID: sid }, parts: [{ type: "text", text }] }]
  const msgs = { messages: structuredClone(messages) }
  await h["experimental.chat.messages.transform"]({ sessionID: sid }, msgs)
  const sys = { system: ["BASE"] }
  await h["experimental.chat.system.transform"]({ sessionID: sid, model }, sys)
  const params = { temperature: 0, options: {} }
  await h["chat.params"]({ sessionID: sid, agent: "vibe", model, provider: {}, message: {} }, params)
  const out = { text: "answer" }
  await h["experimental.text.complete"]({ sessionID: sid }, out)
  return { message, messages, msgs, sys, params, out }
}

test("router-only adds nothing to the prompt, the messages or the answer", async () => {
  const h = await hooks()
  for (const text of [SIMPLE, MODERATE, SIMPLE, "THIS IS BROKEN AGAIN FIX IT NOW!!!", MODERATE]) {
    const r = await turn(h, "s-clean", text)
    assert.deepEqual(r.sys.system, ["BASE"], "system prompt was modified")
    assert.deepEqual(r.msgs.messages, r.messages, "messages were modified")
    assert.equal(r.out.text, "answer", "the answer was modified")
  }
})

test("router-only moves only clearly trivial messages to the cheap slot", async () => {
  const h = await hooks()
  assert.deepEqual((await turn(h, "s-route", SIMPLE)).message.model, { providerID: "google", modelID: "gemini-3.5-flash-lite" })
  assert.deepEqual((await turn(h, "s-route", "say ok")).message.model, { providerID: "google", modelID: "gemini-3.5-flash-lite" })
})

test("router-only keeps the chosen model for anything not clearly trivial", async () => {
  const h = await hooks()
  for (const text of [
    MODERATE,
    "now refactor the auth module across three files and fix the failing tests",
    "diagnose why the dedup step drops rows in build.py",
    "why does this deadlock only happen in production?",
    "fix the off-by-one in the pagination",
  ]) {
    assert.deepEqual((await turn(h, "s-keep", text)).message.model, GOOGLE, text)
  }
})

test("router-only switches provider when the slot is on another provider", async () => {
  const h = await hooks()
  const r = await turn(h, "s-cross", SIMPLE, { providerID: "anthropic", modelID: "some-model" })
  assert.deepEqual(r.message.model, { providerID: "google", modelID: "gemini-3.5-flash-lite" })
})

test("router-only does not set chat.params options.model, which OpenCode ignores", async () => {
  const h = await hooks()
  const r = await turn(h, "s-params", SIMPLE)
  assert.equal(r.params.options.model, undefined)
})

test("router-only leaves non-vibe agents alone", async () => {
  const h = await hooks()
  const message = { role: "user", model: { ...GOOGLE } }
  await h["chat.message"]({ sessionID: "s-build", agent: "build", model: GOOGLE }, { message, parts: [{ type: "text", text: SIMPLE }] })
  assert.deepEqual(message.model, GOOGLE)
})

test("router-only leaves vibe tier subagents on their own model", async () => {
  const h = await hooks()
  const brain = { providerID: "google", modelID: "gemini-3.6-flash" }
  const message = { role: "user", model: { ...brain } }
  await h["chat.message"]({ sessionID: "s-sub", agent: "vibe-brain", model: brain }, { message, parts: [{ type: "text", text: SIMPLE }] })
  assert.deepEqual(message.model, brain)
})

test("router-only is the default when VIBEOS_ROUTER_ONLY is unset", async () => {
  const h = await hooks(null)
  const r = await turn(h, "s-default", SIMPLE)
  assert.deepEqual(r.sys.system, ["BASE"])
  assert.equal(r.out.text, "answer")
  assert.deepEqual(r.message.model, { providerID: "google", modelID: "gemini-3.5-flash-lite" })
})

test("VIBEOS_ROUTER_ONLY=0 restores the full plugin", async () => {
  const h = await hooks("0")
  const r = await turn(h, "s-full", SIMPLE)
  assert.notEqual(r.out.text, "answer", "the full plugin appends its footer")
})

test("router-only registers only the vibe tool", async () => {
  const h = await hooks("1")
  assert.deepEqual(Object.keys(h.tool), ["vibe"])
})

test("the full plugin keeps all its tools", async () => {
  const h = await hooks("0")
  assert.ok(Object.keys(h.tool).includes("trinity"))
  assert.ok(Object.keys(h.tool).includes("report-save"))
})

test("cleanup", () => {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(sandbox, { recursive: true, force: true })
})
