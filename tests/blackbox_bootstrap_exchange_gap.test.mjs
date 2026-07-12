// SPDX-License-Identifier: MIT
// Contract: fetchBlackboxEnrichment() must trigger the bootstrap token exchange
// (like remoteCall() already does) when no exchanged VIBEOS_API_TOKEN exists yet
// but a bootstrap/embedded token is present. Without this, a fresh session that
// never explicitly called setApiToken() silently and permanently skips the
// authoritative API for blackbox analysis, even though the API is healthy.

import { test } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-bootstrap-gap-"))
mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(join(sandbox, ".opencode"), { recursive: true })

let exchangeHits = 0
let analyzeHits = 0
const ISSUED_TOKEN = "vos_" + "b".repeat(64)

const server = http.createServer((req, res) => {
  let body = ""
  req.on("data", (c) => { body += c })
  req.on("end", () => {
    const url = req.url || "/"
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)) }
    if (url.includes("/auth/bootstrap/exchange")) {
      exchangeHits++
      return send(200, { api_token: ISSUED_TOKEN })
    }
    if (url.includes("/blackbox/analyze")) {
      analyzeHits++
      return send(200, {
        sub_regime: "REFINING",
        resolution: "in_progress",
        is_looping: false,
        momentum: 0.2,
      })
    }
    if (url.includes("/health")) return send(200, { status: "ok", version: "fixture" })
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
const cascade = await import("../src/lib/cascade.js")

// Simulate a fresh session: only a bootstrap token is known (e.g. the embedded
// default), no exchanged direct API token has been obtained yet.
api.setApiBootstrapToken("vos_" + "c".repeat(64))

test("fetchBlackboxEnrichment triggers bootstrap exchange when no direct token exists yet", async () => {
  assert.equal(exchangeHits, 0, "sanity: exchange not yet called")
  assert.equal(api.getApiClient(), null, "sanity: no client available before exchange")

  const result = await cascade.fetchBlackboxEnrichment("test-session-bootstrap-gap", "please refactor the auth module", {
    features: {},
    action: "explore",
    entropy: 1.0,
    uncertainty: 50,
  })

  assert.ok(exchangeHits > 0, "bootstrap exchange must be attempted before giving up on the API")
  assert.ok(analyzeHits > 0, "blackbox analyze must actually be called once a token is obtained")
  assert.ok(result, "enrichment must succeed once the bootstrap exchange yields a token")
  assert.equal(result.source, "api", "result must be marked as API-sourced")
})
