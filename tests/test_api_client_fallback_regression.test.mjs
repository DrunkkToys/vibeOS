// Regression: setApiToken() must reset _apiFallbackMode, _apiClient, _apiFallbackSince,
// and restore the runtime connection state so subsequent remoteCall() attempts can proceed.
//
// Without these resets, a failed API call deadlocks the module permanently.
// Run: node --test tests/test_api_client_fallback_regression.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandboxes = []
let stamp = 0
const EMBEDDED_BOOTSTRAP_TOKEN = "vos_8d73804b13bb46711b9a47f036dba7b4d026fd9583d96960e663716e62815a69"

// Force a dead API endpoint so remoteCall() fails and sets _apiFallbackMode.
// Use VIBEOS_API_DISABLED=false + explicit token to ensure the client is created,
// but with a bogus URL so every call fails.
function fresh() {
  stamp++
  const home = mkdtempSync(join(tmpdir(), `vibeos-api-${stamp}-`))
  sandboxes.push(home)
  mkdirSync(join(home, ".claude"), { recursive: true })

  const env = process.env
  const snap = {
    HOME: env.HOME,
    VIBEOS_HOME: env.VIBEOS_HOME,
    VIBEOS_API_URL: env.VIBEOS_API_URL,
    VIBEOS_API_TOKEN: env.VIBEOS_API_TOKEN,
    VIBEOS_MCP_PORT: env.VIBEOS_MCP_PORT,
    VIBEOS_REMOTE_LATENCY_DEGRADE_MS: env.VIBEOS_REMOTE_LATENCY_DEGRADE_MS,
    VIBEOS_REMOTE_LATENCY_DEGRADE_COOLDOWN_MS: env.VIBEOS_REMOTE_LATENCY_DEGRADE_COOLDOWN_MS,
  }

  env.HOME = home
  env.VIBEOS_HOME = home
  env.VIBEOS_API_URL = "http://127.0.0.1:1"
  env.VIBEOS_API_TOKEN = "vos_" + "a".repeat(64)
  env.VIBEOS_MCP_PORT = "0"
  delete globalThis.__vibeOSRuntimeState

  return { api: import(`../src/lib/api-client.js?r=${stamp}`), snap, home }
}

async function restore(ctx) {
  const env = process.env
  env.HOME = ctx.snap.HOME
  if (ctx.snap.VIBEOS_HOME === undefined) delete env.VIBEOS_HOME
  else env.VIBEOS_HOME = ctx.snap.VIBEOS_HOME
  if (ctx.snap.VIBEOS_API_URL === undefined) delete env.VIBEOS_API_URL
  else env.VIBEOS_API_URL = ctx.snap.VIBEOS_API_URL
  if (ctx.snap.VIBEOS_API_TOKEN === undefined) delete env.VIBEOS_API_TOKEN
  else env.VIBEOS_API_TOKEN = ctx.snap.VIBEOS_API_TOKEN
  if (ctx.snap.VIBEOS_MCP_PORT === undefined) delete env.VIBEOS_MCP_PORT
  else env.VIBEOS_MCP_PORT = ctx.snap.VIBEOS_MCP_PORT
  if (ctx.snap.VIBEOS_REMOTE_LATENCY_DEGRADE_MS === undefined) delete env.VIBEOS_REMOTE_LATENCY_DEGRADE_MS
  else env.VIBEOS_REMOTE_LATENCY_DEGRADE_MS = ctx.snap.VIBEOS_REMOTE_LATENCY_DEGRADE_MS
  if (ctx.snap.VIBEOS_REMOTE_LATENCY_DEGRADE_COOLDOWN_MS === undefined) delete env.VIBEOS_REMOTE_LATENCY_DEGRADE_COOLDOWN_MS
  else env.VIBEOS_REMOTE_LATENCY_DEGRADE_COOLDOWN_MS = ctx.snap.VIBEOS_REMOTE_LATENCY_DEGRADE_COOLDOWN_MS
  delete globalThis.__vibeOSRuntimeState
}

