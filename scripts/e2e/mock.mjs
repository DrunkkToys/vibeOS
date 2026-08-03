#!/usr/bin/env node
// vibeOS E2E mock backend — stands in for api.vibetheog.com during headless
// release tests. Logs every request to mockdata/requests.jsonl and PERSISTS
// blackbox/outcome bodies so tests can assert what actually reached the wire.
//
// Usage: node scripts/e2e/mock.mjs <outdir> [port]

import http from "node:http"
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const OUT = process.argv[2] || join(process.cwd(), ".e2e-tmp")
const PORT = Number(process.argv[3] || process.env.E2E_MOCK_PORT || 48081)
const LOG = join(OUT, "mockdata", "requests.jsonl")
const OUTCOMES = join(OUT, "mockdata", "outcomes.jsonl")

mkdirSync(join(OUT, "mockdata"), { recursive: true })

function log(method, path, body) {
  const line = JSON.stringify({ at: new Date().toISOString(), method, path, body: body || null })
  try { appendFileSync(LOG, line + "\n") } catch {}
}

const server = http.createServer((req, res) => {
  let raw = ""
  req.on("data", (c) => { raw += c })
  req.on("end", () => {
    let body = null
    try { body = raw ? JSON.parse(raw) : null } catch { body = raw }
    const url = (req.url || "").split("?")[0]
    log(req.method || "", url, body)
    const json = (code, obj) => {
      res.writeHead(code, { "Content-Type": "application/json" })
      res.end(JSON.stringify(obj))
    }
    if (url === "/health") return json(200, { ok: true, status: "ok" })
    if (url === "/api/v1/auth/bootstrap/exchange") return json(200, { api_token: "mock-token-" + Date.now(), ok: true })
    if (url === "/api/v1/blackbox/outcome") {
      // Persist so the harness can assert the posted outcome matches the verdict.
      try { appendFileSync(OUTCOMES, JSON.stringify({ ...(body || {}), at: new Date().toISOString() }) + "\n") } catch {}
      return json(200, { ok: true })
    }
    if (url === "/api/v1/telemetry/record" || url === "/api/v1/blackbox/outcome") return json(200, { ok: true })
    if (/^\/api\/v1\/(blackbox|vibemax|mode|stress|delegate|dashboard|compress)/.test(url)) return json(200, { ok: true })
    json(404, { error: "not found", path: url })
  })
})

server.listen(PORT, "127.0.0.1", () => process.stdout.write(`[e2e-mock] listening on ${PORT}, out=${OUT}\n`))
server.on("error", (e) => { console.error("[e2e-mock] listen error:", e.message); process.exit(1) })
