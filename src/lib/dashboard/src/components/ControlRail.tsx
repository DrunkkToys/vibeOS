// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>

import { For, Show, createMemo, createSignal } from "solid-js"
import { postTrinity, type CapabilitiesPayload, type DashboardHomePayload, type OrchSession, type SavingsPayload, type StatusPayload } from "../api"
import { getBrandedModes, getMode, normalizeLegacyMode } from "../../../mode-router"

const modeCards = getBrandedModes()

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

export default function ControlRail(props: {
  status: StatusPayload | null
  capabilities: CapabilitiesPayload | null
  home: DashboardHomePayload | null
  savings: SavingsPayload | null
  session: OrchSession | null
  currentProject: { id: string; name: string } | null
  onRefresh: () => void
  onCreatePlan: () => void
  onStartTdd: () => void
}) {
  const [busy, setBusy] = createSignal<string | null>(null)
  const [msg, setMsg] = createSignal<string | null>(null)
  const [apiToken, setApiToken] = createSignal("")

  const effectiveMode = createMemo(() => String(props.status?.optimization_mode || props.status?.native_agent_mode || "auto").toLowerCase())
  const effectiveModeLabel = createMemo(() => formatModeLabel(effectiveMode()))
  const planSteps = createMemo(() => props.status?.orchestration_plan?.steps || [])
  const backendOnline = createMemo(() => props.status?.backend_connected ?? props.status?.backendConnected ?? false)
  const apiTokenState = createMemo(() => {
    if (props.status?.api_fallback === true) return "fallback"
    if (backendOnline()) return "live"
    return "unknown"
  })

  const runMode = async (modeId: string) => {
    if (busy()) return
    setBusy(`mode:${modeId}`)
    setMsg(null)
    try {
      const res = await postTrinity("mode", modeId)
      setMsg(res.ok ? String(res.result || `mode:${modeId}`) : String(res.error || "failed"))
      props.onRefresh()
    } catch (error) {
      setMsg((error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const applyToken = async () => {
    const token = apiToken().trim()
    if (!token || busy()) return
    setBusy("token")
    setMsg(null)
    try {
      const res = await postTrinity("api-token", "", undefined, token)
      setMsg(res.ok ? "API token updated" : String(res.error || "failed"))
      setApiToken("")
      props.onRefresh()
    } catch (error) {
      setMsg((error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const invalidateToken = async () => {
    if (busy()) return
    setBusy("token")
    setMsg(null)
    try {
      const res = await postTrinity("api-token", "", undefined, "invalidate")
      setMsg(res.ok ? "API token invalidated" : String(res.error || "failed"))
      setApiToken("")
      props.onRefresh()
    } catch (error) {
      setMsg((error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div class="card panel control-rail">
      <div class="panel-head">
        <div>
          <div class="column-badge-row">
            <span class="column-badge">4</span>
            <h3>Control Rail</h3>
          </div>
          <div class="panel-head-copy">mode first, then token, flow, plan, TDD</div>
        </div>
        <span class={`badge ${backendOnline() ? "on" : "off"}`}>{backendOnline() ? "LIVE" : "DEGRADED"}</span>
      </div>

      <div class="control-group">
        <h4>Vibe Mode</h4>
        <div class="control-mode-summary">
          <div class="control-status">
            <span class="field-label">active mode</span>
            <strong>{effectiveModeLabel()}</strong>
          </div>
          <div class="control-status">
            <span class="field-label">thinking</span>
            <strong>{props.status?.thinking || "brief"}</strong>
          </div>
        </div>
        <div class="mode-control-grid">
          <For each={modeCards}>{(mode) => (
            <button
              class={`mode-card-btn ${props.status?.optimization_mode === mode.id ? "active" : ""}`}
              disabled={busy() === `mode:${mode.id}` || mode.id === "raw"}
              title={mode.desc}
              onClick={() => void runMode(mode.id)}
            >
              <strong>{mode.name}</strong>
              <span>{mode.pipeline.join(" → ")}</span>
            </button>
          )}</For>
        </div>
      </div>

      <div class="control-status-grid">
        <div class="control-status">
          <span class="field-label">api token</span>
          <strong>{apiTokenState()}</strong>
        </div>
        <div class="control-status">
          <span class="field-label">connect</span>
          <strong>{backendOnline() ? "live" : "degraded"}</strong>
        </div>
        <div class="control-status">
          <span class="field-label">slot</span>
          <strong>{props.status?.active_slot || "brain"}</strong>
        </div>
        <div class="control-status">
          <span class="field-label">model</span>
          <strong>{(props.status?.current_model || "unknown").split("/").pop()}</strong>
        </div>
      </div>

      <div class="control-group">
        <h4>API Token</h4>
        <input
          class="text-input"
          placeholder="paste api token"
          value={apiToken()}
          onInput={(e) => setApiToken(e.currentTarget.value)}
        />
        <div class="session-action-grid">
          <button class="shell-link" disabled={!apiToken().trim() || busy() === "token"} onClick={() => void applyToken()}>
            apply token
          </button>
          <button class="shell-link" disabled={busy() === "token"} onClick={() => void invalidateToken()}>
            invalidate
          </button>
        </div>
        <p class="muted">Set or clear the runtime token. Connection state below reflects the live backend, not decoration.</p>
      </div>

      <div class="control-group">
        <h4>Flow</h4>
        <div class="control-flow-header">
          <span class="muted">{props.currentProject?.name || "No project selected"}</span>
          <span class={`badge ${props.status?.flow_enforcer ? "on" : "off"}`}>{props.status?.flow_enforcer ? "ON" : "OFF"}</span>
        </div>
        <div class="control-flow-list">
          <For each={planSteps()} fallback={<p class="muted">No resolved plan yet. Use the chat or create a plan from here.</p>}>
            {(step, index) => (
              <div class="control-flow-step">
                <span>{index() + 1}</span>
                <div>
                  <strong>{step.label}</strong>
                  <div class="muted">{step.tool} · {step.reason}</div>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>

      <div class="control-group">
        <h4>Create Plan / TDD</h4>
        <div class="session-action-grid">
          <button class="shell-link" disabled={!props.session || busy() === "plan"} onClick={() => { setBusy("plan"); props.onCreatePlan(); props.onRefresh(); setBusy(null) }}>
            create plan
          </button>
          <button class="shell-link" disabled={!props.session || busy() === "tdd"} onClick={() => { setBusy("tdd"); props.onStartTdd(); props.onRefresh(); setBusy(null) }}>
            tdd
          </button>
        </div>
        <p class="muted">Runs the active session with a structured prompt. No loose command launching.</p>
        <p class="muted">web search {props.capabilities?.web_search?.enabled ? "on" : "off"} · tdd {props.capabilities?.tdd?.enabled ? "on" : "off"}</p>
      </div>

      <div class="control-group">
        <h4>KPI</h4>
        <div class="control-kpi-strip">
          <div><span class="field-label">slot</span><strong>{props.status?.active_slot || "brain"}</strong></div>
          <div><span class="field-label">model</span><strong>{(props.status?.current_model || "unknown").split("/").pop()}</strong></div>
          <div><span class="field-label">savings/hr</span><strong>{fmtUsd(props.savings?.savings_rate_per_hour)}</strong></div>
          <div><span class="field-label">todos</span><strong>{props.status?.todos?.pending ?? props.home?.totals.pending_todos ?? 0}</strong></div>
        </div>
        <div class="control-kpi-strip">
          <div><span class="field-label">session</span><strong>{props.session?.title || "none"}</strong></div>
          <div><span class="field-label">backend</span><strong>{props.status?.backend_connected ? "online" : "degraded"}</strong></div>
          <div><span class="field-label">lock</span><strong>{props.status?.model_locked ? "locked" : "open"}</strong></div>
          <div><span class="field-label">flow</span><strong>{props.status?.flow_enforcer ? "on" : "off"}</strong></div>
        </div>
      </div>

      <Show when={msg()}>
        <div class="result-box">
          <code>{msg()!}</code>
          <button class="dismiss-btn" onClick={() => setMsg(null)}>x</button>
        </div>
      </Show>
    </div>
  )
}
