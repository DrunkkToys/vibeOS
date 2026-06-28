import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { buildOrchestrationPlan, vibeultraxControlVector } from "../blackbox/vibeultrax.js"
import { buildStatusPayload } from "../../lib/runtime-surface.js"
import { buildDashboardHomeModel } from "../../lib/session-orchestrator.js"

describe("vibeultrax orchestration", () => {
  it("routes long noisy prompts through compression first", () => {
    const plan = buildOrchestrationPlan({
      user_text: " ".repeat(10) + "This is a very long transcript that should be compressed before anything else. ".repeat(40),
      context_budget_pct: 88,
    })

    assert.equal(plan.plan_kind, "compress-first")
    assert.equal(plan.steps[0].action, "compress")
    assert.match(plan.recommended_next_action, /Compress context first/i)
  })

  it("routes code-heavy prompts through TDD first", () => {
    const plan = buildOrchestrationPlan({
      user_text: "Fix the API route and add tests for the new handler before editing the implementation.",
    })

    assert.equal(plan.plan_kind, "tdd-first")
    assert.equal(plan.steps[0].action, "tdd")
    assert.match(plan.recommended_next_action, /TDD helpers first/i)
  })

  it("routes recency prompts through web-search first", () => {
    const plan = buildOrchestrationPlan({
      user_text: "What changed in the latest API docs and cite the sources.",
    })

    assert.equal(plan.plan_kind, "search-first")
    assert.equal(plan.steps[0].action, "web-search")
    assert.match(plan.recommended_next_action, /web-search first/i)
  })

  it("lets VibeUltraX escalate mixed prompts before the helper order is chosen", () => {
    const cv = vibeultraxControlVector({
      user_text: "Fix the dashboard flow and also check the latest docs for a new endpoint.",
      sub_regime: "REFINING",
      stress_multiplier: 0.75,
    })

    assert.equal(cv.optimization_mode, "vibeultrax")
    assert.equal(cv.orchestration_plan.plan_kind, "ultrax-escalate")
    assert.equal(cv.orchestration_steps[0].action, "vibeultrax")
    assert.ok(cv.orchestration_recommended_next_action.includes("VibeUltraX"))
  })

  it("surfaces the live orchestration plan in the status payload and dashboard summary", () => {
    const blackbox = {
      sessions: {
        "sid-1": {
          orchestration_plan: {
            plan_kind: "search-first",
            recommended_next_action: "Use web-search first, then feed citations back into the main decision path.",
            reason: "Fresh facts are needed.",
            confidence: 0.91,
            steps: [{ action: "web-search", auto_execute: true, reason: "Ground the answer in current sources before taking the next turn." }],
          },
        },
      },
    }

    const status = buildStatusPayload({
      selection: { enabled: true, active_slot: "brain", delegation_enforce: true, flow_enabled: true, flow_enforce: true, tdd_enforce: true, tdd_strict: true, thinking_level: "full" },
      tiersData: { trinity: { brain: { oc: "model-brain" } } },
      currentModel: "model-brain",
      creditPercent: 88,
      version: "1.0.0",
      todos: [],
      blackbox,
      sessionId: "sid-1",
    })

    const dashboard = buildDashboardHomeModel({
      currentSessionId: "sid-1",
      status,
      savings: { lifetime: { delegation_usd: 0, cache_usd: 0 }, current_session: { delegation_usd: 0, cache_usd: 0 } },
      todos: [],
      blackbox,
      sessions: {
        "sid-1": {
          started: "2026-06-27T10:00:00.000Z",
          orchestration: { status: "active", locked: false, archived: false, tags: [], notes: [], lifecycle: {}, template: null, version: 1, history: [] },
        },
      },
      metrics: {},
      currentProjectName: "demo",
    })

    assert.equal(status.recommended_next_action, "Use web-search first, then feed citations back into the main decision path.")
    assert.equal(status.orchestration_plan.plan_kind, "search-first")
    assert.equal(dashboard.current_session.orchestration_plan.plan_kind, "search-first")
    assert.equal(dashboard.current_session.recommendation, "Use web-search first, then feed citations back into the main decision path.")
  })
})
