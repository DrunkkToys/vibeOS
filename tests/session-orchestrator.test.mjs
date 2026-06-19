import test from "node:test"
import assert from "node:assert/strict"

import {
  TEMPLATE_LIBRARY,
  buildDashboardHomeModel,
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
})
