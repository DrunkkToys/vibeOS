import test from "node:test"
import assert from "node:assert/strict"

import {
  TEMPLATE_LIBRARY,
  buildDashboardHomeModel,
  compareSessionOrchestrations,
  exportSessionOrchestration,
  importSessionOrchestration,
  applySessionAction,
  normalizeSessionOrchestration,
  normalizeSessionTemplate,
  resolveSessionTemplateDefinition,
} from "../src/lib/session-orchestrator.js"

test("session orchestrator normalizes malformed session workspace state", () => {
  const session = normalizeSessionOrchestration(
    {
      status: "paused",
      locked: true,
      tags: "ops",
      notes: [{ text: "ship it" }, null],
      template: { id: "custom", body: "  test template  ", revision: 2 },
    },
    "sid-1"
  )

  assert.equal(session.session_id, "sid-1")
  assert.equal(session.status, "paused")
  assert.equal(session.locked, true)
  assert.deepEqual(session.tags, ["ops"])
  assert.equal(session.notes.length, 1)
  assert.equal(session.template.body, "test template")
  assert.equal(session.template.signature.length > 0, true)
})

test("template definition resolves preset and custom session overrides", () => {
  const preset = resolveSessionTemplateDefinition(normalizeSessionTemplate({ id: "quality" }, "sid-1"))
  assert.equal(preset.id, "quality")
  assert.equal(preset.source, "preset")
  assert.equal(TEMPLATE_LIBRARY.some((tpl) => tpl.id === "quality"), true)

  const custom = resolveSessionTemplateDefinition(normalizeSessionTemplate({
    label: "Session TDD",
    body: "Write one happy-path test and one boundary test.",
  }, "sid-2"))
  assert.equal(custom.source, "custom")
  assert.equal(custom.signature.startsWith("session-"), true)
})

test("dashboard home model highlights the active session and recommendation", () => {
  const model = buildDashboardHomeModel({
    currentSessionId: "sid-current",
    status: {
      active_slot: "brain",
      current_model: "model-a",
      current_provider: "Provider A",
      backend_connected: true,
      model_locked: false,
      credit_percent: 82,
      version: "1.0.0",
    },
    savings: {
      lifetime: { delegation_usd: 11, cache_usd: 2 },
      current_session: { delegation_usd: 4, cache_usd: 1 },
      trend: "up",
      savings_rate_per_hour: 1.5,
    },
    todos: [{ status: "pending" }, { status: "done" }],
    blackbox: {
      enabled: true,
      sub_regime: "REFINING",
      resolution: "working",
      momentum: 0.6,
    },
    sessions: {
      "sid-current": {
        started: "2026-06-19T10:00:00.000Z",
        cost_usd: 3.25,
        orchestration: {
          status: "paused",
          locked: false,
          tags: ["api", "dashboard"],
          notes: [{ text: "Need a per-session TDD template." }],
          template: { id: "quality", body: "Use three focused tests.", revision: 1 },
        },
      },
      "sid-old": {
        started: "2026-06-18T10:00:00.000Z",
        cost_usd: 1.11,
      },
    },
  })

  assert.equal(model.home.title, "Executive Summary")
  assert.equal(model.current_session.session_id, "sid-current")
  assert.equal(model.current_session.orchestration.status, "paused")
  assert.equal(model.current_session.notes_count, 1)
  assert.equal(model.current_session.recommendation.includes("Resume"), true)
  assert.equal(model.sessions.length, 2)
  assert.equal(model.sessions[0].session_id, "sid-current")
  assert.equal(model.session_actions.includes("archive"), true)
  assert.equal(model.template_editor.enabled, true)
  assert.equal(model.template_editor.can_version, true)
  assert.equal(model.template_editor.templates.length > 0, true)
})

