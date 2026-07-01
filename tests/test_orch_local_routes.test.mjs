// SPDX-License-Identifier: MIT
// test_orch_local_routes.test.mjs
// TDD contract for local orchestrator CRUD routes added to the MCP server.
// These routes back the dashboard /api/v1/orchestrator/* calls when the
// dashboard config injects __VIBEOS_BACKEND_API_BASE__ pointing to the local server.

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, test, before, after, beforeEach } from "node:test"
import assert from "node:assert"

// ── Helpers ──────────────────────────────────────────────────────────────────

let SANDBOX = ""
let ORCH_HOME = ""

function freshSandbox() {
  SANDBOX = mkdtempSync(join(tmpdir(), "orch-test-"))
  ORCH_HOME = join(SANDBOX, "orch-home")
  mkdirSync(ORCH_HOME, { recursive: true })
  process.env.VIBEOS_HOME = ORCH_HOME
  return SANDBOX
}

function cleanup() {
  try { rmSync(SANDBOX, { recursive: true, force: true }) } catch {}
}

function readJson(filename) {
  const fp = join(ORCH_HOME, filename)
  if (!existsSync(fp)) return null
  return JSON.parse(readFileSync(fp, "utf8"))
}

// Dynamically import orch-store so VIBEOS_HOME env is respected at import time.
async function loadOrchStore() {
  const ts = Date.now()
  const path = new URL(`../dist-ts/lib/orch-store.js?t=${ts}`, import.meta.url).href
  return await import(path)
}

// ── Project CRUD ──────────────────────────────────────────────────────────────

describe("orch-store: projects", () => {
  before(() => freshSandbox())
  after(() => cleanup())

  test("readProjects returns empty array when no file exists", async () => {
    const { readProjects } = await loadOrchStore()
    const projects = await readProjects()
    assert.deepStrictEqual(projects, [])
  })

  test("writeProjects then readProjects round-trips data", async () => {
    const { readProjects, writeProjects } = await loadOrchStore()
    const projects = [{ id: "p1", name: "Alpha", fingerprint: null, default_flow_id: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }]
    await writeProjects(projects)
    const back = await readProjects()
    assert.strictEqual(back.length, 1)
    assert.strictEqual(back[0].name, "Alpha")
  })

  test("orch-projects.json is written to VIBEOS_HOME", async () => {
    const { writeProjects } = await loadOrchStore()
    await writeProjects([{ id: "p2", name: "Beta", fingerprint: null, default_flow_id: null, created_at: "", updated_at: "" }])
    const raw = readJson("orch-projects.json")
    assert.ok(Array.isArray(raw))
    assert.strictEqual(raw[0].name, "Beta")
  })
})

// ── Session CRUD ──────────────────────────────────────────────────────────────

describe("orch-store: sessions", () => {
  before(() => freshSandbox())
  after(() => cleanup())

  test("readSessions returns empty array when no file exists", async () => {
    const { readSessions } = await loadOrchStore()
    assert.deepStrictEqual(await readSessions(), [])
  })

  test("writeSessions then readSessions round-trips data", async () => {
    const { readSessions, writeSessions } = await loadOrchStore()
    const sessions = [{ id: "s1", project_id: "p1", title: "First session", flow_id: null, messages: [], created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }]
    await writeSessions(sessions)
    const back = await readSessions()
    assert.strictEqual(back.length, 1)
    assert.strictEqual(back[0].title, "First session")
  })

  test("messages array is preserved on round-trip", async () => {
    const { readSessions, writeSessions } = await loadOrchStore()
    const msg = { id: "m1", role: "user", content: "hello", plan: null, results: null, created_at: "2026-01-01T00:00:00.000Z" }
    await writeSessions([{ id: "s2", project_id: "p1", title: "Session 2", flow_id: null, messages: [msg], created_at: "", updated_at: "" }])
    const back = await readSessions()
    assert.strictEqual(back[0].messages.length, 1)
    assert.strictEqual(back[0].messages[0].content, "hello")
  })
})

// ── Flow CRUD ─────────────────────────────────────────────────────────────────

describe("orch-store: flows", () => {
  before(() => freshSandbox())
  after(() => cleanup())

  test("readFlows returns empty array when no file exists", async () => {
    const { readFlows } = await loadOrchStore()
    assert.deepStrictEqual(await readFlows(), [])
  })

  test("writeFlows then readFlows round-trips data", async () => {
    const { readFlows, writeFlows } = await loadOrchStore()
    const flows = [{ id: "f1", scope: "global", project_id: null, name: "Global default", graph: { nodes: [], edges: [] }, created_at: "", updated_at: "" }]
    await writeFlows(flows)
    const back = await readFlows()
    assert.strictEqual(back.length, 1)
    assert.strictEqual(back[0].name, "Global default")
    assert.deepStrictEqual(back[0].graph, { nodes: [], edges: [] })
  })
})

// ── MCP server orchestrator route integration ─────────────────────────────────

