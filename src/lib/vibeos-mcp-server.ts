// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>

import http from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { parse as parseUrl } from "node:url"
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { extname, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

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
  listReports: (params: { type?: string; project?: string; hours?: number; fingerprint?: string }) => unknown
  readReport: (id: string) => unknown
  runDiagnose: () => unknown
  runProject: () => unknown
  runTrinity: (action: string, opts: { slot?: string; level?: string }) => Promise<unknown>
  runResearchAudit: (hours: number) => unknown
  saveReport: (params: { type: string; summary: string; findings: unknown[]; metrics: Record<string, unknown>; narrative: string; tags: unknown[] }) => string | null
  generateSessionCheckout: () => unknown
  getBlackboxState: () => unknown
  saveBlackboxVector: (vector: unknown) => void
  saveBlackboxOutcome: (outcome: unknown) => void
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
  const c = [
    join(_MCP_DIR, "dashboard", "dist"),
    join(_MCP_DIR, "assets", "dashboard"),
    join(_MCP_DIR, "assets", "dashboard", "dist"),
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
    const payload = `window.__VIBEOS_DASHBOARD_BASE__ = ${JSON.stringify(baseUrl.replace(/\/$/, ""))};\n`
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

const BACKEND_HEALTH_URL = resolveBackendHealthUrl()
const BACKEND_HEALTH_TTL_MS = 5_000

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
        const state = deps.getState() as Record<string, unknown>
        const probe = await probeBackendHealth()
        const bb = deps.getBlackboxState()
        json(res, 200, { ...state, backend_connected: probe.ok === true, backend_health_url: BACKEND_HEALTH_URL, backend_version: probe.version, blackbox: bb ?? null })
        return
      }
      if (method === "GET" && path === "/savings") {
        json(res, 200, deps.getSavings())
        return
      }
      if (method === "GET" && path === "/todos") {
        json(res, 200, deps.getTodos())
        return
      }
      if (method === "GET" && path === "/sessions") {
        const state = deps.getState() as Record<string, unknown> | null
        const sessionsMap = state?.sessions_raw as Record<string, Record<string, unknown>> | undefined || {}
        const sessions = Object.entries(sessionsMap).map(([id, ses]) => ({
          id,
          started: ses?.started || null,
          cost_usd: Number(ses?.cost_usd ?? 0) || 0,
          delegation_savings_usd: Array.isArray(ses?.warns)
            ? (ses.warns as Array<Record<string, unknown>>).reduce((sum, w) => sum + (Number(w?.est_savings_usd ?? 0) || 0), 0)
            : ses?.total_savings_usd || 0,
          cache_savings_usd: Number(ses?.cache_savings_usd ?? 0) || 0,
          warns_count: Array.isArray(ses?.warns) ? ses.warns.length : 0,
        }))
        json(res, 200, { sessions, total_sessions: sessions.length })
        return
      }
      if (method === "GET" && path === "/sessions/current") {
        json(res, 200, deps.getSessionMetrics(deps.getCurrentSessionId()))
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
        if (!action || typeof action !== "string") {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        const result = await deps.runTrinity(action, { slot, level })
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
      if (method === "POST" && path === "/blackbox/vector") {
        let body: Record<string, unknown>
        try {
          body = await parseBody(req)
        } catch {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        deps.saveBlackboxVector(body)
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
        json(res, 200, { ok: true })
        return
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
