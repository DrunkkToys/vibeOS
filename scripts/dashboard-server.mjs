#!/usr/bin/env node
import http from "node:http"
import { createReadStream, existsSync, statSync, readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync } from "node:fs"
import { extname, join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(__dirname)
const MIME_MAP = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".map": "application/json" }
const DASHBOARD_DIR = join(ROOT, "src", "dashboard", "dist")
const STATE_DIR = join(homedir(), ".claude")
const TIERS_FILE = join(STATE_DIR, "model-tiers.json")
const STATE_FILE = join(STATE_DIR, "delegation-state.json")
const REPORTS_DIR = join(STATE_DIR, "reports")

function rj(f) { try { if (!existsSync(f)) return null; return JSON.parse(readFileSync(f, "utf-8")) } catch { return null } }
function wj(f, d) { try { mkdirSync(dirname(f), { recursive: true }); const t = f + ".tmp." + Date.now(); writeFileSync(t, JSON.stringify(d, null, 2) + "\n", "utf-8"); renameSync(t, f); return true } catch (e) { console.error("[vibeOS] write failed:", e.message); return false } }

function status() {
  const t = rj(TIERS_FILE); const s = rj(STATE_FILE); const sel = t?.selection || {}
  return { enabled: sel.enabled !== false, active_slot: sel.active_slot || "unknown", enforce: sel.delegation_enforce !== false, flow_enforcer: sel.flow_enabled === true, flow_extract_todos: sel.flow_enforce === true, tdd_enforcer: sel.tdd_enforce === true, tdd_strict: sel.tdd_strict !== false, thinking: sel.thinking_level || "auto", current_model: t?.trinity?.[sel.active_slot || "medium"]?.oc || "unknown", credit_percent: 0, version: "0.13.6", sessions_raw: s?.sessions || {} }
}

function savings() {
  const s = rj(STATE_FILE); const ses = Object.values(s?.sessions || {}); const lD = ses.reduce((a, e) => a + (e.warns || []).reduce((b, w) => b + (Number(w?.est_savings_usd) || 0), 0), 0); const lC = ses.reduce((a, e) => a + (Number(e?.cache_savings_usd) || 0), 0); const c = ses[ses.length - 1] || {}; const cW = c.warns || []; const cD = cW.reduce((a, w) => a + (Number(w?.est_savings_usd) || 0), 0); const cC = Number(c?.cache_savings_usd) || 0; const bd = {}; cW.forEach(w => { const t = w.tool || "other"; bd[t] = (bd[t] || 0) + (Number(w?.est_savings_usd) || 0) })
  return { lifetime: { delegation_usd: lD, cache_usd: lC, missed_context7_usd: 0, total_warns: ses.reduce((a, e) => a + (e.warns?.length || 0), 0) }, current_session: { delegation_usd: cD, cache_usd: cC, warns_count: cW.length, tool_breakdown: bd }, cache_hits_this_session: 0, trend: lD + lC > 0 ? "up" : "flat", savings_rate_per_hour: 0 }
}

function sessions() {
  const m = rj(STATE_FILE)?.sessions || {}; const l = Object.entries(m).map(([id, e]) => ({ id, started: e?.started || null, cost_usd: Number(e?.cost_usd ?? 0) || 0, delegation_savings_usd: (e.warns || []).reduce((a, w) => a + (Number(w?.est_savings_usd) || 0), 0), cache_savings_usd: Number(e?.cache_savings_usd ?? 0) || 0, warns_count: (e.warns || []).length })); return { sessions: l, total_sessions: l.length }
}

function reports() { try { if (!existsSync(REPORTS_DIR)) return []; return readdirSync(REPORTS_DIR).filter(f => f.endsWith(".json")).map(f => { const d = rj(join(REPORTS_DIR, f)); return { id: f.replace(/\.json$/, ""), summary: d?.summary || "", type: d?.type || "", created: d?.created || "", tags: d?.tags || [] } }) } catch { return [] } }
function report(id) { try { return rj(join(REPORTS_DIR, `${id}.json`)) } catch { return null } }

function sf(res, fp, c) { const ext = extname(fp).toLowerCase(); const m = MIME_MAP[ext] || "application/octet-stream"; const st = statSync(fp); res.writeHead(200, { "Content-Type": m, "Content-Length": st.size, "Cache-Control": c ? "max-age=3600" : "no-cache", "Access-Control-Allow-Origin": "*" }); createReadStream(fp).pipe(res) }
function dash(res, p) { let fp = join(DASHBOARD_DIR, p === "/" ? "index.html" : p); if (existsSync(fp) && statSync(fp).isFile()) sf(res, fp, /\.(js|css|png|svg|ico)$/.test(p)); else sf(res, join(DASHBOARD_DIR, "index.html")) }

