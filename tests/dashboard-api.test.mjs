import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"

import { createMcpServer } from "../src/lib/vibeos-mcp-server.js"

test("dashboard API serves home, templates, and session actions", async () => {
  const state = {
    enabled: true,
    active_slot: "brain",
    current_model: "model-a",
    current_provider: "Provider A",
    credit_percent: 88,
    version: "1.0.0",
    backend_connected: true,
    backend_health_url: "http://127.0.0.1/health",
    backend_version: "1.0.0",
    model_locked: false,
    locked_slot: null,
    locked_model: null,
  }
  const sessions = {
    "sid-a": {
      started: "2026-06-19T10:00:00.000Z",
      cost_usd: 1.23,
      orchestration: {
        status: "active",
        locked: false,
        tags: [],
        notes: [],
        template: { id: "save", body: "Keep it short.", revision: 1 },
      },
    },
  }
  const mutations = []
  const server = createMcpServer({
    getState: () => ({ ...state, sessions_raw: sessions }),
    getSavings: () => ({
      lifetime: { delegation_usd: 1, cache_usd: 0.5, missed_context7_usd: 0, total_warns: 1 },
      current_session: { delegation_usd: 0.2, cache_usd: 0.1, warns_count: 0, tool_breakdown: {} },
      telemetry: { lifetime_events: 0, current_session_events: 0, storage_bytes_estimate: 0, retained_sessions: 0, tool_counts: {}, tier_counts: {}, slot_counts: {}, kind_counts: {}, prompt_size_buckets: {}, output_size_buckets: {}, duration_buckets: {}, result_counts: {}, cache_hit_counts: { hit: 0, miss: 0 }, enforcement_counts: {}, flow_counts: {}, tdd_counts: {}, last_seen: null, last_compacted_at: null },
      cache_hits_this_session: 0,
      trend: "flat",
      savings_rate_per_hour: 0,
    }),
    getTodos: () => [{ status: "pending" }],
    getSessionMetrics: () => ({ sesDuration: 60 }),
    getCurrentSessionId: () => "sid-a",
    listReports: () => [],
    readReport: () => null,
    runDiagnose: () => ({ ok: true }),
    runProject: () => ({ ok: true }),
    runTrinity: async () => "ok",
    runResearchAudit: () => ({ ok: true }),
    saveReport: () => "report-1",
    generateSessionCheckout: () => ({ ok: true, summary: { session_id: "sid-a" } }),
    getBlackboxState: () => ({ enabled: true, sessions: {} }),
    saveBlackboxVector: () => {},
    saveBlackboxOutcome: () => {},
    listSessionTemplates: () => [{ id: "save", label: "Save" }],
    getSessionOrchestration: (sessionId) => sessions[sessionId]?.orchestration || null,
    mutateSessionOrchestration: (sessionId, mutator) => {
      sessions[sessionId] = sessions[sessionId] || {}
      const next = mutator(sessions[sessionId]?.orchestration || {})
      sessions[sessionId].orchestration = next
      mutations.push({ sessionId, next })
      return next
    },
    setSessionTemplate: (sessionId, template) => {
      sessions[sessionId].orchestration = sessions[sessionId].orchestration || {}
      sessions[sessionId].orchestration.template = template
      mutations.push({ sessionId, template })
      return template
    },
  })

  const instance = await server.start(0)
  const address = instance.address()
  const port = typeof address === "object" && address ? address.port : 0
  const base = `http://127.0.0.1:${port}`
  try {
    const home = await fetch(`${base}/dashboard/home`).then((r) => r.json())
    assert.equal(home.current_session.session_id, "sid-a")
    assert.equal(home.home.title, "Executive Summary")
    assert.equal(home.templates.length, 1)

    const templates = await fetch(`${base}/templates`).then((r) => r.json())
    assert.equal(templates[0].id, "save")

    const detail = await fetch(`${base}/sessions/sid-a`).then((r) => r.json())
    assert.equal(detail.session.session_id, "sid-a")

    const annotated = await fetch(`${base}/sessions/sid-a/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "annotate", note: "ship next" }),
    }).then((r) => r.json())
    assert.equal(annotated.ok, true)
    assert.equal(mutations.length >= 1, true)

    const templated = await fetch(`${base}/sessions/sid-a/template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: "quality", body: "Write real assertions.", label: "Quality" }),
    }).then((r) => r.json())
    assert.equal(templated.ok, true)
    assert.equal(templated.session.template.label, "Quality")
    assert.equal(mutations.at(-1).next.template.label, "Quality")

    const batch = await fetch(`${base}/sessions/sid-a/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "batch", actions: [{ action: "pause" }, { action: "annotate", note: "batch note" }] }),
    }).then((r) => r.json())
    assert.equal(batch.ok, true)
    assert.equal(batch.session.status, "paused")
    assert.equal(batch.session.notes.at(-1).text, "batch note")

    const undone = await fetch(`${base}/sessions/sid-a/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "undo" }),
    }).then((r) => r.json())
    assert.equal(undone.ok, true)
    assert.equal(undone.session.history.length >= 1, true)

    const compare = await fetch(`${base}/sessions/sid-a/compare?with=sid-a`, { method: "GET" }).then((r) => r.json())
    assert.equal(compare.ok, true)
    assert.equal(compare.compare.status_changed, false)

    const exported = await fetch(`${base}/sessions/sid-a/export`, { method: "GET" }).then((r) => r.json())
    assert.equal(exported.ok, true)
    assert.equal(exported.orchestration.session_id, "sid-a")

    const imported = await fetch(`${base}/sessions/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "sid-b", orchestration: exported.orchestration }),
    }).then((r) => r.json())
    assert.equal(imported.session.session_id, "sid-b")
  } finally {
    await server.close()
  }
})

test("dashboard API proxies capabilities and web search", async () => {
  const backend = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1")
    if (req.method === "GET" && url.pathname === "/api/v1/capabilities") {
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({
        web_search: {
          enabled: true,
          provider: "fixture",
          fixture_mode: true,
          benchmark_path: "/tmp/web-search-gold.json",
          backend_status: 200,
        },
      }))
      return
    }
    if (req.method === "POST" && url.pathname === "/api/v1/web/search") {
      let raw = ""
      req.on("data", (chunk) => { raw += String(chunk || "") })
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : {}
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({
          ok: true,
          query: body.query,
          provider: body.provider || "fixture",
          answer: `Search results for "${body.query}": 1. Fetch API - MDN [1]`,
          results: [
            {
              id: "fixture-1",
              title: "Fetch API - MDN",
              url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API",
              domain: "developer.mozilla.org",
              snippet: "Standard browser API for network requests.",
              source: body.provider || "fixture",
            },
          ],
          citations: [
            {
              id: 1,
              title: "Fetch API - MDN",
              url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API",
              domain: "developer.mozilla.org",
            },
          ],
          meta: { resultCount: 1, uniqueDomains: 1 },
        }))
      })
      return
    }
    res.statusCode = 404
    res.end("not found")
  })

  const backendPort = await new Promise((resolve, reject) => {
    backend.once("error", reject)
    backend.listen(0, "127.0.0.1", () => {
      const address = backend.address()
      resolve(typeof address === "object" && address ? address.port : 0)
    })
  })
  const previousApiUrl = process.env.VIBEOS_API_URL
  process.env.VIBEOS_API_URL = `http://127.0.0.1:${backendPort}`

  const state = {
    enabled: true,
    active_slot: "brain",
    current_model: "model-a",
    current_provider: "Provider A",
    credit_percent: 88,
    version: "1.0.0",
    backend_connected: true,
    backend_health_url: "http://127.0.0.1/health",
    backend_version: "1.0.0",
    model_locked: false,
    locked_slot: null,
    locked_model: null,
  }
  const sessions = {
    "sid-a": {
      started: "2026-06-19T10:00:00.000Z",
      cost_usd: 1.23,
      orchestration: {
        status: "active",
        locked: false,
        tags: [],
        notes: [],
        template: { id: "save", body: "Keep it short.", revision: 1 },
      },
    },
  }
  const server = createMcpServer({
    getState: () => ({ ...state, sessions_raw: sessions }),
    getSavings: () => ({
      lifetime: { delegation_usd: 1, cache_usd: 0.5, missed_context7_usd: 0, total_warns: 1 },
      current_session: { delegation_usd: 0.2, cache_usd: 0.1, warns_count: 0, tool_breakdown: {} },
      telemetry: { lifetime_events: 0, current_session_events: 0, storage_bytes_estimate: 0, retained_sessions: 0, tool_counts: {}, tier_counts: {}, slot_counts: {}, kind_counts: {}, prompt_size_buckets: {}, output_size_buckets: {}, duration_buckets: {}, result_counts: {}, cache_hit_counts: { hit: 0, miss: 0 }, enforcement_counts: {}, flow_counts: {}, tdd_counts: {}, last_seen: null, last_compacted_at: null },
      cache_hits_this_session: 0,
      trend: "flat",
      savings_rate_per_hour: 0,
    }),
    getTodos: () => [{ status: "pending" }],
    getSessionMetrics: () => ({ sesDuration: 60 }),
    getCurrentSessionId: () => "sid-a",
    listReports: () => [],
    readReport: () => null,
    runDiagnose: () => ({ ok: true }),
    runProject: () => ({ ok: true }),
    runTrinity: async () => "ok",
    runResearchAudit: () => ({ ok: true }),
    saveReport: () => "report-1",
    generateSessionCheckout: () => ({ ok: true, summary: { session_id: "sid-a" } }),
    getBlackboxState: () => ({ enabled: true, sessions: {} }),
    saveBlackboxVector: () => {},
    saveBlackboxOutcome: () => {},
    listSessionTemplates: () => [{ id: "save", label: "Save" }],
    getSessionOrchestration: (sessionId) => sessions[sessionId]?.orchestration || null,
    mutateSessionOrchestration: (sessionId, mutator) => {
      sessions[sessionId] = sessions[sessionId] || {}
      const next = mutator(sessions[sessionId]?.orchestration || {})
      sessions[sessionId].orchestration = next
      return next
    },
    setSessionTemplate: (sessionId, template) => {
      sessions[sessionId].orchestration = sessions[sessionId].orchestration || {}
      sessions[sessionId].orchestration.template = template
      return template
    },
  })

  const instance = await server.start(0)
  const address = instance.address()
  const port = typeof address === "object" && address ? address.port : 0
  const base = `http://127.0.0.1:${port}`
  try {
    const capabilities = await fetch(`${base}/capabilities`).then((r) => r.json())
    assert.equal(capabilities.web_search.enabled, true)
    assert.equal(capabilities.web_search.fixture_mode, true)

    const search = await fetch(`${base}/web-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "fetch api",
        provider: "fixture",
        max_results: 1,
        compose_answer: true,
        safe_search: "moderate",
        locale: "us-en",
      }),
    }).then((r) => r.json())
    assert.equal(search.ok, true)
    assert.equal(search.query, "fetch api")
    assert.equal(search.results[0].domain, "developer.mozilla.org")

    const html = await fetch(`${base}/`).then((r) => r.text())
    assert.match(html, /Web Search/)
    assert.match(html, /Search the Web/)
  } finally {
    process.env.VIBEOS_API_URL = previousApiUrl
    await server.close()
    await new Promise((resolve) => backend.close(() => resolve()))
  }
})

test("dashboard API falls back when backend capabilities are missing", async () => {
  const backend = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1")
    if (req.method === "POST" && url.pathname === "/api/v1/web/search") {
      res.statusCode = 404
      res.end(JSON.stringify({ error: "not found" }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: "not found" }))
  })

  const backendPort = await new Promise((resolve, reject) => {
    backend.once("error", reject)
    backend.listen(0, "127.0.0.1", () => {
      const address = backend.address()
      resolve(typeof address === "object" && address ? address.port : 0)
    })
  })
  const previousApiUrl = process.env.VIBEOS_API_URL
  process.env.VIBEOS_API_URL = `http://127.0.0.1:${backendPort}`

  const server = createMcpServer({
    getState: () => ({
      enabled: true,
      active_slot: "brain",
      current_model: "model-a",
      current_provider: "Provider A",
      credit_percent: 88,
      version: "1.0.0",
      backend_connected: true,
      backend_health_url: "http://127.0.0.1/health",
      backend_version: "1.0.0",
      model_locked: false,
      locked_slot: null,
      locked_model: null,
    }),
    getSavings: () => ({
      lifetime: { delegation_usd: 1, cache_usd: 0.5, missed_context7_usd: 0, total_warns: 1 },
      current_session: { delegation_usd: 0.2, cache_usd: 0.1, warns_count: 0, tool_breakdown: {} },
      telemetry: { lifetime_events: 0, current_session_events: 0, storage_bytes_estimate: 0, retained_sessions: 0, tool_counts: {}, tier_counts: {}, slot_counts: {}, kind_counts: {}, prompt_size_buckets: {}, output_size_buckets: {}, duration_buckets: {}, result_counts: {}, cache_hit_counts: { hit: 0, miss: 0 }, enforcement_counts: {}, flow_counts: {}, tdd_counts: {}, last_seen: null, last_compacted_at: null },
      cache_hits_this_session: 0,
      trend: "flat",
      savings_rate_per_hour: 0,
    }),
    getTodos: () => [],
    getSessionMetrics: () => ({ sesDuration: 60 }),
    getCurrentSessionId: () => "sid-a",
    listReports: () => [],
    readReport: () => null,
    runDiagnose: () => ({ ok: true }),
    runProject: () => ({ ok: true }),
    runTrinity: async () => "ok",
    runResearchAudit: () => ({ ok: true }),
    saveReport: () => "report-1",
    generateSessionCheckout: () => ({ ok: true, summary: { session_id: "sid-a" } }),
    getBlackboxState: () => ({ enabled: true, sessions: {} }),
    saveBlackboxVector: () => {},
    saveBlackboxOutcome: () => {},
    listSessionTemplates: () => [],
    getSessionOrchestration: () => null,
    mutateSessionOrchestration: () => null,
    setSessionTemplate: () => null,
  })

  const instance = await server.start(0)
  const address = instance.address()
  const port = typeof address === "object" && address ? address.port : 0
  const base = `http://127.0.0.1:${port}`
  try {
    const capabilities = await fetch(`${base}/capabilities`).then((r) => r.json())
    assert.equal(capabilities.web_search.enabled, false)
    assert.equal(capabilities.web_search.backend_status, 404)
  } finally {
    process.env.VIBEOS_API_URL = previousApiUrl
    await server.close()
    await new Promise((resolve) => backend.close(() => resolve()))
  }
})
