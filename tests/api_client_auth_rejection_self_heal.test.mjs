// SPDX-License-Identifier: MIT
// Contract: a rejected (401/403) VIBEOS_API_TOKEN must not leave the plugin
// permanently stuck in local fallback. remoteCall() must clear the dead token
// (in memory and on disk) while preserving the bootstrap token, so the next
// call naturally re-triggers ensureBootstrapExchange() and can recover with a
// freshly issued token -- matching the "must work for every user by default"
// bootstrap contract.

import { test } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-auth-self-heal-"))
mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(join(sandbox, ".opencode"), { recursive: true })

const STALE_TOKEN = "vos_" + "d".repeat(64)
const FRESH_TOKEN = "vos_" + "e".repeat(64)
let exchangeHits = 0
let healthHitsWithStale = 0
let healthHitsWithFresh = 0

const server = http.createServer((req, res) => {
  let body = ""
  req.on("data", (c) => { body += c })
  req.on("end", () => {
    const url = req.url || "/"
    const auth = req.headers["authorization"] || ""
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)) }
    if (url.includes("/auth/bootstrap/exchange")) {
      exchangeHits++
      return send(200, { api_token: FRESH_TOKEN })
    }
    if (url.includes("/health")) {
      if (auth.includes(STALE_TOKEN)) {
        healthHitsWithStale++
        return send(401, { message: "token rejected" })
      }
      if (auth.includes(FRESH_TOKEN)) {
        healthHitsWithFresh++
        return send(200, { status: "ok", version: "fixture" })
      }
      return send(401, { message: "no token" })
    }
    return send(200, {})
  })
})

const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)))

process.env.VIBEOS_API_URL = `http://127.0.0.1:${port}`
process.env.VIBEOS_HOME = join(sandbox, ".claude")
process.env.VIBEOS_BUILD_CHANNEL = "alpha"

writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
  trinity: {
    brain: { oc: "deepseek/deepseek-v4-pro" },
    medium: { oc: "deepseek/deepseek-v4-flash" },
    cheap: { oc: "deepseek/deepseek-chat" },
  },
  selection: { enabled: true, active_slot: "cheap" },
}))

const api = await import("../src/lib/api-client.js")

// Simulate a stale, already-rejected token sitting in memory/disk (e.g. from
// an earlier revoked seat or a prior test run), plus a valid bootstrap token
// that CAN mint a fresh one.
api.setApiToken(STALE_TOKEN)
api.setApiBootstrapToken("vos_" + "f".repeat(64))

test("a rejected token self-heals via bootstrap exchange instead of staying stuck", async () => {
  const first = await api.remoteCall("health", [], () => "FALLBACK")
  assert.equal(healthHitsWithStale, 1, "the stale token must actually be tried once")
  assert.equal(first, "FALLBACK", "the first call fails since the stale token is rejected")

  const second = await api.remoteCall("health", [], () => "FALLBACK")
  assert.ok(exchangeHits > 0, "bootstrap exchange must be attempted after the token was rejected")
  assert.ok(healthHitsWithFresh > 0, "the freshly exchanged token must actually be used")
  assert.notEqual(second, "FALLBACK", "the second call must recover once a valid token is obtained")
})
