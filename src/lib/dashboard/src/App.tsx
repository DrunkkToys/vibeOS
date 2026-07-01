import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import {
  createProject,
  createSession,
  deleteProject,
  deleteSession,
  fetchCapabilities,
  fetchDashboardHome,
  fetchSavings,
  fetchStatus,
  listFlows,
  listProjects,
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
import StatusCard from "./components/Status"
import SavingsCard from "./components/Savings"
import SessionsPanel from "./components/Sessions"
import StressGauge from "./components/StressGauge"
import Controls from "./components/Controls"
import ReportsPanel from "./components/Reports"
import BlackboxPanel from "./components/Blackbox"
import WebSearchPanel from "./components/WebSearch"
import Session from "./components/Session"
import ProjectView from "./components/ProjectView"
import { DEFAULT_SELECTION_KIND } from "./home-model"

type Tab = "status" | "controls" | "reports" | "blackbox" | "websearch"

export default function App() {
  const [s, setS] = createSignal<StatusPayload | null>(null)
  const [sv, setSv] = createSignal<SavingsPayload | null>(null)
  const [cap, setCap] = createSignal<CapabilitiesPayload | null>(null)
  const [home, setHome] = createSignal<DashboardHomePayload | null>(null)
  const [tab, setTab] = createSignal<Tab>("status")
  const [conn, setConn] = createSignal(false)

  const [selection, setSelection] = createSignal<Selection>({ kind: DEFAULT_SELECTION_KIND })
  const [projects, setProjects] = createSignal<OrchProject[]>([])
  const [sessionsByProject, setSessionsByProject] = createSignal<Record<string, OrchSession[]>>({})
  const [flows, setFlows] = createSignal<OrchFlow[]>([])
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})
  const [creatingProject, setCreatingProject] = createSignal(false)
  const [creatingSessionFor, setCreatingSessionFor] = createSignal<string | null>(null)

  const refreshStatus = () => fetchStatus().then(setS).catch(() => {})
  const refreshSavings = () => fetchSavings().then(setSv).catch(() => {})
  const refreshCapabilities = () => fetchCapabilities().then(setCap).catch(() => {})
  const refreshHome = () => fetchDashboardHome().then(setHome).catch(() => {})
  const refreshProjects = () => listProjects().then((r) => setProjects(r.projects)).catch(() => {})
  const refreshFlows = () => listFlows().then((r) => setFlows(r.flows)).catch(() => {})
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
  refreshFlows()
  refreshSessions()
  refreshHome()
  onCleanup(cl)

  createEffect(() => {
    if (tab() === "websearch" && !cap()?.web_search?.enabled) setTab("status")
  })

  const newProject = () => setCreatingProject(true)

  const newSession = (projectId: string) => setCreatingSessionFor(projectId)

  const submitNewProject = async (name: string) => {
    setCreatingProject(false)
    const res = await createProject(name)
    await refreshProjects()
    await refreshHome()
    setExpanded((e) => ({ ...e, [res.project.id]: true }))
    setSelection({ kind: "project", projectId: res.project.id })
  }

  const submitNewSession = async (projectId: string, title: string) => {
    setCreatingSessionFor(null)
    const res = await createSession(projectId, title || "New session")
    await refreshSessions()
    await refreshHome()
    setExpanded((e) => ({ ...e, [projectId]: true }))
    setSelection({ kind: "session", projectId, sessionId: res.session.id })
  }

  const cancelCreate = () => { setCreatingProject(false); setCreatingSessionFor(null) }

  const removeProject = async (id: string) => {
    if (!confirm("Delete this project and all its sessions?")) return
    await deleteProject(id)
    await refreshProjects()
    await refreshSessions()
    await refreshHome()
    if ((selection() as { kind: string; projectId?: string }).projectId === id) setSelection({ kind: "home" })
  }

  const removeSession = async (id: string) => {
    await deleteSession(id)
    await refreshSessions()
    await refreshHome()
    if ((selection() as { kind: string; sessionId?: string }).sessionId === id) setSelection({ kind: "home" })
  }

  const toggle = (projectId: string) => setExpanded((e) => ({ ...e, [projectId]: !e[projectId] }))

  const onSessionChange = (sess: OrchSession) => {
    setSessionsByProject((m) => {
      const list = (m[sess.project_id] || []).map((x) => (x.id === sess.id ? sess : x))
      return { ...m, [sess.project_id]: list }
    })
    void refreshHome()
  }

  const onProjectChange = (p: OrchProject) => {
    setProjects((list) => list.map((x) => (x.id === p.id ? p : x)))
    void refreshHome()
  }

  const activeSession = () => {
    const sel = selection()
    if (sel.kind !== "session") return null
    return (sessionsByProject()[sel.projectId] || []).find((x) => x.id === sel.sessionId) || null
  }

  const activeProject = () => {
    const sel = selection()
    const pid = sel.kind === "project" ? sel.projectId : sel.kind === "session" ? sel.projectId : null
    return pid ? projects().find((x) => x.id === pid) || null : null
  }

  const currentProject = () => {
    const fingerprint = home()?.current_session?.project_fingerprint || s()?.current_project_fingerprint || ""
    const name = home()?.current_session?.project_name || s()?.current_project_name || ""
    return projects().find((project) => project.fingerprint && project.fingerprint === fingerprint)
      || projects().find((project) => project.name === name)
      || null
  }

  const currentSession = () => {
    const sessionId = home()?.current_session?.session_id || ""
    if (!sessionId) return null
    for (const list of Object.values(sessionsByProject())) {
      const match = list.find((session) => session.id === sessionId)
      if (match) return match
    }
    return null
  }

  const projectFlows = (projectId: string) => flows().filter((f) => f.scope === "global" || f.project_id === projectId)
  const homeFlows = () => projectFlows(currentProject()?.id || currentSession()?.project_id || "")

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

  const tabs = () => [
    { key: "status", label: "Status" },
    { key: "controls", label: "Controls" },
    { key: "reports", label: "Reports" },
    { key: "blackbox", label: "Blackbox" },
    { key: "websearch", label: "Web Search", visible: Boolean(cap()?.web_search?.enabled) },
  ]
  const visibleTabs = () => tabs().filter((t) => t.visible !== false)

  const headerTitle = () => {
    const sel = selection()
    if (sel.kind === "project") return activeProject()?.name || "Project"
    if (sel.kind === "session") return activeSession()?.title || "Session"
    if (sel.kind === "status") return "Dashboard Overview"
    return "Home"
  }

  const headerSubtitle = () => {
    const project = currentProject()
    const session = currentSession()
    if (project && session) return `${project.name} · ${session.title}`
    if (project) return project.name
    return home()?.current_session?.project_name || s()?.current_project_name || "OpenCode shell"
  }

  const openCurrentProject = () => {
    const project = currentProject()
    if (project) setSelection({ kind: "project", projectId: project.id })
  }

  const openCurrentSession = () => {
    const session = currentSession()
    if (session) setSelection({ kind: "session", projectId: session.project_id, sessionId: session.id })
  }

  return (
    <div class="shell">
      <Sidebar
        projects={projects()}
        sessionsByProject={sessionsByProject()}
        expanded={expanded()}
        selection={selection()}
        currentProjectId={currentProject()?.id || null}
        currentProjectName={home()?.current_session?.project_name || s()?.current_project_name || null}
        currentSessionId={home()?.current_session?.session_id || null}
        creatingProject={creatingProject()}
        creatingSessionFor={creatingSessionFor()}
        onSelect={setSelection}
        onToggle={toggle}
        onNewProject={newProject}
        onNewSession={newSession}
        onCreateProjectName={submitNewProject}
        onCreateSessionName={submitNewSession}
        onCancelCreate={cancelCreate}
        onDeleteProject={removeProject}
        onDeleteSession={removeSession}
      />

      <div class="main">
        <header class="header">
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
            {cap()?.web_search?.enabled && <span class="indicator connected">WEB SEARCH</span>}
            {s()?.enabled === false && <span class="indicator disabled">OFF</span>}
          </div>
        </header>

        <Show when={selection().kind === "home"}>
          <main class="content">
            <Home
              data={home()}
              status={s()}
              project={currentProject()}
              session={currentSession()}
              flows={homeFlows()}
              onOpenStatus={() => setSelection({ kind: "status" })}
              onOpenProject={openCurrentProject}
              onOpenSession={openCurrentSession}
              onTrinityAction={() => { refreshStatus(); refreshSavings(); refreshHome() }}
            />
          </main>
        </Show>

        <Show when={selection().kind === "status"}>
          <nav class="nav-tabs">
            <For each={visibleTabs()}>{(t) => (
              <button class={`tab ${tab() === t.key ? "active" : ""}`} onClick={() => setTab(t.key as Tab)}>{t.label}</button>
            )}</For>
          </nav>
          <main class="content">
            {tab() === "status" && (
              <div class="grid-2col">
                <StatusCard status={s()} />
                <SavingsCard savings={sv()} />
                <StressGauge status={s()} />
                <SessionsPanel />
              </div>
            )}
            {tab() === "controls" && <Controls status={s()} onAction={() => { refreshStatus(); refreshSavings(); refreshHome() }} />}
            {tab() === "reports" && <ReportsPanel />}
            {tab() === "blackbox" && <BlackboxPanel />}
            {tab() === "websearch" && <WebSearchPanel />}
          </main>
        </Show>

        <Show when={selection().kind === "project" && activeProject()}>
          <main class="content">
            <ProjectView
              project={activeProject()!}
              flows={projectFlows(activeProject()!.id)}
              onProjectChange={onProjectChange}
              onFlowsChange={() => { refreshFlows(); refreshHome() }}
            />
          </main>
        </Show>

        <Show when={selection().kind === "session" && activeSession()}>
          <main class="content">
            <Session
              session={activeSession()!}
              flows={projectFlows(activeSession()!.project_id)}
              onSessionChange={onSessionChange}
            />
          </main>
        </Show>
      </div>
    </div>
  )
}
