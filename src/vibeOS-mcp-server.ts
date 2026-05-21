// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>

import http from "node:http"
import { IncomingMessage, ServerResponse } from "node:http"
import { parse as parseUrl } from "node:url"
import { URLSearchParams } from "node:url"
import { createReadStream, existsSync, statSync } from "node:fs"
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
}

type McpServer = {
  start: (port: number) => Promise<http.Server>
  close: () => Promise<void>
}

function json(res: ServerResponse, statusCode: number, data: unknown): void {
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
    join(_MCP_DIR, "..", "src", "dashboard", "dist"),
  ]
  for (const p of c) { if (existsSync(join(p, "index.html"))) return p }
  return c[0]
}

const DASHBOARD_DIR = resolveDashboardDir()

function sendFile(res: ServerResponse, fp: string): void {
  if (!existsSync(fp)) { res.statusCode = 404; res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.end("not found"); return }
  const ext = extname(fp).toLowerCase(); const mime = MIME_MAP[ext] || "application/octet-stream"; const st = statSync(fp)
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

      if (method === "GET" && path === "/status") {
        json(res, 200, deps.getState())
        return
      }
      if (method === "GET" && path === "/savings") {
        json(res, 200, deps.getSavings())
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
      if (method === "GET" && path === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" })
        const push = () => { res.write(`data: ${JSON.stringify({ status: deps.getState(), savings: deps.getSavings() })}\n\n`) }; push()
        const iv = setInterval(push, 1500)
        req.on("close", () => { clearInterval(iv) })
        return
      }

      if (existsSync(join(DASHBOARD_DIR, "index.html"))) { serveDashboard(res, path); return }
      json(res, 404, { error: "not found", status: 404 })
    } catch (err: unknown) {
      const error = err as { message?: string }
      json(res, 500, { error: error?.message || "internal error", status: 500 })
    }
  }

  return {
    async start(port: number): Promise<http.Server> {
      if (closePromise) await closePromise
      if (server) return server
      if (startPromise) return startPromise

      const listen = (listenPort: number): Promise<http.Server> => new Promise((resolve, reject) => {
        const nextServer = http.createServer((req: IncomingMessage, res: ServerResponse) => {
          void handler(req, res)
        })
        const onListening = () => resolve(nextServer)
        const onError = (err: Error) => {
          try { nextServer.close() } catch { }
          reject(err)
        }
        nextServer.once("listening", onListening)
        nextServer.once("error", onError)
        try {
          nextServer.listen(listenPort, "127.0.0.1")
        } catch (err: unknown) {
          onError(err as Error)
        }
      })

      startPromise = (async () => {
        try {
          server = await listen(port)
          return server
        } catch (err: unknown) {
          const error = err as { code?: string; message: string }
          if (error?.code !== "EADDRINUSE" || port === 0) {
            startPromise = null
            server = null
            console.error(`[vibeOS] MCP server bind failed: ${error.message}`)
            throw err
          }
          try {
            const fallback = await listen(0)
            server = fallback
            const bound = fallback.address()
            const actualPort = typeof bound === "object" && bound ? (bound as { port: number }).port : 0
            console.error(`[vibeOS] MCP server port ${port} busy; fell back to ${actualPort}`)
            return fallback
          } catch (fallbackErr: unknown) {
            const fbError = fallbackErr as { message: string }
            startPromise = null
            server = null
            console.error(`[vibeOS] MCP server bind failed: ${fbError.message}`)
            throw fallbackErr
          }
        } finally {
          startPromise = null
        }
      })()
      return startPromise
    },

    close(): Promise<void> {
      if (!server) return closePromise || Promise.resolve()
      if (closePromise) return closePromise
      const current = server
      closePromise = new Promise((resolve) => {
        try {
          current.close(() => {
            if (server === current) server = null
            closePromise = null
            resolve()
          })
        } catch {
          if (server === current) server = null
          closePromise = null
          resolve()
        }
      })
      return closePromise
    },
  }
}
