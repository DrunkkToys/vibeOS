import { type StatusPayload } from "../api"

export default function StatusCard({ status }: { status: StatusPayload | null }) {
  if (!status) return <div class="card"><h3>Status</h3><p class="muted">loading...</p></div>

  return (
    <div class="card">
      <h3>Status</h3>
      <table class="kv-table">
        <tbody>

          <tr><td>slot</td><td><span class="badge slot">{status.active_slot}</span></td></tr>
          <tr><td>model</td><td><code>{status.current_model}</code></td></tr>
          <tr><td>thinking</td><td><span class="badge">{status.thinking}</span></td></tr>
          <tr><td>enforce</td><td><span class={`badge ${status.enforce ? "on" : "off"}`}>{status.enforce ? "ON" : "OFF"}</span></td></tr>
          <tr><td>flow</td><td><span class={`badge ${status.flow_enforcer ? "on" : "off"}`}>{status.flow_enforcer ? "ON" : "OFF"}</span></td></tr>
          <tr><td>tdd</td><td><span class={`badge ${status.tdd_enforcer ? "on" : "off"}`}>{status.tdd_enforcer ? "ON" : "OFF"}</span></td></tr>
          <tr><td>tdd strict</td><td><span class={`badge ${status.tdd_strict ? "on" : "off"}`}>{status.tdd_strict ? "ON" : "OFF"}</span></td></tr>
          <tr><td>progress health</td><td><span class={`badge ${status.session_health?.risk === "high" ? "off" : "on"}`}>{status.session_health ? `${status.session_health.risk} (${status.session_health.score})` : "n/a"}</span></td></tr>
          <tr><td>claim evidence</td><td><span class={`badge ${status.claim_evidence?.status === "supported" ? "on" : status.claim_evidence?.status === "not_applicable" ? "" : "off"}`}>{status.claim_evidence?.status || "n/a"}</span></td></tr>
          <tr><td>reality-check</td><td><span class={`badge ${status.reality_check_enabled ? "on" : "off"}`}>{status.reality_check_enabled ? `ON${status.reality_check_scope ? ` (${status.reality_check_scope})` : ""}` : "OFF"}</span></td></tr>
          <tr><td>backend</td><td><span class={`badge ${status.backend_connected ? "on" : "off"}`}>{status.backend_connected ? "⚡ ON" : "OFF"}</span></td></tr>
          <tr><td>backend url</td><td><code>{status.backend_api_url || status.backend_health_url || "unknown"}</code></td></tr>
          <tr><td>last check</td><td>{status.backend_health_checked_at ? `${status.backend_health_checked_at}${typeof status.backend_health_age_ms === "number" ? ` (${Math.round(status.backend_health_age_ms / 1000)}s ago)` : ""}` : "never"}</td></tr>
          <tr><td>health</td><td>{status.backend_health_error ? <span class="badge off">{status.backend_health_error}</span> : <span class="badge on">{typeof status.backend_health_latency_ms === "number" ? `${status.backend_health_latency_ms}ms` : "ok"}</span>}</td></tr>
          <tr><td>lock</td><td><span class={`badge ${status.model_locked ? "on" : "off"}`}>{status.model_locked ? `ON${status.locked_slot ? ` (${status.locked_slot})` : ""}` : "OFF"}</span></td></tr>
          <tr><td>credit</td><td><div class="credit-bar"><div class="credit-fill" style={`width: ${status.credit_percent}%`}></div></div><span class="credit-label">{status.credit_percent.toFixed(1)}%</span></td></tr>
        </tbody>
      </table>
    </div>
  )
}
