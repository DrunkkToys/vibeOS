import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const ENV_KEYS = [
  "HOME",
  "VIBEOS_HOME",
  "VIBEOS_API_URL",
  "VIBEOS_API_DISABLED",
  "VIBEOS_API_TOKEN",
  "VIBEOS_API_BOOTSTRAP_TOKEN",
]

async function withFreshApiClient<T>(fn: (mod: typeof import("../api-client")) => Promise<T> | T): Promise<T> {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-api-client-"))
  mkdirSync(join(sandbox, ".claude"), { recursive: true })
  const prevEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  try {
    process.env.HOME = sandbox
    process.env.VIBEOS_HOME = join(sandbox, ".claude")
    process.env.VIBEOS_API_URL = "http://127.0.0.1:1"
    delete process.env.VIBEOS_API_DISABLED
    delete process.env.VIBEOS_API_TOKEN
    delete process.env.VIBEOS_API_BOOTSTRAP_TOKEN
    delete (globalThis as Record<string, unknown>).__vibeOSRuntimeState

    vi.resetModules()
    const mod = await import("../api-client.js")
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
      expect(typeof mod.setAnomalyDetection).toBe("function")
      expect(typeof mod.setApiToken).toBe("function")
      expect(typeof mod.invalidateApiToken).toBe("function")
      expect(typeof mod.setApiBootstrapToken).toBe("function")
      expect(typeof mod.ensureBootstrapExchange).toBe("function")
      expect(typeof mod.getApiClient).toBe("function")
      expect(typeof mod.isApiFallback).toBe("function")
      expect(typeof mod.isApiConnected).toBe("function")
      expect(typeof mod.getBackendVersion).toBe("function")
      expect(typeof mod.remoteCall).toBe("function")
      expect(typeof mod.VIBEOS_API_URL).toBe("string")
    })
  })

  it("toggles anomaly detection without throwing", async () => {
    await withFreshApiClient(async (mod) => {
      expect(() => mod.setAnomalyDetection(false)).not.toThrow()
      expect(() => mod.setAnomalyDetection(true)).not.toThrow()
    })
  })

  it("keeps the API lifecycle coherent in a fresh sandbox", async () => {
    await withFreshApiClient(async (mod) => {
      mod.invalidateApiToken()
      await expect(mod.ensureBootstrapExchange()).resolves.toBe(false)

      mod.setApiToken("vos_" + "a".repeat(64))
      expect(mod.VIBEOS_API_TOKEN).toMatch(/^vos_[a-f0-9]{64}$/i)
      expect(mod.VIBEOS_API_ENABLED).toBe(true)
      expect(mod.isApiConnected()).toBe(true)
      expect(mod.getApiClient()).toBeDefined()

      mod.setApiBootstrapToken("vos_" + "b".repeat(64))
      expect(mod.VIBEOS_API_BOOTSTRAP_TOKEN).toMatch(/^vos_[a-f0-9]{64}$/i)
      expect(mod.VIBEOS_API_ENABLED).toBe(true)

      mod.invalidateApiToken()
      expect(mod.VIBEOS_API_DISABLED).toBe(true)
      expect(mod.isApiConnected()).toBe(false)
      expect(mod.isApiFallback()).toBe(true)
    })
  })
})
