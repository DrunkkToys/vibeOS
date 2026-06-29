import { createSignal, createResource, For, Show, onCleanup } from "solid-js"
import { listMessages, runSession, updateSession, type OrchSession, type OrchFlow, type OrchMessage, type OrchPlan, type OrchStepResult } from "../api"

function StepRow(props: { r: OrchStepResult }) {
  const r = props.r
  return (
    <div class={`run-step ${r.skipped ? "skipped" : "done"}`}>
      <span class="run-step-tool">{r.step?.tool}</span>
      <span class="run-step-label">{r.step?.label}</span>
      <Show when={r.skipped}><span class="run-step-skip">skipped — {r.reason}</span></Show>
      <Show when={!r.skipped && r.result}>
        <code class="run-step-result">{JSON.stringify(r.result).slice(0, 160)}</code>
      </Show>
    </div>
  )
}

export default function Session(props: { session: OrchSession; flows: OrchFlow[]; onSessionChange: (s: OrchSession) => void }) {
  const [messages, { refetch }] = createResource(() => props.session.id, listMessages)
  const [prompt, setPrompt] = createSignal("")
  const [sourceContent, setSourceContent] = createSignal("")
  const [running, setRunning] = createSignal(false)
  const [liveFlow, setLiveFlow] = createSignal<{ flow_name: string | null } | null>(null)
  const [livePlan, setLivePlan] = createSignal<OrchPlan | null>(null)
  const [liveSteps, setLiveSteps] = createSignal<OrchStepResult[]>([])
  const [err, setErr] = createSignal<string | null>(null)
  let abort: (() => void) | null = null
  onCleanup(() => abort?.())

  const flowLabel = () => {
    const fid = props.session.flow_id
    if (!fid) return "inherit (project / global default)"
    return props.flows.find((f) => f.id === fid)?.name || "custom"
  }

  const run = () => {
    const p = prompt().trim()
    if (!p || running()) return
    setRunning(true); setErr(null); setLivePlan(null); setLiveSteps([]); setLiveFlow(null)
    abort = runSession(props.session.id, { prompt: p, sourceContent: sourceContent() || undefined, query: p }, {
      onEvent: (event, data) => {
        if (event === "flow") setLiveFlow(data)
        else if (event === "plan") setLivePlan(data.plan)
        else if (event === "step") setLiveSteps((s) => [...s, data])
        else if (event === "done") { setRunning(false); setPrompt(""); refetch(); setLivePlan(null); setLiveSteps([]); setLiveFlow(null) }
        else if (event === "error") { setErr(data.message || "run failed"); setRunning(false) }
      },
      onError: (e) => { setErr(e.message); setRunning(false) },
      onDone: () => setRunning(false),
    })
  }

  const changeFlow = async (flowId: string) => {
    const res = await updateSession(props.session.id, { flow_id: flowId || null })
    props.onSessionChange(res.session)
  }

  return (
    <div class="session-pane">
      <div class="session-head">
        <div>
          <h2 class="session-title">{props.session.title}</h2>
          <span class="muted mono">{props.session.id.slice(0, 18)}…</span>
        </div>
        <label class="session-flow">
          <span class="field-label">flow</span>
          <select value={props.session.flow_id || ""} onChange={(e) => changeFlow(e.currentTarget.value)}>
            <option value="">inherit (project / global default)</option>
            <For each={props.flows}>{(f) => <option value={f.id}>{f.name}{f.scope === "project" ? " (project)" : ""}</option>}</For>
          </select>
        </label>
      </div>

      <div class="session-body">
        <div class="thread">
          <For each={messages()?.messages || []} fallback={<p class="muted">No messages yet — run a prompt below.</p>}>
            {(m: OrchMessage) => (
              <div class={`msg ${m.role}`}>
                <div class="msg-role">{m.role}</div>
                <Show when={m.role === "user"}><div class="msg-content">{m.content}</div></Show>
                <Show when={m.role === "assistant"}>
                  <div class="msg-content">{m.content || "(no summary)"}</div>
                  <Show when={m.results && m.results.length}>
                    <div class="run-trace">
                      <For each={m.results!}>{(r) => <StepRow r={r} />}</For>
                    </div>
                  </Show>
                </Show>
              </div>
            )}
          </For>

          <Show when={running() || liveSteps().length > 0}>
            <div class="msg assistant live">
              <div class="msg-role">running {liveFlow()?.flow_name ? `· ${liveFlow()!.flow_name}` : ""}</div>
              <Show when={livePlan()}>
                <div class="msg-content mono">plan: {livePlan()!.steps.map((s) => s.tool).join(" → ")}</div>
              </Show>
              <div class="run-trace">
                <For each={liveSteps()}>{(r) => <StepRow r={r} />}</For>
              </div>
              <Show when={running()}><div class="run-spinner">▮ executing…</div></Show>
            </div>
          </Show>

          <Show when={err()}><div class="error">{err()}</div></Show>
        </div>

        <div class="composer">
          <textarea
            class="text-area"
            placeholder="Type a prompt to run through this session's flow…"
            value={prompt()}
            onInput={(e) => setPrompt(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run() }}
          />
          <details class="composer-extra">
            <summary>source content (optional, for TDD steps)</summary>
            <textarea class="text-area" placeholder="export function add(a, b) { return a + b }" value={sourceContent()} onInput={(e) => setSourceContent(e.currentTarget.value)} />
          </details>
          <div class="composer-actions">
            <span class="muted">flow: {flowLabel()} · ⌘/Ctrl+Enter to run</span>
            <button class="flow-save" disabled={running() || !prompt().trim()} onClick={run}>{running() ? "running…" : "run"}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
