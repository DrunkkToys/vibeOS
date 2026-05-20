import { describe, it, before, after } from "node:test"
import assert from "node:assert"
import http from "node:http"
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir, homedir } from "node:os"
import { spawn } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

const TEST = join(tmpdir(), "vibeos-dash-test-" + Date.now())
const CLAUDE = join(TEST, ".claude")
const REPORTS = join(CLAUDE, "reports")
let TIERS = join(CLAUDE, "model-tiers.json")
let STATE = join(CLAUDE, "delegation-state.json")

function setupState() {
  mkdirSync(CLAUDE, { recursive: true })
  mkdirSync(REPORTS, { recursive: true })
  writeFileSync(TIERS, JSON.stringify({
    selection: {
      enabled: true,
      active_slot: "medium",
      delegation_enforce: true,
      flow_enabled: true,
      flow_enforce: true,
      tdd_enforce: false,
      tdd_strict: false,
      thinking_level: "brief"
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro" },
      medium: { oc: "deepseek/deepseek-v4-flash" },
      cheap: { oc: "deepseek/deepseek-chat" }
    }
  }, null, 2) + "\n")

  writeFileSync(STATE, JSON.stringify({
    sessions: {
      "sess-001": {
        started: "2026-05-20T12:00:00Z",
        source: "opencode",
        cost_usd: 1.25,
        cache_savings_usd: 0.05,
        warns: [
          { at: "2026-05-20T12:01:00Z", tool: "write", reason: "direct edit", est_savings_usd: 0.01 },
          { at: "2026-05-20T12:02:00Z", tool: "edit", reason: "direct edit", est_savings_usd: 0.03 }
        ]
      },
      "sess-002": {
        started: "2026-05-20T13:00:00Z",
        source: "opencode",
        cost_usd: 0.50,
        cache_savings_usd: 0.02,
        warns: [
          { at: "2026-05-20T13:01:00Z", tool: "write", reason: "direct edit", est_savings_usd: 0.005 }
        ]
      }
    }
  }, null, 2) + "\n")

  writeFileSync(join(REPORTS, "rpt-001.json"), JSON.stringify({
    summary: "Test report 1", type: "auto", created: "2026-05-20T12:00:00Z", tags: ["test"]
  }, null, 2) + "\n")
}

let serverProc, port

