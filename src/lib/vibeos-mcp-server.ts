// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>

import http from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { parse as parseUrl } from "node:url"
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { extname, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { flushDashboardMutationQueue, getDashboardBridgeBacklogCount, getDashboardBridgeProjection, primeDashboardBridgeCache, queueDashboardProjectionRefresh } from "./dashboard-bridge.js"
import { resolveApiToken, ensureBootstrapExchange } from "./api-client.js"
import { getLatestSessionHealthSnapshot, getSessionHealthSnapshot } from "./session-health.js"
import { applySessionAction, buildDashboardHomeModel, buildSessionDetail, compareSessionOrchestrations, exportSessionOrchestration, importSessionOrchestration, normalizeSessionOrchestration, TEMPLATE_LIBRARY } from "./session-orchestrator.js"
import { getSessionDelegationSavings } from "./session-savings.js"
import { readProjects, writeProjects, readSessions, writeSessions, readFlows, writeFlows, newId, nowIso, type FlowNode, type FlowEdge } from "./orch-store.js"

const MIME_MAP: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
}

type Deps = {
  getState: () => unknown
  getSavings: () => unknown
  getTodos: () => unknown
  getSessionMetrics: (sessionId: string) => unknown
  getCurrentSessionId: () => string
  getBlackboxState: () => unknown
  getSessionOrchestration?: (sessionId: string) => unknown
  mutateSessionOrchestration?: (sessionId: string, mutator: (session: any) => any) => unknown
  listSessionTemplates?: () => unknown
  listReports: (params: { type?: string; project?: string; hours?: number; fingerprint?: string }) => unknown
  readReport: (id: string) => unknown
  runDiagnose: () => unknown
  runProject: () => unknown
  runTrinity: (action: string, opts: { slot?: string; level?: string; token?: string }) => Promise<unknown>
  runResearchAudit: (hours: number) => unknown
  saveReport: (params: { type: string; summary: string; findings: unknown[]; metrics: Record<string, unknown>; narrative: string; tags: unknown[] }) => string | null
  generateSessionCheckout: () => unknown
  saveBlackboxVector: (vector: unknown) => void
  saveBlackboxOutcome: (outcome: unknown) => void
  currentProjectName?: string
  currentProjectFingerprint?: string
}

type McpServer = {
  start: (port: number) => Promise<http.Server>
  close: () => Promise<void>
}

function json(res: ServerResponse, statusCode: number, data: unknown): void {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
  res.statusCode = statusCode
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(data))
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ""
    req.on("data", (chunk: Buffer) => {
      raw += String(chunk || "")
      if (raw.length > 1024 * 1024) {
        reject(new Error("payload too large"))
      }
    })
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error("invalid request"))
      }
    })
    req.on("error", reject)
  })
}

const _MCP_FILENAME = fileURLToPath(import.meta.url)
const _MCP_DIR = dirname(_MCP_FILENAME)

function resolveDashboardDir(): string {
  const repoRoot = join(_MCP_DIR, "..", "..")
  const cwd = process.cwd()
  const c = [
    join(_MCP_DIR, "dashboard", "dist"),
    join(_MCP_DIR, "assets", "dashboard"),
    join(_MCP_DIR, "assets", "dashboard", "dist"),
    join(repoRoot, "src", "lib", "dashboard", "dist"),
    join(cwd, "src", "lib", "dashboard", "dist"),
    join(cwd, "dist-ts", "lib", "dashboard", "dist"),
  ]
  for (const p of c) {
    if (existsSync(join(p, "index.html"))) return p
  }
  return c[0]
}

const DASHBOARD_DIR = resolveDashboardDir()
const DASHBOARD_CONFIG_PATH = join(DASHBOARD_DIR, "vibeos-dashboard-config.js")

export function writeDashboardBaseConfig(baseUrl: string): string | null {
  try {
    if (!baseUrl) return null
    mkdirSync(DASHBOARD_DIR, { recursive: true })
    const b = JSON.stringify(baseUrl.replace(/\/$/, ""))
    const payload = `window.__VIBEOS_DASHBOARD_BASE__ = ${b};\nwindow.__VIBEOS_BACKEND_API_BASE__ = ${b};\n`
    writeFileSync(DASHBOARD_CONFIG_PATH, payload, "utf-8")
    return DASHBOARD_CONFIG_PATH
  } catch {
    return null
  }
}

function resolveBackendHealthUrl(): string {
  const explicit = process.env.VIBEOS_BACKEND_HEALTH_URL?.trim()
  if (explicit) return explicit
  const apiBase = process.env.VIBEOS_API_URL?.trim()
  if (apiBase) {
    try {
      return new URL("health", apiBase.endsWith("/") ? apiBase : `${apiBase}/`).href
    } catch {}
  }
  return "https://api.vibetheog.com/health"
}

function resolveBackendApiBase(): string {
  const explicit = process.env.VIBEOS_API_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, "")
  try {
    const healthUrl = new URL(BACKEND_HEALTH_URL)
    return new URL("./", healthUrl.href).href.replace(/\/$/, "")
  } catch {
    return "https://api.vibetheog.com"
  }
}

const BACKEND_HEALTH_URL = resolveBackendHealthUrl()
const BACKEND_HEALTH_TTL_MS = 5_000

function buildCapabilityFallback(backendStatus = 0): Record<string, unknown> {
  return {
    error: "backend capabilities unavailable",
    code: "BACKEND_UNAVAILABLE",
    web_search: {
      enabled: false,
      provider: "duckduckgo",
      fixture_mode: false,
      benchmark_path: null,
      backend_status: backendStatus,
    },
  }
}

