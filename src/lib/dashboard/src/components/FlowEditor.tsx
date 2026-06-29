import { createSignal, For, Show } from "solid-js"
import type { FlowGraph, FlowNode } from "../api"

const PALETTE = ["compress", "web-search", "tdd", "vibeultrax", "vibeqmax", "vibemax", "blackbox", "direct", "condition"] as const
const TIERS = ["", "cheap", "medium", "brain"] as const
const SIGNALS = ["needsCompression", "needsWebSearch", "needsTdd", "needsEscalation", "hasResearchSignal", "hasLoopSignal", "hasStressSignal", "hasLongContext"] as const

const NODE_W = 156
const NODE_H = 70

let counter = 0
function uid() { return `n_${Date.now().toString(36)}_${(counter++).toString(36)}` }

function clone(g: FlowGraph): FlowGraph {
  return { nodes: g.nodes.map((n) => ({ ...n })), edges: g.edges.map((e) => ({ ...e })) }
}

// Presets (and hand-authored graphs) may omit x/y; lay those nodes out on a grid
// so they don't stack at the origin.
function withPositions(g: FlowGraph): FlowGraph {
  const c = clone(g && g.nodes ? g : { nodes: [], edges: [] })
  c.nodes = c.nodes.map((n, i) => ({
    ...n,
    x: n.x ?? (30 + (i % 4) * 180),
    y: n.y ?? (30 + Math.floor(i / 4) * 120),
  }))
  return c
}

// Client-side preview of the compiled path: topological order following edges.
function previewOrder(g: FlowGraph): string[] {
  const indeg = new Map(g.nodes.map((n) => [n.id, 0]))
  const adj = new Map(g.nodes.map((n) => [n.id, [] as string[]]))
  for (const e of g.edges) { if (adj.has(e.from) && indeg.has(e.to)) { adj.get(e.from)!.push(e.to); indeg.set(e.to, indeg.get(e.to)! + 1) } }
  const ready = g.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id)
  const order: string[] = []
  while (ready.length) {
    const id = ready.shift()!
    order.push(id)
    for (const nx of adj.get(id) || []) { indeg.set(nx, indeg.get(nx)! - 1); if (indeg.get(nx) === 0) ready.push(nx) }
  }
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  return order.map((id) => byId.get(id)!).filter((n) => n && n.tool !== "condition").map((n) => n.tool)
}