async function parseBody(req) { return new Promise((resolve) => { let raw = ""; req.on("data", c => { raw += String(c || ""); if (raw.length > 65536) { resolve(null) } }); req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve(null) } }); req.on("error", () => resolve(null)) }) }

function handleTrinity(body) {
  if (!body || !body.action) return { ok: false, error: "missing action" }
  const action = String(body.action)
  const slot = body.slot ? String(body.slot) : null
  const tiers = rj(TIERS_FILE)
  if (!tiers) return { ok: false, error: "model-tiers.json not found" }
  tiers.selection ??= {}

  if (action === "set") {
    if (slot && ["brain", "medium", "cheap"].includes(slot)) {
      tiers.selection.active_slot = slot
      wj(TIERS_FILE, tiers)
      return { ok: true, result: `Slot set to ${slot}` }
    }
    return { ok: false, error: "invalid slot" }
  }
  if (action === "enforce") {
    tiers.selection.delegation_enforce = slot === "on"
    wj(TIERS_FILE, tiers)
    return { ok: true, result: `Enforcement ${slot === "on" ? "ON" : "OFF"}` }
  }
  if (action === "flow") {
    if (slot === "on" || slot === "off") {
      tiers.selection.flow_enabled = slot === "on"
      wj(TIERS_FILE, tiers)
      return { ok: true, result: `Flow ${slot.toUpperCase()}` }
    }
    if (slot === "enforce") {
      const cur = tiers.selection.flow_enforce === true
      tiers.selection.flow_enforce = !cur
      wj(TIERS_FILE, tiers)
      return { ok: true, result: `Flow enforce ${cur ? "OFF" : "ON"}` }
    }
    return { ok: false, error: "invalid flow slot" }
  }
  if (action === "tdd") {
    if (slot === "on" || slot === "off") {
      tiers.selection.tdd_enforce = slot === "on"
      wj(TIERS_FILE, tiers)
      return { ok: true, result: `TDD ${slot.toUpperCase()}` }
    }
    if (slot === "strict") {
      const cur = tiers.selection.tdd_strict === true
      tiers.selection.tdd_strict = !cur
      wj(TIERS_FILE, tiers)
      return { ok: true, result: `TDD strict ${cur ? "OFF" : "ON"}` }
    }
    return { ok: false, error: "invalid tdd slot" }
  }
  if (action === "thinking") {
    if (["full", "brief", "off"].includes(String(slot))) {
      tiers.selection.thinking_level = String(slot)
      wj(TIERS_FILE, tiers)
      return { ok: true, result: `Thinking set to ${slot}` }
    }
    return { ok: false, error: "invalid thinking level" }
  }
  if (action === "disable") {
    tiers.selection.enabled = false
    wj(TIERS_FILE, tiers)
    return { ok: true, result: "vibeOS disabled" }
  }
  if (action === "status" || action === "diagnose" || action === "project" || action === "help") {
    return { ok: true, result: `${action} ok` }
  }
  return { ok: false, error: "unknown action" }
}

const SSE = new Set(); let si = null
function bcast() { const d = JSON.stringify({ status: status(), savings: savings() }); for (const r of SSE) { try { r.write(`data: ${d}\n\n`) } catch { SSE.delete(r) } } }
function hSSE(req, res) { res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" }); res.write(`data: ${JSON.stringify({ status: status(), savings: savings() })}\n\n`); SSE.add(res); if (!si) si = setInterval(bcast, 1500); req.on("close", () => { SSE.delete(res); if (SSE.size === 0 && si) { clearInterval(si); si = null } }) }

function main() {
  const PORT = Number(process.env.PORT || 3333)
  if (!existsSync(join(DASHBOARD_DIR, "index.html"))) { console.error("[vibeOS] Dashboard not built. Run: npm run build:dashboard"); process.exit(1) }
  const s = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*")
    if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }); res.end(); return }
    const p = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname
    try {
      if (p === "/status") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(status())); return }
      if (p === "/savings") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(savings())); return }
      if (p === "/sessions") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(sessions())); return }
      if (p === "/reports") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(reports())); return }
      if (p.startsWith("/reports/")) { const id = decodeURIComponent(p.replace("/reports/", "")); const r = report(id); if (r) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(r)) } else { res.writeHead(404); res.end() }; return }
      if (p === "/events") { hSSE(req, res); return }
      if (p === "/trinity" && req.method === "POST") {
        const body = await parseBody(req)
        const result = handleTrinity(body)
        res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" })
        res.end(JSON.stringify(result))
        bcast()
        return
      }
      dash(res, p)
    } catch (e) { res.writeHead(500); res.end(e.message) }
  })
  s.listen(PORT, "127.0.0.1", () => { const a = s.address(); const ap = typeof a === "object" && a ? a.port : PORT; console.error(`[vibeOS] Dashboard server on http://127.0.0.1:${ap}\n[vibeOS] Open http://127.0.0.1:${ap}/ in your browser`) })
}
main()
