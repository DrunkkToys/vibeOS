import { createSignal } from "solid-js"
import { postTrinity, type StatusPayload } from "../api"
import RealityCheckPanel from "./RealityCheck"
import { getBrandedModes } from "../../../mode-table"

const dashboardModes = getBrandedModes()

export default function Controls({ status, onAction }: { status: StatusPayload | null; onAction: () => void }) {
  const [busy, setBusy] = createSignal<string | null>(null)
  const [msg, setMsg] = createSignal<{ text: string; ok: boolean } | null>(null)

  async function run(action: string, slot?: string) {
    setBusy(action + (slot || ""))
    setMsg(null)
    try {
      const r = await postTrinity(action, slot)
      setMsg({ text: r.ok ? String(r.result) : String(r.error), ok: r.ok })
      onAction()
    } catch (e: unknown) {
      setMsg({ text: (e as Error).message, ok: false })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div class="card-full">
      <h3>Controls</h3>

      <div class="control-group">
        <h4>Vibe Mode</h4>
        <div class="bracket-row">
          {dashboardModes.map((mode) => (
            <button
              class={`bracket-btn ${status?.optimization_mode === mode.id ? "on" : ""}`}
              disabled={busy() === `mode${mode.id}`}
              onClick={() => run("mode", mode.id)}
              title={mode.desc}
            >{busy() === `mode${mode.id}` ? "..." : mode.name}</button>
          ))}
        </div>
      </div>

      <hr class="section-divider" />

      <div class="control-group">
        <h4>Slot</h4>
        <div class="bracket-row">
          <button class={`bracket-btn ${status?.active_slot === "brain" ? "on" : ""}`} disabled={busy() === "setbrain"} onClick={() => run("set", "brain")}>{busy() === "setbrain" ? "..." : "brain"}</button>
          <button class={`bracket-btn ${status?.active_slot === "medium" ? "on" : ""}`} disabled={busy() === "setmedium"} onClick={() => run("set", "medium")}>{busy() === "setmedium" ? "..." : "medium"}</button>
          <button class={`bracket-btn ${status?.active_slot === "cheap" ? "on" : ""}`} disabled={busy() === "setcheap"} onClick={() => run("set", "cheap")}>{busy() === "setcheap" ? "..." : "cheap"}</button>
        </div>
      </div>

      <hr class="section-divider" />

      <div class="control-group">
        <h4>Enforcement</h4>
        <div class="bracket-row">
          <button class={`bracket-btn ${status?.enforce ? "on" : "off"}`} disabled={busy() === "enforceon"} onClick={() => run("enforce", "on")}>{busy() === "enforceon" ? "..." : "enf on"}</button>
          <button class={`bracket-btn ${!status?.enforce ? "on" : "off"}`} disabled={busy() === "enforceoff"} onClick={() => run("enforce", "off")}>{busy() === "enforceoff" ? "..." : "enf off"}</button>
        </div>
      </div>

      <hr class="section-divider" />

      <div class="control-group">
        <h4>Lock</h4>
        <div class="bracket-row">
          <button class={`bracket-btn ${status?.model_locked ? "on" : "off"}`} disabled={busy() === "lockon"} onClick={() => run("lock", "on")}>{busy() === "lockon" ? "..." : "lock on"}</button>
          <button class={`bracket-btn ${!status?.model_locked ? "on" : "off"}`} disabled={busy() === "lockoff"} onClick={() => run("lock", "off")}>{busy() === "lockoff" ? "..." : "lock off"}</button>
        </div>
      </div>

      <hr class="section-divider" />

      <div class="control-group">
        <h4>Flow</h4>
        <div class="bracket-row">
          <button class={`bracket-btn ${status?.flow_enforcer ? "on" : "off"}`} disabled={busy() === "flowon"} onClick={() => run("flow", "on")}>{busy() === "flowon" ? "..." : "flow on"}</button>
          <button class={`bracket-btn ${!status?.flow_enforcer ? "on" : "off"}`} disabled={busy() === "flowoff"} onClick={() => run("flow", "off")}>{busy() === "flowoff" ? "..." : "flow off"}</button>
          <button class={`bracket-btn ${status?.flow_extract_todos ? "on" : "off"}`} disabled={busy() === "flowenforce"} onClick={() => run("flow", "enforce")}>{busy() === "flowenforce" ? "..." : "flow enf"}</button>
        </div>
      </div>

      <hr class="section-divider" />

      <div class="control-group">
        <h4>TDD</h4>
        <div class="bracket-row">
          <button class={`bracket-btn ${status?.tdd_enforcer ? "on" : "off"}`} disabled={busy() === "tddon"} onClick={() => run("tdd", "on")}>{busy() === "tddon" ? "..." : "tdd on"}</button>
          <button class={`bracket-btn ${!status?.tdd_enforcer ? "on" : "off"}`} disabled={busy() === "tddoff"} onClick={() => run("tdd", "off")}>{busy() === "tddoff" ? "..." : "tdd off"}</button>
          <button class={`bracket-btn ${status?.tdd_strict ? "on" : "off"}`} disabled={busy() === "tddstrict"} onClick={() => run("tdd", "strict")}>{busy() === "tddstrict" ? "..." : "tdd strict"}</button>
        </div>
      </div>

      <hr class="section-divider" />

      <div class="control-group">
        <h4>Thinking</h4>
        <div class="bracket-row">
          <button class={`bracket-btn ${status?.thinking === "full" ? "on" : ""}`} disabled={busy() === "thinkingfull"} onClick={() => run("thinking", "full")}>{busy() === "thinkingfull" ? "..." : "full"}</button>
          <button class={`bracket-btn ${status?.thinking === "brief" ? "on" : ""}`} disabled={busy() === "thinkingbrief"} onClick={() => run("thinking", "brief")}>{busy() === "thinkingbrief" ? "..." : "brief"}</button>
          <button class={`bracket-btn ${status?.thinking === "off" ? "on" : ""}`} disabled={busy() === "thinkingoff"} onClick={() => run("thinking", "off")}>{busy() === "thinkingoff" ? "..." : "off"}</button>
        </div>
      </div>

      <hr class="section-divider" />

      <RealityCheckPanel status={status} />

      <hr class="section-divider" />

      <div class="control-group">
        <h4>Actions</h4>
        <div class="bracket-row">
          <button class="bracket-btn" disabled={busy() === "status"} onClick={() => run("status")}>{busy() === "status" ? "..." : "status"}</button>
          <button class="bracket-btn" disabled={busy() === "disable"} onClick={() => run("disable")}>{busy() === "disable" ? "..." : "disable"}</button>
          <button class="bracket-btn" disabled={busy() === "help"} onClick={() => run("help")}>{busy() === "help" ? "..." : "help"}</button>
        </div>
      </div>

      {msg() && (
        <div class="result-box">
          <code>{msg()!.text}</code>
          <button class="dismiss-btn" onClick={() => setMsg(null)}>x</button>
        </div>
      )}
    </div>
  )
}
