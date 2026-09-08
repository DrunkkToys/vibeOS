// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// Two costs the plugin was paying on every turn the API was unreachable.
//
// 1. A refused connection was retried like a flaky one: 4 attempts with 1+2+4s
//    of backoff. The next attempt to a closed port refuses just as fast as the
//    first; the 7s buys nothing.
// 2. Only remoteCall armed the fallback breaker. Every direct client.X() call
//    site -- blackboxSelectModeEmbedding, blackboxAnalyze, classify,
//    blackboxState, recordRoutingDecision -- reads the breaker but never set
//    it, so each one paid the full ladder again in the same turn.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// A syntactically valid bootstrap token that is never sent anywhere: every
// request in this file goes to a closed port. setApiToken persists to
// $VIBEOS_HOME/.env.production, so VIBEOS_HOME is sandboxed FIRST -- running
// this against a real home rewrites the user's stored credentials.
const FAKE_TOKEN = "vos_" + "0".repeat(64)

// A port that was bound and then released: a genuine ECONNREFUSED, unlike the
// "bad port" artifact you get from port 9.
async function closedPortUrl() {
  const net = await import("node:net")
  return await new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address()
      srv.close(() => resolve("http://127.0.0.1:" + port))
    })
  })
}

async function freshClient() {
  const CLOSED_PORT_URL = await closedPortUrl()
  const home = mkdtempSync(join(tmpdir(), "vibeos-apifail-"))
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")
  mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
  process.env.VIBEOS_API_URL = CLOSED_PORT_URL
  const api = await import("../src/lib/api-client.js?fastfail=" + Date.now() + Math.random())
  api.setApiToken(FAKE_TOKEN)
  const client = new api.VibeOSApiClient({ baseUrl: CLOSED_PORT_URL, apiToken: FAKE_TOKEN, timeout: 5000 })
  return { api, client }
}

test("a refused connection fails fast instead of buying 7s of backoff", async () => {
  const { client } = await freshClient()

  const started = Date.now()
  await assert.rejects(() => client.classify("hello", {}))
  const elapsed = Date.now() - started

  assert.ok(elapsed < 3000, `refused connection took ${elapsed}ms; the retry ladder alone is ~7000ms`)
})

test("a direct client call arms the breaker, so the rest of the turn short-circuits", async () => {
  const { api, client } = await freshClient()
  assert.equal(api.isApiFallback(), false, "starts connected")

  await assert.rejects(() => client.classify("hello", {}))

  assert.equal(api.isApiFallback(), true, "one direct failure suppresses the rest of the turn")
})

test("the breaker short-circuits the next direct call without touching the network", async () => {
  const { client } = await freshClient()

  await assert.rejects(() => client.classify("hello", {}))

  const started = Date.now()
  await assert.rejects(() => client.classify("hello again", {}))
  const elapsed = Date.now() - started

  assert.ok(elapsed < 200, `second call took ${elapsed}ms; it should not have reached the network at all`)
})
