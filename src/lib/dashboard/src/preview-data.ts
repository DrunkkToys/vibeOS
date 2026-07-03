import type {
  CapabilitiesPayload,
  DashboardHomePayload,
  OrchFlow,
  OrchMessage,
  OrchProject,
  OrchSession,
  OrchStepResult,
  OrchPlan,
  ReportSummary,
  SavingsPayload,
  SessionDetailPayload,
  StatusPayload,
  WebSearchPayload,
} from "./api.js"

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowIso(): string {
  return new Date().toISOString()
}

function fmtUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

const projectId = "proj_dashboard"
const sessionId = "sess_vibeultra_exec"
const flowId = "flow_tdd_live"

const basePlan: OrchPlan = {
  recommended_next_action: "Resolve the API wiring, run the TDD flow, then verify the desktop 4-column session workspace.",
  recommended_label: "TDD Flow Plan",
  reason: "The dashboard must expose a strict deterministic execution path before allowing further session work.",
  confidence: 0.92,
  flow: true,
  steps: [
    { tool: "plan", label: "Resolve execution plan", reason: "Lock the next structured steps before any run." },
    { tool: "tdd", label: "Write failing expectation", reason: "Capture KPI, mode, and deterministic UI behavior in testable form." },
    { tool: "implement", label: "Wire API-backed session controls", reason: "Surface live mode, lock, policy, and plan data." },
    { tool: "web_search", label: "Ground research when needed", reason: "Only use structured search steps inside the session." },
    { tool: "verify", label: "Run preview and inspect layout", reason: "Confirm Home and 4-column workspace render operationally." },
  ],
  signals: {
    deterministic_execution_policy: "strict-deterministic",
    requested_optimization_mode: "vibeultrax",
    effective_optimization_mode: "vibeultrax",
    effective_slot: "brain",
  },
  capabilities: {
    web_search: true,
    tdd: true,
    vibeultrax: true,
  },
}