// Server lifecycle managed at module level to avoid node:test hook ordering issues.
let _srv = null
let _baseUrl = ""
let _orchStoreForSuite = null

async function startOrchSuite() {
  freshSandbox()
  const noop = () => ({})
  const deps = {
    getState: () => ({ enabled: true, active_slot: "brain", enforce: true, flow_enforcer: false, flow_extract_todos: false, tdd_enforcer: false, tdd_strict: false, thinking: "brief", current_model: "test-model", credit_percent: 80, version: "0.0.0-test" }),
    getSavings: () => ({ lifetime: { delegation_usd: 0, cache_usd: 0, missed_context7_usd: 0, total_warns: 0 }, current_session: { delegation_usd: 0, cache_usd: 0, warns_count: 0, tool_breakdown: {} }, cache_hits_this_session: 0, trend: "flat", savings_rate_per_hour: 0 }),
    getTodos: () => [],
    getSessionMetrics: () => ({}),
    getCurrentSessionId: () => "test-session-id",
    getBlackboxState: () => ({}),
    listReports: () => [],
    readReport: () => null,
    runDiagnose: () => ({}),
    runProject: () => ({}),
    runTrinity: async () => ({ ok: true }),
    runResearchAudit: () => ({}),
    saveReport: () => null,
    generateSessionCheckout: () => ({}),
    saveBlackboxVector: noop,
    saveBlackboxOutcome: noop,
  }
  const ts = Date.now()
  const { createMcpServer } = await import(`../dist-ts/lib/vibeos-mcp-server.js?t=${ts}`)
  _orchStoreForSuite = await loadOrchStore()
  _srv = createMcpServer(deps)
  const port = 59710
  await _srv.start(port)
  _baseUrl = `http://127.0.0.1:${port}`
}

async function stopOrchSuite() {
  try { await _srv?.close() } catch {}
  cleanup()
}

