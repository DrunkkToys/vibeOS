// Regression: API client reconnection cooldown bug fix verification
// Bug: After API fallback, 60s cooldown reset _apiFallbackMode but never called
// markApiConnected(), leaving runtime-state.apiConnected = false permanently.
// Fix: Cooldown now calls markApiConnected(). Also 401/403 auth errors no longer
// call markApiDisconnected() since the server IS reachable (just auth failed).
// Run: node --test tests/regression_api_reconnection_cooldown.test.mjs

import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandboxes = []
let stamp = 0
const DEAD_URL = "http://127.0.0.1:1"
const MOCK_URL = "http://127.0.0.1:19999"

function fresh() {
  stamp++
  const home = mkdtempSync(join(tmpdir(), `vibeos-recon-${stamp}-`))
  sandboxes.push(home)
  mkdirSync(join(home, ".claude"), { recursive: true })

  const env = process.env
  const snap = {
    HOME: env.HOME,
    VIBEOS_API_URL: env.VIBEOS_API_URL,
    VIBEOS_API_DISABLED: env.VIBEOS_API_DISABLED,
    VIBEOS_API_TOKEN: env.VIBEOS_API_TOKEN,
    VIBEOS_MCP_PORT: env.VIBEOS_MCP_PORT,
  }

  env.HOME = home
  env.VIBEOS_API_URL = MOCK_URL
  delete env.VIBEOS_API_DISABLED
  env.VIBEOS_API_TOKEN = "vos_" + "a".repeat(64)
  env.VIBEOS_MCP_PORT = "0"
  delete globalThis.__vibeOSRuntimeState

  return { mod: import(`../src/lib/api-client.js?r=${stamp}`), snap, home }
}

async function restore(ctx) {
  const env = process.env
  env.HOME = ctx.snap.HOME
  if (ctx.snap.VIBEOS_API_URL === undefined) delete env.VIBEOS_API_URL
  else env.VIBEOS_API_URL = ctx.snap.VIBEOS_API_URL
  if (ctx.snap.VIBEOS_API_DISABLED === undefined) delete env.VIBEOS_API_DISABLED
  else env.VIBEOS_API_DISABLED = ctx.snap.VIBEOS_API_DISABLED
  if (ctx.snap.VIBEOS_API_TOKEN === undefined) delete env.VIBEOS_API_TOKEN
  else env.VIBEOS_API_TOKEN = ctx.snap.VIBEOS_API_TOKEN
  if (ctx.snap.VIBEOS_MCP_PORT === undefined) delete env.VIBEOS_MCP_PORT
  else env.VIBEOS_MCP_PORT = ctx.snap.VIBEOS_MCP_PORT
  delete globalThis.__vibeOSRuntimeState
}

after(async () => {
  for (const d of sandboxes) {
    try { rmSync(d, { recursive: true, force: true }) } catch {}
  }
})

let origFetch
let fetchHistory

before(() => {
  origFetch = global.fetch
  fetchHistory = []
})

after(() => {
  global.fetch = origFetch
})

// ── Tests ────────────────────────────────────────────────────────────

it("markApiConnected restores runtime-state (cooldown fix baseline)", async () => {
  const rs = await import("../src/lib/runtime-state.js?" + (stamp++))
  rs.markApiDisconnected()
  assert.equal(rs.isApiConnected(), false, "disconnected")
  rs.markApiConnected()
  assert.equal(rs.isApiConnected(), true, "reconnected after markApiConnected")
  delete globalThis.__vibeOSRuntimeState
})

it("401 auth error sets fallback but does NOT disconnect runtime-state", async () => {
  const ctx = fresh()
  const api = await ctx.mod

  fetchHistory = []
  const responses = [
    { ok: false, status: 401, json: async () => ({ message: "invalid token" }) },
  ]
  let callIdx = 0
  global.fetch = async (url, opts) => {
    fetchHistory.push({ url: String(url), attempt: callIdx })
    if (callIdx < responses.length) {
      const r = responses[callIdx++]
      return r
    }
    return { ok: true, status: 200, json: async () => ({ status: "ok", version: "1.0.0" }) }
  }

  const result = await api.remoteCall("health", [], () => ({ local: true }))
  assert.equal(result.local, true, "fallback invoked after 401")

  const rs = await import("../src/lib/runtime-state.js?" + (stamp++))
  assert.equal(rs.isApiConnected(), true, "runtime-state still connected after 401 (server reachable)")
  assert.equal(api.isApiFallback(), true, "_apiFallbackMode set (will retry after cooldown)")

  await restore(ctx)
  delete globalThis.__vibeOSRuntimeState
})

