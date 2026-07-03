import { createSignal } from "solid-js"
import { postTrinity, type StatusPayload } from "../api"

export default function RealityCheckPanel({ status }: { status: StatusPayload | null }) {
  const [busy, setBusy] = createSignal(false)
  const [msg, setMsg] = createSignal("")
  const health = () => status?.session_health || null
  const claim = () => status?.claim_evidence || health()?.claimEvidence || null

  async function refreshVerifiedState() {
    setBusy(true)
    setMsg("")
    try {
      const result = await postTrinity("reality-check")
      setMsg(String(result.result || "Verified state refreshed"))
    } catch (err: any) {
      setMsg(err?.message || "Failed to refresh verified state")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="card-full">
      <h3>Progress Health</h3>
      {!health() ? (
        <p class="muted">No session health snapshot yet.</p>
      ) : (
        <>
          <div class="control-group">
            <h4>Current Risk</h4>
            <div class="bracket-row">
              <span class={`badge ${health()!.risk === "high" ? "off" : "on"}`}>{health()!.risk}</span>
              <span class="badge">score {health()!.score}</span>
              <span class={`badge ${health()!.decisiveProgress ? "on" : "off"}`}>{health()!.decisiveProgress ? "decisive progress" : "no decisive progress"}</span>
              <span class={`badge ${health()!.metaWorkDrift ? "off" : "on"}`}>{health()!.metaWorkDrift ? "meta-work drift" : "task-focused"}</span>
            </div>
          </div>

          <div class="control-group">
            <h4>Ratios</h4>
            <div class="result-box">
              <code>implementation {(health()!.implementationRatio * 100).toFixed(0)}% | inspection {(health()!.inspectionRatio * 100).toFixed(0)}%</code>
            </div>
          </div>

          <div class="control-group">
            <h4>Recovery</h4>
            <div class="result-box">
              <code>{health()!.recommendedAction}</code>
              {health()!.stopDoing && <code>{health()!.stopDoing}</code>}
            </div>
          </div>

          <div class="control-group">
            <h4>Loop Signals</h4>
            <div class="result-box">
              {(health()!.loopSignals || []).length === 0 ? (
                <code>none</code>
              ) : (
                (health()!.loopSignals || []).slice(0, 4).map((signal) => (
                  <code>{signal.kind}: {signal.summary}</code>
                ))
              )}
            </div>
          </div>

          <div class="control-group">
            <h4>Claim Evidence</h4>
            <div class="result-box">
              <code>{claim()?.status || "not_applicable"}{claim()?.reason ? ` — ${claim()!.reason}` : ""}</code>
              {claim()?.matchedEvidence?.length ? <code>matched: {claim()!.matchedEvidence.join(", ")}</code> : null}
              {claim()?.missingEvidence?.length ? <code>missing: {claim()!.missingEvidence.join(", ")}</code> : null}
            </div>
          </div>
        </>
      )}

      <div class="bracket-row">
        <button class="bracket-btn on" disabled={busy()} onClick={() => void refreshVerifiedState()}>
          {busy() ? "..." : "verify state"}
        </button>
      </div>

      {msg() && (
        <div class="result-box" style="margin-top:0.65rem">
          <code>{msg()}</code>
        </div>
      )}
    </div>
  )
}

