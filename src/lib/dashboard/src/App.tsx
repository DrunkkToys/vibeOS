import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import {
  createProject,
  fetchCapabilities,
  fetchDashboardHome,
  fetchSavings,
  fetchStatus,
  listProjects,
  listFlows,
  listSessions,
  openSSE,
  type CapabilitiesPayload,
  type DashboardHomePayload,
  type OrchFlow,
  type OrchProject,
  type OrchSession,
  type SavingsPayload,
  type StatusPayload,
} from "./api"
import Sidebar, { type Selection } from "./components/Sidebar"
import Home from "./components/Home"
import Session from "./components/Session"
import ProjectSessionsPanel from "./components/ProjectSessions"
import ControlRail from "./components/ControlRail"
import { DEFAULT_SELECTION_KIND } from "./home-model"

export default function App() {
  const [s, setS] = createSignal<StatusPayload | null>(null)
  const [sv, setSv] = createSignal<SavingsPayload | null>(null)
  const [cap, setCap] = createSignal<CapabilitiesPayload | null>(null)
  const [home, setHome] = createSignal<DashboardHomePayload | null>(null)
  const [conn, setConn] = createSignal(false)

  const [selection, setSelection] = createSignal<Selection>({ kind: DEFAULT_SELECTION_KIND })
  const [projects, setProjects] = createSignal<OrchProject[]>([])
  const [flows, setFlows] = createSignal<OrchFlow[]>([])
  const [sessionsByProject, setSessionsByProject] = createSignal<Record<string, OrchSession[]>>({})
  const [runRequest, setRunRequest] = createSignal<{ sessionId: string; prompt: string } | null>(null)

  const refreshStatus = () => fetchStatus().then((value) => { setS(value); setConn(true) }).catch(() => setConn(false))
  const refreshSavings = () => fetchSavings().then((value) => { setSv(value); setConn(true) }).catch(() => setConn(false))
  const refreshCapabilities = () => fetchCapabilities().then(setCap).catch(() => {})
  const refreshHome = () => fetchDashboardHome().then(setHome).catch(() => {})
  const refreshProjects = () => listProjects().then((r) => setProjects(r.projects)).catch(() => {})
  const refreshFlows = (projectId?: string | null) => listFlows(projectId || undefined).then((r) => setFlows(r.flows)).catch(() => {})
  const refreshSessions = () => listSessions().then((r) => {
    const grouped: Record<string, OrchSession[]> = {}
    for (const sess of r.sessions) (grouped[sess.project_id] ||= []).push(sess)
    setSessionsByProject(grouped)
  }).catch(() => {})

  const cl = openSSE((d: { status: StatusPayload; savings: SavingsPayload }) => {
    setS(d.status)
    setSv(d.savings)
    setConn(true)
  })
  refreshStatus()
  refreshSavings()
  refreshCapabilities()
  refreshProjects()
  refreshSessions()
  refreshHome()
  onCleanup(cl)

  const createProjectFromPrompt = async () => {
    const name = window.prompt("Project name")
    if (!name || !name.trim()) return
    const res = await createProject(name.trim())
    await refreshProjects()
    await refreshHome()
    setSelection({ kind: "project", projectId: res.project.id })
  }

  const selectedProject = () => {
    const sel = selection()
    if (sel.kind === "project" || sel.kind === "session") {
      return projects().find((x) => x.id === sel.projectId) || null
    }
    const fingerprint = home()?.current_session?.project_fingerprint || s()?.current_project_fingerprint || ""
    const name = home()?.current_session?.project_name || s()?.current_project_name || ""
    return projects().find((project) => project.fingerprint && project.fingerprint === fingerprint)
      || projects().find((project) => project.name === name)
      || null
  }

  const selectedProjectSessions = () => {
    const project = selectedProject()
    return project ? (sessionsByProject()[project.id] || []) : []
  }

  const selectedSession = () => {
    const sel = selection()
    if (sel.kind === "session") {
      return (sessionsByProject()[sel.projectId] || []).find((x) => x.id === sel.sessionId) || null
    }
    const currentSessionId = home()?.current_session?.session_id || ""
    if (!currentSessionId) return null
    const project = selectedProject()
    if (!project) return null
    const current = (sessionsByProject()[project.id] || []).find((x) => x.id === currentSessionId) || null
    return current && current.project_id === project.id ? current : null
  }

  createEffect(() => {
    const project = selectedProject()
    void refreshFlows(project?.id || null)
  })

  const backendIndicator = () => {
    const status = s()
    if (!status) return { label: "API OFF", tone: "disconnected", title: "backend status unavailable" }
    const connected = status.backend_connected ?? status.backendConnected
    const target = status.backend_api_url || status.backend_health_url || "unknown target"
    const checkedAt = status.backend_health_checked_at ? new Date(status.backend_health_checked_at).toLocaleTimeString() : null
    if (connected) {
      const age = typeof status.backend_health_age_ms === "number" ? ` ${Math.max(0, Math.round(status.backend_health_age_ms / 1000))}s` : ""
      const latency = typeof status.backend_health_latency_ms === "number" ? ` ${status.backend_health_latency_ms}ms` : ""
      return { label: `⚡ BACKEND${age}`, tone: "connected", title: `${target}${latency}${checkedAt ? ` · checked ${checkedAt}` : ""}` }
    }
    const reason = status.backend_health_error || (typeof status.backend_health_status === "number" ? `HTTP ${status.backend_health_status}` : "unreachable")
    return { label: "API OFF", tone: "disconnected", title: `${target} · ${reason}${checkedAt ? ` · checked ${checkedAt}` : ""}` }
  }

  const requestSessionRun = (prompt: string) => {
    const session = selectedSession()
    if (!session) return
    setRunRequest({ sessionId: session.id, prompt })
  }

  const openFirstProject = () => {
    const project = selectedProject() || projects()[0] || null
    if (project) setSelection({ kind: "project", projectId: project.id })
  }

  const openCurrentSession = () => {
    const session = selectedSession() || null
    if (session) setSelection({ kind: "session", projectId: session.project_id, sessionId: session.id })
  }

  const refreshAll = () => {
    refreshStatus()
    refreshSavings()
    refreshHome()
    refreshProjects()
    refreshSessions()
    void refreshFlows(selectedProject()?.id || null)
  }

  const isHomeView = () => selection().kind === "home" || selection().kind === "status"
  const headerTitle = () => {
    if (selection().kind === "status") return "Status"
    if (selection().kind === "home") return "Dashboard"
    return selectedProject()?.name || home()?.current_session?.project_name || "Home"
  }
  const headerSubtitle = () => {
    if (selection().kind === "home") return home()?.home?.title || home()?.home?.subtitle || "Operational dashboard overview"
    if (selection().kind === "status") return home()?.home?.subtitle || "Runtime status"
    return selectedSession()?.title || home()?.home?.subtitle || "OpenCode-style operational dashboard"
  }

  return (
    <div class="shell shell-4col">
      <Sidebar
        projects={projects()}
        selection={selection()}
        home={home()}
        status={s()}
        onSelect={setSelection}
        onNewProject={createProjectFromPrompt}
      />

      <main class="workspace">
        <header class="header workspace-header">
          <div class="header-title">
            <div>
              <h1>{headerTitle()}</h1>
              <div class="header-subtitle">{headerSubtitle()}</div>
            </div>
            <span class="version">{s()?.version ?? "..."}</span>
          </div>
          <div class="header-indicators">
            <span class={`indicator ${conn() ? "connected" : "disconnected"}`}>{conn() ? "LIVE" : "connecting"}</span>
            <span class={`indicator flash ${backendIndicator().tone}`} title={backendIndicator().title}>{backendIndicator().label}</span>
            <span class={`indicator ${(s()?.backend_connected ?? s()?.backendConnected) ? "connected" : "disconnected"}`}>{(s()?.backend_connected ?? s()?.backendConnected) ? "API LIVE" : "API DEGRADED"}</span>
            <span class={`indicator ${s()?.enabled === false ? "disabled" : "connected"}`}>{s()?.enabled === false ? "OFF" : "ON"}</span>
          </div>
        </header>

        <Show
          when={isHomeView()}
          fallback={
            <section class="workspace-grid">
              <div class="workspace-column workspace-column-sessions">
                <ProjectSessionsPanel
                  project={selectedProject()}
                  sessions={selectedProjectSessions()}
                  selectedSessionId={selectedSession()?.id || null}
                  currentSessionId={home()?.current_session?.session_id || null}
                  onSelectSession={(session) => setSelection({ kind: "session", projectId: session.project_id, sessionId: session.id })}
                />
              </div>

              <div class="workspace-column workspace-column-chat">
                <Session
                  session={selectedSession()}
                  project={selectedProject()}
                  status={s()}
                  capabilities={cap()}
                  savings={sv()}
                  runRequest={runRequest()}
                  onRunRequestHandled={() => setRunRequest(null)}
                  onRefresh={refreshAll}
                />
              </div>

              <div class="workspace-column workspace-column-controls">
                <ControlRail
                  status={s()}
                  capabilities={cap()}
                  home={home()}
                  savings={sv()}
                  session={selectedSession()}
                  currentProject={selectedProject()}
                  onRefresh={refreshAll}
                  onCreatePlan={() => requestSessionRun("Create a concise structured plan for this session. Show the plan before execution, keep it deterministic, and include TDD steps if they are required.")}
                  onStartTdd={() => requestSessionRun("Start TDD for this session. Produce failing tests first, then implement the minimum fix, then verify the result.")}
                />
              </div>
            </section>
          }
        >
          <section class="home-shell">
            <Home
              data={home()}
              status={s()}
              project={selectedProject()}
              session={selectedSession()}
              flows={flows()}
              onOpenStatus={() => setSelection({ kind: "status" })}
              onOpenProject={openFirstProject}
              onOpenSession={openCurrentSession}
              onTrinityAction={refreshAll}
            />
          </section>
        </Show>
      </main>
    </div>
  )
}
