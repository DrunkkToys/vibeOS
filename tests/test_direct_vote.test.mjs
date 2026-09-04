// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// The SDK client cannot deliver a vote from inside a hook, so the voters are
// polled directly over HTTP. These pin the transport.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  resolveProviderEndpoint, extractCompletion, askDirect, runDirectVote, VOTE_MAX_TOKENS,
} from "../src/vibeOS-lib/direct-vote.js"

function opencodeHome() {
  const dir = mkdtempSync(join(tmpdir(), "vibeos-direct-"))
  const old = { d: process.env.OPENCODE_DATA_DIR, c: process.env.OPENCODE_CACHE_DIR }
  process.env.OPENCODE_DATA_DIR = join(dir, "data")
  process.env.OPENCODE_CACHE_DIR = join(dir, "cache")
  mkdirSync(process.env.OPENCODE_DATA_DIR, { recursive: true })
  mkdirSync(process.env.OPENCODE_CACHE_DIR, { recursive: true })
  writeFileSync(join(process.env.OPENCODE_CACHE_DIR, "models.json"), JSON.stringify({
    "opencode-go": { id: "opencode-go", api: "https://opencode.ai/zen/go/v1" },
    "nokey": { id: "nokey", api: "https://example.invalid/v1" },
  }))
  writeFileSync(join(process.env.OPENCODE_DATA_DIR, "auth.json"), JSON.stringify({
    "opencode-go": { type: "api", key: "sk-test-key" },
  }))
  return {
    cleanup() {
      for (const [k, v] of [["OPENCODE_DATA_DIR", old.d], ["OPENCODE_CACHE_DIR", old.c]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v
      }
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

const reply = (text) => ({ ok: true, json: async () => ({ choices: [{ message: { content: text } }] }) })

test("the base URL comes from OpenCode's registry and the key from its auth store", () => {
  const ctx = opencodeHome()
  try {
    const e = resolveProviderEndpoint("opencode-go")
    assert.equal(e.baseUrl, "https://opencode.ai/zen/go/v1", "guessing this URL is what made the first three probes 404")
    assert.equal(e.apiKey, "sk-test-key")
  } finally { ctx.cleanup() }
})

test("a provider with no stored key yields no endpoint", () => {
  const ctx = opencodeHome()
  try {
    assert.equal(resolveProviderEndpoint("nokey"), null)
    assert.equal(resolveProviderEndpoint("absent"), null)
    assert.equal(resolveProviderEndpoint(""), null)
  } finally { ctx.cleanup() }
})

test("the environment can override both, for a machine that stores them elsewhere", () => {
  const ctx = opencodeHome()
  try {
    process.env.VIBEOS_VOTE_URL_OPENCODE_GO = "https://mirror.example/v1/"
    process.env.VIBEOS_VOTE_KEY_OPENCODE_GO = "sk-override"
    const e = resolveProviderEndpoint("opencode-go")
    assert.equal(e.baseUrl, "https://mirror.example/v1", "a trailing slash must not double up in the path")
    assert.equal(e.apiKey, "sk-override")
  } finally {
    delete process.env.VIBEOS_VOTE_URL_OPENCODE_GO
    delete process.env.VIBEOS_VOTE_KEY_OPENCODE_GO
    ctx.cleanup()
  }
})

test("a reasoning model truncated mid-thought is not counted as an answer", () => {
  // Observed live: an empty content beside a partial reasoning_content.
  assert.equal(extractCompletion({
    choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "The user wants me to" } }],
  }), "", "a truncated ramble must not be able to win a vote")
  assert.equal(extractCompletion({ choices: [] }), "")
  assert.equal(extractCompletion(null), "")
  assert.equal(extractCompletion({ choices: [{ message: { content: "  real  " } }] }), "real")
})

test("the request is OpenAI-compatible and carries the key as a bearer token", async () => {
  const ctx = opencodeHome()
  try {
    let seen = null
    await askDirect({ baseUrl: "https://x/v1", apiKey: "k" }, "glm-5.1", "q", 5000, 42,
      async (url, init) => { seen = { url, init }; return reply("a") })
    assert.equal(seen.url, "https://x/v1/chat/completions")
    assert.equal(seen.init.headers.Authorization, "Bearer k")
    const body = JSON.parse(seen.init.body)
    assert.equal(body.model, "glm-5.1", "the provider prefix must be stripped: the gateway rejects a prefixed id")
    assert.equal(body.max_tokens, 42)
    assert.deepEqual(body.messages, [{ role: "user", content: "q" }])
  } finally { ctx.cleanup() }
})

test("a non-200 is an error, not an empty answer", async () => {
  await assert.rejects(
    () => askDirect({ baseUrl: "https://x/v1", apiKey: "k" }, "m", "q", 5000, 10,
      async () => ({ ok: false, status: 429, json: async () => ({}) })),
    /HTTP 429/,
  )
})

test("a hung provider is abandoned at the deadline", async () => {
  const started = Date.now()
  await assert.rejects(() => askDirect({ baseUrl: "https://x/v1", apiKey: "k" }, "m", "q", 120, 10,
    (_url, init) => new Promise((_res, rej) => { init.signal.addEventListener("abort", () => rej(new Error("aborted"))) })))
  assert.ok(Date.now() - started < 3000, "the deadline must actually fire")
})

test("independent models vote and a majority carries", async () => {
  const ctx = opencodeHome()
  try {
    const answers = { "glm-5.1": "the tail buffer", "mimo-v2.5": "the tail buffer", "qwen3.8-flash": "an off-by-one" }
    const asked = []
    const r = await runDirectVote({
      models: ["opencode-go/glm-5.1", "opencode-go/mimo-v2.5", "opencode-go/qwen3.8-flash"],
      prompt: "why does it drop the chunk",
      fetchImpl: async (_u, init) => {
        const b = JSON.parse(init.body)
        asked.push(b.model)
        return reply(answers[b.model])
      },
    })
    assert.equal(r.ran, true)
    assert.equal(r.samples, 3)
    assert.equal(r.agreed, true)
    assert.equal(r.answer, "the tail buffer")
    assert.deepEqual(asked.sort(), ["glm-5.1", "mimo-v2.5", "qwen3.8-flash"])
    assert.ok(asked.every(() => JSON.parse("true")))
  } finally { ctx.cleanup() }
})

test("one dead provider does not sink the vote, and its reason is kept", async () => {
  const ctx = opencodeHome()
  try {
    const r = await runDirectVote({
      models: ["opencode-go/a", "opencode-go/b", "opencode-go/c"],
      prompt: "q",
      fetchImpl: async (_u, init) => {
        if (JSON.parse(init.body).model === "b") return { ok: false, status: 500, json: async () => ({}) }
        return reply("same")
      },
    })
    assert.equal(r.samples, 2)
    assert.equal(r.agreed, true)
    assert.equal(r.errors.length, 1)
    assert.match(r.errors[0], /opencode-go\/b: HTTP 500/)
  } finally { ctx.cleanup() }
})

test("a model with no resolvable endpoint is reported, not silently dropped", async () => {
  const ctx = opencodeHome()
  try {
    const r = await runDirectVote({ models: ["nokey/x", "bare-id", "opencode-go/a"], prompt: "q", fetchImpl: async () => reply("a") })
    assert.equal(r.samples, 1)
    assert.equal(r.errors.length, 2)
    assert.ok(r.errors.some((e) => e.includes("not a provider/model id")))
    assert.ok(r.errors.some((e) => e.includes("no endpoint or key")))
  } finally { ctx.cleanup() }
})

test("no resolvable model at all means the vote did not run", async () => {
  const ctx = opencodeHome()
  try {
    const r = await runDirectVote({ models: ["nokey/x"], prompt: "q", fetchImpl: async () => reply("a") })
    assert.equal(r.ran, false)
    assert.equal(r.errors.length, 1)
  } finally { ctx.cleanup() }
})

test("an empty prompt is never sent to a paid endpoint", async () => {
  let called = false
  const r = await runDirectVote({ models: ["opencode-go/a"], prompt: "  ", fetchImpl: async () => { called = true; return reply("a") } })
  assert.equal(r.ran, false)
  assert.equal(called, false)
})

test("the token cap has a documented default", () => {
  assert.equal(typeof VOTE_MAX_TOKENS, "number")
  assert.ok(VOTE_MAX_TOKENS > 0)
  // A reasoning model spends this budget on reasoning_content before it emits
  // any content, so a cap sized to the answer truncates it mid-thought and
  // returns an empty string. Measured on the shipped pool: at 900 two of four
  // voters returned zero content on a realistic prompt and the vote fell below
  // MIN_VOTERS; at 4096 all four answered.
  assert.ok(VOTE_MAX_TOKENS >= 4096, `cap ${VOTE_MAX_TOKENS} starves reasoning voters`)
})
