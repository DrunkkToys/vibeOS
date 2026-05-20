#!/usr/bin/env node
import http from "node:http"
import { createReadStream, existsSync, statSync, readFileSync, readdirSync } from "node:fs"
import { extname, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(__dirname)

const MIME_MAP = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json",
}

const DASHBOARD_DIR = join(ROOT, "src", "dashboard", "dist")
const STATE_DIR = join(homedir(), ".claude")
const TIERS_FILE = join(STATE_DIR, "model-tiers.json")
const STATE_FILE = join(STATE_DIR, "delegation-state.json")
const REPORTS_DIR = join(STATE_DIR, "reports")

function readJson(filepath) {
  try {
    if (!existsSync(filepath)) return null
    return JSON.parse(readFileSync(filepath, "utf-8"))
  } catch { return null }
}

function computeStatus() {
  const tiers = readJson(TIERS_FILE)
  const state = readJson(STATE_FILE)
  const sel = tiers?.selection || {}
  return {
    enabled: sel.enabled !== false,
    active_slot: sel.active_slot || "unknown",
    enforce: sel.delegation_enforce !== false,
    flow_enforcer: sel.flow_enabled === true,
    flow_extract_todos: sel.flow_enforce === true,
    tdd_enforcer: sel.tdd_enforce === true,
    tdd_strict: sel.tdd_strict === true,
    thinking: sel.thinking_level || "auto",
    current_model: tiers?.trinity?.[sel.active_slot || "medium"]?.oc || "unknown",
    credit_percent: 0,
    version: "0.13.2",
    sessions_raw: state?.sessions || {},
  }
}

function computeSavings() {
  const state = readJson(STATE_FILE)
  const sessions = state?.sessions || {}
  const entries = Object.values(sessions)
  const lifetimeDel = entries.reduce((sum, s) => {
    const warns = s.warns || []
    return sum + warns.reduce((ws, w) => ws + (Number(w?.est_savings_usd) || 0), 0)
  }, 0)
  const lifetimeCache = entries.reduce((sum, s) => sum + (Number(s?.cache_savings_usd) || 0), 0)
  const sessionEntries = entries.slice(-1)
  const cur = sessionEntries[0] || {}
  const curWarns = cur.warns || []
  const curDel = curWarns.reduce((ws, w) => ws + (Number(w?.est_savings_usd) || 0), 0)
  const curCache = Number(cur?.cache_savings_usd) || 0
  const breakdown = {}
  curWarns.forEach((w) => {
    const tool = w.tool || "other"
    breakdown[tool] = (breakdown[tool] || 0) + (Number(w?.est_savings_usd) || 0)
  })
  const total = lifetimeDel + lifetimeCache
  return {
    lifetime: { delegation_usd: lifetimeDel, cache_usd: lifetimeCache, missed_context7_usd: 0, total_warns: entries.reduce((s, e) => s + (e.warns?.length || 0), 0) },
    current_session: { delegation_usd: curDel, cache_usd: curCache, warns_count: curWarns.length, tool_breakdown: breakdown },
    cache_hits_this_session: 0,
    trend: total > 0 ? "up" : "flat",
    savings_rate_per_hour: 0,
  }
}

function listSessions() {
  const state = readJson(STATE_FILE)
  const sessionsMap = state?.sessions || {}
  const sessions = Object.entries(sessionsMap).map(([id, ses]) => ({
    id,
    started: ses?.started || null,
    cost_usd: Number(ses?.cost_usd ?? 0) || 0,
    delegation_savings_usd: (ses.warns || []).reduce((sum, w) => sum + (Number(w?.est_savings_usd) || 0), 0),
    cache_savings_usd: Number(ses?.cache_savings_usd ?? 0) || 0,
    warns_count: (ses.warns || []).length,
  }))
  return { sessions, total_sessions: sessions.length }
}

function listReports() {
  try {
    if (!existsSync(REPORTS_DIR)) return []
    return readdirSync(REPORTS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const data = readJson(join(REPORTS_DIR, f))
        return { id: f.replace(/\.json$/, ""), summary: data?.summary || "", type: data?.type || "", created: data?.created || "", tags: data?.tags || [] }
      })
  } catch { return [] }
}

function readReport(id) {
  try {
    const data = readJson(join(REPORTS_DIR, `${id}.json`))
    return data || null
  } catch { return null }
}

function sendFile(res, filePath, cache = false) {
  const ext = extname(filePath).toLowerCase()
  const mime = MIME_MAP[ext] || "application/octet-stream"
  const stats = statSync(filePath)
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": stats.size,
    "Cache-Control": cache ? "max-age=3600" : "no-cache",
    "Access-Control-Allow-Origin": "*",
  })
  createReadStream(filePath).pipe(res)
}

function serveDashboard(res, pathname) {
  let filePath = join(DASHBOARD_DIR, pathname === "/" ? "index.html" : pathname)
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    sendFile(res, filePath, /\.(js|css|png|svg|ico)$/.test(pathname))
  } else {
    sendFile(res, join(DASHBOARD_DIR, "index.html"))
  }
}

const SSE_CLIENTS = new Set()
let sseInterval = null

function broadcastSSE() {
  const data = JSON.stringify({ status: computeStatus(), savings: computeSavings() })
  for (const res of SSE_CLIENTS) {
    try { res.write(`data: ${data}\n\n`) } catch { SSE_CLIENTS.delete(res) }
  }
}

function handleSSE(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  })
  const data = JSON.stringify({ status: computeStatus(), savings: computeSavings() })
  res.write(`data: ${data}\n\n`)
  SSE_CLIENTS.add(res)
  if (!sseInterval) sseInterval = setInterval(broadcastSSE, 1500)
  req.on("close", () => {
    SSE_CLIENTS.delete(res)
    if (SSE_CLIENTS.size === 0 && sseInterval) {
      clearInterval(sseInterval)
      sseInterval = null
    }
  })
}

function main() {
  const PORT = Number(process.env.PORT || 3333)

  if (!existsSync(join(DASHBOARD_DIR, "index.html"))) {
    console.error(`[vibeOS] Dashboard not built. Run: npm run build:dashboard`)
    process.exit(1)
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
    const path = url.pathname
    try {
      if (path === "/status") { res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(computeStatus())); return }
      if (path === "/savings") { res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(computeSavings())); return }
      if (path === "/sessions") { res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(listSessions())); return }
      if (path === "/reports") { res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(listReports())); return }
      if (path.startsWith("/reports/")) { const id = decodeURIComponent(path.replace("/reports/", "")); const r = readReport(id); if (r) { res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(r)) } else { res.writeHead(404); res.end() }; return }
      if (path === "/events") { handleSSE(req, res); return }
      serveDashboard(res, path)
    } catch (e) {
      res.writeHead(500)
      res.end(e.message)
    }
  })

  server.listen(PORT, "127.0.0.1", () => {
    console.error(`[vibeOS] Dashboard server on http://127.0.0.1:${PORT}`)
    console.error(`[vibeOS] Open http://127.0.0.1:${PORT}/ in your browser`)
  })
}

main()
