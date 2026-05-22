var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/vibeOS-lib/flow-enforcer.js
var flow_enforcer_exports = {};
__export(flow_enforcer_exports, {
  addFlowRule: () => addFlowRule,
  checkFlowRules: () => checkFlowRules,
  ensureProjectDocs: () => ensureProjectDocs,
  getFlowWarns: () => getFlowWarns,
  getSessionFlowCounts: () => getSessionFlowCounts,
  recordFlowTodo: () => recordFlowTodo,
  resetAll: () => resetAll,
  resetForTest: () => resetForTest,
  resolveRulesPath: () => resolveRulesPath,
  setFlowStateWriter: () => setFlowStateWriter
});
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync, appendFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
  }
  let cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(cleaned);
}
function resolveRulesPath() {
  return RULES_PATH;
}
function ensureProjectDocs(dir, techStack) {
  const created = [];
  const skipped = [];
  const agentsPath = join(dir, "AGENTS.md");
  const readmePath = join(dir, "README.md");
  try {
    if (!existsSync(agentsPath)) {
      try {
        writeFileSync(agentsPath, GUARD_AGENTS_TEMPLATE, "utf-8");
        created.push("AGENTS.md");
        console.error("[vibeOS] Project Guard: created AGENTS.md");
      } catch (err) {
        console.error(`[vibeOS] Project Guard: failed to create AGENTS.md: ${err.message}`);
      }
    } else {
      skipped.push("AGENTS.md");
    }
  } catch {
  }
  try {
    if (!existsSync(readmePath)) {
      const name = dir ? dir.split("/").pop() || "Project" : "Project";
      const stack = techStack || [];
      const content = GUARD_README_TEMPLATE(name, stack);
      try {
        writeFileSync(readmePath, content, "utf-8");
        created.push("README.md");
        console.error("[vibeOS] Project Guard: created README.md");
      } catch (err) {
        console.error(`[vibeOS] Project Guard: failed to create README.md: ${err.message}`);
      }
    } else {
      skipped.push("README.md");
    }
  } catch {
  }
  return { created, skipped };
}
function setFlowStateWriter(writer) {
  _stateWriter = typeof writer === "function" ? writer : null;
}
function loadFlowDedupKeys() {
  try {
    if (existsSync(FLOW_DEDUP_FILE)) {
      const raw = readFileSync(FLOW_DEDUP_FILE, "utf-8");
      const keys = safeJsonParse(raw);
      if (Array.isArray(keys)) {
        for (const k of keys)
          _flowWarnsSeen.add(k);
      }
    }
  } catch {
  }
}
function persistFlowDedupKey(key) {
  try {
    mkdirSync(dirname(FLOW_DEDUP_FILE), { recursive: true });
    let keys = [];
    if (existsSync(FLOW_DEDUP_FILE)) {
      try {
        keys = safeJsonParse(readFileSync(FLOW_DEDUP_FILE, "utf-8"));
      } catch {
      }
      if (!Array.isArray(keys))
        keys = [];
    }
    if (!keys.includes(key)) {
      keys.push(key);
      if (keys.length > 1e3)
        keys = keys.slice(-500);
      writeFileSync(FLOW_DEDUP_FILE, JSON.stringify(keys), "utf-8");
    }
  } catch {
  }
}
function loadRules() {
  const rulesPath = resolveRulesPath();
  try {
    const mtime = _cachedRules ? statSync(rulesPath).mtimeMs : 0;
    if (_cachedRules && mtime === _rulesMtime)
      return _cachedRules;
    if (!existsSync(rulesPath)) {
      _cachedRules = [];
      return _cachedRules;
    }
    const j = safeJsonParse(readFileSync(rulesPath, "utf-8"));
    _cachedRules = j.rules || [];
    _rulesMtime = mtime;
    return _cachedRules;
  } catch {
    _cachedRules = [];
    return _cachedRules;
  }
}
function recordFlowWarn(hit) {
  try {
    let state = {};
    if (existsSync(STATE_FILE)) {
      try {
        state = safeJsonParse(readFileSync(STATE_FILE, "utf-8"));
      } catch {
      }
    } else {
      mkdirSync(dirname(STATE_FILE), { recursive: true });
    }
    state.flow_warns ??= [];
    state.flow_warns.push({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      sid: process.pid || "?",
      rule_id: hit.id,
      severity: hit.severity,
      filePath: hit.filePath,
      description: hit.description
    });
    if (state.flow_warns.length > 500) {
      state.flow_warns = state.flow_warns.slice(-500);
    }
    const fp3 = { flow_warns: state.flow_warns };
    if (_stateWriter)
      _stateWriter(fp3);
    else {
      const existing = safeJsonParse(existsSync(STATE_FILE) ? readFileSync(STATE_FILE, "utf-8") : "{}");
      const merged = Object.assign({}, existing, fp3);
      const tmpFile = STATE_FILE + ".tmp." + Date.now();
      writeFileSync(tmpFile, JSON.stringify(merged, null, 2));
      renameSync(tmpFile, STATE_FILE);
    }
  } catch {
  }
}
function checkFlowRules({ tool: tool2, filePath, content }) {
  const rules = loadRules();
  const hits = [];
  const toolName = String(tool2 || "").trim().toLowerCase();
  for (const rule of rules) {
    const triggerName = String(rule.trigger || "").trim().toLowerCase();
    if (triggerName !== toolName)
      continue;
    const target = toolName === "write" ? filePath || "" : content || filePath || "";
    let re;
    try {
      re = new RegExp(rule.pattern);
    } catch {
      continue;
    }
    if (!re.test(target))
      continue;
    const key = `${rule.id}::${filePath || ""}`;
    if (_flowWarnsSeen.has(key)) {
      hits.push({ ...rule, filePath, deduped: true });
      continue;
    }
    _flowWarnsSeen.add(key);
    persistFlowDedupKey(key);
    const hit = { ...rule, filePath, deduped: false };
    hits.push(hit);
    recordFlowWarn(hit);
  }
  return hits;
}
function getFlowWarns() {
  try {
    if (!existsSync(STATE_FILE))
      return [];
    const s = safeJsonParse(readFileSync(STATE_FILE, "utf-8"));
    return s?.flow_warns || [];
  } catch {
    return [];
  }
}
function getSessionFlowCounts() {
  const counts = { warn: 0, hint: 0, flag: 0 };
  for (const key of _flowWarnsSeen) {
    const rules = loadRules();
    const [ruleId] = key.split("::");
    const rule = rules.find((r) => r.id === ruleId);
    if (rule && counts[rule.severity] !== void 0)
      counts[rule.severity]++;
  }
  return counts;
}
function resetForTest(rules) {
  _cachedRules = rules;
  _flowWarnsSeen.clear();
  try {
    _rulesMtime = statSync(resolveRulesPath()).mtimeMs;
  } catch {
  }
}
function resetAll() {
  _flowWarnsSeen.clear();
  _cachedRules = null;
  _rulesMtime = 0;
}
function addFlowRule(rule) {
  const rules = loadRules();
  rules.push(rule);
  writeFileSync(resolveRulesPath(), JSON.stringify({ rules }, null, 2), "utf-8");
  _cachedRules = rules;
  _rulesMtime = statSync(resolveRulesPath()).mtimeMs;
}
function recordFlowTodo({ filePath, content }) {
  try {
    mkdirSync(dirname(FLOW_TODO_FILE), { recursive: true });
    const todoRe = /(?:\/\/\s*|\#\s*)(TODO|FIXME|HACK)[\s:]+(.+)$/i;
    const todos = [];
    for (const line of content.split("\n")) {
      const m = line.match(todoRe);
      if (m) {
        todos.push({ type: m[1], text: m[2].trim() });
      }
    }
    if (todos.length === 0)
      return 0;
    const dedupKey = `${filePath || ""}::${todos.map((t) => `${t.type}:${t.text}`).join("|")}`;
    const existingLines = existsSync(FLOW_TODO_FILE) ? readFileSync(FLOW_TODO_FILE, "utf-8").trim().split("\n").filter(Boolean) : [];
    const existingKeys = /* @__PURE__ */ new Set();
    for (const line of existingLines) {
      try {
        const entry2 = safeJsonParse(line);
        if (entry2 && entry2.filePath && entry2.todos) {
          const key = `${entry2.filePath}::${entry2.todos.map((t) => `${t.type}:${t.text}`).join("|")}`;
          existingKeys.add(key);
        }
      } catch {
      }
    }
    if (existingKeys.has(dedupKey))
      return 0;
    const entry = JSON.stringify({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      filePath,
      todos
    }) + "\n";
    appendFileSync(FLOW_TODO_FILE, entry);
    try {
      const lines = readFileSync(FLOW_TODO_FILE, "utf-8").trim().split("\n").filter(Boolean);
      if (lines.length > MAX_FLOW_TODOS) {
        writeFileSync(FLOW_TODO_FILE, lines.slice(-Math.floor(MAX_FLOW_TODOS / 2)).join("\n") + "\n");
      }
    } catch {
    }
    console.error(`[flow-enforcer] \u{1F4CB} Extracted ${todos.length} TODO(s) from ${filePath} \u2192 flow-todo-queue.jsonl`);
    return todos.length;
  } catch {
    return 0;
  }
}
var __dirname, RULES_PATH, GUARD_AGENTS_TEMPLATE, GUARD_README_TEMPLATE, STATE_FILE, FLOW_TODO_FILE, FLOW_DEDUP_FILE, MAX_FLOW_TODOS, _flowWarnsSeen, _stateWriter, _cachedRules, _rulesMtime;
var init_flow_enforcer = __esm({
  "src/vibeOS-lib/flow-enforcer.js"() {
    "use strict";
    __dirname = dirname(fileURLToPath(import.meta.url));
    RULES_PATH = join(__dirname, "flow-rules.json");
    GUARD_AGENTS_TEMPLATE = [
      "# AGENTS.md",
      "",
      "> Auto-generated by vibeOS Project Guard. Defines rules for AI agents working on this project.",
      "",
      "## CRITICAL \u2014 ASK BEFORE CHANGING CODE",
      "",
      "NEVER modify any file without explicit user permission.",
      'If you are an LLM: DO NOT LGTM, DO NOT "fix", DO NOT "clean up",',
      'DO NOT "refactor", DO NOT "optimize", DO NOT "modernize". ASK FIRST.',
      "",
      "## PROTECTED FILES",
      "",
      "Do not modify these files without explicit user permission:",
      "- AGENTS.md (this file)",
      "- README.md",
      ""
    ].join("\n");
    GUARD_README_TEMPLATE = (name, techStack) => {
      const stackLine = techStack.length > 0 ? techStack.map((t) => `\`${t}\``).join(", ") : "(auto-detected on next session)";
      return [
        `# ${name}`,
        "",
        "## Tech Stack",
        "",
        stackLine,
        "",
        "## Features",
        "",
        "(Feature list maintained by vibeOS \u2014 run `trinity guard` to refresh)",
        "",
        "## Getting Started",
        "",
        "```bash",
        "# Clone and install dependencies",
        "```",
        ""
      ].join("\n");
    };
    STATE_FILE = join(homedir(), ".claude/delegation-state.json");
    FLOW_TODO_FILE = join(homedir(), ".claude/flow-todo-queue.jsonl");
    FLOW_DEDUP_FILE = join(homedir(), ".claude/.flow-dedup-keys.json");
    MAX_FLOW_TODOS = 200;
    _flowWarnsSeen = /* @__PURE__ */ new Set();
    _stateWriter = null;
    loadFlowDedupKeys();
    _cachedRules = null;
    _rulesMtime = 0;
  }
});

// src/index.ts
init_flow_enforcer();
import { readFileSync as readFileSync14, writeFileSync as writeFileSync12, existsSync as existsSync15, mkdirSync as mkdirSync10, copyFileSync as copyFileSync6, renameSync as renameSync6 } from "node:fs";
import { join as join15, dirname as dirname8, basename as basename9 } from "node:path";

// src/vibeOS-lib/session-metrics.js
function formatDuration(totalSeconds) {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}
function aggregateWarns(warns, filterFn) {
  const list = Array.isArray(warns) ? warns : [];
  const filtered = filterFn ? list.filter(filterFn) : list;
  let sum = 0;
  for (const w of filtered) {
    const v = Number(w?.est_savings_usd ?? 0);
    if (Number.isFinite(v))
      sum += v;
  }
  return sum;
}
function computeSessionMetrics(state, sessionId) {
  const s = state && typeof state === "object" && !Array.isArray(state) ? state : null;
  const empty = {
    ltTasks: 0,
    ltCache: 0,
    ltCost: 0,
    count: 0,
    scratchpadHits: 0,
    missedC7: 0,
    sesTasks: 0,
    sesEdit: 0,
    sesCredit: 0,
    sesC7: 0,
    sesQuota: 0,
    sesTaskDelegations: 0,
    sesDuration: 0,
    sesRatePerHour: 0,
    sesTrend: "stable",
    sesToolBreakdown: {},
    sesModelTurns: { brain: 0, worker: 0 }
  };
  if (!s)
    return empty;
  let ltTasks = 0;
  let ltCache = 0;
  let ltCost = 0;
  let totalWarnCount = 0;
  const sessionRates = [];
  for (const [sid, ses2] of Object.entries(s?.sessions || {})) {
    const warns2 = Array.isArray(ses2?.warns) ? ses2.warns : [];
    totalWarnCount += warns2.length;
    for (const w of warns2)
      ltTasks += Number.isFinite(Number(w.est_savings_usd ?? 0)) ? Number(w.est_savings_usd ?? 0) : 0;
    const cacheVal = Number(ses2?.cache_savings_usd ?? 0);
    ltCache += Number.isFinite(cacheVal) ? cacheVal : 0;
    const costVal = Number(ses2?.cost_usd ?? 0);
    ltCost += Number.isFinite(costVal) ? costVal : 0;
    if (ses2?.started) {
      const elapsed = (Date.now() - new Date(ses2.started).getTime()) / 36e5;
      const sesTotal = aggregateWarns(warns2) + Number(ses2?.cache_savings_usd ?? 0);
      if (elapsed > 0.05)
        sessionRates.push(sesTotal / elapsed);
    }
  }
  const legacyLifetimeDelegation = Number(s?.lifetime?.total_savings_usd ?? s?.lifetime?.est_savings_usd ?? 0);
  if (legacyLifetimeDelegation > 0) {
    ltTasks = Math.max(ltTasks, legacyLifetimeDelegation);
  }
  const legacyLifetimeCache = Number(s?.lifetime?.cache_savings_usd ?? 0);
  if (legacyLifetimeCache > 0) {
    ltCache = Math.max(ltCache, legacyLifetimeCache);
  }
  const ses = s?.sessions?.[sessionId];
  const warns = Array.isArray(ses?.warns) ? ses.warns : [];
  const sesTasks = aggregateWarns(warns);
  const sesEdit = aggregateWarns(warns, (w) => Boolean(w.reason?.includes("direct edit")));
  const sesCredit = aggregateWarns(warns, (w) => Boolean(w.reason?.includes("credit")));
  const sesC7 = aggregateWarns(warns, (w) => Boolean(w.reason?.includes("context7")));
  const sesQuota = aggregateWarns(warns, (w) => Boolean(w.reason?.includes("quota")));
  const sesTaskDelegationCount = warns.filter((w) => Boolean(w.reason?.includes("delegation")) || Boolean(w.reason?.includes("enforced")) || Boolean(w.reason?.includes("direct"))).reduce((sum, w) => sum + (Number(w.count) || 1), 0);
  const sesToolBreakdown = {};
  for (const w of warns) {
    const tool2 = w.tool || "unknown";
    sesToolBreakdown[tool2] = (sesToolBreakdown[tool2] || 0) + Number(w.est_savings_usd ?? 0);
  }
  for (const k of Object.keys(sesToolBreakdown)) {
    sesToolBreakdown[k] = Math.round(sesToolBreakdown[k] * 100) / 100;
  }
  let sesDuration = 0;
  let sesRatePerHour = 0;
  if (ses?.started) {
    sesDuration = (Date.now() - new Date(ses.started).getTime()) / 1e3;
    const sesTotal = sesTasks + Number(ses?.cache_savings_usd ?? 0);
    const hours = sesDuration / 3600;
    sesRatePerHour = hours > 0 ? sesTotal / hours : 0;
  }
  let sesTrend = "stable";
  if (sessionRates.length >= 2) {
    const currentRate = sessionRates[sessionRates.length - 1];
    const prevRates = sessionRates.slice(0, -1);
    const avgPrev = prevRates.reduce((a, b) => a + b, 0) / prevRates.length;
    const diff = currentRate - avgPrev;
    const threshold = 0.15;
    if (avgPrev > 0) {
      const pctChange = diff / avgPrev;
      if (pctChange > threshold)
        sesTrend = "up";
      else if (pctChange < -threshold)
        sesTrend = "down";
    }
  }
  const sesModelTurns = { brain: 0, worker: 0 };
  if (ses?.tool_counts) {
    const brainTools = ["write", "edit", "notebookedit", "bash", "webfetch", "websearch"];
    for (const t of brainTools) {
      sesModelTurns.brain += Number(ses.tool_counts[t] || 0);
    }
    sesModelTurns.worker = Number(ses.tool_counts.task || 0);
  }
  return {
    ltTasks: Math.round(ltTasks * 1e4) / 1e4,
    ltCache: Math.round(ltCache * 1e4) / 1e4,
    ltCost: Math.round(ltCost * 1e4) / 1e4,
    count: Math.max(totalWarnCount, Number(s?.lifetime?.warn_count ?? 0)),
    scratchpadHits: Number(s?.lifetime?.scratchpad_hits_observed ?? 0),
    missedC7: Number(s?.lifetime?.missed_context7_usd ?? 0),
    sesTasks,
    sesEdit,
    sesCredit,
    sesC7,
    sesQuota,
    sesTaskDelegations: sesTaskDelegationCount,
    sesDuration: Math.round(sesDuration),
    sesDurationFormatted: formatDuration(Math.round(sesDuration)),
    sesRatePerHour: Math.round(sesRatePerHour * 100) / 100,
    sesTrend,
    sesToolBreakdown,
    sesModelTurns
  };
}

// src/vibeOS-mcp-server.js
import http from "node:http";
import { parse as parseUrl } from "node:url";
import { createReadStream, existsSync as existsSync2, statSync as statSync2 } from "node:fs";
import { extname, join as join2, dirname as dirname2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var MIME_MAP = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
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
      } catch {
        reject(new Error("invalid request"));
      }
    });
    req.on("error", reject);
  });
}
var _MCP_FILENAME = fileURLToPath2(import.meta.url);
var _MCP_DIR = dirname2(_MCP_FILENAME);
function resolveDashboardDir() {
  const c = [
    join2(_MCP_DIR, "dashboard", "dist"),
    join2(_MCP_DIR, "..", "src", "dashboard", "dist")
  ];
  for (const p of c) {
    if (existsSync2(join2(p, "index.html")))
      return p;
  }
  return c[0];
}
var DASHBOARD_DIR = resolveDashboardDir();
function sendFile(res, fp3) {
  if (!existsSync2(fp3)) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("not found");
    return;
  }
  const ext = extname(fp3).toLowerCase();
  const mime = MIME_MAP[ext] || "application/octet-stream";
  const st = statSync2(fp3);
  res.statusCode = 200;
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Length", st.size);
  res.setHeader("Cache-Control", "no-cache");
  const s = createReadStream(fp3);
  s.pipe(res);
  s.on("error", () => {
    res.statusCode = 500;
    res.end();
  });
}
function serveDashboard(res, p) {
  const idx = join2(DASHBOARD_DIR, "index.html");
  let fp3 = join2(DASHBOARD_DIR, p === "/" ? "index.html" : p);
  if (existsSync2(fp3) && statSync2(fp3).isFile()) {
    sendFile(res, fp3);
    return;
  }
  if (existsSync2(idx)) {
    sendFile(res, idx);
    return;
  }
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("not found");
}
function createMcpServer(deps) {
  let server2 = null;
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
        const sessions = Object.entries(sessionsMap).map(([id2, ses]) => ({
          id: id2,
          started: ses?.started || null,
          cost_usd: Number(ses?.cost_usd ?? 0) || 0,
          delegation_savings_usd: Array.isArray(ses?.warns) ? ses.warns.reduce((sum, w) => sum + (Number(w?.est_savings_usd ?? 0) || 0), 0) : ses?.total_savings_usd || 0,
          cache_savings_usd: Number(ses?.cache_savings_usd ?? 0) || 0,
          warns_count: Array.isArray(ses?.warns) ? ses.warns.length : 0
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
          const type = typeof query.type === "string" ? query.type : void 0;
          const project = typeof query.project === "string" ? query.project : void 0;
          const hoursRaw = query.hours;
          const hours = hoursRaw != null ? Number(hoursRaw) : void 0;
          const fingerprint = typeof query.fingerprint === "string" ? query.fingerprint : void 0;
          const reports = deps.listReports({ type, project, hours: Number.isFinite(hours) ? hours : void 0, fingerprint });
          json(res, 200, reports);
        } catch (err) {
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
        const id2 = decodeURIComponent(path.replace(/^\/reports\//, "")).trim();
        const report = deps.readReport(id2);
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
        } catch {
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
        const ok = !(txt.startsWith("\u274C") || txt.toLowerCase().includes("unknown action"));
        json(res, ok ? 200 : 400, ok ? { ok: true, result } : { ok: false, error: txt });
        return;
      }
      if (method === "POST" && path === "/research-audit") {
        let body;
        try {
          body = await parseBody(req);
        } catch {
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
        } catch {
          json(res, 400, { error: "invalid request", status: 400 });
          return;
        }
        if (!body || typeof body !== "object") {
          json(res, 400, { error: "invalid request", status: 400 });
          return;
        }
        const id2 = deps.saveReport({
          type: "manual",
          summary: body.summary || "",
          findings: body.findings || [],
          metrics: body.metrics || {},
          narrative: body.narrative || "",
          tags: Array.isArray(body.tags) ? body.tags : []
        });
        if (!id2) {
          json(res, 500, { error: "failed to save report", status: 500 });
          return;
        }
        json(res, 200, { ok: true, id: id2 });
        return;
      }
      if (method === "POST" && path === "/sessions/checkout") {
        const result = deps.generateSessionCheckout();
        json(res, 200, result);
        return;
      }
      if (method === "GET" && path === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" });
        const push = () => {
          res.write(`data: ${JSON.stringify({ status: deps.getState(), savings: deps.getSavings() })}

`);
        };
        push();
        const iv = setInterval(push, 1500);
        req.on("close", () => {
          clearInterval(iv);
        });
        return;
      }
      if (existsSync2(join2(DASHBOARD_DIR, "index.html"))) {
        serveDashboard(res, path);
        return;
      }
      json(res, 404, { error: "not found", status: 404 });
    } catch (err) {
      const error = err;
      json(res, 500, { error: error?.message || "internal error", status: 500 });
    }
  };
  return {
    async start(port) {
      if (closePromise)
        await closePromise;
      if (server2)
        return server2;
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
          } catch {
          }
          reject(err);
        };
        nextServer.once("listening", onListening);
        nextServer.once("error", onError);
        try {
          nextServer.listen(listenPort, "127.0.0.1");
        } catch (err) {
          onError(err);
        }
      });
      startPromise = (async () => {
        try {
          server2 = await listen(port);
          return server2;
        } catch (err) {
          const error = err;
          if (error?.code !== "EADDRINUSE" || port === 0) {
            startPromise = null;
            server2 = null;
            console.error(`[vibeOS] MCP server bind failed: ${error.message}`);
            throw err;
          }
          try {
            const fallback = await listen(0);
            server2 = fallback;
            const bound = fallback.address();
            const actualPort = typeof bound === "object" && bound ? bound.port : 0;
            console.error(`[vibeOS] MCP server port ${port} busy; fell back to ${actualPort}`);
            return fallback;
          } catch (fallbackErr) {
            const fbError = fallbackErr;
            startPromise = null;
            server2 = null;
            console.error(`[vibeOS] MCP server bind failed: ${fbError.message}`);
            throw fallbackErr;
          }
        } finally {
          startPromise = null;
        }
      })();
      return startPromise;
    },
    close() {
      if (!server2)
        return closePromise || Promise.resolve();
      if (closePromise)
        return closePromise;
      const current = server2;
      closePromise = new Promise((resolve) => {
        try {
          current.close(() => {
            if (server2 === current)
              server2 = null;
            closePromise = null;
            resolve();
          });
        } catch {
          if (server2 === current)
            server2 = null;
          closePromise = null;
          resolve();
        }
      });
      return closePromise;
    }
  };
}

// src/lib/pricing.js
import { readFileSync as readFileSync4, writeFileSync as writeFileSync4, appendFileSync as appendFileSync4, existsSync as existsSync5, mkdirSync as mkdirSync4, statSync as statSync5, copyFileSync as copyFileSync3, renameSync as renameSync4, openSync as openSync2, closeSync as closeSync2, rmSync as rmSync2 } from "node:fs";
import { join as join5, dirname as dirname4, basename as basename4 } from "node:path";
import { homedir as homedir4, tmpdir as tmpdir3 } from "node:os";
import { createHash as createHash2 } from "node:crypto";

// src/lib/state.js
import { readFileSync as readFileSync3, writeFileSync as writeFileSync3, appendFileSync as appendFileSync3, existsSync as existsSync4, mkdirSync as mkdirSync3, statSync as statSync4, readdirSync, openSync, readSync, closeSync, rmSync, copyFileSync as copyFileSync2, renameSync as renameSync3 } from "node:fs";
import { join as join4, dirname as dirname3, basename as basename3 } from "node:path";
import { spawn } from "node:child_process";
import { homedir as homedir3, tmpdir as tmpdir2 } from "node:os";
import { createHash } from "node:crypto";

// src/lib/selection-manager.js
import { readFileSync as readFileSync2, writeFileSync as writeFileSync2, appendFileSync as appendFileSync2, existsSync as existsSync3, mkdirSync as mkdirSync2, statSync as statSync3, copyFileSync, renameSync as renameSync2 } from "node:fs";
import { join as join3, basename } from "node:path";
import { homedir as homedir2, tmpdir } from "node:os";
var USER_HOME = (() => {
  try {
    return homedir2();
  } catch {
    return tmpdir();
  }
})();
function _handleStateCorruption(path) {
  const backupDir = join3(USER_HOME, ".claude", ".backups");
  mkdirSync2(backupDir, { recursive: true });
  const backupPath = join3(backupDir, basename(path) + ".corrupted." + Date.now());
  try {
    copyFileSync(path, backupPath);
  } catch {
  }
  const logPath = join3(USER_HOME, ".claude", ".state-corruption-log.jsonl");
  try {
    appendFileSync2(logPath, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), path, backup: backupPath }) + "\n");
  } catch {
  }
}
function safeJsonParse2(raw) {
  if (raw == null || raw === "")
    return null;
  try {
    return JSON.parse(raw);
  } catch {
  }
  let cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw e;
  }
}
var DFLT_SEL = { enabled: true, active_slot: null, thinking_level: "off", flow_enabled: false, tdd_enforce: false, tdd_strict: false, tdd_quality: true, flow_enforce: false, delegation_enforce: false };
var TIERS_FILE = join3(USER_HOME, ".claude/model-tiers.json");
function loadSelection() {
  try {
    if (!existsSync3(TIERS_FILE))
      return DFLT_SEL;
    const st = statSync3(TIERS_FILE);
    if (st.size > 10485760) {
      _handleStateCorruption(TIERS_FILE);
      return DFLT_SEL;
    }
    const j = safeJsonParse2(readFileSync2(TIERS_FILE, "utf-8"));
    return {
      enabled: j?.selection?.enabled !== false,
      active_slot: j?.selection?.active_slot || null,
      thinking_level: j?.selection?.thinking_level || "off",
      flow_enabled: j?.selection?.flow_enabled === true,
      tdd_enforce: j?.selection?.tdd_enforce === true,
      tdd_strict: j?.selection?.tdd_strict === true,
      tdd_quality: j?.selection?.tdd_quality !== false,
      flow_enforce: j?.selection?.flow_enforce === true,
      delegation_enforce: j?.selection?.delegation_enforce === true
    };
  } catch {
    _handleStateCorruption(TIERS_FILE);
    return DFLT_SEL;
  }
}
function writeSelection(key, value) {
  try {
    const j = safeJsonParse2(readFileSync2(TIERS_FILE, "utf-8"));
    j.selection[key] = value;
    const tmp = TIERS_FILE + ".tmp";
    writeFileSync2(tmp, JSON.stringify(j, null, 2) + "\n");
    renameSync2(tmp, TIERS_FILE);
    return true;
  } catch (err) {
    console.error(`[vibeOS] writeSelection failed: ${err.message}`);
    return false;
  }
}
var BLACKBOX_FILE = join3(USER_HOME, ".claude/blackbox-state.json");
function loadSessionSlot(sid) {
  try {
    if (!existsSync3(BLACKBOX_FILE))
      return null;
    const j = safeJsonParse2(readFileSync2(BLACKBOX_FILE, "utf-8"));
    return j?.sessions?.[sid]?.active_slot || null;
  } catch {
    return null;
  }
}
function writeSessionSlot(sid, slot) {
  try {
    const j = existsSync3(BLACKBOX_FILE) ? safeJsonParse2(readFileSync2(BLACKBOX_FILE, "utf-8")) : {};
    if (!j.sessions)
      j.sessions = {};
    if (!j.sessions[sid])
      j.sessions[sid] = {};
    j.sessions[sid].active_slot = slot;
    const tmp = BLACKBOX_FILE + ".tmp";
    writeFileSync2(tmp, JSON.stringify(j, null, 2) + "\n");
    renameSync2(tmp, BLACKBOX_FILE);
    return true;
  } catch (err) {
    console.error("[vibeOS] writeSessionSlot failed: " + err.message);
    return false;
  }
}
function loadSessionOptMode(sid) {
  try {
    if (!existsSync3(BLACKBOX_FILE))
      return null;
    const j = safeJsonParse2(readFileSync2(BLACKBOX_FILE, "utf-8"));
    return j?.sessions?.[sid]?.optimization_mode || null;
  } catch {
    return null;
  }
}
function writeSessionOptMode(sid, mode) {
  try {
    const j = existsSync3(BLACKBOX_FILE) ? safeJsonParse2(readFileSync2(BLACKBOX_FILE, "utf-8")) : {};
    if (!j.sessions)
      j.sessions = {};
    if (!j.sessions[sid])
      j.sessions[sid] = {};
    j.sessions[sid].optimization_mode = mode;
    const tmp = BLACKBOX_FILE + ".tmp";
    writeFileSync2(tmp, JSON.stringify(j, null, 2) + "\n");
    renameSync2(tmp, BLACKBOX_FILE);
    return true;
  } catch (err) {
    console.error("[vibeOS] writeSessionOptMode failed: " + err.message);
    return false;
  }
}

// src/lib/pattern-helpers.js
import { relative, basename as basename2 } from "node:path";
function normalizeObservedPath(filePath, directory3) {
  if (!filePath || typeof filePath !== "string")
    return "unknown";
  let p = filePath;
  try {
    if (directory3 && p.startsWith("/")) {
      const rel = relative(directory3, p);
      if (rel && !rel.startsWith("..") && !rel.startsWith("/"))
        p = rel;
    }
  } catch {
  }
  p = p.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (/^(src\/index\.js|package\.json|README\.md|CHANGELOG\.md|tsconfig\.json)$/i.test(p))
    return p;
  const m = p.match(/\.([a-z0-9]+)$/i);
  if (p.startsWith("src/") && m)
    return `src/*.${m[1].toLowerCase()}`;
  if (p.startsWith("tests/") && m)
    return `tests/*.${m[1].toLowerCase()}`;
  return basename2(p) || "unknown";
}
function commandFamily(command) {
  const c = String(command || "").trim().toLowerCase();
  if (!c)
    return "unknown";
  if (/\bnode\s+--check\b/.test(c))
    return "syntax-check";
  if (/\bnpm\s+run\s+typecheck\b|\btsc\b.*--noemit/.test(c))
    return "typecheck";
  if (/\bnpm\s+test\b|\bnode\s+--test\b|\bvitest\b|\bjest\b|\bpytest\b/.test(c))
    return "test";
  if (/\bnpm\s+run\s+build\b|\btsc\s+-p\b/.test(c))
    return "build";
  if (/\bgit\s+status\b/.test(c))
    return "git-status";
  if (/\bgit\s+commit\b/.test(c))
    return "git-commit";
  const first = c.replace(/^[a-z_][a-z0-9_]*=\S+\s+/g, "").split(/\s+/)[0];
  return /^[a-z0-9._/-]{1,30}$/.test(first) ? first : "command";
}
function commandFailed(output) {
  const code = output?.exitCode ?? output?.statusCode ?? output?.code;
  if (Number.isFinite(Number(code)) && Number(code) !== 0)
    return true;
  const raw = output?.result ?? output?.text ?? output?.content ?? output?.data ?? "";
  if (typeof raw !== "string")
    return false;
  return /\b(exit code|exited with code)\s*[:=]?\s*[1-9]\b|\b(assertionerror|syntaxerror|typeerror|referenceerror)\b|\b(failed|error:|err!)\b/i.test(raw);
}
function mergeProjectBucket(dst, src) {
  const a = dst || {};
  const b = src || {};
  const topics = [.../* @__PURE__ */ new Set([...a.commonTopics || [], ...b.commonTopics || []])].slice(-20);
  const mergePatterns = (kind) => {
    const out = {};
    for (const srcObj of [a.userPatterns?.[kind], b.userPatterns?.[kind]]) {
      for (const [key, val] of Object.entries(srcObj || {})) {
        const v = val;
        const row = out[key] || { count: 0, sessions: [], lastSeen: null, summary: v?.summary || "" };
        row.count += Number(v?.count || 0);
        row.sessions = [.../* @__PURE__ */ new Set([...row.sessions || [], ...v?.sessions || []])].slice(-10);
        row.lastSeen = [row.lastSeen, v?.lastSeen].filter(Boolean).sort().slice(-1)[0] || null;
        row.summary = row.summary || v?.summary || "";
        if (v?.kind)
          row.kind = v.kind;
        out[key] = row;
      }
    }
    return out;
  };
  return {
    totalSessions: (a.totalSessions || 0) + (b.totalSessions || 0),
    researchChains: Math.max(a.researchChains || 0, b.researchChains || 0),
    context7Bypasses: (a.context7Bypasses || 0) + (b.context7Bypasses || 0),
    commonTopics: topics,
    userPatterns: {
      friction: mergePatterns("friction"),
      routines: mergePatterns("routines")
    },
    lastSeen: [a.lastSeen, b.lastSeen].filter(Boolean).sort().slice(-1)[0] || (/* @__PURE__ */ new Date()).toISOString()
  };
}
function _pruneOldSessions(state) {
  if (!state?.sessions)
    return;
  const entries = Object.entries(state.sessions);
  if (entries.length <= 30)
    return;
  entries.sort((a, b) => {
    const da = a[1]?.started || a[1]?.last_costed || "";
    const db = b[1]?.started || b[1]?.last_costed || "";
    return db.localeCompare(da);
  });
  state.sessions = Object.fromEntries(entries.slice(0, 30));
}
function _computeSessionMetrics(state, sid) {
  const session = state?.sessions?.[sid] || {};
  const warns = Array.isArray(session?.warns) ? session.warns : [];
  const toolCounts = session?.tool_counts || {};
  const toolBreakdown = {};
  for (const [t, c] of Object.entries(toolCounts)) {
    toolBreakdown[String(t)] = Number(c || 0);
  }
  const startedAt = session?.started ? new Date(session.started).getTime() : Date.now();
  const durationSec = Math.floor((Date.now() - startedAt) / 1e3);
  const hours = Math.max(durationSec / 3600, 1e-3);
  return {
    ltTasks: Number(state?.lifetime?.total_savings_usd || state?.lifetime?.est_savings_usd || 0),
    ltCache: Number(state?.lifetime?.cache_savings_usd || 0),
    missedC7: Number(state?.lifetime?.missed_context7_usd || 0),
    count: warns.length,
    sesTasks: Number(session?.total_savings_usd || 0),
    sesDuration: durationSec,
    sesRatePerHour: Number((((session?.total_savings_usd || 0) + (session?.cache_savings_usd || 0)) / hours).toFixed(2)),
    sesTrend: "stable",
    sesToolBreakdown: toolBreakdown,
    sesModelTurns: session?.model_turns || { brain: 0, worker: 0 },
    quality_avg: 0
  };
}

// src/vibeOS-lib/ml-router.js
var SIMPLE_ACTIONS = /* @__PURE__ */ new Set([
  "check",
  "find",
  "list",
  "search",
  "look",
  "count",
  "show",
  "get",
  "read",
  "grep",
  "scan",
  "detect",
  "inspect",
  "ls",
  "cat",
  "head",
  "tail",
  "which",
  "where",
  "describe",
  "explain",
  "summarize",
  "what",
  "how",
  "does",
  "is",
  "are",
  "can",
  "will"
]);
var COMPLEX_ACTIONS = /* @__PURE__ */ new Set([
  "implement",
  "refactor",
  "migrate",
  "redesign",
  "architect",
  "optimize",
  "debug",
  "diagnose",
  "fix",
  "resolve",
  "patch",
  "build",
  "deploy",
  "integrate",
  "orchestrate",
  "pipeline",
  "benchmark",
  "profile",
  "secure",
  "harden",
  "audit",
  "design",
  "create",
  "generate",
  "transform",
  "convert",
  "setup",
  "configure",
  "provision",
  "bootstrap"
]);
var ERROR_SIGNAL_WORDS = /bug|error|fail|crash|broken|wrong|incorrect|issue|problem|exception|stackoverflow|traceback|segfault|race|deadlock|leak|corrupt/;
var COMPLEXITY_INDICATORS = /multi.*(?:file|module|step|stage|phase|tenant|region|thread|process)|concurrent|async|parallel|distributed|replicated|shard|cluster|microservice|framework|database|schema|migration|backward.*compat|breaking.*change|api.*(?:version|breaking)|protocol|encoding|serializ/;
var FILE_PATH_PATTERN = /(?:^|[\s"'(])\.{0,2}\/[a-zA-Z0-9._/-]+|\.(?:js|ts|tsx|jsx|py|rs|go|java|cpp|c|h|json|yaml|yml|toml|sql|css|html|md)\b|package\.json|tsconfig\.json|dockerfile|makefile|docker-compose/i;
var WORD_FREQUENCY = {
  "test": 1,
  "tests": 1,
  "unit": 1,
  "integration": 1,
  "e2e": 1,
  "coverage": 1,
  "type": 0.9,
  "interface": 0.8,
  "class": 0.7,
  "function": 0.5,
  "method": 0.5,
  "async": 0.5,
  "await": 0.5,
  "promise": 0.5,
  "callback": 0.6,
  "import": 0.4,
  "export": 0.4,
  "require": 0.3,
  "module": 0.5,
  "api": 0.7,
  "endpoint": 0.7,
  "route": 0.6,
  "middleware": 0.7,
  "handler": 0.5,
  "database": 0.8,
  "query": 0.5,
  "migration": 0.8,
  "schema": 0.7,
  "index": 0.4,
  "docker": 0.7,
  "container": 0.7,
  "compose": 0.8,
  "kubernetes": 0.9,
  "deploy": 0.7,
  "ci": 0.7,
  "cd": 0.7,
  "pipeline": 0.7,
  "workflow": 0.4,
  "action": 0.3,
  "auth": 0.7,
  "authn": 0.9,
  "authz": 0.9,
  "token": 0.6,
  "jwt": 0.7,
  "oauth": 0.8,
  "security": 0.8,
  "vuln": 1,
  "exploit": 1,
  "injection": 0.9,
  "xss": 0.9,
  "csrf": 0.8,
  "cache": 0.6,
  "redis": 0.7,
  "memcache": 0.7,
  "persist": 0.6,
  "session": 0.5,
  "refactor": 0.7,
  "migrate": 0.8,
  "upgrade": 0.5,
  "deprecate": 0.6,
  "performance": 0.7,
  "latency": 0.7,
  "throughput": 0.8,
  "bottleneck": 0.8,
  "log": 0.3,
  "error": 0.4,
  "debug": 0.5,
  "trace": 0.6,
  "monitor": 0.5,
  "alert": 0.5,
  "commit": 0.3,
  "branch": 0.4,
  "merge": 0.4,
  "rebase": 0.5,
  "pr": 0.3,
  "review": 0.4,
  "npm": 0.3,
  "yarn": 0.3,
  "pnpm": 0.3,
  "install": 0.2,
  "build": 0.4,
  "lint": 0.4
};
function extractFeatures(prompt) {
  const s = String(prompt || "").trim();
  const words = s.split(/\s+/);
  const lower = s.toLowerCase();
  const fileMentions = (lower.match(FILE_PATH_PATTERN) || []).length;
  const errorSignals = (lower.match(ERROR_SIGNAL_WORDS) || []).length;
  let complexityWords = 0;
  for (const w of words) {
    if (COMPLEXITY_INDICATORS.test(w.toLowerCase()))
      complexityWords++;
  }
  let actionDensity = 0;
  for (const w of words.slice(0, 8)) {
    if (COMPLEX_ACTIONS.has(w.toLowerCase())) {
      actionDensity += 0.15;
    } else if (SIMPLE_ACTIONS.has(w.toLowerCase())) {
      actionDensity -= 0.05;
    }
  }
  actionDensity = Math.max(0, Math.min(1, actionDensity));
  const questionDensity = (lower.match(/\?/g) || []).length / Math.max(1, words.length);
  return {
    length: s.length,
    wordCount: words.length,
    fileMentions,
    errorSignals,
    actionDensity,
    argCount: (s.match(/-{1,2}[a-zA-Z][\w-]*/g) || []).length,
    complexityWords,
    questionDensity
  };
}
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}
function wordComplexityScore(words) {
  let score = 0;
  let count = 0;
  for (const w of words.slice(0, 20)) {
    const lw = w.toLowerCase();
    const freq = WORD_FREQUENCY[lw];
    if (freq !== void 0) {
      score += freq;
      count++;
    }
  }
  return count > 0 ? score / count : 0.3;
}
function computeDifficulty(prompt) {
  const features = extractFeatures(prompt);
  const s = String(prompt || "").trim();
  const words = s.split(/\s+/);
  const lower = s.toLowerCase();
  let score = 0;
  score += sigmoid((words.length - 20) / 30) * 0.2;
  if (features.fileMentions >= 5)
    score += 0.12;
  else if (features.fileMentions >= 3)
    score += 0.08;
  else if (features.fileMentions >= 1)
    score += 0.04;
  if (features.errorSignals >= 3)
    score += 0.15;
  else if (features.errorSignals >= 1)
    score += 0.07;
  score += features.actionDensity * 0.18;
  if (features.complexityWords >= 4)
    score += 0.15;
  else if (features.complexityWords >= 2)
    score += 0.08;
  else if (features.complexityWords >= 1)
    score += 0.04;
  score += features.questionDensity * 0.08;
  score += sigmoid((features.argCount - 3) / 5) * 0.07;
  const wcs = wordComplexityScore(words);
  score += wcs * 0.15;
  const firstWord = words[0]?.toLowerCase() || "";
  if (COMPLEX_ACTIONS.has(firstWord))
    score += 0.05;
  let level;
  if (score < 0.3)
    level = "simple";
  else if (score < 0.55)
    level = "moderate";
  else
    level = "complex";
  let suggestedTier;
  if (level === "simple")
    suggestedTier = "cheap";
  else if (level === "moderate")
    suggestedTier = "medium";
  else
    suggestedTier = "brain";
  let confidence;
  if (score < 0.15 || score > 0.75)
    confidence = 0.85;
  else if (score < 0.25 || score > 0.65)
    confidence = 0.7;
  else
    confidence = 0.5;
  return { score, level, features, confidence, suggestedTier };
}
function createPatternGraph() {
  return {
    nodes: {},
    tiers: { cheap: [], medium: [], brain: [] }
  };
}
function ensureNode(graph, id2, kind) {
  graph.nodes[id2] ??= { id: id2, kind, count: 0, lastSeen: "", edges: {} };
  return graph.nodes[id2];
}
function addRouteEdge(graph, queryWord, modelName, tier, success) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const key = `${queryWord}::${modelName}`;
  ensureNode(graph, queryWord, "query");
  ensureNode(graph, modelName, "model");
  const outcomeNode = ensureNode(graph, `${key}::${success ? "ok" : "fail"}`, "outcome");
  const queryNode = graph.nodes[queryWord];
  queryNode.count++;
  queryNode.lastSeen = now;
  queryNode.edges[modelName] = (queryNode.edges[modelName] || 0) + 1;
  const modelNode = graph.nodes[modelName];
  modelNode.count++;
  modelNode.lastSeen = now;
  modelNode.edges[outcomeNode.id] = (modelNode.edges[outcomeNode.id] || 0) + 1;
  outcomeNode.count++;
  outcomeNode.lastSeen = now;
  const normalizedTier = tier === "budget" || tier === "low" ? "cheap" : tier === "mid" ? "medium" : tier === "high" ? "brain" : tier;
  const tierKey = success ? normalizedTier : normalizedTier;
  graph.tiers[normalizedTier] ??= [];
  if (!graph.tiers[normalizedTier].includes(modelName)) {
    graph.tiers[normalizedTier].push(modelName);
    graph.tiers[normalizedTier].sort();
  }
}
function predictBestModel(graph, firstWord, tierPreference) {
  const node = graph.nodes[firstWord];
  if (!node || Object.keys(node.edges).length === 0)
    return null;
  const edges = node.edges;
  let bestModel = "";
  let bestScore = 0;
  for (const [model, count] of Object.entries(edges)) {
    const modelNode = graph.nodes[model];
    if (!modelNode)
      continue;
    const okEdges = Object.entries(modelNode.edges).filter(([k]) => k.endsWith("::ok")).reduce((sum, [, c]) => sum + c, 0);
    const totalEdges = Object.values(modelNode.edges).reduce((a, b) => a + b, 0) || 1;
    const successRate = totalEdges > 0 ? okEdges / totalEdges : 0.5;
    const tierBoost = graph.tiers.brain.includes(model) ? 0.1 : graph.tiers.medium.includes(model) ? 0.05 : 0;
    const prefBoost = model.includes(tierPreference) ? 0.05 : 0;
    const score = count * 0.3 + successRate * 0.5 + tierBoost + prefBoost;
    if (score > bestScore) {
      bestScore = score;
      bestModel = model;
    }
  }
  return bestModel || null;
}
function deserializeGraph(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.nodes && parsed.tiers) {
      return parsed;
    }
  } catch {
  }
  return createPatternGraph();
}
function hashQuery(prompt) {
  const s = String(prompt || "").trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    hash = (hash << 5) - hash + ch;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}

// src/vibeOS-lib/smart-cache.js
function tokenize(text) {
  return String(text || "").toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 1);
}
function wordSet(words) {
  return new Set(words);
}
function jaccardSimilarity(a, b) {
  const wa = wordSet(tokenize(a));
  const wb = wordSet(tokenize(b));
  if (wa.size === 0 && wb.size === 0)
    return 0;
  let intersection = 0;
  for (const w of wa) {
    if (wb.has(w))
      intersection++;
  }
  const union = wa.size + wb.size - intersection;
  return union > 0 ? intersection / union : 0;
}
function bigrams(words) {
  const bg = /* @__PURE__ */ new Set();
  for (let i = 0; i < words.length - 1; i++) {
    bg.add(`${words[i]}_${words[i + 1]}`);
  }
  return bg;
}
function cosineSimilarity(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || tb.length === 0)
    return 0;
  const ba = bigrams(ta);
  const bb = bigrams(tb);
  if (ba.size === 0 && bb.size === 0)
    return 0;
  const allBigrams = /* @__PURE__ */ new Set([...ba, ...bb]);
  let dotProduct = 0;
  let magA = 0;
  let magB = 0;
  for (const bg of allBigrams) {
    const inA = ba.has(bg) ? 1 : 0;
    const inB = bb.has(bg) ? 1 : 0;
    dotProduct += inA * inB;
    magA += inA * inA;
    magB += inB * inB;
  }
  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  return denominator > 0 ? dotProduct / denominator : 0;
}
var CACHE_HIGH_WEIGHT_WORDS = /* @__PURE__ */ new Set([
  "test",
  "tests",
  "build",
  "lint",
  "typecheck",
  "deploy",
  "install",
  "npm",
  "yarn",
  "docker",
  "compose",
  "api",
  "endpoint",
  "schema",
  "migration",
  "database",
  "query",
  "config",
  "package.json",
  "tsconfig",
  "readme",
  "changelog",
  "agent",
  "index",
  "main",
  "app",
  "server"
]);
function keywordOverlapScore(a, b) {
  const wa = tokenize(a);
  const wb = tokenize(b);
  if (wa.length === 0 || wb.length === 0)
    return 0;
  let score = 0;
  let maxScore = 0;
  for (const w of wa) {
    const weight = CACHE_HIGH_WEIGHT_WORDS.has(w) ? 3 : 1;
    maxScore += weight;
    if (wb.includes(w))
      score += weight;
  }
  return maxScore > 0 ? score / maxScore : 0;
}
function compositeSimilarity(a, b) {
  return jaccardSimilarity(a, b) * 0.35 + cosineSimilarity(a, b) * 0.35 + keywordOverlapScore(a, b) * 0.3;
}
function createCacheDatabase() {
  return { entries: [], stats: {} };
}
function addCacheEntry(db, hash, tool2, prompt, sizeBytes, ageSec) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const idx = db.entries.findIndex((e) => e.hash === hash);
  if (idx >= 0) {
    db.entries[idx].at = now;
    db.entries[idx].ageSec = ageSec;
    return;
  }
  db.entries.push({
    hash,
    tool: tool2,
    prompt,
    sizeBytes,
    at: now,
    ageSec,
    words: tokenize(prompt)
  });
  if (db.entries.length > 500) {
    db.entries.sort((a, b) => b.at.localeCompare(a.at));
    db.entries.length = 500;
  }
}
function recordCacheStats(db, tool2, hit, bytesSaved) {
  db.stats[tool2] ??= { tool: tool2, hits: 0, total: 0, bytesSaved: 0, lastHit: "", hitRate: 0 };
  const s = db.stats[tool2];
  s.total++;
  if (hit) {
    s.hits++;
    s.bytesSaved += bytesSaved;
    s.lastHit = (/* @__PURE__ */ new Date()).toISOString();
  }
  s.hitRate = s.total > 0 ? s.hitRate * 0.9 + (hit ? 0.1 : 0) : 0;
}
function predictCacheHit(db, tool2, prompt) {
  const stats = db.stats[tool2];
  const toolHitRate = stats?.hitRate ?? 0.3;
  const similarEntries = [];
  for (const entry of db.entries) {
    if (entry.tool !== tool2)
      continue;
    const score = compositeSimilarity(prompt, entry.prompt);
    if (score > 0.4) {
      similarEntries.push({ hash: entry.hash, score, entry });
    }
  }
  similarEntries.sort((a, b) => b.score - a.score);
  if (similarEntries.length === 0) {
    return {
      shouldCache: toolHitRate > 0.4,
      shouldWarm: false,
      confidence: toolHitRate,
      reason: `no similar entries found; tool hit rate: ${(toolHitRate * 100).toFixed(0)}%`,
      similarEntries: [],
      estimatedSavings: 0
    };
  }
  const best = similarEntries[0];
  if (best.score >= 0.75) {
    return {
      shouldCache: true,
      shouldWarm: true,
      confidence: best.score,
      reason: `high similarity (${(best.score * 100).toFixed(0)}%) with previous cache entry`,
      similarEntries: similarEntries.slice(0, 3),
      estimatedSavings: Math.round(best.entry.sizeBytes / 4 * 0.1 / 1e6 * 1e3) / 1e3
    };
  }
  if (best.score >= 0.5) {
    return {
      shouldCache: true,
      shouldWarm: toolHitRate > 0.5,
      confidence: best.score,
      reason: `moderate similarity (${(best.score * 100).toFixed(0)}%) with previous entry`,
      similarEntries: similarEntries.slice(0, 2),
      estimatedSavings: Math.round(best.entry.sizeBytes / 4 * 0.1 / 1e6 * 1e3) / 1e3 * 0.5
    };
  }
  return {
    shouldCache: toolHitRate > 0.3,
    shouldWarm: false,
    confidence: Math.max(0.2, toolHitRate),
    reason: `low similarity, relying on tool hit rate: ${(toolHitRate * 100).toFixed(0)}%`,
    similarEntries: [],
    estimatedSavings: 0
  };
}
function evictStaleEntries(db, maxAgeSec) {
  const now = Date.now();
  const before = db.entries.length;
  db.entries = db.entries.filter((e) => {
    const entryTime = new Date(e.at).getTime();
    return (now - entryTime) / 1e3 < maxAgeSec;
  });
  return before - db.entries.length;
}
function deserializeCacheDb(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.entries)) {
      return parsed;
    }
  } catch {
  }
  return createCacheDatabase();
}

// src/lib/state.js
var USER_HOME2 = (() => {
  try {
    return homedir3();
  } catch {
    return tmpdir2();
  }
})();
var FILE_LOCK_DIR = join4(USER_HOME2, ".claude/.vibeOS-locks");
var DELEGATION_STATE_FILE = join4(USER_HOME2, ".claude/delegation-state.json");
var SAVINGS_LEDGER_FILE = join4(USER_HOME2, ".claude/savings-ledger.jsonl");
var GLOBAL_LEARNING_FILE = join4(USER_HOME2, ".claude/global-learning.json");
var PRICING_CACHE_FILE = join4(USER_HOME2, ".claude/model-pricing-cache.json");
var BLACKBOX_STATE_FILE = join4(USER_HOME2, ".claude/blackbox-state.json");
var PROJECT_STATE_FILE = join4(USER_HOME2, ".claude/project-states.json");
var TIERS_FILE2 = join4(USER_HOME2, ".claude/model-tiers.json");
var ACTIVE_JOBS_FILE = join4(USER_HOME2, ".claude/active-jobs.json");
var AUTH_F = join4(USER_HOME2, ".local", "share", "opencode", "auth.json");
var CREDIT_CACHE_F = join4(USER_HOME2, ".claude/credit-snapshot.json");
var FLOW_TODO_QUEUE_FILE = join4(USER_HOME2, ".claude/.flow-todo-queue.jsonl");
var FLOW_DEDUP_FILE2 = join4(USER_HOME2, ".claude/.flow-dedup-keys.json");
var ENFORCEMENT_COOLDOWN_FILE = join4(USER_HOME2, ".claude/.enforcement-cooldown.jsonl");
var REPORTS_DIR = join4(USER_HOME2, ".claude/reports");
var CONTEXT7_INSTALL_FLAG = join4(USER_HOME2, ".claude/.context7-install-suggested");
var TRINITY_OPENCODE_CONFIG = join4(USER_HOME2, ".config/opencode/opencode.json");
var TRINITY_OPENCODE_CONFIGC = join4(USER_HOME2, ".config/opencode/opencode.jsonc");
var SCRATCHPAD_ROOT = join4(USER_HOME2, ".claude/scratch");
var SCRATCHPAD_GLOBAL_DIR = join4(SCRATCHPAD_ROOT, "by-hash");
var SCRATCHPAD_SESSIONS_DIR = join4(SCRATCHPAD_ROOT, "sessions");
var SCRATCHPAD_SESSION_TTL_MS = 48 * 60 * 60 * 1e3;
var SCRATCHPAD_MAX_AGE_SEC = Number(process.env.CLAUDE_SCRATCHPAD_MAX_AGE_SEC || 86400);
var MAX_SCRATCHPAD_FILES = 1e3;
var MAX_SCRATCHPAD_BYTES = 10 * 1024 * 1024;
var MAX_SESSION_SCRATCHPAD_FILES = 200;
var MAX_SESSION_SCRATCHPAD_BYTES = 2 * 1024 * 1024;
var DECADENCE_FRESH_MS = 5 * 60 * 1e3;
var DECADENCE_WARM_MS = 60 * 60 * 1e3;
var DECADENCE_COLD_MS = 24 * 60 * 60 * 1e3;
var DECADENCE_EXPIRE_MS = 48 * 60 * 60 * 1e3;
var DECADENCE_THROTTLE_MS = 60 * 1e3;
var DECADENCE_GLOBAL_THROTTLE_MS = 5 * 60 * 1e3;
var TOOL_NAME_NORMALIZE = {
  read: "Read",
  bash: "Bash",
  grep: "Grep",
  glob: "Glob",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  list: "LS",
  "context7_query-docs": "Context7QueryDocs",
  "context7_resolve-library-id": "Context7ResolveLibrary",
  obsidian: "Obsidian"
};
var SCRATCHPAD_TOOLS = new Set(Object.keys(TOOL_NAME_NORMALIZE));
var WARN_DEDUPE_WINDOW_MS = 120 * 1e3;
var SOFT_QUOTA_LIMIT = 5;
var _OC_SID = "opencode-" + (process.pid || "x") + "-" + Date.now();
var _sessionStart = Date.now();
var currentTier = null;
var currentModel = null;
var currentProjectFingerprint = "";
var currentProjectName = "";
function setCurrentTier(v) {
  currentTier = v;
}
function setCurrentModel(v) {
  currentModel = v;
}
function setCurrentProjectFingerprint2(v) {
  currentProjectFingerprint = v;
}
function setCurrentProjectName(v) {
  currentProjectName = v;
}
var recentToolEvents = [];
var frictionSessionKeys = /* @__PURE__ */ new Set();
var routineSessionKeys = /* @__PURE__ */ new Set();
var lastMutationEvent = null;
function setLastMutationEvent(v) {
  lastMutationEvent = v;
}
var _savingsCache = null;
var _savingsCacheMtime = 0;
var _ledgerReconciledMtime = 0;
var _mlGraph = createPatternGraph();
var _cacheDb = createCacheDatabase();
var ML_ENABLED = true;
var ML_CONFIDENCE_THRESHOLD = 0.6;
var _mlSavePending = false;
function setMlSavePending(v) {
  _mlSavePending = v;
}
var _blackboxEnabled = true;
function setBlackboxEnabled(val) {
  _blackboxEnabled = val;
}
var _latestBlackboxState = null;
var _modelLocked = false;
var _patternFiredKeys = /* @__PURE__ */ new Set();
var _sessionCleanupRegistered = false;
var _sessionCacheCleaned = false;
var prunedThisProcess = false;
var _lastDecadenceRun = 0;
var _lastGlobalDecadenceRun = 0;
var _ledgerBuffer = [];
var _ledgerBufferTimer = null;
function setLedgerBufferTimer(val) {
  _ledgerBufferTimer = val;
}
var LEDGER_BUFFER_MAX = 10;
var LEDGER_BUFFER_FLUSH_MS = 5e3;
var testReminderSeen = /* @__PURE__ */ new Set();
var DFLT_GL = { exploratory_words: {}, task_first_words: {}, updatedAt: null };
function _zType(base) {
  return Object.assign((...a) => _zType({ ...base, args: a }), {
    optional: () => _zType({ ...base, optional: true }),
    _isZod: true,
    _base: base
  });
}
var tool = Object.assign((def) => def, {
  schema: {
    string: (o) => _zType({ kind: "string", ...o || {} }),
    number: (o) => _zType({ kind: "number", ...o || {} }),
    enum: (values) => _zType({ kind: "enum", values })
  }
});
function _handleStateCorruption2(path) {
  const backupDir = join4(USER_HOME2, ".claude", ".backups");
  mkdirSync3(backupDir, { recursive: true });
  const backupPath = join4(backupDir, basename3(path) + ".corrupted." + Date.now());
  try {
    copyFileSync2(path, backupPath);
  } catch {
  }
  const logPath = join4(USER_HOME2, ".claude", ".state-corruption-log.jsonl");
  try {
    appendFileSync3(logPath, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), path, backup: backupPath }) + "\n");
  } catch {
  }
}
function _lockPathFor(filePath) {
  const hash = createHash("sha1").update(String(filePath || "")).digest("hex");
  return join4(FILE_LOCK_DIR, `${hash}.lock`);
}
function withFileLock(filePath, fn, opts = {}) {
  const staleMs = Number(opts.staleMs || 3e4);
  const timeoutMs = Number(opts.timeoutMs || 2e3);
  const lockPath = _lockPathFor(filePath);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      mkdirSync3(FILE_LOCK_DIR, { recursive: true });
      const fd = openSync(lockPath, "wx");
      try {
        writeFileSync3(fd, `${process.pid}
${Date.now()}
`);
      } catch {
      }
      try {
        return fn();
      } finally {
        try {
          closeSync(fd);
        } catch {
        }
        try {
          rmSync(lockPath, { force: true });
        } catch {
        }
      }
    } catch (err) {
      try {
        if (existsSync4(lockPath)) {
          const age = Date.now() - statSync4(lockPath).mtimeMs;
          if (age > staleMs) {
            try {
              rmSync(lockPath, { force: true });
            } catch {
            }
          }
        }
      } catch {
      }
    }
  }
  throw new Error(`[vibeOS] lock not acquired for ${filePath} after ${timeoutMs}ms`);
}
function safeJsonParse3(raw) {
  if (raw == null || raw === "")
    return null;
  try {
    return JSON.parse(raw);
  } catch {
  }
  let cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw e;
  }
}
function validateState(state, path) {
  if (!state || typeof state !== "object") {
    console.error(`[vibeOS] State validation failed: not an object at ${path}`);
    return;
  }
  if (state.session_started_at && isNaN(Date.parse(state.session_started_at))) {
    console.error(`[vibeOS] State validation warning: invalid session_started_at at ${path}, resetting`);
    state.session_started_at = (/* @__PURE__ */ new Date()).toISOString();
  }
  if (state.sessions && Array.isArray(state.sessions)) {
    console.error(`[vibeOS] State validation: converting legacy sessions array to object at ${path}`);
    state.sessions = {};
  } else if (state.sessions && !Array.isArray(state.sessions) && (typeof state.sessions !== "object" || state.sessions === null)) {
    console.error(`[vibeOS] State validation warning: sessions is invalid type at ${path}, resetting`);
    state.sessions = {};
  }
  if (state.lifetime && typeof state.lifetime !== "object") {
    console.error(`[vibeOS] State validation warning: lifetime is not object at ${path}, resetting`);
    state.lifetime = {};
  }
}
function readJsonOrEmpty(filePath) {
  try {
    if (!existsSync4(filePath))
      return {};
    const st = statSync4(filePath);
    if (st.size > 10485760) {
      _handleStateCorruption2(filePath);
      return {};
    }
    return safeJsonParse3(readFileSync3(filePath, "utf-8"));
  } catch {
    _handleStateCorruption2(filePath);
    return {};
  }
}
function updateState(mutator) {
  const MAX_RETRIES2 = 3;
  for (let attempt = 0; attempt < MAX_RETRIES2; attempt++) {
    try {
      const result = withFileLock(DELEGATION_STATE_FILE, () => {
        const preGen = readJsonOrEmpty(DELEGATION_STATE_FILE)._gen || 0;
        let state = readJsonOrEmpty(DELEGATION_STATE_FILE);
        if (!state || typeof state !== "object")
          state = {};
        if (!state.session_started_at || state.session_started_at === "not-a-valid-date" || isNaN(Date.parse(state.session_started_at))) {
          state.session_started_at = (/* @__PURE__ */ new Date()).toISOString();
        }
        state.lifetime ??= {};
        state.lifetime.missed_context7_usd ??= 0;
        state.lifetime.cache_savings_usd ??= 0;
        state.lifetime.total_savings_usd ??= 0;
        state._ledgerFormatVersion ??= 2;
        state._gen = preGen + 1;
        const next = mutator(state) ?? state;
        validateState(next, DELEGATION_STATE_FILE);
        mkdirSync3(dirname3(DELEGATION_STATE_FILE), { recursive: true });
        const tmp = DELEGATION_STATE_FILE + ".tmp";
        writeFileSync3(tmp, JSON.stringify(next, null, 2) + "\n");
        renameSync3(tmp, DELEGATION_STATE_FILE);
        return next;
      });
      return result;
    } catch (err) {
      if (attempt === MAX_RETRIES2 - 1) {
        console.error(`[vibeOS] updateState failed after ${MAX_RETRIES2} retries: ${err.message}`);
        return null;
      }
    }
  }
  return null;
}
function readFullState() {
  try {
    if (!existsSync4(DELEGATION_STATE_FILE))
      return {};
    const st = statSync4(DELEGATION_STATE_FILE);
    if (st.size > 10485760) {
      _handleStateCorruption2(DELEGATION_STATE_FILE);
      return {};
    }
    return safeJsonParse3(readFileSync3(DELEGATION_STATE_FILE, "utf-8"));
  } catch {
    _handleStateCorruption2(DELEGATION_STATE_FILE);
    return {};
  }
}
function roundUsd(v) {
  return Math.round((Number(v) || 0) * 1e4) / 1e4;
}
var FALLBACK_HIGH = /opus|gemini-.*-pro|deepseek\/deepseek-v4-pro|gpt-5|(^|\/)o[134]($|-|\/)/i;
var FALLBACK_MID = /deepseek\/deepseek-v4-flash|claude.*sonnet|gemini-.*-flash|gpt-4o(?!-mini)/i;
function _safeRegex(cfg, fallback, label) {
  if (!cfg)
    return fallback;
  try {
    return new RegExp(cfg, "i");
  } catch (e) {
    console.error(`[vibeOS] Invalid ${label}-tier regex in model-tiers.json: ${e.message}. Falling back.`);
    return fallback;
  }
}
function loadTierRegexes() {
  try {
    const p = join4(USER_HOME2, ".claude/model-tiers.json");
    if (!existsSync4(p))
      return { high: FALLBACK_HIGH, mid: FALLBACK_MID };
    const j = safeJsonParse3(readFileSync3(p, "utf-8"));
    const highRe = _safeRegex(j?.tiers?.high?.regex, FALLBACK_HIGH, "high");
    const midRe = _safeRegex(j?.tiers?.mid?.regex, FALLBACK_MID, "mid");
    return { high: highRe, mid: midRe };
  } catch {
    return { high: FALLBACK_HIGH, mid: FALLBACK_MID };
  }
}
var { high: HIGH_TIER_RE, mid: MID_TIER_RE } = loadTierRegexes();
function loadGlobalLearning() {
  try {
    if (!existsSync4(GLOBAL_LEARNING_FILE))
      return DFLT_GL;
    const st = statSync4(GLOBAL_LEARNING_FILE);
    if (st.size > 10485760) {
      _handleStateCorruption2(GLOBAL_LEARNING_FILE);
      return DFLT_GL;
    }
    const j = safeJsonParse3(readFileSync3(GLOBAL_LEARNING_FILE, "utf-8"));
    if (!j || typeof j !== "object")
      return DFLT_GL;
    j.exploratory_words ??= {};
    j.task_first_words ??= {};
    return j;
  } catch {
    _handleStateCorruption2(GLOBAL_LEARNING_FILE);
    return DFLT_GL;
  }
}
function updateGlobalLearning(mutator) {
  return withFileLock(GLOBAL_LEARNING_FILE, () => {
    const s = loadGlobalLearning();
    const next = mutator(s) ?? s;
    next.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    mkdirSync3(dirname3(GLOBAL_LEARNING_FILE), { recursive: true });
    const tmp = GLOBAL_LEARNING_FILE + ".tmp";
    writeFileSync3(tmp, JSON.stringify(next, null, 2));
    renameSync3(tmp, GLOBAL_LEARNING_FILE);
    return next;
  });
}
function loadMLState() {
  try {
    const gl = loadGlobalLearning();
    if (gl.ml_graph_raw)
      _mlGraph = deserializeGraph(gl.ml_graph_raw);
    if (gl.ml_cache_raw)
      _cacheDb = deserializeCacheDb(gl.ml_cache_raw);
    evictStaleEntries(_cacheDb, 86400 * 7);
  } catch {
  }
}
function saveMLState() {
  if (!ML_ENABLED)
    return false;
  try {
    updateGlobalLearning((gl) => {
      gl.ml_graph_raw = JSON.stringify(_mlGraph);
      gl.ml_cache_raw = JSON.stringify(_cacheDb);
      return gl;
    });
    return true;
  } catch {
    return false;
  }
}
loadMLState();
function getSessionRoot() {
  return join4(SCRATCHPAD_SESSIONS_DIR, _OC_SID);
}
function getSessionScratchpadDir() {
  return join4(getSessionRoot(), "by-hash");
}
function getSessionIndexPath() {
  return join4(getSessionRoot(), "index.jsonl");
}
function getGlobalIndexPath() {
  return join4(SCRATCHPAD_ROOT, "index.jsonl");
}
function ensureSessionScratchpadDirs() {
  try {
    mkdirSync3(getSessionScratchpadDir(), { recursive: true });
    return true;
  } catch {
    return false;
  }
}
function safeCopyIntoSession(hash, fromPath) {
  try {
    if (!ensureSessionScratchpadDirs())
      return;
    const sessionPath = join4(getSessionScratchpadDir(), `${hash}.txt`);
    if (!existsSync4(sessionPath)) {
      copyFileSync2(fromPath, sessionPath);
      const globalSummary = join4(SCRATCHPAD_GLOBAL_DIR, `${hash}.summary.txt`);
      const sessionSummary = join4(getSessionScratchpadDir(), `${hash}.summary.txt`);
      if (existsSync4(globalSummary) && !existsSync4(sessionSummary)) {
        copyFileSync2(globalSummary, sessionSummary);
      }
    }
  } catch {
  }
}
function cleanupCurrentSessionScratchpad() {
  if (_sessionCacheCleaned)
    return;
  _sessionCacheCleaned = true;
  try {
    rmSync(getSessionRoot(), { recursive: true, force: true });
  } catch {
  }
}
function registerSessionCleanupHandlers() {
  if (_sessionCleanupRegistered)
    return;
  _sessionCleanupRegistered = true;
  if (process._vibeOS_cleanupRegistered)
    return;
  process._vibeOS_cleanupRegistered = true;
  process.setMaxListeners(20);
  ensureSessionScratchpadDirs();
  process.on("exit", () => {
    _flushLedgerBuffer();
    cleanupCurrentSessionScratchpad();
  });
  process.on("SIGINT", () => {
    cleanupCurrentSessionScratchpad();
    process.exit(130);
  });
}
function _flushLedgerBuffer() {
  if (_ledgerBufferTimer) {
    clearTimeout(_ledgerBufferTimer);
    _ledgerBufferTimer = null;
  }
  if (_ledgerBuffer.length === 0)
    return;
  const batch = _ledgerBuffer.splice(0);
  const lines = batch.map((e) => typeof e === "string" ? e.trimEnd() : String(e).trimEnd());
  const joined = lines.filter(Boolean).map((l) => l + "\n").join("");
  try {
    appendFileSync3(SAVINGS_LEDGER_FILE, joined);
  } catch {
  }
}
function stableJson(obj) {
  if (obj === null || typeof obj !== "object")
    return JSON.stringify(obj);
  if (Array.isArray(obj))
    return "[" + obj.map(stableJson).join(",") + "]";
  return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + stableJson(obj[k])).join(",") + "}";
}
function _readHead(fullPath) {
  try {
    const buf = Buffer.alloc(120);
    const fd = openSync(fullPath, "r");
    const { bytesRead } = readSync(fd, buf, 0, 120, 0);
    closeSync(fd);
    return buf.toString("utf-8", 0, bytesRead);
  } catch {
    return "";
  }
}
function indexAppend(hash, tool2, size, extra) {
  try {
    const entryObj = {
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      hash,
      tool: tool2,
      size,
      pid: process.pid || 0,
      session: _OC_SID,
      source: "opencode",
      ...extra
    };
    const entry = JSON.stringify(entryObj) + "\n";
    const globalIndex = getGlobalIndexPath();
    const sessionIndex = getSessionIndexPath();
    mkdirSync3(dirname3(globalIndex), { recursive: true });
    mkdirSync3(dirname3(sessionIndex), { recursive: true });
    appendFileSync3(globalIndex, entry);
    appendFileSync3(sessionIndex, entry);
  } catch (err) {
    console.error(`[vibeOS] index write failed: ${err.message}`);
  }
}
var scratchpadHitsSeen = /* @__PURE__ */ new Set();
function scanRecentScratchpad(dir, titleCase, maxScan = 2e3) {
  try {
    if (!existsSync4(dir))
      return null;
    const entries = readdirSync(dir);
    const txtFiles = entries.filter((e) => e.endsWith(".txt") && !e.endsWith(".summary.txt"));
    if (txtFiles.length === 0)
      return null;
    const candidateHashes = [];
    for (let i = txtFiles.length - 1; i >= 0; i--) {
      const f = txtFiles[i];
      const head = _readHead(join4(dir, f));
      if (head && head.includes(`[ctx-compressed-v1]`)) {
        candidateHashes.push(f.replace(/\.txt$/, ""));
      }
      if (candidateHashes.length > 50)
        break;
    }
    for (const hash of candidateHashes) {
      const f = join4(dir, `${hash}.txt`);
      if (!existsSync4(f))
        continue;
      const st = statSync4(f);
      const ageSec = (Date.now() - st.mtimeMs) / 1e3;
      if (ageSec > SCRATCHPAD_MAX_AGE_SEC)
        continue;
      const sumPath = join4(dir, `${hash}.summary.txt`);
      return { hash, fullPath: f, sizeBytes: st.size, ageSec: Math.round(ageSec), summaryPath: existsSync4(sumPath) ? sumPath : null };
    }
    return null;
  } catch {
    return null;
  }
}
function getScratchpadHit(toolLower, args, baseDir = null) {
  if (!SCRATCHPAD_TOOLS.has(toolLower))
    return null;
  const titleCase = TOOL_NAME_NORMALIZE[toolLower];
  const inputJson = stableJson(args ?? {});
  const hash = createHash("sha256").update(`${titleCase}
${inputJson}
`).digest("hex").slice(0, 16);
  const sessionDir = baseDir || getSessionScratchpadDir();
  const globalDir = SCRATCHPAD_GLOBAL_DIR;
  const sessionPath = join4(sessionDir, `${hash}.txt`);
  const globalPath = join4(globalDir, `${hash}.txt`);
  let fullPath = existsSync4(sessionPath) ? sessionPath : existsSync4(globalPath) ? globalPath : null;
  if (!fullPath) {
    const recent = scanRecentScratchpad(sessionDir, titleCase, 2e3) || scanRecentScratchpad(globalDir, titleCase, 2e3);
    if (recent)
      return recent;
    return null;
  }
  try {
    const st = statSync4(fullPath);
    const ageSec = (Date.now() - st.mtimeMs) / 1e3;
    if (ageSec > SCRATCHPAD_MAX_AGE_SEC)
      return null;
    if (fullPath === globalPath)
      safeCopyIntoSession(hash, globalPath);
    const sessionSummaryPath = join4(sessionDir, `${hash}.summary.txt`);
    const globalSummaryPath = join4(globalDir, `${hash}.summary.txt`);
    const summaryPath = existsSync4(sessionSummaryPath) ? sessionSummaryPath : globalSummaryPath;
    return {
      hash,
      fullPath,
      sizeBytes: st.size,
      ageSec: Math.round(ageSec),
      summaryPath: existsSync4(summaryPath) ? summaryPath : null
    };
  } catch {
    return null;
  }
}
function recordScratchpadObservation(toolLower, args, fileSize, meta = {}) {
  if (!SCRATCHPAD_TOOLS.has(toolLower))
    return;
  try {
    const titleCase = TOOL_NAME_NORMALIZE[toolLower];
    const inputJson = stableJson(args ?? {});
    const hash = createHash("sha256").update(`${titleCase}
${inputJson}
`).digest("hex").slice(0, 16);
    const dedupeKey = `${toolLower}:${hash}`;
    if (scratchpadHitsSeen.has(dedupeKey))
      return;
    scratchpadHitsSeen.add(dedupeKey);
    indexAppend(hash, toolLower, fileSize, { ...meta, input: inputJson.slice(0, 200) });
  } catch {
  }
}
function _pruneScratchpadDir(targetDir, opts = {}) {
  const { maxFiles = MAX_SCRATCHPAD_FILES, maxBytes = MAX_SCRATCHPAD_BYTES, rotate = true } = opts;
  const now = Date.now();
  if (!existsSync4(targetDir))
    return { dataFiles: 0, totalBytes: 0, deleted: 0, rotated: 0 };
  const entries = readdirSync(targetDir);
  let dataFiles = 0;
  let totalBytes = 0;
  let deleted = 0;
  let rotated = 0;
  for (const entry of entries) {
    if (entry.endsWith(".meta.json") || entry.endsWith(".summary.txt"))
      continue;
    const fullPath = join4(targetDir, entry);
    let st;
    try {
      st = statSync4(fullPath);
    } catch {
      continue;
    }
    const age = now - st.mtimeMs;
    const hash = entry.replace(/\.txt$/, "");
    if (age > DECADENCE_EXPIRE_MS) {
      try {
        rmSync(fullPath);
      } catch {
      }
      const meta = join4(targetDir, hash + ".meta.json");
      if (existsSync4(meta))
        try {
          rmSync(meta);
        } catch {
        }
      const summary = join4(targetDir, hash + ".summary.txt");
      if (existsSync4(summary))
        try {
          rmSync(summary);
        } catch {
        }
      deleted++;
      continue;
    }
    dataFiles++;
    totalBytes += st.size;
    if (!rotate)
      continue;
    if (age > DECADENCE_COLD_MS) {
      const summaryPath = join4(targetDir, hash + ".summary.txt");
      if (!existsSync4(summaryPath))
        try {
          const content = readFileSync3(fullPath, "utf-8");
          writeFileSync3(summaryPath, content.slice(0, 200).replace(/\n+/g, " ").trim() + (content.length > 200 ? "\u2026" : ""));
        } catch {
        }
      const head = _readHead(fullPath);
      if (!head.includes("[cold-storage]"))
        try {
          writeFileSync3(fullPath, `[cold-storage] ${st.size}B original \u2192 ${hash}.summary.txt`);
          rotated++;
        } catch {
        }
      continue;
    }
    if (age > DECADENCE_FRESH_MS && st.size > 1024) {
      const summaryPath = join4(targetDir, hash + ".summary.txt");
      if (!existsSync4(summaryPath))
        try {
          const content = readFileSync3(fullPath, "utf-8");
          writeFileSync3(summaryPath, content.slice(0, 500).replace(/\n+/g, " ").trim() + (content.length > 500 ? "\u2026" : ""));
        } catch {
        }
      const head = _readHead(fullPath);
      if (!head.includes("[warm-storage]") && !head.includes("[cold-storage]"))
        try {
          writeFileSync3(fullPath, `[warm-storage] ${st.size}B original at ${hash}.summary.txt`);
          rotated++;
        } catch {
        }
    }
  }
  return { dataFiles, totalBytes, deleted, rotated };
}
function applyDecadence() {
  const now = Date.now();
  if (now - _lastDecadenceRun >= DECADENCE_THROTTLE_MS) {
    _lastDecadenceRun = now;
    try {
      const ses = _pruneScratchpadDir(getSessionScratchpadDir(), {
        maxFiles: MAX_SESSION_SCRATCHPAD_FILES,
        maxBytes: MAX_SESSION_SCRATCHPAD_BYTES,
        rotate: false
      });
      if (ses.deleted > 0) {
        console.error(`[vibeOS] session-decadence: deleted=${ses.deleted} (${ses.dataFiles} files, ${Math.round(ses.totalBytes / 1024)}KB)`);
      }
    } catch (err) {
      console.error(`[vibeOS] session decadence error: ${err.message}`);
    }
  }
  if (now - _lastGlobalDecadenceRun >= DECADENCE_GLOBAL_THROTTLE_MS) {
    _lastGlobalDecadenceRun = now;
    try {
      const global = _pruneScratchpadDir(SCRATCHPAD_GLOBAL_DIR, {
        maxFiles: MAX_SCRATCHPAD_FILES,
        maxBytes: MAX_SCRATCHPAD_BYTES,
        rotate: true
      });
      cleanupStaleSessionScratchpads();
      if (global.deleted > 0 || global.rotated > 0) {
        const action = [];
        if (global.rotated > 0)
          action.push(`rotated=${global.rotated}`);
        if (global.deleted > 0)
          action.push(`deleted=${global.deleted}`);
        console.error(`[vibeOS] global-decadence: ${action.join(" ")} (${global.dataFiles} files, ${Math.round(global.totalBytes / 1024)}KB)`);
      }
    } catch (err) {
      console.error(`[vibeOS] global decadence error: ${err.message}`);
    }
  }
}
function cleanupStaleSessionScratchpads() {
  try {
    if (!existsSync4(SCRATCHPAD_SESSIONS_DIR))
      return;
    const dirs = readdirSync(SCRATCHPAD_SESSIONS_DIR);
    const now = Date.now();
    for (const d of dirs) {
      const full = join4(SCRATCHPAD_SESSIONS_DIR, d);
      try {
        const st = statSync4(full);
        if (now - st.mtimeMs > SCRATCHPAD_SESSION_TTL_MS) {
          rmSync(full, { recursive: true, force: true });
        }
      } catch {
      }
    }
  } catch {
  }
}
function pruneScratchpadOnce() {
  if (prunedThisProcess)
    return;
  prunedThisProcess = true;
  try {
    const script = join4(USER_HOME2, ".claude/hooks/scratchpad-prune.sh");
    if (existsSync4(script)) {
      const child = spawn("bash", [script], { detached: true, stdio: "ignore" });
      child.unref();
    }
  } catch {
  }
  try {
    const dir = SCRATCHPAD_GLOBAL_DIR;
    if (!existsSync4(dir))
      return;
    const entries = readdirSync(dir);
    const txtFiles = entries.filter((e) => e.endsWith(".txt") && !e.endsWith(".meta.json") && !e.endsWith(".summary.txt")).map((e) => join4(dir, e));
    if (txtFiles.length <= MAX_SCRATCHPAD_FILES)
      return;
    const totalSize = txtFiles.reduce((a, f) => a + (statSync4(f).size || 0), 0);
    if (totalSize < MAX_SCRATCHPAD_BYTES)
      return;
    txtFiles.sort((a, b) => statSync4(a).mtimeMs - statSync4(b).mtimeMs);
    const remove = Math.ceil(txtFiles.length * 0.3);
    for (let i = 0; i < remove; i++) {
      try {
        rmSync(txtFiles[i]);
      } catch {
      }
      const meta = txtFiles[i].replace(".txt", ".meta.json");
      if (existsSync4(meta))
        try {
          rmSync(meta);
        } catch {
        }
    }
  } catch {
  }
}
function loadActiveJobs() {
  try {
    if (!existsSync4(ACTIVE_JOBS_FILE))
      return {};
    const st = statSync4(ACTIVE_JOBS_FILE);
    if (st.size > 10485760) {
      _handleStateCorruption2(ACTIVE_JOBS_FILE);
      return {};
    }
    const raw = safeJsonParse3(readFileSync3(ACTIVE_JOBS_FILE, "utf-8"));
    if (!raw || typeof raw !== "object")
      return {};
    return raw;
  } catch {
    _handleStateCorruption2(ACTIVE_JOBS_FILE);
    return {};
  }
}
function getActiveJobForProject(fp3 = currentProjectFingerprint) {
  if (!fp3)
    return null;
  const jobs = loadActiveJobs();
  const job = jobs[fp3];
  if (!job || typeof job !== "object")
    return null;
  return job;
}
function saveActiveJobForProject(job, fp3 = currentProjectFingerprint) {
  if (!fp3 || !job || typeof job !== "object")
    return;
  try {
    const jobs = loadActiveJobs();
    jobs[fp3] = job;
    mkdirSync3(dirname3(ACTIVE_JOBS_FILE), { recursive: true });
    const tmp = ACTIVE_JOBS_FILE + ".tmp";
    writeFileSync3(tmp, JSON.stringify(jobs, null, 2));
    renameSync3(tmp, ACTIVE_JOBS_FILE);
  } catch {
  }
}
function projectFingerprint(dir) {
  if (!dir)
    return "unknown";
  return createHash("sha256").update(dir).digest("hex").slice(0, 12);
}
function loadProjectState() {
  try {
    const state = readJsonOrEmpty(PROJECT_STATE_FILE);
    if (state && typeof state === "object") {
      state.project_hashes ??= {};
      return state;
    }
  } catch {
  }
  return { project_hashes: {} };
}
function saveProjectState(state) {
  try {
    withFileLock(PROJECT_STATE_FILE, () => {
      mkdirSync3(dirname3(PROJECT_STATE_FILE), { recursive: true });
      const _tmp = PROJECT_STATE_FILE + ".tmp." + Date.now();
      writeFileSync3(_tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
      renameSync3(_tmp, PROJECT_STATE_FILE);
    });
  } catch (err) {
    console.error(`[vibeOS] project state write failed: ${err.message}`);
  }
}
function ensureProjectBucket(state, fp3) {
  state.project_hashes ??= {};
  if (!state.project_hashes[fp3]) {
    state.project_hashes[fp3] = {
      totalSessions: 0,
      researchChains: 0,
      context7Bypasses: 0,
      commonTopics: [],
      techStack: detectTechStack(process.cwd())
    };
  }
  return state.project_hashes[fp3];
}
function detectTechStack(dir) {
  const stacks = [];
  try {
    const pkg = safeJsonParse3(readFileSync3(join4(dir, "package.json"), "utf-8"));
    if (pkg) {
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript || existsSync4(join4(dir, "tsconfig.json")))
        stacks.push("typescript");
      if (pkg.dependencies?.react || pkg.devDependencies?.react)
        stacks.push("react");
      stacks.push("javascript");
    }
  } catch {
  }
  try {
    if (existsSync4(join4(dir, "Cargo.toml")))
      stacks.push("rust");
  } catch {
  }
  try {
    if (existsSync4(join4(dir, "go.mod")))
      stacks.push("go");
  } catch {
  }
  try {
    if (existsSync4(join4(dir, "requirements.txt")))
      stacks.push("python");
    if (existsSync4(join4(dir, "setup.py")))
      stacks.push("python");
    if (existsSync4(join4(dir, "pyproject.toml")))
      stacks.push("python");
  } catch {
  }
  return [...new Set(stacks)];
}
function promotedProjectPatterns(fp3) {
  try {
    const p = loadProjectState().project_hashes?.[fp3];
    const out = [];
    const collect = (rows, label) => {
      for (const row of Object.values(rows || {})) {
        const r = row;
        const sessions = new Set(r?.sessions || []);
        if (sessions.size >= 3)
          out.push({ label, summary: r.summary, sessions: sessions.size, lastSeen: r.lastSeen || "" });
      }
    };
    collect(p?.userPatterns?.friction, "friction");
    collect(p?.userPatterns?.routines, "routine");
    out.sort((a, b) => b.sessions - a.sessions || String(b.lastSeen).localeCompare(String(a.lastSeen)));
    return out.slice(0, 3);
  } catch {
    return [];
  }
}
function projectPatternRows(fp3) {
  try {
    const p = loadProjectState().project_hashes?.[fp3];
    const rows = [];
    for (const [kind, label] of [["friction", "friction"], ["routines", "routine"]]) {
      for (const [key, row] of Object.entries(p?.userPatterns?.[kind] || {})) {
        const r = row;
        const sessions = new Set(r?.sessions || []);
        rows.push({
          key,
          label,
          summary: r?.summary || key,
          count: Number(r?.count || 0),
          sessions: sessions.size,
          lastSeen: r?.lastSeen || ""
        });
      }
    }
    rows.sort((a, b) => b.sessions - a.sessions || b.count - a.count || String(b.lastSeen).localeCompare(String(a.lastSeen)));
    return rows;
  } catch {
    return [];
  }
}
function clearProjectPatterns(fp3) {
  try {
    const pstate = loadProjectState();
    const bucket = pstate.project_hashes?.[fp3];
    if (!bucket?.userPatterns)
      return 0;
    const count = Object.keys(bucket.userPatterns.friction || {}).length + Object.keys(bucket.userPatterns.routines || {}).length;
    bucket.userPatterns = { friction: {}, routines: {} };
    bucket.lastSeen = (/* @__PURE__ */ new Date()).toISOString();
    saveProjectState(pstate);
    return count;
  } catch (err) {
    console.error(`[vibeOS] pattern learner clear failed: ${err.message}`);
    return 0;
  }
}
var STATE_FILE2 = DELEGATION_STATE_FILE;
function recordCacheSaving(tool2, saveEst, meta = {}) {
  try {
    const state = updateState((s) => {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const delta = Number(saveEst || 0);
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" };
      s.lifetime.cache_savings_usd = roundUsd(Number(s.lifetime.cache_savings_usd || 0) + delta);
      s.lifetime.last_updated = now;
      s.sessions ??= {};
      const sid2 = _OC_SID;
      s.sessions[sid2] ??= { started: now, session_started_at: now, source: "opencode", tool_counts: {}, warns: [] };
      if (currentProjectFingerprint)
        s.sessions[sid2].project_fingerprint = currentProjectFingerprint;
      if (currentProjectName)
        s.sessions[sid2].project_name = currentProjectName;
      s.sessions[sid2].session_cache_dir = getSessionScratchpadDir();
      s.sessions[sid2].tool_counts[tool2] = (s.sessions[sid2].tool_counts[tool2] || 0) + 1;
      s.sessions[sid2].cache_savings_usd = roundUsd(Number(s.sessions[sid2].cache_savings_usd || 0) + delta);
      if (meta?.hash) {
        s.sessions[sid2].cache_hits ??= [];
        s.sessions[sid2].cache_hits.push({
          at: now,
          tool: tool2,
          hash: meta.hash,
          est_savings_usd: roundUsd(delta)
        });
        if (s.sessions[sid2].cache_hits.length > 200) {
          console.error(`[vibeOS] session cache_hits truncated from ${s.sessions[sid2].cache_hits.length} to 200 for ${sid2}`);
          s.sessions[sid2].cache_hits = s.sessions[sid2].cache_hits.slice(-200);
        }
      }
      _pruneOldSessions(s);
      return s;
    });
    const sid = _OC_SID;
    try {
      _ledgerBuffer.push(JSON.stringify({ v: 2, at: (/* @__PURE__ */ new Date()).toISOString(), kind: "cache", amount_usd: Number(saveEst || 0), sid, tool: tool2 }) + "\n");
      if (_ledgerBuffer.length >= LEDGER_BUFFER_MAX)
        _flushLedgerBuffer();
      else if (!_ledgerBufferTimer)
        _ledgerBufferTimer = setTimeout(_flushLedgerBuffer, LEDGER_BUFFER_FLUSH_MS);
    } catch {
    }
    return {
      lifetime: state?.lifetime?.cache_savings_usd || 0,
      session: state?.sessions?.[sid]?.cache_savings_usd || 0
    };
  } catch (err) {
    console.error(`[vibeOS] cache state write failed: ${err.message}`);
    return null;
  }
}
function recordMissedContext7(saveEst) {
  try {
    const state = updateState((s) => {
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" };
      s.lifetime.missed_context7_usd = Math.round(((s.lifetime.missed_context7_usd || 0) + saveEst) * 100) / 100;
      return s;
    });
    try {
      if (currentProjectFingerprint) {
        const pstate = loadProjectState();
        const bucket = ensureProjectBucket(pstate, currentProjectFingerprint);
        bucket.context7Bypasses = (bucket.context7Bypasses || 0) + 1;
        bucket.lastSeen = (/* @__PURE__ */ new Date()).toISOString();
        saveProjectState(pstate);
      }
    } catch {
    }
    return state?.lifetime?.missed_context7_usd ?? null;
  } catch {
    return null;
  }
}
function readLedgerTotals() {
  const empty = { delegation: 0, cache: 0, total: 0, entries: 0 };
  try {
    if (!existsSync4(SAVINGS_LEDGER_FILE))
      return empty;
    const raw = readFileSync3(SAVINGS_LEDGER_FILE, "utf-8");
    if (!raw.trim())
      return empty;
    let delegation = 0;
    let cache = 0;
    let entries = 0;
    for (const line of raw.split("\n")) {
      const ln = line.trim();
      if (!ln)
        continue;
      let rec = null;
      try {
        rec = JSON.parse(ln);
      } catch {
        continue;
      }
      if (!rec || typeof rec !== "object")
        continue;
      if (rec.v !== void 0 && rec.v !== 2)
        continue;
      const amt = Number(rec.amount_usd ?? rec.est_savings_usd ?? rec.savings_usd ?? rec.usd ?? 0);
      if (!Number.isFinite(amt) || amt <= 0)
        continue;
      entries += 1;
      const kind = String(rec.kind || rec.type || rec.category || rec.source || "").toLowerCase();
      if (kind.includes("cache"))
        cache += amt;
      else
        delegation += amt;
    }
    const total = delegation + cache;
    return {
      delegation: Math.round(delegation * 1e3) / 1e3,
      cache: Math.round(cache * 1e3) / 1e3,
      total: Math.round(total * 1e3) / 1e3,
      entries
    };
  } catch {
    return empty;
  }
}
function reconcileStateFromLedger() {
  try {
    const ledgerMtime = existsSync4(SAVINGS_LEDGER_FILE) ? statSync4(SAVINGS_LEDGER_FILE).mtimeMs : 0;
    if (ledgerMtime === _ledgerReconciledMtime)
      return;
    _ledgerReconciledMtime = ledgerMtime;
    const l = readLedgerTotals();
    if (l.total <= 0)
      return;
    const state = readJsonOrEmpty(DELEGATION_STATE_FILE);
    const stDelegation = Number(state?.lifetime?.est_savings_usd ?? state?.lifetime?.total_savings_usd ?? 0);
    const stCache = Number(state?.lifetime?.cache_savings_usd ?? 0);
    const stTotal = (Number.isFinite(stDelegation) ? stDelegation : 0) + (Number.isFinite(stCache) ? stCache : 0);
    if (Math.abs(stTotal - l.total) < 5e-4)
      return;
    updateState((s) => {
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" };
      s.lifetime.total_savings_usd = l.delegation;
      s.lifetime.cache_savings_usd = l.cache;
      s.lifetime.last_updated = (/* @__PURE__ */ new Date()).toISOString();
      s.lifetime.rebuilt_from_ledger = true;
      s.lifetime.ledger_entries_reconciled = l.entries;
      return s;
    });
  } catch {
  }
}
function readLifetimeSavings() {
  const empty = { ltTasks: 0, ltCache: 0, ltCost: 0, count: 0, scratchpadHits: 0, missedC7: 0, sesTasks: 0, sesEdit: 0, sesCredit: 0, sesC7: 0, sesQuota: 0, sesTaskDelegations: 0, sesDuration: 0, sesRatePerHour: 0, sesTrend: "stable", sesToolBreakdown: {}, sesModelTurns: { brain: 0, worker: 0 }, quality_avg: 0 };
  try {
    reconcileStateFromLedger();
    if (!existsSync4(DELEGATION_STATE_FILE))
      return empty;
    const mtime = statSync4(DELEGATION_STATE_FILE).mtimeMs;
    if (_savingsCache && mtime === _savingsCacheMtime)
      return _savingsCache;
    const s = safeJsonParse3(readFileSync3(DELEGATION_STATE_FILE, "utf-8"));
    _savingsCache = _computeSessionMetrics(s, _OC_SID);
    _savingsCacheMtime = mtime;
    return _savingsCache;
  } catch {
    return empty;
  }
}
function saveSessionCheckpoint() {
  try {
    const state = readFullState();
    const session = state.sessions?.[_OC_SID];
    if (!session)
      return;
    const cp = {
      session_id: _OC_SID,
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      cost: session.cost_usd || 0,
      cache_savings: session.cache_savings_usd || 0,
      total_savings: session.total_savings_usd || 0,
      tool_counts: session.tool_counts || {},
      warns: session.warns?.length || 0,
      model: session.model || ""
    };
    const cpPath = join4(getSessionRoot(), "checkpoint.json");
    mkdirSync3(dirname3(cpPath), { recursive: true });
    const tmp = cpPath + ".tmp";
    writeFileSync3(tmp, JSON.stringify(cp, null, 2) + "\n");
    renameSync3(tmp, cpPath);
  } catch {
  }
}

// src/lib/pricing.js
var TRINITY_BRAIN = null;
var TRINITY_MEDIUM = null;
var TRINITY_CHEAP = null;
function setTrinityBrain(v) {
  TRINITY_BRAIN = v;
}
function setTrinityMedium(v) {
  TRINITY_MEDIUM = v;
}
function setTrinityCheap(v) {
  TRINITY_CHEAP = v;
}
var USER_HOME3 = (() => {
  try {
    return homedir4();
  } catch {
    return tmpdir3();
  }
})();
function _handleStateCorruption3(path) {
  const backupDir = join5(USER_HOME3, ".claude", ".backups");
  mkdirSync4(backupDir, { recursive: true });
  const backupPath = join5(backupDir, basename4(path) + ".corrupted." + Date.now());
  try {
    copyFileSync3(path, backupPath);
  } catch {
  }
  const logPath = join5(USER_HOME3, ".claude", ".state-corruption-log.jsonl");
  try {
    appendFileSync4(logPath, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), path, backup: backupPath }) + "\n");
  } catch {
  }
}
var FILE_LOCK_DIR2 = join5(USER_HOME3, ".claude/.vibeOS-locks");
var PRICING_CACHE_FILE2 = join5(USER_HOME3, ".claude/model-pricing-cache.json");
function _lockPathFor2(filePath) {
  const hash = createHash2("sha1").update(String(filePath || "")).digest("hex");
  return join5(FILE_LOCK_DIR2, `${hash}.lock`);
}
function withFileLock2(filePath, fn, opts = {}) {
  const staleMs = Number(opts.staleMs || 3e4);
  const timeoutMs = Number(opts.timeoutMs || 2e3);
  const lockPath = _lockPathFor2(filePath);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      mkdirSync4(FILE_LOCK_DIR2, { recursive: true });
      const fd = openSync2(lockPath, "wx");
      try {
        writeFileSync4(fd, `${process.pid}
${Date.now()}
`);
      } catch {
      }
      try {
        return fn();
      } finally {
        try {
          closeSync2(fd);
        } catch {
        }
        try {
          rmSync2(lockPath, { force: true });
        } catch {
        }
      }
    } catch (err) {
      try {
        if (existsSync5(lockPath)) {
          const age = Date.now() - statSync5(lockPath).mtimeMs;
          if (age > staleMs) {
            try {
              rmSync2(lockPath, { force: true });
            } catch {
            }
          }
        }
      } catch {
      }
    }
  }
  throw new Error(`[vibeOS] lock not acquired for ${filePath} after ${timeoutMs}ms`);
}
var _modelLocked2 = false;
function loadTierRegexes2() {
  try {
    const p = join5(USER_HOME3, ".claude/model-tiers.json");
    if (!existsSync5(p))
      return { high: FALLBACK_HIGH, mid: FALLBACK_MID };
    const j = safeJsonParse3(readFileSync4(p, "utf-8"));
    const highRe = _safeRegex(j?.tiers?.high?.regex, FALLBACK_HIGH, "high");
    const midRe = _safeRegex(j?.tiers?.mid?.regex, FALLBACK_MID, "mid");
    return { high: highRe, mid: midRe };
  } catch {
    return { high: FALLBACK_HIGH, mid: FALLBACK_MID };
  }
}
var { high: HIGH_TIER_RE2, mid: MID_TIER_RE2 } = loadTierRegexes2();
function classify(m) {
  const s = String(m || "").toLowerCase();
  if (HIGH_TIER_RE2.test(s))
    return "high";
  if (MID_TIER_RE2.test(s))
    return "mid";
  return "budget";
}
function modelToSlotLabel(modelId, effectiveTier) {
  const tier = effectiveTier ?? classify(modelId);
  const icon = tier === "high" ? "\u{1F9E0}" : tier === "mid" ? "\u2699" : "\u26A1";
  return `[${icon} ${tier.charAt(0).toUpperCase() + tier.slice(1)}]`;
}
function shortModelName(modelId) {
  const raw = String(modelId || "").trim();
  if (!raw)
    return "unknown";
  const parts = raw.split("/");
  return parts[parts.length - 1] || raw;
}
function trendDisplay(sesTrend) {
  const t = sesTrend === "up" || sesTrend === "down" ? sesTrend : "stable";
  const icon = t === "up" ? "\u2191" : t === "down" ? "\u2193" : "\u2192";
  return `${icon} ${t}`;
}
function roundUsd2(v, precision = 6) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n))
    return 0;
  const f = 10 ** precision;
  return Math.round(n * f) / f;
}
function formatUsd(v) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n === 0)
    return "0.00";
  const abs = Math.abs(n);
  if (abs >= 0.01)
    return n.toFixed(2);
  if (abs >= 1e-3)
    return n.toFixed(3);
  return n.toFixed(4);
}
var FREE_MODELS = /* @__PURE__ */ new Set([
  "deepseek/deepseek-chat",
  // free legacy v3 model on DeepSeek API
  "deepseek-chat",
  "deepseek/deepseek-v3"
]);
var MODEL_USD_PER_TURN = {
  // ── Anthropic (Claude Code direct API) ─────────────────────
  "anthropic/claude-opus-4-7": 0.033,
  "anthropic/claude-opus-4-5": 0.033,
  "anthropic/claude-sonnet-4-6": 66e-4,
  "anthropic/claude-sonnet-4-5": 66e-4,
  "anthropic/claude-haiku-4-5": 22e-4,
  "anthropic/claude-haiku-4-5-20251001": 22e-4,
  "haiku": 22e-4,
  // ── DeepSeek (OC platform + OpenRouter) ──────────────────
  "deepseek/deepseek-v4-pro": 57e-5,
  "deepseek/deepseek-v4-flash": 182e-6,
  "deepseek/deepseek-chat": 0,
  "deepseek-chat": 0,
  "deepseek/deepseek-v3": 0,
  "deepseek/deepseek-r1": 124e-5,
  "deepseek/deepseek-reasoner": 182e-6,
  "deepseek/haiku": 22e-4,
  // ── Google Gemini ────────────────────────────────────────
  "google/gemini-2.5-pro": 39e-4,
  "google/gemini-2.5-flash": 96e-5,
  "google/gemini-2.0-flash": 19e-5,
  // ── OpenAI ───────────────────────────────────────────────
  "openai/gpt-4o": 475e-5,
  "openai/gpt-4.1": 38e-4,
  "openai/gpt-4o-mini": 29e-5,
  "openai/gpt-4.1-mini": 19e-5,
  "openai/o3": 38e-4,
  "openai/o4-mini": 21e-4
};
var TURN_BLEND_INPUT_TOKENS = 700;
var TURN_BLEND_OUTPUT_TOKENS = 300;
var _dynamicPricingCache = null;
var _dynamicPricingCacheLoadedAt = 0;
function _loadDynamicPricingCache() {
  const now = Date.now();
  if (_dynamicPricingCache && now - _dynamicPricingCacheLoadedAt < 1e4)
    return _dynamicPricingCache;
  _dynamicPricingCacheLoadedAt = now;
  try {
    if (!existsSync5(PRICING_CACHE_FILE2))
      return {};
    const st = statSync5(PRICING_CACHE_FILE2);
    if (st.size > 10485760) {
      _handleStateCorruption3(PRICING_CACHE_FILE2);
      _dynamicPricingCache = {};
      return {};
    }
    const raw = safeJsonParse3(readFileSync4(PRICING_CACHE_FILE2, "utf-8"));
    const map = raw?.models && typeof raw.models === "object" ? raw.models : {};
    _dynamicPricingCache = map;
  } catch {
    _handleStateCorruption3(PRICING_CACHE_FILE2);
    _dynamicPricingCache = {};
  }
  return _dynamicPricingCache;
}
function _dynamicCostFor(model) {
  const key = normalizeModelId(model);
  const cache = _loadDynamicPricingCache();
  const map = _getNormalizedCostMap();
  if (Object.prototype.hasOwnProperty.call(cache, key))
    return cache[key];
  for (const [k, v] of Object.entries(cache)) {
    if (key === k)
      return v;
    if (key.startsWith(k) && /-\d+$/.test(k) && key.charAt(k.length) === "-")
      return v;
  }
  return null;
}
function _parseOpenRouterTurnCost(modelRow) {
  const p = modelRow?.pricing || {};
  const inTok = Number(p.prompt ?? p.input ?? p.request);
  const outTok = Number(p.completion ?? p.output ?? p.response);
  if (Number.isFinite(inTok) && Number.isFinite(outTok)) {
    return inTok * TURN_BLEND_INPUT_TOKENS + outTok * TURN_BLEND_OUTPUT_TOKENS;
  }
  const oneTok = Number(p.price ?? p.total ?? p.input ?? p.output);
  if (Number.isFinite(oneTok))
    return oneTok * 1e3;
  return null;
}
function _writeDynamicPricingCache(modelsMap) {
  if (!modelsMap || typeof modelsMap !== "object")
    return;
  try {
    withFileLock2(PRICING_CACHE_FILE2, () => {
      mkdirSync4(dirname4(PRICING_CACHE_FILE2), { recursive: true });
      const tmp = PRICING_CACHE_FILE2 + ".tmp";
      writeFileSync4(tmp, JSON.stringify({
        ts: Date.now(),
        source: "openrouter-models",
        models: modelsMap
      }, null, 2) + "\n");
      renameSync4(tmp, PRICING_CACHE_FILE2);
    });
    _dynamicPricingCache = modelsMap;
    _dynamicPricingCacheLoadedAt = Date.now();
  } catch {
  }
}
function normalizeModelId(model) {
  let m = String(model || "").toLowerCase();
  if (m.startsWith("openrouter/"))
    m = m.slice("openrouter/".length);
  if (m.startsWith("opencode/"))
    m = m.slice("opencode/".length);
  m = m.replace(/(\d)\.(\d)/g, "$1-$2");
  return m;
}
var _modelCostMapNormalized = null;
function _getNormalizedCostMap() {
  if (_modelCostMapNormalized)
    return _modelCostMapNormalized;
  _modelCostMapNormalized = {};
  for (const [k, v] of Object.entries(MODEL_USD_PER_TURN)) {
    const kd = k.replace(/(\d)\.(\d)/g, "$1-$2");
    _modelCostMapNormalized[kd] = v;
    _modelCostMapNormalized[k] = v;
  }
  return _modelCostMapNormalized;
}
function modelCostPerTurn(model) {
  if (!model)
    return 0;
  const dyn = _dynamicCostFor(model);
  if (dyn != null)
    return dyn;
  const key = normalizeModelId(model);
  const map = _getNormalizedCostMap();
  if (Object.prototype.hasOwnProperty.call(map, key))
    return map[key];
  for (const [k, v] of Object.entries(map)) {
    if (key.startsWith(k) && /-\d+$/.test(k) && key.charAt(k.length) === "-")
      return v;
  }
  console.error(`[vibeOS] modelCostPerTurn: unknown model '${model}' (normalized: '${key}') \u2014 add to MODEL_USD_PER_TURN`);
  return null;
}
function isModelFree(model) {
  if (!model || typeof model !== "string")
    return false;
  if (FREE_MODELS.has(model))
    return true;
  if (FREE_MODELS.has(normalizeModelId(model)))
    return true;
  const cost = modelCostPerTurn(model);
  return cost !== null && cost === 0;
}
var CONTEXT7_CONFIG_FILES = [
  join5(USER_HOME3, ".claude/settings.json"),
  join5(USER_HOME3, ".claude.json"),
  join5(USER_HOME3, ".config/opencode/opencode.json")
];
function detectContext7(files = CONTEXT7_CONFIG_FILES) {
  if (process.env.CLAUDE_CONTEXT7_AVAILABLE)
    return true;
  for (const f of files) {
    try {
      if (existsSync5(f) && /context7/i.test(readFileSync4(f, "utf-8")))
        return true;
    } catch {
    }
  }
  return false;
}
var DOCS_TARGET_RE = /(docs\.|readthedocs|developer\.mozilla|\/api\/|\/reference\/|\/guide\/|npmjs\.com\/package\/|pypi\.org\/project\/|crates\.io\/crates\/|pkg\.go\.dev|api-docs|\/javadoc\/)/i;
function isDocsTarget(s) {
  return typeof s === "string" && DOCS_TARGET_RE.test(s);
}
var TIERS_FILE3 = join5(USER_HOME3, ".claude/model-tiers.json");
function loadSelection2() {
  try {
    if (!existsSync5(TIERS_FILE3))
      return DFLT_SEL2;
    const st = statSync5(TIERS_FILE3);
    if (st.size > 10485760) {
      _handleStateCorruption3(TIERS_FILE3);
      return DFLT_SEL2;
    }
    const j = safeJsonParse3(readFileSync4(TIERS_FILE3, "utf-8"));
    return {
      enabled: j?.selection?.enabled !== false,
      active_slot: j?.selection?.active_slot || null,
      thinking_level: j?.selection?.thinking_level || "off",
      flow_enabled: j?.selection?.flow_enabled === true,
      tdd_enforce: j?.selection?.tdd_enforce === true,
      tdd_strict: j?.selection?.tdd_strict === true,
      tdd_quality: j?.selection?.tdd_quality !== false,
      flow_enforce: j?.selection?.flow_enforce === true,
      delegation_enforce: j?.selection?.delegation_enforce === true
    };
  } catch {
    _handleStateCorruption3(TIERS_FILE3);
    return DFLT_SEL2;
  }
}
var DFLT_SEL2 = { enabled: true, active_slot: null, thinking_level: "off", flow_enabled: false, tdd_enforce: false, tdd_strict: false, tdd_quality: true, flow_enforce: false, delegation_enforce: false };
function readConfig(dir) {
  try {
    const c = readOpenCodeConfigObject(dir);
    return c?.agent?.build?.model || c?.model || "";
  } catch {
    return "";
  }
}
function parseJsonc(raw) {
  const noBlockComments = String(raw || "").replace(/\/\*[\s\S]*?\*\//g, "");
  const noLineComments = noBlockComments.replace(/(^|\s)\/\/.*$/gm, "$1");
  const noTrailingCommas = noLineComments.replace(/,\s*([}\]])/g, "$1");
  return safeJsonParse3(noTrailingCommas);
}
function readOpenCodeConfigObject(dir) {
  const jsonPath = join5(dir, "opencode.json");
  const jsoncPath = join5(dir, "opencode.jsonc");
  if (existsSync5(jsonPath)) {
    return safeJsonParse3(readFileSync4(jsonPath, "utf-8"));
  }
  if (existsSync5(jsoncPath)) {
    return parseJsonc(readFileSync4(jsoncPath, "utf-8"));
  }
  return {};
}
var PLACEHOLDER_RE = /^(provider|opencode)\/[a-z-]+-model$/i;
function _refreshModel(directory3) {
  try {
    const sel = loadSelection2();
    if (!sel.enabled)
      return;
    const tiersData = safeJsonParse3(readFileSync4(TIERS_FILE3, "utf-8"));
    const activeSlot = sel.active_slot || "brain";
    let slotOcModel = tiersData?.trinity?.[activeSlot]?.oc || "";
    if (slotOcModel && PLACEHOLDER_RE.test(slotOcModel)) {
      slotOcModel = "";
      console.error(`[vibeOS] placeholder model detected in ${activeSlot} slot \u2014 skipping, will auto-detect`);
    }
    if (slotOcModel) {
      const nextTier = activeSlot === "brain" ? "high" : classify(slotOcModel);
      const modelChanged = currentModel !== slotOcModel;
      const tierChanged = currentTier !== nextTier;
      if (modelChanged || tierChanged) {
        const oldModel = currentModel;
        const oldTier = currentTier;
        setCurrentModel(slotOcModel);
        setCurrentTier(nextTier);
        console.error(`[vibeOS] model refresh: ${oldModel}(${oldTier}) \u2192 ${currentModel}(${currentTier}) (slot=${activeSlot})`);
      }
    }
    if (!currentModel) {
      const detected = readConfig(directory3) || readConfig(join5(USER_HOME3, ".config/opencode")) || process?.env?.OPENCODE_MODEL || "";
      if (detected) {
        setCurrentModel(detected);
        setCurrentTier(classify(detected));
        console.error(`[vibeOS] auto-detected model: ${currentModel} (tier=${currentTier})`);
      }
    }
    if (!_modelLocked2) {
      const cfgModel = readConfig(directory3) || readConfig(join5(USER_HOME3, ".config/opencode")) || "";
      if (cfgModel && cfgModel !== currentModel) {
        const oldModel = currentModel;
        const oldTier = currentTier;
        setCurrentModel(cfgModel);
        setCurrentTier(classify(cfgModel));
        console.error(`[vibeOS] model refresh (config): ${oldModel}(${oldTier}) \u2192 ${currentModel}(${currentTier})`);
        try {
          if (existsSync5(TIERS_FILE3)) {
            const t = safeJsonParse3(readFileSync4(TIERS_FILE3, "utf-8"));
            for (const s of ["brain", "medium", "cheap"]) {
              if (t?.trinity?.[s]?.oc === cfgModel) {
                t.selection.active_slot = s;
                const _tmp = TIERS_FILE3 + ".tmp." + Date.now();
                writeFileSync4(_tmp, JSON.stringify(t, null, 2) + "\n", "utf-8");
                renameSync4(_tmp, TIERS_FILE3);
                console.error(`[vibeOS] model refresh (config): synced active_slot \u2192 ${s}`);
                break;
              }
            }
          }
        } catch {
        }
      }
    }
  } catch {
  }
}
function applySlot2(slot) {
  try {
    const j = safeJsonParse3(readFileSync4(TIERS_FILE3, "utf-8"));
    const ocModel = j?.trinity?.[slot]?.oc;
    if (!ocModel)
      return { ok: false, reason: `slot '${slot}' has no oc model` };
    j.selection.active_slot = slot;
    const _tmp = TIERS_FILE3 + ".tmp." + Date.now();
    writeFileSync4(_tmp, JSON.stringify(j, null, 2) + "\n", "utf-8");
    renameSync4(_tmp, TIERS_FILE3);
    const localOcConfig = join5(process.cwd(), "opencode.json");
    const ocConfig = existsSync5(localOcConfig) ? localOcConfig : join5(USER_HOME3, ".config/opencode/opencode.json");
    if (existsSync5(ocConfig)) {
      const oc = safeJsonParse3(readFileSync4(ocConfig, "utf-8"));
      oc.model = ocModel;
      writeFileSync4(ocConfig, JSON.stringify(oc, null, 2) + "\n");
    }
    _refreshModel(process.cwd());
    return { ok: true, ocModel };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// src/lib/turn-classify.js
import { readFileSync as readFileSync5, writeFileSync as writeFileSync5, appendFileSync as appendFileSync5, existsSync as existsSync6, mkdirSync as mkdirSync5, statSync as statSync6, copyFileSync as copyFileSync4, renameSync as renameSync5, openSync as openSync3, closeSync as closeSync3, rmSync as rmSync3 } from "node:fs";
import { join as join6, dirname as dirname5, basename as basename5 } from "node:path";
import { homedir as homedir5, tmpdir as tmpdir4 } from "node:os";
import { createHash as createHash3 } from "node:crypto";

// src/vibeOS-api-server/client.js
var DEFAULT_API_URL = "https://api.vibetheog.com";
var REQUEST_TIMEOUT = 1e4;
var MAX_RETRIES = 3;
var BASE_RETRY_DELAY = 1e3;
var VibeOSApiClient = class {
  baseUrl;
  apiToken;
  masterKey;
  timeout;
  fallbackMode;
  fallbackStubs;
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.VIBEOS_API_URL || DEFAULT_API_URL;
    this.apiToken = options.apiToken || process.env.VIBEOS_API_TOKEN || null;
    this.masterKey = options.masterKey || process.env.VIBEOS_API_MASTER_KEY || null;
    this.timeout = options.timeout || REQUEST_TIMEOUT;
    this.fallbackMode = false;
    this.fallbackStubs = options.fallbackStubs || null;
  }
  async request(path, body = null, isAdmin = false) {
    if (!this.apiToken && !isAdmin) {
      throw new Error("VIBEOS_API_TOKEN is not set");
    }
    const url = this.baseUrl + path;
    const headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (isAdmin ? this.masterKey : this.apiToken)
    };
    let lastError = null;
    let attempt = 0;
    while (attempt <= MAX_RETRIES) {
      if (attempt > 0) {
        const delay = BASE_RETRY_DELAY * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
      attempt++;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        const res = await fetch(url, {
          method: body ? "POST" : "GET",
          headers,
          body: body ? JSON.stringify(body) : null,
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (res.status === 401 || res.status === 403) {
          const errorBody = await res.json().catch(() => ({}));
          this.fallbackMode = true;
          throw new VibeOSAuthError(errorBody.message || "Authentication failed", res.status, errorBody.code);
        }
        if (!res.ok) {
          const errorBody = await res.json().catch(() => ({}));
          if (res.status >= 500 && attempt <= MAX_RETRIES) {
            lastError = new Error("API error " + res.status + ": " + (errorBody.error || res.statusText));
            continue;
          }
          throw new Error("API error " + res.status + ": " + (errorBody.error || res.statusText));
        }
        this.fallbackMode = false;
        return res.json();
      } catch (err) {
        if (err instanceof VibeOSAuthError)
          throw err;
        const error = err;
        if (error.name === "AbortError") {
          if (attempt <= MAX_RETRIES) {
            lastError = new VibeOSTimeoutError("Request to " + url + " timed out after " + this.timeout + "ms");
            continue;
          }
          this.fallbackMode = true;
          throw new VibeOSTimeoutError("Request to " + url + " timed out after " + this.timeout + "ms");
        }
        lastError = err;
        if (attempt <= MAX_RETRIES && error.message && (error.message.includes("fetch") || error.message.includes("network") || error.message.includes("ECONNREFUSED"))) {
          continue;
        }
      }
    }
    this.fallbackMode = true;
    throw new VibeOSNetworkError("Failed to reach API after " + MAX_RETRIES + " retries: " + (lastError ? lastError.message : "unknown error"));
  }
  async delegateCheck(tool2, tier, model, prompt, dynamicCache = {}) {
    return this.request("/api/v1/delegate/check", { tool: tool2, tier, model, prompt, dynamic_cache: dynamicCache });
  }
  async delegateSoftQuota(tool2, currentCount, limit = 5) {
    return this.request("/api/v1/delegate/soft-quota", { tool: tool2, current_count: currentCount, limit });
  }
  async delegateCost(model, dynamicCache = {}) {
    return this.request("/api/v1/delegation/cost", { model, dynamic_cache: dynamicCache });
  }
  async routeModel(prompt, currentTier2, trinityCheap, trinityMedium, learnedExploratory = [], stressScore = 0) {
    return this.request("/api/v1/route/model", {
      prompt,
      current_tier: currentTier2,
      trinity_cheap: trinityCheap,
      trinity_medium: trinityMedium,
      learned_exploratory: learnedExploratory,
      stress_score: stressScore
    });
  }
  async classifyTier(model, customRegex = null) {
    return this.request("/api/v1/tier/classify", { model, custom_regex: customRegex });
  }
  async isExploratory(prompt, learnedExploratory = []) {
    return this.request("/api/v1/tier/exploratory", { prompt, learned_exploratory: learnedExploratory });
  }
  async scoreStress(text) {
    return this.request("/api/v1/stress/score", { text });
  }
  async stressLevel(score) {
    return this.request("/api/v1/stress/level", { score });
  }
  async blackboxAnalyze(sessionId, entry) {
    return this.request("/api/v1/blackbox/analyze", {
      session_id: sessionId,
      project_id: entry.project_id || null,
      user_text: entry.userText || "",
      features: entry.features || {},
      action: entry.action || "explore",
      entropy: entry.entropy ?? 1,
      uncertainty: entry.uncertainty ?? 50,
      embedding: entry.embedding || null
    });
  }
  async blackboxState(sessionId) {
    return this.request("/api/v1/blackbox/state", { session_id: sessionId });
  }
  async blackboxReset(sessionId) {
    return this.request("/api/v1/blackbox/reset", { session_id: sessionId });
  }
  async blackboxOutcome(sessionId, outcome) {
    return this.request("/api/v1/blackbox/outcome", { session_id: sessionId, outcome });
  }
  async blackboxCalibrate(projectId) {
    return this.request("/api/v1/blackbox/calibrate", { project_id: projectId || "global" });
  }
  async blackboxCalibration(projectId) {
    return this.request("/api/v1/blackbox/calibration?project_id=" + (projectId || "global"), null);
  }
  async blackboxControlVector(state, action, optimizationMode) {
    return this.request("/api/v1/blackbox/control-vector", { ...state, action, optimization_mode: optimizationMode });
  }
  async blackboxSelectMode(subRegime, stressMultiplier) {
    return this.request("/api/v1/blackbox/select-mode", { sub_regime: subRegime, stress_multiplier: stressMultiplier });
  }
  async tddExports(sourceContent, ext) {
    return this.request("/api/v1/tdd/exports", { source_content: sourceContent, ext });
  }
  async tddParams(sourceContent, funcName) {
    return this.request("/api/v1/tdd/params", { source_content: sourceContent, func_name: funcName });
  }
  async tddInferType(paramName, defaultValue) {
    return this.request("/api/v1/tdd/infer-type", { param_name: paramName, default_value: defaultValue });
  }
  async tddSkeleton(language, fileName, exports, options = {}) {
    return this.request("/api/v1/tdd/skeleton", { language, file_name: fileName, exports, options });
  }
  async patternsObserve(sessionId, toolName, input, output, directory3) {
    return this.request("/api/v1/patterns/observe", {
      session_id: sessionId,
      tool_name: toolName,
      input,
      output,
      directory: directory3
    });
  }
  async patternsRecord(sessionId, kind, key, summary, meta = {}) {
    return this.request("/api/v1/patterns/record", {
      session_id: sessionId,
      kind,
      key,
      summary,
      meta
    });
  }
  async patternsQuery(sessionId, kind = null) {
    return this.request("/api/v1/patterns/query?kind=" + (kind || ""), null);
  }
  async patternsExploratoryWords(sessionId) {
    return this.request("/api/v1/patterns/exploratory-words", null);
  }
  async patternsClear(sessionId) {
    return this.request("/api/v1/patterns/clear", { session_id: sessionId });
  }
  async pricingFetch(openrouterKey, force = false) {
    return this.request("/api/v1/pricing/fetch", { openrouter_key: openrouterKey, force });
  }
  async pricingLookup(model) {
    return this.request("/api/v1/pricing/lookup", { model });
  }
  async pricingStatic() {
    return this.request("/api/v1/pricing/static", null);
  }
  async compressContext(text, threshold = 2e3) {
    return this.request("/api/v1/compress/context", { text, threshold });
  }
  async adminCreateSeat(name, email) {
    return this.request("/admin/seats", { name, email }, true);
  }
  async adminCreateSeatWithToken(name, email, tokenLabel = null) {
    return this.request("/admin/seats", { name, email, with_token: tokenLabel || true }, true);
  }
  async adminListSeats() {
    return this.request("/admin/seats", null, true);
  }
  async adminUpdateSeat(seatId, status) {
    return this.request("/admin/seats/" + seatId, { status }, true);
  }
  async adminCreateToken(seatId, label, expiresAt) {
    return this.request("/admin/tokens", { seat_id: seatId, label, expires_at: expiresAt }, true);
  }
  async adminListTokens() {
    return this.request("/admin/tokens", null, true);
  }
  async adminUpdateToken(tokenId, status) {
    return this.request("/admin/tokens/" + tokenId, { status }, true);
  }
  async adminDeleteToken(tokenId) {
    return this.request("/admin/tokens/" + tokenId, null, true);
  }
  async adminUsage(days = 30) {
    return this.request("/admin/usage?days=" + days, null, true);
  }
  async health() {
    return this.request("/health", null, false);
  }
  isFallback() {
    return this.fallbackMode;
  }
};
var VibeOSAuthError = class extends Error {
  statusCode;
  code;
  constructor(message, statusCode, code) {
    super(message);
    this.name = "VibeOSAuthError";
    this.statusCode = statusCode;
    this.code = code;
  }
};
var VibeOSTimeoutError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "VibeOSTimeoutError";
  }
};
var VibeOSNetworkError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "VibeOSNetworkError";
  }
};

// src/lib/api-client.js
var VIBEOS_API_URL = process.env.VIBEOS_API_URL || "https://api.vibetheog.com";
var VIBEOS_API_TOKEN = process.env.VIBEOS_API_TOKEN || "vos_59d73aa4b7838a7ca9dafe957993177b5629c7954091db3350b4150882ff7064";
var VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN;
var _apiClient = null;
var _apiFallbackMode = false;
var _apiFallbackSince = null;
function getApiClient() {
  if (!_apiClient && VIBEOS_API_ENABLED) {
    _apiClient = new VibeOSApiClient({
      baseUrl: VIBEOS_API_URL,
      apiToken: VIBEOS_API_TOKEN,
      timeout: 5e3
    });
  }
  return _apiClient;
}
function isApiFallback() {
  return _apiFallbackMode || !VIBEOS_API_ENABLED;
}
async function remoteCall(method, args, fallbackFn) {
  if (!VIBEOS_API_ENABLED || _apiFallbackMode) {
    if (fallbackFn)
      return fallbackFn();
    return null;
  }
  try {
    const client2 = getApiClient();
    if (!client2) {
      if (fallbackFn)
        return fallbackFn();
      return null;
    }
    const result = await client2[method](...args);
    _apiFallbackMode = false;
    _apiFallbackSince = null;
    return result;
  } catch (err) {
    if (!_apiFallbackMode) {
      _apiFallbackMode = true;
      _apiFallbackSince = (/* @__PURE__ */ new Date()).toISOString();
      console.error(`[vibeOS] API fallback activated: ${err.message}`);
    }
    if (fallbackFn) {
      try {
        return fallbackFn();
      } catch (fe) {
        console.error(`[vibeOS] fallback also failed: ${fe.message}`);
      }
    }
    return null;
  }
}

// src/lib/classifiers.js
function detectOutcomeSignal(text) {
  if (!text)
    return null;
  if (/thank|perfect|exactly|that.?s it|works great|works perfectly|solved|fixed|awesome|you rock/i.test(text))
    return "positive";
  if (/doesn.?t work|still broken|not working|incorrect|wrong|failed|error|useless|stuck/i.test(text))
    return "negative";
  return null;
}
function scoreStress(text) {
  if (!text || typeof text !== "string")
    return 0;
  const t = text.toLowerCase();
  let score = 0;
  const aggressive = ["fuck", "shit", "bullshit", "useless", "wrong", "bad", "slow", "broken", "stupid", "idiot", "hell", "damn", "waste", "annoying", "terrible", "hate"];
  for (const w of aggressive) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
    const hits = (t.match(re) || []).length;
    score += hits * 0.05;
  }
  const urgency = ["fix", "now", "fast", "urgent", "important", "critical", "hurry", "immediately", "asap"];
  for (const w of urgency) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
    const hits = (t.match(re) || []).length;
    score += hits * 0.04;
  }
  const negative = ["no", "not", "don't", "can't", "won't", "doesn't", "isn't", "shouldn't", "never", "stop"];
  for (const w of negative) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
    const hits = (t.match(re) || []).length;
    score += hits * 0.02;
  }
  const capsAcronyms = /* @__PURE__ */ new Set(["ai", "ui", "api", "cli", "ssh", "dns", "http", "url", "json", "xml", "css", "html", "sql", "csv", "yaml", "ide", "tdd", "pr", "ci", "cd", "env", "os", "sdk", "gui", "crud", "rest", "crlf", "utf", "ascii"]);
  const words = text.split(/\s+/);
  for (const w of words) {
    if (w.length >= 3 && /^[A-Z]+$/.test(w) && !capsAcronyms.has(w.toLowerCase())) {
      score += 0.03;
    }
  }
  const exclamParts = text.match(/!{2,}/g);
  if (exclamParts)
    score += exclamParts.length * 0.05;
  const qmarkParts = text.match(/\?{2,}/g);
  if (qmarkParts)
    score += qmarkParts.length * 0.03;
  const qeCombos = text.match(/\?!|!\?/g);
  if (qeCombos)
    score += qeCombos.length * 0.08;
  if (text.length < 30)
    score += 0.1;
  else if (text.length < 80)
    score += 0.05;
  else if (text.length < 150)
    score += 0.02;
  return Math.min(score, 1);
}
function estimateContextBudget(_input, output) {
  try {
    const DEFAULT_CONTEXT_LIMIT = 128e3;
    const CHARS_PER_TOKEN = 4;
    let totalChars = 0;
    const messages = output?.messages;
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        const parts = msg?.parts;
        if (!Array.isArray(parts))
          continue;
        for (const part of parts) {
          if (part?.type === "text" && typeof part.text === "string") {
            totalChars += part.text.length;
          } else if (part?.type === "tool" && typeof part.state?.output === "string") {
            totalChars += part.state.output.length;
          }
        }
      }
    }
    const systemParts = output?.system;
    if (Array.isArray(systemParts)) {
      for (const s of systemParts) {
        if (typeof s === "string")
          totalChars += s.length;
      }
    }
    const estimatedTokens = Math.round(totalChars / CHARS_PER_TOKEN);
    const pct = Math.round(estimatedTokens / DEFAULT_CONTEXT_LIMIT * 100);
    return { estimatedTokens, pct, totalChars };
  } catch {
    return null;
  }
}
function classifyTurnSimple(userText) {
  const lower = String(userText || "").trim();
  if (!lower)
    return "INIT";
  if (/^(how|what|why|when|where|who|can you|could you|tell me|explain|describe|show|list|check|is there|are there|does|do you|summarize|elaborate|clarify|inspect|trace|find|search|look|read|show me|dump)/i.test(lower)) {
    return "EXPLORING";
  }
  if (/^(write|create|add|build|implement|fix|change|edit|modify|update|refactor|generate|make|commit|push|deploy|release|publish|install|remove|delete|rename|move|copy|transform|convert|migrate)/i.test(lower)) {
    return "REFINING";
  }
  return "INIT";
}
function tokenizeWords(text) {
  if (!text || typeof text !== "string")
    return [];
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).filter((w) => w.length > 2);
}
function topKeywords(text, max = 10) {
  const stop = /* @__PURE__ */ new Set(["the", "and", "for", "with", "that", "this", "from", "into", "your", "you", "are", "but", "not", "all", "can", "use", "was", "have", "has", "had", "they", "them", "their", "then", "than", "when", "what", "why", "how", "who", "will", "would", "should", "about", "check", "make", "build", "write", "edit", "file", "code", "test", "tests", "run"]);
  const freq = /* @__PURE__ */ new Map();
  for (const w of tokenizeWords(text)) {
    if (stop.has(w))
      continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
}
function extractLastUserText(obj) {
  if (!obj || typeof obj !== "object")
    return null;
  const candidates = [];
  const scan = (v) => {
    if (!v || typeof v !== "object")
      return;
    if (Array.isArray(v)) {
      for (const i of v)
        scan(i);
      return;
    }
    if (v.role === "user" && typeof v.content === "string")
      candidates.push(v.content);
    if (typeof v.text === "string")
      candidates.push(v.text);
    for (const val of Object.values(v))
      scan(val);
  };
  scan(obj);
  if (!candidates.length)
    return null;
  return candidates[candidates.length - 1];
}
function isUserAskingForTests(text) {
  if (!text || typeof text !== "string")
    return false;
  return /\b(test|tests|typecheck|coverage|qa|regression|e2e|unit test|integration test)\b/i.test(text);
}
function isLikelyOffTopic(userText, job) {
  if (!userText || !job?.keywords?.length)
    return false;
  if (/\b(new task|switch task|different task|ignore previous|start over)\b/i.test(userText))
    return false;
  const now = Date.now();
  const updatedAt = Date.parse(job.updatedAt || "");
  if (!Number.isFinite(updatedAt) || now - updatedAt > 2 * 60 * 60 * 1e3)
    return false;
  const userWords = new Set(topKeywords(userText, 12));
  const overlap = job.keywords.filter((k) => userWords.has(k));
  return overlap.length === 0 && userWords.size >= 3;
}

// src/lib/turn-classify.js
function buildControlHistoryEntry(turn, regime, control, reward = null) {
  return {
    turn,
    regime,
    control: {
      enforcement_mode: control.enforcement_mode,
      flow_mode: control.flow_mode,
      tdd_mode: control.tdd_mode,
      tier_bias: control.tier_bias,
      thinking_mode: control.thinking_mode,
      stress_multiplier: control.stress_multiplier,
      context7_urgency: control.context7_urgency,
      wbp_verbosity: control.wbp_verbosity
    },
    reward
  };
}
var _BlackboxStub = class __BlackboxStub {
  history;
  currentRegime;
  static deserialize(data) {
    const s = new __BlackboxStub();
    s.history = data?.history || [];
    s.currentRegime = data?.currentRegime || "INIT";
    return s;
  }
  update(_text) {
    return { sub_regime: this.currentRegime || "INIT" };
  }
  snapshot() {
    return { sub_regime: this.currentRegime || "INIT", resolution: "unresolved", momentum: 0, signals: {} };
  }
  serialize() {
    return { history: this.history, currentRegime: this.currentRegime };
  }
};
var USER_HOME4 = (() => {
  try {
    return homedir5();
  } catch {
    return tmpdir4();
  }
})();
var FILE_LOCK_DIR3 = join6(USER_HOME4, ".claude/.vibeOS-locks");
var BLACKBOX_STATE_FILE2 = join6(USER_HOME4, ".claude/blackbox-state.json");
var GLOBAL_LEARNING_FILE2 = join6(USER_HOME4, ".claude/global-learning.json");
var STATE_FILE3 = join6(USER_HOME4, ".claude/delegation-state.json");
var PROJECT_STATE_FILE2 = join6(USER_HOME4, ".claude/project-states.json");
var DFLT_GL2 = { exploratory_words: {}, task_first_words: {}, updatedAt: null };
var _blackboxTracker = null;
var _OC_SID2 = "opencode-" + (process.pid || "x") + "-" + Date.now();
var currentProjectFingerprint2 = "";
var _latestBlackboxState2 = null;
var _latestBlackboxLoopMsg = null;
var _latestBlackboxPivotMsg = null;
var WARN_DEDUPE_WINDOW_MS2 = 120 * 1e3;
var warnLogThrottle = /* @__PURE__ */ new Map();
var warnPerSession = /* @__PURE__ */ new Map();
var WARN_MAX_PER_SESSION = 3;
var WARN_COALESCE_THRESHOLD = 10;
var warnCoalesceCounters = /* @__PURE__ */ new Map();
function _handleStateCorruption4(path) {
  const backupDir = join6(USER_HOME4, ".claude", ".backups");
  mkdirSync5(backupDir, { recursive: true });
  const backupPath = join6(backupDir, basename5(path) + ".corrupted." + Date.now());
  try {
    copyFileSync4(path, backupPath);
  } catch {
  }
  const logPath = join6(USER_HOME4, ".claude", ".state-corruption-log.jsonl");
  try {
    appendFileSync5(logPath, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), path, backup: backupPath }) + "\n");
  } catch {
  }
}
function _lockPathFor3(filePath) {
  const hash = createHash3("sha1").update(String(filePath || "")).digest("hex");
  return join6(FILE_LOCK_DIR3, `${hash}.lock`);
}
function withFileLock3(filePath, fn, opts = {}) {
  const staleMs = Number(opts.staleMs || 3e4);
  const timeoutMs = Number(opts.timeoutMs || 2e3);
  const lockPath = _lockPathFor3(filePath);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      mkdirSync5(FILE_LOCK_DIR3, { recursive: true });
      const fd = openSync3(lockPath, "wx");
      try {
        writeFileSync5(fd, `${process.pid}
${Date.now()}
`);
      } catch {
      }
      try {
        return fn();
      } finally {
        try {
          closeSync3(fd);
        } catch {
        }
        try {
          rmSync3(lockPath, { force: true });
        } catch {
        }
      }
    } catch (err) {
      try {
        if (existsSync6(lockPath)) {
          const age = Date.now() - statSync6(lockPath).mtimeMs;
          if (age > staleMs) {
            try {
              rmSync3(lockPath, { force: true });
            } catch {
            }
          }
        }
      } catch {
      }
    }
  }
  throw new Error("[vibeOS] lock not acquired for " + filePath + " after " + timeoutMs + "ms");
}
function readJsonOrEmpty2(filePath) {
  try {
    if (!existsSync6(filePath))
      return {};
    const st = statSync6(filePath);
    if (st.size > 10485760) {
      _handleStateCorruption4(filePath);
      return {};
    }
    return safeJsonParse3(readFileSync5(filePath, "utf-8"));
  } catch {
    _handleStateCorruption4(filePath);
    return {};
  }
}
function loadTrinityModels() {
  try {
    const p = join6(USER_HOME4, ".claude/model-tiers.json");
    if (!existsSync6(p))
      return { brain: "", cheap: "", medium: "" };
    const j = safeJsonParse3(readFileSync5(p, "utf-8"));
    return {
      brain: j?.trinity?.brain?.oc || j?.trinity?.brain || "",
      cheap: j?.trinity?.cheap?.oc || j?.trinity?.cheap || "",
      medium: j?.trinity?.medium?.oc || j?.trinity?.medium || ""
    };
  } catch {
    return { brain: "", cheap: "", medium: "" };
  }
}
var _trinityModels = loadTrinityModels();
var TRINITY_CHEAP_MOD = _trinityModels.cheap;
var TRINITY_MEDIUM_MOD = _trinityModels.medium;
function loadBlackboxState() {
  try {
    if (!existsSync6(BLACKBOX_STATE_FILE2))
      return { enabled: true, sessions: {} };
    const st = statSync6(BLACKBOX_STATE_FILE2);
    if (st.size > 10485760) {
      _handleStateCorruption4(BLACKBOX_STATE_FILE2);
      return { enabled: false, sessions: {} };
    }
    return safeJsonParse3(readFileSync5(BLACKBOX_STATE_FILE2, "utf-8")) || { enabled: false, sessions: {} };
  } catch {
    _handleStateCorruption4(BLACKBOX_STATE_FILE2);
    return { enabled: false, sessions: {} };
  }
}
function saveBlackboxState(state) {
  try {
    mkdirSync5(dirname5(BLACKBOX_STATE_FILE2), { recursive: true });
    const tmp = BLACKBOX_STATE_FILE2 + ".tmp";
    writeFileSync5(tmp, JSON.stringify(state, null, 2) + "\n");
    renameSync5(tmp, BLACKBOX_STATE_FILE2);
  } catch (err) {
    console.error("[vibeOS] saveBlackboxState failed: " + err.message);
  }
}
function getBlackboxTracker() {
  if (!_blackboxTracker) {
    const state = loadBlackboxState();
    if (state.enabled !== void 0)
      setBlackboxEnabled(state.enabled);
    const sid = _OC_SID2;
    if (state.sessions?.[sid]?.history) {
      _blackboxTracker = _BlackboxStub.deserialize(state.sessions[sid]);
    } else if (currentProjectFingerprint2) {
      const projectKeys = Object.keys(state.sessions || {}).filter((k) => state.sessions[k].project_fingerprint === currentProjectFingerprint2);
      const latest = projectKeys.sort().slice(-1)[0];
      if (latest && state.sessions[latest]?.history) {
        const data = state.sessions[latest];
        _blackboxTracker = _BlackboxStub.deserialize(data);
      } else {
        _blackboxTracker = new _BlackboxStub();
      }
    } else {
      _blackboxTracker = new _BlackboxStub();
    }
  }
  return _blackboxTracker;
}
function getBlackboxResolution() {
  try {
    const tracker = getBlackboxTracker();
    return tracker.snapshot();
  } catch {
    return null;
  }
}
function resolveEnforcementMode() {
  const sub = _latestBlackboxState2?.sub_regime || "INIT";
  if (sub === "EXPLORING" || sub === "DIVERGENT" || sub === "LOOPING")
    return "relaxed";
  if (sub === "CONVERGING" || sub === "CLOSED")
    return "strict";
  return "normal";
}
async function syncOutcomeToApi(outcome) {
  try {
    const client2 = getApiClient();
    if (!client2 || isApiFallback())
      return;
    await client2.blackboxOutcome(_OC_SID2, outcome);
  } catch {
  }
}
async function fetchBlackboxEnrichment(sessionId, localState) {
  try {
    const client2 = getApiClient();
    if (!client2 || isApiFallback())
      return null;
    const result = await client2.blackboxAnalyze(sessionId, {
      userText: "",
      features: localState.features || {},
      action: localState.action || "explore",
      entropy: localState.entropy ?? 1,
      uncertainty: localState.uncertainty ?? 50,
      project_id: currentProjectFingerprint2 || null
    });
    if (result) {
      _latestBlackboxLoopMsg = result.loop_intervention_directive || null;
      _latestBlackboxPivotMsg = result.pivot_directive || null;
      return {
        ...localState,
        sub_regime: result.sub_regime || localState.sub_regime,
        resolution: result.resolution || localState.resolution,
        momentum: result.momentum ?? localState.momentum,
        signals: result.signals || localState.signals,
        intent_state: result.intent_state || localState.intent_state,
        continuity_state: result.continuity_state || localState.continuity_state,
        is_looping: result.is_looping ?? localState.is_looping,
        loop_consecutive: result.loop_consecutive ?? localState.loop_consecutive,
        loop_intervention_level: result.loop_intervention_level || localState.loop_intervention_level,
        pivot_detected: result.pivot_detected ?? localState.pivot_detected,
        pivot_score: result.pivot_score ?? localState.pivot_score,
        outcome: result.outcome || localState.outcome
      };
    }
  } catch {
  }
  return null;
}
function extractFirstWordFromArgs(tool2, args) {
  try {
    if (!args || typeof args !== "object")
      return null;
    const pick = (...vals) => vals.find((v) => typeof v === "string" && v.trim());
    const raw = pick(args.prompt, args.query, args.url, args.command, args.cmd, args.oldString, args.newString, args.filePath, args.file_path);
    if (!raw)
      return null;
    const token = String(raw).trim().toLowerCase().split(/\s+/)[0] || "";
    return /^[a-z][a-z0-9_-]{1,24}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}
function shouldLogWarn(key, windowMs = WARN_DEDUPE_WINDOW_MS2) {
  const now = Date.now();
  const prev = warnLogThrottle.get(key) || 0;
  if (now - prev < windowMs)
    return false;
  warnLogThrottle.set(key, now);
  if (warnLogThrottle.size > 2e3) {
    for (const [k, ts] of warnLogThrottle.entries()) {
      if (now - ts > windowMs * 10)
        warnLogThrottle.delete(k);
    }
    if (warnLogThrottle.size > 2e3) {
      const entries = [...warnLogThrottle.entries()].sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < entries.length - 2e3; i++)
        warnLogThrottle.delete(entries[i][0]);
    }
  }
  const cat = key.split("|")[0];
  const ps = warnPerSession.get(cat) || 0;
  if (ps >= WARN_MAX_PER_SESSION) {
    const cc = (warnCoalesceCounters.get(cat) || 0) + 1;
    warnCoalesceCounters.set(cat, cc);
    if (cc === WARN_COALESCE_THRESHOLD) {
      console.error("[vibeOS] " + cat + ": " + cc + " warnings coalesced \u2014 `trinity medium` recommended");
    }
    return false;
  }
  warnPerSession.set(cat, ps + 1);
  return true;
}
function loadGlobalLearning2() {
  try {
    if (!existsSync6(GLOBAL_LEARNING_FILE2))
      return DFLT_GL2;
    const st = statSync6(GLOBAL_LEARNING_FILE2);
    if (st.size > 10485760) {
      _handleStateCorruption4(GLOBAL_LEARNING_FILE2);
      return DFLT_GL2;
    }
    const j = safeJsonParse3(readFileSync5(GLOBAL_LEARNING_FILE2, "utf-8"));
    if (!j || typeof j !== "object")
      return DFLT_GL2;
    j.exploratory_words ??= {};
    j.task_first_words ??= {};
    return j;
  } catch {
    _handleStateCorruption4(GLOBAL_LEARNING_FILE2);
    return DFLT_GL2;
  }
}
function updateGlobalLearning2(mutator) {
  return withFileLock3(GLOBAL_LEARNING_FILE2, () => {
    const s = loadGlobalLearning2();
    const next = mutator(s) ?? s;
    next.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    mkdirSync5(dirname5(GLOBAL_LEARNING_FILE2), { recursive: true });
    const tmp = GLOBAL_LEARNING_FILE2 + ".tmp";
    writeFileSync5(tmp, JSON.stringify(next, null, 2));
    renameSync5(tmp, GLOBAL_LEARNING_FILE2);
    return next;
  });
}
function getLearnedExploratoryWords() {
  const out = /* @__PURE__ */ new Set();
  try {
    const gl = loadGlobalLearning2();
    for (const [w, meta] of Object.entries(gl.exploratory_words || {})) {
      if ((meta?.count || 0) >= 1)
        out.add(String(w));
    }
  } catch {
  }
  return out;
}
function projectFingerprint2(dir) {
  if (!dir)
    return "unknown";
  return createHash3("sha256").update(dir).digest("hex").slice(0, 12);
}
function loadProjectState2() {
  try {
    const state = readJsonOrEmpty2(PROJECT_STATE_FILE2);
    if (state && typeof state === "object") {
      state.project_hashes ??= {};
      return state;
    }
  } catch {
  }
  return { project_hashes: {} };
}
function saveProjectState2(state) {
  try {
    withFileLock3(PROJECT_STATE_FILE2, () => {
      mkdirSync5(dirname5(PROJECT_STATE_FILE2), { recursive: true });
      const _tmp = PROJECT_STATE_FILE2 + ".tmp." + Date.now();
      writeFileSync5(_tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
      renameSync5(_tmp, PROJECT_STATE_FILE2);
    });
  } catch (err) {
    console.error("[vibeOS] project state write failed: " + err.message);
  }
}
function detectTechStack2(dir) {
  const stacks = [];
  try {
    const pkg = safeJsonParse3(readFileSync5(join6(dir, "package.json"), "utf-8"));
    if (pkg) {
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript || existsSync6(join6(dir, "tsconfig.json")))
        stacks.push("typescript");
      if (pkg.dependencies?.react || pkg.devDependencies?.react)
        stacks.push("react");
      stacks.push("javascript");
    }
  } catch {
  }
  try {
    if (existsSync6(join6(dir, "Cargo.toml")))
      stacks.push("rust");
  } catch {
  }
  try {
    if (existsSync6(join6(dir, "go.mod")))
      stacks.push("go");
  } catch {
  }
  try {
    if (existsSync6(join6(dir, "requirements.txt")))
      stacks.push("python");
    if (existsSync6(join6(dir, "setup.py")))
      stacks.push("python");
    if (existsSync6(join6(dir, "pyproject.toml")))
      stacks.push("python");
  } catch {
  }
  return [...new Set(stacks)];
}
function ensureProjectBucket2(state, fp3) {
  state.project_hashes ??= {};
  if (!state.project_hashes[fp3]) {
    state.project_hashes[fp3] = {
      totalSessions: 0,
      researchChains: 0,
      context7Bypasses: 0,
      commonTopics: [],
      techStack: detectTechStack2(process.cwd())
    };
  }
  return state.project_hashes[fp3];
}
function noteTaskRoutingLearning(firstWord, targetModel, reason) {
  if (!firstWord || !/^[a-z][a-z0-9_-]{1,24}$/.test(firstWord))
    return;
  try {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const nonExploratory = /* @__PURE__ */ new Set(["build", "implement", "fix", "add", "update", "remove", "write", "edit", "refactor", "create"]);
    try {
      const pstate = loadProjectState2();
      const fp3 = currentProjectFingerprint2 || projectFingerprint2(process.cwd());
      const bucket = ensureProjectBucket2(pstate, fp3);
      bucket.taskWordPatterns ??= {};
      const localRow = bucket.taskWordPatterns[firstWord] || { total: 0, cheap: 0, medium: 0, high: 0, lastSeen: null };
      localRow.total += 1;
      if (targetModel === TRINITY_CHEAP_MOD)
        localRow.cheap += 1;
      else if (targetModel === TRINITY_MEDIUM_MOD)
        localRow.medium += 1;
      else
        localRow.high += 1;
      localRow.lastSeen = now;
      bucket.taskWordPatterns[firstWord] = localRow;
      saveProjectState2(pstate);
    } catch {
    }
    updateGlobalLearning2((gl) => {
      gl.task_first_words ??= {};
      const row = gl.task_first_words[firstWord] || { total: 0, cheap: 0, medium: 0, high: 0, lastSeen: null, lastReason: null };
      row.total += 1;
      if (targetModel === TRINITY_CHEAP_MOD)
        row.cheap += 1;
      else if (targetModel === TRINITY_MEDIUM_MOD)
        row.medium += 1;
      else
        row.high += 1;
      row.lastSeen = now;
      row.lastReason = reason || "unknown";
      gl.task_first_words[firstWord] = row;
      try {
        const pstate = loadProjectState2();
        const currentFp = currentProjectFingerprint2 || "";
        const currentTech = currentFp ? pstate.project_hashes?.[currentFp]?.techStack : null;
        if (currentTech && Array.isArray(currentTech) && currentTech.length > 0) {
          for (const [fp3, bucket] of Object.entries(pstate.project_hashes || {})) {
            if (fp3 === currentFp)
              continue;
            const otherTech = bucket?.techStack;
            if (!otherTech || !Array.isArray(otherTech))
              continue;
            if (!otherTech.some((t) => currentTech.includes(t)))
              continue;
            const otherRow = bucket?.taskWordPatterns?.[firstWord];
            if (otherRow && otherRow.total) {
              row.total += otherRow.total;
            }
          }
        }
      } catch {
      }
      gl.task_first_words[firstWord] = row;
      if (!nonExploratory.has(firstWord) && row.cheap >= 3 && row.cheap / Math.max(1, row.total) >= 0.7) {
        gl.exploratory_words ??= {};
        const e = gl.exploratory_words[firstWord] || { count: 0, lastSeen: null };
        e.count += 1;
        e.lastSeen = now;
        gl.exploratory_words[firstWord] = e;
      }
      return gl;
    });
  } catch {
  }
}
var DFLT_OPTIMIZATION_MODE = "auto";
function loadOptimizationMode() {
  try {
    const sid = _OC_SID2;
    return loadSessionOptMode(sid) || DFLT_OPTIMIZATION_MODE;
  } catch {
    return DFLT_OPTIMIZATION_MODE;
  }
}
function saveOptimizationMode(mode) {
  try {
    writeSessionOptMode(_OC_SID2, mode);
  } catch (err) {
    console.error("[vibeOS] saveOptimizationMode failed: " + err.message);
  }
}

// src/lib/research-audit.js
import { readFileSync as readFileSync6, existsSync as existsSync7 } from "node:fs";
import { join as join7 } from "node:path";
import { homedir as homedir6, tmpdir as tmpdir5 } from "node:os";
var USER_HOME5 = (() => {
  try {
    return homedir6();
  } catch {
    return tmpdir5();
  }
})();
var _OC_SID3 = "opencode-" + (process.pid || "x") + "-" + Date.now();
var SCRATCHPAD_ROOT2 = join7(USER_HOME5, ".claude/scratch");
var SCRATCHPAD_GLOBAL_DIR2 = join7(SCRATCHPAD_ROOT2, "by-hash");
var SCRATCHPAD_SESSIONS_DIR2 = join7(SCRATCHPAD_ROOT2, "sessions");
var STATE_FILE4 = join7(USER_HOME5, ".claude/delegation-state.json");
var currentModel2 = null;
function getSessionRoot2() {
  return join7(SCRATCHPAD_SESSIONS_DIR2, _OC_SID3);
}
function getSessionScratchpadDir2() {
  return join7(getSessionRoot2(), "by-hash");
}
function getGlobalIndexPath2() {
  return join7(SCRATCHPAD_ROOT2, "index.jsonl");
}
var FETCH_TOOLS = /* @__PURE__ */ new Set(["WebFetch", "WebSearch", "webfetch", "websearch"]);
function researchAudit({ hours = 24, session: sessionFilter } = {}) {
  const cutoff = Date.now() - hours * 3600 * 1e3;
  const report = { totalFetches: 0, totalBytes: 0, estCost: 0, chains: [], byDomain: {}, sessions: 0, redundant: 0 };
  try {
    const indexPath = getGlobalIndexPath2();
    if (existsSync7(indexPath)) {
      const lines = readFileSync6(indexPath, "utf-8").trim().split("\n").filter(Boolean);
      const domainCache = {};
      for (const line of lines) {
        const e = JSON.parse(line);
        if (!FETCH_TOOLS.has(e.tool))
          continue;
        const ts = new Date(e.ts).getTime();
        if (ts < cutoff)
          continue;
        if (sessionFilter && e.session !== sessionFilter)
          continue;
        report.totalFetches++;
        report.totalBytes += e.size || 0;
        const hash = e.hash;
        const summaryPathSession = join7(getSessionScratchpadDir2(), hash + ".summary.txt");
        const summaryPathGlobal = join7(SCRATCHPAD_GLOBAL_DIR2, hash + ".summary.txt");
        const summaryPath = existsSync7(summaryPathSession) ? summaryPathSession : summaryPathGlobal;
        if (existsSync7(summaryPath)) {
          const summary = readFileSync6(summaryPath, "utf-8").slice(0, 200);
          const urlMatch = summary.match(/https?:\/\/([^\/\s\)]+)/i);
          const queryMatch = summary.match(/"query":"([^"]+)"/);
          let domain;
          if (urlMatch) {
            const parts = urlMatch[1].replace(/[\)\.,;:>]+$/, "").split(".");
            domain = parts.length >= 2 ? parts.slice(-2).join(".") : parts[0];
          } else if (queryMatch) {
            domain = queryMatch[1].split(/\s+/).slice(0, 3).join(" ");
          } else {
            const wordSeq = summary.match(/^([A-Z][a-zA-Z.&-]+(?:\s+[A-Z][a-zA-Z.&-]+)*)/);
            domain = wordSeq?.[1] || (e.tool === "WebSearch" ? "web-search" : "unknown");
          }
          const domainKey = typeof domain === "string" ? domain : "unknown";
          domainCache[hash] = domainKey;
          report.byDomain[domainKey] = (report.byDomain[domainKey] || 0) + 1;
        } else {
          report.byDomain.unknown = (report.byDomain.unknown || 0) + 1;
        }
      }
      const unknownCount = report.byDomain.unknown || 0;
      if (unknownCount > report.totalFetches * 0.3 && report.totalFetches > 5) {
        console.error(`[vibeOS] ${unknownCount}/${report.totalFetches} fetches have unknown domain \u2014 summary files may be missing or fetches failed silently`);
      }
      const entries = lines.map((l) => JSON.parse(l)).filter((e) => FETCH_TOOLS.has(e.tool) && new Date(e.ts).getTime() >= cutoff).sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
      const domainSeq = entries.map((e) => domainCache[e.hash] || "unknown");
      let chainStart = -1;
      for (let i = 2; i < domainSeq.length; i++) {
        if (domainSeq[i] === domainSeq[i - 1] && domainSeq[i - 1] === domainSeq[i - 2]) {
          if (chainStart === -1 || domainSeq[i] !== domainSeq[chainStart]) {
            chainStart = i - 2;
            const domain = domainSeq[i];
            let chainEnd = i;
            while (chainEnd < domainSeq.length && domainSeq[chainEnd] === domain)
              chainEnd++;
            report.chains.push({ domain, count: chainEnd - chainStart, startIdx: chainStart });
            i = chainEnd;
            chainStart = -1;
          }
        }
      }
    }
  } catch (err) {
    console.error(`[vibeOS] researchAudit index scan failed: ${err.message}`);
  }
  try {
    if (existsSync7(STATE_FILE4)) {
      const state = safeJsonParse3(readFileSync6(STATE_FILE4, "utf-8"));
      for (const [sid, s] of Object.entries(state.sessions || {})) {
        if (sessionFilter && sid !== sessionFilter)
          continue;
        report.sessions++;
        const tc = s.tool_counts || {};
        const fetchCount = (tc.WebFetch || 0) + (tc.WebSearch || 0) + (tc.webfetch || 0) + (tc.websearch || 0);
        const c7Warns = (s.warns || []).filter((w) => w.reason?.includes("context7")).length;
        if (fetchCount > 0) {
          report.byDomain["_session"] = (report.byDomain["_session"] || 0) + 1;
        }
        report.redundant += c7Warns;
      }
    }
  } catch (err) {
    console.error(`[vibeOS] researchAudit state scan failed: ${err.message}`);
  }
  const brainCost = currentModel2 ? modelCostPerTurn(currentModel2) ?? 3e-3 : 3e-3;
  report.estCost = Math.round(report.totalFetches * brainCost * 100) / 100;
  return report;
}

// src/lib/reporting.js
import { readFileSync as readFileSync7, writeFileSync as writeFileSync6, existsSync as existsSync8, mkdirSync as mkdirSync6, statSync as statSync7, copyFileSync as copyFileSync5, rmSync as rmSync4 } from "node:fs";
import { join as join8, basename as basename6 } from "node:path";
import { homedir as homedir7, tmpdir as tmpdir6 } from "node:os";
var USER_HOME6 = (() => {
  try {
    return homedir7();
  } catch {
    return tmpdir6();
  }
})();
var REPORTS_DIR2 = join8(USER_HOME6, ".claude/reports");
var REPORTS_INDEX = join8(REPORTS_DIR2, "index.json");
var _OC_SID4 = "opencode-" + (process.pid || "x") + "-" + Date.now();
var currentProjectFingerprint3 = "";
var currentProjectName2 = "";
function _handleStateCorruption5(path) {
  const backupDir = join8(USER_HOME6, ".claude", ".backups");
  mkdirSync6(backupDir, { recursive: true });
  const backupPath = join8(backupDir, basename6(path) + ".corrupted." + Date.now());
  try {
    copyFileSync5(path, backupPath);
  } catch {
  }
}
function readJsonOrEmpty3(filePath) {
  try {
    if (!existsSync8(filePath))
      return {};
    const st = statSync7(filePath);
    if (st.size > 10485760) {
      _handleStateCorruption5(filePath);
      return {};
    }
    return safeJsonParse3(readFileSync7(filePath, "utf-8"));
  } catch {
    _handleStateCorruption5(filePath);
    return {};
  }
}
function reportsIndex() {
  const idx = readJsonOrEmpty3(REPORTS_INDEX);
  if (!idx || !Array.isArray(idx.reports))
    return { reports: [] };
  return idx;
}
function saveReportsIndex(idx) {
  try {
    withFileLock(REPORTS_INDEX, () => {
      mkdirSync6(REPORTS_DIR2, { recursive: true });
      writeFileSync6(REPORTS_INDEX, JSON.stringify(idx, null, 2) + "\n");
    });
  } catch (err) {
    console.error(`[vibeOS] reports index write failed: ${err.message}`);
  }
}
function generateReportId(type, fp3) {
  const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:-]/g, "").replace(/\..+/, "");
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${ts}-${(fp3 || "unknown").slice(0, 6)}-${type}-${rnd}`;
}
var _reportDedupWindow = /* @__PURE__ */ new Map();
function _wouldBeDuplicate(type, summary) {
  if (typeof summary !== "string")
    return false;
  const trunc = Math.min(summary.length, 240);
  const key = `${type || ""}::${summary.slice(0, trunc)}`;
  const last = _reportDedupWindow.get(key);
  if (last && Date.now() - last < 5 * 60 * 1e3)
    return true;
  _reportDedupWindow.set(key, Date.now());
  if (_reportDedupWindow.size > 200) {
    const oldest = [..._reportDedupWindow.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest)
      _reportDedupWindow.delete(oldest[0]);
  }
  return false;
}
function _pruneReports() {
  try {
    const idx = reportsIndex();
    const now = Date.now();
    const keep = [];
    for (const r of idx.reports) {
      const created = new Date(r.created).getTime();
      if (isNaN(created))
        continue;
      if (now - created > 90 * 24 * 3600 * 1e3) {
        try {
          rmSync4(join8(REPORTS_DIR2, `${r.id}.json`));
        } catch {
        }
        continue;
      }
      keep.push(r);
    }
    const pruned = keep.sort((a, b) => b.created.localeCompare(a.created)).slice(0, 200);
    if (pruned.length !== idx.reports.length) {
      idx.reports = pruned;
      saveReportsIndex(idx);
      console.error(`[vibeOS] reports pruned: ${idx.reports.length} kept (from ${keep.length})`);
    }
  } catch (err) {
    console.error(`[vibeOS] reports prune failed: ${err.message}`);
  }
}
function _parseFindings(v) {
  if (Array.isArray(v))
    return v;
  if (typeof v !== "string" || !v.trim())
    return [];
  try {
    return JSON.parse(v);
  } catch {
  }
  const result = [];
  for (const line of v.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^(warn|info|hint)\s*:\s*(.+?)\s*:\s*(.+)/i);
    if (m)
      result.push({ severity: m[1].toLowerCase(), topic: m[2].trim(), detail: m[3].trim() });
    else
      result.push({ severity: "info", topic: "Note", detail: line });
  }
  return result;
}
function _parseMetrics(v) {
  if (v && typeof v === "object" && !Array.isArray(v))
    return v;
  if (typeof v !== "string" || !v.trim())
    return {};
  try {
    return JSON.parse(v);
  } catch {
  }
  const result = {};
  for (const line of v.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^([\w-]+)\s*=\s*([\d.]+)/);
    if (m)
      result[m[1]] = parseFloat(m[2]);
  }
  return result;
}
function saveReport({ type = "manual", summary = "", findings = null, metrics = null, narrative = "", tags = [], fingerprint = null } = {}) {
  const parsedFindings = _parseFindings(findings);
  const parsedMetrics = _parseMetrics(metrics);
  if (_wouldBeDuplicate(type, summary))
    return null;
  const fp3 = fingerprint || currentProjectFingerprint3 || "unknown";
  const id2 = generateReportId(type, fp3);
  const report = {
    meta: { id: id2, project: currentProjectName2 || "unknown", fingerprint: fp3, type, created: (/* @__PURE__ */ new Date()).toISOString(), sessionId: _OC_SID4 },
    summary,
    findings: parsedFindings,
    metrics: parsedMetrics,
    narrative,
    tags
  };
  try {
    withFileLock(REPORTS_INDEX, () => {
      mkdirSync6(REPORTS_DIR2, { recursive: true });
      writeFileSync6(join8(REPORTS_DIR2, `${id2}.json`), JSON.stringify(report, null, 2) + "\n");
      const idx = reportsIndex();
      const _sum = (summary || "").slice(0, 80);
      idx.reports.push({ id: id2, type, project: report.meta.project, fingerprint: fp3, created: report.meta.created, summary: _sum });
      writeFileSync6(REPORTS_INDEX, JSON.stringify(idx, null, 2) + "\n");
    });
  } catch (err) {
    console.error(`[vibeOS] report/index write failed: ${err.message}`);
    return null;
  }
  _pruneReports();
  return id2;
}
function listReports({ type, project, hours = 168, fingerprint } = {}) {
  const cutoff = Date.now() - hours * 3600 * 1e3;
  const idx = reportsIndex();
  return idx.reports.filter((r) => {
    if (type && r.type !== type)
      return false;
    if (project && r.project !== project)
      return false;
    if (fingerprint && r.fingerprint !== fingerprint)
      return false;
    const created = new Date(r.created).getTime();
    if (isNaN(created) || created < cutoff)
      return false;
    return true;
  }).sort((a, b) => b.created.localeCompare(a.created));
}
function readReport(id2) {
  if (!id2)
    return null;
  if (!/^[\w-]+$/.test(String(id2)))
    return null;
  const path = join8(REPORTS_DIR2, `${id2}.json`);
  try {
    if (!existsSync8(path))
      return null;
    return safeJsonParse3(readFileSync7(path, "utf-8"));
  } catch {
    return null;
  }
}

// src/lib/credit-api.js
import { readFileSync as readFileSync8, writeFileSync as writeFileSync7, existsSync as existsSync9 } from "node:fs";
import { join as join9 } from "node:path";
function safeJsonParse4(raw) {
  try {
    return JSON.parse(raw);
  } catch {
  }
  let cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw e;
  }
}
function _cachedPct() {
  try {
    if (!existsSync9(CREDIT_CACHE_F))
      return null;
    const s = safeJsonParse4(readFileSync8(CREDIT_CACHE_F, "utf-8"));
    if (s?.total == null || !s.ts)
      return null;
    let budget = 50;
    try {
      const p = join9(USER_HOME2, ".claude/model-tiers.json");
      if (existsSync9(p)) {
        const j = safeJsonParse4(readFileSync8(p, "utf-8"));
        if (j?.selection?.monthly_budget_usd)
          budget = j.selection.monthly_budget_usd;
      }
    } catch {
    }
    return budget > 0 ? Math.min(150, Math.max(0, Math.round(s.total / budget * 100))) : null;
  } catch {
    return null;
  }
}
function loadCredit() {
  const pct = _cachedPct();
  if (pct !== null)
    return pct;
  if (process.env.CLAUDE_CREDIT_PERCENT) {
    const n = parseInt(process.env.CLAUDE_CREDIT_PERCENT, 10);
    if (!isNaN(n))
      return n;
  }
  try {
    const f = join9(USER_HOME2, ".claude/credit-percent");
    if (existsSync9(f)) {
      const n = parseInt(readFileSync8(f, "utf-8").trim(), 10);
      if (!isNaN(n))
        return n;
    }
  } catch {
  }
  return 50;
}
function thinkingLevel(credit) {
  if (credit >= 70)
    return "full";
  if (credit >= 40)
    return "brief";
  return "brief";
}

// src/lib/trinity-rebuild.js
import { readFileSync as readFileSync9, existsSync as existsSync10 } from "node:fs";
import { join as join10 } from "node:path";
var MODEL_RANK = { high: 3, mid: 2, budget: 1 };
var OPENCODE_GO_CATALOG = [
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-chat",
  "deepseek/deepseek-reasoner"
];
function _modelCost(id2) {
  if (!id2)
    return 0;
  const c = modelCostPerTurn(id2);
  if (c != null)
    return c;
  const stripped = id2.replace(/^(openrouter|opencode|deepseek)\//, "");
  return modelCostPerTurn(stripped) ?? modelCostPerTurn("deepseek/" + stripped) ?? 0;
}
function _modelTier(id2) {
  if (!id2)
    return "budget";
  const high = HIGH_TIER_RE2?.test?.(id2);
  if (high)
    return "high";
  const mid = MID_TIER_RE2?.test?.(id2);
  return mid ? "mid" : "budget";
}
async function discoverAvailableModels(providers, auth) {
  const all = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (m) => {
    if (seen.has(m.id))
      return;
    seen.add(m.id);
    all.push(m);
  };
  const pushIfNew = (id2, provider) => push({ id: id2, provider, cost: _modelCost(id2), tier: _modelTier(id2) });
  if (providers.deepseek?.models) {
    for (const rawId of Object.keys(providers.deepseek.models)) {
      const id2 = rawId.includes("/") ? rawId : "deepseek/" + rawId;
      pushIfNew(id2, "deepseek");
    }
  }
  if (auth.deepseek?.key) {
    try {
      const res = await fetch("https://api.deepseek.com/models", {
        headers: { Authorization: "Bearer " + auth.deepseek.key },
        signal: AbortSignal.timeout(4e3)
      });
      if (res.ok) {
        const body = await res.json();
        const list = body?.data || body?.models || [];
        for (const m of list) {
          const rawId = (typeof m === "string" ? m : m.id) || "";
          if (!rawId)
            continue;
          const id2 = rawId.includes("/") ? rawId : "deepseek/" + rawId;
          pushIfNew(id2, "deepseek");
        }
      }
    } catch {
    }
  }
  if (auth.openrouter?.key) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: "Bearer " + auth.openrouter.key },
        signal: AbortSignal.timeout(5e3)
      });
      if (res.ok) {
        const body = await res.json();
        const list = body?.data || [];
        const pricingMap = {};
        for (const m of list) {
          const rawId = m.id;
          if (!rawId)
            continue;
          const dynTurnCost = _parseOpenRouterTurnCost(m);
          if (dynTurnCost != null && Number.isFinite(dynTurnCost)) {
            pricingMap[normalizeModelId(rawId)] = dynTurnCost;
          }
          const id2 = "openrouter/" + rawId;
          pushIfNew(id2, "openrouter");
        }
        if (Object.keys(pricingMap).length > 0)
          _writeDynamicPricingCache(pricingMap);
      }
    } catch (e) {
      console.error("[vibeOS] OpenRouter probe failed:", e.message);
    }
  }
  for (const id2 of OPENCODE_GO_CATALOG) {
    pushIfNew(id2, "opencode");
  }
  return all;
}
function classifyAndRankModels(models) {
  if (!models || models.length === 0)
    return null;
  const unique = [];
  const seen = /* @__PURE__ */ new Set();
  for (const m of models) {
    if (seen.has(m.id))
      continue;
    seen.add(m.id);
    unique.push({ ...m });
  }
  if (unique.length === 0)
    return null;
  unique.sort((a, b) => {
    const ra = MODEL_RANK[a.tier] || 0;
    const rb = MODEL_RANK[b.tier] || 0;
    return rb !== ra ? rb - ra : b.cost - a.cost;
  });
  const cheapest = [...unique].sort((a, b) => {
    return a.cost !== b.cost ? a.cost - b.cost : (MODEL_RANK[b.tier] || 0) - (MODEL_RANK[a.tier] || 0);
  });
  return {
    brain: unique[0],
    medium: unique.length > 1 ? unique[1] : unique[0],
    cheap: cheapest[0]
  };
}
function modelToCcAlias(modelId) {
  if (!modelId)
    return "haiku";
  let m = String(modelId).toLowerCase().replace(/\./g, "-").replace(/^(openrouter|opencode|deepseek|anthropic|google)\//, "");
  m = m.replace(/^(anthropic|google|openai|meta-llama|mistralai|qwen)\//, "");
  const map = {
    "deepseek-v4-pro": "deepseek-reasoner",
    "deepseek-v4-flash": "haiku",
    "deepseek-chat": "haiku",
    "deepseek-reasoner": "deepseek-reasoner",
    "deepseek-r1": "deepseek-reasoner",
    "sonnet": "sonnet",
    "claude-sonnet": "sonnet",
    "opus": "opus",
    "claude-opus": "opus",
    "haiku": "haiku",
    "claude-haiku": "haiku",
    "gemini": "sonnet",
    "gpt": "sonnet",
    "qwq": "sonnet"
  };
  if (map[m])
    return map[m];
  if (m.length < 3)
    return "haiku";
  for (const [k, v] of Object.entries(map)) {
    if (!k || k.length < 3)
      continue;
    if (m.startsWith(k) || k.startsWith(m))
      return v;
  }
  return "haiku";
}

// src/lib/hooks/footer.js
import { readFileSync as readFileSync11 } from "node:fs";
import { join as join13 } from "node:path";
import { homedir as homedir8, tmpdir as tmpdir7 } from "node:os";

// src/lib/hooks/chat-transform.js
import { readFileSync as readFileSync10, writeFileSync as writeFileSync9, existsSync as existsSync11, mkdirSync as mkdirSync7 } from "node:fs";
import { join as join12, basename as basename7 } from "node:path";
import { createHash as createHash4 } from "node:crypto";

// src/lib/index-helpers.js
import { join as join11 } from "node:path";
import { writeFileSync as writeFileSync8 } from "node:fs";

// src/lib/text-compress.js
var VERBOSE_LINE_RE = [
  /^[\s#*/\\\-_=+|~:;'"`@\$%^&<>{}\[\]()!?.,0-9]+$/,
  /^(Filed|Created|Modified|Deleted|Updated|Renamed|Copied|Moved|Changed):/,
  /^➡️|^  👉|^  \-|^  \*|^  \d+\.|^  \d+\)/
];
var BULLET_PATTERNS = [
  /^\s*[-*+•·]\s+/,
  /^\s*\d+[.)]\s+/
];
var COMPRESS_RATIO = 0.3;
var COMPRESS_THRESHOLD = 2e3;
var MIN_KEPT_LINES_RATIO = 0.4;
function extractBulletLines(lines, targetChars, minLines) {
  const keyLines = [];
  const otherLines = [];
  for (const line of lines) {
    if (BULLET_PATTERNS.some((re) => re.test(line)))
      keyLines.push(line);
    else
      otherLines.push(line);
  }
  const selected = [...keyLines];
  for (const line of otherLines) {
    if (selected.length >= minLines && selected.join("\n").length >= targetChars)
      break;
    selected.push(line);
  }
  while (selected.length > minLines && selected.join("\n").length > targetChars * 2) {
    selected.pop();
  }
  return selected;
}
function compressText(text) {
  if (!text || typeof text !== "string")
    return text;
  let lines = text.split("\n");
  let removed = 0;
  const out = [];
  for (const line of lines) {
    let skip = false;
    for (const re of VERBOSE_LINE_RE) {
      if (re.test(line)) {
        skip = true;
        removed++;
        break;
      }
    }
    if (!skip)
      out.push(line);
  }
  const collapsed = [];
  let blanks = 0;
  for (const line of out) {
    if (line.trim() === "") {
      blanks++;
      if (blanks <= 2)
        collapsed.push(line);
    } else {
      blanks = 0;
      collapsed.push(line);
    }
  }
  let result = collapsed.join("\n").trim();
  if (result.length > COMPRESS_THRESHOLD) {
    const targetChars = Math.max(Math.round(result.length * COMPRESS_RATIO), COMPRESS_THRESHOLD);
    const minLines = Math.max(1, Math.round(collapsed.length * MIN_KEPT_LINES_RATIO));
    const bulletLines = extractBulletLines(collapsed, targetChars, minLines);
    result = bulletLines.join("\n").trim();
    if (result.length > targetChars * 1.5) {
      const cutoff = result.lastIndexOf("\n\n", targetChars);
      if (cutoff > targetChars * 0.5) {
        result = result.slice(0, cutoff) + `

... [${result.length - cutoff} chars truncated]`;
      } else {
        result = result.slice(0, targetChars) + `... [${result.length - targetChars} chars truncated]`;
      }
    }
  }
  if (removed > 0 || result !== collapsed.join("\n").trim()) {
    console.error(`[vibeOS] COMPRESS: ${text.length}->${result.length} chars (${removed} verbose lines stripped)`);
  }
  return result || text;
}

// src/lib/index-helpers.js
var activeJob = null;
function setActiveJobFromTaskPrompt(prompt) {
  if (!prompt || typeof prompt !== "string")
    return;
  const p = prompt.trim();
  if (p.length < 24)
    return;
  activeJob = {
    prompt: p.slice(0, 1200),
    keywords: topKeywords(p, 12),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  saveActiveJobForProject(activeJob);
}
function noteProjectPattern(kind, key, summary, meta = {}) {
  if (!currentProjectFingerprint || !key || !summary)
    return;
  try {
    const pstate = loadProjectState();
    const bucket = ensureProjectBucket(pstate, currentProjectFingerprint);
    bucket.userPatterns ??= { friction: {}, routines: {} };
    bucket.userPatterns.friction ??= {};
    bucket.userPatterns.routines ??= {};
    const target = kind === "routine" ? bucket.userPatterns.routines : bucket.userPatterns.friction;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const row = target[key] || { kind, summary, count: 0, sessions: [], firstSeen: now, lastSeen: null };
    row.kind = kind;
    row.summary = summary;
    row.count = Number(row.count || 0) + 1;
    row.sessions = [.../* @__PURE__ */ new Set([...row.sessions || [], _OC_SID])].slice(-10);
    row.lastSeen = now;
    if (meta.family)
      row.family = meta.family;
    if (meta.path)
      row.path = meta.path;
    target[key] = row;
    const entries = Object.entries(target);
    if (entries.length > 50) {
      entries.sort((a, b) => String(b[1]?.lastSeen || "").localeCompare(String(a[1]?.lastSeen || "")));
      const kept = Object.fromEntries(entries.slice(0, 50));
      for (const k of Object.keys(target))
        delete target[k];
      Object.assign(target, kept);
    }
    bucket.lastSeen = now;
    saveProjectState(pstate);
  } catch (err) {
    console.error(`[vibeOS] pattern learner write failed: ${err.message}`);
  }
}
function recordFrictionPattern(key, summary, meta = {}) {
  const sessionKey = `friction:${key}`;
  if (frictionSessionKeys.has(sessionKey))
    return;
  frictionSessionKeys.add(sessionKey);
  noteProjectPattern("friction", key, summary, meta);
}
function recordRoutinePattern(key, summary, meta = {}) {
  const sessionKey = `routine:${key}`;
  if (routineSessionKeys.has(sessionKey))
    return;
  routineSessionKeys.add(sessionKey);
  noteProjectPattern("routine", key, summary, meta);
}
var _lastStressWrite = 0;
var STRESS_WRITE_INTERVAL_MS = 15e3;
function saveSessionStress(score, level) {
  if (typeof score !== "number" || !isFinite(score))
    return;
  const now = Date.now();
  if (now - _lastStressWrite < STRESS_WRITE_INTERVAL_MS)
    return;
  _lastStressWrite = now;
  try {
    updateState((s) => {
      const sid = _OC_SID;
      const ses = s.sessions?.[sid] || {};
      if (!Array.isArray(ses.stress_history))
        ses.stress_history = [];
      ses.stress_history.push({ ts: (/* @__PURE__ */ new Date()).toISOString(), score, level });
      if (ses.stress_history.length > 100)
        ses.stress_history = ses.stress_history.slice(-50);
      const scores = ses.stress_history.map((h) => h.score);
      ses.maxSessionStress = Math.max(...scores);
      ses.avgSessionStress = scores.reduce((a, b) => a + b, 0) / scores.length;
      s.sessions[sid] = ses;
      return s;
    });
  } catch {
  }
}
function observeToolPattern(toolName, input, output, directory3) {
  try {
    const t = String(toolName || "").toLowerCase();
    const args = input?.args || {};
    const filePath = args.filePath || args.file_path || args.path || "";
    const observedPath = normalizeObservedPath(filePath, directory3);
    let target = observedPath;
    if (t === "bash")
      target = commandFamily(args.command || args.cmd || args.script || "");
    if (t === "task")
      target = extractFirstWordFromArgs(t, args) || "task";
    const event = { tool: t, target, at: Date.now() };
    recentToolEvents.push(event);
    if (recentToolEvents.length > 20)
      recentToolEvents.shift();
    let repeat = 0;
    for (let i = recentToolEvents.length - 1; i >= 0; i--) {
      const e = recentToolEvents[i];
      if (e.tool !== event.tool || e.target !== event.target)
        break;
      repeat++;
    }
    if (repeat === 3) {
      recordFrictionPattern(`repeat-tool:${t}:${target}`, `Repeated ${t} calls against ${target} in one session.`, { family: t, path: target });
      _patternFiredKeys.add(`repeat-tool:${t}:${target}`);
    }
    if (repeat > 3) {
      try {
        updateGlobalLearning((gl) => {
          gl.patternQuality ??= { ignoredCount: 0, trustedCount: 0 };
          gl.patternQuality.ignoredCount = (gl.patternQuality.ignoredCount || 0) + 1;
          return gl;
        });
      } catch {
      }
    }
    if (repeat === 0 && _patternFiredKeys.size > 0) {
      try {
        updateGlobalLearning((gl) => {
          gl.patternQuality ??= { ignoredCount: 0, trustedCount: 0 };
          gl.patternQuality.trustedCount = (gl.patternQuality.trustedCount || 0) + 1;
          return gl;
        });
      } catch {
      }
    }
    if (["write", "edit", "multiedit", "notebookedit"].includes(t) && observedPath !== "unknown") {
      setLastMutationEvent({ at: Date.now(), path: observedPath, tool: t });
      return;
    }
    if (t === "bash") {
      const family = commandFamily(args.command || args.cmd || args.script || "");
      if (lastMutationEvent && Date.now() - lastMutationEvent.at <= 10 * 60 * 1e3) {
        if (["syntax-check", "typecheck", "test", "build"].includes(family) && commandFailed(output)) {
          recordFrictionPattern(`post-edit-failure:${lastMutationEvent.path}:${family}`, `After editing ${lastMutationEvent.path}, ${family} failed soon after.`, { family, path: lastMutationEvent.path });
        } else if (["syntax-check", "typecheck", "test", "build", "git-status"].includes(family) && !commandFailed(output)) {
          recordRoutinePattern(`post-edit-routine:${lastMutationEvent.path}:${family}`, `After editing ${lastMutationEvent.path}, ${family} is a recurring verification step.`, { family, path: lastMutationEvent.path });
        }
      }
    }
  } catch (err) {
    console.error(`[vibeOS] pattern learner observe failed: ${err.message}`);
  }
  try {
    const t = String(toolName || "").toLowerCase();
    const args = input?.args || {};
    const ev = { tool: t, at: Date.now() };
    if (recentToolEvents.length > 0) {
      const prev = recentToolEvents[recentToolEvents.length - 1];
      const pairKey = `${prev.tool}\u2192${ev.tool}`;
      updateGlobalLearning((gl) => {
        gl.toolPairs ??= {};
        gl.toolPairs[pairKey] = (gl.toolPairs[pairKey] || 0) + 1;
        if (gl.toolPairs[pairKey] >= 3 && !gl.promotedRoutines?.includes(pairKey)) {
          gl.promotedRoutines ??= [];
          if (!gl.promotedRoutines.includes(pairKey))
            gl.promotedRoutines.push(pairKey);
          recordRoutinePattern(`pair:${pairKey}`, `Recurring tool pair ${pairKey} detected across projects.`, { pair: pairKey });
        }
        return gl;
      });
    }
    if (currentProjectName) {
      const ext = currentProjectName.endsWith(".tsx") || currentProjectName.endsWith(".jsx") ? "frontend" : currentProjectName.endsWith(".go") || currentProjectName.endsWith(".rs") ? "backend" : currentProjectName.endsWith(".py") ? "data" : "unknown";
      updateGlobalLearning((gl) => {
        gl.projectTypeToolCount ??= {};
        const ptc = gl.projectTypeToolCount;
        ptc[ext] ??= {};
        ptc[ext][t] = (ptc[ext][t] || 0) + 1;
        return gl;
      });
    }
  } catch {
  }
}
function recordSaving(tool2, reason, saveEst, meta = {}) {
  try {
    if (!saveEst || saveEst <= 0)
      return 0;
    const firstWord = meta?.firstWord || tool2 || "";
    updateState((s) => {
      s.lifetime ??= { total_savings_usd: 0, cache_savings_usd: 0, missed_context7_usd: 0, session_count: 0, warn_count: 0 };
      s.sessions ??= {};
      const sid = _OC_SID;
      if (!s.sessions[sid]) {
        s.sessions[sid] = { total_savings_usd: 0, cache_savings_usd: 0, project_name: "", warns: [], cache_hits: [], seenWarnKeys: {} };
        if (currentProjectFingerprint) {
          s.sessions[sid].project_fingerprint = currentProjectFingerprint;
        }
        if (currentProjectName) {
          s.sessions[sid].project_name = currentProjectName;
        }
      }
      const ses = s.sessions[sid];
      ses.total_savings_usd = roundUsd(Number(ses.total_savings_usd || 0) + saveEst);
      s.lifetime.total_savings_usd = roundUsd(Number(s.lifetime.total_savings_usd || 0) + saveEst);
      s.lifetime.warn_count = (s.lifetime.warn_count || 0) + 1;
      if (reason && firstWord) {
        const now = Date.now();
        const warnKey = `${_OC_SID}:${firstWord}`;
        ses.seenWarnKeys ??= {};
        let deduped = false;
        for (let i = ses.warns.length - 1; i >= 0 && !deduped; i--) {
          const w = ses.warns[i];
          if (w?.key === warnKey && now - w.ts < WARN_DEDUPE_WINDOW_MS) {
            w.count = (w.count || 1) + 1;
            w.reason = reason;
            w.saveEst = (w.saveEst || 0) + saveEst;
            w.est_savings_usd = (w.est_savings_usd || 0) + saveEst;
            deduped = true;
          }
        }
        if (!deduped) {
          ses.warns.push({ key: warnKey, reason, saveEst, est_savings_usd: saveEst, firstWord, ts: now, count: 1, tool: tool2 });
        }
        if (!ses.seenWarnKeys[warnKey]) {
          ses.seenWarnKeys[warnKey] = true;
          try {
            noteTaskRoutingLearning(firstWord, TRINITY_CHEAP || TRINITY_MEDIUM || "unknown", `observed:${tool2}`);
          } catch {
          }
        }
      }
      const cap = 30;
      if (ses.warns.length > cap) {
        ses.warns = ses.warns.slice(-cap);
        const keys = Object.keys(ses.seenWarnKeys || {});
        if (keys.length > cap * 2) {
          ses.seenWarnKeys = Object.fromEntries(keys.slice(-cap * 2).map((k) => [k, true]));
        }
      }
      try {
        const sd = getSessionScratchpadDir();
        if (sd) {
          const sp = join11(sd, "delegation-state-hint.txt");
          try {
            writeFileSync8(sp, JSON.stringify({ sid, total_savings: s.lifetime.total_savings_usd, last_reason: reason }), "utf8");
          } catch {
          }
        }
      } catch {
      }
      ses.last_reason = reason;
      ses.last_save_est = saveEst;
      s.last_updated = (/* @__PURE__ */ new Date()).toISOString();
      _pruneOldSessions(s);
    });
    const entry = JSON.stringify({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      usd: saveEst,
      sid: _OC_SID,
      tool: tool2,
      reason,
      saveEst,
      fgp: currentProjectFingerprint || ""
    });
    _ledgerBuffer.push(entry);
    if (_ledgerBuffer.length >= LEDGER_BUFFER_MAX)
      _flushLedgerBuffer();
    else if (!_ledgerBufferTimer)
      setLedgerBufferTimer(setTimeout(_flushLedgerBuffer, LEDGER_BUFFER_FLUSH_MS));
    return saveEst;
  } catch (err) {
    try {
      saveSessionCheckpoint();
    } catch {
    }
    return 0;
  }
}

// src/lib/constants.js
var SAVE_EST = {
  WRITE_EDIT: 5e-3,
  SOFT_QUOTA: 3e-4,
  CONTEXT7: 2e-3,
  OPUS_DISABLE: 0.03
};
var WARN_ON_DIRECT = /* @__PURE__ */ new Set(["write", "edit", "notebookedit"]);
var SOFT_QUOTA = /* @__PURE__ */ new Set(["bash", "glob", "grep", "read", "webfetch", "websearch"]);
var FREE = /* @__PURE__ */ new Set(["todowrite", "question", "skill", "trinity", "report-list", "report-read", "report-save", "research-audit"]);
var COMPRESS_THRESHOLD2 = 2e3;
var KEEP_HOT = 10;
var COMPRESS_MARKER = "[ctx-compressed-v1]";
var PROTOCOL_MARKER = "[wbp-v1]";
var PROTOCOL_TEXT = PROTOCOL_MARKER + " [Worker-to-Brain Report Protocol] When synthesizing the preceding Task output: 1) EXTRACT core findings/data. 2) REFORMAT into bullet points. 3) VERIFY against the original ask. 4) SYNTHESIZE into final response.";

// src/lib/hooks/chat-transform.js
var latestUserIntent = null;
var currentProjectFingerprint4 = "";
var fp = "";
var _OC_SID5 = "opencode-" + (process.pid || "x") + "-" + Date.now();
var _latestBlackboxState3 = null;
var _latestBlackboxLoopMsg2 = null;
var _latestBlackboxPivotMsg2 = null;
var briefedProjects = /* @__PURE__ */ new Set();
var correctionSeenKeys = /* @__PURE__ */ new Set();
async function apiComputeControlVector(state, action, optimizationMode) {
  try {
    const res = await remoteCall("blackboxControlVector", [state, action, optimizationMode], null);
    if (res?.control_vector)
      return res.control_vector;
  } catch {
  }
  return {
    enforcement_mode: "normal",
    enforcement_reason: "[optimize: balanced] offline fallback",
    flow_mode: "normal",
    flow_focus: [],
    tdd_mode: "normal",
    tdd_focus: [],
    tier_bias: "auto",
    thinking_mode: "auto",
    stress_multiplier: 1,
    context7_urgency: "preferred",
    wbp_verbosity: "normal",
    optimization_mode: "balanced",
    directives: []
  };
}
function observeUserCorrection(text) {
  if (!text || typeof text !== "string")
    return;
  try {
    const t = text.toLowerCase();
    const corrections = [];
    if (/wrong\b|that.s wrong|incorrect|not what i|didn.t mean|misunderstood/i.test(t)) {
      if (/\bimport\b|require\b|from\b|path\b|module\b/i.test(t))
        corrections.push("correction:imports");
      if (/\bfunction\b|logic\b|algorithm\b|calculation\b|formula\b|return\b|result\b/i.test(t) && !corrections.includes("correction:imports"))
        corrections.push("correction:logic");
      if (/\brename\b|variable\b|const\b|let\b|var\b|name\b|called\b/i.test(t) && !corrections.includes("correction:logic"))
        corrections.push("correction:naming");
      if (/\bdelete\b|remove\b|get rid\b|revert\b|undo\b|rollback\b/i.test(t))
        corrections.push("correction:deletion");
      if (/\brestructure\b|refactor\b|reorganize\b|move\b|split\b|extract\b/i.test(t) && !corrections.includes("correction:deletion"))
        corrections.push("correction:restructure");
      if (corrections.length === 0)
        corrections.push("correction:general");
    }
    if (corrections.length === 0 && /\bshould be\b|change .+ to\b|replace .+ with\b|instead of\b/i.test(t)) {
      corrections.push("correction:general");
    }
    for (const c of corrections) {
      const sessionKey = `friction:${c}`;
      if (correctionSeenKeys.has(sessionKey))
        continue;
      correctionSeenKeys.add(sessionKey);
      try {
        noteProjectPattern("friction", c, `User corrected ${c.replace("correction:", "")} in a follow-up message.`, { family: c });
      } catch {
      }
    }
  } catch {
  }
}
function buildProjectBriefing(directory3) {
  const label = currentProjectName || (directory3 ? basename7(directory3) : "");
  if (!label)
    return null;
  return `[project memory] Active project: ${label}. Stay focused on the current repository and prefer the existing workflow.`;
}
function ensureProjectSkill(dir, fp3) {
  const skillsDir = join12(dir, ".opencode", "skills");
  const projectName = basename7(dir);
  const skillDir = join12(skillsDir, projectName);
  const skillPath = join12(skillDir, "SKILL.md");
  if (existsSync11(skillPath)) {
    return { created: false, skipped: true, path: skillPath };
  }
  const promoted = promotedProjectPatterns(fp3);
  if (!promoted || promoted.length === 0) {
    return { created: false, skipped: false };
  }
  const techStack = detectTechStack(dir);
  const globalLearning = loadGlobalLearning();
  const promotedRoutines = globalLearning.promotedRoutines || [];
  const skillName = `project-${projectName.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
  let content = `---
`;
  content += `name: ${skillName}
`;
  content += `description: Project-specific conventions, patterns, and workflows for ${projectName}. Auto-generated by vibeOS.
`;
  content += `---

`;
  content += `# ${projectName} Conventions

`;
  if (techStack.length > 0) {
    content += `## Tech Stack

`;
    content += techStack.map((t) => `- ${t}`).join("\n") + "\n\n";
  }
  const routines = promoted.filter((p) => p.label === "routine");
  if (routines.length > 0) {
    content += `## Routines (established workflows)

`;
    for (const r of routines) {
      content += `- ${r.summary} (${r.sessions} sessions)
`;
    }
    content += "\n";
  }
  const frictions = promoted.filter((p) => p.label === "friction");
  if (frictions.length > 0) {
    content += `## Frictions (patterns to avoid)

`;
    for (const f of frictions) {
      content += `- ${f.summary} (${f.sessions} sessions)
`;
    }
    content += "\n";
  }
  if (promotedRoutines.length > 0) {
    content += `## Common Tool Chains

`;
    for (const pair of promotedRoutines) {
      content += `- ${pair}
`;
    }
    content += "\n";
  }
  try {
    mkdirSync7(skillDir, { recursive: true });
    writeFileSync9(skillPath, content, "utf-8");
    console.error(`[vibeOS] Project Guard: created .opencode/skills/${projectName}/SKILL.md`);
    return { created: true, path: skillPath, skipped: false };
  } catch (err) {
    console.error(`[vibeOS] Project Guard: failed to create skill for ${projectName}: ${err.message}`);
    return { created: false, skipped: false };
  }
}
function syncControlSettings(cv) {
  if (!cv)
    return;
  try {
    const sid = _OC_SID5;
    const writeIf = (key, val) => {
      const sel = loadSelection();
      if (sel[key] !== val)
        writeSelection(key, val);
    };
    if (cv.enforcement_mode === "relaxed")
      writeIf("delegation_enforce", false);
    else
      writeIf("delegation_enforce", true);
    if (cv.flow_mode === "audit") {
      writeIf("flow_enabled", false);
      writeIf("flow_enforce", false);
    } else {
      writeIf("flow_enabled", true);
      writeIf("flow_enforce", cv.flow_mode === "strict");
    }
    if (cv.tdd_mode === "lazy") {
      writeIf("tdd_enforce", false);
      writeIf("tdd_strict", false);
    } else {
      writeIf("tdd_enforce", true);
      writeIf("tdd_strict", cv.tdd_mode === "strict");
    }
    if (cv.thinking_mode)
      writeIf("thinking_level", cv.thinking_mode);
    const userOptMode = loadSessionSlot(sid + "_opt") || loadOptimizationMode();
    if (cv.optimization_mode && userOptMode !== "auto") {
      if (userOptMode !== cv.optimization_mode) {
        writeSessionSlot(sid + "_opt", cv.optimization_mode);
        saveOptimizationMode(cv.optimization_mode);
      }
    }
    const slot = cv.tier_bias;
    if (slot && slot !== "auto") {
      const existingSlot = loadSessionSlot(sid);
      if (existingSlot !== slot) {
        writeSessionSlot(sid, slot);
      }
      if (slot === "brain" && TRINITY_BRAIN) {
        setCurrentModel(TRINITY_BRAIN);
        setCurrentTier("high");
      } else if (slot === "medium" && TRINITY_MEDIUM) {
        setCurrentModel(TRINITY_MEDIUM);
        setCurrentTier("mid");
      } else if (slot === "cheap" && TRINITY_CHEAP) {
        setCurrentModel(TRINITY_CHEAP);
        setCurrentTier("low");
      }
    }
  } catch {
  }
}
var onMessagesTransform = async (_input, output) => {
  if (!loadSelection().enabled)
    return;
  try {
    const messages = output?.messages;
    if (!Array.isArray(messages))
      return;
    const hotStart = Math.max(0, messages.length - KEEP_HOT);
    let compressedBytes = 0;
    for (let i = 0; i < messages.length; i++) {
      const { info, parts } = messages[i];
      if (!Array.isArray(parts))
        continue;
      const isCold = i < hotStart;
      for (const part of parts) {
        if (part?.type !== "tool")
          continue;
        const state = part.state;
        if (state?.status !== "completed")
          continue;
        const raw = state.output;
        if (!raw || typeof raw !== "string" || raw.length < COMPRESS_THRESHOLD2)
          continue;
        if (raw.includes(COMPRESS_MARKER))
          continue;
        const hash = createHash4("sha256").update(`tool_result
${raw}
`).digest("hex").slice(0, 16);
        const fullPath = join12(getSessionScratchpadDir(), `${hash}.txt`);
        try {
          ensureSessionScratchpadDirs();
          if (!existsSync11(fullPath)) {
            writeFileSync9(fullPath, raw);
            indexAppend(hash, part.tool, raw.length);
          }
        } catch (err) {
          console.error(`[vibeOS] ctx-compress write failed: ${err.message}`);
          continue;
        }
        if (!isCold)
          continue;
        const summary = raw.slice(0, 200).replace(/\n+/g, " ").trim() + (raw.length > 200 ? "\u2026" : "");
        const ref = `${COMPRESS_MARKER} [${raw.length} chars compressed \u2014 cold storage at ${fullPath}] [summary] ${summary}`;
        state.output = ref;
        compressedBytes += raw.length - ref.length;
        console.error(`[vibeOS] \u{1F4E6} ctx-compress: ${raw.length}\u2192${ref.length} chars (hash: ${hash})`);
      }
    }
    if (compressedBytes > 0) {
      console.error(`[vibeOS] \u{1F4E6} ctx-compress total saved this transform: ~${Math.round(compressedBytes / 4)} tokens`);
    }
    for (let i = 0; i < messages.length - 1; i++) {
      const { info, parts } = messages[i];
      if (!Array.isArray(parts))
        continue;
      const hasTask = parts.some((p) => p?.type === "tool" && p?.tool === "task" && p?.state?.status === "completed");
      if (!hasTask)
        continue;
      const nextMsg = messages[i + 1];
      if (!Array.isArray(nextMsg?.parts))
        continue;
      const alreadyHas = nextMsg.parts.some((p) => p?.type === "text" && p?.text?.includes(PROTOCOL_MARKER));
      if (alreadyHas)
        continue;
      const textPart = nextMsg.parts.find((p) => p?.type === "text");
      if (textPart) {
        textPart.text = textPart.text + "\n\n" + PROTOCOL_TEXT;
      } else {
        nextMsg.parts.push({ type: "text", text: PROTOCOL_TEXT, synthetic: true });
      }
    }
    applyDecadence();
    const lastUserMsg = messages.slice().reverse().find((m) => m.info?.role === "user");
    if (lastUserMsg) {
      const textPart = lastUserMsg.parts?.find((p) => p?.type === "text");
      if (textPart?.text) {
        latestUserIntent = textPart.text;
        try {
          if (_blackboxEnabled) {
            const tracker = getBlackboxTracker();
            const localState = tracker.update(latestUserIntent);
            const state = loadBlackboxState();
            const sid = _OC_SID5;
            const serialized = tracker.serialize();
            serialized.project_fingerprint = currentProjectFingerprint4 || "";
            if (!state.sessions[sid])
              state.sessions[sid] = {};
            state.sessions[sid].control_history ??= [];
            const st = scoreStress(latestUserIntent);
            if (st) {
              localState.latest_stress_multiplier = st;
              saveSessionStress(st, st > 1.5 ? "critical" : st > 0.7 ? "elevated" : st > 0.3 ? "moderate" : "none");
            }
            const cv = await apiComputeControlVector(localState, void 0, loadOptimizationMode());
            state.sessions[sid].control_history.push(buildControlHistoryEntry(state.sessions[sid].control_history.length + 1, localState.sub_regime || "INIT", cv));
            if (state.sessions[sid].control_history.length > 100) {
              state.sessions[sid].control_history = state.sessions[sid].control_history.slice(-100);
            }
            state.sessions[sid] = serialized;
            saveBlackboxState(state);
            _latestBlackboxState3 = localState;
            fetchBlackboxEnrichment(sid, localState).then((enriched) => {
              if (enriched)
                _latestBlackboxState3 = enriched;
            }).catch(() => {
            });
          }
        } catch {
        }
      }
    }
  } catch (err) {
    console.error(`[vibeOS] messages.transform failed: ${err.message}`);
  }
};
var onSystemTransform = async (_input, output) => {
  if (!loadSelection().enabled)
    return;
  try {
    if (!latestUserIntent) {
      const userText = extractLastUserText(_input) || extractLastUserText(output);
      latestUserIntent = typeof userText === "string" ? userText : null;
    }
    if (latestUserIntent)
      observeUserCorrection(latestUserIntent);
    let _controlVector = null;
    if (_latestBlackboxState3) {
      const st = latestUserIntent ? scoreStress(latestUserIntent) : 0;
      if (st)
        _latestBlackboxState3.latest_stress_multiplier = st;
      _controlVector = await apiComputeControlVector(_latestBlackboxState3, void 0, loadOptimizationMode());
    } else if (latestUserIntent) {
      const st = scoreStress(latestUserIntent);
      _controlVector = await apiComputeControlVector({ sub_regime: classifyTurnSimple(latestUserIntent), latest_stress_multiplier: st || void 0 }, void 0, loadOptimizationMode());
    }
    syncControlSettings(_controlVector);
    const c7urgency = _controlVector?.context7_urgency || "preferred";
    const c7directive = "[cost policy] If mcp__context7__resolve-library-id and mcp__context7__get-library-docs tools are available in this session, ALWAYS use them instead of WebFetch or WebSearch when looking up library or framework documentation (docs.*, readthedocs.*, npmjs.com/package/*, pypi.org/project/*, pkg.go.dev, /api/reference/). Do not fetch those URLs directly when context7 can serve the same content. This saves ~$0.06/turn on average." + (c7urgency === "required" ? " CRITICAL: context7 usage is REQUIRED this turn." : "") + (c7urgency === "optional" ? " (context7 is optional this turn \u2014 use if helpful but not required.)" : "");
    const sel = loadSelection();
    const { thinking_level: explicitLevel } = sel;
    if (explicitLevel && explicitLevel !== "full" && Array.isArray(output?.system)) {
      const credit = loadCredit();
      const creditNote = `credit ${credit}%`;
      const directives = {
        brief: `[thinking policy] Reasoning depth: BRIEF (manually set, ${creditNote}). Use extended thinking only for genuinely complex multi-step problems. Keep reasoning concise \u2014 skip exploratory scratch work and restatement.`,
        off: `[thinking policy] Reasoning depth: OFF (manually set, ${creditNote}). Skip extended thinking entirely. Respond directly and concisely. Every thinking token costs money \u2014 save it for when the user explicitly asks.`
      };
      const d = directives[explicitLevel];
      if (d)
        output.system.push(d);
    }
    if (Array.isArray(output?.system)) {
      output.system.push(c7directive);
    }
    if (latestUserIntent) {
      const stressMult = _controlVector?.stress_multiplier ?? 1;
      const _s = scoreStress(latestUserIntent) * stressMult;
      if (_s > 0.7) {
        if (Array.isArray(output?.system))
          output.system.push("[stress mitigation: CRITICAL] The user's message shows very high stress indicators. Stay calm, structured, and thorough. Use proper markdown formatting with code blocks, lists, and organized structure \u2014 do NOT mirror the user's tone or brevity. This is the most important directive in your system prompt for this turn.");
      } else if (_s > 0.4) {
        if (Array.isArray(output?.system))
          output.system.push("[stress mitigation: elevated] The user's message has elevated stress indicators. Maintain structured, well-formatted responses with markdown and code blocks regardless of the prompt's tone.");
      }
    }
    if (_controlVector && _controlVector.directives.length > 0) {
      for (const directive of _controlVector.directives) {
        if (Array.isArray(output?.system))
          output.system.push(directive);
      }
    } else if (_blackboxEnabled && _latestBlackboxState3 && _latestBlackboxState3.n_interactions > 0) {
      try {
        const res = _latestBlackboxState3;
        const decisionDirective = `[decision engine] Current resolution: ${res.resolution || "unresolved"} (${res.sub_regime || "EXPLORING"}). Momentum: ${(res.momentum || 0) > 0 ? "positive" : (res.momentum || 0) < 0 ? "negative" : "neutral"}. When offering guidance, consider the current resolution state \u2014 if looping or divergent, suggest stepping back; if converging or closed, support decisive action.`;
        if (Array.isArray(output?.system))
          output.system.push(decisionDirective);
        if (res.is_looping && res.loop_intervention_level && res.loop_intervention_level !== "none") {
          const severity = res.loop_intervention_level === "escalated" ? "CRITICAL" : res.loop_intervention_level === "assertive" ? "WARNING" : "NOTICE";
          const loopDirective = `[loop prevention: ${severity}] ${_latestBlackboxLoopMsg2 || "The conversation may be looping \u2014 try a different approach."} (level: ${res.loop_intervention_level})`;
          if (Array.isArray(output?.system))
            output.system.push(loopDirective);
        }
        if (res.pivot_detected && _latestBlackboxPivotMsg2) {
          if (Array.isArray(output?.system))
            output.system.push(`[context switch: PIVOT] ${_latestBlackboxPivotMsg2}`);
        }
      } catch {
      }
    }
    const projectJob = getActiveJobForProject();
    if (latestUserIntent && projectJob && isLikelyOffTopic(latestUserIntent, projectJob)) {
      const offTopicDirective = `[job-focus] Active job context exists: "${(projectJob.prompt || "").slice(0, 140)}...". The latest user request appears off-topic relative to this running job. Before taking write/edit/task actions, ask one concise confirmation question to validate switching scope.`;
      if (Array.isArray(output?.system))
        output.system.push(offTopicDirective);
      console.error("[vibeOS] [job-focus] off-topic request detected vs active job context");
    }
    if (sel.delegation_enforce && _controlVector?.enforcement_mode !== "relaxed" && Array.isArray(output?.system)) {
      const tierBias = _controlVector?.tier_bias || "auto";
      const cheapModel = TRINITY_CHEAP || "the cheaper model";
      const mediumModel = TRINITY_MEDIUM || "the medium model";
      let brainModel = "(brain)";
      try {
        brainModel = safeJsonParse3(readFileSync10(TIERS_FILE2, "utf-8")).trinity?.brain?.oc || brainModel;
      } catch {
      }
      const targetModel = tierBias === "cheap" ? cheapModel : tierBias === "medium" ? mediumModel : tierBias === "brain" ? brainModel : `${cheapModel} or ${mediumModel}`;
      const orcDirective = `[AI ORCHESTRATOR AGENT] You are an AI orchestrator agent. Delegate heavy work to Task subagents (runs on ${targetModel}). Your role: verify, fill gaps, synthesize. CRITICAL: Write/Edit tools are BLOCKED on this tier. You MUST delegate ALL implementation work to Task subagents. Always display the vibeOS cost footer.` + (tierBias !== "auto" ? ` [tier routing] This turn is biased toward ${tierBias} tier.` : "");
      output.system.push(orcDirective);
    }
    if (_controlVector?.enforcement_mode !== "relaxed" && Array.isArray(output?.system)) {
      output.system.push("[batch execution] When you need to run multiple independent Task subagent calls, invoke them ALL in parallel rather than sequentially. Parallel tasks complete faster and reduce total session cost. Only sequence tasks when one depends on the output of another.");
    }
    if (sel.tdd_enforce && _controlVector?.tdd_mode !== "lazy" && Array.isArray(output?.system)) {
      const tddMode = _controlVector?.tdd_mode || (sel.tdd_strict ? "strict" : "normal");
      const tddFocus = _controlVector?.tdd_focus || [];
      const modeNotes = {
        lazy: " Skeletons only when explicitly requested.",
        strict: " STRICT mode: TODO tests MUST pass before considering work complete.",
        quality: " QUALITY mode: Full coverage including edge cases."
      };
      const focusNote = tddFocus.length > 0 ? ` Focus: ${tddFocus.join(", ")}.` : "";
      output.system.push(`[tdd enforcement: ${tddMode}] Auto-create skeleton tests for source files being written/edited.${modeNotes[tddMode] || ""}${focusNote} When creating or modifying source files, ensure corresponding test files exist with proper assertions.`);
    }
    if (sel.flow_enabled && _controlVector?.flow_mode !== "audit" && Array.isArray(output?.system)) {
      const flowMode = _controlVector?.flow_mode || (sel.flow_enforce ? "normal" : "audit");
      const flowFocus = _controlVector?.flow_focus || [];
      const enforceNote = sel.flow_enforce ? " TODO/FIXME extraction is active." : "";
      const focusNote = flowFocus.length > 0 ? ` Focus rules: ${flowFocus.join(", ")}.` : "";
      output.system.push(`[flow enforcement: ${flowMode}] Development flow rules are active: write/edit operations are checked against project conventions.${enforceNote}${focusNote} Follow existing code patterns, naming conventions, and project structure.`);
    }
    if (Array.isArray(output?.system)) {
      output.system.push("[project guard: CRITICAL] AGENTS.md and README.md are protected by vibeOS. Do NOT modify either file without explicit user permission. When implementing new features, update README.md to document them. AGENTS.md defines that AI agents must ask before changing code \u2014 respect this rule.");
    }
    if (Array.isArray(output?.system)) {
      const ctxBudget = estimateContextBudget(_input, output);
      if (ctxBudget && ctxBudget.pct > 70) {
        const severity = ctxBudget.pct > 90 ? "CRITICAL" : "WARNING";
        output.system.push(`[context budget: ${severity}] Context window is ${ctxBudget.pct}% full (~${ctxBudget.estimatedTokens} tokens). Consider using Task subagents for heavy work, compressing tool outputs, or starting a new session to avoid context overflow.`);
      }
    }
    if (!briefedProjects.has(fp)) {
      const briefing = buildProjectBriefing(currentProjectName || "");
      if (briefing && Array.isArray(output?.system)) {
        output.system.push(briefing);
        briefedProjects.add(fp);
        console.error(`[vibeOS] project-memory: briefing injected for ${fp}`);
      }
    }
    if (!briefedProjects.has("trinity_welcome_" + fp)) {
      if (Array.isArray(output?.system)) {
        const sel2 = loadSelection();
        let tiers = {};
        try {
          tiers = safeJsonParse3(readFileSync10(TIERS_FILE2, "utf-8")).trinity || {};
        } catch {
        }
        const active = sel2.active_slot || "medium";
        const current = currentModel || "(unknown)";
        const trinityTip = "[vibeOS] Active plugin. Slot: " + active + " (" + current + "). Use trinity command to switch slots, rebuild, or check status. Run `trinity help` for all commands.";
        output.system.push(trinityTip);
        briefedProjects.add("trinity_welcome_" + fp);
      }
    }
    if (!briefedProjects.has("vibeos_dashboard_instruct")) {
      if (Array.isArray(output?.system)) {
        output.system.push("[vibeOS dashboard display] When the trinity tool returns output starting with '[vibeOS-dashboard]', you MUST use the question tool to display that data in a clean, human-readable format. Use the question field (not the header) to show the dashboard data. Format it with clear sections separated by blank lines, aligned columns with spaces, and plain text only (no emojis, no markdown). The header should be 'vibeOS Dashboard'. Include only one option in options: {label: 'Dismiss', description: ''}. Strip the '[vibeOS-dashboard]' marker line before displaying.");
        briefedProjects.add("vibeos_dashboard_instruct");
      }
    }
  } catch (err) {
    console.error(`[vibeOS] system.transform failed: ${err.message}`);
  }
};

// src/lib/hooks/footer.js
async function apiAutoSelectMode(regime, stress) {
  try {
    const res = await remoteCall("blackboxSelectMode", [regime, stress], null);
    if (res?.mode)
      return res.mode;
  } catch {
  }
  return "balanced";
}
var USER_HOME7 = (() => {
  try {
    return homedir8();
  } catch {
    return tmpdir7();
  }
})();
var STATE_FILE5 = join13(USER_HOME7, ".claude/delegation-state.json");
var SAVINGS_LEDGER_FILE2 = join13(USER_HOME7, ".claude/savings-ledger.jsonl");
var _prevOutputText = "";
var _autoReportCount = 0;
var textCompletePainted = /* @__PURE__ */ new Set();
function loadSelection3() {
  try {
    const raw = readFileSync11(join13(USER_HOME7, ".claude/model-tiers.json"), "utf-8");
    return safeJsonParse3(raw)?.selection || { active_slot: "medium", enabled: true, delegation_enforce: false, flow_enabled: false, flow_enforce: false, tdd_enforce: false, tdd_strict: false };
  } catch {
    return { active_slot: "medium", enabled: true, delegation_enforce: false, flow_enabled: false, flow_enforce: false, tdd_enforce: false, tdd_strict: false };
  }
}
function readLifetimeSavings2() {
  try {
    reconcileStateFromLedger();
    const raw = readFileSync11(STATE_FILE5, "utf-8");
    const state = safeJsonParse3(raw);
    const ses = state?.sessions?.[typeof _OC_SID6 !== "undefined" ? _OC_SID6 : ""] || {};
    return {
      ltTasks: roundUsd2(state?.lifetime?.total_savings_usd || 0),
      ltCache: roundUsd2(state?.lifetime?.cache_savings_usd || 0),
      ltCost: roundUsd2(state?.lifetime?.total_cost_usd || 0),
      count: state?.lifetime?.warn_count || 0,
      sesTasks: roundUsd2(ses?.total_savings_usd || 0),
      sesCache: roundUsd2(ses?.cache_savings_usd || 0),
      sesTaskDelegations: ses?.task_delegations_count || 0,
      sesDuration: ses?.duration_seconds || 0,
      sesRatePerHour: ses?.rate_per_hour || 0,
      sesTrend: ses?.trend || "",
      sesToolBreakdown: ses?.tool_breakdown || {},
      sesModelTurns: ses?.model_turns || {},
      quality_avg: ses?.quality_avg || 0
    };
  } catch {
    return { ltTasks: 0, ltCache: 0, ltCost: 0, count: 0, sesTasks: 0, sesCache: 0, sesTaskDelegations: 0, sesDuration: 0, sesRatePerHour: 0, sesTrend: "", sesToolBreakdown: {}, sesModelTurns: {}, quality_avg: 0 };
  }
}
var _OC_SID6 = "opencode-" + (process.pid || "x") + "-" + Date.now();
function scoreTaskQuality(outputText, promptText) {
  if (typeof outputText !== "string" || outputText.length === 0)
    return 0;
  if (typeof promptText !== "string")
    promptText = "";
  let score = 50;
  if (promptText.length > 0 && outputText.length > promptText.length * 0.5)
    score += 10;
  if (outputText.length < 50)
    score -= 20;
  if (/error|failed|unable|cannot|could not/i.test(outputText))
    score -= 10;
  if (/TODO|FIXME|placeholder/i.test(outputText) && outputText.length < 200)
    score -= 15;
  const codeBlocks = (outputText.match(/```/g) || []).length;
  if (codeBlocks >= 2)
    score += 10;
  if (outputText.length > 500)
    score += 10;
  if (outputText.length > 1e3)
    score += 5;
  return Math.max(0, Math.min(100, score));
}
async function _appendFooter(input, output, directory3) {
  if (!loadSelection3().enabled)
    return;
  _refreshModel(directory3);
  let _footerStress = 0;
  if (latestUserIntent)
    _footerStress = scoreStress(latestUserIntent);
  if (!currentModel) {
    try {
      const cfg = await client.config.get("model");
      if (cfg) {
        setCurrentModel(String(cfg));
        setCurrentTier(classify(String(cfg)));
        console.error(`[vibeOS] client-detected model: ${currentModel} (tier=${currentTier})`);
      }
    } catch {
    }
  }
  try {
    const messageID = input?.messageID || input?.messageId || input?.message?.id || output?.messageID || output?.messageId || output?.message?.id || null;
    if (messageID && textCompletePainted.has(messageID))
      return;
    const text = typeof output?.text === "string" ? output.text : typeof output?.result === "string" ? output.result : typeof output?.content === "string" ? output.content : "";
    const { ltTasks, ltCache, ltCost, count, sesTasks, sesEdit, sesCredit, sesC7, sesQuota, sesCache, sesTaskDelegations, sesDuration, sesRatePerHour, sesTrend, sesToolBreakdown, sesModelTurns, quality_avg } = readLifetimeSavings2();
    const sessionSlot = loadSessionSlot(_OC_SID6);
    const slot = sessionSlot || loadSelection3().active_slot || "brain";
    const brainModel = slot === "brain" ? TRINITY_BRAIN || currentModel : slot === "medium" ? TRINITY_MEDIUM || currentModel : TRINITY_CHEAP || currentModel || "";
    let modelTag = `[${shortModelName(brainModel)}]`;
    const _workerModel = slot === "brain" ? TRINITY_MEDIUM : null;
    const totalTurns = (sesModelTurns?.brain || 0) + (sesModelTurns?.worker || 0);
    if (_workerModel && _workerModel !== brainModel) {
      const brainPct = Math.round((sesModelTurns?.brain || 0) / (totalTurns || 1) * 100);
      modelTag = `[${shortModelName(brainModel)} ${brainPct}% \u2192 ${shortModelName(_workerModel)} ${100 - brainPct}%]`;
    }
    _autoReportCount = (_autoReportCount || 0) + 1;
    if (_autoReportCount % 5 === 0) {
      try {
        saveReport({
          type: "session",
          summary: "Session cost: $" + formatUsd(ltCost) + " | cache saved: $" + formatUsd(ltCache) + " | delegation saved: $" + formatUsd(Number(sesTasks || 0)) + " | task delegations: " + Number(sesTaskDelegations || 0),
          metrics: {
            sessionId: _OC_SID6,
            projectFingerprint: currentProjectFingerprint || "unknown",
            projectName: currentProjectName || "unknown",
            sessionCost: ltCost,
            cacheSavings: ltCache,
            delegationSavingsUsd: sesTasks,
            taskDelegationCount: sesTaskDelegations,
            // Backward compatibility (legacy field historically misnamed)
            tasksDelegated: sesTaskDelegations,
            model: currentModel,
            slot: loadSelection3().active_slot || "unknown",
            editSavings: sesEdit,
            creditSavings: sesCredit,
            context7Savings: sesC7,
            quotaSavings: sesQuota
          },
          tags: ["auto", "cost"]
        });
      } catch (e) {
        console.error("[vibeOS] auto-report:", e.message);
      }
    }
    const selNowFooter = loadSelection3();
    const enfTagsFooter = [];
    const bbMode = resolveEnforcementMode();
    if (bbMode === "relaxed") {
      enfTagsFooter.push("[Q&A]");
    } else {
      if (selNowFooter.delegation_enforce)
        enfTagsFooter.push("[ENF ON]");
      if (selNowFooter.flow_enforce)
        enfTagsFooter.push("[FLOW ON]");
      if (selNowFooter.tdd_enforce)
        enfTagsFooter.push("[TDD ON]");
      if (bbMode === "strict")
        enfTagsFooter.push("[STRICT]");
    }
    if (_modelLocked)
      enfTagsFooter.push("[LOCK ON]");
    let enfSuffixFooter = enfTagsFooter.length > 0 ? ` ${enfTagsFooter.join(" ")}` : "";
    if (quality_avg > 0) {
      enfSuffixFooter = ` QA:${Math.round(quality_avg)}% ${enfTagsFooter.join(" ")}`;
    }
    const optModeFooter = loadOptimizationMode();
    let optTagFooter = "";
    if (optModeFooter === "audit")
      optTagFooter = "[AUDIT]";
    else if (optModeFooter === "budget")
      optTagFooter = "[BUDGET]";
    else if (optModeFooter === "quality")
      optTagFooter = "[QUALITY]";
    else if (optModeFooter === "speed")
      optTagFooter = "[SPEED]";
    else if (optModeFooter === "longrun")
      optTagFooter = "[LONGRUN]";
    else if (optModeFooter === "auto") {
      const autoRegime = classifyTurnSimple(latestUserIntent || "");
      const autoStress = scoreStress(latestUserIntent || "");
      const autoActive = await apiAutoSelectMode(autoRegime, autoStress);
      const autoTag = { audit: "AUDIT", budget: "BUDGET", quality: "QUALITY", speed: "SPEED", longrun: "LONGRUN", balanced: "BALANCED" };
      optTagFooter = `[AUTO\u2192${autoTag[autoActive] || autoActive.toUpperCase()}]`;
      const slot2 = autoActive === "quality" ? "brain" : autoActive === "speed" ? "medium" : "cheap";
      if (!_modelLocked) {
        writeSessionSlot(_OC_SID6, slot2);
        if (slot2 === "brain" && TRINITY_BRAIN) {
          setCurrentModel(TRINITY_BRAIN);
          setCurrentTier("high");
        } else if (slot2 === "medium" && TRINITY_MEDIUM) {
          setCurrentModel(TRINITY_MEDIUM);
          setCurrentTier("mid");
        } else if (slot2 === "cheap" && TRINITY_CHEAP) {
          setCurrentModel(TRINITY_CHEAP);
          setCurrentTier("low");
        }
      }
    }
    modelTag = `${modelTag}${optTagFooter}${enfSuffixFooter || ""}`;
    const stripped = text.replace(/\n\n— .+(?: —)?$/, "");
    if (stripped !== text)
      return;
    const ltTotal = ltTasks + ltCache;
    const trendIcon = sesTrend === "down" ? "\u2193" : sesTrend === "up" ? "\u2191" : "\u2192";
    const brainModelCost = currentModel ? modelCostPerTurn(currentModel) ?? 0 : 0;
    const cheapModelCost = _workerModel ? modelCostPerTurn(_workerModel) ?? 0 : 0;
    const imputedMultiplier = brainModelCost > SAVE_EST.WRITE_EDIT && cheapModelCost > 0 && brainModelCost > cheapModelCost ? brainModelCost / cheapModelCost : 0;
    let footerText;
    if (ltTotal > 0) {
      let savingsDisplay = `vibeOS: $${formatUsd(ltTotal)} saved up ${trendIcon}`;
      if (imputedMultiplier > 2) {
        const imputedActual = ltTotal * imputedMultiplier;
        savingsDisplay += ` ($${formatUsd(imputedActual)} actual)`;
      }
      const stressBar = _footerStress > 0.85 ? "\u2588" : _footerStress > 0.7 ? "\u2586" : _footerStress > 0.5 ? "\u2585" : _footerStress > 0.3 ? "\u2583" : _footerStress > 0.1 ? "\u2582" : "\u2581";
      const stressLabel = _footerStress > 0.7 ? "high" : _footerStress > 0.4 ? "elevated" : "calm";
      footerText = stripped + `

\u2014 ${modelTag} | ${savingsDisplay} | stress: ${stressBar} ${stressLabel} \u2014`;
    } else {
      footerText = stripped + `

\u2014 ${modelTag} \u2014`;
    }
    if (_blackboxEnabled) {
      try {
        const prevText = _prevOutputText;
        _prevOutputText = typeof output?.text === "string" ? output.text : typeof output?.result === "string" ? output.result : "";
        if (_prevOutputText && prevText && _prevOutputText !== prevText) {
          const outcome = detectOutcomeSignal(_prevOutputText);
          if (outcome) {
            const tracker = getBlackboxTracker();
            tracker.recordOutcome(outcome);
            syncOutcomeToApi(outcome);
          }
        }
      } catch {
      }
    }
    if (typeof output?.text === "string")
      output.text = footerText;
    else if (typeof output?.result === "string")
      output.result = footerText;
    else if (typeof output?.content === "string")
      output.content = footerText;
    else
      output.text = footerText;
    textCompletePainted.add(messageID);
    if (textCompletePainted.size > 500) {
      const it = textCompletePainted.values();
      for (let i = 0; i < 100; i++)
        textCompletePainted.delete(it.next().value);
    }
  } catch (err) {
    console.error(`[vibeOS] footer failed: ${err.message}`);
  }
}

// src/lib/hooks/tool-execute.js
import { writeFileSync as writeFileSync11, appendFileSync as appendFileSync7, existsSync as existsSync13, mkdirSync as mkdirSync9 } from "node:fs";
import { dirname as dirname7, basename as basename8 } from "node:path";
init_flow_enforcer();

// src/lib/tdd-enforcer.js
import { readFileSync as readFileSync12, writeFileSync as writeFileSync10, appendFileSync as appendFileSync6, existsSync as existsSync12, mkdirSync as mkdirSync8, statSync as statSync8, readdirSync as readdirSync2, rmSync as rmSync5, openSync as openSync4 } from "node:fs";
import { join as join14, dirname as dirname6 } from "node:path";
import { createHash as createHash5 } from "node:crypto";

// src/utils/tdd-helpers.js
function extractExports(sourceContent, ext) {
  if (!sourceContent || typeof sourceContent !== "string")
    return [];
  const exports = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (name, type = "function") => {
    if (name && !seen.has(name)) {
      seen.add(name);
      exports.push({ name, type });
    }
  };
  switch (ext) {
    case "py": {
      for (const m of sourceContent.matchAll(/^def\s+([a-zA-Z]\w*)\s*\(/gm))
        add(m[1]);
      for (const m of sourceContent.matchAll(/^class\s+([a-zA-Z_]\w*)\s*[\(:]/gm))
        add(m[1], "class");
      break;
    }
    case "js":
    case "mjs":
    case "jsx": {
      for (const m of sourceContent.matchAll(/export\s+(?:async\s+)?function\s+([a-zA-Z_$]\w*)\s*\(/g))
        add(m[1]);
      for (const m of sourceContent.matchAll(/export\s+const\s+([a-zA-Z_$]\w*)\s*=/g))
        add(m[1]);
      if (exports.length === 0) {
        for (const m of sourceContent.matchAll(/^(?:async\s+)?function\s+([a-zA-Z_$]\w*)\s*\(/gm))
          add(m[1]);
      }
      break;
    }
    case "ts":
    case "tsx": {
      for (const m of sourceContent.matchAll(/export\s+(?:async\s+)?function\s+([a-zA-Z_$]\w*)\s*\(/g))
        add(m[1]);
      for (const m of sourceContent.matchAll(/export\s+const\s+([a-zA-Z_$]\w*)\s*[:=]/g))
        add(m[1]);
      for (const m of sourceContent.matchAll(/export\s+class\s+([a-zA-Z_$]\w*)/g))
        add(m[1], "class");
      break;
    }
    case "go": {
      for (const m of sourceContent.matchAll(/func\s+(?:\([^)]+\)\s+)?([A-Z]\w*)\s*\(/g))
        add(m[1]);
      break;
    }
    case "rs": {
      for (const m of sourceContent.matchAll(/pub\s+fn\s+([a-zA-Z_]\w*)\s*</g))
        add(m[1]);
      for (const m of sourceContent.matchAll(/pub\s+fn\s+([a-zA-Z_]\w*)\s*\(/g))
        add(m[1]);
      for (const m of sourceContent.matchAll(/pub\s+struct\s+([a-zA-Z_]\w*)/g))
        add(m[1], "struct");
      break;
    }
    case "rb": {
      for (const m of sourceContent.matchAll(/def\s+(?:self\.)?([a-zA-Z_]\w*[?!=]?)/g))
        add(m[1]);
      for (const m of sourceContent.matchAll(/class\s+([A-Z]\w*)/g))
        add(m[1], "class");
      break;
    }
    case "java":
    case "kt": {
      for (const m of sourceContent.matchAll(/(?:public|protected)\s+(?:static\s+)?(?:final\s+)?\S+\s+([a-zA-Z_$]\w*)\s*\(/g))
        add(m[1]);
      for (const m of sourceContent.matchAll(/fun\s+([a-zA-Z_$]\w*)\s*\(/g))
        add(m[1]);
      break;
    }
    case "sh": {
      for (const m of sourceContent.matchAll(/^(?:function\s+)?([a-zA-Z_]\w*)\s*\(\)\s*\{/gm))
        add(m[1]);
      for (const m of sourceContent.matchAll(/^function\s+([a-zA-Z_]\w*)/gm))
        add(m[1]);
      break;
    }
  }
  return exports;
}
function generateTestCaseNames(funcName, _type, quality = false) {
  const base = funcName.replace(/^[_$]+/, "");
  if (!quality) {
    return [
      `should ${base} with valid input`,
      `should handle invalid input for ${base}`,
      `should handle edge cases in ${base}`
    ];
  }
  return [
    `${base}: works correctly with typical valid input`,
    `${base}: raises gracefully on invalid/malformed input`,
    `${base}: handles boundary and edge-case values`
  ];
}
function inferFunctionParams(sourceContent, funcName) {
  if (!sourceContent || !funcName)
    return [];
  const patterns = [
    new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${funcName}\\s*\\(([^)]*)\\)`, "m"),
    new RegExp(`(?:export\\s+)?const\\s+${funcName}\\s*[:=]\\s*(?:async\\s+)?\\(([^)]*)\\)`, "m"),
    new RegExp(`(?:export\\s+)?const\\s+${funcName}\\s*[:=]\\s*(?:async\\s+)?function\\s*\\(([^)]*)\\)`, "m"),
    new RegExp(`def\\s+${funcName}\\s*\\(([^)]*)\\)`, "m"),
    new RegExp(`fun\\s+${funcName}\\s*\\(([^)]*)\\)`, "m")
  ];
  for (const pat of patterns) {
    const m = sourceContent.match(pat);
    if (m) {
      return m[1].split(",").map((s) => {
        const trimmed = s.trim();
        if (!trimmed)
          return null;
        const nameMatch = trimmed.match(/^\s*((?:public|protected)|static|final|val|var|let|const)?\s*(?:readonly\s+)?(?:[_$a-zA-Z][_$a-zA-Z0-9]*)\s*(?::|(?=\s*=)|(?=\s*[,)]))/);
        const rawName = trimmed.replace(/^[^a-zA-Z_$]*/, "").replace(/[=:].*$/, "").replace(/\s+.*$/, "").trim();
        const defaultMatch = trimmed.match(/=\s*(.+)$/);
        const typeMatch = trimmed.match(/:\s*(\w+)/);
        return {
          name: rawName || `arg${Math.random().toString(36).slice(2, 5)}`,
          type: typeMatch ? typeMatch[1] : null,
          defaultValue: defaultMatch ? defaultMatch[1].trim() : null
        };
      }).filter(Boolean);
    }
  }
  return [];
}
function inferTypeFromName(paramName, defaultValue) {
  if (!paramName)
    return "any";
  const name = paramName.toLowerCase();
  if (defaultValue !== null && defaultValue !== void 0) {
    if (/^["']/.test(defaultValue))
      return "string";
    if (/^\d+\.?\d*$/.test(defaultValue))
      return "number";
    if (/^(true|false)$/i.test(defaultValue))
      return "boolean";
    if (/^\[/.test(defaultValue))
      return "array";
    if (/^\{/.test(defaultValue))
      return "object";
    if (/^null$/i.test(defaultValue))
      return "null";
  }
  if (/^(is|has|can|should|will|did|was|are|contains?_|[A-Z])/.test(name))
    return "boolean";
  if (/^(count|index|limit|offset|max|min|size|length|total|num|age)_?/.test(name))
    return "number";
  if (/^(name|title|label|msg|message|text|str|prefix|suffix|path|url|email|id)_?/.test(name))
    return "string";
  if (/^(items|list|arr|entries|data|values|args)_?/.test(name))
    return "array";
  if (/^(obj|config|opts|options|settings|params|props)_?/.test(name))
    return "object";
  if (/^(fn|cb|callback|handler|on[A-Z])/.test(name))
    return "function";
  return "any";
}
function _langComment(lang) {
  const map = { py: "#", js: "//", mjs: "//", ts: "//", tsx: "//", jsx: "//", go: "//", rs: "//", rb: "#", sh: "#", java: "//", kt: "//" };
  return map[lang] || "//";
}
function buildQualityAssertionsForFunc(funcName, params, lang, indent) {
  const cmt = _langComment(lang);
  const nl = lang === "py" || lang === "rb" || lang === "sh" ? "\n" : "\n";
  let block = "";
  const testValues = params.map((p) => {
    const t = p.type || inferTypeFromName(p.name, p.defaultValue);
    if (t === "string" || t === "String")
      return '"sample_input"';
    if (t === "number" || t === "int" || t === "float" || t === "Number")
      return "42";
    if (t === "boolean" || t === "bool" || t === "Boolean")
      return "true";
    if (t === "array" || t === "Array" || t === "list" || t === "List")
      return "[]";
    if (t === "object" || t === "Object" || t === "dict" || t === "Dict")
      return "{}";
    if (t === "function" || t === "Function")
      return "() => {}";
    if (t === "any")
      return '"test"';
    if (t === "null")
      return "null";
    return '"test"';
  });
  const args = testValues.join(", ");
  switch (lang) {
    case "py": {
      block += `${indent}def test_${funcName}_valid_input():
`;
      block += `${indent}    """Assert ${funcName} runs with typical valid input."""
`;
      block += `${indent}    result = ${funcName}(${args})
`;
      block += `${indent}    assert result is not None

`;
      block += `${indent}def test_${funcName}_invalid_input():
`;
      block += `${indent}    """Assert ${funcName} raises on None/null input where applicable."""
`;
      block += `${indent}    with pytest.raises((TypeError, ValueError)):
`;
      block += `${indent}        ${funcName}(None)

`;
      block += `${indent}def test_${funcName}_edge_cases():
`;
      block += `${indent}    """Assert ${funcName} handles boundary values."""
`;
      const ecArgs = params.map((p) => {
        const t = p.type || inferTypeFromName(p.name, p.defaultValue);
        if (t === "string")
          return '""';
        if (t === "number" || t === "int" || t === "float")
          return "0";
        return '"edge"';
      }).join(", ");
      block += `${indent}    result = ${funcName}(${ecArgs})
`;
      block += `${indent}    assert result is not None

`;
      break;
    }
    case "js":
    case "mjs":
    case "ts":
    case "tsx":
    case "jsx": {
      const blkLang = lang === "ts" || lang === "tsx" ? "it" : "test";
      block += `${indent}${blkLang}('${funcName}: handles valid input', () => {
`;
      block += `${indent}  const result = mod.${funcName}(${args});
`;
      block += `${indent}  expect(result).toBeDefined();
`;
      block += `${indent}});

`;
      block += `${indent}${blkLang}('${funcName}: rejects invalid input', () => {
`;
      block += `${indent}  // TODO: replace with expected error type
`;
      block += `${indent}  expect(() => mod.${funcName}(null)).toThrow();
`;
      block += `${indent}});

`;
      block += `${indent}${blkLang}('${funcName}: handles edge cases', () => {
`;
      const ecArgsJS = params.map((p) => {
        const t = p.type || inferTypeFromName(p.name, p.defaultValue);
        if (t === "string")
          return '""';
        if (t === "number" || t === "int" || t === "float")
          return "0";
        if (t === "boolean")
          return "false";
        if (t === "array")
          return "[]";
        if (t === "object")
          return "{}";
        return "undefined";
      }).join(", ");
      block += `${indent}  const result = mod.${funcName}(${ecArgsJS});
`;
      block += `${indent}  expect(result).toBeDefined();
`;
      block += `${indent}});

`;
      break;
    }
    default: {
      block += `${indent}${cmt} TODO: Quality assertion for ${funcName} \u2014 valid input
`;
      block += `${indent}${cmt} ${funcName}(${args}) should return expected result

`;
      block += `${indent}${cmt} TODO: Quality assertion for ${funcName} \u2014 invalid input
`;
      block += `${indent}${cmt} ${funcName}(null) should error gracefully

`;
      block += `${indent}${cmt} TODO: Quality assertion for ${funcName} \u2014 edge case
`;
      block += `${indent}${cmt} ${funcName}() with boundary values should not crash

`;
    }
  }
  return block;
}
function isSkeletonUseless(content) {
  if (!content)
    return true;
  const lines = content.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("#") && !l.trim().startsWith("/*") && !l.trim().startsWith("*"));
  const todoLines = content.split("\n").filter((l) => /TODO|placeholder|smoke|is exported|module loads/.test(l));
  const meaningfulLines = lines.filter((l) => !/TODO|placeholder|smoke|is exported|module loads|throw new Error|raise AssertionError|pytest\.skip|assert.*true/.test(l));
  return meaningfulLines.length < 2;
}

// src/lib/test-skeletons.js
var TEST_SKELETONS = {
  py: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const moduleImport = name.replace(/-/g, "_");
    let content = `# [vibeOS-enforced] Skeleton test \u2014 replace with real assertions
`;
    content += `import pytest
`;
    content += `from ${moduleImport} import ${exports.length > 0 ? exports.map((e) => e.name).join(", ") : moduleImport}

`;
    if (depth === "minimal") {
      content += `def test_${name}_smoke():
`;
      content += `    """Smoke test \u2014 replace with real assertions."""
`;
      content += `    assert ${exports.length > 0 ? exports[0].name : moduleImport} is not None

`;
    } else {
      content += `def test_${name}_smoke():
`;
      content += `    """Smoke test: module imports correctly."""
`;
      content += `    assert ${exports.length > 0 ? exports[0].name : moduleImport} is not None

`;
      for (const exp of exports) {
        if (exp.type === "class")
          continue;
        const cases = generateTestCaseNames(exp.name, exp.type, quality);
        content += `# TODO: implement tests for ${exp.name}
`;
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
          content += `def test_${caseFunc}():
`;
          if (strict)
            content += `    raise AssertionError("TODO: implement ${caseName}")

`;
          else
            content += `    pytest.skip("TODO: implement ${caseName}")

`;
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name);
          content += buildQualityAssertionsForFunc(exp.name, params, "py", "");
        }
      }
      if (exports.length === 0) {
        content += `def test_${name}_placeholder():
`;
        if (strict)
          content += `    raise AssertionError("TODO: implement tests for ${name}")

`;
        else
          content += `    pytest.skip("TODO: implement tests for ${name}")

`;
      }
    }
    return content;
  },
  js: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const importPath = `../${name}`;
    let content = `// [vibeOS-enforced] Skeleton test \u2014 replace with real assertions
`;
    content += `const { test, expect, describe } = require('@jest/globals');
`;
    content += `const mod = require('${importPath}');

`;
    content += `describe('${name}', () => {
`;
    if (depth === "minimal") {
      content += `  test('smoke: module loads', () => {
`;
      content += `    expect(mod).toBeDefined();
`;
      content += `  });
`;
    } else {
      content += `  test('smoke: module loads', () => {
`;
      content += `    expect(mod).toBeDefined();
`;
      content += `  });

`;
      for (const exp of exports) {
        if (exp.type === "class")
          continue;
        const cases = generateTestCaseNames(exp.name, exp.type, quality);
        content += `  // TODO: implement tests for ${exp.name}
`;
        content += `  test('${exp.name} is exported', () => {
`;
        content += `    expect(typeof mod.${exp.name}).toBe('function');
`;
        content += `  });

`;
        for (const caseName of cases) {
          content += `  test('${caseName}', () => {
`;
          content += `    // TODO: implement ${caseName}
`;
          if (strict)
            content += `    throw new Error('TODO: implement ${caseName}');
`;
          else
            content += `    expect(true).toBe(true);
`;
          content += `  });

`;
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name);
          content += buildQualityAssertionsForFunc(exp.name, params, "js", "  ");
        }
      }
      if (exports.length === 0) {
        content += `  test('placeholder', () => {
`;
        content += `    // TODO: implement tests for ${name}
`;
        content += `    expect(true).toBe(true);
`;
        content += `  });
`;
      }
    }
    content += `});
`;
    return content;
  },
  mjs: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const importPath = `../${name}`;
    let content = `// [vibeOS-enforced] Skeleton test \u2014 replace with real assertions
`;
    content += `import { test, expect, describe } from 'vitest';
`;
    content += `import * as mod from '${importPath}';

`;
    content += `describe('${name}', () => {
`;
    if (depth === "minimal") {
      content += `  test('smoke: module loads', () => {
`;
      content += `    expect(mod).toBeDefined();
`;
      content += `  });
`;
    } else {
      content += `  test('smoke: module loads', () => {
`;
      content += `    expect(mod).toBeDefined();
`;
      content += `  });

`;
      for (const exp of exports) {
        if (exp.type === "class")
          continue;
        const cases = generateTestCaseNames(exp.name, exp.type, quality);
        content += `  // TODO: implement tests for ${exp.name}
`;
        content += `  test('${exp.name} is exported', () => {
`;
        content += `    expect(typeof mod.${exp.name}).toBe('function');
`;
        content += `  });

`;
        for (const caseName of cases) {
          content += `  test('${caseName}', () => {
`;
          content += `    // TODO: implement ${caseName}
`;
          if (strict)
            content += `    throw new Error('TODO: implement ${caseName}');
`;
          else
            content += `    expect(true).toBe(true);
`;
          content += `  });

`;
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name);
          content += buildQualityAssertionsForFunc(exp.name, params, "mjs", "  ");
        }
      }
      if (exports.length === 0) {
        content += `  test('placeholder', () => {
`;
        content += `    // TODO: implement tests for ${name}
`;
        content += `    expect(true).toBe(true);
`;
        content += `  });
`;
      }
    }
    content += `});
`;
    return content;
  },
  ts: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const importPath = `../${name}`;
    let content = `// [vibeOS-enforced] Skeleton test \u2014 replace with real assertions
`;
    content += `import { test, expect, describe, it } from 'vitest';
`;
    content += `import * as mod from '${importPath}';

`;
    content += `describe('${name}', () => {
`;
    if (depth === "minimal") {
      content += `  it('smoke: module loads', () => {
`;
      content += `    expect(mod).toBeDefined();
`;
      content += `  });
`;
    } else {
      content += `  it('smoke: module loads', () => {
`;
      content += `    expect(mod).toBeDefined();
`;
      content += `  });

`;
      for (const exp of exports) {
        if (exp.type === "class")
          continue;
        const cases = generateTestCaseNames(exp.name, exp.type, quality);
        content += `  // TODO: implement tests for ${exp.name}
`;
        content += `  it('${exp.name} is exported', () => {
`;
        content += `    expect(typeof mod.${exp.name}).toBe('function');
`;
        content += `  });

`;
        for (const caseName of cases) {
          content += `  it('${caseName}', () => {
`;
          content += `    // TODO: implement ${caseName}
`;
          if (strict)
            content += `    throw new Error('TODO: implement ${caseName}');
`;
          else
            content += `    expect(true).toBe(true);
`;
          content += `  });

`;
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name);
          content += buildQualityAssertionsForFunc(exp.name, params, "ts", "  ");
        }
      }
      if (exports.length === 0) {
        content += `  it('placeholder', () => {
`;
        content += `    // TODO: implement tests for ${name}
`;
        content += `    expect(true).toBe(true);
`;
        content += `  });
`;
      }
    }
    content += `});
`;
    return content;
  },
  tsx: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => TEST_SKELETONS.ts(name, exports, depth, strict, quality, sourceContent),
  jsx: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => TEST_SKELETONS.mjs(name, exports, depth, strict, quality, sourceContent),
  cjs: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => TEST_SKELETONS.mjs(name, exports, depth, strict, quality, sourceContent),
  mts: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => TEST_SKELETONS.ts(name, exports, depth, strict, quality, sourceContent),
  go: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1);
    let content = `// [vibeOS-enforced] Skeleton test \u2014 replace with real assertions
`;
    content += `package main

`;
    content += `import "testing"

`;
    if (depth === "minimal") {
      content += `func Test${cap}_Smoke(t *testing.T) {
`;
      content += `	t.Log("TODO: implement smoke test")
`;
      content += `	t.Fail()
`;
      content += `}
`;
    } else {
      content += `func Test${cap}_Smoke(t *testing.T) {
`;
      content += `	t.Log("Module loads correctly")
`;
      content += `	t.Fail()
`;
      content += `}

`;
      for (const exp of exports) {
        if (exp.type === "class")
          continue;
        const cases = generateTestCaseNames(exp.name, exp.type, quality);
        const expCap = exp.name.charAt(0).toUpperCase() + exp.name.slice(1);
        content += `// TODO: implement tests for ${exp.name}
`;
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
          content += `func Test${cap}_${caseFunc}(t *testing.T) {
`;
          if (strict)
            content += `	t.Error("TODO: implement ${caseName}")
`;
          else
            content += `	t.Skip("TODO: implement ${caseName}")
`;
          content += `}

`;
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name);
          content += `    // TODO: Real assertion for ${exp.name} \u2014 valid input
`;
          content += `    // TODO: Real assertion for ${exp.name} \u2014 invalid input
`;
          content += `    // TODO: Real assertion for ${exp.name} \u2014 edge case

`;
        }
      }
      if (exports.length === 0) {
        content += `func Test${cap}_Placeholder(t *testing.T) {
`;
        if (strict)
          content += `	t.Error("TODO: implement tests for ${name}")
`;
        else
          content += `	t.Skip("TODO: implement tests for ${name}")
`;
        content += `}
`;
      }
    }
    return content;
  },
  sh: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    let content = `# [vibeOS-enforced] Skeleton test \u2014 replace with real assertions
`;
    content += `#!/bin/bash

`;
    if (depth === "minimal") {
      content += `echo "TODO: implement smoke test for ${name}" && exit 1
`;
    } else {
      content += `# Smoke: module loads
`;
      content += `echo "Smoke test placeholder"

`;
      for (const exp of exports) {
        content += `# TODO: implement tests for ${exp.name}
`;
        const cases = generateTestCaseNames(exp.name, exp.type, quality);
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
          content += `function test_${caseFunc} {
`;
          content += `    echo "TODO: implement ${caseName}"
`;
          if (strict)
            content += `    exit 1
`;
          else
            content += `    echo "SKIP: ${caseName}"
`;
          content += `}

`;
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name);
          content += buildQualityAssertionsForFunc(exp.name, params, "sh", "");
        }
      }
      if (exports.length === 0) {
        content += `function test_smoke {
`;
        if (strict)
          content += `    echo "TODO: implement tests for ${name}" && exit 1
`;
        else
          content += `    echo "TODO: implement tests for ${name}"
`;
        content += `}
`;
      }
      content += `# Run all tests
`;
      content += `test_smoke
`;
    }
    return content;
  },
  rs: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    let content = `// [vibeOS-enforced] Skeleton test \u2014 replace with real assertions
`;
    content += `#[cfg(test)]
mod tests {
`;
    content += `    use super::*;

`;
    if (depth === "minimal") {
      content += `    #[test]
    fn ${name}_smoke() {
`;
      content += `        // TODO: implement smoke test
        panic!();
    }
`;
    } else {
      content += `    #[test]
    fn ${name}_smoke() {
`;
      content += `        // Smoke: module loads
`;
      content += `        assert!(true);
    }

`;
      for (const exp of exports) {
        if (exp.type === "class")
          continue;
        const cases = generateTestCaseNames(exp.name, exp.type, quality);
        content += `    // TODO: implement tests for ${exp.name}
`;
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
          content += `    #[test]
    fn test_${caseFunc}() {
`;
          if (strict)
            content += `        panic!("TODO: implement ${caseName}");
`;
          else
            content += `        // TODO: implement ${caseName}
`;
          content += `    }

`;
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name);
          content += buildQualityAssertionsForFunc(exp.name, params, "rs", "    ");
        }
      }
      if (exports.length === 0) {
        content += `    #[test]
    fn ${name}_placeholder() {
`;
        if (strict)
          content += `        panic!("TODO: implement tests for ${name}");
`;
        else
          content += `        // TODO: implement tests for ${name}
`;
        content += `    }
`;
      }
    }
    content += `}
`;
    return content;
  },
  rb: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    let content = `# [vibeOS-enforced] Skeleton test \u2014 replace with real assertions
`;
    content += `require 'minitest/autorun'
`;
    content += `require_relative '../${name}'

`;
    content += `class Test${name.charAt(0).toUpperCase() + name.slice(1)} < Minitest::Test
`;
    if (depth === "minimal") {
      content += `  def test_smoke
`;
      content += `    # TODO: implement smoke test
`;
      content += `    flunk "TODO: implement smoke test"
`;
      content += `  end
`;
    } else {
      content += `  def test_smoke
`;
      content += `    # Smoke: module loads
`;
      content += `    assert true
`;
      content += `  end

`;
      for (const exp of exports) {
        if (exp.type === "class")
          continue;
        const cases = generateTestCaseNames(exp.name, exp.type, quality);
        content += `  # TODO: implement tests for ${exp.name}
`;
        for (const caseName of cases) {
          const caseFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
          content += `  def test_${caseFunc}
`;
          if (strict)
            content += `    flunk "TODO: implement ${caseName}"
`;
          else
            content += `    # TODO: implement ${caseName}
`;
          content += `  end

`;
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name);
          content += buildQualityAssertionsForFunc(exp.name, params, "rb", "  ");
        }
      }
      if (exports.length === 0) {
        content += `  def test_placeholder
`;
        if (strict)
          content += `    flunk "TODO: implement tests for ${name}"
`;
        else
          content += `    # TODO: implement tests for ${name}
`;
        content += `  end
`;
      }
    }
    content += `end
`;
    return content;
  },
  java: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1);
    let content = `// [vibeOS-enforced] Skeleton test \u2014 replace with real assertions
`;
    content += `import org.junit.jupiter.api.Test;
`;
    content += `import static org.junit.jupiter.api.Assertions.*;

`;
    content += `class Test${cap} {
`;
    if (depth === "minimal") {
      content += `    @Test
`;
      content += `    void testSmoke() {
`;
      content += `        assertTrue(true);
`;
      content += `    }
`;
    } else {
      content += `    @Test
`;
      content += `    void testSmoke() {
`;
      content += `        assertTrue(true);
`;
      content += `    }

`;
      for (const exp of exports) {
        content += `    // TODO: implement tests for ${exp.name}
`;
        const cases = generateTestCaseNames(exp.name, exp.type, quality);
        for (const caseName of cases) {
          const testFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
          if (!strict)
            content += `    // @Disabled("TODO")
`;
          content += `    @Test
`;
          content += `    void test${testFunc.charAt(0).toUpperCase() + testFunc.slice(1)}() {
`;
          if (strict)
            content += `        fail("TODO: implement ${caseName}");
`;
          else
            content += `        assertTrue(true); // TODO: implement ${caseName}
`;
          content += `    }

`;
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name);
          content += buildQualityAssertionsForFunc(exp.name, params, "java", "    ");
        }
      }
      if (exports.length === 0) {
        content += `    @Test
`;
        content += `    void testPlaceholder() {
`;
        content += `        assertTrue(true); // TODO: implement tests for ${name}
`;
        content += `    }
`;
      }
    }
    content += `}
`;
    return content;
  },
  kt: (name, exports = [], depth = "full", strict = true, quality = true, sourceContent = "") => {
    const cap = name.charAt(0).toUpperCase() + name.slice(1);
    let content = `// [vibeOS-enforced] Skeleton test \u2014 replace with real assertions
`;
    content += `import org.junit.jupiter.api.Test
`;
    content += `import org.junit.jupiter.api.Assertions.*

`;
    content += `class Test${cap} {
`;
    if (depth === "minimal") {
      content += `    @Test
`;
      content += `    fun testSmoke() {
`;
      content += `        assertTrue(true)
`;
      content += `    }
`;
    } else {
      content += `    @Test
`;
      content += `    fun testSmoke() {
`;
      content += `        assertTrue(true)
`;
      content += `    }

`;
      for (const exp of exports) {
        content += `    // TODO: implement tests for ${exp.name}
`;
        const cases = generateTestCaseNames(exp.name, exp.type, quality);
        for (const caseName of cases) {
          const testFunc = caseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
          if (!strict)
            content += `    // @Disabled("TODO")
`;
          content += `    @Test
`;
          content += `    fun test${testFunc.charAt(0).toUpperCase() + testFunc.slice(1)}() {
`;
          if (strict)
            content += `        fail("TODO: implement ${caseName}")
`;
          else
            content += `        assertTrue(true) // TODO: implement ${caseName}
`;
          content += `    }

`;
        }
        if (quality && sourceContent) {
          const params = inferFunctionParams(sourceContent, exp.name);
          content += buildQualityAssertionsForFunc(exp.name, params, "kt", "    ");
        }
      }
      if (exports.length === 0) {
        content += `    @Test
`;
        content += `    fun testPlaceholder() {
`;
        content += `        assertTrue(true) // TODO: implement tests for ${name}
`;
        content += `    }
`;
      }
    }
    content += `}
`;
    return content;
  }
};
var test_skeletons_default = TEST_SKELETONS;

// src/lib/tdd-enforcer.js
var _detectedFramework = null;
var directory = void 0;
var SOURCE_EXT_RE = /\.(py|js|ts|mjs|tsx|jsx|cjs|mts|sh|go|rs|rb|java|kt)$/i;
var SKIP_PATH_RE = /(\/(node_modules|\.venv|dist|build|__pycache__)\/|\/(tests?|spec)\/|test_[^/]+\.py$|_test\.py$|\.test\.[a-z]+$|\.spec\.[a-z]+$|\.config\/opencode\/plugins\/)/i;
function _detectTestFramework() {
  if (_detectedFramework)
    return _detectedFramework;
  let framework = null;
  let testExt = null;
  try {
    const root = directory || process.cwd();
    const pkgPath = join14(root, "package.json");
    if (existsSync12(pkgPath)) {
      const pkg = JSON.parse(readFileSync12(pkgPath, "utf-8"));
      const testScript = String(pkg?.scripts?.test || "");
      const deps = { ...pkg?.devDependencies, ...pkg?.dependencies };
      if (testScript.includes("vitest") || deps["vitest"]) {
        framework = "vitest";
        testExt = "ts";
      } else if (testScript.includes("jest") || deps["jest"]) {
        framework = "jest";
        testExt = "js";
      } else if (testScript.includes("mocha") || deps["mocha"]) {
        framework = "mocha";
        testExt = "js";
      } else if (/node\s+--test/.test(testScript)) {
        framework = "node-test";
        testExt = "js";
      }
    }
    if (!framework) {
      const testDirs = ["src/tests", "tests", "test", "__tests__"];
      for (const td of testDirs) {
        const dirPath = join14(root, td);
        if (!existsSync12(dirPath))
          continue;
        const files = readdirSync2(dirPath).filter((f) => /\.test\./.test(f) || /\.spec\./.test(f));
        if (files.length > 0) {
          const content = readFileSync12(join14(dirPath, files[0]), "utf-8");
          if (/from\s+['"]node:test['"]/.test(content)) {
            framework = "node-test";
            testExt = files[0].split(".").pop();
            break;
          }
          if (/from\s+['"]vitest['"]/.test(content)) {
            framework = "vitest";
            testExt = files[0].split(".").pop();
            break;
          }
          if (/require\(['"]@jest\/globals['"]\)/.test(content)) {
            framework = "jest";
            testExt = files[0].split(".").pop();
            break;
          }
        }
      }
    }
  } catch (e) {
    console.error(`[vibeOS] [tdd] framework detection failed: ${e.message}`);
  }
  _detectedFramework = { framework, testExt };
  console.error(`[vibeOS] [tdd] detected test framework: ${framework || "default"} (ext: ${testExt || "match source"})`);
  return _detectedFramework;
}
var ENFORCEMENT_LOCK_DIR = join14(USER_HOME2, ".claude/.enforcement-lock");
var LOCK_EXPIRE_MS = 3e4;
var ENFORCEMENT_COOLDOWN_FILE2 = join14(USER_HOME2, ".claude/.enforcement-cooldown.jsonl");
var COOLDOWN_MS = 6e4;
var _enforcementCooldown = /* @__PURE__ */ new Set();
function _acquireLock(testPath) {
  try {
    mkdirSync8(ENFORCEMENT_LOCK_DIR, { recursive: true });
    const hash = createHash5("sha256").update(testPath).digest("hex").slice(0, 16);
    const lockPath = join14(ENFORCEMENT_LOCK_DIR, `${hash}.lock`);
    try {
      openSync4(lockPath, "wx");
      return true;
    } catch (err) {
      if (err.code !== "EEXIST")
        return false;
      try {
        const st = statSync8(lockPath);
        if (Date.now() - st.mtimeMs >= LOCK_EXPIRE_MS) {
          rmSync5(lockPath, { force: true });
          try {
            openSync4(lockPath, "wx");
            return true;
          } catch {
          }
        }
      } catch {
      }
      return false;
    }
  } catch {
    return false;
  }
}
function _releaseLock(testPath) {
  try {
    const hash = createHash5("sha256").update(testPath).digest("hex").slice(0, 16);
    const lockPath = join14(ENFORCEMENT_LOCK_DIR, `${hash}.lock`);
    rmSync5(lockPath);
  } catch {
  }
}
function _isInCooldown(testPath) {
  try {
    if (!existsSync12(ENFORCEMENT_COOLDOWN_FILE2))
      return false;
    const hash = createHash5("sha256").update(testPath).digest("hex").slice(0, 16);
    const lines = readFileSync12(ENFORCEMENT_COOLDOWN_FILE2, "utf-8").trim().split("\n").filter(Boolean);
    const now = Date.now();
    for (const line of lines) {
      try {
        const { h, ts } = JSON.parse(line);
        if (h === hash && now - ts < COOLDOWN_MS)
          return true;
      } catch {
      }
    }
    return false;
  } catch {
    return false;
  }
}
function _recordCooldown(testPath) {
  try {
    mkdirSync8(dirname6(ENFORCEMENT_COOLDOWN_FILE2), { recursive: true });
    const hash = createHash5("sha256").update(testPath).digest("hex").slice(0, 16);
    const entry = JSON.stringify({ h: hash, ts: Date.now() }) + "\n";
    appendFileSync6(ENFORCEMENT_COOLDOWN_FILE2, entry);
    const lines = readFileSync12(ENFORCEMENT_COOLDOWN_FILE2, "utf-8").trim().split("\n").filter(Boolean);
    if (lines.length > 500) {
      writeFileSync10(ENFORCEMENT_COOLDOWN_FILE2, lines.slice(-200).join("\n") + "\n");
    }
  } catch {
  }
}
function buildTestSkeleton(filePath, sourceContent = "", options = {}) {
  const fw = _detectTestFramework();
  if (!filePath || typeof filePath !== "string")
    return null;
  if (!SOURCE_EXT_RE.test(filePath))
    return null;
  if (SKIP_PATH_RE.test(filePath))
    return null;
  const m = filePath.match(/([^/]+)\.([^.]+)$/);
  if (!m)
    return null;
  const [, name, ext] = m;
  const extLower = ext.toLowerCase();
  const skeletonFn = test_skeletons_default[extLower];
  if (!skeletonFn)
    return null;
  const strict = options.strict !== void 0 ? options.strict : true;
  const quality = options.quality !== void 0 ? options.quality : true;
  const m2 = filePath.match(/^(.*\/)?([^/]+)\.([^.]+)$/);
  const dir = m2 ? m2[1] || "" : "";
  let testPath;
  switch (extLower) {
    case "py":
      testPath = dir + "tests/test_" + name + ".py";
      break;
    case "sh":
      testPath = dir + "tests/test_" + name + ".sh";
      break;
    case "js":
    case "mjs":
    case "ts":
    case "jsx":
    case "tsx":
    case "cjs":
    case "mts":
      testPath = dir + "tests/" + name + ".test." + ext;
      break;
    case "go":
      testPath = dir + name + "_test.go";
      break;
    case "rs":
      testPath = dir + "tests/" + name + "_test.rs";
      break;
    case "rb":
      testPath = dir + "test/" + name + "_test.rb";
      break;
    case "java":
    case "kt":
      testPath = dir + "src/test/" + name.charAt(0).toUpperCase() + name.slice(1) + "Test." + ext;
      break;
    default:
      return null;
  }
  if (fw?.testExt) {
    testPath = testPath.replace(new RegExp("\\.[^.]+$"), "." + fw.testExt);
  }
  const exports = extractExports(sourceContent, extLower);
  return { path: testPath, content: skeletonFn(name, exports, "full", strict, quality, sourceContent), dir: dirname6(testPath) };
}
function enforceTestFile(filePath) {
  console.error(`[vibeOS] [tdd-enforce] enforceTestFile called for ${filePath}`);
  let sourceContent = "";
  try {
    if (existsSync12(filePath)) {
      sourceContent = readFileSync12(filePath, "utf-8");
    }
  } catch {
  }
  const sel = loadSelection();
  const skeleton = buildTestSkeleton(filePath, sourceContent, { strict: sel.tdd_strict !== false, quality: sel.tdd_quality !== false });
  if (!skeleton)
    return null;
  if (existsSync12(skeleton.path))
    return null;
  if (_enforcementCooldown.has(skeleton.path))
    return null;
  if (_isInCooldown(skeleton.path))
    return null;
  if (!_acquireLock(skeleton.path))
    return null;
  try {
    mkdirSync8(skeleton.dir, { recursive: true });
    writeFileSync10(skeleton.path, skeleton.content);
    _enforcementCooldown.add(skeleton.path);
    _recordCooldown(skeleton.path);
    try {
      updateState((state) => {
        state.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" };
        state.lifetime.tdd_enforced = (state.lifetime.tdd_enforced || 0) + 1;
        state.lifetime.tdd_skeletons_created = (state.lifetime.tdd_skeletons_created || 0) + 1;
        if (sel.tdd_strict !== false) {
          state.lifetime.tdd_strict_fail_templates_created = (state.lifetime.tdd_strict_fail_templates_created || 0) + 1;
        }
        if (sel.tdd_quality !== false) {
          state.lifetime.tdd_quality_templates_created = (state.lifetime.tdd_quality_templates_created || 0) + 1;
        }
        state.lifetime.last_updated = (/* @__PURE__ */ new Date()).toISOString();
        return state;
      });
    } catch {
    }
    let resultPath = skeleton.path;
    const useless = isSkeletonUseless(skeleton.content);
    if (useless) {
      console.error(`[vibeOS] \u26A0 TDD skeleton at ${skeleton.path} has no real assertions. Run \`trinity tdd strict off\` or add manual tests.`);
    }
    console.error(`[vibeOS] [tdd-enforce] Created skeleton: ${skeleton.path}`);
    return resultPath;
  } catch (err) {
    console.error(`[vibeOS] [tdd-enforce] Failed to create ${skeleton.path}: ${err.message}`);
    return null;
  } finally {
    _releaseLock(skeleton.path);
  }
}
function buildTestReminder(filePath) {
  if (!filePath || typeof filePath !== "string")
    return null;
  if (!SOURCE_EXT_RE.test(filePath))
    return null;
  if (SKIP_PATH_RE.test(filePath))
    return null;
  if (testReminderSeen.has(filePath))
    return null;
  testReminderSeen.add(filePath);
  const m = filePath.match(/([^/]+)\.([^.]+)$/);
  if (!m)
    return null;
  const [, name, ext] = m;
  let suggest;
  switch (ext.toLowerCase()) {
    case "py":
      suggest = `tests/test_${name}.py`;
      break;
    case "sh":
      suggest = `tests/test_${name}.sh`;
      break;
    case "js":
    case "mjs":
    case "ts":
    case "jsx":
    case "tsx":
      suggest = `tests/${name}.test.${ext}`;
      break;
    case "go":
      suggest = `${name}_test.go`;
      break;
    default:
      suggest = "co-located test file";
  }
  return `\u{1F9EA} Changed ${filePath} \u2014 add test at ${suggest} before completing.`;
}

// src/lib/hooks/tool-execute.js
var BYTES_PER_TOKEN = 4;
var CACHE_SAVED_PER_1M_INPUT_TOKENS = 0.1;
var projectDirectory = "";
var pendingUiNote = null;
var enforcementBlocked = false;
var taskSlotRestore = null;
var scratchpadHitsSeen2 = /* @__PURE__ */ new Set();
var softQuotaCounts = {};
var context7AlertedThisSession = false;
var context7Seen = /* @__PURE__ */ new Set();
var _autoReportCount2 = 0;
var setToolDirectory = (dir) => {
  projectDirectory = dir || "";
};
var onToolExecuteBefore = async (input, output) => {
  if (!loadSelection().enabled)
    return;
  _refreshModel(projectDirectory);
  const t = input?.tool ?? "";
  const args = output?.args;
  const inArgs = input?.args;
  let _cacheSave = 0;
  let _prompt = "";
  if (SCRATCHPAD_TOOLS.has(t)) {
    const hit = getScratchpadHit(t, args);
    if (hit && !scratchpadHitsSeen2.has(hit.hash)) {
      scratchpadHitsSeen2.add(hit.hash);
      const total = recordScratchpadObservation();
      const _inputTokens = Math.max(1, Math.round(hit.sizeBytes / BYTES_PER_TOKEN));
      _cacheSave = Math.round(_inputTokens * CACHE_SAVED_PER_1M_INPUT_TOKENS / 1e6 * 1e3) / 1e3;
      const cacheSaved = recordCacheSaving(t, _cacheSave, { hash: hit.hash });
      const sumNote = hit.summaryPath ? ` (summary: ${hit.summaryPath})` : "";
      const cacheNote = cacheSaved ? `, cache+$${(cacheSaved.lifetime || 0).toFixed(3)} lt` : "";
      console.error(`[vibeOS] \u{1F4E6} scratchpad hit for ${t}: ${hit.fullPath} ${hit.sizeBytes}B ${hit.ageSec}s old${sumNote} \u2014 total observed: ${total ?? "?"}${cacheNote}`);
    }
    if (ML_ENABLED) {
      try {
        const rawArgs = args || inArgs || {};
        const promptText = typeof rawArgs.prompt === "string" ? rawArgs.prompt : typeof rawArgs.filePath === "string" ? `${t}:${rawArgs.filePath}` : typeof rawArgs.command === "string" ? rawArgs.command : typeof rawArgs.url === "string" ? rawArgs.url : typeof rawArgs.pattern === "string" ? rawArgs.pattern : typeof rawArgs.query === "string" ? rawArgs.query : "";
        if (promptText) {
          const keyStr = `${t}:${String(promptText).slice(0, 120)}`;
          addCacheEntry(_cacheDb, hit ? hit.hash : hashQuery(keyStr), t, promptText, hit ? hit.sizeBytes : 0, hit ? hit.ageSec : 0);
          recordCacheStats(_cacheDb, t, !!hit, hit ? _cacheSave : 0);
          if (!hit) {
            const prediction = predictCacheHit(_cacheDb, t, promptText);
            if (prediction.shouldWarm && prediction.confidence >= 0.6) {
              console.error(`[vibeOS] \u{1F52E} Smart cache: ${t} may benefit from caching \u2014 ${prediction.reason} (conf: ${(prediction.confidence * 100).toFixed(0)}%)`);
            }
          }
        }
      } catch (scErr) {
        console.error(`[vibeOS] Smart cache error: ${scErr.message}`);
      }
    }
  }
  const _credit = loadCredit();
  if (_credit < 40 && t === "task" && TRINITY_CHEAP && args && typeof args === "object") {
    if (args.model !== TRINITY_CHEAP) {
      args.model = TRINITY_CHEAP;
      console.error(`[vibeOS] \u{1F500} Credit ${_credit}%: forcing Task \u2192 cheap slot (${TRINITY_CHEAP})`);
    }
    return;
  }
  if (t === "task" && currentModel && (args && typeof args === "object" || inArgs && typeof inArgs === "object")) {
    const targetArgs = args ? args : input?.args ? input.args : {};
    _prompt = (targetArgs?.prompt ?? "").trim().toLowerCase();
    if (typeof targetArgs?.prompt === "string")
      setActiveJobFromTaskPrompt(targetArgs.prompt);
    const _firstWord2 = _prompt.split(/\s+/)[0];
    const BASE_EXPLORATORY = /* @__PURE__ */ new Set(["check", "find", "list", "search", "does", "verify", "look", "count", "show", "get", "read", "grep", "scan", "detect", "inspect"]);
    const LEARNED_EXPLORATORY = getLearnedExploratoryWords();
    const EXPLORATORY = /* @__PURE__ */ new Set([...BASE_EXPLORATORY, ...LEARNED_EXPLORATORY]);
    const _exploratoryTarget = EXPLORATORY.has(_firstWord2) ? TRINITY_CHEAP : null;
    const _tierTarget = currentTier === "high" && TRINITY_MEDIUM && TRINITY_MEDIUM !== currentModel ? TRINITY_MEDIUM : TRINITY_CHEAP && TRINITY_CHEAP !== currentModel ? TRINITY_CHEAP : null;
    let _target = _exploratoryTarget ?? _tierTarget;
    const stressScore = latestUserIntent ? scoreStress(latestUserIntent) : 0;
    const apiRoute = await remoteCall("routeModel", [_prompt, currentTier, TRINITY_CHEAP, TRINITY_MEDIUM, LEARNED_EXPLORATORY, stressScore], null);
    if (apiRoute?.target) {
      _target = apiRoute.target;
    } else if (_target === TRINITY_CHEAP && TRINITY_MEDIUM) {
      if (stressScore > 0.5) {
        _target = TRINITY_MEDIUM;
        console.error(`[vibeOS] \u{1F9D8} Stress ${stressScore.toFixed(2)} \u2192 preserving medium tier for Task quality`);
      }
    }
    if (ML_ENABLED) {
      try {
        const mlDifficulty = computeDifficulty(_prompt);
        const mlHash = hashQuery(_prompt);
        const mlGraphPrediction = predictBestModel(_mlGraph, _firstWord2, currentTier);
        if (mlDifficulty.confidence >= ML_CONFIDENCE_THRESHOLD && mlDifficulty.level !== "moderate") {
          const mlTarget = mlDifficulty.suggestedTier === "cheap" ? TRINITY_CHEAP : mlDifficulty.suggestedTier === "medium" ? TRINITY_MEDIUM : null;
          if (mlTarget && mlTarget !== currentModel) {
            const tierRank = { budget: 0, cheap: 1, mid: 2, medium: 2, high: 3, brain: 3 };
            const mlRank = tierRank[mlDifficulty.suggestedTier] || 0;
            const curRank = _target ? tierRank[classify(_target)] || 0 : 0;
            if (!_target) {
              _target = mlTarget;
              console.error(`[vibeOS] \u{1F9E0} ML difficulty: ${mlDifficulty.level} (score ${mlDifficulty.score.toFixed(2)}, conf ${mlDifficulty.confidence.toFixed(2)}) \u2192 ${mlTarget}`);
            } else if (mlRank > curRank && mlDifficulty.confidence >= 0.75) {
              _target = mlTarget;
              console.error(`[vibeOS] \u{1F9E0} ML upgrade: ${mlDifficulty.level} (score ${mlDifficulty.score.toFixed(2)}, conf ${mlDifficulty.confidence.toFixed(2)}) \u2192 ${mlTarget}`);
            }
          }
        }
        if (mlGraphPrediction && mlGraphPrediction !== currentModel) {
          const graphNode = _mlGraph.nodes[_firstWord2];
          if (graphNode && graphNode.count >= 3) {
            if (!_target) {
              _target = mlGraphPrediction;
              console.error(`[vibeOS] \u{1F578} ML graph: ${_firstWord2} \u2192 ${mlGraphPrediction} (${graphNode.count} samples)`);
            }
          }
        }
        if (_target) {
          const _mlTier = classify(_target) === "budget" ? "cheap" : classify(_target) === "mid" ? "medium" : classify(_target);
          addRouteEdge(_mlGraph, _firstWord2, _target, _mlTier, true);
        }
      } catch (mlErr) {
        console.error(`[vibeOS] ML router error: ${mlErr.message}`);
      }
    }
    if (_target)
      noteTaskRoutingLearning(_firstWord2, _target, _exploratoryTarget ? "exploratory" : `tier:${currentTier}`);
    if (_target && targetArgs?.model !== _target) {
      const _reason = _exploratoryTarget ? `exploratory ('${_firstWord2}')` : `tier=${currentTier}`;
      const _setModel = (obj) => {
        if (!obj || typeof obj !== "object")
          return;
        obj.model = _target;
        obj.modelID = _target;
        obj.modelId = _target;
      };
      _setModel(targetArgs);
      _setModel(args);
      _setModel(inArgs);
      try {
        const selNow = loadSelection();
        const desiredSlot = _target === TRINITY_CHEAP ? "cheap" : _target === TRINITY_MEDIUM ? "medium" : null;
        if (selNow.delegation_enforce && currentTier === "high" && desiredSlot && selNow.active_slot !== desiredSlot) {
          taskSlotRestore = selNow.active_slot || "brain";
          const switched = applySlot(desiredSlot);
          if (switched?.ok) {
            setCurrentModel(switched.ocModel);
            setCurrentTier(classify(switched.ocModel));
            console.error(`[vibeOS] \u{1F501} task workaround: switched global slot ${taskSlotRestore} \u2192 ${desiredSlot}`);
          } else {
            taskSlotRestore = null;
          }
        }
      } catch {
      }
      console.error(`[vibeOS] \u{1F500} Task \u2192 ${_target} (${_reason}, orchestrator: ${currentModel})`);
    }
  }
  if (FREE.has(t))
    return;
  if (isModelFree(currentModel))
    return;
  const _brainCost = modelCostPerTurn(currentModel);
  const _workerModel = TRINITY_CHEAP || TRINITY_MEDIUM || null;
  const _workerCost = _workerModel ? modelCostPerTurn(_workerModel) ?? 0 : 0;
  const _rawEdit = _brainCost !== null ? Math.max(0, _brainCost - _workerCost) : SAVE_EST.WRITE_EDIT;
  const _estEdit = Math.max(_rawEdit, SAVE_EST.WRITE_EDIT * 0.1);
  const _estOpus = _brainCost !== null ? Math.max(_brainCost, _estEdit) : SAVE_EST.OPUS_DISABLE;
  const _estC7 = _brainCost !== null ? Math.max(_brainCost, SAVE_EST.CONTEXT7) : SAVE_EST.CONTEXT7;
  const _tierWord = currentTier === "high" ? "Brain" : currentTier === "mid" ? "Medium" : "Budget";
  const _firstWord = extractFirstWordFromArgs(t, args || inArgs);
  if (_credit < 40) {
    const total = recordSaving(t, "credit<40% high-tier", _estOpus, { firstWord: _firstWord });
    const trend = trendDisplay(readLifetimeSavings().sesTrend);
    const msg = `\u26A0 [vibeOS] Credit: ${_credit}% \u2014 switching to medium saves ~$${_estOpus.toFixed(3)}/turn. Run \`trinity medium\`.`;
    if (shouldLogWarn(`${t}|credit|${_tierWord}`))
      console.error(`[vibeOS] [delegation] ${msg}`);
    pendingUiNote = msg;
    return;
  }
  if (WARN_ON_DIRECT.has(String(t || "").toLowerCase())) {
    const sel = loadSelection();
    console.error(`[vibeOS] [enforce-debug] tool=${t} tier=${currentTier} enforce=${sel?.delegation_enforce} argsType=${typeof args} argsExists=${!!args}`);
    const tLower = String(t || "").toLowerCase();
    if (sel.delegation_enforce && currentTier === "high" && args && typeof args === "object") {
      const actualArgs = args || output && output.args || {};
      const originalPath = actualArgs.filePath || actualArgs.file_path || "";
      const basename10 = originalPath.split("/").pop() || "blocked";
      const apiResult = await remoteCall("delegateCheck", [tLower, currentTier, currentModel, _prompt], () => ({
        blocked: true,
        savings: _estEdit
      }));
      const isBlocked = apiResult?.blocked !== false;
      const savings = apiResult?.savings ?? _estEdit;
      if (isBlocked) {
        if (tLower === "write") {
          actualArgs.filePath = `/tmp/vibeos-enforcement-blocked-${basename10}`;
          if (actualArgs.file_path !== void 0)
            actualArgs.file_path = actualArgs.filePath;
        } else if (tLower === "edit" || tLower === "notebookedit") {
          actualArgs.oldString = `__THE_SAVER_ENFORCEMENT_BLOCK_${Date.now()}__`;
        }
        const total2 = recordSaving(t, "delegation enforced", savings, { firstWord: _firstWord });
        pendingUiNote = `\u{1F6AB} Direct ${t} blocked on Brain tier \u2192 delegate via Task or run \`trinity medium\`.`;
        enforcementBlocked = true;
        if (shouldLogWarn(`${t}|enforced|${_tierWord}`))
          console.error(`[vibeOS] [enforcement] BLOCKED direct ${t} on high tier \u2192 delegate via Task`);
        return;
      }
    }
    const total = recordSaving(t, "direct edit", _estEdit, { firstWord: _firstWord });
    const msg = `[vibeOS] ${_tierWord} tier direct ${t} \u2014 save ~$${_estEdit.toFixed(3)} by delegating to Task. Run \`trinity medium\`.`;
    if (shouldLogWarn(`${t}|direct|${_tierWord}`))
      console.error(`[vibeOS] [delegation] ${msg}`);
    pendingUiNote = msg;
    return;
  }
  if (SOFT_QUOTA.has(t)) {
    if (t !== "bash") {
      const target = args?.url || args?.query || "";
      if (isDocsTarget(target) && !context7Seen.has(target)) {
        context7Seen.add(target);
        if (detectContext7()) {
          const total = recordSaving(t, "docs-target without context7", _estC7, { firstWord: _firstWord });
          console.error(`[vibeOS] [cost policy] Context7 available \u2014 prefer over webfetch for docs lookups (~$0.06/turn saved).`);
        } else {
          const missed = recordMissedContext7(_estC7);
          if (!existsSync13(CONTEXT7_INSTALL_FLAG)) {
            try {
              mkdirSync9(dirname7(CONTEXT7_INSTALL_FLAG), { recursive: true });
              writeFileSync11(CONTEXT7_INSTALL_FLAG, "");
            } catch {
            }
            console.error(`[vibeOS] \u{1F4A1} Install context7 MCP to save ~$0.06/turn on docs: \`claude mcp add context7 npx @upstash/context7-mcp\``);
          } else if (!context7AlertedThisSession) {
            context7AlertedThisSession = true;
            console.error(`[vibeOS] \u{1F4B8} context7 not installed \u2014 missed ~$${(missed ?? 0).toFixed(2)} savings this session.`);
          }
        }
      }
    }
    softQuotaCounts[t] = (softQuotaCounts[t] ?? 0) + 1;
    const n = softQuotaCounts[t];
    if (n === SOFT_QUOTA_LIMIT + 1) {
      const total = recordSaving(t, `soft quota exceeded (limit ${SOFT_QUOTA_LIMIT})`, SAVE_EST.SOFT_QUOTA);
      console.error(`[vibeOS] Bash usage high (${n}/${SOFT_QUOTA_LIMIT}) \u2014 delegate to Task subagent.`);
    } else if (n <= SOFT_QUOTA_LIMIT) {
      console.error(`[vibeOS] ${t} ${n}/${SOFT_QUOTA_LIMIT}`);
    }
    return;
  }
};
var onToolExecuteAfter = async (input, output) => {
  if (!loadSelection().enabled)
    return;
  _refreshModel(projectDirectory);
  let _footerText = "";
  try {
    const { ltTasks, ltCache, ltCost, sesTrend, sesModelTurns } = readLifetimeSavings();
    const ltTotal = ltTasks + ltCache;
    const trendIcon = sesTrend === "down" ? "\u2193" : sesTrend === "up" ? "\u2191" : "\u2192";
    const selNow = loadSelection();
    const tags = [`[${shortModelName(currentModel)}]`];
    const bbMode = resolveEnforcementMode();
    if (bbMode === "relaxed") {
      tags.push("[Q&A]");
    } else {
      if (selNow.delegation_enforce)
        tags.push("[ENF ON]");
      if (selNow.flow_enforce)
        tags.push("[FLOW ON]");
      if (selNow.tdd_enforce)
        tags.push("[TDD ON]");
      if (bbMode === "strict")
        tags.push("[STRICT]");
    }
    if (_modelLocked)
      tags.push("[LOCK ON]");
    const workerModel = currentTier === "high" && TRINITY_MEDIUM ? TRINITY_MEDIUM : TRINITY_CHEAP;
    const totalTurns = (sesModelTurns?.brain || 0) + (sesModelTurns?.worker || 0);
    if (totalTurns > 0 && workerModel && workerModel !== currentModel) {
      const brainPct = Math.round(sesModelTurns.brain / totalTurns * 100);
      tags[0] = `[${shortModelName(currentModel)} ${brainPct}% > ${shortModelName(workerModel)} ${100 - brainPct}%]`;
    }
    const statusLine = tags.join(" ");
    let stressTag = "";
    if (latestUserIntent) {
      const ss = scoreStress(latestUserIntent);
      if (ss > 0.1) {
        const label = ss > 0.7 ? "high" : ss > 0.4 ? "elevated" : "calm";
        stressTag = ` stress:${label}`;
      }
    }
    if (ltTotal > 0) {
      _footerText = `vibeOS: ${formatUsd(ltTotal)} saved ${trendIcon} | ${statusLine}${stressTag}

`;
    } else {
      _footerText = `${statusLine}${stressTag}

`;
    }
    output.title = _footerText.trim();
    if (typeof output?.output === "string")
      output.output = _footerText + output.output;
    else if (typeof output?.result === "string")
      output.result = _footerText + output.result;
    else if (typeof output?.text === "string")
      output.text = _footerText + output.text;
    else if (typeof output?.content === "string")
      output.content = _footerText + output.content;
    else
      output.output = _footerText;
    _autoReportCount2 = (_autoReportCount2 || 0) + 1;
    if (_autoReportCount2 % 5 === 0 && ltTotal > 0) {
      saveReport({
        type: "session",
        summary: `Session cost: $${formatUsd(ltCost)} | cache saved: $${formatUsd(ltCache)} | delegation saved: $${formatUsd(ltTasks)}`,
        metrics: { sessionId: _OC_SID, sessionCost: ltCost, cacheSavings: ltCache, delegationSavingsUsd: ltTasks, model: currentModel, slot: selNow.active_slot || "unknown" },
        tags: ["auto", "cost"]
      });
    }
  } catch {
  }
  const t = input?.tool ?? "";
  if ((t === "task" || t === "bash" || t === "edit" || t === "write") && !_mlSavePending) {
    setMlSavePending(true);
    setTimeout(() => {
      saveMLState();
      setMlSavePending(false);
    }, 5e3);
  }
  if (t === "task") {
    const m = input?.args?.model;
    if (m && typeof output?.title === "string") {
      const label = modelToSlotLabel(m);
      output.title = output.title.replace(/\[agent\]|\[general\]/gi, label);
      if (!output.title.includes(label))
        output.title = `${output.title} ${label}`;
    }
  }
  if (t === "task") {
    const quality = scoreTaskQuality(output?.result || output?.text || "", input?.args?.prompt || "");
    try {
      appendFileSync7(SAVINGS_LEDGER_FILE, JSON.stringify({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        kind: "quality",
        score: quality,
        tool: t,
        sid: _OC_SID,
        v: 2
      }) + "\n");
    } catch {
    }
    updateState((s) => {
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" };
      s.lifetime.quality_total_score = (s.lifetime.quality_total_score || 0) + quality;
      s.lifetime.quality_total_count = (s.lifetime.quality_total_count || 0) + 1;
      s.lifetime.last_updated = (/* @__PURE__ */ new Date()).toISOString();
      return s;
    });
  }
  if (pendingUiNote) {
    if (enforcementBlocked) {
      if (typeof output?.result === "string")
        output.result = pendingUiNote;
      else if (typeof output?.text === "string")
        output.text = pendingUiNote;
      else if (typeof output?.content === "string")
        output.content = pendingUiNote;
      else
        output.result = pendingUiNote;
    } else {
      const note = `

${pendingUiNote}`;
      if (typeof output?.result === "string")
        output.result += note;
      else if (typeof output?.text === "string")
        output.text += note;
      else if (typeof output?.content === "string")
        output.content += note;
      else
        output.result = pendingUiNote;
    }
    pendingUiNote = null;
  }
  if (t === "task" && taskSlotRestore) {
    try {
      const back = applySlot(taskSlotRestore);
      if (back?.ok) {
        setCurrentModel(back.ocModel);
        setCurrentTier(classify(back.ocModel));
        console.error(`[vibeOS] \u{1F501} task workaround: restored global slot \u2192 ${taskSlotRestore}`);
      }
    } catch {
    }
    taskSlotRestore = null;
  }
  if (enforcementBlocked) {
    enforcementBlocked = false;
    return;
  }
  observeToolPattern(t, input, output, projectDirectory);
  if (t === "task") {
    const outputText = output?.result ?? output?.text ?? output?.content ?? "";
    if (typeof outputText === "string" && outputText.length > 0) {
      const TASK_FILE_RE = /((?:\.?[\w@][\w.\-]*\/)+[\w.\-]+\.(?:py|js|ts|mjs|tsx|jsx|cjs|mts|sh|go|rs|rb|java|kt))/gi;
      const sel = loadSelection();
      const explicitTestIntent = isUserAskingForTests(latestUserIntent);
      const seen = /* @__PURE__ */ new Set();
      let match;
      while ((match = TASK_FILE_RE.exec(outputText)) !== null) {
        const fp3 = match[1];
        if (seen.has(fp3))
          continue;
        seen.add(fp3);
        const isTestPath = /(^|\/)(tests?|spec)\//i.test(fp3) || /\.(test|spec)\./i.test(fp3);
        if (sel.tdd_enforce && !isTestPath) {
          const createdPath = enforceTestFile(fp3);
          if (createdPath) {
            const ext = createdPath.split(".").pop();
            const fileName = createdPath.split("/").pop();
            const enforceNote = "\n\n[test-enforced] Created skeleton at " + createdPath + "\n  NEXT: 1) Open " + fileName + "  2) Replace TODO/FIXME markers with real assertions  3) Run `npx vitest run " + createdPath + "` (or language-equivalent)  4) Confirm tests pass";
            if (typeof output?.text === "string")
              output.text += enforceNote;
            else if (typeof output?.result === "string")
              output.result += enforceNote;
          }
        }
      }
    }
  }
  if (t === "write" || t === "edit" || t === "multiedit") {
    const fp3 = input?.args?.filePath || input?.args?.file_path || input?.args?.path || "";
    const reminder = buildTestReminder(fp3);
    if (reminder) {
      const note = `

[test-reminder] ${reminder}`;
      if (typeof output?.text === "string")
        output.text += note;
      else if (typeof output?.result === "string")
        output.result += note;
      else
        console.error(`[vibeOS] ${reminder}`);
    }
    const sel = loadSelection();
    const explicitTestIntent = isUserAskingForTests(latestUserIntent);
    const isTestPath = /(^|\/)(tests?|spec)\//i.test(fp3) || /\.(test|spec)\./i.test(fp3);
    if (sel.tdd_enforce && !isTestPath) {
      const createdPath = enforceTestFile(fp3);
      if (createdPath) {
        const ext = createdPath.split(".").pop();
        const fileName = createdPath.split("/").pop();
        const enforceNote = `

[test-enforced] Created skeleton at ${createdPath}
  NEXT: 1) Open ${fileName}  2) Replace TODO/FIXME markers with real assertions  3) Run \`npx vitest run ${createdPath}\` (or language-equivalent)  4) Confirm tests pass`;
        if (typeof output?.text === "string")
          output.text += enforceNote;
        else if (typeof output?.result === "string")
          output.result += enforceNote;
      }
    }
    if (t === "edit" || t === "write") {
      const testExtRe = /\.(test|spec)\./i;
      if (testExtRe.test(fp3)) {
        try {
          updateState((state) => {
            state.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" };
            state.lifetime.tdd_followup_completions = (state.lifetime.tdd_followup_completions || 0) + 1;
            state.lifetime.last_updated = (/* @__PURE__ */ new Date()).toISOString();
            return state;
          });
        } catch {
        }
      }
    }
    {
      const fp4 = input?.args?.filePath || input?.args?.file_path || input?.args?.path || "";
      const guardRe = /(?:^|\/)(AGENTS|README)\.md$/i;
      if (guardRe.test(fp4)) {
        const guardIcons = { flag: "!", warn: "!!", hint: "_" };
        const guardIcon = guardIcons.flag || "!";
        const fn = basename8(fp4);
        console.error(`[flow-enforcer] ${guardIcon} [guard] ${fn}: protected project doc modified \u2014 verify user intent`);
      }
    }
    if (sel.flow_enabled) {
      const toolName = t === "edit" ? "edit" : "write";
      const filePath = input?.args?.filePath || input?.args?.file_path || input?.args?.path || "";
      const content = t === "edit" ? input?.args?.newString || "" : input?.args?.content || "";
      const flowHits = checkFlowRules({ tool: toolName, filePath, content });
      for (const h of flowHits) {
        if (h.deduped)
          continue;
        const icon = h.severity === "warn" ? "\u26A0" : "\u{1F4A1}";
        console.error(`[flow-enforcer] ${icon} [${h.severity}] ${h.id}: ${h.description} \u2014 ${filePath}`);
      }
      if (sel.flow_enforce) {
        const { recordFlowTodo: recordFlowTodo2 } = await Promise.resolve().then(() => (init_flow_enforcer(), flow_enforcer_exports));
        for (const h of flowHits) {
          if (h.id === "todo-comment" && !h.deduped) {
            recordFlowTodo2({ filePath, content });
          }
        }
      }
    }
  }
  if (t !== "webfetch") {
    applyDecadence();
    return;
  }
  const raw = output?.result ?? output?.text ?? output?.content ?? output?.data;
  if (!raw || typeof raw !== "string") {
    applyDecadence();
    return;
  }
  const processed = compressText(raw);
  if (processed !== raw) {
    if (output.result !== void 0)
      output.result = processed;
    else if (output.text !== void 0)
      output.text = processed;
    else if (output.content !== void 0)
      output.content = processed;
    else if (output.data !== void 0)
      output.data = processed;
  }
  applyDecadence();
};

// src/lib/hooks/session-compact.js
import { readFileSync as readFileSync13, existsSync as existsSync14 } from "node:fs";
var onSessionCompacting = async (_input, output) => {
  if (!loadSelection().enabled)
    return;
  try {
    const indexPath = getSessionIndexPath();
    let recent = "";
    if (existsSync14(indexPath)) {
      try {
        const lines = readFileSync13(indexPath, "utf-8").trim().split("\n").slice(-30);
        recent = lines.map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        }).filter((e) => e && e.hash).map((e) => `  \u2022 ${e.tool} \u2192 ~/.claude/scratch/sessions/${_OC_SID}/by-hash/${e.hash}.txt (${e.size}B)`).join("\n");
      } catch {
      }
    }
    if (!recent)
      recent = "  (no recent scratchpad entries)";
    const note = `[scratchpad-aware compaction] Tool results from this session live on disk at ~/.claude/scratch/sessions/${_OC_SID}/by-hash/<hash>.txt (plus .meta.json metadata and optional .summary.txt Haiku digest). WHEN COMPACTING: (1) drop verbose tool result bodies \u2014 the bulk lives on disk; (2) PRESERVE every <hash> reference, file path, and pointer in the summary; (3) note which on-disk artifacts the model may want to Read back later.

Recent cached entries:
` + recent + "\nTo recall any of these post-compact, use the read/grep tools on the listed path.";
    if (output && Array.isArray(output.context)) {
      output.context.push({ role: "user", content: note });
      output.context.push({ role: "user", content: `[vibeOS] session cache dir: ${getSessionScratchpadDir()} (cleanup on exit enabled)` });
    } else if (output) {
      output.context = [
        { role: "user", content: note },
        { role: "user", content: `[vibeOS] session cache dir: ${getSessionScratchpadDir()} (cleanup on exit enabled)` }
      ];
    }
  } catch (err) {
    console.error(`[vibeOS] session.compacting failed: ${err.message}`);
  }
};

// src/lib/hooks/shell-env.js
var directory2 = "";
var setShellDirectory = (dir) => {
  directory2 = dir || "";
};
var onShellEnv = async (_input, output) => {
  try {
    _refreshModel(directory2 || process.cwd());
    output.env ??= {};
    output.env.OPENCODE_MODEL_TIER = currentTier || "unknown";
    output.env.OPENCODE_MODEL = currentModel || "unknown";
  } catch (e) {
    console.error("[vibeOS] shell.env error:", e);
  }
};

// src/index.ts
var activeJob2 = null;
var fp2 = "";
var _mcpServerRuntime = null;
var _mcpServerHooked = false;
var _creditTimer = null;
var _started = false;
var BALANCE_APIS = {
  deepseek: {
    url: "https://api.deepseek.com/user/balance",
    parse(d) {
      const b = d?.balance_infos?.find((b2) => b2.currency === "USD");
      return b ? parseFloat(b.total_balance) : 0;
    }
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/credits",
    parse(d) {
      return parseFloat(d?.data?.total_credits) || 0;
    }
  }
};
function _readAuth() {
  try {
    return existsSync15(AUTH_F) ? safeJsonParse3(readFileSync14(AUTH_F, "utf-8")) : {};
  } catch {
    return {};
  }
}
async function _fetchBal(provider, key) {
  const api = BALANCE_APIS[provider];
  if (!api) return { provider, balance: 0 };
  try {
    const res = await fetch(api.url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5e3)
    });
    if (!res.ok) return { provider, balance: 0 };
    return { provider, balance: api.parse(await res.json()) };
  } catch {
    return { provider, balance: 0 };
  }
}
async function _snapshot() {
  const auth = _readAuth();
  let total = 0;
  const provs = [];
  for (const [p, c] of Object.entries(auth)) {
    if (!c?.key || !BALANCE_APIS[p]) continue;
    const { balance } = await _fetchBal(p, c.key);
    if (balance > 0) {
      provs.push({ provider: p, balance });
      total += balance;
    }
  }
  try {
    writeFileSync12(CREDIT_CACHE_F, JSON.stringify({ total, providers: provs, ts: Date.now() }));
  } catch {
  }
}
function _lazyRefresh() {
  if (_started) return;
  _started = true;
  _snapshot();
  _creditTimer = setInterval(_snapshot, 60 * 60 * 1e3);
  if (_creditTimer.unref) _creditTimer.unref();
}
function _loadOpenCodeProviders() {
  try {
    const cfg = _readOpenCodeConfigObject(join15(USER_HOME2, ".config", "opencode"));
    return cfg?.provider || {};
  } catch {
    return {};
  }
}
function _readOpenCodeConfigObject(dir) {
  const jsonPath = join15(dir, "opencode.json");
  const jsoncPath = join15(dir, "opencode.jsonc");
  if (existsSync15(jsonPath)) return safeJsonParse3(readFileSync14(jsonPath, "utf-8"));
  if (existsSync15(jsoncPath)) return _parseJsonc(readFileSync14(jsoncPath, "utf-8"));
  return {};
}
function _parseJsonc(raw) {
  const noBlock = String(raw || "").replace(/\/\*[\s\S]*?\*\//g, "");
  const noLine = noBlock.replace(/(^|\s)\/\/.*$/gm, "$1");
  const noTrailing = noLine.replace(/,\s*([}\]])/g, "$1");
  return safeJsonParse3(noTrailing);
}
function _modelCost2(id2) {
  if (!id2) return 0;
  const c = modelCostPerTurn(id2);
  if (c != null) return c;
  const stripped = id2.replace(/^(openrouter|opencode|deepseek)\//, "");
  return modelCostPerTurn(stripped) ?? modelCostPerTurn("deepseek/" + stripped) ?? 0;
}
function _modelTier2(id2) {
  if (!id2) return "budget";
  const high = HIGH_TIER_RE2?.test?.(id2);
  if (high) return "high";
  const mid = MID_TIER_RE2?.test?.(id2);
  return mid ? "mid" : "budget";
}
function readPackageVersion() {
  try {
    const pkg = safeJsonParse3(readFileSync14(join15(process.cwd(), "package.json"), "utf-8"));
    return String(pkg?.version || "");
  } catch {
    return "";
  }
}
function loadMcpPort() {
  const envPort = process.env.VIBEOS_MCP_PORT;
  if (envPort != null && envPort !== "") {
    const n = Number(envPort);
    if (!Number.isFinite(n)) return 9578;
    return n;
  }
  try {
    if (existsSync15(TIERS_FILE2)) {
      const tiers = safeJsonParse3(readFileSync14(TIERS_FILE2, "utf-8"));
      const cfg = tiers?.selection?.mcp_port ?? tiers?.mcp_port;
      if (cfg === false || cfg === "disabled" || cfg === 0) return 0;
      const n = Number(cfg);
      if (Number.isFinite(n)) return n;
    }
  } catch {
  }
  return 9578;
}
function persistMcpPort(port) {
  try {
    if (!existsSync15(TIERS_FILE2)) return;
    const tiers = safeJsonParse3(readFileSync14(TIERS_FILE2, "utf-8"));
    tiers.selection ??= {};
    if (Number(tiers.selection.mcp_port) === Number(port)) return;
    tiers.selection.mcp_port = port;
    mkdirSync10(dirname8(TIERS_FILE2), { recursive: true });
    const tmp = TIERS_FILE2 + ".tmp." + Date.now();
    writeFileSync12(tmp, JSON.stringify(tiers, null, 2) + "\n", "utf-8");
    renameSync6(tmp, TIERS_FILE2);
  } catch {
  }
}
function computeStatusPayload() {
  const sel = loadSelection();
  let tiersData = {};
  try {
    tiersData = safeJsonParse3(readFileSync14(TIERS_FILE2, "utf-8"));
  } catch {
  }
  const credit = loadCredit();
  const activeSlot = sel.active_slot || "brain";
  const current = tiersData?.trinity?.[activeSlot]?.oc || currentModel || "";
  const thinking = sel.thinking_level || thinkingLevel(credit);
  return {
    enabled: sel.enabled !== false,
    active_slot: activeSlot,
    enforce: sel.delegation_enforce !== false,
    flow_enforcer: sel.flow_enabled !== false,
    flow_extract_todos: sel.flow_enforce === true,
    tdd_enforcer: sel.tdd_enforce === true,
    tdd_strict: sel.tdd_strict !== false,
    thinking,
    current_model: current,
    credit_percent: credit,
    version: readPackageVersion()
  };
}
function computeSavingsPayload() {
  const lt = readLifetimeSavings();
  return {
    lifetime: {
      delegation_usd: Number(lt.ltTasks || 0),
      cache_usd: Number(lt.ltCache || 0),
      missed_context7_usd: Number(lt.missedC7 || 0),
      total_warns: Number(lt.count || 0)
    },
    current_session: {
      delegation_usd: Number(lt.sesTasks || 0),
      cache_usd: Number(readFullState()?.sessions?.[_OC_SID]?.cache_savings_usd || 0),
      warns_count: Array.isArray(readFullState()?.sessions?.[_OC_SID]?.warns) ? readFullState().sessions[_OC_SID].warns.length : 0,
      tool_breakdown: lt.sesToolBreakdown || {}
    },
    cache_hits_this_session: Number(readFullState()?.sessions?.[_OC_SID]?.cache_hits?.length || 0),
    trend: lt.sesTrend || "stable",
    savings_rate_per_hour: Number(lt.sesRatePerHour || 0)
  };
}
function computeSessionCheckout() {
  const state = readFullState();
  const metrics = computeSessionMetrics(state, _OC_SID);
  const session = state?.sessions?.[_OC_SID] || {};
  const warns = Array.isArray(session?.warns) ? session.warns : [];
  const rankedOps = warns.map((w) => ({
    tool: String(w?.tool || "unknown"),
    reason: String(w?.reason || ""),
    savings_usd: Number(w?.est_savings_usd || 0),
    at: w?.at || null
  })).sort((a, b) => b.savings_usd - a.savings_usd).slice(0, 3);
  const flowWarns = getFlowWarns().filter((w) => String(w?.sid || "") === String(process.pid || ""));
  const summary = {
    session_id: _OC_SID,
    duration_seconds: Number(metrics?.sesDuration || 0),
    duration: metrics?.sesDurationFormatted || "0h 0m 0s",
    cost_usd: Number(session?.cost_usd || 0),
    savings: {
      delegation_usd: Number(metrics?.sesTasks || 0),
      cache_usd: Number(session?.cache_savings_usd || 0),
      total_usd: Number((metrics?.sesTasks || 0) + Number(session?.cache_savings_usd || 0))
    },
    tools: {
      breakdown: metrics?.sesToolBreakdown || {},
      top_expensive_operations: rankedOps
    },
    model_split: metrics?.sesModelTurns || { brain: 0, worker: 0 },
    trend_vs_previous_sessions: metrics?.sesTrend || "stable",
    flow_violations: flowWarns
  };
  const reportId = saveReport({
    type: "session-checkout",
    summary: `Session checkout ${_OC_SID}: $${Number(summary.savings.total_usd || 0).toFixed(3)} saved`,
    findings: rankedOps.map((op) => ({
      severity: "info",
      topic: op.tool,
      detail: `${op.reason} ($${op.savings_usd.toFixed(6)})`
    })),
    metrics: {
      duration_seconds: summary.duration_seconds,
      cost_usd: summary.cost_usd,
      delegation_savings_usd: summary.savings.delegation_usd,
      cache_savings_usd: summary.savings.cache_usd,
      total_savings_usd: summary.savings.total_usd,
      trend: summary.trend_vs_previous_sessions,
      brain_turns: summary.model_split.brain || 0,
      worker_turns: summary.model_split.worker || 0
    },
    narrative: JSON.stringify(summary),
    tags: ["session", "checkout"]
  });
  return { ok: true, summary, report_id: reportId };
}
function diagnoseStructuredFromText(raw) {
  const text = String(raw || "");
  const lines = text.split("\n");
  const files = [];
  const model_probes = [];
  const suggestions = [];
  let credit = { percent: loadCredit(), ok: true, fix: null };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.includes("\u2192")) suggestions.push(trimmed.replace(/^→\s*/, ""));
    if (/slot/i.test(trimmed) && /(brain|medium|cheap)/i.test(trimmed)) {
      model_probes.push({ slot: trimmed, model: "", ok: trimmed.includes("\u2705"), fix: trimmed.includes("\u2192") ? trimmed.split("\u2192")[1].trim() : void 0 });
    }
    if (/model-tiers\.json|opencode\.json|delegation-state\.json|auth\.json/i.test(trimmed)) {
      files.push({ path: trimmed, exists: trimmed.includes("\u2705"), ok: trimmed.includes("\u2705"), fix: trimmed.includes("\u2192") ? trimmed.split("\u2192")[1].trim() : void 0 });
    }
    if (/credit/i.test(trimmed)) {
      const m = trimmed.match(/(\d+)%/);
      if (m) credit.percent = Number(m[1]);
      credit.ok = trimmed.includes("\u2705");
      credit.fix = trimmed.includes("\u2192") ? trimmed.split("\u2192")[1].trim() : null;
    }
  }
  return {
    config_valid: !text.includes("\u274C"),
    files,
    model_probes,
    credit,
    locks_clean: true,
    suggestions
  };
}
function projectStructuredFromText(raw) {
  const text = String(raw || "");
  const m1 = text.match(/Brain[^0-9]*(\d+)%/i);
  const m2 = text.match(/Worker[^0-9]*(\d+)%/i);
  const brainPct = m1 ? Number(m1[1]) : 0;
  const workerPct = m2 ? Number(m2[1]) : 0;
  const lines = text.split("\n");
  const suggestions = lines.filter((l) => l.includes("\u{1F4A1}")).map((l) => l.replace(/^.*💡\s*/, "").trim());
  return {
    brain_pct: brainPct,
    worker_pct: workerPct,
    enforcement_status: loadSelection().delegation_enforce ? "enforce" : "warn",
    flow_status: loadSelection().flow_enabled !== false ? "on" : "off",
    credit_percent: loadCredit(),
    suggestions
  };
}
async function DelegationEnforcer({ client: client2, directory: directory3 } = {}) {
  console.error(`[vibeOS] LOADED cwd=${directory3}`);
  if (typeof setToolDirectory === "function") setToolDirectory(directory3 || "");
  if (typeof setShellDirectory === "function") setShellDirectory(directory3 || "");
  registerSessionCleanupHandlers();
  pruneScratchpadOnce();
  setCurrentModel(readConfig(directory3));
  if (!currentModel) {
    const home = process.env.HOME || "";
    if (home) setCurrentModel(readConfig(join15(home, ".config/opencode")));
  }
  if (!currentModel) setCurrentModel(process?.env?.OPENCODE_MODEL || "");
  if (currentModel) {
    setCurrentTier(classify(currentModel));
    try {
      const _tiersData = safeJsonParse3(readFileSync14(TIERS_FILE2, "utf-8"));
      const _activeSlot = _tiersData?.selection?.active_slot || "brain";
      if (_activeSlot === "brain") {
        const _brainOcModel = _tiersData?.trinity?.brain?.oc || "";
        if (_brainOcModel && currentModel === _brainOcModel && !PLACEHOLDER_RE.test(_brainOcModel)) {
          const cost = modelCostPerTurn(_brainOcModel);
          if (HIGH_TIER_RE2.test(_brainOcModel) || cost !== null && cost >= 0.01) {
            setCurrentTier("high");
            console.error(`[vibeOS] tier override \u2192 high (brain slot)`);
          }
        }
      }
    } catch {
    }
    console.error(`[vibeOS] ACTIVE: model=${currentModel} tier=${currentTier}`);
  } else {
    console.error("[vibeOS] NO MODEL \u2014 enforcement disabled, will auto-detect on first hook");
  }
  console.error(`[vibeOS] auto-config guard: currentModel=${currentModel ? "SET" : "NONE"}, TIERS_FILE=${TIERS_FILE2}, exists=${existsSync15(TIERS_FILE2)}`);
  if (currentModel || !existsSync15(TIERS_FILE2)) {
    try {
      let _tiersData;
      let _wasCorrupted = false;
      if (existsSync15(TIERS_FILE2)) {
        try {
          _tiersData = safeJsonParse3(readFileSync14(TIERS_FILE2, "utf-8"));
        } catch {
          _tiersData = { selection: { enabled: true, active_slot: "brain", delegation_enforce: true, tdd_strict: true }, trinity: {} };
          _wasCorrupted = true;
        }
        if (!_wasCorrupted && !_tiersData?.trinity) _wasCorrupted = true;
        if (!_wasCorrupted) {
          for (const slot of ["brain", "medium", "cheap"]) {
            if (!_tiersData?.trinity?.[slot] || _tiersData.trinity[slot] === null || typeof _tiersData.trinity[slot].oc !== "string") {
              _wasCorrupted = true;
              break;
            }
          }
        }
      } else {
        _tiersData = { selection: { enabled: true, active_slot: "brain", delegation_enforce: true, tdd_strict: true }, trinity: {} };
      }
      const _providers = _loadOpenCodeProviders();
      const _allModels = [];
      for (const [providerName, cfg] of Object.entries(_providers)) {
        if (cfg?.models && typeof cfg.models === "object") {
          for (const rawId of Object.keys(cfg.models)) {
            const id2 = rawId.includes("/") ? rawId : providerName + "/" + rawId;
            if (!_allModels.some((m) => m.id === id2)) {
              _allModels.push({ id: id2, cost: _modelCost2(id2), tier: _modelTier2(id2) });
            }
          }
        }
      }
      if (!_allModels.some((m) => m.id === currentModel)) {
        _allModels.push({ id: currentModel, cost: _modelCost2(currentModel), tier: _modelTier2(currentModel) });
      }
      const _ranked = classifyAndRankModels(_allModels);
      const _brain = _ranked?.brain || { id: currentModel, cost: _modelCost2(currentModel), tier: _modelTier2(currentModel) };
      let _medium = _ranked?.medium;
      let _cheap = _ranked?.cheap;
      const _existing = _tiersData?.trinity || {};
      const _existingMedium = _existing.medium?.oc || "";
      const _existingCheap = _existing.cheap?.oc || "";
      const _isPlaceholder = (id2) => !id2 || PLACEHOLDER_RE.test(id2);
      const _preferExistingOrRanked = (ranked, existingId) => {
        if (ranked && ranked.id) return ranked;
        if (_isPlaceholder(existingId)) return null;
        if (!existingId) return null;
        return { id: existingId, cost: _modelCost2(existingId), tier: _modelTier2(existingId) };
      };
      if (!_medium || _medium.id === _brain.id) {
        _medium = _preferExistingOrRanked(_medium, _existingMedium) || _medium;
      }
      if (!_cheap || _cheap.id === _brain.id || _medium && _cheap && _cheap.id === _medium.id) {
        _cheap = _preferExistingOrRanked(_cheap, _existingCheap) || _cheap;
      }
      if (_medium?.id === _brain.id) _medium = { ..._brain };
      if (_cheap?.id === _brain.id || _cheap?.id === _medium?.id) _cheap = { ..._brain };
      let _didWrite = false;
      const _existingBrain = _existing.brain?.oc || "";
      if (_brain.id && _isPlaceholder(_existingBrain)) {
        _tiersData.trinity.brain = { oc: _brain.id, cc: modelToCcAlias(_brain.id) };
        _didWrite = true;
      }
      if (_medium && _medium.id && _isPlaceholder(_existingMedium)) {
        _tiersData.trinity.medium = { oc: _medium.id, cc: modelToCcAlias(_medium.id) };
        _didWrite = true;
      }
      if (_cheap && _cheap.id && _isPlaceholder(_existingCheap)) {
        _tiersData.trinity.cheap = { oc: _cheap.id, cc: modelToCcAlias(_cheap.id) };
        _didWrite = true;
      }
      if (_tiersData) {
        _tiersData.selection ??= {};
        if (_tiersData.selection.mcp_port === void 0) _tiersData.selection.mcp_port = 9578;
        mkdirSync10(dirname8(TIERS_FILE2), { recursive: true });
        const _tmp = TIERS_FILE2 + ".tmp." + Date.now();
        writeFileSync12(_tmp, JSON.stringify(_tiersData, null, 2) + "\n", "utf-8");
        renameSync6(_tmp, TIERS_FILE2);
        console.error(`[vibeOS] auto-synced model-tiers.json: brain=${_brain.id} medium=${_tiersData.trinity?.medium?.oc || ""} cheap=${_tiersData.trinity?.cheap?.oc || ""}`);
        const _tiersCfg = safeJsonParse3(readFileSync14(TIERS_FILE2, "utf-8"));
        const _b = _tiersCfg?.trinity?.brain?.oc;
        const _m = _tiersCfg?.trinity?.medium?.oc;
        const _c = _tiersCfg?.trinity?.cheap?.oc;
        setTrinityBrain(_b || _brain.id);
        setTrinityCheap(_c || _cheap?.id || null);
        setTrinityMedium(_m || _medium?.id || null);
        if (_didWrite || _wasCorrupted) {
          console.error(`[vibeOS] WRITE: _didWrite=${_didWrite} _wasCorrupted=${_wasCorrupted} brain=${_brain?.id}`);
        } else {
          console.error(`[vibeOS] SKIP WRITE: _didWrite=${_didWrite} _wasCorrupted=${_wasCorrupted} existingBrain=${_existingBrain} brainId=${_brain?.id}`);
        }
      }
    } catch {
    }
  }
  try {
    const _mt = safeJsonParse3(readFileSync14(TIERS_FILE2, "utf-8"));
    if (_mt.selection && (_mt.selection.mcp_port === void 0 || _mt.selection.mcp_port === null)) {
      _mt.selection.mcp_port = 9578;
      const _tmp = TIERS_FILE2 + ".tmp." + Date.now();
      writeFileSync12(_tmp, JSON.stringify(_mt, null, 2) + "\n", "utf-8");
      renameSync6(_tmp, TIERS_FILE2);
    }
  } catch {
  }
  if (detectContext7()) console.error(`[vibeOS] context7 detected \u2014 docs nudge enabled`);
  fp2 = projectFingerprint(directory3);
  setCurrentProjectFingerprint2(fp2);
  setCurrentProjectName(directory3 ? directory3.split("/").pop() : "unknown");
  activeJob2 = getActiveJobForProject(fp2);
  try {
    const state = loadProjectState();
    const bucket = ensureProjectBucket(state, fp2);
    bucket.totalSessions = (bucket.totalSessions || 0) + 1;
    bucket.lastSeen = (/* @__PURE__ */ new Date()).toISOString();
    saveProjectState(state);
  } catch (err) {
    console.error(`[vibeOS] project-memory init failed for ${fp2}: ${err.message}`);
  }
  try {
    if (directory3 && existsSync15(directory3)) {
      const techStack = detectTechStack2(directory3);
      const result = ensureProjectDocs(directory3, techStack);
      if (result.created.length > 0) console.error(`[vibeOS] Project Guard: created ${result.created.join(", ")}`);
      const skillResult = ensureProjectSkill(directory3, fp2);
      if (skillResult.created) {
        console.error(`[vibeOS] Project Guard: created ${skillResult.path}`);
      }
    }
  } catch (err) {
    console.error(`[vibeOS] Project Guard init failed: ${err.message}`);
  }
  const pluginHooks = {
    "tool.execute.before": async (input, output) => {
      onToolExecuteBefore._directory = directory3;
      return onToolExecuteBefore(input, output);
    },
    "tool.execute.after": async (input, output) => {
      onToolExecuteAfter._directory = directory3;
      return onToolExecuteAfter(input, output);
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      return onMessagesTransform(_input, output);
    },
    "experimental.text.complete": async (input, output) => {
      await _appendFooter(input, output, directory3);
    },
    "message.updated": async (input, output) => {
      await _appendFooter(input, output, directory3);
    },
    "experimental.session.compacting": async (_input, output) => {
      return onSessionCompacting(_input, output);
    },
    "experimental.chat.system.transform": async (_input, output) => {
      return onSystemTransform(_input, output);
    },
    "shell.env": async (_input, output) => {
      if (typeof setShellDirectory === "function") setShellDirectory(directory3 || "");
      return onShellEnv(_input, output);
    },
    tool: {
      trinity: tool({
        description: "Control the vibeOS plugin and active model slot.\nUse action='status' to see current state.\nUse action='enable' or 'disable' to toggle the plugin.\nUse action='set' with slot='brain'|'medium'|'cheap' to switch.\nUse action='mode' with slot='budget'|'quality'|'speed'|'longrun'|'auto' to switch optimization modes.\nUse action='rebuild' to auto-detect available models.\nUse action='flow' with slot='on'|'off' to toggle flow enforcer.\nUse action='enforce' with slot='on'|'off' to toggle delegation enforcement.\nUse action='tdd' with slot='on'|'off' to toggle auto-test skeletons.\nUse action='project' for per-project analytics.\nUse action='patterns' for learned project patterns.\nUse action='guard' for Project Guard.\nCall when the user says 'switch to medium', 'use cheap model', 'disable plugin', or 'trinity status'.",
        args: {
          action: tool.schema.enum(["status", "enable", "disable", "set", "mode", "thinking", "flow", "tdd", "project", "patterns", "rebuild", "diagnose", "help", "enforce", "repair-state", "blackbox", "report", "target", "guard"]).optional(),
          slot: tool.schema.enum(["brain", "medium", "cheap", "budget", "quality", "speed", "longrun", "auto", "on", "off", "enforce", "strict", "preview", "apply", "clear", "savings"]).optional(),
          level: tool.schema.enum(["full", "brief", "off", "on"]).optional()
        },
        async execute({ action, slot, level } = {}) {
          if (typeof _lazyRefresh === "function") _lazyRefresh();
          if (!action) action = "status";
          if (["brain", "medium", "cheap"].includes(action)) {
            slot = action;
            action = "set";
          }
          if (action === "status") {
            const sel = loadSelection();
            let tiers = {};
            try {
              tiers = safeJsonParse3(readFileSync14(TIERS_FILE2, "utf-8")).trinity || {};
            } catch {
            }
            const credit = loadCredit();
            const effectiveLevel = sel.thinking_level || thinkingLevel(credit);
            const sv = readLifetimeSavings();
            const ltTotal = (sv.ltTasks || 0) + (sv.ltCache || 0);
            const sesTasks = sv.sesTasks || 0;
            const sesWarns = Array.isArray(readFullState()?.sessions?.[_OC_SID]?.warns) ? readFullState().sessions[_OC_SID].warns.length : 0;
            const sesTrend = sv.sesTrend || "stable";
            const sesRate = sv.sesRatePerHour || 0;
            const missedC7 = sv.missedC7 || 0;
            const toolBreakdown = sv.sesToolBreakdown || {};
            const topTools = Object.entries(toolBreakdown).filter(([, v]) => v > 5e-3).sort((a, b) => b[1] - a[1]).slice(0, 5);
            const brainModel = tiers?.brain?.oc || "(unset)";
            const mediumModel = tiers?.medium?.oc || "(unset)";
            const cheapModel = tiers?.cheap?.oc || "(unset)";
            const activeSlot = sel.active_slot || "brain";
            const stressScore = latestUserIntent ? scoreStress(latestUserIntent) : 0;
            const stressBar = stressScore > 0.85 ? "\u2588" : stressScore > 0.7 ? "\u2586" : stressScore > 0.5 ? "\u2585" : stressScore > 0.3 ? "\u2583" : stressScore > 0.1 ? "\u2582" : "\u2581";
            const stressLabel = stressScore > 0.7 ? "high" : stressScore > 0.4 ? "elevated" : stressScore > 0.1 ? "calm" : "none";
            const totalTurns = (sv.sesModelTurns?.brain || 0) + (sv.sesModelTurns?.worker || 0);
            const brainPct = totalTurns > 0 ? Math.round(sv.sesModelTurns.brain / totalTurns * 100) : 0;
            const workerPct = 100 - brainPct;
            const qualityAvg = sv.quality_avg || 0;
            const sesDuration = sv.sesDuration || 0;
            const durHrs = Math.floor(sesDuration / 3600);
            const durMins = Math.floor(sesDuration % 3600 / 60);
            let decisionLine = "";
            if (_blackboxEnabled) {
              try {
                const res = _latestBlackboxState || getBlackboxResolution();
                if (res && res.n_interactions > 3) {
                  const momentumIcon = res.momentum > 0.3 ? "up up" : res.momentum > 0 ? "up" : res.momentum < -0.3 ? "down down" : res.momentum < 0 ? "down" : "flat";
                  decisionLine = `${res.resolution} ${res.sub_regime} ${momentumIcon}${res.is_looping ? " (loop)" : ""}`;
                }
              } catch {
              }
            }
            const lines = [
              `[vibeOS-dashboard]`,
              `Model: ${activeSlot} (${brainModel})`,
              ...totalTurns > 0 ? [`Split: brain ${brainPct}% / worker ${workerPct}% (${totalTurns} total)`] : [],
              `Thinking: ${effectiveLevel}`,
              `Credit: ${credit}%`,
              ...qualityAvg > 0 ? [`Quality: ${Math.round(qualityAvg)}%`] : [],
              ...decisionLine ? [`Decision: ${decisionLine}`] : [],
              `|`,
              `Stress: ${stressBar} (${stressLabel})`,
              `|`,
              `Guards: Flow: ${sel.flow_enabled !== false ? "ON" : "OFF"}${sel.flow_enforce ? " (extract)" : ""}`,
              `TDD: ${sel.tdd_enforce ? "ON" : "OFF"}${sel.tdd_strict !== false ? " strict" : ""}${sel.tdd_quality !== false ? " quality" : ""}`,
              `Enforce: ${sel.delegation_enforce ? "ON" : "OFF"}`,
              `Lock: ${_modelLocked ? "LOCKED" : "unlocked"}`,
              `|`,
              `All-time: Total: $${ltTotal.toFixed(2)} (${sesTrend})`,
              `Delegation: $${(sv.ltTasks || 0).toFixed(2)}`,
              `Cache: $${formatUsd(sv.ltCache || 0)}`,
              `Missed: $${missedC7.toFixed(2)}`,
              `|`,
              `This session:`,
              ...sesDuration > 0 ? [`Duration: ${durHrs}h ${durMins}m`] : [],
              `Rate: $${sesRate.toFixed(2)}/hr`,
              `Warnings: ${sesWarns}`,
              ...topTools.length > 0 ? [`Top tools:`, ...topTools.map(([t, v]) => `  ${t}: $${v.toFixed(2)}`)] : [],
              `|`,
              `Tiers: brain: ${brainModel}${activeSlot === "brain" ? "  *" : ""}`,
              `  medium: ${mediumModel}${activeSlot === "medium" ? "  *" : ""}`,
              `  cheap:  ${cheapModel}${activeSlot === "cheap" ? "  *" : ""}`
            ];
            return lines.join("\n");
          }
          if (action === "enable") {
            return writeSelection("enabled", true) ? "Plugin ENABLED" : "Failed";
          }
          if (action === "disable") {
            return writeSelection("enabled", false) ? "Plugin DISABLED" : "Failed";
          }
          if (action === "set") {
            if (!slot || !["brain", "medium", "cheap"].includes(slot)) return "Provide slot: brain | medium | cheap";
            const result = applySlot2(slot);
            if (!result.ok) return "Failed: " + result.reason;
            return `Switched to ${slot} slot (${result.ocModel})`;
          }
          if (action === "mode") {
            if (!slot || !["budget", "quality", "speed", "longrun", "auto"].includes(slot)) return "Provide mode: budget | quality | speed | longrun | auto";
            saveOptimizationMode(slot);
            const tierMap = { budget: "cheap", quality: "brain", speed: "medium", longrun: "brain" };
            const tierSlot = tierMap[slot] || "cheap";
            writeSelection("active_slot", tierSlot);
            if (slot === "budget") {
              writeSelection("delegation_enforce", false);
              writeSelection("flow_enabled", false);
              writeSelection("flow_enforce", false);
              writeSelection("tdd_enforce", false);
              writeSelection("thinking_level", "off");
            } else if (slot === "quality") {
              writeSelection("delegation_enforce", true);
              writeSelection("flow_enabled", true);
              writeSelection("flow_enforce", true);
              writeSelection("tdd_enforce", true);
              writeSelection("thinking_level", "full");
            } else if (slot === "speed") {
              writeSelection("delegation_enforce", false);
              writeSelection("flow_enabled", false);
              writeSelection("flow_enforce", false);
              writeSelection("tdd_enforce", false);
              writeSelection("thinking_level", "off");
            }
            return `Mode set to ${slot.toUpperCase()}. Tier: ${tierSlot}.`;
          }
          if (action === "thinking") {
            if (!level || !["full", "brief", "off"].includes(level)) return "Provide level: full | brief | off";
            const desc = { full: "no restriction", brief: "complex tasks only", off: "none" };
            if (!writeSelection("thinking_level", level)) return "Failed";
            return `Reasoning depth -> ${desc[level]}`;
          }
          if (action === "flow") {
            if (slot === "on" || slot === "off") {
              return writeSelection("flow_enabled", slot === "on") ? `Flow ${slot === "on" ? "ON" : "OFF"}` : "Failed";
            }
            if (slot === "enforce") {
              if (level !== "on" && level !== "off") return "Provide level on|off";
              return writeSelection("flow_enforce", level === "on") ? `Flow enforce ${level === "on" ? "ON" : "OFF"}` : "Failed";
            }
            const flowWarns = getFlowWarns();
            const sid = String(process.pid || "?");
            const sessionWarns = flowWarns.filter((w) => String(w.sid) === sid);
            const bySev = { warn: 0, hint: 0, flag: 0 };
            for (const w of sessionWarns) {
              if (bySev[w.severity] !== void 0) bySev[w.severity]++;
            }
            const lines = [`Flow enforcer audit:`];
            lines.push(`  ${bySev.warn} warn, ${bySev.hint} hint, ${bySev.flag} flag`);
            if (sessionWarns.length === 0) lines.push(`  No flow violations.`);
            else for (const w of sessionWarns.slice(-15)) lines.push(`  [${w.severity}] ${w.rule_id}: ${w.description}`);
            return lines.join("\n");
          }
          if (action === "enforce") {
            if (slot === "on") return writeSelection("delegation_enforce", true) ? "Enforcement ON" : "Failed";
            if (slot === "off") return writeSelection("delegation_enforce", false) ? "Enforcement OFF" : "Failed";
            return "Enforce: " + (loadSelection().delegation_enforce ? "ON" : "OFF");
          }
          if (action === "tdd") {
            if (slot === "on") return writeSelection("tdd_enforce", true) ? "TDD ON" : "Failed";
            if (slot === "off") return writeSelection("tdd_enforce", false) ? "TDD OFF" : "Failed";
            if (slot === "strict") {
              if (level !== "on" && level !== "off") return "Provide level on|off";
              return writeSelection("tdd_strict", level === "on") ? `TDD strict ${level === "on" ? "ON" : "OFF"}` : "Failed";
            }
            if (slot === "quality") {
              if (level !== "on" && level !== "off") return "Provide level on|off";
              return writeSelection("tdd_quality", level === "on") ? `TDD quality ${level === "on" ? "ON" : "OFF"}` : "Failed";
            }
            const sel = loadSelection();
            return `TDD: ${sel.tdd_enforce ? "ON" : "OFF"} strict:${sel.tdd_strict !== false} quality:${sel.tdd_quality !== false}`;
          }
          if (action === "project") {
            const L = "\u2501";
            const lines = [`Project profile - ${currentProjectName || "unknown"}`];
            lines.push(L.repeat(40));
            const _fp = currentProjectFingerprint || projectFingerprint(directory3);
            const pstate = loadProjectState();
            const proj = pstate.project_hashes?.[_fp];
            if (proj) {
              lines.push(`
Sessions: ${proj.totalSessions || 0} | Last: ${(proj.lastSeen || "").slice(0, 10)}`);
              if (proj.researchChains) lines.push(`Research chains: ${proj.researchChains}`);
              if (proj.commonTopics?.length) lines.push(`Common domains: ${proj.commonTopics.slice(0, 5).join(", ")}`);
            }
            const sv = readLifetimeSavings();
            const totalTurns = (sv.sesModelTurns?.brain || 0) + (sv.sesModelTurns?.worker || 0);
            if (totalTurns > 0) lines.push(`Model split: brain ${Math.round(sv.sesModelTurns.brain / totalTurns * 100)}% / worker ${100 - Math.round(sv.sesModelTurns.brain / totalTurns * 100)}%`);
            if (sv.sesDuration > 0) lines.push(`Duration: ${Math.floor(sv.sesDuration / 3600)}h ${Math.floor(sv.sesDuration % 3600 / 60)}m`);
            if (sv.sesTasks > 0.01 || sv.ltCache > 0.01) lines.push(`Savings: delegation $${sv.sesTasks.toFixed(2)} + cache $${sv.ltCache.toFixed(2)}`);
            if (loadSelection().delegation_enforce === false) lines.push(`HINT: enable enforcement with \`trinity enforce on\``);
            const credit = loadCredit();
            if (credit < 40) lines.push(`HINT: credit ${credit}% - switch to medium slot`);
            lines.push(L.repeat(40));
            return lines.join("\n");
          }
          if (action === "report" && slot === "savings") {
            const sv = readLifetimeSavings();
            return `Savings: delegation $${sv.ltTasks.toFixed(4)} | cache $${(sv.ltCache || 0).toFixed(4)}`;
          }
          if (action === "patterns") {
            const _fp = currentProjectFingerprint || projectFingerprint(directory3);
            const name = currentProjectName || "unknown";
            if (slot === "clear") {
              return `Cleared ${clearProjectPatterns(_fp)} patterns for "${name}"`;
            }
            const rows = projectPatternRows(_fp);
            if (rows.length === 0) return "No learned patterns yet.";
            const lines = [`Project patterns - ${name}:`];
            for (const r of rows.slice(0, 15)) {
              const tag = r.sessions >= 3 ? "promoted" : "learning";
              lines.push(`  [${r.label}/${tag}] ${r.summary} (${r.sessions} sessions)`);
            }
            return lines.join("\n");
          }
          if (action === "guard") {
            if (!directory3 || !existsSync15(directory3)) return "No directory.";
            const result = ensureProjectDocs(directory3, detectTechStack2(directory3));
            const lines = [`Project Guard: ${directory3.split("/").pop()}`];
            for (const f of result.created) lines.push(`  Created ${f}`);
            for (const f of result.skipped) lines.push(`  Already exists: ${f}`);
            return lines.join("\n");
          }
          if (action === "rebuild") {
            const providers = _loadOpenCodeProviders();
            const auth = _readAuth();
            const models = await discoverAvailableModels(providers, auth);
            const ranked = classifyAndRankModels(models);
            if (!ranked) return "No models discovered.";
            try {
              const tiers = safeJsonParse3(readFileSync14(TIERS_FILE2, "utf-8"));
              tiers.trinity = {
                brain: { oc: ranked.brain.id, cc: modelToCcAlias(ranked.brain.id) },
                medium: { oc: ranked.medium.id, cc: modelToCcAlias(ranked.medium.id) },
                cheap: { oc: ranked.cheap.id, cc: modelToCcAlias(ranked.cheap.id) }
              };
              const _tmp = TIERS_FILE2 + ".tmp." + Date.now();
              writeFileSync12(_tmp, JSON.stringify(tiers, null, 2) + "\n", "utf-8");
              renameSync6(_tmp, TIERS_FILE2);
            } catch (e) {
              return "Failed: " + e.message;
            }
            try {
              applySlot2("brain");
            } catch {
            }
            return `Rebuilt: brain=${ranked.brain.id} medium=${ranked.medium.id} cheap=${ranked.cheap.id}`;
          }
          if (action === "diagnose") {
            const results = [];
            const checks = [
              { path: TIERS_FILE2, label: "model-tiers.json" },
              { path: join15(USER_HOME2, ".config/opencode/opencode.json"), label: "opencode.json" },
              { path: STATE_FILE2, label: "delegation-state.json" }
            ];
            for (const c of checks) {
              results.push({ ok: existsSync15(c.path), okLabel: existsSync15(c.path) ? "OK" : "MISSING", label: c.label, detail: existsSync15(c.path) ? "exists" : "missing", fix: existsSync15(c.path) ? void 0 : c.label === "model-tiers.json" ? "run `trinity rebuild`" : void 0 });
            }
            try {
              const tiers = safeJsonParse3(readFileSync14(TIERS_FILE2, "utf-8"));
              for (const s of ["brain", "medium", "cheap"]) {
                const m = tiers?.trinity?.[s]?.oc || "";
                const ok = m.length > 0 && !m.toLowerCase().includes("placeholder");
                results.push({ ok, okLabel: ok ? "OK" : "MISSING", label: `${s} slot`, detail: ok ? m : "unset", fix: ok ? void 0 : "run `trinity rebuild`" });
              }
            } catch {
              for (const s of ["brain", "medium", "cheap"]) results.push({ ok: false, okLabel: "ERR", label: `${s} slot`, detail: "cannot read", fix: "run `trinity rebuild`" });
            }
            const credit = loadCredit();
            results.push({ ok: credit >= 40, okLabel: credit >= 40 ? "OK" : "LOW", label: "credits", detail: `${credit}%`, fix: credit >= 40 ? void 0 : "run `trinity medium`" });
            const okCount = results.filter((r) => r.ok).length;
            results.sort((a, b) => a.ok === b.ok ? 0 : a.ok ? 1 : -1);
            const lines = ["Self Diagnostic:"];
            for (const r of results) {
              lines.push(`  ${r.okLabel} ${r.label}: ${r.detail}`);
              if (!r.ok && r.fix) lines.push(`    fix: ${r.fix}`);
            }
            lines.push(`
${okCount}/${results.length} passed`);
            return lines.join("\n");
          }
          if (action === "repair-state") {
            const mode = slot || "preview";
            if (mode !== "preview" && mode !== "apply") return "Use `trinity repair-state preview` or `trinity repair-state apply`.";
            const dstFp = currentProjectFingerprint || projectFingerprint(directory3);
            const name = currentProjectName || "unknown";
            const pstate = loadProjectState();
            const dstBucket = ensureProjectBucket(pstate, dstFp);
            const srcFps = Object.keys(pstate.project_hashes || {}).filter((f) => f !== dstFp);
            if (srcFps.length === 0) return `No duplicates for "${name}".`;
            const lines = [`Repair (${mode}) for "${name}":`, `  Keeping: ${dstFp}`];
            for (const sf of srcFps) {
              const src = pstate.project_hashes[sf];
              if (src) {
                lines.push(`  Merging: ${sf} (${src.totalSessions || 0} sessions)`);
                if (mode === "apply") mergeProjectBucket(dstBucket, src);
              }
            }
            if (mode === "apply") {
              if (mode === "apply") {
                for (const sf of srcFps) delete pstate.project_hashes[sf];
                saveProjectState(pstate);
                lines.push("Applied.");
              }
            } else {
              lines.push("Run with `apply` to execute.");
            }
            return lines.join("\n");
          }
          if (action === "blackbox") {
            const mode = slot || "status";
            if (mode === "on") {
              setBlackboxEnabled(true);
              saveBlackboxState({ ...loadBlackboxState(), enabled: true });
              return "Blackbox ON";
            }
            if (mode === "off") {
              setBlackboxEnabled(false);
              saveBlackboxState({ ...loadBlackboxState(), enabled: false });
              return "Blackbox OFF";
            }
            if (mode === "reset") {
              const s = loadBlackboxState();
              delete s.sessions[_OC_SID];
              saveBlackboxState(s);
              return "Blackbox RESET";
            }
            if (mode === "status") {
              const bbState = loadBlackboxState();
              const lines = [`Blackbox: ${_blackboxEnabled || bbState.enabled ? "ON" : "OFF"}`];
              const res = _latestBlackboxState || getBlackboxResolution();
              if (res) {
                lines.push(`  Resolution: ${res.resolution}`);
                lines.push(`  Sub-regime: ${res.sub_regime}`);
                lines.push(`  Momentum: ${res.momentum > 0 ? "up" : res.momentum < 0 ? "down" : "flat"} (${res.momentum.toFixed(2)})`);
                lines.push(`  Interactions: ${res.n_interactions}`);
              }
              return lines.join("\n");
            }
            return "Usage: trinity blackbox on|off|status|reset";
          }
          if (action === "help") {
            return [
              "vibeOS - trinity commands",
              "",
              "  trinity status       See plugin state, credit, model",
              "  trinity mode budget|quality|speed|auto   Switch optimization mode",
              "  trinity brain        Switch to brain tier",
              "  trinity medium       Switch to medium tier",
              "  trinity cheap        Switch to cheap tier",
              "  trinity rebuild      Auto-detect models",
              "  trinity enable/disable Toggle plugin",
              "  trinity enforce on/off Block brain-tier writes",
              "  trinity thinking full|brief|off Set reasoning depth",
              "  trinity flow on/off  Toggle flow enforcer",
              "  trinity tdd on/off   Toggle auto-test skeletons",
              "  trinity diagnose     Self-check",
              "  trinity project      Project analytics",
              "  trinity patterns     Show learned patterns",
              "  trinity guard        Ensure AGENTS.md/README.md exist"
            ].join("\n");
          }
          return `Unknown action: ${action}`;
        }
      }),
      "research-audit": tool({
        description: "Scan session for research anti-patterns (domain chains, redundant queries, no synthesis). hours=N (default 24).",
        args: { hours: tool.schema.number().optional() },
        async execute({ hours } = {}) {
          const report = researchAudit({ hours: hours ?? 24 });
          try {
            const state = loadProjectState();
            const bucket = ensureProjectBucket(state, fp2);
            bucket.lastSeen = (/* @__PURE__ */ new Date()).toISOString();
            bucket.researchChains = Math.max(bucket.researchChains || 0, report.chains.length);
            saveProjectState(state);
          } catch {
          }
          try {
            const findings = [];
            for (const c of report.chains) findings.push({ severity: "warn", topic: "Domain chain", detail: `${c.domain}: ${c.count} fetches` });
            if (report.redundant > 0) findings.push({ severity: "warn", topic: "Context7 bypass", detail: `${report.redundant} bypasses` });
            if (report.totalFetches > 0) findings.push({ severity: "info", topic: "Fetch volume", detail: `${report.totalFetches} fetches, ${(report.totalBytes / 1024).toFixed(0)}KB` });
            saveReport({ type: "research-audit", summary: `${report.totalFetches} fetches, ${report.chains.length} chains`, findings, metrics: report, tags: ["research"] });
          } catch {
          }
          const lines = [`Research audit (last ${hours ?? 24}h):`];
          if (report.totalFetches === 0) return lines.concat("  No activity.").join("\n");
          lines.push(`  Fetches: ${report.totalFetches} (${(report.totalBytes / 1024).toFixed(0)}KB)`);
          if (report.redundant > 0) lines.push(`  Context7 bypasses: ${report.redundant}`);
          for (const c of report.chains) lines.push(`  Chain: ${c.domain} (${c.count}x)`);
          return lines.join("\n");
        }
      }),
      "report-save": tool({
        description: "Save report with findings, metrics, narrative.",
        args: {
          summary: tool.schema.string({ description: "One-line summary" }),
          findings: tool.schema.string({ description: "Plain text lines or JSON array" }).optional(),
          metrics: tool.schema.string({ description: "Plain text lines key=value or JSON" }).optional(),
          narrative: tool.schema.string({ description: "Free-form markdown" }).optional(),
          tags: tool.schema.string({ description: "Comma-separated tags" }).optional()
        },
        async execute({ summary, findings, metrics, narrative, tags } = {}) {
          let parsedFindings = [];
          let parsedMetrics = {};
          try {
            if (findings) parsedFindings = JSON.parse(findings);
          } catch {
            if (findings) for (const line of findings.split("\n").map((l) => l.trim()).filter(Boolean)) {
              const m = line.match(/^(warn|info|hint)\s*:\s*(.+?)\s*:\s*(.+)/i);
              if (m) parsedFindings.push({ severity: m[1].toLowerCase(), topic: m[2].trim(), detail: m[3].trim() });
              else parsedFindings.push({ severity: "info", topic: "Note", detail: line });
            }
          }
          try {
            if (metrics) parsedMetrics = JSON.parse(metrics);
          } catch {
            if (metrics) for (const line of metrics.split("\n").map((l) => l.trim()).filter(Boolean)) {
              const m = line.match(/^([\w-]+)\s*=\s*([\d.]+)/);
              if (m) parsedMetrics[m[1]] = parseFloat(m[2]);
            }
          }
          const tagList = tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
          const id2 = saveReport({ type: "manual", summary, findings: parsedFindings, metrics: parsedMetrics, narrative: narrative || "", tags: tagList });
          return id2 ? `Report saved: ${id2}` : "Failed";
        }
      }),
      "report-list": tool({
        description: "List reports. Filter by type, project, hours (default 168).",
        args: {
          type: tool.schema.string().optional(),
          project: tool.schema.string().optional(),
          hours: tool.schema.number().optional()
        },
        async execute({ type, project, hours } = {}) {
          const reports = listReports({ type, project, hours: hours ?? 168 });
          if (reports.length === 0) return "No reports found.";
          const lines = [`Reports (last ${hours ?? 168}h): ${reports.length} total`];
          for (const r of reports.slice(0, 15)) {
            const d = r.created.slice(0, 16).replace("T", " ");
            lines.push(`  [${d}] #${r.id} ${r.type} ${(r.summary || "").slice(0, 80)}`);
          }
          if (reports.length > 15) lines.push(`  ... and ${reports.length - 15} more`);
          return lines.join("\n");
        }
      }),
      "report-read": tool({
        description: "Read a report by ID (from report-list).",
        args: { id: tool.schema.string({ description: "Report ID" }) },
        async execute({ id: id2 } = {}) {
          if (!id2 || !/^[\w-]+$/.test(id2)) return `Invalid ID: ${id2}`;
          const report = readReport(id2);
          if (!report) return `Not found: ${id2}`;
          const d = (report?.meta?.created ?? report?.created ?? "?").slice(0, 16).replace("T", " ");
          const lines = [`Report #${id2}`, `  Type: ${report?.meta?.type ?? report?.type ?? "?"}  |  ${d}`];
          if (report.summary) lines.push(`  ${report.summary}`);
          if (report.tags?.length) lines.push(`  Tags: ${report.tags.join(", ")}`);
          if (report.narrative) lines.push(`  ---
${report.narrative}`);
          return lines.join("\n");
        }
      })
    }
  };
  const _inTestEnv = process.env.VIBEOS_MCP_PORT === "0" || !client2 || Object.keys(client2 || {}).length === 0;
  try {
    const port = loadMcpPort();
    if (port !== 0 && !_inTestEnv) {
      if (!_mcpServerRuntime) {
        _mcpServerRuntime = createMcpServer({
          getState: () => ({ ...computeStatusPayload(), sessions_raw: readFullState()?.sessions || {} }),
          getSavings: () => computeSavingsPayload(),
          getSessionMetrics: () => computeSessionMetrics(readFullState(), _OC_SID),
          listReports: (filter) => {
            if (!existsSync15(REPORTS_DIR)) {
              const e = new Error("reports dir not found");
              e.status = 404;
              throw e;
            }
            return listReports(filter || {});
          },
          readReport: (rvId) => readReport(rvId),
          runDiagnose: async () => diagnoseStructuredFromText(await pluginHooks.tool.trinity.execute({ action: "diagnose" })),
          runProject: async () => projectStructuredFromText(await pluginHooks.tool.trinity.execute({ action: "project" })),
          runTrinity: async (rvAction, params = {}) => pluginHooks.tool.trinity.execute({ action: rvAction, slot: params.slot, level: params.level }),
          runResearchAudit: (hours) => researchAudit({ hours: hours ?? 24 }),
          saveReport: (data) => saveReport(data),
          getCurrentSessionId: () => _OC_SID,
          generateSessionCheckout: () => computeSessionCheckout()
        });
      }
      const mcpServer = await _mcpServerRuntime.start(port);
      const actualPort = Number(mcpServer?.address?.()?.port || port);
      if (actualPort && actualPort !== port) persistMcpPort(actualPort);
      console.error(`[vibeOS] MCP server on http://127.0.0.1:${actualPort}`);
      if (actualPort) console.error(`[vibeOS] Dashboard at http://127.0.0.1:${actualPort}/`);
      console.error(`[vibeOS] Dashboard at http://127.0.0.1:${actualPort}/`);
      if (!_mcpServerHooked) {
        _mcpServerHooked = true;
        process.on("SIGTERM", () => {
          try {
            _mcpServerRuntime?.close();
          } catch {
          }
        });
        process.on("SIGINT", () => {
          try {
            _mcpServerRuntime?.close();
          } catch {
          }
        });
      }
    }
  } catch (err) {
    console.error(`[vibeOS] MCP startup failed: ${err.message}`);
  }
  return pluginHooks;
}
var id = "vibeOS";
var server = DelegationEnforcer;
var VERSION = readPackageVersion();
var index_default = { id: "vibeOS", server: DelegationEnforcer };
function closeMcpServer() {
  try {
    if (_mcpServerRuntime) {
      _mcpServerRuntime.close();
      _mcpServerRuntime = null;
    }
  } catch {
  }
}
export {
  DelegationEnforcer,
  HIGH_TIER_RE2 as HIGH_TIER_RE,
  MID_TIER_RE2 as MID_TIER_RE,
  PLACEHOLDER_RE,
  TRINITY_BRAIN,
  TRINITY_CHEAP,
  TRINITY_MEDIUM,
  VERSION,
  _refreshModel,
  applySlot2 as applySlot,
  buildTestReminder,
  buildTestSkeleton,
  classify,
  classifyAndRankModels,
  closeMcpServer,
  compressText,
  index_default as default,
  detectContext7,
  detectTechStack2 as detectTechStack,
  enforceTestFile,
  extractExports,
  getBlackboxResolution,
  getScratchpadHit,
  getSessionIndexPath,
  getSessionScratchpadDir,
  id,
  isDocsTarget,
  isModelFree,
  listReports,
  loadBlackboxState,
  loadTierRegexes2 as loadTierRegexes,
  modelCostPerTurn,
  modelToCcAlias,
  noteProjectPattern,
  observeToolPattern,
  readReport,
  recordSaving,
  remoteCall,
  researchAudit,
  saveBlackboxState,
  saveReport,
  scoreStress,
  server,
  setTrinityBrain,
  setTrinityCheap,
  setTrinityMedium,
  trendDisplay
};