async function restoreFull(ctx) {
  const env = process.env
  env.HOME = ctx.snap.HOME
  if (ctx.snap.VIBEOS_HOME === undefined) delete env.VIBEOS_HOME
  else env.VIBEOS_HOME = ctx.snap.VIBEOS_HOME
  if (ctx.snap.VIBEOS_API_URL === undefined) delete env.VIBEOS_API_URL
  else env.VIBEOS_API_URL = ctx.snap.VIBEOS_API_URL
  if (ctx.snap.VIBEOS_API_TOKEN === undefined) delete env.VIBEOS_API_TOKEN
  else env.VIBEOS_API_TOKEN = ctx.snap.VIBEOS_API_TOKEN
  if (ctx.snap.VIBEOS_API_BOOTSTRAP_TOKEN === undefined) delete env.VIBEOS_API_BOOTSTRAP_TOKEN
  else env.VIBEOS_API_BOOTSTRAP_TOKEN = ctx.snap.VIBEOS_API_BOOTSTRAP_TOKEN
  if (ctx.snap.VIBEOS_MCP_PORT === undefined) delete env.VIBEOS_MCP_PORT
  else env.VIBEOS_MCP_PORT = ctx.snap.VIBEOS_MCP_PORT
  delete globalThis.__vibeOSRuntimeState
}

// ── Tests ────────────────────────────────────────────────────────────

test("setApiToken clears _apiFallbackMode after a failed API call", async () => {
  const ctx = fresh()
  const api = await ctx.api
  try {
    assert.equal(api.isApiFallback(), false, "not in fallback initially")

    // Trigger failure -> sets _apiFallbackMode = true
    const r = await api.remoteCall("health", [], () => "fallback_used")
    assert.equal(r, "fallback_used", "falls back on unreachable API")
    assert.equal(api.isApiFallback(), true, "in fallback after failure")

    // THE FIX: setApiToken must clear _apiFallbackMode
    api.setApiToken("vos_" + "b".repeat(64))

    assert.equal(api.isApiConnected(), true, "enabled (apiEnabled=true)")
    assert.equal(api.isApiFallback(), false, "fallback cleared by setApiToken")
  } finally {
    await restore(ctx)
  }
})

test("after setApiToken, a remoteCall actually tries the API instead of short-circuiting", async () => {
  const ctx = fresh()
  const api = await ctx.api
  try {
    // Trigger fallback
    await api.remoteCall("health", [], () => "fallback1")
    assert.equal(api.isApiFallback(), true, "in fallback")

    // THE FIX: clear state
    api.setApiToken("vos_" + "c".repeat(64))
    assert.equal(api.isApiFallback(), false, "fallback cleared")
    // After setApiToken, the runtime is marked connected again.
    assert.equal(api.isApiConnected(), true, "apiEnabled still true after setApiToken")

    // The next remoteCall must try the fetch (not short-circuit) -> fails -> back to fallback
    const r2 = await api.remoteCall("health", [], () => "fallback2")
    assert.equal(r2, "fallback2", "second call fell back (API still unreachable)")
    assert.equal(api.isApiFallback(), true, "back in fallback after second attempt")
  } finally {
    await restore(ctx)
  }
})

test("syncApiTokenFromDisk else branch also clears fallback (via setApiToken with same token)", async () => {
  const ctx = fresh()
  const api = await ctx.api
  try {
    await api.remoteCall("health", [], () => "fallback")
    assert.equal(api.isApiFallback(), true, "in fallback")

    api.setApiToken(api.VIBEOS_API_TOKEN) // same token — exercise else branch during persist

    assert.equal(api.isApiFallback(), false, "fallback cleared after setApiToken with same token")
  } finally {
    await restore(ctx)
  }
})