function fetch(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `http://127.0.0.1:${port}`)
    const req = http.request(url, { method: opts.method || "GET", headers: opts.headers || {} }, (res) => {
      let data = ""
      res.on("data", c => { data += String(c) })
      res.on("end", () => { resolve({ status: res.statusCode, headers: res.headers, body: data }) })
    })
    req.on("error", reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

describe("dashboard-server", () => {
  before(async () => {
    setupState()

    await new Promise((resolve, reject) => {
      serverProc = spawn("node", [join(ROOT, "scripts", "dashboard-server.mjs")], {
        env: { ...process.env, HOME: TEST, PORT: "19876" },
        stdio: ["ignore", "pipe", "pipe"],
      })

      let stderr = ""
      serverProc.stderr.on("data", (c) => {
        stderr += String(c)
        const m = stderr.match(/Dashboard server on http:\/\/127\.0\.0\.1:(\d+)/)
        if (m) { port = Number(m[1]); resolve() }
      })

      serverProc.stdout.on("data", () => {})
      serverProc.on("error", reject)
      serverProc.on("exit", (code) => {
        if (code !== 0 && !port) reject(new Error(`server exited ${code}: ${stderr}`))
      })

      setTimeout(() => { if (!port) reject(new Error("server start timeout: " + stderr)) }, 8000)
    })
  })

  after(() => {
    try { serverProc?.kill() } catch {}
    try { rmSync(TEST, { recursive: true, force: true }) } catch {}
  })

  it("server started on expected port", () => {
    assert.strictEqual(port, 19876)
  })

  it("GET /status returns 200 with valid JSON", async () => {
    const { status, body } = await fetch("/status")
    assert.strictEqual(status, 200)
    const d = JSON.parse(body)
    assert.strictEqual(d.enabled, true)
    assert.strictEqual(d.active_slot, "medium")
    assert.strictEqual(d.enforce, true)
    assert.strictEqual(d.flow_enforcer, true)
    assert.strictEqual(d.tdd_enforcer, false)
    assert.strictEqual(d.thinking, "brief")
    assert.strictEqual(d.current_model, "deepseek/deepseek-v4-flash")
  })

  it("GET /savings returns 200 with correct totals", async () => {
    const { status, body } = await fetch("/savings")
    assert.strictEqual(status, 200)
    const d = JSON.parse(body)
    assert.strictEqual(d.lifetime.delegation_usd, 0.045)
    assert.strictEqual(d.lifetime.cache_usd, 0.07)
    assert.strictEqual(d.lifetime.total_warns, 3)
    assert.strictEqual(d.current_session.delegation_usd, 0.005)
    assert.strictEqual(d.current_session.cache_usd, 0.02)
    assert.strictEqual(d.current_session.warns_count, 1)
    assert.ok(["up", "down", "flat"].includes(d.trend))
  })

  it("GET /sessions returns session list", async () => {
    const { status, body } = await fetch("/sessions")
    assert.strictEqual(status, 200)
    const d = JSON.parse(body)
    assert.strictEqual(d.total_sessions, 2)
    const s1 = d.sessions.find(s => s.id === "sess-001")
    assert.ok(s1)
    assert.strictEqual(s1.cost_usd, 1.25)
    assert.strictEqual(s1.delegation_savings_usd, 0.04)
    assert.strictEqual(s1.cache_savings_usd, 0.05)
    assert.strictEqual(s1.warns_count, 2)
  })

  it("GET /reports returns report list", async () => {
    const { status, body } = await fetch("/reports")
    assert.strictEqual(status, 200)
    const d = JSON.parse(body)
    assert.strictEqual(d.length, 1)
    assert.strictEqual(d[0].id, "rpt-001")
  })

  it("GET /reports/rpt-001 returns report", async () => {
    const { status, body } = await fetch("/reports/rpt-001")
    assert.strictEqual(status, 200)
    const d = JSON.parse(body)
    assert.strictEqual(d.summary, "Test report 1")
  })

  it("GET /reports/nonexistent returns 404", async () => {
    const { status } = await fetch("/reports/nonexistent")
    assert.strictEqual(status, 404)
  })

  it("GET /events returns text/event-stream", async () => {
    await new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${port}/events`, (res) => {
        assert.strictEqual(res.statusCode, 200)
        assert.ok(res.headers["content-type"]?.includes("text/event-stream"))
        res.on("data", () => { req.destroy(); resolve() })
        setTimeout(() => { req.destroy(); resolve() }, 500)
      })
      req.on("error", reject)
      req.end()
    })
  })

  it("POST /trinity set brain changes active_slot", async () => {
    const { status, body } = await fetch("/trinity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set", slot: "brain" }),
    })
    assert.strictEqual(status, 200)
    const d = JSON.parse(body)
    assert.strictEqual(d.ok, true)
    const tiers = JSON.parse(readFileSync(TIERS, "utf-8"))
    assert.strictEqual(tiers.selection.active_slot, "brain")
  })

  it("POST /trinity enforce off disables enforcement", async () => {
    const { status } = await fetch("/trinity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "enforce", slot: "off" }),
    })
    assert.strictEqual(status, 200)
    const tiers = JSON.parse(readFileSync(TIERS, "utf-8"))
    assert.strictEqual(tiers.selection.delegation_enforce, false)
  })

  it("POST /trinity tdd on enables tdd", async () => {
    await fetch("/trinity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "tdd", slot: "on" }) })
    const tiers = JSON.parse(readFileSync(TIERS, "utf-8"))
    assert.strictEqual(tiers.selection.tdd_enforce, true)
  })

  it("POST /trinity missing action returns 400", async () => {
    const { status, body } = await fetch("/trinity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    assert.strictEqual(status, 400)
    assert.strictEqual(JSON.parse(body).ok, false)
  })

  it("POST /trinity unknown action returns 400", async () => {
    const { status, body } = await fetch("/trinity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "nonexistent" }),
    })
    assert.strictEqual(status, 400)
    assert.strictEqual(JSON.parse(body).ok, false)
  })

  it("reports endpoint handles empty reports dir", async () => {
    const rpt = join(REPORTS, "rpt-001.json")
    const bak = join(REPORTS, "rpt-001.json.bak")
    writeFileSync(bak, readFileSync(rpt))
    rmSync(rpt)
    const { status, body } = await fetch("/reports")
    assert.strictEqual(status, 200)
    assert.deepStrictEqual(JSON.parse(body), [])
    writeFileSync(rpt, readFileSync(bak))
    rmSync(bak)
  })
})