it("genuine network error calls markApiDisconnected", async () => {
  const ctx = fresh()
  const api = await ctx.mod

  global.fetch = async () => { throw new Error("fetch failed: ECONNREFUSED") }

  const result = await api.remoteCall("health", [], () => ({ local: true }))
  assert.equal(result.local, true, "fallback invoked after network error")

  const rs = await import("../src/lib/runtime-state.js?" + (stamp++))
  assert.equal(rs.isApiConnected(), false, "runtime-state disconnected after network error")
  assert.equal(api.isApiFallback(), true, "_apiFallbackMode set")

  await restore(ctx)
  delete globalThis.__vibeOSRuntimeState
})

it("markApiConnected fully restores runtime state for reconnection", async () => {
  const ctx = fresh()
  const api = await ctx.mod

  global.fetch = async () => { throw new Error("fetch failed: ECONNREFUSED") }
  await api.remoteCall("health", [], () => ({ local: true }))

  assert.equal(api.isApiConnected(), false, "disconnected after network error")

  const rs = await import("../src/lib/runtime-state.js?" + (stamp++))
  assert.equal(rs.isApiConnected(), false, "runtime-state confirms disconnected")

  rs.markApiConnected()
  assert.equal(rs.isApiConnected(), true, "markApiConnected restores runtime-state")
  assert.equal(rs.isApiFallbackMode(), false, "markApiConnected clears fallback mode flag")

  await restore(ctx)
  delete globalThis.__vibeOSRuntimeState
})

it("401 auth error does not permanently degrade runtime-state", async () => {
  const ctx = fresh()
  const api = await ctx.mod

  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ message: "invalid token" }),
  })

  await api.remoteCall("health", [], () => ({ local: true }))
  assert.equal(api.isApiFallback(), true, "fallback after 401")

  const rs = await import("../src/lib/runtime-state.js?" + (stamp++))
  assert.equal(rs.isApiConnected(), true, "runtime-state still connected after 401")
  assert.equal(rs.isApiFallbackMode(), false, "runtime fallback mode not set for 401")

  assert.equal(api.getBackendVersion(), "", "no version cached after failed call")

  await restore(ctx)
  delete globalThis.__vibeOSRuntimeState
})


it("isApiConnected() self-heals after cooldown WITHOUT remoteCall()", async () => {
  const ctx = fresh()
  const api = await ctx.mod

  global.fetch = async () => { throw new Error("ECONNREFUSED") }
  await api.remoteCall("health", [], () => ({ local: true }))
  assert.equal(api.isApiFallback(), true, "fallback active after network error")
  assert.equal(api.isApiConnected(), false, "disconnected after network error")

  const rs = await import("../src/lib/runtime-state.js?" + (stamp++))
  assert.equal(rs.isApiConnected(), false, "runtime confirms disconnected")

  const origDateNow = Date.now
  const fakeNow = origDateNow() + 61_000
  Date.now = () => fakeNow

  const connected = api.isApiConnected()
  assert.equal(connected, true, "isApiConnected() self-heals after cooldown elapsed (BUG FIX)")

  Date.now = origDateNow

  await restore(ctx)
  delete globalThis.__vibeOSRuntimeState
})

it("repeated 401 → cooldown → retry cycles without permanent deadlock", async () => {
  const ctx = fresh()
  const api = await ctx.mod
  const rs = await import("../src/lib/runtime-state.js?" + (stamp++))

  for (let i = 0; i < 3; i++) {
    let callCount = 0
    global.fetch = async () => {
      callCount++
      return { ok: false, status: 401, json: async () => ({ message: "invalid token" }) }
    }

    const result = await api.remoteCall("health", [], () => ({ local: true }))
    assert.equal(result.local, true, `cycle ${i + 1}: fallback invoked after 401`)
    assert.equal(api.isApiFallback(), true, `cycle ${i + 1}: fallback active`)
    assert.equal(rs.isApiConnected(), true, `cycle ${i + 1}: runtime connected (401 does not disconnect)`)

    rs.markApiConnected()
    assert.equal(rs.isApiConnected(), true, `cycle ${i + 1}: still connected after cooldown reset`)
  }

  await restore(ctx)
  delete globalThis.__vibeOSRuntimeState
})