test("primary VIBEOS_HOME token beats stale cwd disable file", async () => {
  stamp++
  const home = mkdtempSync(join(tmpdir(), `vibeos-home-${stamp}-`))
  const cwd = mkdtempSync(join(tmpdir(), `vibeos-cwd-${stamp}-`))
  sandboxes.push(home, cwd)
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, ".env.production"), `VIBEOS_API_TOKEN=vos_${"d".repeat(64)}\n`)
  writeFileSync(join(cwd, ".env.production"), "# VIBEOS_API_DISABLED removed - API is purely token-based\n")

  const env = process.env
  const snap = {
    HOME: env.HOME,
    VIBEOS_HOME: env.VIBEOS_HOME,
    cwd: process.cwd(),
    VIBEOS_API_URL: env.VIBEOS_API_URL,
    VIBEOS_API_TOKEN: env.VIBEOS_API_TOKEN,
    VIBEOS_API_BOOTSTRAP_TOKEN: env.VIBEOS_API_BOOTSTRAP_TOKEN,
    VIBEOS_MCP_PORT: env.VIBEOS_MCP_PORT,
  }

  env.HOME = home
  env.VIBEOS_HOME = home
  delete env.VIBEOS_API_TOKEN
  delete env.VIBEOS_API_BOOTSTRAP_TOKEN
  env.VIBEOS_MCP_PORT = "0"
  process.chdir(cwd)
  delete globalThis.__vibeOSRuntimeState

  try {
    const api = await import(`../src/lib/api-client.js?r=home-${stamp}`)
    assert.equal(api.VIBEOS_API_TOKEN, `vos_${"d".repeat(64)}`)
    assert.ok(api.getApiClient(), "client should be created from the VIBEOS_HOME token")
  } finally {
    process.chdir(snap.cwd)
    env.HOME = snap.HOME
    if (snap.VIBEOS_HOME === undefined) delete env.VIBEOS_HOME
    else env.VIBEOS_HOME = snap.VIBEOS_HOME
    if (snap.VIBEOS_API_URL === undefined) delete env.VIBEOS_API_URL
    else env.VIBEOS_API_URL = snap.VIBEOS_API_URL
    if (snap.VIBEOS_API_TOKEN === undefined) delete env.VIBEOS_API_TOKEN
    else env.VIBEOS_API_TOKEN = snap.VIBEOS_API_TOKEN
    if (snap.VIBEOS_API_BOOTSTRAP_TOKEN === undefined) delete env.VIBEOS_API_BOOTSTRAP_TOKEN
    else env.VIBEOS_API_BOOTSTRAP_TOKEN = snap.VIBEOS_API_BOOTSTRAP_TOKEN
    if (snap.VIBEOS_MCP_PORT === undefined) delete env.VIBEOS_MCP_PORT
    else env.VIBEOS_MCP_PORT = snap.VIBEOS_MCP_PORT
    delete globalThis.__vibeOSRuntimeState
  }
})

test("embedded bootstrap token stays in bootstrap lane and exchanges before remoteCall", async () => {
  stamp++
  const home = mkdtempSync(join(tmpdir(), `vibeos-bootstrap-${stamp}-`))
  sandboxes.push(home)
  mkdirSync(join(home, ".claude"), { recursive: true })

  const env = process.env
  const snap = {
    HOME: env.HOME,
    VIBEOS_HOME: env.VIBEOS_HOME,
    VIBEOS_API_URL: env.VIBEOS_API_URL,
    VIBEOS_API_TOKEN: env.VIBEOS_API_TOKEN,
    VIBEOS_API_BOOTSTRAP_TOKEN: env.VIBEOS_API_BOOTSTRAP_TOKEN,
    VIBEOS_MCP_PORT: env.VIBEOS_MCP_PORT,
  }

  env.HOME = home
  env.VIBEOS_HOME = home
  env.VIBEOS_API_URL = "https://api.example.invalid"
  delete env.VIBEOS_API_TOKEN
  delete env.VIBEOS_API_BOOTSTRAP_TOKEN
  env.VIBEOS_MCP_PORT = "0"
  delete globalThis.__vibeOSRuntimeState

  const prevFetch = global.fetch
  const calls = []
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization || "" })
    if (String(url).includes("/api/v1/auth/bootstrap/exchange")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ api_token: "vos_" + "e".repeat(64) }),
      }
    }
    if (String(url).endsWith("/health")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      }
    }
    throw new Error("unexpected fetch " + url)
  }

  try {
    writeFileSync(join(home, ".env.production"), `VIBEOS_API_TOKEN=${EMBEDDED_BOOTSTRAP_TOKEN}\n`)
    const api = await import(`../src/lib/api-client.js?r=bootstrap-${stamp}`)
    assert.equal(api.VIBEOS_API_TOKEN, "", "embedded bootstrap token must not load as direct API token")
    assert.ok(api.VIBEOS_API_BOOTSTRAP_TOKEN, "bootstrap token should still be available")

    const result = await api.remoteCall("health", [], () => "fallback")
    assert.deepEqual(result, { ok: true })
    assert.equal(calls[0]?.url.includes("/api/v1/auth/bootstrap/exchange"), true, "first call should exchange bootstrap token")
    assert.equal(calls[0]?.auth, `Bearer ${EMBEDDED_BOOTSTRAP_TOKEN}`)
    assert.equal(calls[1]?.url.endsWith("/health"), true, "second call should hit the API with the exchanged token")
    assert.equal(calls[1]?.auth, `Bearer vos_${"e".repeat(64)}`)
    assert.equal(api.VIBEOS_API_TOKEN, `vos_${"e".repeat(64)}`)
  } finally {
    global.fetch = prevFetch
    await restoreFull({ snap })
    rmSync(home, { recursive: true, force: true })
  }
})

