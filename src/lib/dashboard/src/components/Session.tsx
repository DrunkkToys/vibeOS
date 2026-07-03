import { createMemo, createResource, createSignal, For, Show, onCleanup } from "solid-js"
import {
  fetchSessionDetail,
  listMessages,
  postSessionAction,
  postTrinity,
  runSession,
  updateSession,
  type CapabilitiesPayload,
  type DashboardHomePayload,
  type OrchFlow,
  type OrchMessage,
  type OrchPlan,
  type OrchSession,
  type OrchStepResult,
  type SavingsPayload,
  type SessionDetailPayload,
  type StatusPayload,
} from "../api"
import { getBrandedModes, getRuntimeModes } from "../../../mode-router"

const dashboardModes = [...getBrandedModes(), ...getRuntimeModes().filter((mode) => mode.id !== "balanced")]

function StepRow(props: { r: OrchStepResult }) {
  const r = props.r
  return (
    <div class={`run-step ${r.skipped ? "skipped" : "done"}`}>
      <span class="run-step-tool">{r.step?.tool}</span>
      <span class="run-step-label">{r.step?.label}</span>
      <Show when={r.skipped}><span class="run-step-skip">blocked — {r.reason}</span></Show>
      <Show when={!r.skipped && r.result}>
        <code class="run-step-result">{JSON.stringify(r.result).slice(0, 160)}</code>
      </Show>
    </div>
  )
}

function fmtUsd(value: number | null | undefined): string {
  return `$${Number(value || 0).toFixed(2)}`
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—"
  try { return new Date(value).toLocaleString() } catch { return value }
}

function deriveSessionActions(detail: SessionDetailPayload | undefined): string[] {
  const current = detail?.session
  const actions = ["start", "pause", "resume", current?.locked ? "unlock" : "lock", "archive", "undo"]
  return [...new Set(actions)]
}