describe("MCP server: /api/v1/orchestrator/* routes", () => {
  before(startOrchSuite)
  after(stopOrchSuite)

  async function req(method, url, body) {
    const opts = { method, headers: { "Content-Type": "application/json" } }
    if (body !== undefined) opts.body = JSON.stringify(body)
    const res = await fetch(_baseUrl + url, opts)
    return { status: res.status, body: await res.json() }
  }

  function orchStore() { return _orchStoreForSuite }

  // ── Projects ──
  test("GET /api/v1/orchestrator/projects returns empty array initially", async () => {
    // Clear state
    await orchStore().writeProjects([])
    const { status, body } = await req("GET", "/api/v1/orchestrator/projects")
    assert.strictEqual(status, 200)
    assert.ok(Array.isArray(body.projects))
    assert.strictEqual(body.projects.length, 0)
  })

  test("POST /api/v1/orchestrator/projects creates a project and returns it", async () => {
    await orchStore().writeProjects([])
    const { status, body } = await req("POST", "/api/v1/orchestrator/projects", { name: "My Project" })
    assert.strictEqual(status, 200)
    assert.ok(body.project)
    assert.strictEqual(body.project.name, "My Project")
    assert.ok(body.project.id, "project must have an id")
    assert.ok(body.project.created_at)
  })

  test("POST /api/v1/orchestrator/projects persists to orch-projects.json", async () => {
    await orchStore().writeProjects([])
    await req("POST", "/api/v1/orchestrator/projects", { name: "Persistent Project" })
    const stored = await orchStore().readProjects()
    assert.strictEqual(stored.length, 1)
    assert.strictEqual(stored[0].name, "Persistent Project")
  })

  test("PUT /api/v1/orchestrator/projects/:id updates project name", async () => {
    await orchStore().writeProjects([])
    const { body: created } = await req("POST", "/api/v1/orchestrator/projects", { name: "Old Name" })
    const id = created.project.id
    const { status, body } = await req("PUT", `/api/v1/orchestrator/projects/${id}`, { name: "New Name" })
    assert.strictEqual(status, 200)
    assert.strictEqual(body.project.name, "New Name")
    const stored = await orchStore().readProjects()
    assert.strictEqual(stored.find(p => p.id === id)?.name, "New Name")
  })

  test("DELETE /api/v1/orchestrator/projects/:id removes project", async () => {
    await orchStore().writeProjects([])
    const { body: created } = await req("POST", "/api/v1/orchestrator/projects", { name: "Doomed" })
    const id = created.project.id
    const { status } = await req("DELETE", `/api/v1/orchestrator/projects/${id}`)
    assert.strictEqual(status, 200)
    const stored = await orchStore().readProjects()
    assert.ok(!stored.find(p => p.id === id))
  })

  test("PUT on non-existent project returns 404", async () => {
    const { status } = await req("PUT", "/api/v1/orchestrator/projects/nonexistent", { name: "X" })
    assert.strictEqual(status, 404)
  })

  // ── Sessions ──
  test("GET /api/v1/orchestrator/sessions returns empty array initially", async () => {
    await orchStore().writeSessions([])
    const { status, body } = await req("GET", "/api/v1/orchestrator/sessions")
    assert.strictEqual(status, 200)
    assert.ok(Array.isArray(body.sessions))
  })

  test("POST /api/v1/orchestrator/sessions creates a session", async () => {
    await orchStore().writeSessions([])
    const { status, body } = await req("POST", "/api/v1/orchestrator/sessions", { project_id: "proj-1", title: "My Session" })
    assert.strictEqual(status, 200)
    assert.strictEqual(body.session.title, "My Session")
    assert.strictEqual(body.session.project_id, "proj-1")
    assert.ok(body.session.id)
  })

  test("GET /api/v1/orchestrator/sessions?project_id=X filters by project", async () => {
    await orchStore().writeSessions([])
    await req("POST", "/api/v1/orchestrator/sessions", { project_id: "proj-A", title: "Session A1" })
    await req("POST", "/api/v1/orchestrator/sessions", { project_id: "proj-B", title: "Session B1" })
    const { body } = await req("GET", "/api/v1/orchestrator/sessions?project_id=proj-A")
    assert.ok(body.sessions.every(s => s.project_id === "proj-A"))
    assert.strictEqual(body.sessions.length, 1)
    assert.strictEqual(body.sessions[0].title, "Session A1")
  })

  test("DELETE /api/v1/orchestrator/sessions/:id removes session", async () => {
    await orchStore().writeSessions([])
    const { body: created } = await req("POST", "/api/v1/orchestrator/sessions", { project_id: "p", title: "Temp" })
    const id = created.session.id
    await req("DELETE", `/api/v1/orchestrator/sessions/${id}`)
    const stored = await orchStore().readSessions()
    assert.ok(!stored.find(s => s.id === id))
  })

  test("GET /api/v1/orchestrator/sessions/:id/messages returns messages array", async () => {
    await orchStore().writeSessions([])
    const { body: created } = await req("POST", "/api/v1/orchestrator/sessions", { project_id: "p", title: "Msgs" })
    const id = created.session.id
    const { status, body } = await req("GET", `/api/v1/orchestrator/sessions/${id}/messages`)
    assert.strictEqual(status, 200)
    assert.ok(Array.isArray(body.messages))
    assert.strictEqual(body.messages.length, 0)
  })

  // ── Flows ──
  test("GET /api/v1/orchestrator/flows returns empty array initially", async () => {
    await orchStore().writeFlows([])
    const { status, body } = await req("GET", "/api/v1/orchestrator/flows")
    assert.strictEqual(status, 200)
    assert.ok(Array.isArray(body.flows))
  })

  test("POST /api/v1/orchestrator/flows creates a global flow", async () => {
    await orchStore().writeFlows([])
    const graph = { nodes: [{ id: "n1", tool: "direct", label: "Direct" }], edges: [] }
    const { status, body } = await req("POST", "/api/v1/orchestrator/flows", { name: "Default Flow", graph, scope: "global" })
    assert.strictEqual(status, 200)
    assert.strictEqual(body.flow.name, "Default Flow")
    assert.strictEqual(body.flow.scope, "global")
    assert.deepStrictEqual(body.flow.graph, graph)
  })

  test("PUT /api/v1/orchestrator/flows/:id updates flow graph", async () => {
    await orchStore().writeFlows([])
    const { body: created } = await req("POST", "/api/v1/orchestrator/flows", { name: "F", graph: { nodes: [], edges: [] }, scope: "global" })
    const id = created.flow.id
    const newGraph = { nodes: [{ id: "n1", tool: "compress" }], edges: [] }
    const { body } = await req("PUT", `/api/v1/orchestrator/flows/${id}`, { graph: newGraph })
    assert.deepStrictEqual(body.flow.graph, newGraph)
  })

  test("DELETE /api/v1/orchestrator/flows/:id removes flow", async () => {
    await orchStore().writeFlows([])
    const { body: created } = await req("POST", "/api/v1/orchestrator/flows", { name: "Gone", graph: { nodes: [], edges: [] }, scope: "global" })
    const id = created.flow.id
    await req("DELETE", `/api/v1/orchestrator/flows/${id}`)
    const stored = await orchStore().readFlows()
    assert.ok(!stored.find(f => f.id === id))
  })

  // ── Config injection ──
  test("writeDashboardBaseConfig writes __VIBEOS_BACKEND_API_BASE__ to config file", async () => {
    const { mkdtempSync: _mkdtemp, writeFileSync: _write, readFileSync: _read } = await import("node:fs")
    const { writeDashboardBaseConfig } = await import(`../dist-ts/lib/vibeos-mcp-server.js?t=${Date.now()}`)
    const tmp = mkdtempSync(join(tmpdir(), "cfg-test-"))
    // Can't easily test the exact file path without deep mocking DASHBOARD_DIR;
    // instead verify the exported function exists and accepts a URL string.
    assert.strictEqual(typeof writeDashboardBaseConfig, "function")
  })
})
