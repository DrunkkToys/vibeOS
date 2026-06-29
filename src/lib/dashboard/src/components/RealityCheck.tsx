import { createSignal, onMount } from "solid-js"
import { fetchRealityCheck, postTrinity, saveRealityCheck, type StatusPayload, type RealityCheckRule, type RealityCheckView } from "../api"

export default function RealityCheckPanel({ status }: { status: StatusPayload | null }) {
  const [scope, setScope] = createSignal<"global" | "project">("global")
  const [projectId, setProjectId] = createSignal("")
  const [enabled, setEnabled] = createSignal(true)
  const [rulesText, setRulesText] = createSignal("[]")
  const [view, setView] = createSignal<RealityCheckView | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [msg, setMsg] = createSignal<string>("")

  async function load(nextScope = scope(), nextProjectId = projectId()) {
    setBusy(true)
    setMsg("")
    try {
      const data = await fetchRealityCheck(nextScope, nextScope === "project" ? nextProjectId : undefined)
      setView(data)
      setScope(data.scope)
      setProjectId(data.project_id || data.current_project?.id || nextProjectId || "")
      setEnabled(data.enabled !== false)
      setRulesText(JSON.stringify(data.rules || [], null, 2))
    } catch (err: any) {
      setMsg(err?.message || "Failed to load reality-check state")
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    let rules: RealityCheckRule[] = []
    try {
      const parsed = JSON.parse(rulesText())
      rules = Array.isArray(parsed) ? parsed : []
    } catch {
      setMsg("Rules must be valid JSON array")
      return
    }
    setBusy(true)
    setMsg("")
    try {
      const result = await saveRealityCheck({
        scope: scope(),
        project_id: scope() === "project" ? projectId() : undefined,
        enabled: enabled(),
        rules,
      })
      if (result.ok) {
        setMsg("Saved reality-check settings")
        await load(scope(), projectId())
      } else {
        setMsg(result.error || "Save failed")
      }
    } catch (err: any) {
      setMsg(err?.message || "Save failed")
    } finally {
      setBusy(false)
    }
  }

  async function runRealityCheck() {
    setBusy(true)
    setMsg("")
    try {
      const result = await postTrinity("reality-check")
      setMsg(String(result.result || "Reality check complete"))
    } catch (err: any) {
      setMsg(err?.message || "Reality check failed")
    } finally {
      setBusy(false)
    }
  }

  onMount(() => { void load() })

  return (
    <div class="card-full">
      <h3>Reality Check</h3>
      <div class="control-group">
        <h4>Scope</h4>
        <div class="bracket-row">
          <button class={`bracket-btn ${scope() === "global" ? "on" : ""}`} disabled={busy()} onClick={() => { setScope("global"); void load("global") }}>
            global
          </button>
          <button class={`bracket-btn ${scope() === "project" ? "on" : ""}`} disabled={busy()} onClick={() => { setScope("project"); void load("project", projectId() || status?.current_project_fingerprint || view()?.current_project?.id || "") }}>
            project
          </button>
        </div>
      </div>

      {scope() === "project" && (
        <div class="control-group">
          <h4>Project</h4>
          <label class="field-label" for="reality-project">project fingerprint</label>
          <select
            id="reality-project"
            class="text-input"
            value={projectId() || view()?.current_project?.id || ""}
            disabled={busy()}
            onChange={(e) => { setProjectId(e.currentTarget.value); void load("project", e.currentTarget.value) }}
          >
            <option value="">select a project</option>
            {(view()?.known_projects || []).map((p) => (
              <option value={p.id}>{p.name ? `${p.name} (${p.id})` : p.id}</option>
            ))}
          </select>
        </div>
      )}

      <div class="control-group">
        <h4>Active</h4>
        <div class="bracket-row">
          <button class={`bracket-btn ${enabled() ? "on" : "off"}`} disabled={busy()} onClick={() => setEnabled(!enabled())}>
            {enabled() ? "enabled" : "disabled"}
          </button>
        </div>
      </div>

      <div class="control-group">
        <h4>Rules</h4>
        <label class="field-label" for="reality-rules">editable JSON array</label>
        <textarea
          id="reality-rules"
          class="text-area"
          value={rulesText()}
          disabled={busy()}
          onInput={(e) => setRulesText(e.currentTarget.value)}
        />
      </div>

      <div class="bracket-row">
        <button class="bracket-btn on" disabled={busy()} onClick={() => void load()}>
          reload
        </button>
        <button class="bracket-btn on" disabled={busy()} onClick={() => void save()}>
          save
        </button>
        <button class="bracket-btn on" disabled={busy()} onClick={() => void runRealityCheck()}>
          reality-check
        </button>
      </div>

      <div class="result-box" style="margin-top:0.65rem">
        <code>
          {msg() || `scope=${scope()}${scope() === "project" && projectId() ? ` project=${projectId()}` : ""} rules=${view()?.rules?.length ?? 0}`}
        </code>
      </div>
    </div>
  )
}
