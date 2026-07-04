// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>

import { For, Show } from "solid-js"
import type { OrchProject, OrchSession } from "../api"

function sessionBadge(session: OrchSession, currentSessionId: string | null): string {
  return currentSessionId === session.id ? "current" : ""
}

export default function ProjectSessionsPanel(props: {
  project: OrchProject | null
  sessions: OrchSession[]
  selectedSessionId: string | null
  currentSessionId: string | null
  onSelectSession: (session: OrchSession) => void
}) {
  return (
    <div class="card panel project-sessions-panel">
      <div class="panel-head">
        <div>
          <div class="column-badge-row">
            <span class="column-badge">2</span>
            <h3>Sessions</h3>
          </div>
          <div class="panel-head-copy">selected project sessions only</div>
        </div>
      </div>

      <Show when={props.project} fallback={<p class="muted">Pick a project from column 1 to see its sessions.</p>}>
        <div class="project-session-list">
          <For each={props.sessions} fallback={<p class="muted">No sessions in this project yet.</p>}>
            {(session) => (
              <button
                class={`project-session-link ${props.selectedSessionId === session.id ? "active" : ""} ${sessionBadge(session, props.currentSessionId)}`}
                onClick={() => props.onSelectSession(session)}
              >
                <span class="project-session-link-title">{session.title}</span>
                <span class="project-session-link-meta">
                  {props.currentSessionId === session.id ? "current" : session.id.slice(0, 8)}
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
