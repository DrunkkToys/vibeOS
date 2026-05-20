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
          <tr><td>credit</td><td><div class="credit-bar"><div class="credit-fill" style={`width: ${status.credit_percent}%`}></div></div><span class="credit-label">{status.credit_percent.toFixed(1)}%</span></td></tr>
        </tbody>
      </table>
    </div>
  )
}
