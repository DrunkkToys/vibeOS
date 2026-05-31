// Regression: setApiToken() must reset _apiFallbackMode, _apiClient, _apiFallbackSince,
// and call resetApiConnection() so subsequent remoteCall() attempts can proceed.
//
// Without these resets, a failed API call deadlocks the module permanently.
// Run: node --test tests/test_api_client_fallback_regression.test.mjs

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandboxes = []
let stamp = 0

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
    VIBEOS_API_URL: env.VIBEOS_API_URL,
    VIBEOS_API_DISABLED: env.VIBEOS_API_DISABLED,
    VIBEOS_API_TOKEN: env.VIBEOS_API_TOKEN,
    VIBEOS_MCP_PORT: env.VIBEOS_MCP_PORT,
  }

  env.HOME = home
  env.VIBEOS_API_URL = "http://127.0.0.1:1"
  delete env.VIBEOS_API_DISABLED
  env.VIBEOS_API_TOKEN = "vos_sandbox_test_" + stamp
  env.VIBEOS_MCP_PORT = "0"
  delete globalThis.__vibeOSRuntimeState

  return { api: import(`../src/lib/api-client.js?r=${stamp}`), snap, home }
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
    api.setApiToken("vos_fixed_token")

    assert.equal(api.VIBEOS_API_DISABLED, false, "not disabled")
    assert.equal(api.VIBEOS_API_ENABLED, true, "enabled")
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
    api.setApiToken("vos_new_client_token")
    assert.equal(api.isApiFallback(), false, "fallback cleared")
    assert.equal(api.isApiConnected(), false, "runtime connection reset")

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
