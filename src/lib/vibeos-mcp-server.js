// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
import http from "node:http";
import { parse as parseUrl } from "node:url";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const MIME_MAP = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".ico": "image/x-icon",
};
function json(res, statusCode, data) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
}
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let raw = "";
        req.on("data", (chunk) => {
            raw += String(chunk || "");
            if (raw.length > 1024 * 1024) {
                reject(new Error("payload too large"));
            }
        });
        req.on("end", () => {
            if (!raw.trim()) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(raw));
            }
            catch {
                reject(new Error("invalid request"));
            }
        });
        req.on("error", reject);
    });
}
const _MCP_FILENAME = fileURLToPath(import.meta.url);
const _MCP_DIR = dirname(_MCP_FILENAME);
function resolveDashboardDir() {
    const c = [
        join(_MCP_DIR, "dashboard", "dist"),
    ];
    for (const p of c) {
        if (existsSync(join(p, "index.html")))
            return p;
    }
    return c[0];
}
const DASHBOARD_DIR = resolveDashboardDir();
const BACKEND_HEALTH_URL = process.env.VIBEOS_BACKEND_HEALTH_URL || "http://127.0.0.1:3000/health";
const BACKEND_HEALTH_TTL_MS = 5_000;
let backendHealth = { ok: null, checkedAt: 0 };
async function probeBackendHealth(force = false) {
    const now = Date.now();
    if (!force && backendHealth.ok !== null && (now - backendHealth.checkedAt) < BACKEND_HEALTH_TTL_MS) {
        return backendHealth.ok;
    }
    try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 1500);
        const res = await fetch(BACKEND_HEALTH_URL, { signal: ctl.signal });
        clearTimeout(timer);
        backendHealth = { ok: res.ok, checkedAt: now };
        return res.ok;
    }
    catch {
        backendHealth = { ok: false, checkedAt: now };
        return false;
    }
}
function sendFile(res, fp) {
    if (!existsSync(fp)) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("not found");
        return;
    }
    const ext = extname(fp).toLowerCase();
    const mime = MIME_MAP[ext] || "application/octet-stream";
    const st = statSync(fp);
    res.statusCode = 200;
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", st.size);
    res.setHeader("Cache-Control", "no-cache");
    const s = createReadStream(fp);
    s.pipe(res);
    s.on("error", () => { res.statusCode = 500; res.end(); });
}
function serveDashboard(res, p) {
    const idx = join(DASHBOARD_DIR, "index.html");
    let fp = join(DASHBOARD_DIR, p === "/" ? "index.html" : p);
    if (existsSync(fp) && statSync(fp).isFile()) {
        sendFile(res, fp);
        return;
    }
    if (existsSync(idx)) {
        sendFile(res, idx);
        return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("not found");
}
export function createMcpServer(deps) {
    let server = null;
    let startPromise = null;
    let closePromise = null;
    const handler = async (req, res) => {
        try {
            const method = (req.method || "GET").toUpperCase();
            const parsed = parseUrl(req.url || "/", true);
            const path = parsed.pathname || "/";
            if (method === "GET" && path === "/status") {
                const state = deps.getState();
                const ok = await probeBackendHealth();
                const bb = deps.getBlackboxState();
                json(res, 200, { ...state, backend_connected: ok === true, backend_health_url: BACKEND_HEALTH_URL, blackbox: bb ?? null });
                return;
            }
            if (method === "GET" && path === "/savings") {
                json(res, 200, deps.getSavings());
                return;
            }
            if (method === "GET" && path === "/todos") {
                json(res, 200, deps.getTodos());
                return;
            }
            if (method === "GET" && path === "/sessions") {
                const state = deps.getState();
                const sessionsMap = state?.sessions_raw || {};
                const sessions = Object.entries(sessionsMap).map(([id, ses]) => ({
                    id,
                    started: ses?.started || null,
                    cost_usd: Number(ses?.cost_usd ?? 0) || 0,
                    delegation_savings_usd: Array.isArray(ses?.warns)
                        ? ses.warns.reduce((sum, w) => sum + (Number(w?.est_savings_usd ?? 0) || 0), 0)
                        : ses?.total_savings_usd || 0,
                    cache_savings_usd: Number(ses?.cache_savings_usd ?? 0) || 0,
                    warns_count: Array.isArray(ses?.warns) ? ses.warns.length : 0,
                }));
                json(res, 200, { sessions, total_sessions: sessions.length });
                return;
            }
            if (method === "GET" && path === "/sessions/current") {
                json(res, 200, deps.getSessionMetrics(deps.getCurrentSessionId()));
                return;
            }
            if (method === "GET" && path === "/reports") {
                try {
                    const query = parsed.query;
                    const type = typeof query.type === "string" ? query.type : undefined;
                    const project = typeof query.project === "string" ? query.project : undefined;
                    const hoursRaw = query.hours;
                    const hours = hoursRaw != null ? Number(hoursRaw) : undefined;
                    const fingerprint = typeof query.fingerprint === "string" ? query.fingerprint : undefined;
                    const reports = deps.listReports({ type, project, hours: Number.isFinite(hours) ? hours : undefined, fingerprint });
                    json(res, 200, reports);
                }
                catch (err) {
                    const error = err;
                    if (error?.status === 404) {
                        json(res, 404, { error: "not found", status: 404 });
                        return;
                    }
                    throw err;
                }
                return;
            }
            if (method === "GET" && path.startsWith("/reports/")) {
                const id = decodeURIComponent(path.replace(/^\/reports\//, "")).trim();
                const report = deps.readReport(id);
                if (!report) {
                    json(res, 404, { error: "not found", status: 404 });
                    return;
                }
                json(res, 200, report);
                return;
            }
            if (method === "GET" && path === "/diagnose") {
                json(res, 200, deps.runDiagnose());
                return;
            }
            if (method === "GET" && path === "/project") {
                json(res, 200, deps.runProject());
                return;
            }
            if (method === "GET" && path === "/blackbox") {
                json(res, 200, deps.getBlackboxState() || {});
                return;
            }
            if (method === "POST" && path === "/trinity") {
                let body;
                try {
                    body = await parseBody(req);
                }
                catch {
                    json(res, 400, { error: "invalid request", status: 400 });
                    return;
                }
                const action = body?.action;
                const slot = body?.slot;
                const level = body?.level;
                if (!action || typeof action !== "string") {
                    json(res, 400, { error: "invalid request", status: 400 });
                    return;
                }
                const result = await deps.runTrinity(action, { slot, level });
                const txt = typeof result === "string" ? result : JSON.stringify(result);
                const ok = !(txt.startsWith("❌") || txt.toLowerCase().includes("unknown action"));
                json(res, ok ? 200 : 400, ok ? { ok: true, result } : { ok: false, error: txt });
                return;
            }
            if (method === "POST" && path === "/research-audit") {
                let body;
                try {
                    body = await parseBody(req);
                }
                catch {
                    json(res, 400, { error: "invalid request", status: 400 });
                    return;
                }
                const hours = Number(body?.hours ?? 24);
                const report = deps.runResearchAudit(Number.isFinite(hours) ? hours : 24);
                json(res, 200, report);
                return;
            }
            if (method === "POST" && path === "/reports") {
                let body;
                try {
                    body = await parseBody(req);
                }
                catch {
                    json(res, 400, { error: "invalid request", status: 400 });
                    return;
                }
                if (!body || typeof body !== "object") {
                    json(res, 400, { error: "invalid request", status: 400 });
                    return;
                }
                const id = deps.saveReport({
                    type: "manual",
                    summary: body.summary || "",
                    findings: body.findings || [],
                    metrics: body.metrics || {},
                    narrative: body.narrative || "",
                    tags: Array.isArray(body.tags) ? body.tags : [],
                });
                if (!id) {
                    json(res, 500, { error: "failed to save report", status: 500 });
                    return;
                }
                json(res, 200, { ok: true, id });
                return;
            }
            if (method === "POST" && path === "/sessions/checkout") {
                const result = deps.generateSessionCheckout();
                json(res, 200, result);
                return;
            }
            if (method === "POST" && path === "/blackbox/vector") {
                let body;
                try {
                    body = await parseBody(req);
                }
                catch {
                    json(res, 400, { error: "invalid request", status: 400 });
                    return;
                }
                deps.saveBlackboxVector(body);
                json(res, 200, { ok: true });
                return;
            }
            if (method === "POST" && path === "/blackbox/outcome") {
                let body;
                try {
                    body = await parseBody(req);
                }
                catch {
                    json(res, 400, { error: "invalid request", status: 400 });
                    return;
                }
                deps.saveBlackboxOutcome(body);
                json(res, 200, { ok: true });
                return;
            }
            if (method === "GET" && path === "/") {
                serveDashboard(res, "/");
                return;
            }
            if (method === "GET" && (path.startsWith("/assets/") || path.startsWith("/favicon") || path.endsWith(".js") || path.endsWith(".css") || path.endsWith(".html"))) {
                serveDashboard(res, path);
                return;
            }
            if (method === "GET" && path === "/health") {
                json(res, 200, { ok: true });
                return;
            }
            json(res, 404, { error: "not found", status: 404 });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "server error";
            json(res, 500, { error: message, status: 500 });
        }
    };
    return {
        async start(port) {
            if (server)
                return server;
            if (startPromise)
                return startPromise;
            startPromise = new Promise((resolve, reject) => {
                const srv = http.createServer((req, res) => { void handler(req, res); });
                srv.once("error", reject);
                srv.listen(port, () => {
                    server = srv;
                    resolve(srv);
                });
            });
            try {
                return await startPromise;
            }
            finally {
                startPromise = null;
            }
        },
        async close() {
            if (!server)
                return;
            if (closePromise)
                return closePromise;
            closePromise = new Promise((resolve, reject) => {
                server?.close(err => err ? reject(err) : resolve());
            });
            try {
                await closePromise;
            }
            finally {
                server = null;
                closePromise = null;
            }
        },
    };
}