// Regression: buildDashboardHomeModel's `sessions` param feeds /dashboard/home
// directly from getMergedSessionsMap(deps) -- a THIRD unscoped call site for the
// same session leak fixed in vibeos-mcp-server.ts's buildLocalSessions() (which
// only covers /sessions, not /dashboard/home). Live-confirmed via a raw
// /dashboard/home fetch showing sessions from unrelated projects with no cap.
test("dashboard home model excludes sessions with a confirmed different project fingerprint", () => {
  const model = buildDashboardHomeModel({
    currentSessionId: "sid-current",
    sessions: {
      "sid-current": { started: "2026-07-13T10:00:00.000Z", project_fingerprint: "fp-a" },
      "sid-foreign": { started: "2026-07-13T11:00:00.000Z", project_fingerprint: "fp-b" },
    },
    currentProjectFingerprint: "fp-a",
  })
  const ids = model.sessions.map((s) => s.session_id)
  assert.ok(ids.includes("sid-current"))
  assert.ok(!ids.includes("sid-foreign"), "must exclude a session confirmed to belong to a different project")
})

test("dashboard home model keeps sessions with no project_fingerprint at all", () => {
  const model = buildDashboardHomeModel({
    currentSessionId: "sid-current",
    sessions: {
      "sid-current": { started: "2026-07-13T10:00:00.000Z", project_fingerprint: "fp-a" },
      "sid-unscoped": { started: "2026-07-13T09:00:00.000Z" },
    },
    currentProjectFingerprint: "fp-a",
  })
  const ids = model.sessions.map((s) => s.session_id)
  assert.ok(ids.includes("sid-unscoped"), "must not hide sessions that were never stamped with a fingerprint")
})

test("dashboard home model caps sessions to 10, most recent first (current session always pinned first)", () => {
  const sessions = {}
  for (let i = 0; i < 20; i++) {
    sessions[`s${i}`] = { started: new Date(2026, 6, 1, 0, i).toISOString() }
  }
  const model = buildDashboardHomeModel({
    currentSessionId: "s0",
    sessions,
  })
  assert.equal(model.sessions.length, 10, "must cap the returned sessions list to 10")
  assert.equal(model.totals.total_sessions, 20, "totals.total_sessions must reflect the true in-scope count, not the capped list")
  assert.equal(model.sessions[0].session_id, "s0", "current session stays pinned first regardless of recency")
})

test("session orchestrator versions history and supports undo/batch", () => {
  const started = normalizeSessionOrchestration({ status: "active", template: { id: "save", body: "Keep it short." } }, "sid-1")
  const annotated = applySessionAction(started, "annotate", { note: "first note" })
  const retagged = applySessionAction(annotated, "retag", { tags: ["api", "dashboard"] })
  const batched = applySessionAction(retagged, "batch", {
    actions: [
      { action: "pause" },
      { action: "set-template", payload: { template_id: "quality", body: "Write real assertions." } },
    ],
  })

  assert.equal(started.version >= 1, true)
  assert.equal(annotated.version, started.version + 1)
  assert.equal(retagged.version, annotated.version + 1)
  assert.equal(batched.version, retagged.version + 1)
  assert.equal(batched.status, "paused")
  assert.equal(batched.template.label, "Quality")
  assert.equal(batched.history.length >= 3, true)

  const undone = applySessionAction(batched, "undo")
  assert.equal(undone.status, retagged.status)
  assert.deepEqual(undone.tags, retagged.tags)
  assert.equal(undone.template.signature, retagged.template.signature)
  assert.equal(undone.history.length, batched.history.length - 1)
})

test("session orchestrator compare/export/import preserve real session state", () => {
  const left = normalizeSessionOrchestration({
    session_id: "sid-left",
    status: "active",
    locked: false,
    tags: ["api"],
    notes: [{ text: "one" }],
    template: { id: "save", body: "Keep it short.", revision: 1 },
  }, "sid-left")
  const right = normalizeSessionOrchestration({
    session_id: "sid-right",
    status: "archived",
    locked: true,
    tags: ["api", "dashboard"],
    notes: [{ text: "one" }, { text: "two" }],
    template: { id: "quality", body: "Write real assertions.", revision: 3 },
  }, "sid-right")

  const compare = compareSessionOrchestrations(left, right)
  assert.equal(compare.status_changed, true)
  assert.equal(compare.lock_changed, true)
  assert.equal(compare.template_changed, true)
  assert.deepEqual(compare.tag_diff.added, ["dashboard"])
  assert.equal(compare.notes_delta, 1)

  const exported = exportSessionOrchestration(right, "sid-right")
  const imported = importSessionOrchestration(exported, "sid-right")
  assert.equal(imported.session_id, "sid-right")
  assert.equal(imported.template.revision, 3)
  assert.equal(imported.version, right.version)
})