test("health responses cache the backend version for status surfaces", async () => {
  stamp++
  const home = mkdtempSync(join(tmpdir(), `vibeos-health-${stamp}-`))
  sandboxes.push(home)
  mkdirSync(join(home, ".claude"), { recursive: true })

  const env = process.env
  const snap = {
    HOME: env.HOME,
    VIBEOS_HOME: env.VIBEOS_HOME,
    VIBEOS_API_URL: env.VIBEOS_API_URL,
    VIBEOS_API_TOKEN: env.VIBEOS_API_TOKEN,
    VIBEOS_MCP_PORT: env.VIBEOS_MCP_PORT,
    VIBEOS_REMOTE_LATENCY_DEGRADE_MS: env.VIBEOS_REMOTE_LATENCY_DEGRADE_MS,
    VIBEOS_REMOTE_LATENCY_DEGRADE_COOLDOWN_MS: env.VIBEOS_REMOTE_LATENCY_DEGRADE_COOLDOWN_MS,
  }

  env.HOME = home
  env.VIBEOS_HOME = home
  env.VIBEOS_API_URL = "https://api.example.invalid"
  env.VIBEOS_API_TOKEN = "vos_" + "f".repeat(64)
  env.VIBEOS_MCP_PORT = "0"
  delete globalThis.__vibeOSRuntimeState

  const prevFetch = global.fetch
  global.fetch = async (url) => {
    if (String(url).endsWith("/health")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "ok", version: "1.0.29" }),
      }
    }
    throw new Error("unexpected fetch " + url)
  }

  try {
    const api = await import(`../src/lib/api-client.js?r=health-${stamp}`)
    const client = new api.VibeOSApiClient({
      baseUrl: "https://api.example.invalid",
      apiToken: "vos_" + "f".repeat(64),
      timeout: 1000,
    })
    const health = await client.health()
    assert.deepEqual(health, { status: "ok", version: "1.0.29" })
    assert.equal(api.getBackendVersion(), "1.0.29", "backend version should be cached after health probe")
  } finally {
    global.fetch = prevFetch
    await restore({ snap })
    rmSync(home, { recursive: true, force: true })
  }
})

test("slow remote calls trigger a latency guard so the next call stays local", async () => {
  stamp++
  const home = mkdtempSync(join(tmpdir(), `vibeos-latency-${stamp}-`))
  sandboxes.push(home)
  mkdirSync(join(home, ".claude"), { recursive: true })

  const env = process.env
  const snap = {
    HOME: env.HOME,
    VIBEOS_HOME: env.VIBEOS_HOME,
    VIBEOS_API_URL: env.VIBEOS_API_URL,
    VIBEOS_API_TOKEN: env.VIBEOS_API_TOKEN,
    VIBEOS_MCP_PORT: env.VIBEOS_MCP_PORT,
    VIBEOS_REMOTE_LATENCY_DEGRADE_MS: env.VIBEOS_REMOTE_LATENCY_DEGRADE_MS,
    VIBEOS_REMOTE_LATENCY_DEGRADE_COOLDOWN_MS: env.VIBEOS_REMOTE_LATENCY_DEGRADE_COOLDOWN_MS,
  }

  env.HOME = home
  env.VIBEOS_HOME = home
  env.VIBEOS_API_URL = "https://api.example.invalid"
  env.VIBEOS_API_TOKEN = "vos_" + "f".repeat(64)
  env.VIBEOS_MCP_PORT = "0"
  env.VIBEOS_REMOTE_LATENCY_DEGRADE_MS = "10"
  env.VIBEOS_REMOTE_LATENCY_DEGRADE_COOLDOWN_MS = "60000"
  delete globalThis.__vibeOSRuntimeState

  const prevFetch = global.fetch
  let fetchCalls = 0
  global.fetch = async (url, init = {}) => {
    fetchCalls++
    if (String(url).endsWith("/api/v1/blackbox/select-mode")) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      return {
        ok: true,
        status: 200,
        json: async () => ({ mode: "quality" }),
      }
    }
    throw new Error("unexpected fetch " + url)
  }

  try {
    const api = await import(`../src/lib/api-client.js?r=latency-${stamp}`)
    const first = await api.remoteCall("blackboxSelectMode", ["INIT", 0], () => "local-1")
    const second = await api.remoteCall("blackboxSelectMode", ["INIT", 0], () => "local-2")
    assert.deepEqual(first, { mode: "quality" }, "first call should still reach the API")
    assert.equal(second, "local-2", "second call should short-circuit to the local path")
    assert.equal(fetchCalls, 1, "only one network call should be needed before the latency guard engages")
    assert.equal(api.isApiLatencyDegraded(), true, "latency guard should remain active after the slow call")
  } finally {
    global.fetch = prevFetch
    await restore({ snap })
    rmSync(home, { recursive: true, force: true })
  }
})