const preview = {
  status: {
    enabled: true,
    active_slot: "brain",
    enforce: true,
    flow_enforcer: true,
    flow_extract_todos: true,
    tdd_enforcer: true,
    tdd_strict: true,
    thinking: "full",
    current_model: "openai/gpt-5",
    current_provider: "OpenAI",
    current_quality_tier: "brain",
    credit_percent: 72,
    version: "preview",
    backend_connected: false,
    backendConnected: false,
    backend_api_url: "https://api.vibetheog.com/api/v1",
    backend_health_url: "https://api.vibetheog.com/health",
    backend_health_checked_at: nowIso(),
    backend_health_age_ms: 0,
    backend_health_latency_ms: null,
    backend_health_status: null,
    backend_health_error: "preview fallback",
    backend_version: null,
    api_fallback: true,
    api_fallback_since: nowIso(),
    model_locked: true,
    locked_slot: "brain",
    locked_model: "openai/gpt-5",
    optimization_mode: "vibeultrax",
    recommended_next_action: "Open the active session and run the TDD flow plan.",
    orchestration_plan: clone(basePlan),
    tiers: null,
    label_modes: ["vibeultrax", "vibeqmax", "vibemax", "vibelitex", "raw"],
    todos: { total: 6, pending: 4 },
    current_project_fingerprint: "dashboard/home-4col",
    current_project_name: "Dashboard Control Center",
    reality_check_enabled: true,
    reality_check_scope: "project",
    reality_check_project_id: projectId,
    reality_check_rules_count: 3,
  } as StatusPayload,
  savings: {
    lifetime: { delegation_usd: 18.34, cache_usd: 9.81, missed_context7_usd: 2.15, total_warns: 7 },
    current_session: {
      delegation_usd: 4.62,
      cache_usd: 1.28,
      warns_count: 1,
      tool_breakdown: { plan: 2.1, tdd: 1.7, web_search: 0.8, verify: 1.3 },
    },
    cache_hits_this_session: 14,
    trend: "up",
    savings_rate_per_hour: 3.9,
  } as SavingsPayload,
  capabilities: {
    web_search: { enabled: true, provider: "api", fixture_mode: true },
    compression: { enabled: true, provider: "local" },
    tdd: { enabled: true, provider: "local" },
    blackbox: { enabled: true, provider: "local" },
    vibemax: { enabled: true, provider: "local" },
    vibeqmax: { enabled: true, provider: "local" },
    vibeultrax: { enabled: true, provider: "local" },
    vibelitex: { enabled: true, provider: "local" },
    raw: { enabled: true, provider: "local" },
  } as CapabilitiesPayload,
  projects: [
    {
      id: projectId,
      name: "Dashboard Control Center",
      fingerprint: "dashboard/home-4col",
      default_flow_id: flowId,
      created_at: "2026-07-03T12:30:00.000Z",
      updated_at: "2026-07-03T15:05:00.000Z",
    },
  ] as OrchProject[],
  sessions: [
    {
      id: sessionId,
      project_id: projectId,
      title: "Executive Home + Deterministic Session Rail",
      flow_id: flowId,
      created_at: "2026-07-03T12:45:00.000Z",
      updated_at: "2026-07-03T15:06:00.000Z",
    },
  ] as OrchSession[],
  flows: [
    {
      id: flowId,
      scope: "project",
      project_id: projectId,
      name: "TDD Flow Plan",
      graph: {
        nodes: [
          { id: "plan", tool: "plan", label: "Resolve plan" },
          { id: "tdd", tool: "tdd", label: "Write failing expectation" },
          { id: "implement", tool: "implement", label: "Implement dashboard changes" },
          { id: "verify", tool: "verify", label: "Preview and validate" },
        ],
        edges: [
          { from: "plan", to: "tdd" },
          { from: "tdd", to: "implement" },
          { from: "implement", to: "verify" },
        ],
      },
      created_at: "2026-07-03T12:40:00.000Z",
      updated_at: "2026-07-03T15:02:00.000Z",
    },
  ] as OrchFlow[],
  messages: {
    [sessionId]: [
      {
        id: "msg_user_1",
        role: "user",
        content: "Build the executive home, wire the 4-column operational session UI, and keep deterministic execution only.",
        plan: clone(basePlan),
        results: null,
        created_at: "2026-07-03T12:46:00.000Z",
      },
      {
        id: "msg_assistant_1",
        role: "assistant",
        content: "Resolved plan: Home KPIs first, then session rail, then API wiring, then preview verification.",
        plan: clone(basePlan),
        results: [
          { step: basePlan.steps[0], result: { ok: true, state: "resolved" } },
          { step: basePlan.steps[1], result: { ok: true, tests: "drafted" } },
          { step: basePlan.steps[2], result: { ok: true, controls: "api-backed" } },
        ] as OrchStepResult[],
        created_at: "2026-07-03T12:49:00.000Z",
      },
    ],
  } as Record<string, OrchMessage[]>,
  reports: [
    {
      id: "report_preview_audit",
      type: "audit",
      summary: "Preview fallback is active because the backend is unavailable; UI remains interactive.",
      created: "2026-07-03T15:00:00.000Z",
      tags: ["preview", "dashboard", "fallback"],
    },
  ] as ReportSummary[],
  sessionState: {
    status: "active",
    locked: true,
    archived: false,
    optimization_mode: "vibeultrax",
    recommendation: "Run the structured TDD flow once the API is healthy, or continue in preview mode for layout verification.",
    lifecycle: {
      created_at: "2026-07-03T12:45:00.000Z",
      paused_at: null,
      resumed_at: "2026-07-03T13:10:00.000Z",
      archived_at: null,
      checked_out_at: "2026-07-03T15:06:00.000Z",
    },
    notes: [
      { text: "Column 4 is the authority rail for mode, plan, lock, and policy." },
      { text: "Sub-regimes such as speed, audit, forensic, and longrun are not top-level vibe modes." },
    ],
    tags: ["home", "session", "deterministic", "tdd", "web-search"],
    template: {
      id: "tdd-flow-plan",
      label: "TDD Flow Plan",
      body: "Plan -> TDD -> Implement -> Verify",
      signature: "preview-template",
      revision: 4,
      source: "preview",
    },
    blackbox: {
      enabled: true,
      sub_regime: "audit",
      resolution: "strict deterministic",
      momentum: 84,
      loop_count: 3,
    },
  },
}

function currentProject(): OrchProject {
  return preview.projects[0]
}

function currentSession(): OrchSession {
  return preview.sessions[0]
}

function buildSessionSummary() {
  const session = currentSession()
  const project = currentProject()
  return {
    title: session.title,
    session_id: session.id,
    status: preview.sessionState.status,
    locked: preview.sessionState.locked,
    archived: preview.sessionState.archived,
    project_name: project.name,
    project_fingerprint: project.fingerprint,
    started_at: preview.sessionState.lifecycle.created_at,
    cost_usd: 2.41,
    delegation_savings_usd: preview.savings.current_session.delegation_usd,
    cache_savings_usd: preview.savings.current_session.cache_usd,
    notes_count: preview.sessionState.notes.length,
    tags: clone(preview.sessionState.tags),
    template: clone(preview.sessionState.template),
    optimization_mode: preview.sessionState.optimization_mode,
    orchestration_plan: clone(basePlan),
    blackbox: clone(preview.sessionState.blackbox),
    recommendation: preview.sessionState.recommendation,
    notes: clone(preview.sessionState.notes),
    lifecycle: clone(preview.sessionState.lifecycle),
    orchestration: {
      effective_optimization_mode: preview.sessionState.optimization_mode,
      requested_optimization_mode: preview.sessionState.optimization_mode,
      effective_slot: preview.status.active_slot,
      deterministic_execution_policy: "strict-deterministic",
      resolved_plan_metadata: {
        source: "preview",
        strict: true,
        generated_at: nowIso(),
      },
      mode_capabilities: clone(preview.capabilities),
    },
  }
}

