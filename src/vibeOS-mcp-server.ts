import http from "node:http"
import { parse as parseUrl } from "node:url"

type TrinityAction = "status" | "enable" | "disable" | "set" | "thinking" | "flow" | "tdd" | "project" | "patterns" | "rebuild" | "diagnose" | "help" | "enforce" | "repair-state"

type Deps = {
  getState: () => any
  getSavings: () => any
  getSessionMetrics: (sid?: string) => any
  listReports: (filter?: any) => any[]
  readReport: (id: string) => any
  runDiagnose: () => any
  runProject: () => any
  runTrinity: (action: TrinityAction, params?: any) => Promise<any> | any
  runResearchAudit: (hours?: number) => any
  saveReport: (data: any) => string | null
  getCurrentSessionId: () => string
  generateSessionCheckout: () => any
}

function json(res: http.ServerResponse, statusCode: number, data: any): void {
  res.statusCode = statusCode
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(data))
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = ""
    req.on("data", (chunk) => {
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

export function createMcpServer(deps: Deps): { start: (port: number) => Promise<http.Server>; close: () => Promise<void> } {
  let server: http.Server | null = null
  let startPromise: Promise<http.Server> | null = null
  let closePromise: Promise<void> | null = null

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
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
        const state = deps.getState()
        const sessionsMap = state?.sessions_raw || {}
        const sessions = Object.entries(sessionsMap).map(([id, ses]: [string, any]) => ({
          id,
          started: ses?.started || null,
          cost_usd: Number(ses?.cost_usd ?? 0) || 0,
          delegation_savings_usd: Array.isArray(ses?.warns)
            ? ses.warns.reduce((sum: number, w: any) => sum + (Number(w?.est_savings_usd ?? 0) || 0), 0)
            : 0,
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
          const type = typeof parsed.query.type === "string" ? parsed.query.type : undefined
          const project = typeof parsed.query.project === "string" ? parsed.query.project : undefined
          const hoursRaw = parsed.query.hours
          const hours = hoursRaw != null ? Number(hoursRaw) : undefined
          const fingerprint = typeof parsed.query.fingerprint === "string" ? parsed.query.fingerprint : undefined
          const reports = deps.listReports({ type, project, hours: Number.isFinite(hours) ? hours : undefined, fingerprint })
          json(res, 200, reports)
        } catch (err: any) {
          if (err?.status === 404) {
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
        let body: any
        try {
          body = await parseBody(req)
        } catch {
          json(res, 400, { error: "invalid request", status: 400 })
          return
        }
        const action = body?.action as TrinityAction
        const slot = body?.slot
        const level = body?.level
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
        let body: any
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
        let body: any
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
          summary: body.summary || "",
          findings: body.findings || [],
          metrics: body.metrics || {},
          narrative: body.narrative || "",
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

      json(res, 404, { error: "not found", status: 404 })
    } catch (err: any) {
      json(res, 500, { error: err?.message || "internal error", status: 500 })
    }
  }

  return {
    async start(port: number) {
      if (closePromise) await closePromise
      if (server) return server
      if (startPromise) return startPromise
      server = http.createServer((req, res) => {
        void handler(req, res)
      })
      startPromise = new Promise((resolve, reject) => {
        const onListening = () => {
          startPromise = null
          resolve(server as http.Server)
        }
        const onError = (err: Error) => {
          console.error(`[vibeOS] MCP server bind failed: ${err.message}`)
          startPromise = null
          server = null
          reject(err)
        }
        server?.once("listening", onListening)
        server?.once("error", onError)
        try {
          server?.listen(port, "127.0.0.1")
        } catch (err) {
          onError(err as Error)
        }
      })
      return startPromise
    },
    close() {
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
