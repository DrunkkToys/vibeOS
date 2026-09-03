// Regression: once the backend is proven unreachable, remoteCall() must stop
// paying the retry ladder on every subsequent call.
//
// Measured 2026-09-02 against a refused port: one remoteCall costs 7.0s (four
// attempts plus 1+2+4s backoff). The plugin makes several per turn, which put a
// ~49s dead gap in front of every model step -- 16x raw opencode. _apiFallbackMode
// was supposed to prevent this, but syncApiTokenFromDisk() runs at the top of
// remoteCall and clears the flag before it is ever read, so the breaker never
// latched. FALLBACK_COOLDOWN_MS and _apiFallbackSince were both declared for this
// and wired to nothing.
//
// Run: node --test tests/test_api_fallback_cooldown.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

let stamp = 0

function fresh(cooldownMs) {
  stamp++
  const home = mkdtempSync(join(tmpdir(), `vibeos-cooldown-${stamp}-`))
  mkdirSync(join(home, ".claude"), { recursive: true })
  const env = process.env
  const snap = {
    HOME: env.HOME,
    VIBEOS_HOME: env.VIBEOS_HOME,
    VIBEOS_API_URL: env.VIBEOS_API_URL,
    VIBEOS_API_TOKEN: env.VIBEOS_API_TOKEN,
    VIBEOS_MCP_PORT: env.VIBEOS_MCP_PORT,
    VIBEOS_API_FALLBACK_COOLDOWN_MS: env.VIBEOS_API_FALLBACK_COOLDOWN_MS,
  }
  env.HOME = home
  env.VIBEOS_HOME = home
  env.VIBEOS_API_URL = "http://127.0.0.1:1"
  env.VIBEOS_API_TOKEN = "vos_" + "a".repeat(64)
  env.VIBEOS_MCP_PORT = "0"
  if (cooldownMs !== undefined) env.VIBEOS_API_FALLBACK_COOLDOWN_MS = String(cooldownMs)
  delete globalThis.__vibeOSRuntimeState
  return { api: import(`../src/lib/api-client.js?cd=${stamp}`), snap }
}

function restore(ctx) {
  const env = process.env
  for (const [k, v] of Object.entries(ctx.snap)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  delete globalThis.__vibeOSRuntimeState
}

test("a second remoteCall to a proven-dead backend short-circuits instead of re-running the retry ladder", async () => {
  const ctx = fresh(60_000)
  const api = await ctx.api
  try {
    const t1 = Date.now()
    assert.equal(await api.remoteCall("delegateCheck", ["write", "brain", "m", {}], () => "fb1"), "fb1")
    const first = Date.now() - t1
    assert.ok(first > 1000, `the first call must actually try the wire (took ${first}ms)`)

    const t2 = Date.now()
    assert.equal(await api.remoteCall("delegateCheck", ["write", "brain", "m", {}], () => "fb2"), "fb2")
    const second = Date.now() - t2
    assert.ok(second < 500, `the second call must short-circuit, took ${second}ms (ladder re-run)`)
  } finally {
    restore(ctx)
  }
})

test("the cooldown expires so a recovered backend is picked up again", async () => {
  const ctx = fresh(150)
  const api = await ctx.api
  try {
    await api.remoteCall("delegateCheck", ["write", "brain", "m", {}], () => "fb1")
    await new Promise((r) => setTimeout(r, 300))
    const t = Date.now()
    await api.remoteCall("delegateCheck", ["write", "brain", "m", {}], () => "fb2")
    const elapsed = Date.now() - t
    assert.ok(elapsed > 1000, `after the cooldown the API must be retried (took ${elapsed}ms)`)
  } finally {
    restore(ctx)
  }
})

test("setApiToken re-arms the API immediately, ignoring an active cooldown", async () => {
  const ctx = fresh(60_000)
  const api = await ctx.api
  try {
    await api.remoteCall("delegateCheck", ["write", "brain", "m", {}], () => "fb1")
    api.setApiToken("vos_" + "c".repeat(64))
    assert.equal(api.isApiFallback(), false, "fallback cleared by setApiToken")
    const t = Date.now()
    await api.remoteCall("delegateCheck", ["write", "brain", "m", {}], () => "fb2")
    const elapsed = Date.now() - t
    assert.ok(elapsed > 1000, `an explicit token reset must retry the wire (took ${elapsed}ms)`)
  } finally {
    restore(ctx)
  }
})