function buildHome(): DashboardHomePayload {
  const session = buildSessionSummary()
  const totalSavings = preview.savings.lifetime.delegation_usd + preview.savings.lifetime.cache_usd
  const currentSavings = session.delegation_savings_usd + session.cache_savings_usd
  return {
    home: {
      title: "Executive Operational Home",
      subtitle: "Main KPIs, current deterministic session, and next structured action.",
      recommendation: "Open the active session and continue the TDD Flow Plan from the deterministic rail.",
      cards: [
        { label: "Active project", value: session.project_name },
        { label: "Active session", value: session.title },
        { label: "Vibe mode", value: "VibeUltraX" },
        { label: "Slot", value: preview.status.active_slot },
        { label: "Model", value: preview.status.current_model },
        { label: "Lock state", value: preview.sessionState.locked ? "locked" : "mutable" },
        { label: "Backend", value: preview.status.backend_connected ? "live" : "preview fallback" },
        { label: "Session cost", value: fmtUsd(session.cost_usd) },
        { label: "Session savings", value: fmtUsd(currentSavings) },
        { label: "Pending TODOs", value: String(preview.status.todos?.pending || 0) },
      ],
    },
    savings: clone(preview.savings),
    todos: [
      { id: "todo_1", status: "pending", title: "Verify Home KPI density" },
      { id: "todo_2", status: "pending", title: "Validate 4-column desktop layout" },
      { id: "todo_3", status: "pending", title: "Confirm mode rail exposes all branded vibe modes" },
      { id: "todo_4", status: "pending", title: "Check blocked-state messaging for unsupported actions" },
    ],
    current_session: session,
    template_editor: {
      enabled: true,
      session_id: session.session_id,
      template: clone(preview.sessionState.template),
      templates: [clone(preview.sessionState.template)],
      can_edit: false,
      can_version: false,
      version: 4,
      history: [],
    },
    sessions: [
      {
        session_id: session.session_id,
        is_current: true,
        started_at: session.started_at,
        cost_usd: session.cost_usd,
        delegation_savings_usd: session.delegation_savings_usd,
        cache_savings_usd: session.cache_savings_usd,
        status: session.status,
        locked: session.locked,
        archived: session.archived,
        tags: clone(session.tags),
        notes_count: session.notes_count,
        template_label: session.template.label || session.template.id,
        template_signature: session.template.signature || null,
        recommendation: session.recommendation,
      },
    ],
    templates: [clone(preview.sessionState.template)],
    session_actions: ["start", "pause", "resume", "lock", "unlock", "archive", "undo"],
    totals: {
      total_sessions: preview.sessions.length,
      total_savings_usd: totalSavings,
      current_session_savings_usd: currentSavings,
      pending_todos: 4,
    },
    status: clone(preview.status),
    blackbox: {
      sub_regime: preview.sessionState.blackbox.sub_regime,
      resolution: preview.sessionState.blackbox.resolution,
    },
    backend_connected: preview.status.backend_connected,
    backend_status: preview.status.backend_connected ? "online" : "preview fallback",
    backend_health_url: preview.status.backend_health_url,
    backend_version: preview.status.backend_version,
  }
}

export function previewEnabled(): boolean {
  if (typeof window === "undefined") return false
  const forced = String(window.localStorage?.getItem("vibeos.dashboard.preview") || "").toLowerCase()
  if (forced === "1" || forced === "true" || forced === "on") return true
  const host = window.location.hostname
  return host === "127.0.0.1" || host === "localhost"
}

export function getPreviewStatus(): StatusPayload {
  return clone(preview.status)
}

export function getPreviewSavings(): SavingsPayload {
  return clone(preview.savings)
}

export function getPreviewCapabilities(): CapabilitiesPayload {
  return clone(preview.capabilities)
}

export function getPreviewProjects(): OrchProject[] {
  return clone(preview.projects)
}

export function getPreviewSessions(projectId?: string): OrchSession[] {
  const sessions = projectId ? preview.sessions.filter((session) => session.project_id === projectId) : preview.sessions
  return clone(sessions)
}

export function getPreviewFlows(projectId?: string): OrchFlow[] {
  const flows = projectId ? preview.flows.filter((flow) => flow.project_id === projectId || flow.scope === "global") : preview.flows
  return clone(flows)
}

export function getPreviewMessages(sessionIdArg: string): OrchMessage[] {
  return clone(preview.messages[sessionIdArg] || [])
}

export function getPreviewReports(): ReportSummary[] {
  return clone(preview.reports)
}

