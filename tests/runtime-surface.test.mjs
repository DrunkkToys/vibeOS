import test from "node:test"
import assert from "node:assert/strict"

import {
  buildStatusPayload,
  buildSavingsPayload,
  buildSessionCheckout,
  diagnoseStructuredFromText,
  projectStructuredFromText,
} from "../src/lib/runtime-surface.js"

test("buildStatusPayload assembles dashboard state from injected inputs", () => {
  const payload = buildStatusPayload({
    selection: {
      enabled: true,
      active_slot: "medium",
      delegation_enforce: true,
      flow_enabled: false,
      flow_enforce: true,
      tdd_enforce: true,
      tdd_strict: false,
      thinking_level: "full",
    },
    tiersData: { trinity: { medium: { oc: "model-medium" } } },
    currentModel: "fallback-model",
    creditPercent: 73,
    version: "1.2.3",
    todos: [{ status: "pending" }, { status: "done" }],
    fallbackThinking: "brief",
  })

  assert.deepEqual(payload, {
    enabled: true,
    active_slot: "medium",
    enforce: true,
    flow_enforcer: false,
    flow_extract_todos: true,
    tdd_enforcer: true,
    tdd_strict: false,
    thinking: "full",
    current_model: "model-medium",
    current_provider: "Unknown",
    current_quality_tier: "Cheap",
    credit_percent: 73,
    version: "1.2.3",
    todos: { total: 2, pending: 1 },
    backend_connected: false,
    backend_health_url: null,
    backend_version: null,
    api_fallback: false,
    api_fallback_since: null,
    model_locked: false,
    locked_slot: null,
    locked_model: null,
    label_modes: ["Fast", "Balanced", "High Quality", "Cheap"],
  })
})

test("buildSavingsPayload keeps the savings categories separate", () => {
  const payload = buildSavingsPayload({
    lifetime: {
      ltTasks: 1.25,
      ltCache: 0.5,
      missedC7: 0.12,
      count: 4,
      sesTasks: 0.4,
      sesToolBreakdown: { write: 2 },
      sesTrend: "up",
      sesRatePerHour: 3.2,
    },
    session: {
      cache_savings_usd: 0.2,
      warns: [{}, {}],
      cache_hits: [1, 2, 3],
    },
  })

  assert.deepEqual(payload, {
    lifetime: {
      delegation_usd: 1.25,
      cache_usd: 0.5,
      missed_context7_usd: 0.12,
      total_warns: 4,
    },
    current_session: {
      delegation_usd: 0.4,
      cache_usd: 0.2,
      warns_count: 2,
      tool_breakdown: { write: 2 },
    },
    telemetry: {
      lifetime_events: 0,
      current_session_events: 0,
      storage_bytes_estimate: 0,
      retained_sessions: 0,
      tool_counts: {},
      tier_counts: {},
      slot_counts: {},
      kind_counts: {},
      prompt_size_buckets: {},
      output_size_buckets: {},
      duration_buckets: {},
      result_counts: {},
      cache_hit_counts: { hit: 0, miss: 0 },
      enforcement_counts: {},
      flow_counts: {},
      tdd_counts: {},
      last_seen: null,
      last_compacted_at: null,
    },
    cache_hits_this_session: 3,
    trend: "up",
    savings_rate_per_hour: 3.2,
  })
})

test("buildSessionCheckout returns a report and summary without extra state", () => {
  const payload = buildSessionCheckout({
    sessionId: "sess-1",
    metrics: {
      sesDuration: 90,
      sesDurationFormatted: "1m 30s",
      sesTasks: 2.5,
      sesToolBreakdown: { write: 2 },
      sesModelTurns: { brain: 1, worker: 4 },
      sesTrend: "down",
    },
    session: {
      cost_usd: 4.25,
      cache_savings_usd: 0.75,
      warns: [
        { tool: "write", reason: "blocked direct write", est_savings_usd: 0.02 },
        { tool: "edit", reason: "delegated edit", est_savings_usd: 0.03 },
      ],
    },
    flowWarns: [{ sid: "x", path: "foo.ts" }],
  })

  assert.equal(payload.summary.session_id, "sess-1")
  assert.equal(payload.summary.savings.total_usd, 3.25)
  assert.equal(payload.summary.tools.top_expensive_operations[0].tool, "edit")
  assert.equal(payload.report.type, "session-checkout")
  assert.match(payload.report.summary, /Session checkout sess-1/)
})

test("diagnoseStructuredFromText extracts the actionable maintenance hints", () => {
  const payload = diagnoseStructuredFromText(
    [
      "✅ model-tiers.json",
      "brain slot → keep brain stable",
      "API fallback: active since 2026-06-11T00:00:00.000Z",
      "credit 82%",
      "❌ something else",
    ].join("\n"),
    55
  )

  assert.equal(payload.config_valid, false)
  assert.equal(payload.credit.percent, 82)
  assert.deepEqual(payload.suggestions, ["brain slot → keep brain stable"])
  assert.equal(payload.files[0].path, "✅ model-tiers.json")
  assert.equal(payload.model_probes[0].slot, "brain slot → keep brain stable")
  assert.equal(payload.api_fallback.active, true)
})

test("projectStructuredFromText captures route split and enforcement state", () => {
  const payload = projectStructuredFromText(
    ["Brain 65%", "Worker 35%", "💡 keep fixes scoped"].join("\n"),
    { delegation_enforce: true, flow_enabled: true },
    44
  )

  assert.deepEqual(payload, {
    brain_pct: 65,
    worker_pct: 35,
    enforcement_status: "enforce",
    flow_status: "on",
    credit_percent: 44,
    suggestions: ["keep fixes scoped"],
  })
})
