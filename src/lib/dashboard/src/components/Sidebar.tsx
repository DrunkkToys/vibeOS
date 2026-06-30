import { For, Show } from "solid-js"
import type { OrchProject, OrchSession } from "../api"
import { activeContextLabel, inferProjectIcon } from "../home-model"

export type Selection =
  | { kind: "home" }
  | { kind: "status" }
  | { kind: "project"; projectId: string }
  | { kind: "session"; projectId: string; sessionId: string }

function isActive(sel: Selection, target: Selection): boolean {
  if (sel.kind !== target.kind) return false
  if (sel.kind === "home" || sel.kind === "status") return true
  if (sel.kind === "project" && target.kind === "project") return sel.projectId === target.projectId
  if (sel.kind === "session" && target.kind === "session") return sel.sessionId === target.sessionId
  return false
}

export default function Sidebar(props: {
  projects: OrchProject[]
  sessionsByProject: Record<string, OrchSession[]>
  expanded: Record<string, boolean>
  selection: Selection
  currentProjectId?: string | null
  currentProjectName?: string | null
  currentSessionId?: string | null
  onSelect: (s: Selection) => void
  onToggle: (projectId: string) => void
  onNewProject: () => void
  onNewSession: (projectId: string) => void
}) {
  return (
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="sidebar-brand-mark">~</div>
        <div>
          <div class="sidebar-brand-title">opencode</div>
          <div class="sidebar-brand-subtitle">dashboard home</div>
        </div>
      </div>

      <button
        class={`sidebar-item pinned ${isActive(props.selection, { kind: "home" }) ? "active" : ""}`}
        onClick={() => props.onSelect({ kind: "home" })}
      >
        <span class="sidebar-icon">⌂</span> Home
      </button>

      <button
        class={`sidebar-item pinned ${isActive(props.selection, { kind: "status" }) ? "active" : ""}`}
        onClick={() => props.onSelect({ kind: "status" })}
      >
        <span class="sidebar-icon">≡</span> Overview
      </button>

      <div class="sidebar-context-card">
        <div class="sidebar-section-label">active context</div>
        <div class="sidebar-context-main">{activeContextLabel({ currentProjectName: props.currentProjectName, currentSessionId: props.currentSessionId })}</div>
        <Show when={props.currentProjectId}>
          <button class="sidebar-inline-link" onClick={() => props.onSelect({ kind: "project", projectId: props.currentProjectId! })}>
            open project
          </button>
        </Show>
        <Show when={props.currentProjectId && props.currentSessionId}>
          <button class="sidebar-inline-link" onClick={() => props.onSelect({ kind: "session", projectId: props.currentProjectId!, sessionId: props.currentSessionId! })}>
            open session
          </button>
        </Show>
      </div>

      <div class="sidebar-section-head">
        <span class="sidebar-section-label">projects</span>
        <button class="sidebar-add" title="New project" onClick={props.onNewProject}>+</button>
      </div>

      <For each={props.projects} fallback={<div class="sidebar-empty">no projects yet</div>}>
        {(project) => (
          <div class="sidebar-project">
            <div class="sidebar-project-row">
              {(() => {
                const icon = inferProjectIcon(project)
                return <span class="sidebar-project-icon" title={icon.label}>{icon.glyph}</span>
              })()}
              <button
                class={`sidebar-item ${isActive(props.selection, { kind: "project", projectId: project.id }) ? "active" : ""}`}
                onClick={() => { props.onToggle(project.id); props.onSelect({ kind: "project", projectId: project.id }) }}
              >
                <span class="sidebar-caret">{props.expanded[project.id] ? "▾" : "▸"}</span> {project.name}
              </button>
              <button class="sidebar-add" title="New session" onClick={() => props.onNewSession(project.id)}>+</button>
            </div>
            <Show when={props.expanded[project.id]}>
              <div class="sidebar-sessions">
                <For each={props.sessionsByProject[project.id] || []} fallback={<div class="sidebar-empty sub">no sessions</div>}>
                  {(session) => (
                    <button
                      class={`sidebar-item session ${isActive(props.selection, { kind: "session", projectId: project.id, sessionId: session.id }) ? "active" : ""}`}
                      onClick={() => props.onSelect({ kind: "session", projectId: project.id, sessionId: session.id })}
                    >
                      <span class="sidebar-icon">›</span> {session.title}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        )}
      </For>
    </aside>
  )
}
