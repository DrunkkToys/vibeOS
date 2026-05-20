import { createSignal } from "solid-js"

export default function BlackboxPanel() {
  const [state, setState] = createSignal<any>(null)
  const [err, setErr] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  async function refresh() {
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch("/status")
      const d = await r.json()
      if (d.sessions_raw) {
        setState({
          sub_regime: "active",
          momentum: 0.5,
          resolution_state: "in_progress",
          loop_count: 0,
          intervention_level: 0,
        })
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="card-full">
      <h3>Blackbox Engine</h3>

      <div class="bracket-row">
        <button class="bracket-btn" onClick={refresh} disabled={busy()}>{busy() ? "..." : "refresh"}</button>
        <span class="sep muted">|</span>
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

      {!state() && !busy() && !err() && <p class="muted">Press refresh to load state</p>}
      {err() && <p class="error">{err()}</p>}
    </div>
  )
}
