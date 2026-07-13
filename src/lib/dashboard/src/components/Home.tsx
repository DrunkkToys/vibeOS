import { For, Show } from "solid-js"
import type { DashboardHomePayload, OrchFlow, OrchProject, OrchSession, StatusPayload } from "../api"
import { postTrinity } from "../api"
import { resolveFlowSummary } from "../home-model"
import { getBrandedModes, getMode, normalizeLegacyMode } from "../../../mode-table"

function fmtUsd(value: number | null | undefined): string {
  return `$${Number(value || 0).toFixed(2)}`
}

function formatModeLabel(mode: string | null | undefined): string {
  const normalized = String(mode || "").trim().toLowerCase()
  if (!normalized) return "auto"
  if (normalized === "auto") return "auto"
  try {
    return getMode(normalized).name || getMode(normalizeLegacyMode(normalized)).name || normalized
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
  const flowSummary = () => resolveFlowSummary({ session: props.session, project: props.project, flows: props.flows })
  const homeStatus = () => props.data?.status || props.status
  const currentModeId = () => String(props.data?.current_session?.optimization_mode || homeStatus()?.optimization_mode || props.data?.home.cards.find((card) => card.label.toLowerCase() === "mode")?.value || "auto").trim().toLowerCase()
  const currentMode = () => formatModeLabel(currentModeId())
  const modeCards = () => getBrandedModes().map((mode) => ({
    ...mode,
    active: currentModeId() === mode.id,
  }))

  const kpis = () => [
    { label: "total saved", value: fmtUsd(props.data?.totals.total_savings_usd) },
    { label: "session saved", value: fmtUsd(props.data?.totals.current_session_savings_usd) },
    { label: "pending todos", value: String(props.data?.totals.pending_todos || 0) },
    { label: "sessions", value: String(props.data?.totals.total_sessions || 0) },
    { label: "backend", value: homeStatus()?.backend_connected ? "online" : "degraded" },
    { label: "model", value: homeStatus()?.current_model?.split("/").pop() || "unknown" },
  ]

  const runningSessions = () => props.data?.sessions || []

  return (
    <Show when={props.data} fallback={<div class="home-view"><div class="card"><h3>Home</h3><p class="muted">loading executive summary...</p></div></div>}>
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

      <section class="card panel home-section">
        <div class="panel-head">
          <h3>KPIs</h3>
        </div>
        <div class="home-ops-strip">
          <For each={kpis()}>{(kpi) => (
            <div class="home-op-tile">
              <span class="field-label">{kpi.label}</span>
              <span class="home-op-value">{kpi.value}</span>
            </div>
          )}</For>
        </div>
      </section>

      <section class="card panel home-section">
        <div class="panel-head">
          <h3>Orchestrator</h3>
          <span class={`badge ${homeStatus()?.backend_connected ? "on" : "off"}`}>{homeStatus()?.backend_connected ? "LIVE" : "DEGRADED"}</span>
        </div>
        <Show when={homeStatus()}>
          <div class="home-controls-strip">
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
            <div class="qc-group">
              <span class="field-label">flow</span>
              <div class="home-inline-value">{flowSummary()}</div>
            </div>
          </div>
        </Show>
        <div class="home-mode-grid">
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
        </div>
      </section>

      <section class="card panel home-section">
        <div class="panel-head">
          <h3>Running Sessions</h3>
          <span class="muted">{runningSessions().length} of last 10 · {props.data.totals.total_sessions} total in this project</span>
        </div>
        <Show when={runningSessions().length} fallback={<p class="muted">No sessions tracked for this project yet.</p>}>
          <div class="home-session-list">
            <For each={runningSessions()}>{(entry) => (
              <div class={`home-session-item ${entry.is_current ? "current" : ""}`}>
                <div>
                  <div class="home-session-item-title">
                    {entry.template_label || entry.session_id.slice(0, 14)}
                    <Show when={entry.is_current}><span class="qc-pill on">current</span></Show>
                  </div>
                  <div class="muted">{entry.recommendation}</div>
                </div>
                <div class="home-session-item-meta">
                  <span>{entry.status}</span>
                  <span>{entry.started_at ? new Date(entry.started_at).toLocaleString() : "unknown start"}</span>
                  <span>{fmtUsd(entry.delegation_savings_usd + entry.cache_savings_usd)}</span>
                </div>
              </div>
            )}</For>
          </div>
        </Show>
      </section>
    </div>
    </Show>
  )
}
