import { createSignal, For, Show } from "solid-js"
import FlowEditor from "./FlowEditor"
import { createFlow, updateFlow, deleteFlow, updateProject, type OrchProject, type OrchFlow, type FlowGraph } from "../api"

const EMPTY_GRAPH: FlowGraph = { nodes: [], edges: [] }

export default function ProjectView(props: {
  project: OrchProject
  flows: OrchFlow[]
  onProjectChange: (p: OrchProject) => void
  onFlowsChange: () => void
}) {
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const editing = () => props.flows.find((f) => f.id === editingId()) || null

  const setDefault = async (flowId: string) => {
    const res = await updateProject(props.project.id, { default_flow_id: flowId || null })
    props.onProjectChange(res.project)
  }

  const newFlow = async () => {
    const res = await createFlow(`Flow ${props.flows.length + 1}`, EMPTY_GRAPH, "project", props.project.id)
    props.onFlowsChange()
    setEditingId(res.flow.id)
  }

  const saveGraph = async (g: FlowGraph) => {
    const id = editingId(); if (!id) return
    await updateFlow(id, { graph: g })
    props.onFlowsChange()
  }

  const removeFlow = async (id: string) => {
    await deleteFlow(id)
    if (editingId() === id) setEditingId(null)
    props.onFlowsChange()
  }

  return (
    <div class="project-view">
      <div class="project-head">
        <h2 class="session-title">{props.project.name}</h2>
        <label class="session-flow">
          <span class="field-label">default flow</span>
          <select value={props.project.default_flow_id || ""} onChange={(e) => setDefault(e.currentTarget.value)}>
            <option value="">none (global default)</option>
            <For each={props.flows}>{(f) => <option value={f.id}>{f.name}{f.scope === "project" ? " (project)" : ""}</option>}</For>
          </select>
        </label>
      </div>

      <div class="flow-list-bar">
        <span class="field-label">flows</span>
        <For each={props.flows}>{(f) => (
          <span class={`flow-pill ${editingId() === f.id ? "active" : ""}`}>
            <button class="flow-pill-name" onClick={() => setEditingId(f.id)}>{f.name}</button>
            <button class="flow-pill-x" title="delete flow" onClick={() => removeFlow(f.id)}>×</button>
          </span>
        )}</For>
        <button class="flow-chip" onClick={newFlow}>+ new flow</button>
      </div>

      <Show when={editing()} fallback={<p class="muted">Select a flow to edit its node graph, or create a new one.</p>}>
        <FlowEditor graph={editing()!.graph} title={`editing: ${editing()!.name}`} onSave={saveGraph} />
      </Show>
    </div>
  )
}