export function getPreviewDashboardHome(): DashboardHomePayload {
  return buildHome()
}

export function getPreviewSessionDetail(id: string): SessionDetailPayload {
  if (id !== sessionId) return { session: buildSessionSummary(), metrics: {}, orchestration: null }
  return {
    session: buildSessionSummary(),
    metrics: {
      session_savings_usd: preview.savings.current_session.delegation_usd + preview.savings.current_session.cache_usd,
      session_cost_usd: 2.41,
      strict_policy: "strict-deterministic",
      effective_slot: preview.status.active_slot,
      requested_optimization_mode: preview.sessionState.optimization_mode,
      effective_optimization_mode: preview.sessionState.optimization_mode,
    },
    orchestration: clone(buildSessionSummary().orchestration),
  }
}

export function simulatePreviewTrinity(action: string, slot?: string): { ok: boolean; result?: unknown; error?: string } {
  if (action === "mode" && slot) {
    preview.status.optimization_mode = slot
    preview.sessionState.optimization_mode = slot
    preview.status.recommended_next_action = `Mode switched to ${slot}. Continue with the structured TDD flow.`
    return { ok: true, result: { optimization_mode: slot } }
  }
  if (action === "set" && slot) {
    preview.status.active_slot = slot
    preview.status.current_quality_tier = slot
    preview.status.model_locked = true
    preview.status.locked_slot = slot
    return { ok: true, result: { active_slot: slot } }
  }
  return { ok: true, result: { action, slot } }
}

export function simulatePreviewSessionUpdate(id: string, patch: Partial<Pick<OrchSession, "title" | "flow_id">>): OrchSession {
  const session = preview.sessions.find((entry) => entry.id === id) || preview.sessions[0]
  if (typeof patch.title === "string") session.title = patch.title
  if ("flow_id" in patch) session.flow_id = patch.flow_id ?? null
  session.updated_at = nowIso()
  return clone(session)
}

export function simulatePreviewSessionAction(id: string, action: string): SessionDetailPayload {
  if (id !== sessionId) return getPreviewSessionDetail(sessionId)
  if (action === "lock") {
    preview.sessionState.locked = true
    preview.status.model_locked = true
  } else if (action === "unlock") {
    preview.sessionState.locked = false
    preview.status.model_locked = false
  } else if (action === "pause") {
    preview.sessionState.status = "paused"
    preview.sessionState.lifecycle.paused_at = nowIso()
  } else if (action === "resume" || action === "start") {
    preview.sessionState.status = "active"
    preview.sessionState.lifecycle.resumed_at = nowIso()
  } else if (action === "archive") {
    preview.sessionState.archived = true
    preview.sessionState.status = "archived"
    preview.sessionState.lifecycle.archived_at = nowIso()
  } else if (action === "undo") {
    preview.sessionState.archived = false
    preview.sessionState.status = "active"
    preview.sessionState.lifecycle.archived_at = null
  }
  preview.sessionState.recommendation = `Last structured action: ${action}. Preview state updated locally.`
  return getPreviewSessionDetail(sessionId)
}

export function simulatePreviewWebSearch(query: string): WebSearchPayload {
  const normalized = query.trim() || "dashboard deterministic session"
  return {
    ok: true,
    query: normalized,
    provider: "preview-fixture",
    results: [
      {
        id: "1",
        title: "Structured execution patterns for operational dashboards",
        url: "https://example.com/structured-execution",
        domain: "example.com",
        snippet: "Operational dashboards keep the execution plan, hard state, and KPI signals visible in the same workspace.",
        source: "preview",
        rank: 1,
      },
      {
        id: "2",
        title: "TDD planning in live orchestration UIs",
        url: "https://example.com/tdd-orchestration",
        domain: "example.com",
        snippet: "A deterministic control rail should expose the active plan before execution starts.",
        source: "preview",
        rank: 2,
      },
      {
        id: "3",
        title: "Session command centers with strict blocked-state messaging",
        url: "https://example.com/blocked-state",
        domain: "example.com",
        snippet: "Unsupported actions should fail explicitly when strict mode is active.",
        source: "preview",
        rank: 3,
      },
    ],
    citations: [
      { id: 1, title: "Structured execution patterns for operational dashboards", url: "https://example.com/structured-execution", domain: "example.com" },
      { id: 2, title: "TDD planning in live orchestration UIs", url: "https://example.com/tdd-orchestration", domain: "example.com" },
      { id: 3, title: "Session command centers with strict blocked-state messaging", url: "https://example.com/blocked-state", domain: "example.com" },
    ],
    answer: `Preview search answer for "${normalized}": keep the Home screen KPI-dense, expose all branded vibe modes in column 4, render the resolved TDD flow plan before execution, and block unsupported actions under strict deterministic policy.`,
    meta: { resultCount: 3, uniqueDomains: 1 },
  }
}
