import { createEffect, createMemo, createResource, createSignal, For, Show, onCleanup } from "solid-js"
import {
  listMessages,
  runSession,
  type OrchMessage,
  type OrchPlan,
  type OrchProject,
  type OrchSession,
  type OrchStepResult,
  type SavingsPayload,
  type SessionDetailPayload,
  type StatusPayload,
  type CapabilitiesPayload,
} from "../api"
import { getMode, normalizeLegacyMode } from "../../../mode-router"
import { fetchSessionDetail } from "../api"

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

function formatModeLabel(mode: string | null | undefined): string {
  const normalized = String(mode || "").trim().toLowerCase()
  if (!normalized) return "auto"
  if (normalized === "auto") return "auto"
  try { return getMode(normalizeLegacyMode(normalized)).name || normalized } catch { return normalized }
}

function deriveSessionActions(detail: SessionDetailPayload | undefined): string[] {
  const current = detail?.session
  const actions = ["start", "pause", "resume", current?.locked ? "unlock" : "lock", "archive", "undo"]
  return [...new Set(actions)]
}

export default function Session(props: {
  session: OrchSession | null
  project: OrchProject | null
  status: StatusPayload | null
  capabilities: CapabilitiesPayload | null
  savings: SavingsPayload | null
  runRequest: { sessionId: string; prompt: string } | null
  onRunRequestHandled: () => void
  onRefresh: () => void
}) {
  const [detail, { mutate: mutateDetail, refetch: refetchDetail }] = createResource(() => props.session?.id || null, (id) => id ? fetchSessionDetail(id) : Promise.resolve({ session: null } as SessionDetailPayload))
  const [messages, { refetch: refetchMessages }] = createResource(() => props.session?.id || null, (id) => id ? listMessages(id) : Promise.resolve({ messages: [] as OrchMessage[] }))
  const [prompt, setPrompt] = createSignal("")
  const [running, setRunning] = createSignal(false)
  const [busyAction, setBusyAction] = createSignal<string | null>(null)
  const [livePlan, setLivePlan] = createSignal<OrchPlan | null>(null)
  const [liveSteps, setLiveSteps] = createSignal<OrchStepResult[]>([])
  const [err, setErr] = createSignal<string | null>(null)
  let abort: (() => void) | null = null
  onCleanup(() => abort?.())

  const sessionDetail = createMemo(() => detail()?.session)
  const effectivePlan = createMemo(() => livePlan() || sessionDetail()?.orchestration_plan || props.status?.orchestration_plan || null)
  const effectiveMode = createMemo(() => String(sessionDetail()?.optimization_mode || props.status?.optimization_mode || "auto").toLowerCase())
  const effectiveModeLabel = createMemo(() => formatModeLabel(effectiveMode()))
  const backendOnline = createMemo(() => props.status?.backend_connected ?? props.status?.backendConnected ?? false)

  const runPrompt = (value: string) => {
    const session = props.session
    const p = String(value || "").trim()
    if (!session || !p || running()) return
    if (sessionDetail()?.locked) {
      setErr("Session is locked. Unlock it before running a deterministic flow.")
      return
    }
    abort?.()
    setRunning(true)
    setErr(null)
    setLivePlan(null)
    setLiveSteps([])
    abort = runSession(session.id, {
      prompt: p,
      query: p,
      execution_policy: "strict-deterministic",
    }, {
      onEvent: (event, data) => {
        if (event === "plan") setLivePlan(data.plan)
        else if (event === "step") setLiveSteps((s) => [...s, data])
        else if (event === "done") {
          setRunning(false)
          abort = null
          setPrompt("")
          setLivePlan(null)
          setLiveSteps([])
          void refetchMessages()
          void refetchDetail()
          props.onRefresh()
        } else if (event === "error") {
          setErr(data.message || "run failed")
          setRunning(false)
          abort = null
        }
      },
      onError: (e) => { setErr(e.message); setRunning(false); abort = null },
      onDone: () => setRunning(false),
    })
  }

  createEffect(() => {
    const request = props.runRequest
    const session = props.session
    if (!request || !session || request.sessionId !== session.id) return
    setPrompt(request.prompt)
    props.onRunRequestHandled()
    runPrompt(request.prompt)
  })

  const mutateSessionAction = async (action: string) => {
    const session = props.session
    if (!session) return
    setBusyAction(action)
    setErr(null)
    try {
      const { postSessionAction } = await import("../api")
      const res = await postSessionAction(session.id, { action })
      mutateDetail((current) => current ? { ...current, session: res.session, metrics: res.metrics, orchestration: res.orchestration ?? null } : current)
      void refetchDetail()
      props.onRefresh()
    } catch (e: unknown) {
      setErr((e as Error).message)
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div class="session-workspace card panel">
      <div class="panel-head session-head">
        <div>
          <div class="column-badge-row">
            <span class="column-badge">3</span>
            <h3>Session Chat</h3>
          </div>
          <div class="panel-head-copy">{props.session ? props.session.title : "Select a session from column 2"} · live thread + structured run</div>
        </div>
        <div class="session-hero-meta">
          <span>mode {effectiveModeLabel() || "auto"}</span>
          <span>slot {props.status?.active_slot || "brain"}</span>
          <span>model {(props.status?.current_model || "unknown").split("/").pop()}</span>
          <span>backend {backendOnline() ? "live" : "degraded"}</span>
        </div>
      </div>

      <Show when={props.session} fallback={<p class="muted">Pick a session link from column 2 to open the chat and live run stream.</p>}>
        <div class="session-hero session-hero-compact">
          <div>
            <div class="home-kicker">session workspace</div>
            <h2 class="session-title">{props.session!.title}</h2>
            <div class="session-hero-meta">
              <span>{props.session!.id.slice(0, 18)}…</span>
              <span>project {props.project?.name || sessionDetail()?.project_name || "selected"}</span>
              <span>{backendOnline() ? "backend online" : "backend degraded"}</span>
              <span>{sessionDetail()?.locked ? "locked" : sessionDetail()?.status || "active"}</span>
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
              <span class="field-label">status</span>
              <strong>{sessionDetail()?.locked ? "locked" : sessionDetail()?.status || "active"}</strong>
            </div>
          </div>
        </div>

        <div class="session-body">
          <div class="session-thread">
            <Show when={effectivePlan()}>
              <div class="msg assistant live">
                <div class="msg-role">resolved plan</div>
                <div class="msg-content mono">{effectivePlan()!.recommended_label || "Structured plan"}</div>
                <div class="session-plan-head">
                  <span class="muted">{effectivePlan()!.recommended_next_action || effectivePlan()!.reason}</span>
                  <span>{Math.round(Number(effectivePlan()!.confidence || 0) * 100)}%</span>
                </div>
                <div class="run-trace">
                  <For each={effectivePlan()!.steps || []}>{(step, index) => (
                    <div class="run-step">
                      <span class="run-step-tool">{index() + 1}</span>
                      <span class="run-step-label">{step.tool} · {step.label}</span>
                    </div>
                  )}</For>
                </div>
              </div>
            </Show>

            <For each={messages()?.messages || []} fallback={<p class="muted">No chat yet. Use the composer below to run a structured session prompt.</p>}>
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
                <div class="msg-role">running</div>
                <Show when={livePlan()}>
                  <div class="msg-content mono">{livePlan()!.steps.map((s) => s.tool).join(" → ")}</div>
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
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runPrompt(prompt()) }}
            />
            <div class="composer-actions">
              <span class="muted">policy: strict deterministic · ⌘/Ctrl+Enter to run</span>
              <button class="flow-save" disabled={running() || !prompt().trim() || sessionDetail()?.locked} onClick={() => runPrompt(prompt())}>{running() ? "running…" : "run structured flow"}</button>
            </div>
          </div>

          <div class="session-mini-grid">
            <div class="session-state-block">
              <span class="field-label">session state</span>
              <div class="session-state-stack">
                <div class="session-state-row"><span>project</span><strong>{sessionDetail()?.project_name || props.project?.name || "Current project"}</strong></div>
                <div class="session-state-row"><span>status</span><strong>{sessionDetail()?.status || "active"}</strong></div>
                <div class="session-state-row"><span>mode</span><strong>{effectiveModeLabel() || "auto"}</strong></div>
                <div class="session-state-row"><span>started</span><strong>{fmtDate(sessionDetail()?.started_at)}</strong></div>
                <div class="session-state-row"><span>lock</span><strong>{sessionDetail()?.locked ? "locked" : "mutable"}</strong></div>
              </div>
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
          </div>

          <div class="session-actions-row">
            <For each={deriveSessionActions(detail())}>{(action) => (
              <button class="shell-link" disabled={busyAction() === action} onClick={() => void mutateSessionAction(action)}>
                {busyAction() === action ? "…" : action}
              </button>
            )}</For>
          </div>

          <Show when={err()}><div class="error">{err()}</div></Show>
        </div>
      </Show>
    </div>
  )
}
