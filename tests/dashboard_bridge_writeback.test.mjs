import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const ENV_KEYS = ["HOME", "VIBEOS_HOME", "VIBEOS_API_URL", "VIBEOS_API_TOKEN", "VIBEOS_API_BOOTSTRAP_TOKEN"]

async function withBridgeSandbox(fn) {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-dashboard-bridge-"))
  const vibeHome = join(sandbox, ".claude")
  mkdirSync(vibeHome, { recursive: true })
  const prevEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  try {
    process.env.HOME = sandbox
    process.env.VIBEOS_HOME = vibeHome
    delete process.env.VIBEOS_API_BOOTSTRAP_TOKEN
    delete globalThis.__vibeOSRuntimeState
    return await fn({ sandbox, vibeHome })
  } finally {
    for (const key of ENV_KEYS) {
      const prev = prevEnv[key]
      if (prev === undefined) delete process.env[key]
      else process.env[key] = String(prev)
    }
    delete globalThis.__vibeOSRuntimeState
    rmSync(sandbox, { recursive: true, force: true })
  }
}

test("dashboard bridge replays queued mutations and updates cached projections", async () => {
  await withBridgeSandbox(async ({ vibeHome }) => {
    const seen = []
    const backend = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1")
      if (req.method === "POST" && url.pathname === "/api/v1/dashboard/mutations/replay") {
        let raw = ""
        req.on("data", (chunk) => { raw += String(chunk || "") })
        req.on("end", () => {
          const body = raw ? JSON.parse(raw) : {}
          const mutations = Array.isArray(body.mutations) ? body.mutations : []
          seen.push(...mutations)
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({
            ok: true,
            acknowledged_ids: mutations.map((item) => item.mutation_id),
            projections: {
              status: { source: "backend", count: mutations.length },
            },
          }))
        })
        return
      }
      res.statusCode = 404
      res.end("not found")
    })
    const port = await new Promise((resolve, reject) => {
      backend.once("error", reject)
      backend.listen(0, "127.0.0.1", () => {
        const address = backend.address()
        resolve(typeof address === "object" && address ? address.port : 0)
      })
    })
    process.env.VIBEOS_API_URL = `http://127.0.0.1:${port}`
    process.env.VIBEOS_API_TOKEN = `vos_${"a".repeat(64)}`

    const bridge = await import(`../src/lib/dashboard-bridge.js?bridge=${Date.now()}`)
    bridge.primeDashboardBridgeCache({ status: { source: "local" } })
    bridge.queueDashboardProjectionRefresh({ session_id: "sid-a", status: { source: "queued" } })
    const queued = bridge.getDashboardBridgeProjection("status", null)
    assert.equal(queued.source, "queued")

    const result = await bridge.flushDashboardMutationQueue()
    assert.equal(result.flushed, 1)
    assert.equal(result.pending, 0)
    assert.equal(seen.length, 1)

    const persisted = JSON.parse(readFileSync(join(vibeHome, ".dashboard-bridge.json"), "utf8"))
    assert.equal(persisted.pending.length, 0)
    assert.equal(persisted.cache.status.source, "backend")

    await new Promise((resolve) => backend.close(resolve))
  })
})

test("dashboard bridge falls back to cached projections when backend read is unavailable", async () => {
  await withBridgeSandbox(async () => {
    process.env.VIBEOS_API_URL = "http://127.0.0.1:1"
    delete process.env.VIBEOS_API_TOKEN
    const bridge = await import(`../src/lib/dashboard-bridge.js?fallback=${Date.now()}`)
    bridge.primeDashboardBridgeCache({ savings: { source: "cached", total: 3 } })
    const savings = await bridge.fetchDashboardProjection("savings", { source: "local", total: 0 })
    assert.equal(savings.source, "cached")
    assert.equal(savings.total, 3)
  })
})
