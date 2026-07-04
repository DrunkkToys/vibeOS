// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>

import { For, Show } from "solid-js"
import type { DashboardHomePayload, OrchProject, StatusPayload } from "../api"
import { inferProjectIcon } from "../home-model"

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

function projectSwatch(project: OrchProject): string {
  const seed = `${project.name}|${project.fingerprint || project.id}`
  let hash = 0
  for (const ch of seed) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0
  const hue = hash % 360
  return `hsl(${hue} 72% 46%)`
}

export default function Sidebar(props: {
  projects: OrchProject[]
  selection: Selection
  home: DashboardHomePayload | null
  status: StatusPayload | null
  onSelect: (s: Selection) => void
  onNewProject: () => void
}) {
  return (
    <aside class="sidebar">
      <button
        class={`sidebar-icon-button ${isActive(props.selection, { kind: "home" }) ? "active" : ""}`}
        title="Home"
        onClick={() => props.onSelect({ kind: "home" })}
      >
        <span class="sidebar-home-icon" aria-hidden="true">⌂</span>
      </button>

      <Show when={props.home}>
        <button class="sidebar-home-card" title="Open dashboard home" onClick={() => props.onSelect({ kind: "home" })}>
          <span class="sidebar-home-card-kicker">Home</span>
          <span class="sidebar-home-card-title">{props.home?.home.title}</span>
          <span class="sidebar-home-card-copy">{props.home?.home.recommendation || props.home?.home.subtitle}</span>
          <span class="sidebar-home-card-meta">
            <span>{props.status?.backend_connected ? "live" : "degraded"}</span>
            <span>{props.status?.active_slot || "brain"}</span>
            <span>{props.status?.optimization_mode || "auto"}</span>
          </span>
        </button>
      </Show>

      <For each={props.projects} fallback={<></>}>
        {(project) => {
          const icon = inferProjectIcon(project)
          return (
            <button
              class={`sidebar-icon-button ${isActive(props.selection, { kind: "project", projectId: project.id }) ? "active" : ""}`}
              title={project.name}
              onClick={() => props.onSelect({ kind: "project", projectId: project.id })}
            >
              <span
                class="sidebar-project-icon"
                title={icon.label}
                style={`--project-icon-bg:${projectSwatch(project)};--project-icon-fg:#f5f5f5;`}
              >
                {icon.glyph}
              </span>
            </button>
          )
        }}
      </For>

      <button class="sidebar-icon-button sidebar-add-button" title="New project" onClick={props.onNewProject}>+</button>
    </aside>
  )
}
