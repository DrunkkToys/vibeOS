// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
import http from "node:http";
import { parse as parseUrl } from "node:url";
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
                json(res, 200, deps.getState());
                return;
            }
            if (method === "GET" && path === "/savings") {
                json(res, 200, deps.getSavings());
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
                        : 0,
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
            json(res, 404, { error: "not found", status: 404 });
        }
        catch (err) {
            const error = err;
            json(res, 500, { error: error?.message || "internal error", status: 500 });
        }
    };
    return {
        async start(port) {
            if (closePromise)
                await closePromise;
            if (server)
                return server;
            if (startPromise)
                return startPromise;
            const listen = (listenPort) => new Promise((resolve, reject) => {
                const nextServer = http.createServer((req, res) => {
                    void handler(req, res);
                });
                const onListening = () => resolve(nextServer);
                const onError = (err) => {
                    try {
                        nextServer.close();
                    }
                    catch { }
                    reject(err);
                };
                nextServer.once("listening", onListening);
                nextServer.once("error", onError);
                try {
                    nextServer.listen(listenPort, "127.0.0.1");
                }
                catch (err) {
                    onError(err);
                }
            });
            startPromise = (async () => {
                try {
                    server = await listen(port);
                    return server;
                }
                catch (err) {
                    const error = err;
                    if (error?.code !== "EADDRINUSE" || port === 0) {
                        startPromise = null;
                        server = null;
                        console.error(`[vibeOS] MCP server bind failed: ${error.message}`);
                        throw err;
                    }
                    try {
                        const fallback = await listen(0);
                        server = fallback;
                        const bound = fallback.address();
                        const actualPort = typeof bound === "object" && bound ? bound.port : 0;
                        console.error(`[vibeOS] MCP server port ${port} busy; fell back to ${actualPort}`);
                        return fallback;
                    }
                    catch (fallbackErr) {
                        const fbError = fallbackErr;
                        startPromise = null;
                        server = null;
                        console.error(`[vibeOS] MCP server bind failed: ${fbError.message}`);
                        throw fallbackErr;
                    }
                }
                finally {
                    startPromise = null;
                }
            })();
            return startPromise;
        },
        close() {
            if (!server)
                return closePromise || Promise.resolve();
            if (closePromise)
                return closePromise;
            const current = server;
            closePromise = new Promise((resolve) => {
                try {
                    current.close(() => {
                        if (server === current)
                            server = null;
                        closePromise = null;
                        resolve();
                    });
                }
                catch {
                    if (server === current)
                        server = null;
                    closePromise = null;
                    resolve();
                }
            });
            return closePromise;
        },
    };
}
