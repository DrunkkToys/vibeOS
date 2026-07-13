import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { createMcpServer } from "../src/lib/vibeos-mcp-server.js"

// dashboard-bridge.ts's projection cache lives under getVibeOSHome() (real disk
// state, shared with any live OpenCode Desktop session on this machine). Isolate
// HOME so this test doesn't read/pollute that shared file -- confirmed via a stale
// cached "sessions" projection silently overriding total_sessions in an earlier,
// non-isolated version of this test.
let _origHome, _tmpDir
before(() => {
  _origHome = process.env.HOME
  _tmpDir = mkdtempSync(join(import.meta.dirname, "../tmp-dashboard-sessions-test-"))
  process.env.HOME = _tmpDir
})
after(() => {
  process.env.HOME = _origHome
  if (_tmpDir) { try { rmSync(_tmpDir, { recursive: true, force: true }) } catch {} }
})

// Regression: `/sessions` (feeding the dashboard's "Recent Sessions" card and the
// Sessions table) returned EVERY session vibeOS has ever tracked, across every
// project, with no cap -- the same unscoped-leak class as the todo bug (#452,
// #454), just for sessions instead of todos. Live-confirmed: delegation-state.json
// had 32 tracked sessions, only 7 tagged to the current project, and the dashboard
// showed all of them with no recency limit. Unlike todos, most untagged sessions
// are genuinely recent/current-project (project_fingerprint stamping predates full
// wiring for some session-id formats) -- so the fix excludes only sessions with a
// CONFIRMED different fingerprint, sorts by recency, and caps to 10.
function baseDeps(sessions) {
  return {
    getState: () => ({ enabled: true, sessions_raw: sessions }),
    getSavings: () => ({ lifetime: { delegation_usd: 0 } }),
    getTodos: () => [],
    getSessionMetrics: () => ({}),
    getCurrentSessionId: () => "current",
    listReports: () => [],
    readReport: () => null,
    runDiagnose: () => ({ ok: true }),
    runProject: () => ({ ok: true }),
    runTrinity: async () => "ok",
    runResearchAudit: () => ({ ok: true }),
    saveReport: () => null,
    generateSessionCheckout: () => ({ ok: true }),
    getBlackboxState: () => ({ enabled: true, sessions: {} }),
    saveBlackboxVector: () => {},
    saveBlackboxOutcome: () => {},
    listSessionTemplates: () => [],
    getSessionOrchestration: () => null,
    mutateSessionOrchestration: () => null,
  }
}

async function withServer(deps, fn) {
  const server = createMcpServer(deps)
  const instance = await server.start(0)
  const address = instance.address()
  const port = typeof address === "object" && address ? address.port : 0
  try {
    return await fn(port)
  } finally {
    await server.close()
  }
}

test("dashboard /sessions excludes sessions with a confirmed different project fingerprint", async () => {
  const sessions = {
    "mine-1": { project_fingerprint: "fp-a", last_updated: "2026-07-13T10:00:00.000Z" },
    "other-1": { project_fingerprint: "fp-b", last_updated: "2026-07-13T11:00:00.000Z" },
  }
  const deps = { ...baseDeps(sessions), currentProjectFingerprint: "fp-a" }
  await withServer(deps, async (port) => {
    const payload = await fetch(`http://127.0.0.1:${port}/sessions`).then((r) => r.json())
    const ids = payload.sessions.map((s) => s.session_id)
    assert.ok(ids.includes("mine-1"), "must include the current project's session")
    assert.ok(!ids.includes("other-1"), "must exclude a session confirmed to belong to a different project")
  })
})

test("dashboard /sessions keeps sessions with no project_fingerprint at all (not confirmed foreign)", async () => {
  const sessions = {
    "unscoped-1": { last_updated: "2026-07-13T10:00:00.000Z" },
    "mine-1": { project_fingerprint: "fp-a", last_updated: "2026-07-13T09:00:00.000Z" },
  }
  const deps = { ...baseDeps(sessions), currentProjectFingerprint: "fp-a" }
  await withServer(deps, async (port) => {
    const payload = await fetch(`http://127.0.0.1:${port}/sessions`).then((r) => r.json())
    const ids = payload.sessions.map((s) => s.session_id)
    assert.ok(ids.includes("unscoped-1"), "must not hide sessions that were never stamped with a fingerprint")
    assert.ok(ids.includes("mine-1"))
  })
})

test("dashboard /sessions caps the returned list to 10, sorted most-recent-first", async () => {
  const sessions = {}
  for (let i = 0; i < 25; i++) {
    sessions[`s${i}`] = { last_updated: new Date(2026, 6, 1, 0, i).toISOString() }
  }
  const deps = { ...baseDeps(sessions), currentProjectFingerprint: "" }
  await withServer(deps, async (port) => {
    const payload = await fetch(`http://127.0.0.1:${port}/sessions`).then((r) => r.json())
    assert.equal(payload.sessions.length, 10, "must cap the returned list to 10 sessions")
    assert.equal(payload.total_sessions, 25, "total_sessions must still reflect the true in-scope count")
    assert.equal(payload.sessions[0].session_id, "s24", "most recently updated session must be first")
    assert.equal(payload.sessions[9].session_id, "s15", "10th entry must be the 10th most recent")
  })
})