export default function FlowEditor(props: { graph: FlowGraph; onSave: (g: FlowGraph) => void; title?: string }) {
  const [g, setG] = createSignal<FlowGraph>(withPositions(props.graph))
  const [pendingFrom, setPendingFrom] = createSignal<string | null>(null)
  const [drag, setDrag] = createSignal<{ id: string; dx: number; dy: number } | null>(null)
  const [dirty, setDirty] = createSignal(false)

  const update = (fn: (g: FlowGraph) => FlowGraph) => { setG((cur) => fn(clone(cur))); setDirty(true) }

  const addNode = (tool: string) => {
    const count = g().nodes.length
    update((cur) => {
      cur.nodes.push({ id: uid(), tool, x: 30 + (count % 4) * 180, y: 30 + Math.floor(count / 4) * 110 })
      return cur
    })
  }
  const removeNode = (id: string) => update((cur) => {
    cur.nodes = cur.nodes.filter((n) => n.id !== id)
    cur.edges = cur.edges.filter((e) => e.from !== id && e.to !== id)
    return cur
  })
  const setCondition = (id: string, signal: string) => update((cur) => {
    const n = cur.nodes.find((x) => x.id === id); if (n) n.condition = signal ? { signal } : null
    return cur
  })
  const setTier = (id: string, tier: string) => update((cur) => {
    const n = cur.nodes.find((x) => x.id === id); if (n) n.tier = tier || undefined
    return cur
  })

  const onNodeClick = (id: string) => {
    const from = pendingFrom()
    if (from && from !== id) {
      update((cur) => {
        if (!cur.edges.some((e) => e.from === from && e.to === id)) cur.edges.push({ from, to: id })
        return cur
      })
      setPendingFrom(null)
    }
  }

  const center = (n: FlowNode) => ({ x: (n.x ?? 0) + NODE_W / 2, y: (n.y ?? 0) + NODE_H / 2 })

  const onPointerMove = (e: PointerEvent) => {
    const d = drag(); if (!d) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left - d.dx
    const y = e.clientY - rect.top - d.dy
    setG((cur) => {
      const next = clone(cur); const n = next.nodes.find((x2) => x2.id === d.id)
      if (n) { n.x = Math.max(0, x); n.y = Math.max(0, y) }
      return next
    })
  }

  return (
    <div class="flow-editor">
      <div class="flow-toolbar">
        <span class="field-label">{props.title || "Flow graph"}</span>
        <div class="flow-palette">
          <For each={PALETTE}>{(tool) => <button class="flow-chip" onClick={() => addNode(tool)}>+ {tool}</button>}</For>
        </div>
        <button class="flow-save" disabled={!dirty()} onClick={() => { props.onSave(g()); setDirty(false) }}>save flow</button>
      </div>

      <Show when={pendingFrom()}>
        <div class="flow-hint">connecting from a node — click a target node to link, or <button class="linkish" onClick={() => setPendingFrom(null)}>cancel</button></div>
      </Show>

      <div
        class="flow-canvas"
        onPointerMove={onPointerMove}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
      >
        <svg class="flow-edges" width="100%" height="100%">
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L7,3 L0,6 Z" fill="var(--text-dim)" />
            </marker>
          </defs>
          <For each={g().edges}>{(edge) => {
            const a = g().nodes.find((n) => n.id === edge.from); const b = g().nodes.find((n) => n.id === edge.to)
            if (!a || !b) return null
            const p1 = center(a); const p2 = center(b)
            return <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="var(--text-dim)" stroke-width="1.5" marker-end="url(#arrow)" />
          }}</For>
        </svg>

        <For each={g().nodes} fallback={<div class="flow-empty">empty graph — add nodes from the palette above</div>}>
          {(node) => (
            <div
              class={`flow-node tool-${node.tool} ${pendingFrom() === node.id ? "linking" : ""}`}
              style={{ left: `${node.x ?? 0}px`, top: `${node.y ?? 0}px`, width: `${NODE_W}px` }}
              onClick={() => onNodeClick(node.id)}
            >
              <div
                class="flow-node-head"
                onPointerDown={(e) => {
                  const rect = (e.currentTarget.closest(".flow-canvas") as HTMLElement).getBoundingClientRect()
                  setDrag({ id: node.id, dx: e.clientX - rect.left - (node.x ?? 0), dy: e.clientY - rect.top - (node.y ?? 0) })
                }}
              >
                <span class="flow-node-tool">{node.tool}</span>
                <button class="flow-node-x" title="delete" onClick={(e) => { e.stopPropagation(); removeNode(node.id) }}>×</button>
              </div>
              <div class="flow-node-body">
                <Show when={node.tool === "vibeultrax"}>
                  <select class="flow-mini" value={node.tier || ""} onChange={(e) => setTier(node.id, e.currentTarget.value)} onClick={(e) => e.stopPropagation()}>
                    <For each={TIERS}>{(t) => <option value={t}>{t ? `tier:${t}` : "tier:auto"}</option>}</For>
                  </select>
                </Show>
                <select class="flow-mini" value={(node.condition as any)?.signal || ""} onChange={(e) => setCondition(node.id, e.currentTarget.value)} onClick={(e) => e.stopPropagation()}>
                  <option value="">always</option>
                  <For each={SIGNALS}>{(s) => <option value={s}>if {s}</option>}</For>
                </select>
                <button class="flow-mini link" onClick={(e) => { e.stopPropagation(); setPendingFrom(node.id) }}>⊙ connect →</button>
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="flow-preview">
        <span class="field-label">compiled path</span>
        <code>{previewOrder(g()).join(" → ") || "direct"}</code>
      </div>
    </div>
  )
}