export default function Session(props: {
  session: OrchSession
  flows: OrchFlow[]
  status: StatusPayload | null
  capabilities: CapabilitiesPayload | null
  home: DashboardHomePayload | null
  savings: SavingsPayload | null
  onSessionChange: (s: OrchSession) => void
  onRefresh: () => void
}) {
  const [detail, { mutate: mutateDetail, refetch: refetchDetail }] = createResource(() => props.session.id, fetchSessionDetail)
  const [messages, { refetch: refetchMessages }] = createResource(() => props.session.id, listMessages)
  const [prompt, setPrompt] = createSignal("")
  const [sourceContent, setSourceContent] = createSignal("")
  const [running, setRunning] = createSignal(false)
  const [busyAction, setBusyAction] = createSignal<string | null>(null)
  const [liveFlow, setLiveFlow] = createSignal<{ flow_name: string | null } | null>(null)
  const [livePlan, setLivePlan] = createSignal<OrchPlan | null>(null)
  const [liveSteps, setLiveSteps] = createSignal<OrchStepResult[]>([])
  const [err, setErr] = createSignal<string | null>(null)
  let abort: (() => void) | null = null
  onCleanup(() => abort?.())

  const sessionDetail = createMemo(() => detail()?.session)
  const effectivePlan = createMemo(() => livePlan() || sessionDetail()?.orchestration_plan || props.status?.orchestration_plan || null)
  const effectiveMode = createMemo(() => String(props.status?.optimization_mode || "auto").toLowerCase())
  const modeCards = createMemo(() => dashboardModes.map((mode) => ({
    ...mode,
    active: effectiveMode() === mode.id,
    available: mode.id === "vibeultrax"
      ? props.capabilities?.vibeultrax?.enabled !== false
      : mode.id === "vibeqmax"
        ? props.capabilities?.vibeqmax?.enabled !== false
        : mode.id === "vibemax"
          ? props.capabilities?.vibemax?.enabled !== false
          : true,
  })))
  const effectiveModeLabel = createMemo(() => modeCards().find((mode) => mode.active)?.name || effectiveMode())

  const flowLabel = () => {
    const fid = props.session.flow_id
    if (!fid) return "inherit (project / global default)"
    return props.flows.find((f) => f.id === fid)?.name || "custom"
  }

  const run = () => {
    const p = prompt().trim()
    if (!p || running()) return
    if (sessionDetail()?.locked) {
      setErr("Session is locked. Unlock it before running a deterministic flow.")
      return
    }
    setRunning(true)
    setErr(null)
    setLivePlan(null)
    setLiveSteps([])
    setLiveFlow(null)
    abort = runSession(props.session.id, {
      prompt: p,
      sourceContent: sourceContent() || undefined,
      query: p,
      execution_policy: "strict-deterministic",
    }, {
      onEvent: (event, data) => {
        if (event === "flow") setLiveFlow(data)
        else if (event === "plan") setLivePlan(data.plan)
        else if (event === "step") setLiveSteps((s) => [...s, data])
        else if (event === "done") {
          setRunning(false)
          setPrompt("")
          setSourceContent("")
          setLivePlan(null)
          setLiveSteps([])
          setLiveFlow(null)
          void refetchMessages()
          void refetchDetail()
          props.onRefresh()
        } else if (event === "error") {
          setErr(data.message || "run failed")
          setRunning(false)
        }
      },
      onError: (e) => { setErr(e.message); setRunning(false) },
      onDone: () => setRunning(false),
    })
  }

  const changeFlow = async (flowId: string) => {
    const res = await updateSession(props.session.id, { flow_id: flowId || null })
    props.onSessionChange(res.session)
    void refetchDetail()
  }

  const setMode = async (modeId: string) => {
    setBusyAction(`mode:${modeId}`)
    setErr(null)
    try {
      await postTrinity("mode", modeId)
      props.onRefresh()
    } catch (e: unknown) {
      setErr((e as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  const mutateSessionAction = async (action: string) => {
    setBusyAction(action)
    setErr(null)
    try {
      const res = await postSessionAction(props.session.id, { action })
      mutateDetail((current) => current ? { ...current, session: res.session } : current)
      void refetchDetail()
      props.onRefresh()
    } catch (e: unknown) {
      setErr((e as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div class="session-workspace">
      <section class="session-hero">
        <div>
          <div class="home-kicker">session workspace</div>
          <h2 class="session-title">{props.session.title}</h2>
          <div class="session-hero-meta">
            <span>{props.session.id.slice(0, 18)}…</span>
            <span>mode {effectiveModeLabel() || "auto"}</span>
            <span>slot {props.status?.active_slot || "brain"}</span>
            <span>model {(props.status?.current_model || "unknown").split("/").pop()}</span>
            <span>{props.status?.backend_connected ? "backend online" : "backend degraded"}</span>
          </div>
        </div>
        <div class="session-hero-kpis">
          <div class="session-kpi">
            <span class="field-label">session savings</span>
            <strong>{fmtUsd((sessionDetail()?.delegation_savings_usd || 0) + (sessionDetail()?.cache_savings_usd || 0))}</strong>
          </div>
          <div class="session-kpi">
            <span class="field-label">session cost</span>
            <strong>{fmtUsd(sessionDetail()?.cost_usd)}</strong>
          </div>
          <div class="session-kpi">
            <span class="field-label">state</span>
            <strong>{sessionDetail()?.locked ? "locked" : sessionDetail()?.status || "active"}</strong>
          </div>
        </div>
      </section>

      <section class="session-grid-4">
        <div class="card session-column">
          <h3>Session State</h3>
          <div class="session-state-stack">
            <div class="session-state-row"><span>project</span><strong>{sessionDetail()?.project_name || "Current project"}</strong></div>
            <div class="session-state-row"><span>status</span><strong>{sessionDetail()?.status || "active"}</strong></div>
            <div class="session-state-row"><span>mode</span><strong>{effectiveModeLabel() || "auto"}</strong></div>
            <div class="session-state-row"><span>started</span><strong>{fmtDate(sessionDetail()?.started_at)}</strong></div>
            <div class="session-state-row"><span>lock</span><strong>{sessionDetail()?.locked ? "locked" : "mutable"}</strong></div>
            <div class="session-state-row"><span>flow</span><strong>{flowLabel()}</strong></div>
          </div>
          <Show when={sessionDetail()?.tags?.length}>
            <div class="session-chip-row">
              <For each={sessionDetail()?.tags || []}>{(tag) => <span class="session-chip">{tag}</span>}</For>
            </div>
          </Show>
          <div class="session-state-block">
            <span class="field-label">recommendation</span>
            <p class="session-copy">{sessionDetail()?.recommendation || props.status?.recommended_next_action || "Continue with the next structured step."}</p>
          </div>
          <div class="session-state-block">
            <span class="field-label">lifecycle</span>
            <div class="session-timeline">
              <span>created {fmtDate(sessionDetail()?.lifecycle?.created_at)}</span>
              <span>paused {fmtDate(sessionDetail()?.lifecycle?.paused_at)}</span>
              <span>resumed {fmtDate(sessionDetail()?.lifecycle?.resumed_at)}</span>
              <span>archived {fmtDate(sessionDetail()?.lifecycle?.archived_at)}</span>
            </div>
          </div>
          <div class="session-state-block">
            <span class="field-label">notes</span>
            <Show when={sessionDetail()?.notes?.length} fallback={<p class="muted">No session notes yet.</p>}>
              <div class="session-notes-list">
                <For each={sessionDetail()?.notes || []}>{(note) => (
                  <div class="session-note-item">{note.text || "Untitled note"}</div>
                )}</For>
              </div>
            </Show>
          </div>
        </div>

        <div class="card session-column session-thread-column">
          <h3>Thread</h3>
          <div class="thread session-thread">
            <For each={messages()?.messages || []} fallback={<p class="muted">No messages yet. Run a deterministic prompt below.</p>}>
              {(m: OrchMessage) => (
                <div class={`msg ${m.role}`}>
                  <div class="msg-role">{m.role}</div>
                  <div class="msg-content">{m.content || "(no summary)"}</div>
                  <Show when={m.role === "assistant" && m.results && m.results.length}>
                    <details class="run-trace-details">
                      <summary>structured steps ({m.results!.length})</summary>
                      <div class="run-trace">
                        <For each={m.results!}>{(r) => <StepRow r={r} />}</For>
                      </div>
                    </details>
                  </Show>
                </div>
              )}
            </For>

            <Show when={running()}>
              <div class="msg assistant live">
                <div class="msg-role">running {liveFlow()?.flow_name ? `· ${liveFlow()!.flow_name}` : ""}</div>
                <Show when={livePlan()}>
                  <div class="msg-content mono">strict-deterministic plan: {livePlan()!.steps.map((s) => s.tool).join(" → ")}</div>
                </Show>
                <div class="run-trace">
                  <For each={liveSteps()}>{(r) => <StepRow r={r} />}</For>
                </div>
                <span class="run-spinner">executing allowed structured steps only</span>
              </div>
            </Show>
          </div>

          <div class="composer">
            <textarea
              class="text-area"
              placeholder="Describe the next structured session task…"
              value={prompt()}
              onInput={(e) => setPrompt(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run() }}
            />
            <details class="composer-extra">
              <summary>source content for TDD / review steps</summary>
              <textarea class="text-area" placeholder="Paste source or diff context here" value={sourceContent()} onInput={(e) => setSourceContent(e.currentTarget.value)} />
            </details>
            <div class="composer-actions">
              <span class="muted">policy: strict deterministic · ⌘/Ctrl+Enter to run</span>
              <button class="flow-save" disabled={running() || !prompt().trim() || sessionDetail()?.locked} onClick={run}>{running() ? "running…" : "run structured flow"}</button>
            </div>
          </div>
        </div>

        <div class="card session-column">
          <h3>Review & KPIs</h3>
          <div class="session-kpi-grid">
            <div class="session-mini-kpi"><span class="field-label">provider</span><strong>{props.status?.current_provider || "unknown"}</strong></div>
            <div class="session-mini-kpi"><span class="field-label">quality tier</span><strong>{props.status?.current_quality_tier || props.status?.active_slot || "brain"}</strong></div>
            <div class="session-mini-kpi"><span class="field-label">pending todos</span><strong>{props.status?.todos?.pending ?? props.home?.totals.pending_todos ?? 0}</strong></div>
            <div class="session-mini-kpi"><span class="field-label">savings / hr</span><strong>{fmtUsd(props.savings?.savings_rate_per_hour)}</strong></div>
          </div>
          <div class="session-state-block">
            <span class="field-label">resolved plan</span>
            <Show when={effectivePlan()} fallback={<p class="muted">No orchestration plan yet. Run the session to materialize one.</p>}>
              <div class="session-plan-box">
                <div class="session-plan-head">
                  <strong>{effectivePlan()?.recommended_label || "Structured plan"}</strong>
                  <span>{Math.round(Number(effectivePlan()?.confidence || 0) * 100)}%</span>
                </div>
                <p class="session-copy">{effectivePlan()?.recommended_next_action || effectivePlan()?.reason}</p>
                <div class="run-trace">
                  <For each={effectivePlan()?.steps || []}>{(step, index) => (
                    <div class="run-step">
                      <span class="run-step-tool">{index() + 1}</span>
                      <span class="run-step-label">{step.tool} · {step.label}</span>
                    </div>
                  )}</For>
                </div>
              </div>
            </Show>
          </div>
          <div class="session-state-block">
            <span class="field-label">latest run trace</span>
            <Show when={liveSteps().length} fallback={<p class="muted">No live execution trace yet.</p>}>
              <div class="run-trace">
                <For each={liveSteps()}>{(r) => <StepRow r={r} />}</For>
              </div>
            </Show>
          </div>
          <div class="session-state-block">
            <span class="field-label">backend signal</span>
            <p class="session-copy">
              {props.status?.backend_connected ? "Backend reachable. Structured execution is live." : "Backend degraded. UI remains operational, but execution fidelity may be reduced."}
            </p>
          </div>
          <Show when={err()}><div class="error">{err()}</div></Show>
        </div>

        <div class="card session-column">
          <h3>Deterministic Control</h3>
          <div class="session-state-block">
            <span class="field-label">vibe modes</span>
            <div class="mode-control-grid">
              <For each={modeCards()}>{(mode) => (
                <button
                  class={`mode-card-btn ${mode.active ? "active" : ""}`}
                  disabled={busyAction() === `mode:${mode.id}` || !mode.available}
                  title={mode.desc}
                  onClick={() => setMode(mode.id)}
                >
                  <strong>{mode.name}</strong>
                  <span>{mode.pipeline.join(" → ")}</span>
                </button>
              )}</For>
            </div>
          </div>

          <div class="session-state-block">
            <span class="field-label">flow binding</span>
            <select value={props.session.flow_id || ""} onChange={(e) => changeFlow(e.currentTarget.value)}>
              <option value="">inherit (project / global default)</option>
              <For each={props.flows}>{(f) => <option value={f.id}>{f.name}{f.scope === "project" ? " (project)" : ""}</option>}</For>
            </select>
          </div>

          <div class="session-state-block">
            <span class="field-label">strict policy</span>
            <div class="policy-box">
              <div class="policy-row"><span>run model</span><strong>strict deterministic</strong></div>
              <div class="policy-row"><span>links / commands</span><strong>blocked unless structured</strong></div>
              <div class="policy-row"><span>TDD plan</span><strong>{effectivePlan()?.steps?.some((step) => step.tool === "tdd") ? "active in plan" : "inject when required"}</strong></div>
              <div class="policy-row"><span>thinking</span><strong>{props.status?.thinking || "brief"}</strong></div>
            </div>
          </div>

          <div class="session-state-block">
            <span class="field-label">session actions</span>
            <div class="session-action-grid">
              <For each={deriveSessionActions(detail())}>{(action) => (
                <button class="shell-link" disabled={busyAction() === action} onClick={() => mutateSessionAction(action)}>
                  {busyAction() === action ? "…" : action}
                </button>
              )}</For>
            </div>
          </div>

          <div class="session-state-block">
            <span class="field-label">TDD Flow Plan</span>
            <Show when={effectivePlan()?.steps?.length} fallback={<p class="muted">No structured plan yet. Run a session task to generate one.</p>}>
              <div class="session-plan-list">
                <For each={effectivePlan()?.steps || []}>{(step, index) => (
                  <div class="session-plan-item">
                    <span>{index() + 1}</span>
                    <div>
                      <strong>{step.label}</strong>
                      <div class="muted">{step.tool} · {step.reason}</div>
                    </div>
                  </div>
                )}</For>
              </div>
            </Show>
          </div>
        </div>
      </section>
    </div>
  )
}
