import { For, Show } from "solid-js"
import type { DashboardHomePayload, OrchFlow, OrchProject, OrchSession, StatusPayload } from "../api"
import { postTrinity } from "../api"
import { resolveFlowSummary } from "../home-model"
import { getBrandedModes, getRuntimeModes, normalizeLegacyMode } from "../../../mode-router"

function fmtUsd(value: number | null | undefined): string {
  return `$${Number(value || 0).toFixed(2)}`
}

function sessionLabel(session: OrchSession | null | undefined): string {
  if (!session?.id) return "No active session"
  return `${session.title} · ${session.id.slice(0, 8)}`
}

function formatModeLabel(mode: string | null | undefined): string {
  const normalized = String(mode || "").trim().toLowerCase()
  if (!normalized) return "auto"
  try {
    return [...getBrandedModes(), ...getRuntimeModes()].find((entry) => entry.id === normalized)?.name
      || [...getBrandedModes(), ...getRuntimeModes()].find((entry) => entry.id === normalizeLegacyMode(normalized))?.name
      || normalized
  } catch {
    return normalized
  }
}

export default function Home(props: {
  data: DashboardHomePayload | null
  status: StatusPayload | null
  project: OrchProject | null
  session: OrchSession | null
  flows: OrchFlow[]
  onOpenStatus: () => void
  onOpenProject: () => void
  onOpenSession: () => void
  onTrinityAction: () => void
}) {
  if (!props.data) return <div class="home-view"><div class="card"><h3>Home</h3><p class="muted">loading executive summary...</p></div></div>

  const flowSummary = () => resolveFlowSummary({ session: props.session, project: props.project, flows: props.flows })
  const todoPreview = () => (props.data?.todos || []).filter((todo) => todo?.status !== "done").slice(0, 4)
  const homeStatus = () => props.data?.status || props.status
  const currentMode = () => formatModeLabel(homeStatus()?.optimization_mode || props.data?.home.cards.find((card) => card.label.toLowerCase() === "mode")?.value || "auto")
  const modeCards = () => getBrandedModes().map((mode) => ({
    ...mode,
    active: String(homeStatus()?.optimization_mode || "").toLowerCase() === mode.id,
  }))
  const operations = () => [
    { label: "mode", value: currentMode() },
    { label: "slot", value: homeStatus()?.active_slot || "brain" },
    { label: "model", value: homeStatus()?.current_model?.split("/").pop() || "unknown" },
    { label: "lock", value: homeStatus()?.model_locked ? "locked" : "live" },
    { label: "backend", value: homeStatus()?.backend_connected ? "online" : "degraded" },
    { label: "todos", value: String(props.data?.totals.pending_todos || 0) },
  ]

  return (
    <div class="home-view">
      <section class="home-hero">
        <div class="home-hero-copy">
          <div class="home-kicker">opencode mirror</div>
          <h2>{props.data.home.title}</h2>
          <p>{props.data.home.recommendation || props.data.home.subtitle}</p>
        </div>
        <div class="home-hero-actions">
          <button class="flow-save" onClick={props.onOpenSession}>Open session</button>
          <button class="shell-link" onClick={props.onOpenProject}>Project</button>
          <button class="shell-link" onClick={props.onOpenStatus}>Status</button>
        </div>
      </section>

      <section class="home-ops-strip">
        <For each={operations()}>{(op) => (
          <div class="home-op-tile">
            <span class="field-label">{op.label}</span>
            <span class="home-op-value">{op.value}</span>
          </div>
        )}</For>
      </section>

      <Show when={homeStatus()}>
        <section class="home-controls-strip">
          <div class="qc-group">
            <span class="field-label">slot</span>
            <For each={["brain", "medium", "cheap"]}>{(slot) => (
              <button
                class={`qc-slot ${homeStatus()?.active_slot === slot ? "active" : ""}`}
                onClick={() => postTrinity("set", slot).then(props.onTrinityAction).catch(() => {})}
              >{slot}</button>
            )}</For>
          </div>
          <div class="qc-group">
            <span class="field-label">vibe mode</span>
            <span class="qc-model">{currentMode()}</span>
          </div>
          <div class="qc-group">
            <span class="field-label">thinking</span>
            <span class="qc-model">{homeStatus()?.thinking ?? "brief"}</span>
          </div>
          <div class="qc-group">
            <span class="field-label">enforce</span>
            <span class={`qc-pill ${homeStatus()?.enforce ? "on" : "off"}`}>{homeStatus()?.enforce ? "on" : "off"}</span>
          </div>
        </section>
      </Show>

      <section class="home-mode-grid">
        <For each={modeCards()}>{(mode) => (
          <div class={`card home-mode-card ${mode.active ? "active" : ""}`}>
            <div class="home-mode-head">
              <span class="home-mode-name">{mode.name}</span>
              <span class="home-mode-pipeline">{mode.pipeline.join(" → ")}</span>
            </div>
            <p class="home-mode-copy">{mode.desc}</p>
            <div class="home-mode-meta">
              <span>thinking {mode.thinking}</span>
              <span>flow {mode.flow}</span>
              <span>tdd {mode.tdd}</span>
            </div>
          </div>
        )}</For>
      </section>

      <section class="home-overview-grid">
        <div class="card home-summary-card">
          <h3>Main KPIs</h3>
          <div class="home-summary-table">
            <For each={props.data.home.cards}>{(card) => (
              <div class="home-summary-row">
                <span class="home-summary-label">{card.label}</span>
                <span class="home-summary-value">{card.value}</span>
              </div>
            )}</For>
          </div>
        </div>

        <div class="card home-recommendation-card">
          <h3>Command Center</h3>
          <p class="home-recommendation">{props.data.home.recommendation || "Continue with the active session."}</p>
          <div class="home-inline-grid">
            <div>
              <span class="field-label">active session</span>
              <div class="home-inline-value">{sessionLabel(props.session)}</div>
            </div>
            <div>
              <span class="field-label">flow</span>
              <div class="home-inline-value">{flowSummary()}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="home-detail-grid">
        <div class="card home-current-session">
          <h3>Current Session</h3>
          <div class="home-session-head">
            <div class="home-session-title">{props.data.current_session.project_name}</div>
            <span class={`badge ${props.data.current_session.locked ? "off" : "on"}`}>{props.data.current_session.status}</span>
          </div>
          <div class="home-metric-strip">
            <span>session {props.data.current_session.session_id || "none"}</span>
            <span>mode {currentMode()}</span>
            <span>cost {fmtUsd(props.data.current_session.cost_usd)}</span>
            <span>saved {fmtUsd((props.data.current_session.delegation_savings_usd || 0) + (props.data.current_session.cache_savings_usd || 0))}</span>
          </div>
          <p class="muted">{props.data.current_session.recommendation}</p>
          <Show when={props.data.current_session.tags?.length}>
            <div class="home-tag-row">
              <For each={props.data.current_session.tags}>{(tag) => <span class="home-tag">{tag}</span>}</For>
            </div>
          </Show>
        </div>

        <div class="card home-todos-card">
          <h3>Open TODOs</h3>
          <Show when={todoPreview().length} fallback={<p class="muted">No pending TODOs.</p>}>
            <div class="home-todo-list">
              <For each={todoPreview()}>{(todo) => (
                <div class="home-todo-item">
                  <span class="home-todo-status">{String(todo.status || "pending").toUpperCase()}</span>
                  <span>{todo.title || todo.text || todo.content || "Untitled task"}</span>
                </div>
              )}</For>
            </div>
          </Show>
          <div class="home-totals">
            <span>{props.data.totals.pending_todos} pending</span>
            <span>{props.data.totals.total_sessions} sessions</span>
          </div>
        </div>

        <div class="card home-savings-card">
          <h3>Savings</h3>
          <div class="home-money">{fmtUsd(props.data.totals.total_savings_usd)}</div>
          <div class="home-money-sub">current session {fmtUsd(props.data.totals.current_session_savings_usd)}</div>
          <div class="home-metric-strip">
            <span>delegation {fmtUsd(props.data.savings?.lifetime?.delegation_usd)}</span>
            <span>cache {fmtUsd(props.data.savings?.lifetime?.cache_usd)}</span>
          </div>
        </div>

        <div class="card home-sessions-card">
          <h3>Recent Sessions</h3>
          <div class="home-session-list">
            <For each={props.data.sessions.slice(0, 5)}>{(entry) => (
              <div class={`home-session-item ${entry.is_current ? "current" : ""}`}>
                <div>
                  <div class="home-session-item-title">{entry.template_label || entry.session_id.slice(0, 14)}</div>
                  <div class="muted">{entry.recommendation}</div>
                </div>
                <div class="home-session-item-meta">
                  <span>{entry.template_label}</span>
                  <span>{fmtUsd(entry.delegation_savings_usd + entry.cache_savings_usd)}</span>
                </div>
              </div>
            )}</For>
          </div>
        </div>
      </section>
    </div>
  )
}
