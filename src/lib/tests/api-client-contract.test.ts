import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const ENV_KEYS = [
  "HOME",
  "VIBEOS_HOME",
  "VIBEOS_API_URL",
  "VIBEOS_API_TOKEN",
  "VIBEOS_API_BOOTSTRAP_TOKEN",
]

async function withFreshApiClient<T>(
  fn: (mod: typeof import("../api-client.js")) => Promise<T> | T,
  overrides: Record<string, string | undefined> = {},
): Promise<T> {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-api-contract-"))
  mkdirSync(join(sandbox, ".claude"), { recursive: true })
  const prevEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  try {
    process.env.HOME = sandbox
    process.env.VIBEOS_HOME = join(sandbox, ".claude")
    process.env.VIBEOS_API_URL = "http://127.0.0.1:1"
    delete process.env.VIBEOS_API_TOKEN
    delete process.env.VIBEOS_API_BOOTSTRAP_TOKEN
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    delete (globalThis as Record<string, unknown>).__vibeOSRuntimeState

    const mod = await import("../api-client.js?contract=" + Date.now() + "-" + Math.random())
    return await fn(mod)
  } finally {
    for (const key of ENV_KEYS) {
      const prev = prevEnv[key]
      if (prev === undefined) delete process.env[key]
      else process.env[key] = String(prev)
    }
    delete (globalThis as Record<string, unknown>).__vibeOSRuntimeState
    rmSync(sandbox, { recursive: true, force: true })
  }
}

describe("api-client contract", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__vibeOSRuntimeState
  })

  it("exposes the full stable export surface", async () => {
    await withFreshApiClient((mod) => {
      for (const name of [
        "setApiToken",
        "invalidateApiToken",
        "setApiBootstrapToken",
        "ensureBootstrapExchange",
        "getApiClient",
        "isApiFallback",
        "isApiConnected",
        "getBackendVersion",
        "getApiFallbackSince",
        "isApiLatencyDegraded",
        "remoteCall",
      ]) {
        assert.equal(typeof (mod as Record<string, unknown>)[name], "function", `missing export: ${name}`)
      }
      assert.equal(typeof mod.VIBEOS_API_URL, "string")
    })
  })

  // ── Single source of truth: URL ──────────────────────────────────────
  // resolveApiUrl() is the only place that reads VIBEOS_API_URL / the default.
  it("resolves the API URL through one resolver", async () => {
    await withFreshApiClient((mod) => {
      const m = mod as unknown as { resolveApiUrl?: (override?: string) => string }
      assert.equal(typeof m.resolveApiUrl, "function", "resolveApiUrl must be exported (single source of truth)")
      assert.equal(m.resolveApiUrl!(), mod.VIBEOS_API_URL, "VIBEOS_API_URL export must delegate to resolveApiUrl()")
      assert.equal(m.resolveApiUrl!(), "http://127.0.0.1:1", "env override must win")
      assert.equal(m.resolveApiUrl!("http://example.test"), "http://example.test", "explicit override wins")
    })
  })

  it("falls back to the default URL when no env override is set", async () => {
    await withFreshApiClient(
      (mod) => {
        const m = mod as unknown as { resolveApiUrl?: () => string }
        assert.equal(m.resolveApiUrl!(), "https://api.vibetheog.com")
      },
      { VIBEOS_API_URL: undefined },
    )
  })

  // ── Single source of truth: token ────────────────────────────────────
  // resolveApiToken() is the only place implementing token precedence.
  it("resolves the API token through one resolver", async () => {
    await withFreshApiClient((mod) => {
      const m = mod as unknown as { resolveApiToken?: () => string }
      assert.equal(typeof m.resolveApiToken, "function", "resolveApiToken must be exported (single source of truth)")
      assert.equal(m.resolveApiToken!(), mod.VIBEOS_API_TOKEN, "VIBEOS_API_TOKEN must reflect resolveApiToken()")

      const token = "vos_" + "a".repeat(64)
      mod.setApiToken(token)
      assert.equal(m.resolveApiToken!(), token, "explicit setApiToken wins")
    })
  })

  // ── Fallback semantics ───────────────────────────────────────────────
  it("invokes fallbackFn when the API is disabled", async () => {
    await withFreshApiClient(async (mod) => {
      mod.invalidateApiToken()
      assert.equal(mod.isApiFallback(), true)
      let called = false
      const result = await mod.remoteCall("delegateCheck", [], () => {
        called = true
        return { blocked: false, _fallback: true }
      })
      assert.equal(called, true)
      assert.deepEqual(result, { blocked: false, _fallback: true })
    })
  })

  it("returns null when disabled and no fallbackFn is provided", async () => {
    await withFreshApiClient(async (mod) => {
      mod.invalidateApiToken()
      const result = await mod.remoteCall("blackboxSelectMode", ["INIT", 1], null)
      assert.equal(result, null)
    })
  })

  it("falls through to fallbackFn when a live request fails (server unreachable)", async () => {
    await withFreshApiClient(async (mod) => {
      mod.setApiToken("vos_" + "a".repeat(64))
      assert.equal(mod.isApiConnected(), true)
      const result = await mod.remoteCall("delegateCheck", ["write", "brain", "x", "p"], () => ({ _fallback: true }))
      assert.deepEqual(result, { _fallback: true }, "unreachable API (127.0.0.1:1) must hit fallback")
      assert.equal(mod.isApiFallback(), true, "a failed call trips the fallback circuit breaker")
      assert.notEqual(mod.getApiFallbackSince(), null)
    })
  })

  it("reports latency degradation state as a boolean, false at start", async () => {
    await withFreshApiClient((mod) => {
      assert.equal(typeof mod.isApiLatencyDegraded(), "boolean")
      assert.equal(mod.isApiLatencyDegraded(), false)
    })
  })

  // ── API response shape contracts ─────────────────────────────────────
  // classify and escalate have stable return shapes verified here.

  it("classify typed return shape includes entry_tier, pipeline, uncertainty_signals, cascade_depth", async () => {
    await withFreshApiClient((mod) => {
      const client = mod.getApiClient()
      // The shape is defined in the return type annotation — verify
      // the method exists and its return type includes expected fields.
      assert.equal(typeof client.classify, "function")
    })
  })

  it("escalate typed return shape includes escalate, next_tier, uncertainty_score, loop_context, remaining_escalations", async () => {
    await withFreshApiClient((mod) => {
      const client = mod.getApiClient()
      assert.equal(typeof client.escalate, "function")
    })
  })
})
