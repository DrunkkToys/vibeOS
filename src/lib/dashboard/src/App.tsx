import { createEffect, createSignal, onCleanup, For, Show } from "solid-js"
import { openSSE, fetchStatus, fetchSavings, fetchCapabilities, listProjects, listSessions, listFlows, createProject, createSession, type StatusPayload, type SavingsPayload, type CapabilitiesPayload, type OrchProject, type OrchSession, type OrchFlow } from "./api"
import StatusCard from "./components/Status"
import SavingsCard from "./components/Savings"
import SessionsPanel from "./components/Sessions"
import StressGauge from "./components/StressGauge"
import Controls from "./components/Controls"
import ReportsPanel from "./components/Reports"
import BlackboxPanel from "./components/Blackbox"
import WebSearchPanel from "./components/WebSearch"
import Sidebar, { type Selection } from "./components/Sidebar"
import Session from "./components/Session"
import ProjectView from "./components/ProjectView"

type Tab = "status" | "controls" | "reports" | "blackbox" | "websearch"

export default function App() {
  const [s, setS] = createSignal<StatusPayload | null>(null)
  const [sv, setSv] = createSignal<SavingsPayload | null>(null)
  const [cap, setCap] = createSignal<CapabilitiesPayload | null>(null)
  const [tab, setTab] = createSignal<Tab>("status")
  const [conn, setConn] = createSignal(false)

  const [selection, setSelection] = createSignal<Selection>({ kind: "dashboard" })
  const [projects, setProjects] = createSignal<OrchProject[]>([])
  const [sessionsByProject, setSessionsByProject] = createSignal<Record<string, OrchSession[]>>({})
  const [flows, setFlows] = createSignal<OrchFlow[]>([])
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})

  const cl = openSSE((d: { status: StatusPayload; savings: SavingsPayload }) => {
    setS(d.status); setSv(d.savings); setConn(true)
  })
  fetchStatus().then(setS).catch(() => {})
  fetchSavings().then(setSv).catch(() => {})
  fetchCapabilities().then(setCap).catch(() => {})
  onCleanup(cl)

  const refreshProjects = () => listProjects().then((r) => setProjects(r.projects)).catch(() => {})
  const refreshFlows = () => listFlows().then((r) => setFlows(r.flows)).catch(() => {})
  const refreshSessions = () => listSessions().then((r) => {
    const grouped: Record<string, OrchSession[]> = {}
    for (const sess of r.sessions) (grouped[sess.project_id] ||= []).push(sess)
    setSessionsByProject(grouped)
  }).catch(() => {})
  refreshProjects(); refreshFlows(); refreshSessions()

  createEffect(() => {
    if (tab() === "websearch" && !cap()?.web_search?.enabled) setTab("status")
  })

  const newProject = async () => {
    const name = window.prompt("Project name?")?.trim()
    if (!name) return
    const res = await createProject(name)
    await refreshProjects()
    setExpanded((e) => ({ ...e, [res.project.id]: true }))
    setSelection({ kind: "project", projectId: res.project.id })
  }
  const newSession = async (projectId: string) => {
    const title = window.prompt("Session title?", "New session")?.trim()
    if (title === undefined) return
    const res = await createSession(projectId, title || "New session")
    await refreshSessions()
    setExpanded((e) => ({ ...e, [projectId]: true }))
    setSelection({ kind: "session", projectId, sessionId: res.session.id })
  }
  const toggle = (projectId: string) => setExpanded((e) => ({ ...e, [projectId]: !e[projectId] }))

  const onSessionChange = (sess: OrchSession) => setSessionsByProject((m) => {
    const list = (m[sess.project_id] || []).map((x) => (x.id === sess.id ? sess : x))
    return { ...m, [sess.project_id]: list }
  })
  const onProjectChange = (p: OrchProject) => setProjects((list) => list.map((x) => (x.id === p.id ? p : x)))

  const activeSession = () => {
    const sel = selection(); if (sel.kind !== "session") return null
    return (sessionsByProject()[sel.projectId] || []).find((x) => x.id === sel.sessionId) || null
  }
  const activeProject = () => {
    const sel = selection()
    const pid = sel.kind === "project" ? sel.projectId : sel.kind === "session" ? sel.projectId : null
    return pid ? projects().find((x) => x.id === pid) || null : null
  }
  const projectFlows = (projectId: string) => flows().filter((f) => f.scope === "global" || f.project_id === projectId)

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

  return (
    <div class="shell">
      <Sidebar
        projects={projects()}
        sessionsByProject={sessionsByProject()}
        expanded={expanded()}
        selection={selection()}
        onSelect={setSelection}
        onToggle={toggle}
        onNewProject={newProject}
        onNewSession={newSession}
      />

      <div class="main">
        <header class="header">
          <div class="header-title">
            <h1>vibeOS</h1>
            <span class="version">{s()?.version ?? "..."}</span>
          </div>
          <div class="header-indicators">
            <span class={`indicator ${conn() ? "connected" : "disconnected"}`}>{conn() ? "LIVE" : "connecting"}</span>
            <span class={`indicator flash ${backendIndicator().tone}`} title={backendIndicator().title}>{backendIndicator().label}</span>
            {cap()?.web_search?.enabled && <span class="indicator connected">WEB SEARCH</span>}
            {s()?.enabled === false && <span class="indicator disabled">OFF</span>}
          </div>
        </header>

        <Show when={selection().kind === "dashboard"}>
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
            {tab() === "controls" && <Controls status={s()} onAction={() => { fetchStatus().then(setS); fetchSavings().then(setSv) }} />}
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
              onFlowsChange={refreshFlows}
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