async function proxyBackendJson(path: string, options: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: unknown }> {
  const base = resolveBackendApiBase()
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`).href
  const token = resolveApiToken()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Requested-With": "vibeOS-dashboard",
  }
  if (token) headers.Authorization = "Bearer " + token
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  let data: unknown = text
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = text
  }
  return { status: response.status, data }
}

// Forwards an orchestrator run to the real backend and streams its SSE
// response straight through to the client, so the backend's compression /
// web-search / TDD / VibeUltraX plan steps and the computed control_vector
// directives actually reach the caller instead of the single fixed
// "direct" step this local server used to synthesize on its own.
//
// Returns the parsed `done` event payload once the backend stream ends, or
// `null` if nothing was written to `res` yet (no token, network failure,
// non-2xx status, no body) so the caller can fall back to a local response.
// Once streaming to `res` has started this never returns null, since the
// caller can no longer send a fresh response.
//
// Deliberately leaves `res` open (does not call res.end()) once the stream
// completes successfully: the caller must persist the local session-store
// mirror first, write before signal, so a client can never observe the
// connection closing before the session record it describes is durable.
async function forwardOrchestratorRun(
  sessionId: string,
  body: Record<string, unknown>,
  res: http.ServerResponse
): Promise<{ summary?: string; plan?: unknown; results?: unknown } | null> {
  let token = resolveApiToken()
  if (!token) {
    // No session token on disk yet (fresh install, first run). The plugin
    // ships with an embedded bootstrap token specifically so this never
    // requires manual setup — exchange it for a real session token before
    // falling back to the single-step local response.
    try {
      const exchanged = await ensureBootstrapExchange()
      if (exchanged) token = resolveApiToken()
    } catch {}
  }
  if (!token) return null

  const base = resolveBackendApiBase()
  let backendRes: Awaited<ReturnType<typeof fetch>>
  try {
    const url = new URL(`api/v1/orchestrator/sessions/${encodeURIComponent(sessionId)}/run`, base.endsWith("/") ? base : `${base}/`).href
    backendRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "X-Requested-With": "vibeOS-dashboard",
      },
      body: JSON.stringify(body),
    })
  } catch {
    return null
  }
  if (!backendRes.ok || !backendRes.body) return null

  writeSseHeaders(res)

  const reader = backendRes.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let donePayload: { summary?: string; plan?: unknown; results?: unknown } | null = null
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      buffer += chunk
      res.write(chunk)
      let sepIdx: number
      while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx)
        buffer = buffer.slice(sepIdx + 2)
        const lines = rawEvent.split("\n")
        const eventLine = lines.find((l) => l.startsWith("event:"))
        const dataLine = lines.find((l) => l.startsWith("data:"))
        if (eventLine?.slice(6).trim() === "done" && dataLine) {
          try { donePayload = JSON.parse(dataLine.slice(5).trim()) } catch {}
        }
      }
    }
  } catch {
    // The read loop broke mid-stream after headers were already flushed to
    // the client — there is no way to fall back to a fresh response at this
    // point, so end the connection here directly. The caller checks
    // `res.writableEnded` and skips its local session-store mirror + its
    // own res.end() call when this happened.
    if (!res.writableEnded) res.end()
    return donePayload || { summary: undefined, plan: null, results: [] }
  }
  return donePayload || { summary: undefined, plan: null, results: [] }
}

function writeSseHeaders(res: http.ServerResponse): void {
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.statusCode = 200
}

// Appends a user turn + assistant turn to the local session-store mirror.
// Shared by both the backend-forwarded run and the local-fallback run so the
// dashboard's session list reflects whichever path actually served the
// request, in the same shape either way.
async function appendRunMessages(
  sessionId: string,
  prompt: string,
  assistantMsg: { content: string; plan: unknown; results: { step: { tool: string; label: string; condition: null }; skipped: boolean; result?: unknown }[] }
): Promise<void> {
  const sessions = await readSessions()
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx === -1) return
  const userMsg = { id: newId("msg"), role: "user" as const, content: prompt, plan: null, results: null, created_at: nowIso() }
  sessions[idx] = {
    ...sessions[idx],
    messages: [
      ...sessions[idx].messages,
      userMsg,
      { id: newId("msg"), role: "assistant" as const, created_at: nowIso(), ...assistantMsg },
    ],
    updated_at: nowIso(),
  }
  await writeSessions(sessions)
}

function getSessionsFromState(state: any): Record<string, any> {
  return (state?.sessions_raw as Record<string, any>) || {}
}

function getMergedSessionState(deps: Deps, sessionId: string): Record<string, any> {
  const state = deps.getState() as Record<string, any>
  const rawSession = getSessionsFromState(state)?.[sessionId] || {}
  const orchestration = getSessionOrchestrationState(deps, sessionId)
  return orchestration ? { ...rawSession, orchestration } : rawSession
}

function getMergedSessionsMap(deps: Deps): Record<string, any> {
  const state = deps.getState() as Record<string, any>
  const rawSessions = getSessionsFromState(state)
  const sessionIds = new Set<string>([
    ...Object.keys(rawSessions || {}),
    ...Object.keys((state?.sessions as Record<string, any>) || {}),
  ])
  const merged: Record<string, any> = {}
  for (const sessionId of sessionIds) merged[sessionId] = getMergedSessionState(deps, sessionId)
  return merged
}

function getSessionOrchestrationState(deps: Deps, sessionId: string): any {
  try {
    if (typeof deps.getSessionOrchestration === "function") {
      return deps.getSessionOrchestration(sessionId) || null
    }
  } catch {}
  const state = deps.getState() as Record<string, unknown>
  const session = getSessionsFromState(state)?.[sessionId] || {}
  return session?.orchestration || null
}

function buildLocalStatus(deps: Deps, probe: { ok: boolean | null; version: string | null }): Record<string, unknown> {
  const state = deps.getState() as Record<string, unknown>
  const bb = deps.getBlackboxState()
  const sessionId = deps.getCurrentSessionId()
  const health = getLatestSessionHealthSnapshot(sessionId) || getSessionHealthSnapshot({
    sessionId,
    projectFingerprint: String(state?.current_project_fingerprint || ""),
  })
  return {
    ...state,
    backend_connected: typeof state?.backend_connected === "boolean" ? state.backend_connected : probe.ok === true,
    backend_health_url: state?.backend_health_url ?? BACKEND_HEALTH_URL,
    backend_version: typeof state?.backend_version === "string" ? state.backend_version : probe.version,
    blackbox: bb ?? null,
    session_health: health,
    claim_evidence: health?.claimEvidence || null,
    dashboard_backlog_count: getDashboardBridgeBacklogCount(),
  }
}

function buildLocalSavings(deps: Deps): unknown {
  return deps.getSavings()
}

// Running-sessions panel cap: mirrors OpenCode Desktop's own sidebar, which
// only ever shows a handful of recent conversations, not the plugin's entire
// lifetime session history.
const DASHBOARD_RUNNING_SESSIONS_LIMIT = 10

function buildLocalSessions(deps: Deps, limit = DASHBOARD_RUNNING_SESSIONS_LIMIT): { sessions: unknown[]; total_sessions: number } {
  const sessionsMap = getMergedSessionsMap(deps)
  const currentSessionId = deps.getCurrentSessionId()
  const currentFingerprint = deps.currentProjectFingerprint || ""
  // Only exclude sessions with a KNOWN, DIFFERENT project fingerprint --
  // unlike todos.json (where unscoped entries were confirmed old cross-project
  // junk), a large share of real, current-project sessions never get
  // project_fingerprint stamped at all (older opencode-<pid>-<ts> session IDs
  // predating full project-context wiring). Excluding those would hide
  // legitimate recent activity, not just noise.
  const entries = Object.entries(sessionsMap).filter(([, ses]) => {
    const fp = (ses as Record<string, unknown> | undefined)?.project_fingerprint
    return !currentFingerprint || !fp || fp === currentFingerprint
  })
  const sessions = entries.map(([id, ses]) => ({
    ...buildSessionDetail(id, ses, deps.getSessionMetrics(id), deps.getBlackboxState() || {}, { current_session_id: currentSessionId }),
    started: ses?.started || null,
    last_updated: ses?.last_updated || ses?.started || null,
    cost_usd: Number(ses?.cost_usd ?? 0) || 0,
    delegation_savings_usd: getSessionDelegationSavings(ses),
    cache_savings_usd: Number(ses?.cache_savings_usd ?? 0) || 0,
    warns_count: Array.isArray(ses?.warns) ? ses.warns.length : 0,
  }))
  sessions.sort((a, b) => {
    const at = Date.parse(String(a.last_updated || "")) || 0
    const bt = Date.parse(String(b.last_updated || "")) || 0
    return bt - at
  })
  return { sessions: sessions.slice(0, limit), total_sessions: sessions.length }
}

function buildLocalCurrentSession(deps: Deps, sessionId: string): Record<string, unknown> {
  const session = getMergedSessionState(deps, sessionId)
  return {
    session: buildSessionDetail(sessionId, session, deps.getSessionMetrics(sessionId), deps.getBlackboxState() || {}, { current_session_id: deps.getCurrentSessionId() }),
    metrics: deps.getSessionMetrics(sessionId),
    orchestration: getSessionOrchestrationState(deps, sessionId),
  }
}

async function refreshDashboardProjectionCache(deps: Deps, sessionId: string): Promise<void> {
  queueDashboardProjectionRefresh({
    session_id: sessionId,
    status: buildLocalStatus(deps, { ok: null, version: null }),
    savings: buildLocalSavings(deps),
    sessions: buildLocalSessions(deps),
    current_session: buildLocalCurrentSession(deps, sessionId),
  })
  await flushDashboardMutationQueue()
}

async function readDashboardProjection(path: string, kind: "status" | "savings" | "sessions" | "current_session", fallback: unknown): Promise<unknown> {
  try {
    const { status, data } = await proxyBackendJson(path)
    if (status >= 200 && status < 300) {
      primeDashboardBridgeCache({ [kind]: data })
      return data
    }
  } catch {}
  return getDashboardBridgeProjection(kind, fallback)
}

function mergeStatusProjection(local: Record<string, unknown>, projected: unknown): Record<string, unknown> {
  if (!projected || typeof projected !== "object") return local
  const remote = projected as Record<string, unknown>
  return {
    ...local,
    ...remote,
    api_fallback: local.api_fallback,
    api_fallback_since: local.api_fallback_since,
    backend_connected: local.backend_connected,
    backend_health_url: local.backend_health_url,
    backend_version: local.backend_version,
    backend_health_checked_at: local.backend_health_checked_at ?? remote.backend_health_checked_at ?? null,
    backend_health_age_ms: local.backend_health_age_ms ?? remote.backend_health_age_ms ?? null,
    backend_health_latency_ms: local.backend_health_latency_ms ?? remote.backend_health_latency_ms ?? null,
    backend_health_status: local.backend_health_status ?? remote.backend_health_status ?? null,
    backend_health_error: local.backend_health_error ?? remote.backend_health_error ?? null,
    blackbox: remote.blackbox ?? local.blackbox,
    dashboard_backlog_count: remote.dashboard_backlog_count ?? local.dashboard_backlog_count,
  }
}

function mergeSessionProjection(local: { sessions: unknown[]; total_sessions: number }, projected: unknown): { sessions: unknown[]; total_sessions: number; source?: unknown } {
  if (!projected || typeof projected !== "object") return local
  const remote = projected as Record<string, unknown>
  const localSessions = Array.isArray(local.sessions) ? local.sessions as Record<string, unknown>[] : []
  const remoteSessions = Array.isArray(remote.sessions) ? remote.sessions as Record<string, unknown>[] : []
  const remoteById = new Map(
    remoteSessions
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
      .map((entry) => [String(entry.session_id ?? entry.id ?? "").trim(), entry]),
  )
  const sessions = localSessions.map((entry) => {
    const sid = String(entry?.session_id ?? entry?.id ?? "").trim()
    const remoteEntry = sid ? remoteById.get(sid) : null
    if (!remoteEntry) return entry
    return {
      ...remoteEntry,
      ...entry,
      delegation_savings_usd: entry.delegation_savings_usd,
      cache_savings_usd: entry.cache_savings_usd,
      warns_count: entry.warns_count ?? remoteEntry.warns_count,
      cost_usd: entry.cost_usd ?? remoteEntry.cost_usd,
      started: entry.started ?? remoteEntry.started,
    }
  })
  return {
    ...remote,
    sessions,
    total_sessions: Number(remote.total_sessions ?? sessions.length) || sessions.length,
  }
}

let backendHealth: { ok: boolean | null; checkedAt: number; version: string | null } = { ok: null, checkedAt: 0, version: null }

async function probeBackendHealth(force = false): Promise<{ ok: boolean | null; version: string | null }> {
  const now = Date.now()
  if (!force && backendHealth.ok !== null && (now - backendHealth.checkedAt) < BACKEND_HEALTH_TTL_MS) {
    return { ok: backendHealth.ok, version: backendHealth.version }
  }
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 1500)
    const res = await fetch(BACKEND_HEALTH_URL, { signal: ctl.signal })
    clearTimeout(timer)
    let version: string | null = null
    try {
      const body = await res.clone().json() as Record<string, unknown>
      const candidate = body?.backend_version ?? body?.version ?? null
      if (typeof candidate === "string" && candidate.trim()) version = candidate.trim()
    } catch {}
    if (!version) {
      const headerVersion = res.headers.get("x-backend-version")
      version = headerVersion && headerVersion.trim() ? headerVersion.trim() : null
    }
    backendHealth = { ok: res.ok, checkedAt: now, version }
    return { ok: res.ok, version }
  } catch {
    backendHealth = { ok: false, checkedAt: now, version: null }
    return { ok: false, version: null }
  }
}

function sendFile(res: ServerResponse, fp: string): void {
  if (!existsSync(fp)) { res.statusCode = 404; res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.end("not found"); return }
  const ext = extname(fp).toLowerCase(); const mime = MIME_MAP[ext] || "application/octet-stream"; const st = statSync(fp)
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
  res.statusCode = 200; res.setHeader("Content-Type", mime); res.setHeader("Content-Length", st.size); res.setHeader("Cache-Control", "no-cache")
  const s = createReadStream(fp); s.pipe(res); s.on("error", () => { res.statusCode = 500; res.end() })
}

function serveDashboard(res: ServerResponse, p: string): void {
  const idx = join(DASHBOARD_DIR, "index.html"); let fp = join(DASHBOARD_DIR, p === "/" ? "index.html" : p)
  if (existsSync(fp) && statSync(fp).isFile()) { sendFile(res, fp); return }
  if (existsSync(idx)) { sendFile(res, idx); return }
  res.statusCode = 404; res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.end("not found")
}

export function createMcpServer(deps: Deps): McpServer {
  let server: http.Server | null = null
  let startPromise: Promise<http.Server> | null = null
  let closePromise: Promise<void> | null = null

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const method = (req.method || "GET").toUpperCase()
      const parsed = parseUrl(req.url || "/", true)
      const path = parsed.pathname || "/"

      if (method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        res.statusCode = 204
        res.end()
        return
      }

      if (method === "GET" && path === "/status") {
        const probe = await probeBackendHealth()
        const local = buildLocalStatus(deps, probe)
        const status = mergeStatusProjection(local, await readDashboardProjection("/api/v1/dashboard/status", "status", local))
        json(res, 200, status)
        return
      }
      if (method === "GET" && path === "/dashboard/home") {
        const currentSessionId = deps.getCurrentSessionId()
        const state = mergeStatusProjection(
          buildLocalStatus(deps, { ok: null, version: null }),
          await readDashboardProjection("/api/v1/dashboard/status", "status", buildLocalStatus(deps, { ok: null, version: null })),
        ) as Record<string, any>
        const savings = await readDashboardProjection("/api/v1/dashboard/savings", "savings", buildLocalSavings(deps))
        const blackbox = deps.getBlackboxState() || {}
        const home = buildDashboardHomeModel({
          currentSessionId,
          status: state,
          savings,
          todos: deps.getTodos() as any[],
          blackbox,
          sessions: getMergedSessionsMap(deps),
          metrics: deps.getSessionMetrics(currentSessionId),
          templates: (typeof deps.listSessionTemplates === "function" ? deps.listSessionTemplates() : TEMPLATE_LIBRARY) as any[],
          currentProjectName: deps.currentProjectName || "",
          currentProjectFingerprint: deps.currentProjectFingerprint || "",
        })
        json(res, 200, {
          ...home,
          status: state,
          blackbox,
          backend_connected: state?.backend_connected ?? false,
          backend_status: state?.backend_connected ? "online" : "degraded",
          backend_health_url: state?.backend_health_url ?? BACKEND_HEALTH_URL,
          backend_version: state?.backend_version || null,
        })
        return
      }
      if (method === "GET" && path === "/capabilities") {
        try {
          const { status, data } = await proxyBackendJson("/api/v1/capabilities")
          if (status >= 200 && status < 300) {
            json(res, status, data)
          } else {
            json(res, 200, buildCapabilityFallback(status))
          }
        } catch (error) {
          json(res, 200, {
            ...buildCapabilityFallback(0),
            message: error instanceof Error ? error.message : "unknown error",
          })
        }
        return
      }
      if (method === "GET" && path === "/savings") {
        const savings = await readDashboardProjection("/api/v1/dashboard/savings", "savings", buildLocalSavings(deps))
        json(res, 200, savings)
        return
      }
      if (method === "GET" && path === "/todos") {
        json(res, 200, deps.getTodos())
        return
      }
      if (method === "GET" && path === "/sessions") {
        const localSessions = buildLocalSessions(deps)
        const sessions = mergeSessionProjection(localSessions, await readDashboardProjection("/api/v1/dashboard/sessions", "sessions", localSessions))
        json(res, 200, sessions)
        return
      }
      if (method === "GET" && path === "/sessions/current") {
        const sid = deps.getCurrentSessionId()
        const current = await readDashboardProjection(`/api/v1/dashboard/sessions/current?session_id=${encodeURIComponent(sid)}`, "current_session", buildLocalCurrentSession(deps, sid))
        json(res, 200, current)
        return
      }
      if (method === "GET" && path === "/events") {
        res.statusCode = 200
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8")
        res.setHeader("Cache-Control", "no-cache")
        res.setHeader("Connection", "keep-alive")
        res.setHeader("Access-Control-Allow-Origin", "*")
        const send = async () => {
          const sid = deps.getCurrentSessionId()
          const [status, savings] = await Promise.all([
            readDashboardProjection("/api/v1/dashboard/status", "status", buildLocalStatus(deps, { ok: null, version: null })),
            readDashboardProjection("/api/v1/dashboard/savings", "savings", buildLocalSavings(deps)),
          ])
          res.write(`data: ${JSON.stringify({ status, savings, session_id: sid })}\n\n`)
        }
        void send()
        const timer = setInterval(() => { void send() }, 3000)
        req.on("close", () => clearInterval(timer))
        return
      }
      if (method === "GET" && path.startsWith("/sessions/")) {
        const sessionId = decodeURIComponent(path.replace(/^\/sessions\//, "")).trim()
        if (!sessionId || sessionId === "current" || sessionId.includes("/")) {
          // fall through to the specific routes below
        } else {
          const session = getMergedSessionState(deps, sessionId)
          json(res, 200, {
            session: buildSessionDetail(sessionId, session, deps.getSessionMetrics(sessionId), deps.getBlackboxState() || {}, { current_session_id: deps.getCurrentSessionId() }),
            metrics: deps.getSessionMetrics(sessionId),
            orchestration: getSessionOrchestrationState(deps, sessionId),
          })
          return
        }
      }
      if (method === "GET" && path.startsWith("/sessions/") && path.endsWith("/compare")) {
        const sessionId = decodeURIComponent(path.replace(/^\/sessions\//, "").replace(/\/compare$/, "")).trim()
        const query = parsed.query as Record<string, string | undefined>
        const compareId = typeof query.with === "string" ? decodeURIComponent(query.with).trim() : ""
        if (!sessionId || !compareId) {
          json(res, 400, { error: "session ids are required", status: 400 })
          return
        }
        const left = getSessionOrchestrationState(deps, sessionId)
        const right = getSessionOrchestrationState(deps, compareId)
        json(res, 200, {
          ok: true,
          compare: compareSessionOrchestrations(left, right),
        })
        return
      }
      if (method === "GET" && path.startsWith("/sessions/") && path.endsWith("/export")) {
        const sessionId = decodeURIComponent(path.replace(/^\/sessions\//, "").replace(/\/export$/, "")).trim()
        if (!sessionId) {
          json(res, 400, { error: "session id is required", status: 400 })
          return
        }
        const orchestration = exportSessionOrchestration(getSessionOrchestrationState(deps, sessionId), sessionId)
        json(res, 200, { ok: true, session_id: sessionId, orchestration })
        return
      }
      if (method === "GET" && path === "/templates") {
        const templates = typeof deps.listSessionTemplates === "function" ? deps.listSessionTemplates() : TEMPLATE_LIBRARY
        json(res, 200, templates)
        return
      }
      if (method === "GET" && path === "/reports") {
        try {
          const query = parsed.query as Record<string, string | undefined>
          const type = typeof query.type === "string" ? query.type : undefined
          const project = typeof query.project === "string" ? query.project : undefined
          const hoursRaw = query.hours
          const hours = hoursRaw != null ? Number(hoursRaw) : undefined
          const fingerprint = typeof query.fingerprint === "string" ? query.fingerprint : undefined
          const reports = deps.listReports({ type, project, hours: Number.isFinite(hours as number) ? hours : undefined, fingerprint })
          json(res, 200, reports)
        } catch (err: unknown) {
          const error = err as { status?: number }
          if (error?.status === 404) {
            json(res, 404, { error: "not found", status: 404 })
            return
          }
          throw err
        }
        return
      }
      if (method === "GET" && path.startsWith("/reports/")) {
        const id = decodeURIComponent(path.replace(/^\/reports\//, "")).trim()
        const report = deps.readReport(id)
        if (!report) {
          json(res, 404, { error: "not found", status: 404 })
          return
        }
        json(res, 200, report)
        return
      }
      if (method === "GET" && path === "/diagnose") {
        json(res, 200, deps.runDiagnose())
        return
      }
      if (method === "GET" && path === "/project") {
        json(res, 200, deps.runProject())
        return
      }
      if (method === "GET" && path === "/blackbox") {
        json(res, 200, deps.getBlackboxState() || {})
        return
      }
      if (method === "POST" && path === "/web-search") {
        let body: Record<string, unknown>
        try {
          body = await parseBody(req)
        } catch {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        const query = body?.query
        if (!query || typeof query !== "string") {
          json(res, 400, { error: "query is required and must be a string", status: 400 })
          return
        }
        try {
          const { status, data } = await proxyBackendJson("/api/v1/web/search", { method: "POST", body })
          json(res, status, data)
        } catch (error) {
          json(res, 502, {
            ok: false,
            error: "web search backend unavailable",
            message: error instanceof Error ? error.message : "unknown error",
            code: "BACKEND_UNAVAILABLE",
          })
        }
        return
      }
      if (method === "POST" && path === "/trinity") {
        let body: Record<string, unknown>
        try {
          body = await parseBody(req)
        } catch {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        const action = body?.action as string | undefined
        const slot = body?.slot as string | undefined
        const level = body?.level as string | undefined
        const token = body?.token as string | undefined
        if (!action || typeof action !== "string") {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        const result = await deps.runTrinity(action, { slot, level, token })
        const txt = typeof result === "string" ? result : JSON.stringify(result)
        const ok = !(txt.startsWith("❌") || txt.toLowerCase().includes("unknown action"))
        json(res, ok ? 200 : 400, ok ? { ok: true, result } : { ok: false, error: txt })
        return
      }
      if (method === "POST" && path === "/research-audit") {
        let body: Record<string, unknown>
        try {
          body = await parseBody(req)
        } catch {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        const hours = Number(body?.hours ?? 24)
        const report = deps.runResearchAudit(Number.isFinite(hours) ? hours : 24)
        json(res, 200, report)
        return
      }
      if (method === "POST" && path === "/reports") {
        let body: Record<string, unknown>
        try {
          body = await parseBody(req)
        } catch {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        if (!body || typeof body !== "object") {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        const id = deps.saveReport({
          type: "manual",
          summary: (body.summary as string) || "",
          findings: (body.findings as unknown[]) || [],
          metrics: (body.metrics as Record<string, unknown>) || {},
          narrative: (body.narrative as string) || "",
          tags: Array.isArray(body.tags) ? body.tags : [],
        })
        if (!id) {
          json(res, 500, { error: "failed to save report", status: 500 })
          return
        }
        json(res, 200, { ok: true, id })
        return
      }
      if (method === "POST" && path === "/sessions/checkout") {
        const result = deps.generateSessionCheckout()
        json(res, 200, result)
        return
      }
      const buildSessionActionPayload = (sessionId: string, orchestration: unknown) => {
        const blackbox = deps.getBlackboxState() || {}
        const sessionState = { ...getMergedSessionState(deps, sessionId), orchestration: orchestration as Record<string, unknown> }
        const metrics = deps.getSessionMetrics(sessionId)
        const detail = buildSessionDetail(
          sessionId,
          sessionState,
          metrics,
          blackbox,
          {
            current_session_id: deps.getCurrentSessionId(),
            optimization_mode: (deps.getState() as Record<string, any>)?.optimization_mode || (deps.getState() as Record<string, any>)?.selection?.optimization_mode || null,
          },
        )
        const normalized = normalizeSessionOrchestration(orchestration as Record<string, unknown> | null | undefined, sessionId)
        return {
          ok: true,
          session: {
            ...detail,
            version: detail?.version ?? normalized.version,
            history: Array.isArray(detail?.history) ? detail.history : normalized.history,
          },
          metrics,
          orchestration: orchestration as Record<string, unknown>,
        }
      }
      if (method === "POST" && path.startsWith("/sessions/") && path.endsWith("/action")) {
        const sessionId = decodeURIComponent(path.replace(/^\/sessions\//, "").replace(/\/action$/, "")).trim()
        let body: Record<string, unknown>
        try {
          body = await parseBody(req)
        } catch {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        const action = String(body?.action || "").trim().toLowerCase()
        if (!sessionId || !action) {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        if (action === "checkout") {
          const checkout = deps.generateSessionCheckout()
          if (typeof deps.mutateSessionOrchestration === "function") {
            deps.mutateSessionOrchestration(sessionId, (current) => applySessionAction(current, "checkout", { ...body, session_id: sessionId }))
          }
          await refreshDashboardProjectionCache(deps, sessionId)
          json(res, 200, { ok: true, checkout })
          return
        }
        if (action === "batch") {
          if (typeof deps.mutateSessionOrchestration === "function") {
            const next = deps.mutateSessionOrchestration(sessionId, (current) => applySessionAction(current, "batch", { ...body, session_id: sessionId }))
            queueDashboardProjectionRefresh({
              session_id: sessionId,
              sessions: buildLocalSessions(deps),
              current_session: {
                session: next,
                orchestration: next,
                metrics: deps.getSessionMetrics(sessionId),
              },
            })
            await flushDashboardMutationQueue()
            json(res, 200, buildSessionActionPayload(sessionId, next))
            return
          }
          json(res, 500, { ok: false, error: "session mutation unavailable" })
          return
        }
        if (action === "undo") {
          if (typeof deps.mutateSessionOrchestration === "function") {
            const next = deps.mutateSessionOrchestration(sessionId, (current) => applySessionAction(current, "undo", { ...body, session_id: sessionId }))
            queueDashboardProjectionRefresh({
              session_id: sessionId,
              sessions: buildLocalSessions(deps),
              current_session: {
                session: next,
                orchestration: next,
                metrics: deps.getSessionMetrics(sessionId),
              },
            })
            await flushDashboardMutationQueue()
            json(res, 200, buildSessionActionPayload(sessionId, next))
            return
          }
          json(res, 500, { ok: false, error: "session mutation unavailable" })
          return
        }
        if (typeof deps.mutateSessionOrchestration === "function") {
          const next = deps.mutateSessionOrchestration(sessionId, (current) => applySessionAction(current, action, { ...body, session_id: sessionId }))
          queueDashboardProjectionRefresh({
            session_id: sessionId,
            sessions: buildLocalSessions(deps),
            current_session: {
              session: next,
              orchestration: next,
              metrics: deps.getSessionMetrics(sessionId),
            },
          })
          await flushDashboardMutationQueue()
          json(res, 200, buildSessionActionPayload(sessionId, next))
          return
        }
        json(res, 500, { ok: false, error: "session mutation unavailable" })
        return
      }
      if (method === "POST" && path.startsWith("/sessions/") && path.endsWith("/template")) {
        const sessionId = decodeURIComponent(path.replace(/^\/sessions\//, "").replace(/\/template$/, "")).trim()
        let body: Record<string, unknown>
        try {
          body = await parseBody(req)
        } catch {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        if (!sessionId) {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        const template = body?.template && typeof body.template === "object"
          ? body.template
          : {
            id: body?.template_id || body?.id || "session-template",
            label: body?.label || body?.name || "Session template",
            body: body?.body || body?.directive || "",
            source: body?.source || "custom",
            base_template_id: body?.base_template_id || body?.template_id || body?.id || null,
            revision: body?.revision || 1,
          }
        if (typeof deps.mutateSessionOrchestration === "function") {
          const next = deps.mutateSessionOrchestration(sessionId, (current) => applySessionAction(current, "set-template", { ...body, template, session_id: sessionId }))
          queueDashboardProjectionRefresh({
            session_id: sessionId,
            sessions: buildLocalSessions(deps),
            current_session: {
              session: next,
              orchestration: next,
              metrics: deps.getSessionMetrics(sessionId),
            },
          })
          await flushDashboardMutationQueue()
          json(res, 200, buildSessionActionPayload(sessionId, next))
          return
        }
        json(res, 500, { ok: false, error: "session mutation unavailable" })
        return
      }
      if (method === "POST" && path === "/blackbox/vector") {
        let body: Record<string, unknown>
        try {
          body = await parseBody(req)
        } catch {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        deps.saveBlackboxVector(body)
        await refreshDashboardProjectionCache(deps, deps.getCurrentSessionId())
        json(res, 200, { ok: true })
        return
      }
      if (method === "POST" && path === "/blackbox/outcome") {
        let body: Record<string, unknown>
        try {
          body = await parseBody(req)
        } catch {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        deps.saveBlackboxOutcome(body)
        await refreshDashboardProjectionCache(deps, deps.getCurrentSessionId())
        json(res, 200, { ok: true })
        return
      }
      if (method === "POST" && path === "/sessions/import") {
        let body: Record<string, unknown>
        try {
          body = await parseBody(req)
        } catch {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        const sessionId = String(body?.session_id || "").trim()
        const orchestration = body?.orchestration && typeof body.orchestration === "object" ? body.orchestration : body?.session
        if (!sessionId || !orchestration) {
          json(res, 400, { error: "session_id and orchestration are required", status: 400 })
          return
        }
        if (typeof deps.mutateSessionOrchestration === "function") {
          const next = deps.mutateSessionOrchestration(sessionId, () => importSessionOrchestration({ ...(orchestration as Record<string, unknown>), session_id: sessionId }, sessionId))
          queueDashboardProjectionRefresh({
            session_id: sessionId,
            sessions: buildLocalSessions(deps),
            current_session: {
              session: next,
              orchestration: next,
              metrics: deps.getSessionMetrics(sessionId),
            },
          })
          await flushDashboardMutationQueue()
          json(res, 200, { ok: true, session: next })
          return
        }
        json(res, 500, { ok: false, error: "session mutation unavailable" })
        return
      }
      if (path.startsWith("/api/v1/orchestrator/")) {
        const orchSuffix = path.slice("/api/v1/orchestrator".length).split("?")[0].replace(/^\//, "")
        const segs = orchSuffix.split("/")
        const resource = segs[0]
        const resourceId = segs[1] || ""
        const subResource = segs[2] || ""
        let body: Record<string, unknown> = {}
        if (method === "POST" || method === "PUT") {
          try { body = await parseBody(req) } catch { json(res, 400, { error: "invalid body" }); return }
        }
        if (resource === "projects") {
          if (method === "GET" && !resourceId) {
            const projects = await readProjects()
            json(res, 200, { projects }); return
          }
          if (method === "POST" && !resourceId) {
            const projects = await readProjects()
            const project = { id: newId("proj"), name: String(body.name || "Untitled"), fingerprint: (body.fingerprint as string | null) ?? null, default_flow_id: null, created_at: nowIso(), updated_at: nowIso() }
            await writeProjects([...projects, project])
            json(res, 200, { project }); return
          }
          if (method === "PUT" && resourceId) {
            const projects = await readProjects()
            const idx = projects.findIndex((p) => p.id === resourceId)
            if (idx === -1) { json(res, 404, { error: "not found" }); return }
            const updated = { ...projects[idx], ...(body.name !== undefined ? { name: String(body.name) } : {}), ...(body.default_flow_id !== undefined ? { default_flow_id: (body.default_flow_id as string | null) } : {}), ...(body.fingerprint !== undefined ? { fingerprint: (body.fingerprint as string | null) } : {}), updated_at: nowIso() }
            projects[idx] = updated
            await writeProjects(projects)
            json(res, 200, { project: updated }); return
          }
          if (method === "DELETE" && resourceId) {
            const projects = await readProjects()
            await writeProjects(projects.filter((p) => p.id !== resourceId))
            const sessions = await readSessions()
            await writeSessions(sessions.filter((s) => s.project_id !== resourceId))
            json(res, 200, { ok: true }); return
          }
        }
        if (resource === "sessions") {
          if (method === "GET" && !resourceId) {
            const sessions = await readSessions()
            const projectFilter = (parsed.query.project_id as string) || null
            json(res, 200, { sessions: projectFilter ? sessions.filter((s) => s.project_id === projectFilter) : sessions }); return
          }
          if (method === "POST" && !resourceId) {
            const sessions = await readSessions()
            const session = { id: newId("sess"), project_id: String(body.project_id || ""), title: String(body.title || "New session"), flow_id: (body.flow_id as string | null) ?? null, messages: [], created_at: nowIso(), updated_at: nowIso() }
            await writeSessions([...sessions, session])
            json(res, 200, { session }); return
          }
          if (method === "PUT" && resourceId && !subResource) {
            const sessions = await readSessions()
            const idx = sessions.findIndex((s) => s.id === resourceId)
            if (idx === -1) { json(res, 404, { error: "not found" }); return }
            const updated = { ...sessions[idx], ...(body.title !== undefined ? { title: String(body.title) } : {}), ...(body.flow_id !== undefined ? { flow_id: (body.flow_id as string | null) } : {}), updated_at: nowIso() }
            sessions[idx] = updated
            await writeSessions(sessions)
            json(res, 200, { session: updated }); return
          }
          if (method === "DELETE" && resourceId && !subResource) {
            const sessions = await readSessions()
            await writeSessions(sessions.filter((s) => s.id !== resourceId))
            json(res, 200, { ok: true }); return
          }
          if (method === "GET" && resourceId && subResource === "messages") {
            const sessions = await readSessions()
            const session = sessions.find((s) => s.id === resourceId)
            if (!session) { json(res, 404, { error: "not found" }); return }
            json(res, 200, { messages: session.messages }); return
          }
          if (method === "POST" && resourceId && subResource === "run") {
            const prompt = String(body.prompt || "")
            const forwarded = await forwardOrchestratorRun(resourceId, body, res)
            if (forwarded) {
              // The backend already streamed the SSE response body to `res`
              // (compression / web-search / TDD / VibeUltraX steps, plus the
              // computed control_vector directives in the final `done` event)
              // but left the connection open so the local session-store
              // mirror below is written and durable before the stream is
              // signalled complete to the client.
              if (!res.writableEnded) {
                await appendRunMessages(resourceId, prompt, {
                  content: forwarded.summary || `Ran flow for: ${prompt.slice(0, 120)}`,
                  plan: forwarded.plan ?? null,
                  results: (forwarded.results as { step: { tool: string; label: string; condition: null }; skipped: boolean; result?: unknown }[]) ?? [],
                })
                res.end()
              }
              return
            }
            // The backend was unreachable (offline / no API token / network
            // error) for this run — serve a single direct-response turn locally
            // so the request still completes instead of hanging or erroring.
            writeSseHeaders(res)
            const flowData = { flow_name: "direct" }
            res.write(`event: flow\ndata: ${JSON.stringify(flowData)}\n\n`)
            const steps = [{ tool: "direct", label: "direct response", condition: null }]
            const plan = { steps }
            res.write(`event: plan\ndata: ${JSON.stringify({ plan })}\n\n`)
            const stepResult = { step: steps[0], skipped: false, result: { text: `Processed: ${prompt.slice(0, 80)}` } }
            res.write(`event: step\ndata: ${JSON.stringify(stepResult)}\n\n`)
            await appendRunMessages(resourceId, prompt, {
              content: `Ran flow for: ${prompt.slice(0, 120)}`,
              plan,
              results: [stepResult],
            })
            res.write(`event: done\ndata: {}\n\n`)
            res.end(); return
          }
        }
        if (resource === "flows") {
          if (method === "GET" && !resourceId) {
            const flows = await readFlows()
            const projectFilter = (parsed.query.project_id as string) || null
            json(res, 200, { flows: projectFilter ? flows.filter((f) => f.scope === "global" || f.project_id === projectFilter) : flows }); return
          }
          if (method === "POST" && !resourceId) {
            const flows = await readFlows()
            const scope: "project" | "global" = body.scope === "project" ? "project" : "global"
            const graph = (body.graph as { nodes: FlowNode[]; edges: FlowEdge[] }) || { nodes: [], edges: [] }
            const flow = { id: newId("flow"), scope, project_id: (body.project_id as string | null) ?? null, name: String(body.name || "New flow"), graph, created_at: nowIso(), updated_at: nowIso() }
            await writeFlows([...flows, flow])
            json(res, 200, { flow }); return
          }
          if (method === "PUT" && resourceId) {
            const flows = await readFlows()
            const idx = flows.findIndex((f) => f.id === resourceId)
            if (idx === -1) { json(res, 404, { error: "not found" }); return }
            const updated = { ...flows[idx], ...(body.name !== undefined ? { name: String(body.name) } : {}), ...(body.graph !== undefined ? { graph: body.graph as { nodes: FlowNode[]; edges: FlowEdge[] } } : {}), updated_at: nowIso() }
            flows[idx] = updated
            await writeFlows(flows)
            json(res, 200, { flow: updated }); return
          }
          if (method === "DELETE" && resourceId) {
            const flows = await readFlows()
            await writeFlows(flows.filter((f) => f.id !== resourceId))
            json(res, 200, { ok: true }); return
          }
        }
        json(res, 404, { error: "not found" }); return
      }
      if (method === "GET" && path === "/") {
        serveDashboard(res, "/")
        return
      }
      if (method === "GET" && (path.startsWith("/assets/") || path.startsWith("/favicon") || path.endsWith(".js") || path.endsWith(".css") || path.endsWith(".html"))) {
        serveDashboard(res, path)
        return
      }
      if (method === "GET" && path === "/health") {
        json(res, 200, { ok: true })
        return
      }
      json(res, 404, { error: "not found", status: 404 })
    } catch (err) {
      const message = err instanceof Error ? err.message : "server error"
      json(res, 500, { error: message, status: 500 })
    }
  }

  return {
    async start(port: number): Promise<http.Server> {
      if (server) return server
      if (startPromise) return startPromise
      startPromise = new Promise((resolve, reject) => {
        const srv = http.createServer((req, res) => { void handler(req, res) })
        srv.unref()
        srv.once("error", reject)
        srv.listen(port, () => {
          server = srv
          resolve(srv)
        })
      })
      try {
        return await startPromise
      } finally {
        startPromise = null
      }
    },
    async close(): Promise<void> {
      if (!server) return
      if (closePromise) return closePromise
      closePromise = new Promise((resolve, reject) => {
        server?.close(err => err ? reject(err) : resolve())
      })
      try {
        await closePromise
      } finally {
        server = null
        closePromise = null
      }
    },
  }
}
