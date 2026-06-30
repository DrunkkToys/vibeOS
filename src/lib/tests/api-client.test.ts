import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const ENV_KEYS = [
  "HOME",
  "VIBEOS_HOME",
  "VIBEOS_API_URL",
  "VIBEOS_API_TOKEN",
  "VIBEOS_API_BOOTSTRAP_TOKEN",
]

async function withFreshApiClient<T>(fn: (mod: typeof import("../api-client.js")) => Promise<T> | T): Promise<T> {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-api-client-"))
  mkdirSync(join(sandbox, ".claude"), { recursive: true })
  const prevEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  try {
    process.env.HOME = sandbox
    process.env.VIBEOS_HOME = join(sandbox, ".claude")
    process.env.VIBEOS_API_URL = "http://127.0.0.1:1"
      delete process.env.VIBEOS_API_TOKEN
    delete process.env.VIBEOS_API_BOOTSTRAP_TOKEN
    delete (globalThis as Record<string, unknown>).__vibeOSRuntimeState

    const mod = await import("../api-client.js?fresh=" + Date.now() + "-" + Math.random())
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

describe("api-client", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__vibeOSRuntimeState
  })

  it("exports the expected surface", async () => {
    await withFreshApiClient(async (mod) => {
      assert.equal(typeof mod.setAnomalyDetection, "function")
      assert.equal(typeof mod.setApiToken, "function")
      assert.equal(typeof mod.invalidateApiToken, "function")
      assert.equal(typeof mod.setApiBootstrapToken, "function")
      assert.equal(typeof mod.ensureBootstrapExchange, "function")
      assert.equal(typeof mod.getApiClient, "function")
      assert.equal(typeof mod.isApiFallback, "function")
      assert.equal(typeof mod.isApiConnected, "function")
      assert.equal(typeof mod.getBackendVersion, "function")
      assert.equal(typeof mod.remoteCall, "function")
      assert.equal(typeof mod.VIBEOS_API_URL, "string")
    })
  })

  it("toggles anomaly detection without throwing", async () => {
    await withFreshApiClient(async (mod) => {
      assert.doesNotThrow(() => mod.setAnomalyDetection(false))
      assert.doesNotThrow(() => mod.setAnomalyDetection(true))
    })
  })

  it("keeps the API lifecycle coherent in a fresh sandbox", async () => {
    await withFreshApiClient(async (mod) => {
      mod.invalidateApiToken()
      assert.equal(await mod.ensureBootstrapExchange(), false)

      mod.setApiToken("vos_" + "a".repeat(64))
      assert.match(mod.VIBEOS_API_TOKEN, /^vos_[a-f0-9]{64}$/i)
      assert.equal(mod.VIBEOS_API_ENABLED, true)
      assert.equal(mod.isApiConnected(), true)
      assert.notEqual(mod.getApiClient(), undefined)

      mod.setApiBootstrapToken("vos_" + "b".repeat(64))
      assert.match(mod.VIBEOS_API_BOOTSTRAP_TOKEN, /^vos_[a-f0-9]{64}$/i)
      assert.equal(mod.VIBEOS_API_ENABLED, true)

      mod.invalidateApiToken()
          assert.equal(mod.isApiConnected(), false)
      assert.equal(mod.isApiFallback(), true)
    })
  })

  it("sends session mode baselines to the embedding selector endpoint", async () => {
    await withFreshApiClient(async (mod) => {
      const client = new mod.VibeOSApiClient({ baseUrl: "http://api.example.test", apiToken: "vos_" + "a".repeat(64) })
      const calls: Array<{ path: string; body: Record<string, unknown> | null }> = []
      client.request = async (path: string, body: Record<string, unknown> | null) => {
        calls.push({ path, body })
        return { ok: true, mode: "budget" }
      }

      await client.blackboxSelectModeEmbedding("session-1", {
        project_id: "proj-1",
        userText: "show status",
        prompt: "show status",
        optimization_mode: "vibeultrax",
      })

      assert.equal(calls.length, 1)
      assert.equal(calls[0]?.path, "/api/v1/blackbox/select-mode-embedding")
      assert.deepEqual(calls[0]?.body, {
        session_id: "session-1",
        project_id: "proj-1",
        user_text: "show status",
        prompt: "show status",
        optimization_mode: "vibeultrax",
      })
    })
  })

  it("treats VIBEOS_HOME as the API credential source of truth", async () => {
    const sandbox = mkdtempSync(join(tmpdir(), "vibeos-api-home-"))
    const prevEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
    try {
      const vibeHome = join(sandbox, "vibe-home")
      const legacyHome = join(sandbox, ".claude")
      mkdirSync(vibeHome, { recursive: true })
      mkdirSync(legacyHome, { recursive: true })
      writeFileSync(join(legacyHome, ".env.production"), `VIBEOS_API_TOKEN=vos_${"c".repeat(64)}\nVIBEOS_API_DISABLED=true\n`, "utf8")

      process.env.HOME = sandbox
      process.env.VIBEOS_HOME = vibeHome
      process.env.VIBEOS_API_URL = "http://127.0.0.1:1"
          delete process.env.VIBEOS_API_TOKEN
      delete process.env.VIBEOS_API_BOOTSTRAP_TOKEN
      delete (globalThis as Record<string, unknown>).__vibeOSRuntimeState

      const mod = await import("../api-client.js?home-source=" + Date.now())
          assert.equal(mod.VIBEOS_API_TOKEN, "")

      mod.setApiToken(`vos_${"d".repeat(64)}`)
      assert.ok(readFileSync(join(vibeHome, ".env.production"), "utf8").includes(`vos_${"d".repeat(64)}`))
      assert.ok(readFileSync(join(legacyHome, ".env.production"), "utf8").includes(`vos_${"c".repeat(64)}`))
      assert.equal(existsSync(join(vibeHome, ".env.alpha")), false)
    } finally {
      for (const key of ENV_KEYS) {
        const prev = prevEnv[key]
        if (prev === undefined) delete process.env[key]
        else process.env[key] = String(prev)
      }
      delete (globalThis as Record<string, unknown>).__vibeOSRuntimeState
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})
