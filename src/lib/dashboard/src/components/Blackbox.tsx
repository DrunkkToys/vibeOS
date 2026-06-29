import { createSignal, onMount } from "solid-js"
import { blackboxAnalyze, fetchCapabilities, fetchStatus, type CapabilitiesPayload } from "../api"
import { buildOrchestrationPlan, summarizeOrchestrationPlan } from "../orchestration"

export default function BlackboxPanel() {
  const [state, setState] = createSignal<any>(null)
  const [cap, setCap] = createSignal<CapabilitiesPayload | null>(null)
  const [err, setErr] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [sessionId, setSessionId] = createSignal("default")
  const [prompt, setPrompt] = createSignal("show current status")
  const [mode, setMode] = createSignal<"audit" | "budget" | "quality" | "vibeqmax" | "auto">("audit")
  const [analysis, setAnalysis] = createSignal<any>(null)

  onMount(async () => {
    try {
      const d = await fetchCapabilities()
      setCap(d)
    } catch {}
  })

  async function refresh() {
    setBusy(true)
    setErr(null)
    try {
      const d = await fetchStatus()
      setState({
        sub_regime: d.active_slot || "active",
        momentum: (d.credit_percent || 0) / 100,
        resolution_state: d.enabled ? "in_progress" : "disabled",
        loop_count: 0,
        intervention_level: d.enforce ? 1 : 0,
      })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function runAnalysis() {
    setBusy(true)
    setErr(null)
    try {
      const result = await blackboxAnalyze(sessionId(), {
        userText: prompt(),
        action: "explore",
        optimizationMode: mode(),
      })
      setAnalysis(result)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const orchestrationPlan = () => buildOrchestrationPlan({
    prompt: prompt(),
    contextText: prompt(),
    sessionId: sessionId(),
    capabilities: cap() || undefined,
    loopCount: state()?.loop_count ?? 0,
    loopConsecutive: state()?.loop_count ?? 0,
    stressScore: state()?.intervention_level ? 0.8 : 0.1,
  })

  return (
    <div class="card-full">
      <h3>Blackbox Engine</h3>

      <div class="control-group">
        <h4>Mode</h4>
        <div class="bracket-row">
          <button class={`bracket-btn ${mode() === "audit" ? "on" : ""}`} disabled={busy()} onClick={() => setMode("audit")}>audit</button>
          <button class={`bracket-btn ${mode() === "budget" ? "on" : ""}`} disabled={busy()} onClick={() => setMode("budget")}>budget</button>
          <button class={`bracket-btn ${mode() === "auto" ? "on" : ""}`} disabled={busy()} onClick={() => setMode("auto")}>auto</button>
          <button class={`bracket-btn ${mode() === "quality" ? "on" : ""}`} disabled={busy()} onClick={() => setMode("quality")}>quality</button>
          <button class={`bracket-btn ${mode() === "vibeqmax" ? "on" : ""}`} disabled={busy()} onClick={() => setMode("vibeqmax")}>vibeqmax</button>
        </div>
      </div>

      <div class="control-group">
        <h4>Request</h4>
        <label class="field-label">Session</label>
        <input
          class="text-input"
          value={sessionId()}
          onInput={(e) => setSessionId(e.currentTarget.value)}
          placeholder="default"
        />
        <label class="field-label">Prompt</label>
        <textarea
          class="text-area"
          value={prompt()}
          onInput={(e) => setPrompt(e.currentTarget.value)}
          rows={4}
        />
        <div class="bracket-row">
          <button class="bracket-btn" onClick={refresh} disabled={busy()}>{busy() ? "..." : "refresh"}</button>
          <button class="bracket-btn on" onClick={runAnalysis} disabled={busy()}>{busy() ? "..." : "run"}</button>
        </div>
      </div>

      <div class="control-group">
        <h4>Recommended Next Action</h4>
        <div class="search-hero">
          <div>
            <div class="search-hero-kicker">client-side orchestration</div>
            <div class="search-hero-title">{orchestrationPlan().recommended_label}</div>
            <p class="search-hero-copy">{orchestrationPlan().reason}</p>
          </div>
          <div class="search-hero-meta">
            <span class="badge on">{orchestrationPlan().recommended_next_action}</span>
            <span class="badge">{Math.round(orchestrationPlan().confidence * 100)}% confidence</span>
            <span class="badge">{orchestrationPlan().steps.length} step{orchestrationPlan().steps.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div class="bracket-row">
          {orchestrationPlan().steps.map((step) => (
            <span class="badge">{step.label}</span>
          ))}
        </div>
        <p class="muted">Plan: {summarizeOrchestrationPlan(orchestrationPlan())}</p>
      </div>

      {state() && (
        <table class="kv-table blackbox-status">
          <tbody>
            <tr><td>sub-regime</td><td><span class="badge">{state().sub_regime}</span></td></tr>
            <tr><td>momentum</td><td>{(state().momentum * 100).toFixed(0)}%</td></tr>
            <tr><td>resolution</td><td>{state().resolution_state}</td></tr>
            <tr><td>loops</td><td>{state().loop_count}</td></tr>
            <tr><td>intervention</td><td>L{state().intervention_level}</td></tr>
          </tbody>
        </table>
      )}

      {analysis() && (
        <table class="kv-table blackbox-status">
          <tbody>
            <tr><td>mode</td><td><span class="badge on">{analysis().optimization_mode || mode()}</span></td></tr>
            <tr><td>source</td><td>{analysis().optimization_source || analysis().selection?.source || "manual"}</td></tr>
            <tr><td>confidence</td><td>{Number(analysis().optimization_confidence ?? analysis().selection?.confidence ?? 0).toFixed(2)}</td></tr>
            <tr><td>context</td><td>{analysis().context_packet?.title || analysis().context_packet?.kind || "n/a"}</td></tr>
          </tbody>
        </table>
      )}

      {!state() && !busy() && !err() && <p class="muted">Press refresh to load state</p>}
      {err() && <p class="error">{err()}</p>}
    </div>
  )
}
