var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
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
  getFlowTodos: () => getFlowTodos,
  getFlowWarns: () => getFlowWarns,
  getSessionFlowCounts: () => getSessionFlowCounts,
  recordFlowTodo: () => recordFlowTodo,
  resetAll: () => resetAll,
  resetForTest: () => resetForTest,
  resolveRulesPath: () => resolveRulesPath,
  setFlowStateWriter: () => setFlowStateWriter,
  syncFlowTodosToNative: () => syncFlowTodosToNative
});
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync, appendFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
function safeJsonParse(raw) {
  if (raw == null || raw === "")
    return null;
  try {
    return JSON.parse(raw);
  } catch {
  }
  let cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
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
function getStateFile() {
  const home = process.env.HOME || homedir();
  return join(home, ".claude/delegation-state.json");
}
function getFlowTodoFile() {
  const home = process.env.HOME || homedir();
  return join(home, ".claude/flow-todo-queue.jsonl");
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
    const stateFile = getStateFile();
    if (existsSync(stateFile)) {
      try {
        state = safeJsonParse(readFileSync(stateFile, "utf-8"));
      } catch {
      }
    } else {
      mkdirSync(dirname(stateFile), { recursive: true });
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
    const fp2 = { flow_warns: state.flow_warns };
    if (_stateWriter)
      _stateWriter(fp2);
    else {
      const stateFile2 = getStateFile();
      const existing = safeJsonParse(existsSync(stateFile2) ? readFileSync(stateFile2, "utf-8") : "{}");
      const merged = Object.assign({}, existing, fp2);
      const tmpFile = stateFile2 + ".tmp." + Date.now();
      writeFileSync(tmpFile, JSON.stringify(merged, null, 2));
      renameSync(tmpFile, stateFile2);
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
    const stateFile = getStateFile();
    if (!existsSync(stateFile))
      return [];
    const s = safeJsonParse(readFileSync(stateFile, "utf-8"));
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
    const flowTodoFile = getFlowTodoFile();
    mkdirSync(dirname(flowTodoFile), { recursive: true });
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
    const existingLines = existsSync(flowTodoFile) ? readFileSync(flowTodoFile, "utf-8").trim().split("\n").filter(Boolean) : [];
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
    appendFileSync(flowTodoFile, entry);
    try {
      const lines = readFileSync(flowTodoFile, "utf-8").trim().split("\n").filter(Boolean);
      if (lines.length > MAX_FLOW_TODOS) {
        writeFileSync(flowTodoFile, lines.slice(-Math.floor(MAX_FLOW_TODOS / 2)).join("\n") + "\n");
      }
    } catch {
    }
    console.error(`[flow-enforcer] \u{1F4CB} Extracted ${todos.length} TODO(s) from ${filePath} \u2192 flow-todo-queue.jsonl`);
    return todos.length;
  } catch {
    return 0;
  }
}
function getFlowTodos() {
  try {
    const flowTodoFile = getFlowTodoFile();
    if (!existsSync(flowTodoFile))
      return [];
    const raw = readFileSync(flowTodoFile, "utf-8").trim();
    if (!raw)
      return [];
    return raw.split("\n").filter(Boolean).map((line) => safeJsonParse(line)).filter(Boolean);
  } catch {
    return [];
  }
}
function syncFlowTodosToNative(upsertFn) {
  const entries = getFlowTodos();
  let count = 0;
  for (const entry of entries) {
    for (const todo of entry.todos || []) {
      const priority = todo.type === "FIXME" ? "high" : todo.type === "HACK" ? "medium" : "low";
      if (upsertFn) {
        upsertFn({
          content: `[${todo.type}] ${todo.text}`,
          filePath: entry.filePath || "",
          priority,
          source: "flow"
        });
      }
      count++;
    }
  }
  return count;
}
var __dirname2, RULES_PATH, GUARD_AGENTS_TEMPLATE, GUARD_README_TEMPLATE, FLOW_DEDUP_FILE, MAX_FLOW_TODOS, _flowWarnsSeen, _stateWriter, _cachedRules, _rulesMtime;
var init_flow_enforcer = __esm({
  "src/vibeOS-lib/flow-enforcer.js"() {
    "use strict";
    __dirname2 = dirname(fileURLToPath(import.meta.url));
    RULES_PATH = join(__dirname2, "flow-rules.json");
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
    FLOW_DEDUP_FILE = join(process.env.HOME || homedir(), ".claude/.flow-dedup-keys.json");
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
import { readFileSync as readFileSync15, writeFileSync as writeFileSync13, existsSync as existsSync15, mkdirSync as mkdirSync12, copyFileSync as copyFileSync5, renameSync as renameSync6 } from "node:fs";
import { join as join16, dirname as dirname8, basename as basename8 } from "node:path";
import { homedir as homedir10 } from "node:os";
import { spawn as spawn2 } from "node:child_process";

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

// src/index.ts
import { createMcpServer } from "vibeOScore/mcp-server";

// src/lib/api-client.js
import { VibeOSApiClient } from "vibeOScore/client";
import { readFileSync as readFileSync2, writeFileSync as writeFileSync2, existsSync as existsSync2, mkdirSync as mkdirSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { homedir as homedir2 } from "node:os";

// src/lib/runtime-state.js
var RUNTIME_KEY = "__vibeOSRuntimeState";
function getRuntimeState() {
  const g = globalThis;
  if (!g[RUNTIME_KEY]) {
    g[RUNTIME_KEY] = {
      apiConnected: false,
      apiFallbackMode: false,
      apiFallbackSince: null,
      sessionId: "opencode-" + (process.pid || "x") + "-" + Date.now()
    };
  }
  return g[RUNTIME_KEY];
}
function getOcSessionId() {
  return getRuntimeState().sessionId;
}
function markApiConnected() {
  const state = getRuntimeState();
  state.apiConnected = true;
  state.apiFallbackMode = false;
  state.apiFallbackSince = null;
}
function markApiDisconnected() {
  const state = getRuntimeState();
  state.apiConnected = false;
  state.apiFallbackMode = true;
  if (!state.apiFallbackSince)
    state.apiFallbackSince = (/* @__PURE__ */ new Date()).toISOString();
}
function resetApiConnection() {
  const state = getRuntimeState();
  state.apiConnected = false;
  state.apiFallbackMode = false;
  state.apiFallbackSince = null;
}
function isApiConnected2() {
  const state = getRuntimeState();
  return state.apiConnected && !state.apiFallbackMode;
}

// src/lib/api-client.js
var VIBEOS_API_URL = process.env.VIBEOS_API_URL || "https://api.vibetheog.com";
var _apiDir = typeof __dirname !== "undefined" ? __dirname : dirname2(fileURLToPath2(import.meta.url));
var _envPaths = [homedir2() + "/.claude", _apiDir, process.cwd(), homedir2()];
function readTokenFromDisk() {
  for (const dir of _envPaths) {
    try {
      const env = readFileSync2(dir + "/.env.production", "utf8");
      const m = env.match(/^VIBEOS_API_TOKEN=(.+)$/m);
      if (m)
        return m[1].trim();
    } catch {
    }
  }
  return "";
}
var VIBEOS_API_TOKEN = readTokenFromDisk() || process.env.VIBEOS_API_TOKEN || "";
var VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN;
function setApiToken(newToken) {
  try {
    VIBEOS_API_TOKEN = String(newToken || "").trim();
    VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN;
    const primaryPath = _envPaths[0] + "/.env.production";
    try {
      if (existsSync2(primaryPath)) {
        let envContent = readFileSync2(primaryPath, "utf8");
        if (/^VIBEOS_API_TOKEN=/m.test(envContent)) {
          envContent = envContent.replace(/^VIBEOS_API_TOKEN=.+$/m, `VIBEOS_API_TOKEN=${VIBEOS_API_TOKEN}`);
        } else {
          envContent = envContent.trimEnd() + `
VIBEOS_API_TOKEN=${VIBEOS_API_TOKEN}
`;
        }
        writeFileSync2(primaryPath, envContent, "utf8");
      } else {
        const parentDir = _envPaths[0];
        if (!existsSync2(parentDir))
          mkdirSync2(parentDir, { recursive: true });
        writeFileSync2(primaryPath, `VIBEOS_API_TOKEN=${VIBEOS_API_TOKEN}
`, "utf8");
      }
    } catch (diskErr) {
      console.error("[vibeOS] Failed to persist API token to disk:", diskErr.message);
    }
    console.error("[vibeOS] API token updated via setApiToken");
  } catch (e) {
    console.error("[vibeOS] Failed to update API token:", e.message);
  }
}
var _apiClient = null;
var _apiFallbackMode = false;
var _apiFallbackSince = null;
function syncApiTokenFromDisk() {
  const diskToken = readTokenFromDisk() || "";
  const envToken = process.env.VIBEOS_API_TOKEN || "";
  if (diskToken && diskToken !== VIBEOS_API_TOKEN) {
    VIBEOS_API_TOKEN = diskToken;
    VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN;
    _apiClient = null;
    _apiFallbackMode = false;
    _apiFallbackSince = null;
    resetApiConnection();
    console.error("[vibeOS] API token synced from disk (disk is newer)");
  } else if (!diskToken && VIBEOS_API_TOKEN) {
    const primaryPath = _envPaths[0] + "/.env.production";
    try {
      if (existsSync2(primaryPath)) {
        let envContent = readFileSync2(primaryPath, "utf8");
        if (/^VIBEOS_API_TOKEN=/m.test(envContent)) {
          envContent = envContent.replace(/^VIBEOS_API_TOKEN=.+$/m, `VIBEOS_API_TOKEN=${VIBEOS_API_TOKEN}`);
        } else {
          envContent = envContent.trimEnd() + `
VIBEOS_API_TOKEN=${VIBEOS_API_TOKEN}
`;
        }
        writeFileSync2(primaryPath, envContent, "utf8");
      } else {
        const parentDir = _envPaths[0];
        if (!existsSync2(parentDir))
          mkdirSync2(parentDir, { recursive: true });
        writeFileSync2(primaryPath, `VIBEOS_API_TOKEN=${VIBEOS_API_TOKEN}
`, "utf8");
      }
      console.error("[vibeOS] API token persisted to disk from memory (disk was empty)");
    } catch (diskErr) {
      console.error("[vibeOS] Failed to persist API token to disk from sync:", diskErr.message);
    }
    VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN;
  } else if (envToken && !diskToken && !VIBEOS_API_TOKEN) {
    VIBEOS_API_TOKEN = envToken;
    VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN;
    console.error("[vibeOS] API token loaded from VIBEOS_API_TOKEN env var");
  } else {
    VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN;
  }
}
function getApiClient() {
  syncApiTokenFromDisk();
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
function isApiConnected3() {
  return VIBEOS_API_ENABLED && !_apiFallbackMode;
}
async function remoteCall(method, args, fallbackFn) {
  syncApiTokenFromDisk();
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
    markApiConnected();
    return result;
  } catch (err) {
    if (!_apiFallbackMode) {
      _apiFallbackMode = true;
      _apiFallbackSince = (/* @__PURE__ */ new Date()).toISOString();
      console.error(`[vibeOS] API fallback activated: ${err.message}`);
    }
    markApiDisconnected();
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

// src/lib/pricing.js
import { readFileSync as readFileSync5, writeFileSync as writeFileSync5, appendFileSync as appendFileSync4, existsSync as existsSync5, mkdirSync as mkdirSync5, statSync as statSync4, copyFileSync as copyFileSync3, renameSync as renameSync4, openSync as openSync2, closeSync as closeSync2, rmSync as rmSync2, readdirSync as readdirSync2 } from "node:fs";
import { join as join4, dirname as dirname4, basename as basename4 } from "node:path";
import { homedir as homedir5, tmpdir as tmpdir3 } from "node:os";
import { createHash as createHash2 } from "node:crypto";

// src/lib/state.js
import { readFileSync as readFileSync4, writeFileSync as writeFileSync4, appendFileSync as appendFileSync3, existsSync as existsSync4, mkdirSync as mkdirSync4, statSync as statSync3, readdirSync, openSync, readSync, closeSync, rmSync, copyFileSync as copyFileSync2, renameSync as renameSync3 } from "node:fs";
import { join as join3, dirname as dirname3, basename as basename3 } from "node:path";
import { spawn } from "node:child_process";
import { homedir as homedir4, tmpdir as tmpdir2 } from "node:os";
import { createHash } from "node:crypto";

// src/lib/selection-manager.js
import { readFileSync as readFileSync3, writeFileSync as writeFileSync3, appendFileSync as appendFileSync2, existsSync as existsSync3, mkdirSync as mkdirSync3, statSync as statSync2, copyFileSync, renameSync as renameSync2 } from "node:fs";
import { join as join2, basename } from "node:path";
import { homedir as homedir3, tmpdir } from "node:os";
var USER_HOME = (() => {
  try {
    return homedir3();
  } catch {
    return tmpdir();
  }
})();
function _handleStateCorruption(path) {
  const backupDir = join2(USER_HOME, ".claude", ".backups");
  mkdirSync3(backupDir, { recursive: true });
  const backupPath = join2(backupDir, basename(path) + ".corrupted." + Date.now());
  try {
    copyFileSync(path, backupPath);
  } catch {
  }
  const logPath = join2(USER_HOME, ".claude", ".state-corruption-log.jsonl");
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
var DFLT_SEL = { enabled: true, active_slot: null, thinking_level: "off", flow_enabled: false, tdd_enforce: false, tdd_strict: false, tdd_quality: true, flow_enforce: false, delegation_enforce: true };
var TIERS_FILE = join2(USER_HOME, ".claude/model-tiers.json");
function loadSelection() {
  try {
    if (!existsSync3(TIERS_FILE))
      return DFLT_SEL;
    const st = statSync2(TIERS_FILE);
    if (st.size > 10485760) {
      _handleStateCorruption(TIERS_FILE);
      return DFLT_SEL;
    }
    const j = safeJsonParse2(readFileSync3(TIERS_FILE, "utf-8"));
    return {
      enabled: j?.selection?.enabled !== false,
      active_slot: j?.selection?.active_slot || null,
      thinking_level: j?.selection?.thinking_level || "off",
      flow_enabled: j?.selection?.flow_enabled === true,
      tdd_enforce: j?.selection?.tdd_enforce === true,
      tdd_strict: j?.selection?.tdd_strict === true,
      tdd_quality: j?.selection?.tdd_quality !== false,
      flow_enforce: j?.selection?.flow_enforce === true,
      delegation_enforce: true
    };
  } catch {
    _handleStateCorruption(TIERS_FILE);
    return DFLT_SEL;
  }
}
function writeSelection(key, value) {
  try {
    const j = safeJsonParse2(readFileSync3(TIERS_FILE, "utf-8"));
    if (!j.selection)
      j.selection = {};
    j.selection[key] = key === "delegation_enforce" ? true : value;
    const tmp = TIERS_FILE + ".tmp";
    writeFileSync3(tmp, JSON.stringify(j, null, 2) + "\n");
    renameSync2(tmp, TIERS_FILE);
    return true;
  } catch (err) {
    console.error(`[vibeOS] writeSelection failed: ${err.message}`);
    return false;
  }
}
var BLACKBOX_FILE = join2(USER_HOME, ".claude/blackbox-state.json");
function loadSessionSlot(sid) {
  try {
    if (!existsSync3(BLACKBOX_FILE))
      return null;
    const j = safeJsonParse2(readFileSync3(BLACKBOX_FILE, "utf-8"));
    return j?.sessions?.[sid]?.active_slot || null;
  } catch {
    return null;
  }
}
function writeSessionSlot2(sid, slot) {
  try {
    const j = existsSync3(BLACKBOX_FILE) ? safeJsonParse2(readFileSync3(BLACKBOX_FILE, "utf-8")) : {};
    if (!j.sessions)
      j.sessions = {};
    if (!j.sessions[sid])
      j.sessions[sid] = {};
    j.sessions[sid].active_slot = slot;
    const tmp = BLACKBOX_FILE + ".tmp";
    writeFileSync3(tmp, JSON.stringify(j, null, 2) + "\n");
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
    const j = safeJsonParse2(readFileSync3(BLACKBOX_FILE, "utf-8"));
    return j?.sessions?.[sid]?.optimization_mode || null;
  } catch {
    return null;
  }
}
function writeSessionOptMode(sid, mode) {
  try {
    const j = existsSync3(BLACKBOX_FILE) ? safeJsonParse2(readFileSync3(BLACKBOX_FILE, "utf-8")) : {};
    if (!j.sessions)
      j.sessions = {};
    if (!j.sessions[sid])
      j.sessions[sid] = {};
    j.sessions[sid].optimization_mode = mode;
    const tmp = BLACKBOX_FILE + ".tmp";
    writeFileSync3(tmp, JSON.stringify(j, null, 2) + "\n");
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
    sesRatePerHour: Number((((session?.warns?.reduce((sum, w) => sum + Number(w?.est_savings_usd || 0), 0) || 0) + Number(session?.cache_savings_usd || 0)) / hours).toFixed(4)),
    sesTrend: "stable",
    sesToolBreakdown: toolBreakdown,
    sesModelTurns: session?.model_turns || { brain: 0, worker: 0 },
    quality_avg: state?.lifetime?.quality_total_count > 0 ? Math.round((state?.lifetime?.quality_total_score || 0) / state?.lifetime?.quality_total_count) : 0
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
    return homedir4();
  } catch {
    return tmpdir2();
  }
})();
var FILE_LOCK_DIR = join3(USER_HOME2, ".claude/.vibeOS-locks");
var DELEGATION_STATE_FILE = join3(USER_HOME2, ".claude/delegation-state.json");
var SAVINGS_LEDGER_FILE = join3(USER_HOME2, ".claude/savings-ledger.jsonl");
var GLOBAL_LEARNING_FILE = join3(USER_HOME2, ".claude/global-learning.json");
var PRICING_CACHE_FILE = join3(USER_HOME2, ".claude/model-pricing-cache.json");
var BLACKBOX_STATE_FILE = join3(USER_HOME2, ".claude/blackbox-state.json");
var PROJECT_STATE_FILE = join3(USER_HOME2, ".claude/project-states.json");
var TIERS_FILE2 = join3(USER_HOME2, ".claude/model-tiers.json");
var ACTIVE_JOBS_FILE = join3(USER_HOME2, ".claude/active-jobs.json");
var AUTH_F = join3(USER_HOME2, ".local", "share", "opencode", "auth.json");
var CREDIT_CACHE_F = join3(USER_HOME2, ".claude/credit-snapshot.json");
var FLOW_TODO_QUEUE_FILE = join3(USER_HOME2, ".claude/.flow-todo-queue.jsonl");
var FLOW_DEDUP_FILE2 = join3(USER_HOME2, ".claude/.flow-dedup-keys.json");
var ENFORCEMENT_COOLDOWN_FILE = join3(USER_HOME2, ".claude/.enforcement-cooldown.jsonl");
var TODOS_FILE = join3(USER_HOME2, ".claude/todos.json");
var REPORTS_DIR = join3(USER_HOME2, ".claude/reports");
var CONTEXT7_INSTALL_FLAG = join3(USER_HOME2, ".claude/.context7-install-suggested");
var TRINITY_OPENCODE_CONFIG = join3(USER_HOME2, ".config/opencode/opencode.json");
var TRINITY_OPENCODE_CONFIGC = join3(USER_HOME2, ".config/opencode/opencode.jsonc");
var SCRATCHPAD_ROOT = join3(USER_HOME2, ".claude/scratch");
var SCRATCHPAD_GLOBAL_DIR = join3(SCRATCHPAD_ROOT, "by-hash");
var SCRATCHPAD_SESSIONS_DIR = join3(SCRATCHPAD_ROOT, "sessions");
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
var _OC_SID = getOcSessionId();
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
function setCurrentProjectFingerprint(v) {
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
var _lockedSlot = null;
var _lockedModel = null;
var _patternFiredKeys = /* @__PURE__ */ new Set();
var _sessionCleanupRegistered = false;
var _sessionCacheCleaned = false;
var prunedThisProcess = false;
var _lastDecadenceRun = 0;
var briefedProjects = /* @__PURE__ */ new Set();
var _ledgerBuffer = [];
var _ledgerBufferTimer = null;
function setLedgerBufferTimer(val) {
  _ledgerBufferTimer = val;
}
var LEDGER_BUFFER_MAX = 10;
var LEDGER_BUFFER_FLUSH_MS = 5e3;
var testReminderSeen = /* @__PURE__ */ new Set();
var DFLT_GL = {
  exploratory_words: {},
  task_first_words: {},
  context7_bypasses: 0,
  context7_missed_usd: 0,
  context7_last_seen: null,
  updatedAt: null
};
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
  const backupDir = join3(USER_HOME2, ".claude", ".backups");
  mkdirSync4(backupDir, { recursive: true });
  const backupPath = join3(backupDir, basename3(path) + ".corrupted." + Date.now());
  try {
    copyFileSync2(path, backupPath);
  } catch {
  }
  const logPath = join3(USER_HOME2, ".claude", ".state-corruption-log.jsonl");
  try {
    appendFileSync3(logPath, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), path, backup: backupPath }) + "\n");
  } catch {
  }
}
function _lockPathFor(filePath) {
  const hash = createHash("sha1").update(String(filePath || "")).digest("hex");
  return join3(FILE_LOCK_DIR, `${hash}.lock`);
}
function withFileLock(filePath, fn, opts = {}) {
  const staleMs = Number(opts.staleMs || 3e4);
  const timeoutMs = Number(opts.timeoutMs || 2e3);
  const lockPath = _lockPathFor(filePath);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      mkdirSync4(FILE_LOCK_DIR, { recursive: true });
      const fd = openSync(lockPath, "wx");
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
          const age = Date.now() - statSync3(lockPath).mtimeMs;
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
  } catch {
    return null;
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
    const st = statSync3(filePath);
    if (st.size > 10485760) {
      _handleStateCorruption2(filePath);
      return {};
    }
    return safeJsonParse3(readFileSync4(filePath, "utf-8"));
  } catch {
    _handleStateCorruption2(filePath);
    return {};
  }
}
function updateState(mutator) {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
        mkdirSync4(dirname3(DELEGATION_STATE_FILE), { recursive: true });
        const tmp = DELEGATION_STATE_FILE + ".tmp";
        writeFileSync4(tmp, JSON.stringify(next, null, 2) + "\n");
        renameSync3(tmp, DELEGATION_STATE_FILE);
        return next;
      });
      return result;
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) {
        console.error(`[vibeOS] updateState failed after ${MAX_RETRIES} retries: ${err.message}`);
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
    const st = statSync3(DELEGATION_STATE_FILE);
    if (st.size > 10485760) {
      _handleStateCorruption2(DELEGATION_STATE_FILE);
      return {};
    }
    return safeJsonParse3(readFileSync4(DELEGATION_STATE_FILE, "utf-8"));
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
    const p = join3(USER_HOME2, ".claude/model-tiers.json");
    if (!existsSync4(p))
      return { high: FALLBACK_HIGH, mid: FALLBACK_MID };
    const j = safeJsonParse3(readFileSync4(p, "utf-8"));
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
    const st = statSync3(GLOBAL_LEARNING_FILE);
    if (st.size > 10485760) {
      _handleStateCorruption2(GLOBAL_LEARNING_FILE);
      return DFLT_GL;
    }
    const j = safeJsonParse3(readFileSync4(GLOBAL_LEARNING_FILE, "utf-8"));
    if (!j || typeof j !== "object")
      return DFLT_GL;
    j.exploratory_words ??= {};
    j.task_first_words ??= {};
    j.context7_bypasses ??= 0;
    j.context7_missed_usd ??= 0;
    j.context7_last_seen ??= null;
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
    mkdirSync4(dirname3(GLOBAL_LEARNING_FILE), { recursive: true });
    const tmp = GLOBAL_LEARNING_FILE + ".tmp";
    writeFileSync4(tmp, JSON.stringify(next, null, 2));
    renameSync3(tmp, GLOBAL_LEARNING_FILE);
    return next;
  });
}
function getLearnedExploratoryWords() {
  const out = /* @__PURE__ */ new Set();
  try {
    const gl = loadGlobalLearning();
    for (const [w, meta] of Object.entries(gl.exploratory_words || {})) {
      if (meta?.count >= 1)
        out.add(String(w));
    }
  } catch {
  }
  return out;
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
function loadBlackboxState() {
  try {
    if (!existsSync4(BLACKBOX_STATE_FILE))
      return { enabled: true, sessions: {} };
    const st = statSync3(BLACKBOX_STATE_FILE);
    if (st.size > 10485760) {
      _handleStateCorruption2(BLACKBOX_STATE_FILE);
      return { enabled: false, sessions: {} };
    }
    return safeJsonParse3(readFileSync4(BLACKBOX_STATE_FILE, "utf-8")) || { enabled: false, sessions: {} };
  } catch {
    _handleStateCorruption2(BLACKBOX_STATE_FILE);
    return { enabled: false, sessions: {} };
  }
}
function saveBlackboxState(state) {
  try {
    mkdirSync4(dirname3(BLACKBOX_STATE_FILE), { recursive: true });
    const tmp = BLACKBOX_STATE_FILE + ".tmp";
    writeFileSync4(tmp, JSON.stringify(state, null, 2) + "\n");
    renameSync3(tmp, BLACKBOX_STATE_FILE);
  } catch (err) {
    console.error(`[vibeOS] saveBlackboxState failed: ${err.message}`);
  }
}
function getSessionRoot() {
  return join3(SCRATCHPAD_SESSIONS_DIR, _OC_SID);
}
function getSessionScratchpadDir() {
  return join3(getSessionRoot(), "by-hash");
}
function getSessionIndexPath() {
  return join3(getSessionRoot(), "index.jsonl");
}
function getGlobalIndexPath() {
  return join3(SCRATCHPAD_ROOT, "index.jsonl");
}
function ensureSessionScratchpadDirs() {
  try {
    mkdirSync4(getSessionScratchpadDir(), { recursive: true });
    return true;
  } catch {
    return false;
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
function _newTelemetryBucket() {
  return {
    events: 0,
    tool_counts: {},
    tier_counts: {},
    slot_counts: {},
    kind_counts: {},
    prompt_size_buckets: {},
    output_size_buckets: {},
    duration_buckets: {},
    result_counts: {},
    cache_hit_counts: { hit: 0, miss: 0 },
    enforcement_counts: {},
    flow_counts: {},
    tdd_counts: {},
    storage_bytes_estimate: 0,
    retained_sessions: 0,
    last_seen: null,
    last_compacted_at: null
  };
}
function _incBucket(map, key, delta = 1) {
  const bucket = String(key || "unknown");
  map[bucket] = Number(map[bucket] || 0) + delta;
}
function _telemetrySizeEstimate(telemetry) {
  try {
    return Buffer.byteLength(JSON.stringify(telemetry || {}), "utf8");
  } catch {
    return 0;
  }
}
function recordPrivacyTelemetry(event) {
  try {
    if (!event || typeof event !== "object")
      return null;
    return updateState((state) => {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      state.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" };
      state.sessions ??= {};
      const sid = String(event.session_id || _OC_SID || "unknown");
      state.sessions[sid] ??= { started: now, session_started_at: now, source: "opencode", tool_counts: {}, warns: [], cache_hits: [], seenWarnKeys: {} };
      const lifetime = state.lifetime.telemetry ??= _newTelemetryBucket();
      const session = state.sessions[sid].telemetry ??= _newTelemetryBucket();
      const tool2 = String(event.tool || "unknown").toLowerCase();
      const tier = String(event.tier || "unknown").toLowerCase();
      const slot = String(event.slot || "unknown").toLowerCase();
      const kind = String(event.kind || "unknown").toLowerCase();
      const promptSize = String(event.prompt_size_bucket || "unknown");
      const outputSize = String(event.output_size_bucket || "unknown");
      const duration = String(event.duration_bucket || "unknown");
      const result = String(event.result || "unknown").toLowerCase();
      const cache = event.cache_hit === true ? "hit" : event.cache_hit === false ? "miss" : "unknown";
      const enforcement = String(event.enforcement || "unknown").toLowerCase();
      const flow = String(event.flow || "unknown").toLowerCase();
      const tdd = String(event.tdd || "unknown").toLowerCase();
      const record = (bucket) => {
        bucket.events = Number(bucket.events || 0) + 1;
        _incBucket(bucket.tool_counts, tool2);
        _incBucket(bucket.tier_counts, tier);
        _incBucket(bucket.slot_counts, slot);
        _incBucket(bucket.kind_counts, kind);
        _incBucket(bucket.prompt_size_buckets, promptSize);
        _incBucket(bucket.output_size_buckets, outputSize);
        _incBucket(bucket.duration_buckets, duration);
        _incBucket(bucket.result_counts, result);
        _incBucket(bucket.enforcement_counts, enforcement);
        _incBucket(bucket.flow_counts, flow);
        _incBucket(bucket.tdd_counts, tdd);
        if (cache === "hit" || cache === "miss") {
          bucket.cache_hit_counts[cache] = Number(bucket.cache_hit_counts[cache] || 0) + 1;
        }
        bucket.last_seen = now;
        bucket.storage_bytes_estimate = _telemetrySizeEstimate(bucket);
      };
      record(lifetime);
      record(session);
      lifetime.retained_sessions = Object.values(state.sessions).filter((ses) => Number(ses?.telemetry?.events || 0) > 0).length;
      session.retained_sessions = 1;
      state.lifetime.last_updated = now;
      return state;
    });
  } catch {
    return null;
  }
}
function readTelemetrySummary(state, sid = _OC_SID) {
  const lifetime = state?.lifetime?.telemetry || {};
  const session = state?.sessions?.[sid]?.telemetry || {};
  return {
    lifetime_events: Number(lifetime.events || 0),
    current_session_events: Number(session.events || 0),
    storage_bytes_estimate: Number(lifetime.storage_bytes_estimate || 0),
    retained_sessions: Number(lifetime.retained_sessions || 0),
    tool_counts: lifetime.tool_counts || {},
    tier_counts: lifetime.tier_counts || {},
    slot_counts: lifetime.slot_counts || {},
    kind_counts: lifetime.kind_counts || {},
    prompt_size_buckets: lifetime.prompt_size_buckets || {},
    output_size_buckets: lifetime.output_size_buckets || {},
    duration_buckets: lifetime.duration_buckets || {},
    result_counts: lifetime.result_counts || {},
    cache_hit_counts: lifetime.cache_hit_counts || { hit: 0, miss: 0 },
    enforcement_counts: lifetime.enforcement_counts || {},
    flow_counts: lifetime.flow_counts || {},
    tdd_counts: lifetime.tdd_counts || {},
    last_seen: lifetime.last_seen || null,
    last_compacted_at: lifetime.last_compacted_at || null
  };
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
    mkdirSync4(dirname3(globalIndex), { recursive: true });
    mkdirSync4(dirname3(sessionIndex), { recursive: true });
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
    const ptrFiles = entries.filter((e) => e.endsWith(".ptr"));
    const ptrCandidates = [];
    for (const pf of ptrFiles) {
      if (ptrCandidates.length >= 50)
        break;
      try {
        const st = statSync3(join3(dir, pf));
        ptrCandidates.push({ ptrPath: join3(dir, pf), mtimeMs: st.mtimeMs });
      } catch {
      }
    }
    ptrCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const { ptrPath } of ptrCandidates) {
      try {
        const ptrData = safeJsonParse3(readFileSync4(ptrPath, "utf-8"));
        if (!ptrData?.contentHash)
          continue;
        if (titleCase && ptrData.tool && TOOL_NAME_NORMALIZE[ptrData.tool] !== titleCase)
          continue;
        const contentHash = ptrData.contentHash;
        const f = join3(dir, `${contentHash}.txt`);
        if (!existsSync4(f))
          continue;
        const st = statSync3(f);
        const ageSec = (Date.now() - st.mtimeMs) / 1e3;
        if (ageSec > SCRATCHPAD_MAX_AGE_SEC)
          continue;
        const sumPath = join3(dir, `${contentHash}.summary.txt`);
        return { hash: contentHash, fullPath: f, sizeBytes: st.size, ageSec: Math.round(ageSec), summaryPath: existsSync4(sumPath) ? sumPath : null };
      } catch {
      }
    }
    const txtFiles = entries.filter((e) => e.endsWith(".txt") && !e.endsWith(".summary.txt"));
    if (txtFiles.length === 0)
      return null;
    const candidateHashes = [];
    for (let i = txtFiles.length - 1; i >= 0; i--) {
      const f = txtFiles[i];
      if (candidateHashes.length > 50)
        break;
      candidateHashes.push(f.replace(/\.txt$/, ""));
    }
    for (const hash of candidateHashes) {
      const f = join3(dir, `${hash}.txt`);
      if (!existsSync4(f))
        continue;
      const st = statSync3(f);
      const ageSec = (Date.now() - st.mtimeMs) / 1e3;
      if (ageSec > SCRATCHPAD_MAX_AGE_SEC)
        continue;
      const sumPath = join3(dir, `${hash}.summary.txt`);
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
  const sessionPath = join3(sessionDir, `${hash}.txt`);
  const globalPath = join3(globalDir, `${hash}.txt`);
  let fullPath = existsSync4(sessionPath) ? sessionPath : existsSync4(globalPath) ? globalPath : null;
  if (!fullPath) {
    const ptrSessionPath = join3(sessionDir, `${hash}.ptr`);
    const ptrGlobalPath = join3(globalDir, `${hash}.ptr`);
    const ptrPath = existsSync4(ptrSessionPath) ? ptrSessionPath : existsSync4(ptrGlobalPath) ? ptrGlobalPath : null;
    let resolvedHash = hash;
    if (ptrPath) {
      try {
        const ptrData = safeJsonParse3(readFileSync4(ptrPath, "utf-8"));
        if (ptrData?.contentHash) {
          resolvedHash = ptrData.contentHash;
          const rSessionPath = join3(sessionDir, `${resolvedHash}.txt`);
          const rGlobalPath = join3(globalDir, `${resolvedHash}.txt`);
          fullPath = existsSync4(rSessionPath) ? rSessionPath : existsSync4(rGlobalPath) ? rGlobalPath : null;
        }
      } catch {
      }
    }
    if (!fullPath) {
      const recent = scanRecentScratchpad(sessionDir, titleCase, 2e3) || scanRecentScratchpad(globalDir, titleCase, 2e3);
      if (recent)
        return recent;
      return null;
    }
  }
  try {
    const st = statSync3(fullPath);
    const ageSec = (Date.now() - st.mtimeMs) / 1e3;
    if (ageSec > SCRATCHPAD_MAX_AGE_SEC)
      return null;
    const sessionSummaryPath = join3(sessionDir, `${hash}.summary.txt`);
    const globalSummaryPath = join3(globalDir, `${hash}.summary.txt`);
    const summaryPath = existsSync4(sessionSummaryPath) ? sessionSummaryPath : existsSync4(globalSummaryPath) ? globalSummaryPath : null;
    return {
      hash,
      fullPath,
      sizeBytes: st.size,
      ageSec: Math.round(ageSec),
      summaryPath
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
    const fullPath = join3(targetDir, entry);
    let st;
    try {
      st = statSync3(fullPath);
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
      const meta = join3(targetDir, hash + ".meta.json");
      if (existsSync4(meta))
        try {
          rmSync(meta);
        } catch {
        }
      const summary = join3(targetDir, hash + ".summary.txt");
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
      const summaryPath = join3(targetDir, hash + ".summary.txt");
      if (!existsSync4(summaryPath))
        try {
          const content = readFileSync4(fullPath, "utf-8");
          writeFileSync4(summaryPath, content.slice(0, 200).replace(/\n+/g, " ").trim() + (content.length > 200 ? "\u2026" : ""));
        } catch {
        }
      const head = _readHead(fullPath);
      if (!head.includes("[cold-storage]"))
        try {
          writeFileSync4(fullPath, `[cold-storage] ${st.size}B original \u2192 ${hash}.summary.txt`);
          rotated++;
        } catch {
        }
      continue;
    }
    if (age > DECADENCE_FRESH_MS && st.size > 1024) {
      const summaryPath = join3(targetDir, hash + ".summary.txt");
      if (!existsSync4(summaryPath))
        try {
          const content = readFileSync4(fullPath, "utf-8");
          writeFileSync4(summaryPath, content.slice(0, 500).replace(/\n+/g, " ").trim() + (content.length > 500 ? "\u2026" : ""));
        } catch {
        }
      const head = _readHead(fullPath);
      if (!head.includes("[warm-storage]") && !head.includes("[cold-storage]"))
        try {
          writeFileSync4(fullPath, `[warm-storage] ${st.size}B original at ${hash}.summary.txt`);
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
}
function cleanupStaleSessionScratchpads() {
  try {
    if (!existsSync4(SCRATCHPAD_SESSIONS_DIR))
      return;
    const dirs = readdirSync(SCRATCHPAD_SESSIONS_DIR);
    const now = Date.now();
    for (const d of dirs) {
      const full = join3(SCRATCHPAD_SESSIONS_DIR, d);
      try {
        const st = statSync3(full);
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
    const script = join3(USER_HOME2, ".claude/hooks/scratchpad-prune.sh");
    if (existsSync4(script)) {
      const child = spawn("bash", [script], { detached: true, stdio: "ignore" });
      child.unref();
    }
  } catch {
  }
  cleanupStaleSessionScratchpads();
}
function loadActiveJobs() {
  try {
    if (!existsSync4(ACTIVE_JOBS_FILE))
      return {};
    const st = statSync3(ACTIVE_JOBS_FILE);
    if (st.size > 10485760) {
      _handleStateCorruption2(ACTIVE_JOBS_FILE);
      return {};
    }
    const raw = safeJsonParse3(readFileSync4(ACTIVE_JOBS_FILE, "utf-8"));
    if (!raw || typeof raw !== "object")
      return {};
    return raw;
  } catch {
    _handleStateCorruption2(ACTIVE_JOBS_FILE);
    return {};
  }
}
function getActiveJobForProject(fp2 = currentProjectFingerprint) {
  if (!fp2)
    return null;
  const jobs = loadActiveJobs();
  const job = jobs[fp2];
  if (!job || typeof job !== "object")
    return null;
  return job;
}
function saveActiveJobForProject(job, fp2 = currentProjectFingerprint) {
  if (!fp2 || !job || typeof job !== "object")
    return;
  try {
    const jobs = loadActiveJobs();
    jobs[fp2] = job;
    mkdirSync4(dirname3(ACTIVE_JOBS_FILE), { recursive: true });
    const tmp = ACTIVE_JOBS_FILE + ".tmp";
    writeFileSync4(tmp, JSON.stringify(jobs, null, 2));
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
      mkdirSync4(dirname3(PROJECT_STATE_FILE), { recursive: true });
      const _tmp = PROJECT_STATE_FILE + ".tmp." + Date.now();
      writeFileSync4(_tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
      renameSync3(_tmp, PROJECT_STATE_FILE);
    });
  } catch (err) {
    console.error(`[vibeOS] project state write failed: ${err.message}`);
  }
}
function ensureProjectBucket(state, fp2) {
  state.project_hashes ??= {};
  if (!state.project_hashes[fp2]) {
    state.project_hashes[fp2] = {
      totalSessions: 0,
      researchChains: 0,
      context7Bypasses: 0,
      commonTopics: [],
      techStack: detectTechStack(process.cwd())
    };
  }
  return state.project_hashes[fp2];
}
function detectTechStack(dir) {
  const stacks = [];
  try {
    const pkg = safeJsonParse3(readFileSync4(join3(dir, "package.json"), "utf-8"));
    if (pkg) {
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript || existsSync4(join3(dir, "tsconfig.json")))
        stacks.push("typescript");
      if (pkg.dependencies?.react || pkg.devDependencies?.react)
        stacks.push("react");
      stacks.push("javascript");
    }
  } catch {
  }
  try {
    if (existsSync4(join3(dir, "Cargo.toml")))
      stacks.push("rust");
  } catch {
  }
  try {
    if (existsSync4(join3(dir, "go.mod")))
      stacks.push("go");
  } catch {
  }
  try {
    if (existsSync4(join3(dir, "requirements.txt")))
      stacks.push("python");
    if (existsSync4(join3(dir, "setup.py")))
      stacks.push("python");
    if (existsSync4(join3(dir, "pyproject.toml")))
      stacks.push("python");
  } catch {
  }
  return [...new Set(stacks)];
}
function promotedProjectPatterns(fp2) {
  try {
    const p = loadProjectState().project_hashes?.[fp2];
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
function projectPatternRows(fp2) {
  try {
    const p = loadProjectState().project_hashes?.[fp2];
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
function clearProjectPatterns(fp2) {
  try {
    const pstate = loadProjectState();
    const bucket = pstate.project_hashes?.[fp2];
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
var STATE_FILE = DELEGATION_STATE_FILE;
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
      s.sessions ??= {};
      const sid = _OC_SID;
      s.sessions[sid] ??= { total_savings_usd: 0, cache_savings_usd: 0, project_name: "", warns: [], cache_hits: [], seenWarnKeys: {} };
      s.sessions[sid].context7_missed_usd = Math.round(((s.sessions[sid].context7_missed_usd || 0) + saveEst) * 100) / 100;
      return s;
    });
    try {
      _ledgerBuffer.push(JSON.stringify({
        v: 2,
        at: (/* @__PURE__ */ new Date()).toISOString(),
        kind: "context7",
        amount_usd: Number(saveEst || 0),
        sid: _OC_SID,
        tool: "context7",
        reason: "docs bypass"
      }) + "\n");
      if (_ledgerBuffer.length >= LEDGER_BUFFER_MAX)
        _flushLedgerBuffer();
      else if (!_ledgerBufferTimer)
        _ledgerBufferTimer = setTimeout(_flushLedgerBuffer, LEDGER_BUFFER_FLUSH_MS);
    } catch {
    }
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
    try {
      updateGlobalLearning((gl) => {
        gl.context7_bypasses = Number(gl.context7_bypasses || 0) + 1;
        gl.context7_missed_usd = Math.round((Number(gl.context7_missed_usd || 0) + Number(saveEst || 0)) * 100) / 100;
        gl.context7_last_seen = (/* @__PURE__ */ new Date()).toISOString();
        return gl;
      });
    } catch {
    }
    return state?.lifetime?.missed_context7_usd ?? null;
  } catch {
    return null;
  }
}
function loadTodos() {
  try {
    if (!existsSync4(TODOS_FILE))
      return [];
    const raw = readFileSync4(TODOS_FILE, "utf-8");
    const parsed = safeJsonParse3(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveTodos(todos) {
  try {
    mkdirSync4(dirname3(TODOS_FILE), { recursive: true });
    const tmp = TODOS_FILE + ".tmp." + Date.now();
    writeFileSync4(tmp, JSON.stringify(todos, null, 2), "utf-8");
    renameSync3(tmp, TODOS_FILE);
  } catch {
  }
}
function upsertTodo(entry) {
  const todos = loadTodos();
  const existing = todos.findIndex((t) => t.content === entry.content && (entry.filePath ? t.filePath === entry.filePath : true));
  const newEntry = {
    id: entry.id || crypto.randomUUID?.() || "todo-" + Date.now(),
    content: entry.content,
    status: entry.status || "pending",
    filePath: entry.filePath || "",
    priority: entry.priority || "medium",
    source: entry.source || "manual",
    createdAt: entry.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (existing >= 0) {
    todos[existing] = { ...todos[existing], ...newEntry, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  } else {
    todos.push(newEntry);
  }
  saveTodos(todos);
}
function markTodoDone(id2) {
  const todos = loadTodos();
  const found = todos.find((t) => t.id === id2);
  if (found) {
    found.status = "done";
    found.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    saveTodos(todos);
  }
}
function getTodos() {
  return loadTodos();
}
function readLedgerTotals() {
  const empty = { delegation: 0, cache: 0, context7: 0, total: 0, entries: 0 };
  try {
    if (!existsSync4(SAVINGS_LEDGER_FILE))
      return empty;
    const raw = readFileSync4(SAVINGS_LEDGER_FILE, "utf-8");
    if (!raw.trim())
      return empty;
    let delegation = 0;
    let cache = 0;
    let context7 = 0;
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
      else if (kind.includes("context7"))
        context7 += amt;
      else
        delegation += amt;
    }
    const total = delegation + cache;
    return {
      delegation: Math.round(delegation * 1e3) / 1e3,
      cache: Math.round(cache * 1e3) / 1e3,
      context7: Math.round(context7 * 1e3) / 1e3,
      total: Math.round(total * 1e3) / 1e3,
      entries
    };
  } catch {
    return empty;
  }
}
function reconcileStateFromLedger() {
  try {
    const ledgerMtime = existsSync4(SAVINGS_LEDGER_FILE) ? statSync3(SAVINGS_LEDGER_FILE).mtimeMs : 0;
    if (ledgerMtime === _ledgerReconciledMtime)
      return;
    _ledgerReconciledMtime = ledgerMtime;
    _flushLedgerBuffer();
    const l = readLedgerTotals();
    if (l.total <= 0 && l.context7 <= 0)
      return;
    const state = readJsonOrEmpty(DELEGATION_STATE_FILE);
    const stDelegation = Number(state?.lifetime?.est_savings_usd ?? state?.lifetime?.total_savings_usd ?? 0);
    const stCache = Number(state?.lifetime?.cache_savings_usd ?? 0);
    const stMissedC7 = Number(state?.lifetime?.missed_context7_usd ?? 0);
    const stTotal = (Number.isFinite(stDelegation) ? stDelegation : 0) + (Number.isFinite(stCache) ? stCache : 0);
    if (Math.abs(stTotal - l.total) < 5e-4 && Math.abs(stMissedC7 - l.context7) < 5e-4)
      return;
    updateState((s) => {
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" };
      s.lifetime.total_savings_usd = Math.max(l.delegation, stDelegation);
      s.lifetime.cache_savings_usd = Math.max(l.cache, stCache);
      s.lifetime.missed_context7_usd = Math.max(l.context7, stMissedC7);
      s.lifetime.last_updated = (/* @__PURE__ */ new Date()).toISOString();
      s.lifetime.rebuilt_from_ledger = true;
      s.lifetime.ledger_entries_reconciled = l.entries;
      return s;
    });
  } catch {
  }
}
function readLifetimeSavings() {
  const empty = { ltTasks: 0, ltCache: 0, ltCost: 0, count: 0, scratchpadHits: 0, missedC7: 0, sesTasks: 0, sesEdit: 0, sesCredit: 0, sesC7: 0, sesQuota: 0, sesTaskDelegations: 0, sesDuration: 0, sesRatePerHour: 0, sesTrend: "stable", sesToolBreakdown: {}, sesModelTurns: { brain: 0, worker: 0 }, quality_avg: 0, telemetry: readTelemetrySummary({}, _OC_SID) };
  try {
    reconcileStateFromLedger();
    if (!existsSync4(DELEGATION_STATE_FILE))
      return empty;
    const mtime = statSync3(DELEGATION_STATE_FILE).mtimeMs;
    if (_savingsCache && mtime === _savingsCacheMtime)
      return _savingsCache;
    const s = safeJsonParse3(readFileSync4(DELEGATION_STATE_FILE, "utf-8"));
    _savingsCache = { ..._computeSessionMetrics(s, _OC_SID), telemetry: readTelemetrySummary(s, _OC_SID) };
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
    const cpPath = join3(getSessionRoot(), "checkpoint.json");
    mkdirSync4(dirname3(cpPath), { recursive: true });
    const tmp = cpPath + ".tmp";
    writeFileSync4(tmp, JSON.stringify(cp, null, 2) + "\n");
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
    return homedir5();
  } catch {
    return tmpdir3();
  }
})();
function _handleStateCorruption3(path) {
  const backupDir = join4(USER_HOME3, ".claude", ".backups");
  mkdirSync5(backupDir, { recursive: true });
  const backupPath = join4(backupDir, basename4(path) + ".corrupted." + Date.now());
  try {
    copyFileSync3(path, backupPath);
  } catch {
  }
  const logPath = join4(USER_HOME3, ".claude", ".state-corruption-log.jsonl");
  try {
    appendFileSync4(logPath, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), path, backup: backupPath }) + "\n");
  } catch {
  }
}
var FILE_LOCK_DIR2 = join4(USER_HOME3, ".claude/.vibeOS-locks");
var PRICING_CACHE_FILE2 = join4(USER_HOME3, ".claude/model-pricing-cache.json");
function _lockPathFor2(filePath) {
  const hash = createHash2("sha1").update(String(filePath || "")).digest("hex");
  return join4(FILE_LOCK_DIR2, `${hash}.lock`);
}
function withFileLock2(filePath, fn, opts = {}) {
  const staleMs = Number(opts.staleMs || 3e4);
  const timeoutMs = Number(opts.timeoutMs || 2e3);
  const lockPath = _lockPathFor2(filePath);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      mkdirSync5(FILE_LOCK_DIR2, { recursive: true });
      const fd = openSync2(lockPath, "wx");
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
          const age = Date.now() - statSync4(lockPath).mtimeMs;
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
function classify(m) {
  const s = String(m || "").toLowerCase();
  if (HIGH_TIER_RE.test(s))
    return "high";
  if (MID_TIER_RE.test(s))
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
var FREE_MODELS = /* @__PURE__ */ new Set([]);
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
  "deepseek/deepseek-v4-flash": 0.00013,
  "deepseek/deepseek-chat": 182e-6,
  "deepseek-chat": 182e-6,
  "deepseek/deepseek-v3": 182e-6,
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
    const st = statSync4(PRICING_CACHE_FILE2);
    if (st.size > 10485760) {
      _handleStateCorruption3(PRICING_CACHE_FILE2);
      _dynamicPricingCache = {};
      return {};
    }
    const raw = safeJsonParse3(readFileSync5(PRICING_CACHE_FILE2, "utf-8"));
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
      mkdirSync5(dirname4(PRICING_CACHE_FILE2), { recursive: true });
      const tmp = PRICING_CACHE_FILE2 + ".tmp";
      writeFileSync5(tmp, JSON.stringify({
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
  join4(USER_HOME3, ".claude/settings.json"),
  join4(USER_HOME3, ".claude.json"),
  join4(USER_HOME3, ".config/opencode/opencode.json"),
  join4(process.cwd(), "opencode.json")
];
function _scanOpenCodeConfigs(baseDir) {
  try {
    if (!existsSync5(baseDir))
      return;
    for (const entry of readdirSync2(baseDir)) {
      if (!entry.endsWith(".json"))
        continue;
      const full = join4(baseDir, entry);
      if (existsSync5(full) && /context7/i.test(readFileSync5(full, "utf-8")))
        return true;
    }
  } catch {
  }
  return false;
}
function _context7InPath() {
  try {
    const pathDirs = (process.env.PATH || "").split(":");
    for (const dir of pathDirs) {
      if (!dir)
        continue;
      try {
        if (existsSync5(join4(dir, "context7")))
          return true;
        if (existsSync5(join4(dir, "context7.cmd")))
          return true;
      } catch {
      }
    }
  } catch {
  }
  return false;
}
function _context7InNpmCache() {
  try {
    const npxDir = join4(USER_HOME3, ".npm/_npx");
    if (!existsSync5(npxDir))
      return false;
    for (const hashDir of readdirSync2(npxDir)) {
      const ctxDir = join4(npxDir, hashDir, "node_modules", "context7");
      try {
        if (existsSync5(join4(ctxDir, "package.json")))
          return true;
      } catch {
      }
    }
  } catch {
  }
  return false;
}
function detectContext7(files = CONTEXT7_CONFIG_FILES) {
  if (process.env.CLAUDE_CONTEXT7_AVAILABLE)
    return true;
  for (const f of files) {
    try {
      if (existsSync5(f) && /context7/i.test(readFileSync5(f, "utf-8")))
        return true;
    } catch {
    }
  }
  if (_scanOpenCodeConfigs(join4(USER_HOME3, ".config/opencode")))
    return true;
  if (_context7InPath())
    return true;
  if (_context7InNpmCache())
    return true;
  return false;
}
var DOCS_TARGET_RE = /(docs\.|readthedocs|developer\.mozilla|\/api\/|\/reference\/|\/guide\/|npmjs\.com\/package\/|pypi\.org\/project\/|crates\.io\/crates\/|pkg\.go\.dev|api-docs|\/javadoc\/)/i;
function isDocsTarget(s) {
  return typeof s === "string" && DOCS_TARGET_RE.test(s);
}
var TIERS_FILE3 = join4(USER_HOME3, ".claude/model-tiers.json");
function loadSelection2() {
  try {
    if (!existsSync5(TIERS_FILE3))
      return DFLT_SEL2;
    const st = statSync4(TIERS_FILE3);
    if (st.size > 10485760) {
      _handleStateCorruption3(TIERS_FILE3);
      return DFLT_SEL2;
    }
    const j = safeJsonParse3(readFileSync5(TIERS_FILE3, "utf-8"));
    return {
      enabled: j?.selection?.enabled !== false,
      active_slot: j?.selection?.active_slot || null,
      thinking_level: j?.selection?.thinking_level || "off",
      flow_enabled: j?.selection?.flow_enabled === true,
      tdd_enforce: j?.selection?.tdd_enforce === true,
      tdd_strict: j?.selection?.tdd_strict === true,
      tdd_quality: j?.selection?.tdd_quality !== false,
      flow_enforce: j?.selection?.flow_enforce === true,
      delegation_enforce: true
    };
  } catch {
    _handleStateCorruption3(TIERS_FILE3);
    return DFLT_SEL2;
  }
}
var DFLT_SEL2 = { enabled: true, active_slot: null, thinking_level: "off", flow_enabled: false, tdd_enforce: false, tdd_strict: false, tdd_quality: true, flow_enforce: false, delegation_enforce: true };
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
  const jsonPath = join4(dir, "opencode.json");
  const jsoncPath = join4(dir, "opencode.jsonc");
  if (existsSync5(jsonPath)) {
    return safeJsonParse3(readFileSync5(jsonPath, "utf-8"));
  }
  if (existsSync5(jsoncPath)) {
    return parseJsonc(readFileSync5(jsoncPath, "utf-8"));
  }
  return {};
}
var PLACEHOLDER_RE = /^(provider|opencode)\/[a-z-]+-model$/i;
function _refreshModel(directory3) {
  try {
    const sel = loadSelection2();
    if (!sel.enabled)
      return;
    const tiersData = safeJsonParse3(readFileSync5(TIERS_FILE3, "utf-8"));
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
      const detected = readConfig(directory3) || readConfig(join4(USER_HOME3, ".config/opencode")) || process?.env?.OPENCODE_MODEL || "";
      if (detected) {
        setCurrentModel(detected);
        setCurrentTier(classify(detected));
        console.error(`[vibeOS] auto-detected model: ${currentModel} (tier=${currentTier})`);
      }
    }
    if (!_modelLocked) {
      const cfgModel = readConfig(directory3) || readConfig(join4(USER_HOME3, ".config/opencode")) || "";
      if (cfgModel && cfgModel !== currentModel) {
        const oldModel = currentModel;
        const oldTier = currentTier;
        setCurrentModel(cfgModel);
        setCurrentTier(classify(cfgModel));
        console.error(`[vibeOS] model refresh (config): ${oldModel}(${oldTier}) \u2192 ${currentModel}(${currentTier})`);
        try {
          if (existsSync5(TIERS_FILE3)) {
            const t = safeJsonParse3(readFileSync5(TIERS_FILE3, "utf-8"));
            for (const s of ["brain", "medium", "cheap"]) {
              if (t?.trinity?.[s]?.oc === cfgModel) {
                t.selection.active_slot = s;
                const _tmp = TIERS_FILE3 + ".tmp." + Date.now();
                writeFileSync5(_tmp, JSON.stringify(t, null, 2) + "\n", "utf-8");
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
    const j = safeJsonParse3(readFileSync5(TIERS_FILE3, "utf-8"));
    const ocModel = j?.trinity?.[slot]?.oc;
    if (!ocModel)
      return { ok: false, reason: `slot '${slot}' has no oc model` };
    j.selection.active_slot = slot;
    const _tmp = TIERS_FILE3 + ".tmp." + Date.now();
    writeFileSync5(_tmp, JSON.stringify(j, null, 2) + "\n", "utf-8");
    renameSync4(_tmp, TIERS_FILE3);
    const localOcConfig = join4(process.cwd(), "opencode.json");
    const ocConfig = existsSync5(localOcConfig) ? localOcConfig : join4(USER_HOME3, ".config/opencode/opencode.json");
    if (existsSync5(ocConfig)) {
      const oc = safeJsonParse3(readFileSync5(ocConfig, "utf-8"));
      oc.model = ocModel;
      writeFileSync5(ocConfig, JSON.stringify(oc, null, 2) + "\n");
    }
    _refreshModel(process.cwd());
    return { ok: true, ocModel };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// src/lib/turn-classify.js
import { readFileSync as readFileSync6, writeFileSync as writeFileSync6, existsSync as existsSync6, mkdirSync as mkdirSync6, renameSync as renameSync5 } from "node:fs";
import { join as join5, dirname as dirname5 } from "node:path";

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
    score += hits * 0.14;
  }
  const urgency = ["fix", "now", "fast", "urgent", "important", "critical", "hurry", "immediately", "asap"];
  for (const w of urgency) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
    const hits = (t.match(re) || []).length;
    score += hits * 0.06;
  }
  const negative = ["no", "not", "don't", "can't", "won't", "doesn't", "isn't", "shouldn't", "never", "stop"];
  for (const w of negative) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
    const hits = (t.match(re) || []).length;
    score += hits * 0.04;
  }
  const capsAcronyms = /* @__PURE__ */ new Set(["ai", "ui", "api", "cli", "ssh", "dns", "http", "url", "json", "xml", "css", "html", "sql", "csv", "yaml", "ide", "tdd", "pr", "ci", "cd", "env", "os", "sdk", "gui", "crud", "rest", "crlf", "utf", "ascii"]);
  const words = text.split(/\s+/);
  for (const w of words) {
    if (w.length >= 3 && /^[A-Z]+$/.test(w) && !capsAcronyms.has(w.toLowerCase())) {
      score += 0.02;
    }
  }
  const exclamParts = text.match(/!{2,}/g);
  if (exclamParts)
    score += exclamParts.length * 0.03;
  const qmarkParts = text.match(/\?{2,}/g);
  if (qmarkParts)
    score += qmarkParts.length * 0.02;
  const qeCombos = text.match(/\?!|!\?/g);
  if (qeCombos)
    score += qeCombos.length * 0.05;
  if (text.length < 30)
    score += 0.05;
  else if (text.length < 80)
    score += 0.03;
  else if (text.length < 150)
    score += 0.01;
  return Math.min(score, 0.95);
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
function autoSelectMode(subRegime, stressMultiplier) {
  const regime = String(subRegime || "INIT").toUpperCase();
  const stress = Number(stressMultiplier ?? 0);
  if (regime === "LOOPING")
    return "speed";
  if (regime === "CONVERGING" || regime === "CLOSED")
    return "quality";
  if (stress > 1.5)
    return "quality";
  return "budget";
}
function resolveOptimizationMode(subRegime, stressMultiplier, optimizationMode) {
  const normalized = String(optimizationMode || "auto").toLowerCase();
  if (normalized === "auto" || normalized === "")
    return autoSelectMode(subRegime || "INIT", stressMultiplier);
  if (normalized === "balanced" || normalized === "budget" || normalized === "quality" || normalized === "speed" || normalized === "longrun") {
    return normalized;
  }
  return "budget";
}
function resolveOptimizationSlot(mode) {
  const normalized = String(mode || "budget").toLowerCase();
  return normalized === "speed" ? "medium" : normalized === "quality" || normalized === "longrun" ? "brain" : "cheap";
}
function bootstrapOptimizationSession() {
  const sid = _OC_SID;
  const resolvedMode = DFLT_OPTIMIZATION_MODE;
  const resolvedSlot = resolveOptimizationSlot(resolvedMode);
  try {
    writeSessionOptMode(sid, resolvedMode);
    writeSessionSlot(sid, resolvedSlot);
    const state = loadBlackboxState();
    if (!state.sessions)
      state.sessions = {};
    if (!state.sessions[sid])
      state.sessions[sid] = {};
    state.sessions[sid].optimization_mode = resolvedMode;
    state.sessions[sid].active_slot = resolvedSlot;
    state.sessions[sid].sub_regime = state.sessions[sid].sub_regime || "INIT";
    state.sessions[sid].regime = state.sessions[sid].regime || "INIT";
    state.sessions[sid].resolution = state.sessions[sid].resolution || "unresolved";
    state.sessions[sid].momentum = Number(state.sessions[sid].momentum || 0);
    state.sessions[sid].loop_count = Number(state.sessions[sid].loop_count || 0);
    state.sessions[sid].loop_intervention_level = state.sessions[sid].loop_intervention_level || "none";
    state.sessions[sid].loop_start_turn = Number(state.sessions[sid].loop_start_turn || 0);
    state.sessions[sid].loop_pattern_count = Number(state.sessions[sid].loop_pattern_count || 0);
    saveBlackboxState(state);
  } catch {
  }
  return { mode: resolvedMode, slot: resolvedSlot };
}
async function selectOptimizationModeRemote(subRegime, stressMultiplier, fallbackMode) {
  const fallback = resolveOptimizationMode(subRegime, stressMultiplier, fallbackMode);
  try {
    if (!isApiFallback()) {
      const client2 = getApiClient();
      if (client2) {
        const res = await client2.blackboxSelectMode(subRegime || "INIT", Number(stressMultiplier ?? 0));
        const selected = String(res?.mode || "").toLowerCase();
        if (selected === "balanced" || selected === "budget" || selected === "quality" || selected === "speed" || selected === "longrun") {
          return selected;
        }
      }
    }
  } catch {
  }
  return fallback;
}
function computeControlVector(_state, _action, _optimizationMode) {
  const mode = resolveOptimizationMode(_state?.sub_regime, _state?.latest_stress_multiplier, _optimizationMode);
  const isStrict = mode === "quality";
  const isRelaxed = mode === "budget" || mode === "speed";
  const tierBias = mode === "quality" ? "brain" : mode === "speed" ? "medium" : mode === "longrun" ? "brain" : mode === "balanced" ? "auto" : "cheap";
  return {
    enforcement_mode: isStrict ? "strict" : isRelaxed ? "relaxed" : "normal",
    enforcement_reason: `[optimize: ${mode}] using safe offline defaults`,
    flow_mode: isStrict ? "strict" : isRelaxed ? "audit" : "normal",
    flow_focus: [],
    tdd_mode: isStrict ? "strict" : isRelaxed ? "lazy" : "normal",
    tdd_focus: [],
    tier_bias: tierBias,
    thinking_mode: isStrict ? "full" : mode === "longrun" ? "brief" : isRelaxed ? "off" : "auto",
    stress_multiplier: 1,
    context7_urgency: isStrict ? "required" : "preferred",
    wbp_verbosity: isStrict ? "verbose" : isRelaxed ? "minimal" : "normal",
    agent_mode: isStrict ? "plan" : "auto",
    optimization_mode: mode,
    directives: []
  };
}
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
var _blackboxTracker = null;
var _latestBlackboxState2 = null;
var _latestBlackboxLoopMsg = null;
var _latestBlackboxPivotMsg = null;
var WARN_DEDUPE_WINDOW_MS2 = 120 * 1e3;
var warnLogThrottle = /* @__PURE__ */ new Map();
var warnPerSession = /* @__PURE__ */ new Map();
var WARN_MAX_PER_SESSION = 3;
var WARN_COALESCE_THRESHOLD = 10;
var warnCoalesceCounters = /* @__PURE__ */ new Map();
function loadTrinityModels() {
  try {
    const p = join5(USER_HOME2, ".claude/model-tiers.json");
    if (!existsSync6(p))
      return { brain: "", cheap: "", medium: "" };
    const j = safeJsonParse3(readFileSync6(p, "utf-8"));
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
function getBlackboxTracker() {
  if (!_blackboxTracker) {
    const state = loadBlackboxState();
    if (state.enabled !== void 0)
      setBlackboxEnabled(state.enabled);
    const sid = _OC_SID;
    if (state.sessions?.[sid]?.history) {
      _blackboxTracker = _BlackboxStub.deserialize(state.sessions[sid]);
    } else if (currentProjectFingerprint) {
      const projectKeys = Object.keys(state.sessions || {}).filter((k) => state.sessions[k].project_fingerprint === currentProjectFingerprint);
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
    await client2.blackboxOutcome(_OC_SID, outcome);
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
      project_id: currentProjectFingerprint || null
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
function noteTaskRoutingLearning(firstWord, targetModel, reason) {
  if (!firstWord || !/^[a-z][a-z0-9_-]{1,24}$/.test(firstWord))
    return;
  try {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const nonExploratory = /* @__PURE__ */ new Set(["build", "implement", "fix", "add", "update", "remove", "write", "edit", "refactor", "create"]);
    try {
      const pstate = loadProjectState();
      const fp2 = currentProjectFingerprint || projectFingerprint(process.cwd());
      const bucket = ensureProjectBucket(pstate, fp2);
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
      saveProjectState(pstate);
    } catch {
    }
    updateGlobalLearning((gl) => {
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
        const pstate = loadProjectState();
        const currentFp = currentProjectFingerprint || "";
        const currentTech = currentFp ? pstate.project_hashes?.[currentFp]?.techStack : null;
        if (currentTech && Array.isArray(currentTech) && currentTech.length > 0) {
          for (const [fp2, bucket] of Object.entries(pstate.project_hashes || {})) {
            if (fp2 === currentFp)
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
var DFLT_OPTIMIZATION_MODE = "budget";
function loadOptimizationMode() {
  try {
    const mode = loadSessionOptMode(_OC_SID);
    return mode && mode !== "auto" ? mode : DFLT_OPTIMIZATION_MODE;
  } catch {
    return DFLT_OPTIMIZATION_MODE;
  }
}
function saveOptimizationMode(mode) {
  try {
    return writeSessionOptMode(_OC_SID, mode);
  } catch (err) {
    console.error("[vibeOS] saveOptimizationMode failed: " + err.message);
    return false;
  }
}
function getTurnCounter() {
  try {
    const state = loadBlackboxState();
    const sid = _OC_SID;
    return state.sessions?.[sid]?.turn_counter || 0;
  } catch {
    return 0;
  }
}

// src/lib/research-audit.js
import { readFileSync as readFileSync7, existsSync as existsSync7 } from "node:fs";
import { join as join6 } from "node:path";
import { homedir as homedir6, tmpdir as tmpdir4 } from "node:os";
var USER_HOME4 = (() => {
  try {
    return homedir6();
  } catch {
    return tmpdir4();
  }
})();
var _OC_SID2 = "opencode-" + (process.pid || "x") + "-" + Date.now();
var SCRATCHPAD_ROOT2 = join6(USER_HOME4, ".claude/scratch");
var SCRATCHPAD_GLOBAL_DIR2 = join6(SCRATCHPAD_ROOT2, "by-hash");
var SCRATCHPAD_SESSIONS_DIR2 = join6(SCRATCHPAD_ROOT2, "sessions");
var STATE_FILE2 = join6(USER_HOME4, ".claude/delegation-state.json");
var currentModel2 = null;
function getSessionRoot2() {
  return join6(SCRATCHPAD_SESSIONS_DIR2, _OC_SID2);
}
function getSessionScratchpadDir2() {
  return join6(getSessionRoot2(), "by-hash");
}
function getGlobalIndexPath2() {
  return join6(SCRATCHPAD_ROOT2, "index.jsonl");
}
var FETCH_TOOLS = /* @__PURE__ */ new Set(["WebFetch", "WebSearch", "webfetch", "websearch"]);
function researchAudit({ hours = 24, session: sessionFilter } = {}) {
  const cutoff = Date.now() - hours * 3600 * 1e3;
  const report = { totalFetches: 0, totalBytes: 0, estCost: 0, chains: [], byDomain: {}, sessions: 0, redundant: 0 };
  try {
    const indexPath = getGlobalIndexPath2();
    if (existsSync7(indexPath)) {
      const lines = readFileSync7(indexPath, "utf-8").trim().split("\n").filter(Boolean);
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
        const summaryPathSession = join6(getSessionScratchpadDir2(), hash + ".summary.txt");
        const summaryPathGlobal = join6(SCRATCHPAD_GLOBAL_DIR2, hash + ".summary.txt");
        const summaryPath = existsSync7(summaryPathSession) ? summaryPathSession : summaryPathGlobal;
        if (existsSync7(summaryPath)) {
          const summary = readFileSync7(summaryPath, "utf-8").slice(0, 200);
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
    if (existsSync7(STATE_FILE2)) {
      const state = safeJsonParse3(readFileSync7(STATE_FILE2, "utf-8"));
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

// src/lib/runtime-surface.js
function normalizeTrend(trend) {
  return trend === "up" || trend === "down" ? trend : "flat";
}
function buildStatusPayload({ selection, tiersData, currentModel: currentModel3, creditPercent, version, todos, backendConnected, backendHealthUrl, modelLocked, lockedSlot, lockedModel }) {
  const activeSlot = selection?.active_slot || "brain";
  const todoList = Array.isArray(todos) ? todos : [];
  const pendingTodos = todoList.filter((t) => t?.status === "pending").length;
  const totalTodos = todoList.length;
  const current = tiersData?.trinity?.[activeSlot]?.oc || currentModel3 || "";
  const lockActive = Boolean(modelLocked);
  const resolvedLockedSlot = lockActive ? lockedSlot || activeSlot : null;
  const resolvedLockedModel = lockActive ? lockedModel || current || null : null;
  return {
    enabled: selection?.enabled !== false,
    active_slot: activeSlot,
    enforce: selection?.delegation_enforce !== false,
    flow_enforcer: selection?.flow_enabled !== false,
    flow_extract_todos: selection?.flow_enforce === true,
    tdd_enforcer: selection?.tdd_enforce === true,
    tdd_strict: selection?.tdd_strict !== false,
    thinking: selection?.thinking_level || fallbackThinking || "brief",
    current_model: current,
    credit_percent: creditPercent,
    version,
    todos: { total: totalTodos, pending: pendingTodos },
    backend_connected: Boolean(backendConnected),
    backend_health_url: backendHealthUrl || null,
    model_locked: lockActive,
    locked_slot: resolvedLockedSlot,
    locked_model: resolvedLockedModel
  };
}
function buildSavingsPayload({ lifetime, session }) {
  const telemetry = lifetime?.telemetry || {};
  return {
    lifetime: {
      delegation_usd: Number(lifetime?.ltTasks || 0),
      cache_usd: Number(lifetime?.ltCache || 0),
      missed_context7_usd: Number(lifetime?.missedC7 || 0),
      total_warns: Number(lifetime?.count || 0)
    },
    current_session: {
      delegation_usd: Number(lifetime?.sesTasks || 0),
      cache_usd: Number(session?.cache_savings_usd || 0),
      warns_count: Array.isArray(session?.warns) ? session.warns.length : 0,
      tool_breakdown: lifetime?.sesToolBreakdown || {}
    },
    telemetry: {
      lifetime_events: Number(telemetry?.lifetime_events ?? telemetry?.events ?? 0),
      current_session_events: Number(telemetry?.current_session_events ?? telemetry?.session_events ?? session?.telemetry?.events ?? 0),
      storage_bytes_estimate: Number(telemetry?.storage_bytes_estimate || 0),
      retained_sessions: Number(telemetry?.retained_sessions || 0),
      tool_counts: telemetry?.tool_counts || {},
      tier_counts: telemetry?.tier_counts || {},
      slot_counts: telemetry?.slot_counts || {},
      kind_counts: telemetry?.kind_counts || {},
      prompt_size_buckets: telemetry?.prompt_size_buckets || {},
      output_size_buckets: telemetry?.output_size_buckets || {},
      duration_buckets: telemetry?.duration_buckets || {},
      result_counts: telemetry?.result_counts || {},
      cache_hit_counts: telemetry?.cache_hit_counts || { hit: 0, miss: 0 },
      enforcement_counts: telemetry?.enforcement_counts || {},
      flow_counts: telemetry?.flow_counts || {},
      tdd_counts: telemetry?.tdd_counts || {},
      last_seen: telemetry?.last_seen || null,
      last_compacted_at: telemetry?.last_compacted_at || null
    },
    cache_hits_this_session: Number(session?.cache_hits?.length || 0),
    trend: normalizeTrend(lifetime?.sesTrend),
    savings_rate_per_hour: Number(lifetime?.sesRatePerHour || 0)
  };
}
function buildSessionCheckout({ sessionId, metrics, session, flowWarns }) {
  const warns = Array.isArray(session?.warns) ? session.warns : [];
  const rankedOps = warns.map((w) => ({
    tool: String(w?.tool || "unknown"),
    reason: String(w?.reason || ""),
    savings_usd: Number(w?.est_savings_usd || 0),
    at: w?.at || null
  })).sort((a, b) => b.savings_usd - a.savings_usd).slice(0, 3);
  const summary = {
    session_id: sessionId,
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
  return {
    summary,
    report: {
      type: "session-checkout",
      summary: `Session checkout ${sessionId}: $${Number(summary.savings.total_usd || 0).toFixed(3)} saved`,
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
        worker_turns: summary.model_split.worker || 0,
        telemetry_events: Number(session?.telemetry?.events || 0),
        telemetry_storage_bytes_estimate: Number(session?.telemetry?.storage_bytes_estimate || 0)
      },
      narrative: JSON.stringify(summary),
      tags: ["session", "checkout"]
    },
    rankedOps
  };
}
function diagnoseStructuredFromText(raw, creditPercent = 0) {
  const text = String(raw || "");
  const lines = text.split("\n");
  const files = [];
  const model_probes = [];
  const suggestions = [];
  let credit = { percent: Number(creditPercent || 0), ok: true, fix: null };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed)
      continue;
    if (trimmed.includes("\u2192"))
      suggestions.push(trimmed.replace(/^→\s*/, ""));
    if (/slot/i.test(trimmed) && /(brain|medium|cheap)/i.test(trimmed)) {
      model_probes.push({ slot: trimmed, model: "", ok: trimmed.includes("\u2705"), fix: trimmed.includes("\u2192") ? trimmed.split("\u2192")[1].trim() : void 0 });
    }
    if (/model-tiers\.json|opencode\.json|delegation-state\.json|auth\.json/i.test(trimmed)) {
      files.push({ path: trimmed, exists: trimmed.includes("\u2705"), ok: trimmed.includes("\u2705"), fix: trimmed.includes("\u2192") ? trimmed.split("\u2192")[1].trim() : void 0 });
    }
    if (/credit/i.test(trimmed)) {
      const m = trimmed.match(/(\d+)%/);
      if (m)
        credit.percent = Number(m[1]);
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
function projectStructuredFromText(raw, selection, creditPercent = 0) {
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
    enforcement_status: selection?.delegation_enforce ? "enforce" : "warn",
    flow_status: selection?.flow_enabled !== false ? "on" : "off",
    credit_percent: Number(creditPercent || 0),
    suggestions
  };
}

// src/lib/reporting.js
import { readFileSync as readFileSync8, writeFileSync as writeFileSync7, existsSync as existsSync8, mkdirSync as mkdirSync7, statSync as statSync5, copyFileSync as copyFileSync4, rmSync as rmSync3 } from "node:fs";
import { join as join7, basename as basename5 } from "node:path";
import { homedir as homedir7, tmpdir as tmpdir5 } from "node:os";
var USER_HOME5 = (() => {
  try {
    return homedir7();
  } catch {
    return tmpdir5();
  }
})();
var REPORTS_DIR2 = join7(USER_HOME5, ".claude/reports");
var REPORTS_INDEX = join7(REPORTS_DIR2, "index.json");
var _OC_SID3 = "opencode-" + (process.pid || "x") + "-" + Date.now();
var currentProjectFingerprint2 = "";
var currentProjectName2 = "";
function _handleStateCorruption4(path) {
  const backupDir = join7(USER_HOME5, ".claude", ".backups");
  mkdirSync7(backupDir, { recursive: true });
  const backupPath = join7(backupDir, basename5(path) + ".corrupted." + Date.now());
  try {
    copyFileSync4(path, backupPath);
  } catch {
  }
}
function readJsonOrEmpty2(filePath) {
  try {
    if (!existsSync8(filePath))
      return {};
    const st = statSync5(filePath);
    if (st.size > 10485760) {
      _handleStateCorruption4(filePath);
      return {};
    }
    return safeJsonParse3(readFileSync8(filePath, "utf-8"));
  } catch {
    _handleStateCorruption4(filePath);
    return {};
  }
}
function reportsIndex() {
  const idx = readJsonOrEmpty2(REPORTS_INDEX);
  if (!idx || !Array.isArray(idx.reports))
    return { reports: [] };
  return idx;
}
function saveReportsIndex(idx) {
  try {
    withFileLock(REPORTS_INDEX, () => {
      mkdirSync7(REPORTS_DIR2, { recursive: true });
      writeFileSync7(REPORTS_INDEX, JSON.stringify(idx, null, 2) + "\n");
    });
  } catch (err) {
    console.error(`[vibeOS] reports index write failed: ${err.message}`);
  }
}
function generateReportId(type, fp2) {
  const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:-]/g, "").replace(/\..+/, "");
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${ts}-${(fp2 || "unknown").slice(0, 6)}-${type}-${rnd}`;
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
          rmSync3(join7(REPORTS_DIR2, `${r.id}.json`));
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
function saveReport({ type = "manual", summary = "", findings = null, metrics = null, narrative = "", tags = [], fingerprint = null, status = "pending", task_description = "", outcome_verified = false } = {}) {
  const parsedFindings = _parseFindings(findings);
  const parsedMetrics = _parseMetrics(metrics);
  if (_wouldBeDuplicate(type, summary))
    return null;
  const fp2 = fingerprint || currentProjectFingerprint2 || "unknown";
  const id2 = generateReportId(type, fp2);
  const report = {
    meta: { id: id2, project: currentProjectName2 || "unknown", fingerprint: fp2, type, created: (/* @__PURE__ */ new Date()).toISOString(), sessionId: _OC_SID3 },
    summary,
    findings: parsedFindings,
    metrics: parsedMetrics,
    narrative,
    tags,
    status,
    task_description,
    outcome_verified
  };
  try {
    withFileLock(REPORTS_INDEX, () => {
      mkdirSync7(REPORTS_DIR2, { recursive: true });
      writeFileSync7(join7(REPORTS_DIR2, `${id2}.json`), JSON.stringify(report, null, 2) + "\n");
      const idx = reportsIndex();
      const _sum = (summary || "").slice(0, 80);
      idx.reports.push({ id: id2, type, project: report.meta.project, fingerprint: fp2, created: report.meta.created, summary: _sum });
      writeFileSync7(REPORTS_INDEX, JSON.stringify(idx, null, 2) + "\n");
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
  const path = join7(REPORTS_DIR2, `${id2}.json`);
  try {
    if (!existsSync8(path))
      return null;
    return safeJsonParse3(readFileSync8(path, "utf-8"));
  } catch {
    return null;
  }
}

// src/lib/credit-api.js
import { readFileSync as readFileSync9, writeFileSync as writeFileSync8, existsSync as existsSync9 } from "node:fs";
import { join as join8 } from "node:path";
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
var _creditTimer = null;
function _readAuth() {
  try {
    return existsSync9(AUTH_F) ? safeJsonParse4(readFileSync9(AUTH_F, "utf-8")) : {};
  } catch {
    return {};
  }
}
async function _fetchBal(provider, key) {
  const api = BALANCE_APIS[provider];
  if (!api)
    return { provider, balance: 0 };
  try {
    const res = await fetch(api.url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5e3)
    });
    if (!res.ok)
      return { provider, balance: 0 };
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
    if (!c?.key || !BALANCE_APIS[p])
      continue;
    const { balance } = await _fetchBal(p, c.key);
    if (balance > 0) {
      provs.push({ provider: p, balance });
      total += balance;
    }
  }
  try {
    writeFileSync8(CREDIT_CACHE_F, JSON.stringify({ total, providers: provs, ts: Date.now() }));
  } catch {
  }
}
function _cachedPct() {
  try {
    if (!existsSync9(CREDIT_CACHE_F))
      return null;
    const s = safeJsonParse4(readFileSync9(CREDIT_CACHE_F, "utf-8"));
    if (s?.total == null || !s.ts)
      return null;
    let budget = 50;
    try {
      const p = join8(USER_HOME2, ".claude/model-tiers.json");
      if (existsSync9(p)) {
        const j = safeJsonParse4(readFileSync9(p, "utf-8"));
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
var _started = false;
function _lazyRefresh() {
  if (_started)
    return;
  _started = true;
  _snapshot();
  _creditTimer = setInterval(_snapshot, 60 * 60 * 1e3);
  if (_creditTimer.unref)
    _creditTimer.unref();
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
    const f = join8(USER_HOME2, ".claude/credit-percent");
    if (existsSync9(f)) {
      const n = parseInt(readFileSync9(f, "utf-8").trim(), 10);
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

// src/lib/trinity-tool.js
import { join as join9 } from "node:path";
function createTrinityTool(deps) {
  return {
    description: "Control the vibeOS plugin and active model slot. Use action='status' to see current state. Use action='enable' or 'disable' to toggle the plugin (takes effect immediately, no restart needed). Use action='set' with slot='brain'|'medium'|'cheap' to switch model tiers (writes opencode.json \u2014 active immediately). Use action='rebuild' to auto-detect available models from all configured providers and reassign brain/medium/cheap slots. Use action='flow' with slot='on'|'off' to toggle flow enforcer, or action='flow' alone for audit. Use action='flow' with slot='enforce' and level='on'|'off' to toggle auto-extract TODOs. Use action='enforce' with slot='on'|'off' to toggle delegation enforcement (blocks direct writes/edits on brain tier). Use action='tdd' with slot='on'|'off' to toggle auto-create test skeletons. Use action='tdd' with slot='strict' and level='on'|'off' to toggle strict failing TODO test templates. Use action='tdd' alone for audit. Use action='project' to show per-project analytics and optimization suggestions. Use action='patterns' to inspect learned project patterns or slot='clear' to clear them. Use action='guard' to ensure AGENTS.md and README.md exist and stay current. Use action='api-token' with token='<new_token>' to update the API token and re-enable remote control-vector Call this when the user says things like 'switch to medium', 'use cheap model', 'disable plugin', 'trinity status'.",
    args: {
      action: deps.tool.schema.enum(["status", "enable", "disable", "set", "mode", "thinking", "flow", "tdd", "project", "patterns", "rebuild", "diagnose", "help", "enforce", "repair-state", "blackbox", "report", "target", "guard", "api-token", "todo", "todo-done", "todo-sync"]).optional(),
      slot: deps.tool.schema.enum(["brain", "medium", "cheap", "budget", "quality", "speed", "longrun", "auto", "on", "off", "enforce", "strict", "preview", "apply", "clear", "savings"]).optional(),
      level: deps.tool.schema.enum(["full", "brief", "off", "on"]).optional(),
      token: deps.tool.schema.string().optional()
    },
    async execute({ action, slot, level, token } = {}) {
      if (typeof deps._lazyRefresh === "function")
        deps._lazyRefresh();
      if (!action)
        action = "status";
      if (["brain", "medium", "cheap"].includes(action)) {
        slot = action;
        action = "set";
      }
      if (action === "status") {
        const sel = deps.loadSelection();
        let tiers = {};
        try {
          tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8")).trinity || {};
        } catch {
        }
        const credit = deps.loadCredit();
        const effectiveLevel = sel.thinking_level || deps.thinkingLevel(credit);
        const sv = deps.readLifetimeSavings();
        const ltTotal = (sv.ltTasks || 0) + (sv.ltCache || 0);
        const sesTasks = sv.sesTasks || 0;
        const sesCache = Number(deps.readFullState()?.sessions?.[deps._OC_SID]?.cache_savings_usd || 0);
        const sesWarns = Array.isArray(deps.readFullState()?.sessions?.[deps._OC_SID]?.warns) ? deps.readFullState().sessions[deps._OC_SID].warns.length : 0;
        const sesTrend = sv.sesTrend || "stable";
        const sesRate = sv.sesRatePerHour || 0;
        const missedC7 = sv.missedC7 || 0;
        const toolBreakdown = sv.sesToolBreakdown || {};
        const topTools = Object.entries(toolBreakdown).filter(([, v]) => v > 5e-3).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const brainModel = tiers?.brain?.oc || "(unset)";
        const mediumModel = tiers?.medium?.oc || "(unset)";
        const cheapModel = tiers?.cheap?.oc || "(unset)";
        const activeSlot = sel.active_slot || "brain";
        const lockedSlot = deps._lockedSlot || null;
        const lockedModel = deps._lockedModel || null;
        const stressScore = deps.latestUserIntent ? deps.scoreStress(deps.latestUserIntent) : 0;
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
        if (deps._blackboxEnabled) {
          try {
            const res = deps._latestBlackboxState || deps.getBlackboxResolution();
            if (res && res.n_interactions > 3) {
              const momentumIcon = res.momentum > 0.3 ? "up up" : res.momentum > 0 ? "up" : res.momentum < -0.3 ? "down down" : res.momentum < 0 ? "down" : "flat";
              const loopTag = res.is_looping ? " (loop)" : "";
              decisionLine = `${res.resolution} ${res.sub_regime} ${momentumIcon}${loopTag}`;
            }
          } catch {
          }
        }
        const lines = [
          `[vibeOS-dashboard]`,
          `Model: ${activeSlot} (${tiers?.[activeSlot]?.oc || deps.currentModel || "(unset)"})`,
          ...totalTurns > 0 ? [`Split: brain ${brainPct}% / worker ${workerPct}% (${totalTurns} total)`] : [],
          `Thinking: ${effectiveLevel}`,
          `Credit: ${credit}%`,
          ...qualityAvg > 0 ? [`Quality: ${Math.round(qualityAvg)}%`] : [],
          ...decisionLine ? [`Decision: ${decisionLine}`] : [],
          `|`,
          `Stress: ${stressBar} (${stressLabel})`,
          `|`,
          `Guards:`,
          `  Flow: ${sel.flow_enabled !== false ? "ON" : "OFF"}${sel.flow_enforce ? " (extract)" : ""}`,
          `  TDD: ${sel.tdd_enforce ? "ON" : "OFF"}${sel.tdd_strict !== false ? " strict" : ""}${sel.tdd_quality !== false ? " quality" : ""}`,
          `  Enforce: ON (mandatory)`,
          `  Lock: ${deps._modelLocked ? `\u{1F512} ON${lockedSlot ? ` (${lockedSlot})` : ""}${lockedModel ? ` ${lockedModel}` : ""}` : "\u{1F513} OFF"}`,
          `|`,
          `All-time savings:`,
          `  Total: $${ltTotal.toFixed(2)} (${sesTrend})`,
          `  Delegation: $${(sv.ltTasks || 0).toFixed(2)}`,
          `  Cache: $${deps.formatUsd(sv.ltCache || 0)}`,
          `  Missed: $${missedC7.toFixed(2)}`,
          `|`,
          `This session:`,
          ...sesDuration > 0 ? [`  Duration: ${durHrs}h ${durMins}m`] : [],
          `  Rate: $${sesRate.toFixed(2)}/hr`,
          `  Warnings: ${sesWarns}`,
          ...topTools.length > 0 ? [`  Top tools:`, ...topTools.map(([t, v]) => `    ${t}: $${v.toFixed(2)}`)] : [],
          `|`,
          `Tiers:`,
          `  brain:  ${brainModel}${activeSlot === "brain" ? "  *" : ""}`,
          `  medium: ${mediumModel}${activeSlot === "medium" ? "  *" : ""}`,
          `  cheap:  ${cheapModel}${activeSlot === "cheap" ? "  *" : ""}`
        ];
        return lines.join("\n");
      }
      if (action === "enable" || action === "disable") {
        const val = action === "enable";
        const ok = deps.writeSelection("enabled", val);
        if (!ok)
          return `\u274C Failed to write model-tiers.json`;
        return `${val ? "\u2705 Plugin ENABLED" : "\u274C Plugin DISABLED"} \u2014 takes effect immediately (no restart needed).`;
      }
      if (action === "set") {
        if (!slot || !["brain", "medium", "cheap"].includes(slot)) {
          return `\u274C Provide slot: brain | medium | cheap`;
        }
        let targetModel = "";
        try {
          const tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"));
          targetModel = tiers?.trinity?.[slot]?.oc || "";
        } catch {
        }
        if (!targetModel) {
          return "\u274C No model configured for " + slot + " slot. Run `trinity rebuild` first.";
        }
        const auth = deps._readAuth();
        try {
          const ok = await deps.probeModel(targetModel, auth);
          if (!ok)
            console.error("[vibeOS] WARN: " + targetModel + " probe failed - switching anyway");
        } catch (e) {
          console.error("[vibeOS] WARN: probe error for " + targetModel + ": " + e.message + " - switching anyway");
        }
        deps.writeSessionSlot(deps._OC_SID, slot);
        const result = deps.applySlot(slot);
        if (!result.ok)
          return `\u274C Failed to set slot: ${result.reason}`;
        deps._refreshModel(deps.directory);
        return `\u2705 Switched to ${slot} slot (${result.ocModel}). Active now (no restart needed).`;
      }
      if (action === "mode") {
        if (!slot || !["budget", "quality", "speed", "longrun", "auto"].includes(slot)) {
          return `Provide mode: budget | quality | speed | longrun | auto`;
        }
        const ok = deps.saveOptimizationMode(slot);
        if (!ok)
          return `Failed to write mode`;
        const tierMap = { budget: "cheap", quality: "brain", speed: "medium", longrun: "brain" };
        const tierSlot = tierMap[slot] || "cheap";
        deps.writeSelection("active_slot", tierSlot);
        if (slot === "budget") {
          deps.writeSelection("delegation_enforce", true);
          deps.writeSelection("flow_enabled", false);
          deps.writeSelection("flow_enforce", false);
          deps.writeSelection("tdd_enforce", false);
          deps.writeSelection("thinking_level", "off");
        } else if (slot === "quality") {
          deps.writeSelection("delegation_enforce", true);
          deps.writeSelection("flow_enabled", true);
          deps.writeSelection("flow_enforce", true);
          deps.writeSelection("tdd_enforce", true);
          deps.writeSelection("thinking_level", "full");
        } else if (slot === "speed") {
          deps.writeSelection("delegation_enforce", true);
          deps.writeSelection("flow_enabled", false);
          deps.writeSelection("flow_enforce", false);
          deps.writeSelection("tdd_enforce", false);
          deps.writeSelection("thinking_level", "off");
        }
        return `Mode set to ${slot.toUpperCase()}. Tier: ${tierSlot}.`;
      }
      if (action === "thinking") {
        if (!level || !["full", "brief", "off"].includes(level)) {
          return `\u274C Provide level: full | brief | off`;
        }
        const stored = level;
        const ok = deps.writeSelection("thinking_level", stored);
        if (!ok)
          return `\u274C Failed to write model-tiers.json`;
        const desc = {
          full: "full thinking (no restriction) \u2014 takes effect on next message",
          brief: "brief thinking (complex tasks only) \u2014 takes effect on next message",
          off: "thinking OFF (respond directly) \u2014 takes effect on next message"
        };
        return `\u2705 Reasoning depth \u2192 ${desc[level]}`;
      }
      if (action === "flow") {
        if (slot === "on" || slot === "off") {
          const ok = deps.writeSelection("flow_enabled", slot === "on");
          return ok ? `\u2705 Flow enforcer ${slot === "on" ? "ENABLED" : "DISABLED"}` : `\u274C Failed to write model-tiers.json`;
        }
        if (slot === "enforce") {
          if (level !== "on" && level !== "off")
            return "\u274C Provide level on|off for `trinity flow enforce`";
          const enforceOn = level === "on";
          const ok = deps.writeSelection("flow_enforce", enforceOn);
          return ok ? `\u2705 Flow enforcement ${enforceOn ? "ENABLED (auto-extract TODOs)" : "DISABLED (log only)"}` : `\u274C Failed to write model-tiers.json`;
        }
        const flowWarns = deps.getFlowWarns();
        const sid = String(process.pid || "?");
        const sessionWarns = flowWarns.filter((w) => String(w.sid) === sid);
        const bySev = { warn: 0, hint: 0, flag: 0 };
        for (const w of sessionWarns) {
          if (bySev[w.severity] !== void 0)
            bySev[w.severity]++;
        }
        const lines = [`\u{1F500} Flow enforcer audit (this session):`];
        lines.push(`  ${bySev.warn} warn, ${bySev.hint} hint, ${bySev.flag} flag`);
        if (sessionWarns.length > 0) {
          for (const w of sessionWarns.slice(-15)) {
            const icon = w.severity === "warn" ? "\u26A0" : "\u{1F4A1}";
            lines.push(`  ${icon} [${w.severity}] ${w.rule_id}: ${w.description} \u2014 ${w.filePath || "(no file)"}`);
          }
        }
        if (sessionWarns.length === 0)
          lines.push(`  No flow violations this session.`);
        return lines.join("\n");
      }
      if (action === "enforce") {
        if (slot === "off") {
          return `\u274C Delegation enforcement is mandatory and cannot be disabled.`;
        }
        if (slot === "on") {
          const ok = deps.writeSelection("delegation_enforce", true);
          return ok ? `\u{1F6AB} Delegation enforcement ENABLED \u2014 direct writes/edits BLOCKED on brain tier` : `\u274C Failed to write model-tiers.json`;
        }
        const sel = deps.loadSelection();
        return `\u{1F6AB} Delegation enforcement: ON (mandatory, blocks direct writes/edits on brain tier)
Use \`trinity enforce on\` to reapply the guard if needed.`;
      }
      if (action === "lock") {
        if (slot === "on") {
          const lockSlot = deps.loadSelection()?.active_slot || "brain";
          const lockModel = deps._tiersData?.trinity?.[lockSlot]?.oc || deps.currentModel || "detected model";
          deps._modelLocked = true;
          deps._lockedSlot = lockSlot;
          deps._lockedModel = lockModel;
          console.error(`[vibeOS] model LOCKED \u2014 ${lockModel} (${deps.currentTier}) will not auto-reconcile with config`);
          return `\u{1F512} Model LOCKED \u2014 ${lockModel} will not change unless you force with \`trinity set\` or \`trinity lock off\`.`;
        }
        if (slot === "off") {
          deps._modelLocked = false;
          deps._lockedSlot = null;
          deps._lockedModel = null;
          console.error(`[vibeOS] model UNLOCKED \u2014 auto-reconcile re-enabled`);
          return `\u{1F513} Model UNLOCKED \u2014 will auto-follow OpenCode config changes.`;
        }
        return `\u{1F512} Model lock: ${deps._modelLocked ? "ON (fixed per session)" : "OFF (follows config)"}
Use \`trinity lock on\` or \`trinity lock off\` to toggle.
Lock is per-session (resets on restart).`;
      }
      if (action === "tdd") {
        if (slot === "strict") {
          if (level !== "on" && level !== "off") {
            return "\u274C Provide level on|off for `trinity tdd strict`";
          }
          const ok = deps.writeSelection("tdd_strict", level === "on");
          return ok ? `\u2705 TDD strict ${level === "on" ? "ENABLED (TODO tests fail loudly)" : "DISABLED (TODO tests non-blocking)"}` : `\u274C Failed to write model-tiers.json`;
        }
        if (slot === "quality") {
          if (level !== "on" && level !== "off") {
            return "\u274C Provide level on|off for `trinity tdd quality`";
          }
          const ok = deps.writeSelection("tdd_quality", level === "on");
          return ok ? `\u2705 TDD quality templates ${level === "on" ? "ENABLED (real assertions, invalid-input, edge-case stubs)" : "DISABLED (TODO-only stubs)"}` : `\u274C Failed to write model-tiers.json`;
        }
        if (slot === "on" || slot === "off") {
          const ok = deps.writeSelection("tdd_enforce", slot === "on");
          return ok ? `\u2705 TDD enforcement ${slot === "on" ? "ENABLED (auto-create skeletons)" : "DISABLED (nudge only)"}` : `\u274C Failed to write model-tiers.json`;
        }
        const stateFile = join9(deps.USER_HOME, ".claude/delegation-state.json");
        let enforced = 0;
        try {
          if (deps.existsSync(stateFile)) {
            const s = deps.safeJsonParse(deps.readFileSync(stateFile, "utf-8"));
            enforced = s.lifetime?.tdd_enforced ?? 0;
          }
        } catch {
        }
        const sel = deps.loadSelection();
        const lines = [`\u{1F9EA} TDD enforcer audit:`];
        lines.push(`  Mode: ${sel.tdd_enforce ? "ENFORCE (auto-create skeletons)" : "NUDGE (reminders only)"}`);
        lines.push(`  Strict templates: ${sel.tdd_strict !== false ? "ON (fail TODO tests)" : "OFF (non-blocking TODO tests)"}`);
        lines.push(`  Quality templates: ${sel.tdd_quality !== false ? "ON (real assertion stubs)" : "OFF (TODO-only stubs)"}`);
        lines.push(`  Skeletons created this lifetime: ${enforced}`);
        return lines.join("\n");
      }
      if (action === "project") {
        const L = "\u2501";
        const lines = [`\u{1F4CA} Project profile \u2014 ${deps.currentProjectName || (deps.directory ? deps.directory.split("/").pop() : "unknown")}`];
        lines.push(L.repeat(40));
        const fp2 = deps.currentProjectFingerprint || deps.projectFingerprint(deps.directory);
        const pstate = deps.loadProjectState();
        const proj = pstate.project_hashes?.[fp2];
        if (proj) {
          lines.push(`
\u{1F4C5} Sessions: ${proj.totalSessions || 0} | Last: ${(proj.lastSeen || "").slice(0, 10)}`);
          if (proj.researchChains)
            lines.push(`\u{1F50D} Research chains detected: ${proj.researchChains}`);
          if (proj.context7Bypasses)
            lines.push(`\u{1F4B8} Context7 bypasses: ${proj.context7Bypasses}`);
          if (proj.commonTopics?.length) {
            const topics = proj.commonTopics.slice(0, 5).join(", ");
            lines.push(`\u{1F310} Common fetch domains: ${topics}`);
          }
          const promoted = deps.promotedProjectPatterns(fp2);
          if (promoted.length) {
            lines.push(`
Learned patterns:`);
            for (const ptn of promoted)
              lines.push(`  [${ptn.label}] ${ptn.summary}`);
          }
        } else {
          lines.push(`
  (no project memory yet \u2014 first session)`);
        }
        const sv = deps.readLifetimeSavings();
        const totalTurns = (sv.sesModelTurns?.brain || 0) + (sv.sesModelTurns?.worker || 0);
        const brainPct = totalTurns > 0 ? Math.round(sv.sesModelTurns.brain / totalTurns * 100) : 0;
        if (totalTurns > 0) {
          const workerPct = 100 - brainPct;
          lines.push(`
\u{1F504} Model usage: Brain ${brainPct}% (${sv.sesModelTurns.brain} turns) / Worker ${workerPct}% (${sv.sesModelTurns.worker} tasks)`);
        }
        if (sv.sesTasks > 0.01 || sv.ltCache > 0.01) {
          lines.push(`\u{1F4B0} Session savings: $${sv.sesTasks.toFixed(2)} delegation + $${sv.ltCache.toFixed(2)} cache`);
        }
        if (sv.sesDuration > 0) {
          const hrs = Math.floor(sv.sesDuration / 3600);
          const mins = Math.floor(sv.sesDuration % 3600 / 60);
          lines.push(`\u23F1  Duration: ${hrs}h ${mins}m | Rate: $${sv.sesRatePerHour.toFixed(2)}/hr | Trend: ${sv.sesTrend === "down" ? "\u2193" : sv.sesTrend === "up" ? "\u2191" : "\u2192"}`);
        }
        const toolEntries = Object.entries(sv.sesToolBreakdown || {}).filter(([_, v]) => v > 5e-3).sort((a, b) => b[1] - a[1]);
        if (toolEntries.length > 0) {
          lines.push(`
\u{1F527} Per-tool savings:`);
          for (const [tool2, savings] of toolEntries) {
            lines.push(`  ${tool2.padEnd(14)} \u2014$${savings.toFixed(2)}`);
          }
        }
        const flowWarns = deps.getFlowWarns();
        const sid = String(process.pid || "?");
        const sessionFlowWarns = flowWarns.filter((w) => String(w.sid) === sid);
        const byRule = {};
        for (const w of sessionFlowWarns) {
          const key = w.rule_id || "unknown";
          byRule[key] = (byRule[key] || 0) + 1;
        }
        if (Object.keys(byRule).length > 0) {
          lines.push(`
\u26A0\uFE0F Flow violations (this session):`);
          for (const [rule, count] of Object.entries(byRule)) {
            lines.push(`  ${rule.padEnd(22)} ${count}`);
          }
        }
        const suggestions = [];
        if (totalTurns > 10 && sv.sesModelTurns.brain > sv.sesModelTurns.worker * 2) {
          if (!deps.loadSelection().delegation_enforce) {
            suggestions.push(`\u{1F4A1} High direct brain usage (${brainPct}%) \u2014 enable enforcement with \`trinity enforce on\` to block direct writes/edits`);
          } else {
            suggestions.push(`\u{1F4A1} High direct brain usage (${brainPct}%) \u2014 enforcement is ON but brain keeps editing directly; check plugin logs`);
          }
        }
        if (proj?.context7Bypasses > 3) {
          suggestions.push(`\u{1F4A1} ${proj.context7Bypasses} context7 bypasses \u2014 install context7 MCP to save ~$0.05/turn`);
        }
        if (proj?.researchChains > 2) {
          suggestions.push(`\u{1F4A1} ${proj.researchChains} research domain chains \u2014 consider caching or batching doc lookups`);
        }
        if ((sv.sesToolBreakdown?.webfetch || 0) > 0.1 || (sv.sesToolBreakdown?.websearch || 0) > 0.1) {
          suggestions.push(`\u{1F4A1} High webfetch/websearch usage \u2014 use context7 tools or scratchpad caching`);
        }
        if ((byRule["new-md-file"] || 0) > 2) {
          suggestions.push(`\u{1F4A1} ${byRule["new-md-file"]} new .md files \u2014 verify explicit user request for docs`);
        }
        if ((byRule["todo-comment"] || 0) > 5) {
          suggestions.push(`\u{1F4A1} ${byRule["todo-comment"]} TODO/FIXME left \u2014 clean up or track in issue tracker`);
        }
        if (deps.loadSelection().flow_enabled === false) {
          suggestions.push(`\u{1F4A1} Flow enforcer is OFF \u2014 enable with \`trinity flow on\` to catch anti-patterns`);
        }
        for (const ptn of deps.promotedProjectPatterns(fp2)) {
          suggestions.push(`Learned ${ptn.label} pattern: ${ptn.summary}`);
        }
        const credit = deps.loadCredit();
        if (credit < 40) {
          suggestions.push(`\u{1F4A1} Credit at ${credit}% \u2014 switch to medium/cheap slot with \`trinity medium\``);
        }
        if (suggestions.length > 0) {
          lines.push(`
\u{1F3AF} Optimization suggestions:`);
          for (const s of suggestions)
            lines.push(`  ${s}`);
        } else {
          lines.push(`
\u2705 No optimization suggestions \u2014 looking good!`);
        }
        lines.push(`
${L.repeat(40)}`);
        lines.push(`Run \`trinity help\` for all commands | \`research-audit\` for deep fetch analysis`);
        return lines.join("\n");
      }
      if (action === "report" && slot === "savings") {
        const L = "\u2501";
        const lines = [`== Savings Deep Report ==`];
        lines.push(L.repeat(40));
        const sv = deps.readLifetimeSavings();
        const ltTotal = sv.ltTasks + sv.ltCache;
        const toolTotals = {};
        let entryCount = 0;
        try {
          if (deps.existsSync(deps.SAVINGS_LEDGER_FILE)) {
            const raw = deps.readFileSync(deps.SAVINGS_LEDGER_FILE, "utf-8");
            for (const ln of raw.trim().split("\n")) {
              if (!ln.trim())
                continue;
              let rec = null;
              try {
                rec = JSON.parse(ln);
              } catch {
                continue;
              }
              if (!rec || rec.v !== 2)
                continue;
              const amt = Number(rec.amount_usd ?? 0);
              const tool2 = String(rec.tool || "unknown");
              toolTotals[tool2] = (toolTotals[tool2] || 0) + amt;
              entryCount++;
            }
          }
        } catch {
        }
        lines.push(`
By tool:`);
        const sortedTools = Object.entries(toolTotals).sort((a, b) => b[1] - a[1]);
        if (sortedTools.length === 0) {
          lines.push(`  (no ledger entries yet)`);
        } else {
          for (const [tool2, amt] of sortedTools) {
            lines.push(`  ${tool2.padEnd(14)} $${amt.toFixed(4)}`);
          }
        }
        const dayTotals = {};
        try {
          if (deps.existsSync(deps.SAVINGS_LEDGER_FILE)) {
            const raw = deps.readFileSync(deps.SAVINGS_LEDGER_FILE, "utf-8");
            for (const ln of raw.trim().split("\n")) {
              if (!ln.trim())
                continue;
              let rec = null;
              try {
                rec = JSON.parse(ln);
              } catch {
                continue;
              }
              if (!rec || rec.v !== 2)
                continue;
              const amt = Number(rec.amount_usd ?? 0);
              const day = (rec.at || "").slice(0, 10);
              if (day)
                dayTotals[day] = (dayTotals[day] || 0) + amt;
            }
          }
        } catch {
        }
        lines.push(`
By day:`);
        const sortedDays = Object.entries(dayTotals).sort((a, b) => a[0].localeCompare(b[0]));
        if (sortedDays.length === 0) {
          lines.push(`  (no daily data yet)`);
        } else {
          for (const [day, amt] of sortedDays) {
            lines.push(`  ${day}  $${amt.toFixed(4)}`);
          }
        }
        lines.push(`
Lifetime:`);
        lines.push(`  Delegation savings: $${sv.ltTasks.toFixed(4)}`);
        lines.push(`  Cache savings:     $${(sv.ltCache || 0).toFixed(4)}`);
        lines.push(`  Total:             $${ltTotal.toFixed(4)}`);
        lines.push(`  Ledger entries:    ${entryCount}`);
        lines.push(`
${L.repeat(40)}`);
        return lines.join("\n");
      }
      if (action === "patterns") {
        const fp2 = deps.currentProjectFingerprint || deps.projectFingerprint(deps.directory);
        const name = deps.currentProjectName || (deps.directory ? deps.directory.split("/").pop() : "unknown");
        if (slot === "clear") {
          const count = deps.clearProjectPatterns(fp2);
          return `Pattern memory cleared for "${name}" (${count} pattern${count === 1 ? "" : "s"} removed).`;
        }
        if (slot === "suggest") {
          const pstate = deps.loadProjectState();
          const currentBucket = pstate.project_hashes?.[fp2];
          const currentTech = currentBucket?.techStack || [];
          const currentKeys = /* @__PURE__ */ new Set([
            ...Object.keys(currentBucket?.userPatterns?.friction || {}),
            ...Object.keys(currentBucket?.userPatterns?.routines || {})
          ]);
          const candidates = [];
          for (const [otherFp, bucket] of Object.entries(pstate.project_hashes || {})) {
            if (otherFp === fp2)
              continue;
            const otherTech = bucket?.techStack || [];
            if (!otherTech.some((t) => currentTech.includes(t)))
              continue;
            for (const [kind, label] of [["friction", "friction"], ["routines", "routine"]]) {
              for (const [key, row] of Object.entries(bucket?.userPatterns?.[kind] || {})) {
                if (currentKeys.has(key))
                  continue;
                const sessions = new Set(row?.sessions || []).size;
                candidates.push({ key, label, summary: row?.summary || key, count: Number(row?.count || 0), sessions, lastSeen: row?.lastSeen || "" });
              }
            }
          }
          candidates.sort((a, b) => b.count - a.count || b.sessions - a.sessions);
          const top = candidates.slice(0, 5);
          const lines2 = ["[\u26A1 From similar tech stack projects]"];
          if (top.length === 0) {
            lines2.push("  No cross-project suggestions available yet.");
            return lines2.join("\n");
          }
          for (const c of top) {
            const tag = c.sessions >= 3 ? "promoted" : "learning";
            lines2.push(`  [${c.label}/${tag}] ${c.summary} (${c.count} hit${c.count === 1 ? "" : "s"}, ${c.sessions} session${c.sessions === 1 ? "" : "s"})`);
          }
          lines2.push("");
          lines2.push("Use `trinity patterns` to see this project's own patterns.");
          return lines2.join("\n");
        }
        const rows = deps.projectPatternRows(fp2);
        const lines = [`Project patterns - ${name}`];
        if (rows.length === 0) {
          lines.push("  No learned patterns yet.");
          lines.push("  Patterns promote into briefings after 3 separate sessions.");
          return lines.join("\n");
        }
        const promoted = rows.filter((r) => r.sessions >= 3).length;
        lines.push(`  ${rows.length} stored, ${promoted} promoted`);
        for (const r of rows.slice(0, 15)) {
          const tag = r.sessions >= 3 ? "promoted" : "learning";
          lines.push(`  [${r.label}/${tag}] ${r.summary} (${r.sessions} session${r.sessions === 1 ? "" : "s"}, ${r.count} hit${r.count === 1 ? "" : "s"})`);
        }
        lines.push("");
        lines.push("Use `trinity patterns clear` to clear project pattern memory.");
        return lines.join("\n");
      }
      if (action === "guard") {
        if (!deps.directory || !deps.existsSync(deps.directory))
          return "Working directory not accessible.";
        const techStack = deps.detectTechStack(deps.directory);
        const result = deps.ensureProjectDocs(deps.directory, techStack);
        if (result.created.length === 0 && result.skipped.length > 0) {
          return `AGENTS.md and README.md already exist. Use \`trinity guard\` to check for missing features.`;
        }
        const lines = [`Project Guard: ${deps.directory.split("/").pop() || "unknown"}`];
        for (const f of result.created)
          lines.push(`  Created ${f}`);
        for (const f of result.skipped)
          lines.push(`  Already exists: ${f}`);
        lines.push("");
        lines.push("AGENTS.md: defines AI agent behavioral rules \u2014 ASK BEFORE changing code.");
        lines.push("README.md: auto-maintained feature documentation \u2014 keep it updated.");
        return lines.join("\n");
      }
      if (action === "todo") {
        const todos = deps.loadTodos();
        const pending = todos.filter((t) => t.status === "pending");
        if (pending.length === 0)
          return "No pending todos.";
        const lines = ["Pending todos: " + pending.length];
        for (const t of pending.slice(0, 20)) {
          lines.push("  #" + (t.id || "").slice(0, 8) + " [" + t.priority + "] " + (t.content || "").slice(0, 60));
        }
        if (pending.length > 20)
          lines.push("  ... and " + (pending.length - 20) + " more");
        return lines.join("\n");
      }
      if (action === "todo-done") {
        if (!slot)
          return "Usage: trinity todo-done <id>\nMark a todo as done by its ID.";
        deps.markTodoDone(slot);
        return "Todo " + slot + " marked done.";
      }
      if (action === "todo-sync") {
        const count = deps.syncFlowTodosToNative((entry) => {
          deps.upsertTodo(entry);
        });
        return "Synced " + count + " flow TODO(s) to native todo list.";
      }
      if (action === "api-token") {
        if (!token)
          return "Usage: trinity api-token <token>\nProvide a valid VIBEOS_API_TOKEN to enable remote control-vector computation.";
        deps.setApiToken(token);
        return "[vibeOS] API token updated. Remote API re-enabled.";
      }
      if (action === "rebuild") {
        const providers = deps._loadOpenCodeProviders();
        const auth = deps._readAuth();
        const models = await deps.discoverAvailableModels(providers, auth);
        const ranked = deps.classifyAndRankModels(models);
        if (!ranked) {
          return "\u274C No models discovered from any configured provider.";
        }
        const probed = { brain: null, medium: null, cheap: null };
        const failed = [];
        const candidates = [.../* @__PURE__ */ new Set([ranked.brain.id, ranked.medium.id, ranked.cheap.id, ...models.map((m) => m.id)])];
        for (const id2 of candidates) {
          if (probed.brain)
            break;
          const ok = await deps.probeModel(id2, auth);
          if (ok)
            probed.brain = models.find((m) => m.id === id2) || { id: id2, cost: deps._modelCost(id2), tier: deps._modelTier(id2) };
          else
            failed.push("brain: " + id2);
        }
        const byCost = [...models].sort((a, b) => a.cost - b.cost);
        for (const m of byCost) {
          if (probed.cheap)
            break;
          if (m.id === probed.brain?.id)
            continue;
          const ok = await deps.probeModel(m.id, auth);
          if (ok)
            probed.cheap = m;
          else if (!failed.some((f) => f.endsWith(m.id)))
            failed.push("cheap: " + m.id);
        }
        for (const id2 of candidates) {
          if (probed.medium)
            break;
          if (id2 === probed.brain?.id || id2 === probed.cheap?.id)
            continue;
          const ok = await deps.probeModel(id2, auth);
          if (ok)
            probed.medium = models.find((m) => m.id === id2) || { id: id2, cost: deps._modelCost(id2), tier: deps._modelTier(id2) };
          else if (!failed.some((f) => f.endsWith(id2)))
            failed.push("medium: " + id2);
        }
        if (!probed.brain) {
          return "\u274C No models responded to probe. Try checking your API keys.\n" + (failed.length > 0 ? "Failed:\n  " + failed.join("\n  ") : "No models discovered.");
        }
        if (!probed.medium)
          probed.medium = probed.brain;
        if (!probed.cheap)
          probed.cheap = probed.brain;
        try {
          const tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"));
          tiers.trinity = {
            brain: { oc: probed.brain.id, cc: deps.modelToCcAlias(probed.brain.id) },
            medium: { oc: probed.medium.id, cc: deps.modelToCcAlias(probed.medium.id) },
            cheap: { oc: probed.cheap.id, cc: deps.modelToCcAlias(probed.cheap.id) }
          };
          const _tmp = deps.TIERS_FILE + ".tmp." + Date.now();
          deps.writeFileSync(_tmp, JSON.stringify(tiers, null, 2) + "\n", "utf-8");
          deps.renameSync(_tmp, deps.TIERS_FILE);
        } catch (err) {
          return "\u274C Failed to write model-tiers.json: " + err.message;
        }
        try {
          deps.applySlot("brain");
        } catch (e) {
          console.error("[vibeOS] auto-activate brain failed:", e.message);
        }
        const lines = [
          "\u{1F50D} Auto-detected models from configured providers:",
          "  \u{1F9E0} brain  \u2192 " + probed.brain.id + " (tier: " + probed.brain.tier + ", $" + probed.brain.cost.toFixed(4) + "/turn) \u2705",
          "  \u2699  medium \u2192 " + probed.medium.id + " (tier: " + probed.medium.tier + ", $" + probed.medium.cost.toFixed(4) + "/turn) \u2705",
          "  \u26A1 cheap  \u2192 " + probed.cheap.id + " (tier: " + probed.cheap.tier + ", $" + probed.cheap.cost.toFixed(4) + "/turn) \u2705"
        ];
        if (failed.length > 0) {
          lines.push("", "Probe failures (skipped):");
          for (const f of failed)
            lines.push("  \u274C " + f);
        }
        lines.push("", "\u2705 model-tiers.json updated.", "\u{1F9E0} Brain slot auto-activated: " + probed.brain.id);
        return lines.join("\n");
      }
      if (action === "diagnose") {
        const results = [];
        const ocConfig = join9(deps.USER_HOME, ".config/opencode/opencode.json");
        const checks = [
          { path: deps.TIERS_FILE, label: "model-tiers.json" },
          { path: ocConfig, label: "opencode.json" },
          { path: deps.STATE_FILE, label: "delegation-state.json" }
        ];
        for (const c of checks) {
          results.push({
            ok: deps.existsSync(c.path),
            okLabel: deps.existsSync(c.path) ? "\u2705" : "\u274C",
            label: c.label,
            detail: deps.existsSync(c.path) ? "exists" : "missing",
            fix: deps.existsSync(c.path) ? null : c.label === "model-tiers.json" ? "run `trinity rebuild` to create it" : void 0
          });
        }
        try {
          const tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"));
          for (const s of ["brain", "medium", "cheap"]) {
            const m = tiers?.trinity?.[s]?.oc || "";
            const ok = m.length > 0 && !m.toLowerCase().includes("placeholder");
            results.push({
              ok,
              okLabel: ok ? "\u2705" : "\u274C",
              label: `${s} slot`,
              detail: ok ? m : m.length > 0 ? `placeholder: ${m}` : "unset",
              fix: ok ? null : "run `trinity rebuild` to auto-assign"
            });
          }
        } catch {
          for (const s of ["brain", "medium", "cheap"]) {
            results.push({ ok: false, okLabel: "\u274C", label: `${s} slot`, detail: "cannot read model-tiers.json", fix: "run `trinity rebuild` to create it" });
          }
        }
        if (deps.currentModel || !deps.existsSync(deps.TIERS_FILE)) {
          try {
            const auth = deps._readAuth();
            const ok = await deps.probeModel(deps.currentModel, auth);
            results.push({
              ok,
              okLabel: ok ? "\u2705" : "\u274C",
              label: "model probe",
              detail: ok ? "API responsive" : `probe failed: ${deps.currentModel}`
            });
          } catch {
            results.push({ ok: false, okLabel: "\u274C", label: "model probe", detail: "exception during probe" });
          }
        } else {
          results.push({ ok: false, okLabel: "\u274C", label: "model probe", detail: "no current model detected" });
        }
        const credit = deps.loadCredit();
        let budget = 50;
        let totalBal = 0;
        try {
          const j = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"));
          if (j?.selection?.monthly_budget_usd)
            budget = j.selection.monthly_budget_usd;
        } catch {
        }
        try {
          const cache = deps.safeJsonParse(deps.readFileSync(deps.CREDIT_CACHE_F, "utf-8"));
          if (cache?.total != null)
            totalBal = cache.total;
        } catch {
        }
        const remaining = budget > 0 ? (Math.min(credit, 150) / 100 * budget).toFixed(2) : "?";
        const creditOk = credit >= 40;
        results.push({
          ok: creditOk,
          okLabel: creditOk ? "\u2705" : "\u274C",
          label: "credits",
          detail: `${credit}%${totalBal > 0 ? ` ($${totalBal.toFixed(2)} of $${budget})` : ` (of $${budget})`}`,
          fix: creditOk ? null : "run `trinity medium` to reduce spend"
        });
        try {
          const state = deps.safeJsonParse(deps.readFileSync(deps.STATE_FILE, "utf-8"));
          const sid = String(process.pid || "?");
          const ses = state?.sessions?.[sid];
          const delegationCount = ses?.warns?.length || 0;
          const cacheSavings = deps.formatUsd(state?.lifetime?.cache_savings_usd || 0);
          const fw = (state?.flow_warns || []).filter((w) => String(w.sid) === sid);
          const flowW = fw.filter((w) => w.severity === "warn").length;
          const flowH = fw.filter((w) => w.severity === "hint").length;
          const tdd = state?.lifetime?.tdd_enforced ?? 0;
          const enf = deps.loadSelection().delegation_enforce ? " ENFORCE" : "";
          results.push({
            ok: true,
            okLabel: "\u2705",
            label: "session",
            detail: `${delegationCount} delegates, $${cacheSavings} cache, ${flowW}w/${flowH}h flow, ${tdd} TDD${enf}`
          });
        } catch {
          results.push({ ok: true, okLabel: "\u2705", label: "session", detail: "no state file yet" });
        }
        const okCount = results.filter((r) => r.ok).length;
        results.sort((a, b) => a.ok === b.ok ? 0 : a.ok ? 1 : -1);
        const lines = [
          "\u{1F50D}  vibeOS \u2014 Self Diagnostic",
          "=".repeat(40),
          ""
        ];
        for (const r of results) {
          lines.push(`  ${r.okLabel} ${r.label}: ${r.detail}`);
          if (!r.ok && r.fix)
            lines.push(`    \u2192 ${r.fix}`);
        }
        if (okCount === results.length) {
          lines.push("", `\u2705 All ${results.length} checks passed`);
        } else {
          const failCount = results.length - okCount;
          lines.push("", `\u274C ${failCount}/${results.length} checks failed \u2014 fix items above`);
        }
        return lines.join("\n");
      }
      if (action === "repair-state") {
        const mode = slot || "preview";
        if (mode !== "preview" && mode !== "apply") {
          return "\u274C Use `trinity repair-state preview` or `trinity repair-state apply`.";
        }
        const dstFp = deps.currentProjectFingerprint || deps.projectFingerprint(deps.directory);
        const name = deps.currentProjectName || (deps.directory ? deps.directory.split("/").pop() : "unknown");
        const idx = deps.reportsIndex();
        const byFp = /* @__PURE__ */ new Map();
        for (const r of idx.reports || []) {
          if (r.project !== name)
            continue;
          byFp.set(r.fingerprint, (byFp.get(r.fingerprint) || 0) + 1);
        }
        const candidates = [...byFp.entries()].filter(([fp2, count]) => fp2 && fp2 !== dstFp && count > 0).sort((a, b) => b[1] - a[1]);
        if (candidates.length === 0) {
          return `\u2705 No duplicate fingerprint candidates found for project "${name}".`;
        }
        const [srcFp, reportCount] = candidates[0];
        const pstate = deps.loadProjectState();
        const dstBucket = deps.ensureProjectBucket(pstate, dstFp);
        const srcBucket = pstate.project_hashes?.[srcFp] || null;
        const merged = deps.mergeProjectBucket(dstBucket, srcBucket);
        const lines = [
          `\u{1F6E0} State repair (${mode})`,
          `  project: ${name}`,
          `  target:  ${dstFp}`,
          `  source:  ${srcFp}`,
          `  reports to relabel: ${reportCount}`,
          `  sessions: ${dstBucket.totalSessions || 0} + ${srcBucket?.totalSessions || 0} -> ${merged.totalSessions}`,
          `  bypasses: ${dstBucket.context7Bypasses || 0} + ${srcBucket?.context7Bypasses || 0} -> ${merged.context7Bypasses}`,
          `  researchChains(max): ${Math.max(dstBucket.researchChains || 0, srcBucket?.researchChains || 0)}`
        ];
        if (mode === "preview") {
          lines.push("", "Run `trinity repair-state apply` to execute with backups.");
          return lines.join("\n");
        }
        const backups = [];
        const b1 = deps.backupFile(deps.PROJECT_STATE_FILE, "repair-state");
        if (b1)
          backups.push(b1);
        const b2 = deps.backupFile(deps.REPORTS_INDEX, "repair-state");
        if (b2)
          backups.push(b2);
        pstate.project_hashes ??= {};
        pstate.project_hashes[dstFp] = merged;
        delete pstate.project_hashes[srcFp];
        deps.saveProjectState(pstate);
        let relabeled = 0;
        for (const r of idx.reports || []) {
          if (r.project === name && r.fingerprint === srcFp) {
            r.fingerprint = dstFp;
            relabeled++;
          }
        }
        deps.saveReportsIndex(idx);
        for (const r of idx.reports || []) {
          if (r.project !== name || r.fingerprint !== dstFp)
            continue;
          const rf = join9(deps.REPORTS_DIR, `${r.id}.json`);
          try {
            if (!deps.existsSync(rf))
              continue;
            const data = deps.safeJsonParse(deps.readFileSync(rf, "utf-8"));
            if (data?.meta?.project === name && data?.meta?.fingerprint === srcFp) {
              data.meta.fingerprint = dstFp;
              deps.writeFileSync(rf, JSON.stringify(data, null, 2) + "\n");
            }
          } catch {
          }
        }
        lines.push("");
        lines.push(`\u2705 Applied. Relabeled ${relabeled} report index entries.`);
        if (backups.length > 0) {
          lines.push("Backups:");
          for (const b of backups)
            lines.push(`  - ${b}`);
        }
        return lines.join("\n");
      }
      if (action === "blackbox") {
        const mode = slot || "status";
        if (mode === "on") {
          deps._blackboxEnabled = true;
          const state = deps.loadBlackboxState();
          state.enabled = true;
          deps.saveBlackboxState(state);
          return "\u2705 Blackbox decision engine ENABLED \u2014 will track resolution state and enhance system prompts.";
        }
        if (mode === "off") {
          deps._blackboxEnabled = false;
          const state = deps.loadBlackboxState();
          state.enabled = false;
          deps.saveBlackboxState(state);
          return "\u23F8 Blackbox decision engine DISABLED.";
        }
        if (mode === "reset") {
          deps._blackboxTracker = null;
          const state = deps.loadBlackboxState();
          const sid = deps._OC_SID;
          delete state.sessions[sid];
          deps.saveBlackboxState(state);
          return "\u{1F504} Blackbox resolution tracker RESET.";
        }
        if (mode === "status") {
          const bbState = deps.loadBlackboxState();
          const enabled = deps._blackboxEnabled || bbState.enabled;
          const lines = [`Blackbox Decision Engine: ${enabled ? "ON" : "OFF"}`];
          if (enabled) {
            const res = deps._latestBlackboxState || deps.getBlackboxResolution();
            if (res) {
              lines.push(`  Resolution: ${res.resolution}`);
              lines.push(`  Sub-regime: ${res.sub_regime}`);
              lines.push(`  Momentum: ${res.momentum > 0 ? "\u2191" : res.momentum < 0 ? "\u2193" : "\u2192"} ${res.momentum.toFixed(2)}`);
              lines.push(`  Interactions: ${res.n_interactions}`);
              if (res.is_looping)
                lines.push("  \u26A0 Looping detected \u2014 consider a fresh perspective");
            } else {
              lines.push("  No resolution data yet \u2014 start a decision session");
            }
            if (deps.currentProjectFingerprint) {
              lines.push("");
              lines.push(`  Project: ${deps.currentProjectName || "unknown"}`);
              const projectSessions = Object.entries(bbState.sessions || {}).filter(([k, v]) => v.project_fingerprint === deps.currentProjectFingerprint);
              lines.push(`  Cross-session history: ${projectSessions.length} session(s) for this project`);
            }
          }
          lines.push("");
          lines.push("Usage: trinity blackbox on|off|status|reset");
          return lines.join("\n");
        }
        return `\u274C Use \`trinity blackbox on|off|status|reset\``;
      }
      if (action === "help") {
        return [
          "vibeOS \u2014 trinity commands",
          "",
          "TIERS:",
          "  trinity status            See plugin state, credit, model assignment",
          "  trinity brain             Switch to brain tier (most capable)",
          "  trinity medium            Switch to medium tier (balanced)",
          "  trinity cheap             Switch to cheap tier (most savings)",
          "  trinity rebuild           Auto-detect available models",
          "",
          "CONTROLS:",
          "  trinity enable/disable    Toggle vibeOS plugin on/off",
          "  trinity enforce on        Block brain-tier writes/edits (save $$)",
          "  trinity lock on/off       Lock model at session start (skip auto-reconcile)",
          "  trinity thinking full|brief|off  Set reasoning depth",
          "",
          "GUARDRAILS:",
          "  trinity flow on/off       Toggle flow enforcer (code quality checks)",
          "  trinity tdd on/off        Toggle auto test skeleton creation",
          "  trinity guard             Ensure AGENTS.md/README.md exist and are current",
          "  trinity api-token        Update VIBEOS_API_TOKEN and re-enable remote API",
          "  trinity api-token        Update VIBEOS_API_TOKEN and re-enable remote API",
          "  trinity flow              Show flow violations this session",
          "",
          "DIAGNOSTICS:",
          "  trinity diagnose          Self-check: config, files, model probes, budget",
          "  trinity project           Project analytics and optimization tips",
          "  trinity patterns          Show learned friction/routine patterns",
          "  trinity patterns suggest  Suggest relevant patterns from similar stack projects",
          "  trinity patterns clear    Clear learned patterns for this project",
          "",
          "REPAIR:",
          "  trinity repair-state      Fix fingerprint collisions (preview/apply)",
          "",
          "DECISION ENGINE:",
          "  trinity blackbox on/off   Toggle theWay blackbox decision engine",
          "  trinity blackbox status   View resolution state, momentum, project history",
          "  trinity blackbox reset    Clear resolution tracker for current session"
        ].join("\n");
      }
      return `\u274C Unknown action: ${action}`;
    }
  };
}

// src/lib/trinity-rebuild.js
import { readFileSync as readFileSync10, existsSync as existsSync10 } from "node:fs";
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
  const high = HIGH_TIER_RE?.test?.(id2);
  if (high)
    return "high";
  const mid = MID_TIER_RE?.test?.(id2);
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
async function probeModel(modelId, auth) {
  if (!modelId || !auth)
    return true;
  const id2 = String(modelId || "");
  if (id2.startsWith("opencode/"))
    return true;
  let apiUrl, apiKey, reqModel;
  if (id2.startsWith("deepseek/")) {
    apiUrl = "https://api.deepseek.com/chat/completions";
    apiKey = auth.deepseek?.key;
    reqModel = id2.replace("deepseek/", "");
  } else if (id2.startsWith("openrouter/")) {
    apiUrl = "https://openrouter.ai/api/v1/chat/completions";
    apiKey = auth.openrouter?.key;
    reqModel = id2.replace("openrouter/", "");
  } else {
    return true;
  }
  if (!apiKey) {
    console.error("[vibeOS] probeModel: no API key for " + id2);
    return false;
  }
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: reqModel,
        messages: [{ role: "user", content: "ok" }],
        max_tokens: 1
      }),
      signal: AbortSignal.timeout(8e3)
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[vibeOS] probeModel FAIL " + id2 + ": HTTP " + res.status + " " + errBody.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error("[vibeOS] probeModel ERROR " + id2 + ": " + err.message);
    return false;
  }
}

// src/lib/hooks/footer.js
import { readFileSync as readFileSync12, appendFileSync as appendFileSync6, mkdirSync as mkdirSync9 } from "node:fs";
import { join as join13 } from "node:path";
import { homedir as homedir9, tmpdir as tmpdir6 } from "node:os";

// src/lib/hooks/chat-transform.js
import { readFileSync as readFileSync11, writeFileSync as writeFileSync10, appendFileSync as appendFileSync5, existsSync as existsSync11, mkdirSync as mkdirSync8 } from "node:fs";
import { join as join12, basename as basename6 } from "node:path";
import { homedir as homedir8 } from "node:os";
import { createHash as createHash3 } from "node:crypto";

// src/lib/mode-policy.js
var BASELINE_MODE = "budget";
var LOOP_REGIMES = /* @__PURE__ */ new Set(["LOOPING", "DIVERGENT"]);
var QUALITY_REGIMES = /* @__PURE__ */ new Set(["CONVERGING", "CLOSED"]);
var MANUAL_MODES = /* @__PURE__ */ new Set(["balanced", "quality", "speed", "longrun"]);
function normalizeMode(mode) {
  const normalized = String(mode || BASELINE_MODE).toLowerCase();
  if (normalized === "auto" || normalized === "")
    return BASELINE_MODE;
  if (normalized === "budget" || normalized === "quality" || normalized === "speed" || normalized === "longrun" || normalized === "balanced") {
    return normalized;
  }
  return BASELINE_MODE;
}
function normalizeRegime(regime) {
  return String(regime || "INIT").toUpperCase();
}
function isManualOverride(mode) {
  return MANUAL_MODES.has(normalizeMode(mode));
}
function chooseEpisodeMode(regime, suggestedMode, stress) {
  if (LOOP_REGIMES.has(regime) || suggestedMode === "speed")
    return "speed";
  if (QUALITY_REGIMES.has(regime) || suggestedMode === "quality")
    return "quality";
  return stress > 1.5 ? "quality" : "budget";
}
function defaultPolicy() {
  return {
    active: false,
    active_mode: BASELINE_MODE,
    baseline_mode: BASELINE_MODE,
    reason: null,
    episode_id: null,
    problem_streak: 0,
    stable_streak: 0,
    last_sub_regime: "INIT",
    last_stress: 0,
    last_outcome: null,
    updated_at: null,
    started_at: null
  };
}
function modeToSlot(mode) {
  const normalized = normalizeMode(mode);
  if (normalized === "speed")
    return "medium";
  if (normalized === "quality" || normalized === "longrun")
    return "brain";
  return "cheap";
}
function loadSessionPolicy() {
  const state = loadBlackboxState();
  if (!state.sessions || typeof state.sessions !== "object")
    state.sessions = {};
  const sid = _OC_SID;
  if (!state.sessions[sid] || typeof state.sessions[sid] !== "object")
    state.sessions[sid] = {};
  const session = state.sessions[sid];
  if (!session.mode_policy || typeof session.mode_policy !== "object") {
    session.mode_policy = defaultPolicy();
  } else {
    session.mode_policy.baseline_mode = session.mode_policy.baseline_mode || BASELINE_MODE;
    session.mode_policy.active_mode = session.mode_policy.active_mode || BASELINE_MODE;
    session.mode_policy.problem_streak = Number(session.mode_policy.problem_streak || 0);
    session.mode_policy.stable_streak = Number(session.mode_policy.stable_streak || 0);
  }
  return { state, session, policy: session.mode_policy };
}
function persistSessionPolicy(state, session, policy, mode) {
  policy.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  session.mode_policy = policy;
  session.active_slot = modeToSlot(mode);
  saveBlackboxState(state);
  return {
    active: !!policy.active,
    mode,
    reason: policy.reason || BASELINE_MODE,
    shouldPersistRequestedMode: false
  };
}
function peekBudgetFirstMode(input = {}) {
  const requestedMode = normalizeMode(input.requestedMode);
  if (isManualOverride(requestedMode)) {
    return {
      active: false,
      mode: requestedMode,
      reason: "manual",
      shouldPersistRequestedMode: true
    };
  }
  const { policy } = loadSessionPolicy();
  if (policy.active && policy.active_mode && normalizeMode(policy.active_mode) !== BASELINE_MODE) {
    return {
      active: true,
      mode: normalizeMode(policy.active_mode),
      reason: policy.reason || "episode",
      shouldPersistRequestedMode: false
    };
  }
  return {
    active: false,
    mode: BASELINE_MODE,
    reason: "budget",
    shouldPersistRequestedMode: false
  };
}
function applyBudgetFirstMode(input = {}) {
  const requestedMode = normalizeMode(input.requestedMode);
  if (isManualOverride(requestedMode)) {
    return {
      active: false,
      mode: requestedMode,
      reason: "manual",
      shouldPersistRequestedMode: true
    };
  }
  return withFileLock(BLACKBOX_STATE_FILE, () => {
    const { state, session, policy } = loadSessionPolicy();
    const interactions = Number(input.nInteractions ?? state.sessions?.[_OC_SID]?.n_interactions ?? 0);
    const regime = normalizeRegime(input.subRegime || policy.last_sub_regime);
    const stress = Number(input.stress ?? policy.last_stress ?? 0);
    const suggested = normalizeMode(input.suggestedMode);
    policy.baseline_mode = BASELINE_MODE;
    policy.last_sub_regime = regime;
    policy.last_stress = stress;
    policy.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    if (policy.active && policy.active_mode && normalizeMode(policy.active_mode) !== BASELINE_MODE) {
      return persistSessionPolicy(state, session, policy, policy.active_mode);
    }
    const shouldStartEpisode = LOOP_REGIMES.has(regime) && interactions >= 2 || QUALITY_REGIMES.has(regime) || Number(policy.problem_streak || 0) >= 2 || Number(policy.problem_streak || 0) >= 1 && stress > 1.5;
    if (shouldStartEpisode) {
      const nextMode = chooseEpisodeMode(regime, suggested, stress);
      policy.active = true;
      policy.active_mode = nextMode;
      policy.reason = LOOP_REGIMES.has(regime) ? "loop" : QUALITY_REGIMES.has(regime) ? "quality" : stress > 1.5 ? "stress" : "problem";
      policy.episode_id = policy.episode_id || `${_OC_SID}:${Date.now()}`;
      policy.started_at = policy.started_at || (/* @__PURE__ */ new Date()).toISOString();
      policy.stable_streak = 0;
      return persistSessionPolicy(state, session, policy, nextMode);
    }
    policy.active = false;
    policy.active_mode = BASELINE_MODE;
    policy.reason = null;
    return persistSessionPolicy(state, session, policy, BASELINE_MODE);
  });
}
function recordBudgetFirstOutcome(input = {}) {
  const outcome = String(input.outcome || "").toLowerCase();
  if (outcome !== "positive" && outcome !== "negative") {
    return peekBudgetFirstMode({ requestedMode: BASELINE_MODE });
  }
  return withFileLock(BLACKBOX_STATE_FILE, () => {
    const { state, session, policy } = loadSessionPolicy();
    const regime = normalizeRegime(input.subRegime || policy.last_sub_regime);
    const stress = Number(input.stress ?? policy.last_stress ?? 0);
    policy.last_sub_regime = regime;
    policy.last_stress = stress;
    policy.last_outcome = outcome;
    policy.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    if (outcome === "negative") {
      policy.problem_streak = Math.min(5, Number(policy.problem_streak || 0) + 1);
      policy.stable_streak = 0;
      return persistSessionPolicy(state, session, policy, policy.active && normalizeMode(policy.active_mode) !== BASELINE_MODE ? normalizeMode(policy.active_mode) : BASELINE_MODE);
    }
    policy.problem_streak = 0;
    policy.stable_streak = Number(policy.stable_streak || 0) + 1;
    if (policy.active) {
      const calmEnough = stress <= 1;
      if (calmEnough || policy.stable_streak >= 1) {
        policy.active = false;
        policy.active_mode = BASELINE_MODE;
        policy.reason = null;
        policy.episode_id = null;
        policy.stable_streak = 0;
      }
    }
    return persistSessionPolicy(state, session, policy, policy.active && normalizeMode(policy.active_mode) !== BASELINE_MODE ? normalizeMode(policy.active_mode) : BASELINE_MODE);
  });
}

// src/lib/index-helpers.js
import { join as join11 } from "node:path";
import { writeFileSync as writeFileSync9 } from "node:fs";

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
            writeFileSync9(sp, JSON.stringify({ sid, total_savings: s.lifetime.total_savings_usd, last_reason: reason }), "utf8");
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
  // Realistic: v4-pro (0.00057) - v4-flash (0.000182) = 0.000388/turn
  WRITE_EDIT: 4e-4,
  SOFT_QUOTA: 1e-4,
  // DeepSeek cache: (0.14 - 0.0028)/1M * ~1000 tokens = 0.00014
  CONTEXT7: 14e-5,
  OPUS_DISABLE: 0.03
};
var WARN_ON_DIRECT = /* @__PURE__ */ new Set(["write", "edit", "notebookedit"]);
var SOFT_QUOTA = /* @__PURE__ */ new Set(["bash", "glob", "grep", "read", "webfetch", "websearch"]);
var FREE = /* @__PURE__ */ new Set(["question", "skill", "trinity", "report-list", "report-read", "report-save", "research-audit"]);
var MONITOR = /* @__PURE__ */ new Set(["todowrite"]);
var COMPRESS_THRESHOLD2 = 2e3;
var KEEP_HOT = 10;
var COMPRESS_MARKER = "[ctx-compressed-v1]";
var PROTOCOL_MARKER = "[wbp-v1]";
var PROTOCOL_TEXT = PROTOCOL_MARKER + " [Worker-to-Brain Report Protocol] When synthesizing the preceding Task output: 1) EXTRACT core findings/data. 2) REFORMAT into bullet points. 3) VERIFY against the original ask. 4) SYNTHESIZE into final response.";

// src/lib/templates.js
var TEMPLATES = {
  save: {
    tier_bias: "cheap",
    thinking_mode: "off",
    enforcement_mode: "relaxed",
    flow_mode: "audit",
    tdd_mode: "lazy",
    context7_urgency: "required",
    wbp_verbosity: "minimal",
    agent_mode: "auto",
    directive: "[SAVE mode] Cost efficiency. Minimize token usage. Combine independent tool calls with && or ;. Prefer context7 over WebSearch/WebFetch for docs. Skip unnecessary verification. Batch parallel Task subagents."
  },
  quality: {
    tier_bias: "brain",
    thinking_mode: "full",
    enforcement_mode: "strict",
    flow_mode: "strict",
    tdd_mode: "quality",
    context7_urgency: "preferred",
    wbp_verbosity: "verbose",
    agent_mode: "plan",
    directive: "[QUALITY mode] High quality output. Full verification of all results. Production-grade code. Write tests covering all paths and edge cases. Validate outputs before presenting. Do not cut corners."
  },
  security: {
    tier_bias: "brain",
    thinking_mode: "brief",
    enforcement_mode: "strict",
    flow_mode: "strict",
    tdd_mode: "quality",
    context7_urgency: "preferred",
    wbp_verbosity: "normal",
    agent_mode: "plan",
    directive: "[SECURITY mode] Defense-in-depth. Define the threat model before writing code. Validate all inputs. Never expose secrets or credentials. Verify each defense handles its threat. Consider: injection, broken auth, data exposure, logic errors, race conditions."
  }
};
var DEFAULT_TEMPLATE = "save";
var SEC_KEYWORDS = /\b(security|vuln|exploit|injection|xss|csrf|secret|credential|token leak|auth bypass|privacy|breach|backdoor|sql injection|cve)\b/i;
function detectSecuritySignal(text) {
  if (!text || typeof text !== "string")
    return false;
  return SEC_KEYWORDS.test(text);
}
function detectBudgetSignal(creditPercent) {
  return creditPercent < 40;
}
var _prevStress = 0;
function detectStressSpike(stressScore) {
  const delta = stressScore - _prevStress;
  _prevStress = stressScore;
  return delta > 0.3 && stressScore > 0.5;
}
function resolveTemplate(prevTemplate, stressScore, userText, creditPercent) {
  if (detectSecuritySignal(userText))
    return "security";
  if (detectBudgetSignal(creditPercent))
    return "save";
  if (detectStressSpike(stressScore))
    return "quality";
  return prevTemplate || DEFAULT_TEMPLATE;
}
var _turnCount = 0;
function shouldInjectTemplate(template, prevTemplate) {
  _turnCount++;
  if (template !== prevTemplate)
    return true;
  if (_turnCount % 10 === 0)
    return true;
  return false;
}

// src/lib/hooks/chat-transform.js
var latestUserIntent = null;
var _OC_SID4 = "opencode-" + (process.pid || "x") + "-" + Date.now();
var _latestBlackboxState3 = null;
var _latestBlackboxLoopMsg2 = null;
var _latestBlackboxPivotMsg2 = null;
var _prevBlackboxRegime = null;
var _currentTemplate = DEFAULT_TEMPLATE;
var _prevTemplate = null;
var _turnCountInject = 0;
var correctionSeenKeys = /* @__PURE__ */ new Set();
async function apiComputeControlVector(state, action, optimizationMode) {
  try {
    const res = await remoteCall("blackboxControlVector", [state, action, optimizationMode], null);
    if (res?.control_vector)
      return res.control_vector;
  } catch {
  }
  return computeControlVector(state, action, optimizationMode);
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
  const label = currentProjectName || (directory3 ? basename6(directory3) : "");
  if (!label)
    return null;
  return `[project memory] Active project: ${label}. Stay focused on the current repository and prefer the existing workflow.`;
}
function ensureProjectSkill(dir, fp2) {
  const skillsDir = join12(dir, ".opencode", "skills");
  const projectName = basename6(dir);
  const skillDir = join12(skillsDir, projectName);
  const skillPath = join12(skillDir, "SKILL.md");
  if (existsSync11(skillPath)) {
    return { created: false, skipped: true, path: skillPath };
  }
  const promoted = promotedProjectPatterns(fp2);
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
    mkdirSync8(skillDir, { recursive: true });
    writeFileSync10(skillPath, content, "utf-8");
    console.error(`[vibeOS] Project Guard: created .opencode/skills/${projectName}/SKILL.md`);
    return { created: true, path: skillPath, skipped: false };
  } catch (err) {
    console.error(`[vibeOS] Project Guard: failed to create skill for ${projectName}: ${err.message}`);
    return { created: false, skipped: false };
  }
}
function syncControlSettings(cv, options = {}) {
  if (!cv)
    return;
  try {
    const sid = _OC_SID4;
    const persistOptimizationMode = options.persistOptimizationMode !== false;
    const currentSel = loadSelection();
    const writeIf = (key, val) => {
      const sel = loadSelection();
      if (sel[key] !== val)
        writeSelection(key, val);
    };
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
    if (cv.thinking_mode && currentSel.thinking_level !== "full")
      writeIf("thinking_level", cv.thinking_mode);
    const userOptMode = loadSessionOptMode(sid + "_opt") || loadOptimizationMode();
    if (persistOptimizationMode && cv.optimization_mode && userOptMode !== "auto") {
      if (userOptMode !== cv.optimization_mode) {
        writeSessionSlot2(sid + "_opt", cv.optimization_mode);
        saveOptimizationMode(cv.optimization_mode);
      }
    }
    const slot = cv.tier_bias;
    if (slot && slot !== "auto") {
      const existingSlot = loadSessionSlot(sid);
      if (existingSlot !== slot) {
        writeSessionSlot2(sid, slot);
        const applied = applySlot2(slot);
        if (!applied?.ok) {
          console.error(`[vibeOS] failed to apply slot ${slot}: ${applied?.reason || "unknown"}`);
        }
      }
    }
    if (cv.agent_mode) {
      try {
        const OC_CONFIG = TRINITY_OPENCODE_CONFIG || join12(homedir8(), ".config/opencode/opencode.json");
        if (existsSync11(OC_CONFIG)) {
          const oc = safeJsonParse3(readFileSync11(OC_CONFIG, "utf-8"));
          if (oc.default_agent !== cv.agent_mode) {
            oc.default_agent = cv.agent_mode;
            writeFileSync10(OC_CONFIG, JSON.stringify(oc, null, 2) + "\n");
          }
        }
      } catch {
      }
    }
    if (cv.agent_mode === "plan" && latestUserIntent) {
      const planDone = /^(yes|go ahead|proceed|looks? good|do it|sounds? good|perfect|great|nice|ok|okay|let.s do it|implement|execute|make it|build it|write it|start)\b/i.test(latestUserIntent.trim());
      if (planDone) {
        try {
          const OC_CONFIG = TRINITY_OPENCODE_CONFIG || join12(homedir8(), ".config/opencode/opencode.json");
          if (existsSync11(OC_CONFIG)) {
            const oc = safeJsonParse3(readFileSync11(OC_CONFIG, "utf-8"));
            if (oc.default_agent === "plan") {
              oc.default_agent = "orchestrator";
              writeFileSync10(OC_CONFIG, JSON.stringify(oc, null, 2) + "\n");
            }
          }
        } catch {
        }
      }
    }
  } catch {
  }
}
function pushSystem(output, text) {
  if (text && Array.isArray(output?.system)) {
    output.system.push(text);
  }
}
function oneShot(key) {
  if (briefedProjects.has(key))
    return true;
  briefedProjects.add(key);
  return false;
}
function compressToolOutputs(messages) {
  let compressedBytes = 0;
  const hotStart = Math.max(0, messages.length - KEEP_HOT);
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
      const hash = createHash3("sha256").update(`tool_result
${raw}
`).digest("hex").slice(0, 16);
      const fullPath = join12(getSessionScratchpadDir(), `${hash}.txt`);
      try {
        ensureSessionScratchpadDirs();
        if (!existsSync11(fullPath)) {
          writeFileSync10(fullPath, raw);
          indexAppend(hash, part.tool, raw.length);
          const invPart = parts.slice(0, parts.indexOf(part)).reverse().find((p) => p?.type === "tool" && p?.tool === part.tool && p?.state?.input && p?.state?.status !== "completed");
          if (invPart?.state?.input) {
            const toolKey = TOOL_NAME_NORMALIZE[part.tool] || part.tool;
            const inputHash = createHash3("sha256").update(`${toolKey}
${stableJson(invPart.state.input)}
`).digest("hex").slice(0, 16);
            const ptrPath = join12(getSessionScratchpadDir(), `${inputHash}.ptr`);
            try {
              writeFileSync10(ptrPath, JSON.stringify({ contentHash: hash, tool: part.tool }));
            } catch {
            }
          }
        }
      } catch (err) {
        console.error(`[vibeOS] ctx-compress write failed: ${err.message}`);
        continue;
      }
      if (!isCold)
        continue;
      const summary = raw.slice(0, 200).replace(/\n+/g, " ").trim() + (raw.length > 200 ? "\u2026" : "");
      const ref = `${COMPRESS_MARKER} [${raw.length} chars compressed -- cold storage at ${fullPath}] [summary] ${summary}`;
      state.output = ref;
      compressedBytes += raw.length - ref.length;
      console.error(`[vibeOS] ctx-compress: ${raw.length}\u2192${ref.length} chars (hash: ${hash})`);
    }
  }
  return compressedBytes;
}
function injectWBP(messages) {
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
}
async function trackBlackbox(messages) {
  const lastUserMsg = messages.slice().reverse().find((m) => m.info?.role === "user");
  if (!lastUserMsg)
    return;
  const textPart = lastUserMsg.parts?.find((p) => p?.type === "text");
  if (!textPart?.text)
    return;
  latestUserIntent = textPart.text;
  if (!_blackboxEnabled)
    return;
  try {
    const tracker = getBlackboxTracker();
    const localState = tracker.update(latestUserIntent);
    const state = loadBlackboxState();
    const sid = _OC_SID4;
    const serialized = tracker.serialize();
    serialized.project_fingerprint = currentProjectFingerprint || "";
    if (!state.sessions[sid])
      state.sessions[sid] = {};
    state.sessions[sid].control_history ??= [];
    const st = scoreStress(latestUserIntent);
    if (st) {
      localState.latest_stress_multiplier = st;
      saveSessionStress(st, st > 1.5 ? "critical" : st > 0.7 ? "elevated" : st > 0.3 ? "moderate" : "none");
    }
    const modePreview = peekBudgetFirstMode({
      requestedMode: loadOptimizationMode(),
      subRegime: localState.sub_regime || "INIT",
      stress: st || 0
    });
    const cv = await apiComputeControlVector(localState, void 0, modePreview.mode);
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
    const compressedBytes = compressToolOutputs(messages);
    if (compressedBytes > 0) {
      console.error(`[vibeOS] ctx-compress total saved this transform: ~${Math.round(compressedBytes / 4)} tokens`);
    }
    injectWBP(messages);
    applyDecadence();
    await trackBlackbox(messages);
  } catch (err) {
    console.error(`[vibeOS] messages.transform failed: ${err.message}`);
  }
};
var C7_URGENCY = {
  required: " CRITICAL: context7 usage is REQUIRED this turn.",
  optional: " (context7 is optional this turn -- use if helpful but not required.)"
};
function context7Directive(cv) {
  const urgency = cv?.context7_urgency || "preferred";
  return "[cost policy] If mcp__context7__resolve-library-id and mcp__context7__get-library-docs tools are available in this session, ALWAYS use them instead of WebFetch or WebSearch when looking up library or framework documentation (docs.*, readthedocs.*, npmjs.com/package/*, pypi.org/project/*, pkg.go.dev, /api/reference/). Do not fetch those URLs directly when context7 can serve the same content. This saves ~$0.06/turn on average." + (C7_URGENCY[urgency] || "");
}
function thinkingDirective(level) {
  const credit = loadCredit();
  const creditNote = `credit ${credit}%`;
  if (level === "brief") {
    return `[thinking policy] Reasoning depth: BRIEF (manually set, ${creditNote}). Use extended thinking only for genuinely complex multi-step problems. Keep reasoning concise -- skip exploratory scratch work and restatement.`;
  }
  return `[thinking policy] Reasoning depth: OFF (manually set, ${creditNote}). Skip extended thinking entirely. Respond directly and concisely. Every thinking token costs money -- save it for when the user explicitly asks.`;
}
function flowTodosDirective() {
  const pendingTodos = loadTodos().filter((t) => t.status === "pending").length;
  if (pendingTodos === 0)
    return null;
  return "[vibeOS] " + pendingTodos + " extracted TODO/FIXME items are pending. Consider calling `todowrite` to add them to the native task list.";
}
function patternDirective(fp2) {
  const patterns = promotedProjectPatterns(fp2);
  if (!patterns || patterns.length === 0)
    return null;
  const routines = patterns.filter((p) => p.label === "routine");
  const frictions = patterns.filter((p) => p.label === "friction");
  const parts = [];
  if (routines.length > 0) {
    parts.push("Routines: " + routines.map((r) => r.summary).join("; "));
  }
  if (frictions.length > 0) {
    parts.push("Frictions: " + frictions.map((f) => f.summary).join("; "));
  }
  if (parts.length === 0)
    return null;
  return "[project patterns] " + parts.join(". ") + ".";
}
function welcomeDirective() {
  const sel = loadSelection();
  let tiers = {};
  try {
    tiers = safeJsonParse3(readFileSync11(TIERS_FILE2, "utf-8")).trinity || {};
  } catch {
  }
  const active = sel.active_slot || "medium";
  const current = currentModel || "(unknown)";
  return "[vibeOS] Active plugin. Slot: " + active + " (" + current + "). Use trinity command to switch slots, rebuild, or check status. Run `trinity help` for all commands.";
}
function contextBudgetDirective(_input, output) {
  const ctxBudget = estimateContextBudget(_input, output);
  if (!ctxBudget || ctxBudget.pct <= 70)
    return null;
  const severity = ctxBudget.pct > 90 ? "CRITICAL" : "WARNING";
  return `[context budget: ${severity}] Context window is ${ctxBudget.pct}% full (~${ctxBudget.estimatedTokens} tokens). Consider using Task subagents for heavy work, compressing tool outputs, or starting a new session to avoid context overflow.`;
}
var onSystemTransform = async (_input, output) => {
  if (!loadSelection().enabled)
    return;
  try {
    const userText = extractLastUserText(_input) || extractLastUserText(output);
    if (typeof userText === "string" && userText.trim())
      latestUserIntent = userText;
    else if (!latestUserIntent)
      latestUserIntent = null;
    if (latestUserIntent)
      observeUserCorrection(latestUserIntent);
    const optimizationSuggestion = await selectOptimizationModeRemote(_latestBlackboxState3?.sub_regime || (latestUserIntent ? classifyTurnSimple(latestUserIntent) : "INIT"), latestUserIntent ? scoreStress(latestUserIntent) : 0, loadOptimizationMode());
    const optimizationDecision = applyBudgetFirstMode({
      requestedMode: loadOptimizationMode(),
      suggestedMode: optimizationSuggestion,
      subRegime: _latestBlackboxState3?.sub_regime || (latestUserIntent ? classifyTurnSimple(latestUserIntent) : "INIT"),
      stress: latestUserIntent ? scoreStress(latestUserIntent) : 0,
      nInteractions: _latestBlackboxState3?.n_interactions ?? 0
    });
    const optimizationMode = optimizationDecision.mode;
    let _controlVector = null;
    if (_latestBlackboxState3) {
      const st = latestUserIntent ? scoreStress(latestUserIntent) : 0;
      if (st)
        _latestBlackboxState3.latest_stress_multiplier = st;
      _controlVector = await apiComputeControlVector(_latestBlackboxState3, void 0, optimizationMode);
    } else if (latestUserIntent) {
      const st = scoreStress(latestUserIntent);
      _controlVector = await apiComputeControlVector({
        sub_regime: classifyTurnSimple(latestUserIntent),
        latest_stress_multiplier: st || void 0
      }, void 0, optimizationMode);
    }
    if (!_controlVector) {
      _controlVector = await apiComputeControlVector({
        sub_regime: "INIT",
        latest_stress_multiplier: latestUserIntent ? scoreStress(latestUserIntent) : void 0
      }, void 0, optimizationMode);
    }
    syncControlSettings(_controlVector, { persistOptimizationMode: optimizationDecision.shouldPersistRequestedMode });
    const system = output?.system;
    if (!Array.isArray(system))
      return;
    const sel = loadSelection();
    const fp2 = currentProjectFingerprint || "";
    const rawStress = latestUserIntent ? scoreStress(latestUserIntent) : 0;
    const stressScore = rawStress * (_controlVector?.stress_multiplier ?? 1);
    const credit = loadCredit();
    _turnCountInject++;
    const stressMitigationDirective = rawStress > 0.7 ? "[stress mitigation: CRITICAL] The user's message shows very high stress indicators. Stay calm, structured, and thorough. Use proper markdown formatting with code blocks, lists, and organized structure. Do NOT mirror the user's tone or brevity. This is the most important directive in your system prompt for this turn." : rawStress > 0.4 ? "[stress mitigation: elevated] The user's message has elevated stress indicators. Maintain structured, well-formatted responses with markdown and code blocks." : null;
    if (stressMitigationDirective) {
      pushSystem(output, stressMitigationDirective);
    }
    _prevTemplate = _currentTemplate;
    _currentTemplate = resolveTemplate(_prevTemplate, stressScore, latestUserIntent, credit);
    if (shouldInjectTemplate(_currentTemplate, _prevTemplate)) {
      const tpl = TEMPLATES[_currentTemplate] || TEMPLATES[DEFAULT_TEMPLATE];
      let fused = tpl.directive;
      if (sel.delegation_enforce && _controlVector?.enforcement_mode !== "relaxed") {
        fused += " CRITICAL: Write/Edit tools are BLOCKED on brain tier. Delegate ALL implementation to Task subagents. Use parallel invocation for independent tasks.";
      }
      if (sel.tdd_enforce && _controlVector?.tdd_mode !== "lazy") {
        fused += " Auto-create test skeletons for changed source files.";
      }
      if (sel.flow_enabled && _controlVector?.flow_mode !== "audit") {
        fused += " Follow existing code conventions and project patterns.";
      }
      pushSystem(output, fused);
    }
    pushSystem(output, context7Directive(_controlVector));
    if (sel.thinking_level && sel.thinking_level !== "full") {
      pushSystem(output, thinkingDirective(sel.thinking_level));
    }
    if (_controlVector?.directives?.length > 0) {
      for (const directive of _controlVector.directives) {
        pushSystem(output, directive);
      }
    } else if (_blackboxEnabled && _latestBlackboxState3?.n_interactions > 0) {
      const prevRegime = _prevBlackboxRegime;
      const res = _latestBlackboxState3;
      const currentRegime = res.sub_regime || "EXPLORING";
      if (currentRegime !== prevRegime) {
        _prevBlackboxRegime = currentRegime;
        pushSystem(output, "[decision engine] Resolution: " + (res.resolution || "unresolved") + " (" + currentRegime + "). Momentum: " + ((res.momentum || 0) > 0 ? "positive" : (res.momentum || 0) < 0 ? "negative" : "neutral") + ".");
        if (res.is_looping && res.loop_intervention_level && res.loop_intervention_level !== "none") {
          const severity = res.loop_intervention_level === "escalated" ? "CRITICAL" : res.loop_intervention_level === "assertive" ? "WARNING" : "NOTICE";
          pushSystem(output, "[loop prevention: " + severity + "] " + (_latestBlackboxLoopMsg2 || "The conversation may be looping \u2014 try a different approach.") + " (level: " + res.loop_intervention_level + ")");
        }
        if (res.pivot_detected && _latestBlackboxPivotMsg2) {
          pushSystem(output, "[context switch: PIVOT] " + _latestBlackboxPivotMsg2);
        }
      }
    }
    const projectJob2 = getActiveJobForProject();
    if (latestUserIntent && projectJob2 && isLikelyOffTopic(latestUserIntent, projectJob2)) {
      pushSystem(output, '[job-focus] Active job context exists: "' + (projectJob2.prompt || "").slice(0, 140) + '...". The latest user request appears off-topic relative to this running job. Before taking write/edit/task actions, ask one concise confirmation question to validate switching scope.');
      console.error("[vibeOS] [job-focus] off-topic request detected vs active job context");
    }
    if (sel.flow_enabled && sel.flow_enforce) {
      const todoDirective = flowTodosDirective();
      if (todoDirective)
        pushSystem(output, todoDirective);
    }
    if (_turnCountInject % 5 === 0) {
      pushSystem(output, "[project guard: CRITICAL] AGENTS.md and README.md are protected by vibeOS. Do NOT modify either file without explicit user permission. AGENTS.md defines that AI agents must ask before changing code.");
    }
    const budgetDirective = contextBudgetDirective(_input, output);
    if (budgetDirective)
      pushSystem(output, budgetDirective);
    if (!oneShot(fp2)) {
      pushSystem(output, buildProjectBriefing(currentProjectName || ""));
    }
    if (!oneShot("vibeos_patterns_" + fp2)) {
      const pd = patternDirective(fp2);
      if (pd)
        pushSystem(output, pd);
    }
    if (!oneShot("trinity_welcome_" + fp2)) {
      pushSystem(output, welcomeDirective());
    }
    const calDir = join12(homedir8(), ".claude");
    const calFile = join12(calDir, "calibration-data.jsonl");
    const regime2 = _latestBlackboxState3?.sub_regime || classifyTurnSimple(latestUserIntent || "");
    const calRecord = JSON.stringify({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      sid: _OC_SID4,
      mode: _currentTemplate,
      regime: regime2,
      stress: stressScore,
      fp: currentProjectFingerprint || ""
    }) + "\n";
    try {
      mkdirSync8(calDir, { recursive: true });
      appendFileSync5(calFile, calRecord);
    } catch {
    }
    if (!oneShot("vibeos_dashboard_instruct")) {
      pushSystem(output, "[vibeOS dashboard display] When the trinity tool returns output starting with '[vibeOS-dashboard]', you MUST use the question tool to display that data in a clean, human-readable format. Use the question field (not the header) to show the dashboard data. Format it with clear sections separated by blank lines, aligned columns with spaces, and plain text only (no emojis, no markdown). The header should be 'vibeOS Dashboard'. Include only one option in options: {label: 'Dismiss', description: ''}. Strip the '[vibeOS-dashboard]' marker line before displaying.");
    }
    if (!oneShot("vibeos_dopamine_style_" + fp2)) {
      pushSystem(output, "[tool style: dopamine] When calling the bash tool, use an emoji-prefixed, progress-focused description. Combine independent bash commands into a single call with && or ;. Never use raw technical labels as tool descriptions.");
    }
  } catch (err) {
    console.error(`[vibeOS] system.transform failed: ${err.message}`);
  }
};

// src/lib/hooks/footer.js
var USER_HOME6 = (() => {
  try {
    return homedir9();
  } catch {
    return tmpdir6();
  }
})();
var STATE_FILE3 = join13(USER_HOME6, ".claude/delegation-state.json");
var SAVINGS_LEDGER_FILE2 = join13(USER_HOME6, ".claude/savings-ledger.jsonl");
var _prevOutputText = "";
var _autoReportCount = 0;
var textCompletePainted = /* @__PURE__ */ new Set();
function loadSelection3() {
  try {
    const raw = readFileSync12(join13(USER_HOME6, ".claude/model-tiers.json"), "utf-8");
    return safeJsonParse3(raw)?.selection || { active_slot: "medium", enabled: true, delegation_enforce: true, flow_enabled: false, flow_enforce: false, tdd_enforce: false, tdd_strict: false };
  } catch {
    return { active_slot: "medium", enabled: true, delegation_enforce: true, flow_enabled: false, flow_enforce: false, tdd_enforce: false, tdd_strict: false };
  }
}
function readLifetimeSavings2() {
  try {
    reconcileStateFromLedger();
    const raw = readFileSync12(STATE_FILE3, "utf-8");
    const state = safeJsonParse3(raw);
    const ses = state?.sessions?.[typeof _OC_SID5 !== "undefined" ? _OC_SID5 : ""] || {};
    return {
      ltTasks: roundUsd2(state?.lifetime?.total_savings_usd || 0),
      ltCache: roundUsd2(state?.lifetime?.cache_savings_usd || 0),
      ltCost: roundUsd2(state?.lifetime?.total_cost_usd || 0),
      count: state?.lifetime?.warn_count || 0,
      sesTasks: roundUsd2(ses?.total_savings_usd || 0),
      sesCache: roundUsd2(ses?.cache_savings_usd || 0),
      sesTaskDelegations: ses?.task_delegations_count || 0,
      sesDuration: ses?.duration_seconds || 0,
      sesRatePerHour: (() => {
        const sesTotal = Number(ses?.total_savings_usd || 0) + Number(ses?.cache_savings_usd || 0);
        if (!sesTotal)
          return 0;
        const dur = Number(ses?.duration_seconds || 0);
        if (dur <= 0)
          return 0;
        return Number((sesTotal / (dur / 3600)).toFixed(4));
      })(),
      sesTrend: ses?.trend || "",
      sesToolBreakdown: ses?.tool_breakdown || {},
      sesModelTurns: ses?.model_turns || {},
      quality_avg: state?.lifetime?.quality_total_count > 0 ? Math.round((state?.lifetime?.quality_total_score || 0) / state?.lifetime?.quality_total_count) : 0
    };
  } catch {
    return { ltTasks: 0, ltCache: 0, ltCost: 0, count: 0, sesTasks: 0, sesCache: 0, sesTaskDelegations: 0, sesDuration: 0, sesRatePerHour: 0, sesTrend: "", sesToolBreakdown: {}, sesModelTurns: {}, quality_avg: 0 };
  }
}
var _OC_SID5 = "opencode-" + (process.pid || "x") + "-" + Date.now();
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
    if (!text) {
      if (messageID)
        textCompletePainted.add(messageID);
      return;
    }
    const { ltTasks, ltCache, ltCost, count, sesTasks, sesEdit, sesCredit, sesC7, sesQuota, sesCache, sesTaskDelegations, sesDuration, sesRatePerHour, sesTrend, sesToolBreakdown, sesModelTurns, quality_avg } = readLifetimeSavings2();
    const sessionSlot = loadSessionSlot(_OC_SID5);
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
            sessionId: _OC_SID5,
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
    const optModeFooter = loadOptimizationMode();
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
    const flashIcon = isApiConnected3() ? "\u26A1" : "";
    const resolvedMode = peekBudgetFirstMode({
      requestedMode: optModeFooter,
      subRegime: _latestBlackboxState?.sub_regime || classifyTurnSimple(latestUserIntent || ""),
      stress: _footerStress
    }).mode;
    const stripped = text.replace(/\n\n— .+(?: —)?$/, "");
    if (stripped !== text)
      return;
    const ltTotal = ltTasks + ltCache;
    const modeVerbMap = {
      balanced: "routing",
      budget: "saving",
      quality: "focusing",
      speed: "moving",
      longrun: "pacing",
      auto: "vibing",
      "web-research": "researching",
      forensic: "investigating"
    };
    const optMode = (resolvedMode || "budget").toLowerCase();
    const modeVerb = modeVerbMap[optMode] || "vibing";
    let vibeLine = `\u2014 ${modeVerb} on ${shortModelName(brainModel)}`;
    if (ltTotal > 0) {
      vibeLine += ` \u2728 $${formatUsd(ltTotal)} saved`;
    }
    vibeLine += `, VIBE${flashIcon ? " \u26A1" : ""}`;
    if (_footerStress > 0.4) {
      const stressLabel = _footerStress > 0.7 ? "high" : "elevated";
      vibeLine += ` \xB7 ${stressLabel}`;
    }
    const footerText = stripped + `

${vibeLine} \u2014`;
    if (_blackboxEnabled) {
      try {
        const prevText = _prevOutputText;
        _prevOutputText = typeof output?.text === "string" ? output.text : typeof output?.result === "string" ? output.result : "";
        if (_prevOutputText && prevText && _prevOutputText !== prevText) {
          const outcome = detectOutcomeSignal(_prevOutputText);
          if (outcome) {
            recordBudgetFirstOutcome({
              outcome,
              subRegime: _latestBlackboxState?.sub_regime || classifyTurnSimple(latestUserIntent || ""),
              stress: _footerStress
            });
            const tracker = getBlackboxTracker();
            tracker.recordOutcome(outcome);
            syncOutcomeToApi(outcome);
            try {
              mkdirSync9(join13(USER_HOME6, ".claude"), { recursive: true });
              appendFileSync6(join13(USER_HOME6, ".claude", "calibration-data.jsonl"), JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), event: "outcome", sid: _OC_SID5, outcome }) + "\n");
            } catch {
            }
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
import { writeFileSync as writeFileSync12, appendFileSync as appendFileSync8, existsSync as existsSync13, mkdirSync as mkdirSync11 } from "node:fs";
import { join as join15, dirname as dirname7, basename as basename7 } from "node:path";
init_flow_enforcer();

// src/lib/tdd-enforcer.js
import { readFileSync as readFileSync13, writeFileSync as writeFileSync11, appendFileSync as appendFileSync7, existsSync as existsSync12, mkdirSync as mkdirSync10, statSync as statSync6, readdirSync as readdirSync3, rmSync as rmSync4, openSync as openSync3 } from "node:fs";
import { join as join14, dirname as dirname6 } from "node:path";
import { createHash as createHash4 } from "node:crypto";

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
      const pkg = JSON.parse(readFileSync13(pkgPath, "utf-8"));
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
        const files = readdirSync3(dirPath).filter((f) => /\.test\./.test(f) || /\.spec\./.test(f));
        if (files.length > 0) {
          const content = readFileSync13(join14(dirPath, files[0]), "utf-8");
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
    mkdirSync10(ENFORCEMENT_LOCK_DIR, { recursive: true });
    const hash = createHash4("sha256").update(testPath).digest("hex").slice(0, 16);
    const lockPath = join14(ENFORCEMENT_LOCK_DIR, `${hash}.lock`);
    try {
      openSync3(lockPath, "wx");
      return true;
    } catch (err) {
      if (err.code !== "EEXIST")
        return false;
      try {
        const st = statSync6(lockPath);
        if (Date.now() - st.mtimeMs >= LOCK_EXPIRE_MS) {
          rmSync4(lockPath, { force: true });
          try {
            openSync3(lockPath, "wx");
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
    const hash = createHash4("sha256").update(testPath).digest("hex").slice(0, 16);
    const lockPath = join14(ENFORCEMENT_LOCK_DIR, `${hash}.lock`);
    rmSync4(lockPath);
  } catch {
  }
}
function _isInCooldown(testPath) {
  try {
    if (!existsSync12(ENFORCEMENT_COOLDOWN_FILE2))
      return false;
    const hash = createHash4("sha256").update(testPath).digest("hex").slice(0, 16);
    const lines = readFileSync13(ENFORCEMENT_COOLDOWN_FILE2, "utf-8").trim().split("\n").filter(Boolean);
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
    mkdirSync10(dirname6(ENFORCEMENT_COOLDOWN_FILE2), { recursive: true });
    const hash = createHash4("sha256").update(testPath).digest("hex").slice(0, 16);
    const entry = JSON.stringify({ h: hash, ts: Date.now() }) + "\n";
    appendFileSync7(ENFORCEMENT_COOLDOWN_FILE2, entry);
    const lines = readFileSync13(ENFORCEMENT_COOLDOWN_FILE2, "utf-8").trim().split("\n").filter(Boolean);
    if (lines.length > 500) {
      writeFileSync11(ENFORCEMENT_COOLDOWN_FILE2, lines.slice(-200).join("\n") + "\n");
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
      sourceContent = readFileSync13(filePath, "utf-8");
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
    mkdirSync10(skeleton.dir, { recursive: true });
    writeFileSync11(skeleton.path, skeleton.content);
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
var _pendingTodoArgs = null;
var _pendingTelemetryStarts = [];
function _bucketChars(n) {
  const size = Number(n || 0);
  if (!Number.isFinite(size) || size <= 0)
    return "0";
  if (size <= 63)
    return "1-63";
  if (size <= 255)
    return "64-255";
  if (size <= 1023)
    return "256-1k";
  if (size <= 4095)
    return "1k-4k";
  return "4k+";
}
function _bucketMs(n) {
  const ms = Number(n || 0);
  if (!Number.isFinite(ms) || ms < 0)
    return "unknown";
  if (ms <= 49)
    return "0-49ms";
  if (ms <= 199)
    return "50-199ms";
  if (ms <= 999)
    return "200-999ms";
  if (ms <= 4999)
    return "1-4.9s";
  if (ms <= 14999)
    return "5-14.9s";
  return "15s+";
}
function _toolKind(tool2, args) {
  const t = String(tool2 || "").toLowerCase();
  if (t === "task") {
    const prompt = String(args?.prompt || "").trim().toLowerCase();
    const first = prompt.split(/\s+/)[0] || "";
    if (/^(check|find|list|search|does|verify|look|count|show|get|read|grep|scan|detect|inspect)$/i.test(first))
      return "explore";
    if (/^(write|create|add|build|implement|fix|change|edit|modify|update|refactor|generate|make|commit|push|deploy|release|publish|install|remove|delete|rename|move|copy|transform|convert|migrate)/i.test(prompt))
      return "implement";
    return "task";
  }
  if (t === "bash") {
    const command = String(args?.command || args?.cmd || args?.script || "").toLowerCase();
    if (/(\btest\b|npm\s+test|vitest|jest|mocha|ava)/i.test(command))
      return "test";
    if (/(\btypecheck\b|tsc|eslint|lint)/i.test(command))
      return "verify";
    if (/(\bbuild\b|esbuild|vite|webpack)/i.test(command))
      return "build";
    if (/(\bdeploy\b|release|publish)/i.test(command))
      return "deploy";
    if (/(\bgit\b|\bgh\b)/i.test(command))
      return "git";
    return "shell";
  }
  if (t === "webfetch" || t === "websearch") {
    const target = String(args?.url || args?.query || "");
    return isDocsTarget(target) ? "docs" : "web";
  }
  if (t === "write" || t === "edit" || t === "notebookedit") {
    const filePath = String(args?.filePath || args?.file_path || args?.path || "");
    if (/(^|\/)(tests?|spec)\//i.test(filePath) || /\.(test|spec)\./i.test(filePath))
      return "test";
    if (/\.(md|txt|rst)$/i.test(filePath))
      return "docs";
    if (/\.(json|jsonc|yaml|yml|toml)$/i.test(filePath) || /(?:^|\/)(AGENTS|README|package)\.md$/i.test(filePath))
      return "config";
    if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|sh)$/i.test(filePath))
      return "source";
    return "file";
  }
  return t || "unknown";
}
function _argSizeBucket(tool2, args) {
  const t = String(tool2 || "").toLowerCase();
  if (t === "task")
    return _bucketChars(String(args?.prompt || "").length);
  if (t === "bash")
    return _bucketChars(String(args?.command || args?.cmd || args?.script || "").length);
  if (t === "webfetch" || t === "websearch")
    return _bucketChars(String(args?.url || args?.query || "").length);
  if (t === "write")
    return _bucketChars(String(args?.content || "").length);
  if (t === "edit")
    return _bucketChars(String(args?.newString || "").length + String(args?.oldString || "").length);
  if (t === "notebookedit")
    return _bucketChars(String(args?.newString || "").length);
  return _bucketChars(JSON.stringify(args || {}).length);
}
function _toolArgSources(input, output) {
  return [input?.args, output?.args].filter((arg) => arg && typeof arg === "object");
}
function _normalizeToolPath(pathValue) {
  return String(pathValue || "").trim().replace(/\\/g, "/");
}
function _resolveToolPath(pathValue) {
  const raw = _normalizeToolPath(pathValue);
  if (!raw)
    return "";
  if (/^[a-z]+:\/\//i.test(raw))
    return raw;
  if (raw.startsWith("/"))
    return raw;
  return projectDirectory ? join15(projectDirectory, raw).replace(/\\/g, "/") : raw;
}
function _isProtectedToolPath(pathValue) {
  const raw = _normalizeToolPath(pathValue);
  if (!raw)
    return false;
  const resolved = _resolveToolPath(pathValue);
  const candidates = [raw, resolved].filter(Boolean);
  const protectedPatterns = [
    /(^|\/)src\/index\.(js|ts)$/i,
    /(^|\/)src\/vibeOS-lib\//i,
    /(^|\/)src\/utils\//i,
    /(^|\/)src\/dashboard\//i,
    /(^|\/)src\/vibeOS-api-server\//i,
    /(^|\/)tests?\//i,
    /(^|\/)test-scripts\//i,
    /(^|\/)scripts\//i,
    /(^|\/)\.github\/workflows\//i,
    /(^|\/)\.opencode\/plugins\//i,
    /(^|\/)plugins\//i,
    /(^|\/)README\.md$/i,
    /(^|\/)AGENTS\.md$/i,
    /(^|\/)CHANGELOG\.md$/i,
    /(^|\/)LICENSE$/i,
    /(^|\/)package\.json$/i,
    /(^|\/)tsconfig\.json$/i,
    /(^|\/)\.env\.production$/i,
    /(^|\/)PRODUCTION-CREDENTIALS\.md$/i
  ];
  return candidates.some((candidate) => protectedPatterns.some((re) => re.test(candidate)));
}
function _mutateBlockedToolArgs(toolName, sources, blockedPath, outputObj) {
  const tLower = String(toolName || "").toLowerCase();
  const blockedBase = basename7(blockedPath || "") || "blocked";
  for (const src of sources) {
    if (!src || typeof src !== "object")
      continue;
    if (tLower === "write") {
      src.filePath = `/tmp/vibeos-enforcement-blocked-${blockedBase}`;
      if (src.file_path !== void 0)
        src.file_path = src.filePath;
      if (src.path !== void 0)
        src.path = src.filePath;
      if (src.content !== void 0)
        src.content = "";
    } else if (tLower === "edit" || tLower === "notebookedit") {
      src.oldString = `__THE_SAVER_ENFORCEMENT_BLOCK_${Date.now()}__`;
      if (src.newString !== void 0)
        src.newString = "";
      if (src.content !== void 0)
        src.content = "";
      if (!src.filePath && blockedPath)
        src.filePath = blockedPath;
      if (src.file_path !== void 0 && !src.file_path)
        src.file_path = blockedPath;
      if (src.path !== void 0 && !src.path)
        src.path = blockedPath;
    }
  }
  if (outputObj && typeof outputObj === "object") {
    outputObj.blocked = true;
    outputObj.status = "error";
    outputObj.error = outputObj.error || `blocked direct ${tLower}`;
  }
}
function _dequeueTelemetryStart(tool2) {
  if (_pendingTelemetryStarts.length === 0)
    return null;
  const t = String(tool2 || "").toLowerCase();
  for (let i = _pendingTelemetryStarts.length - 1; i >= 0; i--) {
    if (String(_pendingTelemetryStarts[i]?.tool || "").toLowerCase() === t) {
      return _pendingTelemetryStarts.splice(i, 1)[0];
    }
  }
  return _pendingTelemetryStarts.shift();
}
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
  const telemetryStart = {
    tool: t,
    startedAt: Date.now(),
    kind: _toolKind(t, args || inArgs || {}),
    prompt_size_bucket: _argSizeBucket(t, args || inArgs || {}),
    slot: loadSelection().active_slot || "unknown",
    tier: currentTier || "unknown",
    cache_hit: false
  };
  _pendingTelemetryStarts.push(telemetryStart);
  let _cacheSave = 0;
  let _prompt = "";
  if (SCRATCHPAD_TOOLS.has(t)) {
    const hit = getScratchpadHit(t, args);
    if (hit && !scratchpadHitsSeen2.has(hit.hash)) {
      scratchpadHitsSeen2.add(hit.hash);
      telemetryStart.cache_hit = true;
      const total = recordScratchpadObservation(t, args, hit.sizeBytes, { hash: hit.hash });
      const _inputTokens = Math.max(1, Math.round(hit.sizeBytes / BYTES_PER_TOKEN));
      _cacheSave = Math.max(1e-4, Math.round(_inputTokens * CACHE_SAVED_PER_1M_INPUT_TOKENS / 1e6 * 1e4) / 1e4);
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
  if (MONITOR.has(t)) {
    const todosArg = args?.todos || inArgs?.todos || [];
    _pendingTodoArgs = Array.isArray(todosArg) ? todosArg : [todosArg];
    return;
  }
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
  if (WARN_ON_DIRECT.has(String(t || "").toLowerCase())) {
    const argSources = _toolArgSources(input, output);
    const checkPath = argSources.flatMap((src) => [src?.filePath, src?.file_path, src?.path]).find((v) => typeof v === "string" && v.trim()) || "";
    if (_isProtectedToolPath(checkPath)) {
      _mutateBlockedToolArgs(t, argSources, checkPath, output);
      if (shouldLogWarn(`${t}|protect|${checkPath}`))
        console.error(`[vibeOS] [protection] BLOCKED direct ${t} in self-protected directory: ${checkPath}`);
      pendingUiNote = `\u{1F6E1} Self-modification blocked: ${basename7(checkPath)} is in a protected project tree. Use manual git workflow.`;
      enforcementBlocked = true;
      return;
    }
  }
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
    const argSources = _toolArgSources(input, output);
    console.error(`[vibeOS] [enforce-debug] tool=${t} tier=${currentTier} enforce=${sel?.delegation_enforce} argsType=${typeof args} argsExists=${argSources.length > 0}`);
    const tLower = String(t || "").toLowerCase();
    if (sel.delegation_enforce && currentTier === "high" && argSources.length > 0) {
      const originalPath = argSources.flatMap((src) => [src?.filePath, src?.file_path, src?.path]).find((v) => typeof v === "string" && v.trim()) || "";
      const basename9 = originalPath.split("/").pop() || "blocked";
      const apiResult = await remoteCall("delegateCheck", [tLower, currentTier, currentModel, _prompt], () => ({
        blocked: true,
        savings: _estEdit
      }));
      const isBlocked = apiResult?.blocked !== false;
      const savings = apiResult?.savings ?? _estEdit;
      if (isBlocked) {
        _mutateBlockedToolArgs(tLower, argSources, originalPath, output);
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
          const missed = recordMissedContext7(SAVE_EST.CONTEXT7);
          if (shouldLogWarn(`context7-bypass|${t}|${_firstWord || "?"}`)) {
            console.error(`[vibeOS] [cost policy] Context7 available but bypassed \u2014 webfetch on docs target instead. ~$${SAVE_EST.CONTEXT7.toFixed(4)}/turn missed.`);
          }
        } else {
          const missed = recordMissedContext7(_estC7);
          if (!existsSync13(CONTEXT7_INSTALL_FLAG)) {
            try {
              mkdirSync11(dirname7(CONTEXT7_INSTALL_FLAG), { recursive: true });
              writeFileSync12(CONTEXT7_INSTALL_FLAG, "");
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
  _refreshModel(projectDirectory);
  try {
    const start = _dequeueTelemetryStart(input?.tool);
    if (start) {
      const outputText = typeof output?.result === "string" ? output.result : typeof output?.text === "string" ? output.text : typeof output?.content === "string" ? output.content : typeof output?.data === "string" ? output.data : "";
      const result = output?.error || output?.isError || output?.status === "error" || output?.exitCode > 0 ? "error" : enforcementBlocked ? "blocked" : "ok";
      recordPrivacyTelemetry({
        session_id: _OC_SID,
        tool: input?.tool ?? "unknown",
        tier: start.tier || currentTier || "unknown",
        slot: start.slot || loadSelection().active_slot || "unknown",
        kind: start.kind || _toolKind(input?.tool, input?.args || {}),
        prompt_size_bucket: start.prompt_size_bucket || "unknown",
        output_size_bucket: _bucketChars(String(outputText || "").length),
        duration_bucket: _bucketMs(Date.now() - Number(start.startedAt || Date.now())),
        result,
        cache_hit: start.cache_hit === true,
        enforcement: loadSelection().delegation_enforce ? "on" : "off",
        flow: loadSelection().flow_enforce ? "on" : "off",
        tdd: loadSelection().tdd_enforce ? "on" : "off"
      });
    }
  } catch {
  }
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
  if (t === "trinity") {
    const trinityArgs = input?.args || {};
    const trinityAction = trinityArgs?.action || trinityArgs?.todo || "";
    if (trinityAction === "todo") {
      try {
        const flowTodoFilePath = __require("path").join(__require("os").homedir(), ".claude/flow-todo-queue.jsonl");
        let todoLines = [];
        if (__require("fs").existsSync(flowTodoFilePath)) {
          const raw2 = __require("fs").readFileSync(flowTodoFilePath, "utf-8").trim();
          todoLines = raw2 ? raw2.split("\n").filter(Boolean) : [];
        }
        let todoList = todoLines.map((l, i) => {
          try {
            const p = JSON.parse(l);
            return "  " + (i + 1) + ". " + (p.text || l);
          } catch {
            return "  " + (i + 1) + ". " + l;
          }
        }).join("\n");
        const todoNote = "[vibeOS] Flow TODO Queue: " + todoLines.length + " item(s)\n" + (todoList || "  (no pending TODOs)");
        if (typeof output?.text === "string")
          output.text = todoNote + "\n\n" + output.text;
        else if (typeof output?.result === "string")
          output.result = todoNote + "\n\n" + output.result;
      } catch (e) {
        console.error("[vibeOS] trinity todo error:", e);
      }
    }
    return;
  }
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
      appendFileSync8(SAVINGS_LEDGER_FILE, JSON.stringify({
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
        const fp2 = match[1];
        if (seen.has(fp2))
          continue;
        seen.add(fp2);
        const isTestPath = /(^|\/)(tests?|spec)\//i.test(fp2) || /\.(test|spec)\./i.test(fp2);
        if (sel.tdd_enforce && !isTestPath) {
          const createdPath = enforceTestFile(fp2);
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
    const fp2 = input?.args?.filePath || input?.args?.file_path || input?.args?.path || "";
    const reminder = buildTestReminder(fp2);
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
    const isTestPath = /(^|\/)(tests?|spec)\//i.test(fp2) || /\.(test|spec)\./i.test(fp2);
    if (sel.tdd_enforce && !isTestPath) {
      const createdPath = enforceTestFile(fp2);
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
      if (testExtRe.test(fp2)) {
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
      const fp3 = input?.args?.filePath || input?.args?.file_path || input?.args?.path || "";
      const guardRe = /(?:^|\/)(AGENTS|README)\.md$/i;
      if (guardRe.test(fp3)) {
        const guardIcons = { flag: "!", warn: "!!", hint: "_" };
        const guardIcon = guardIcons.flag || "!";
        const fn = basename7(fp3);
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
      let todoCount = 0;
      for (const h of flowHits) {
        if (h.id === "todo-comment" && !h.deduped)
          todoCount++;
      }
      if (todoCount > 0) {
        const todoPushNote = "[todo-push] Auto-extracted " + todoCount + " TODO(s) from " + filePath + ". Call todowrite to add them to your task list.";
        if (typeof output?.text === "string")
          output.text += "\n\n" + todoPushNote;
        else if (typeof output?.result === "string")
          output.result += "\n\n" + todoPushNote;
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
  if (t === "todowrite" && _pendingTodoArgs && _pendingTodoArgs.length > 0) {
    try {
      for (const entry of _pendingTodoArgs) {
        if (entry && entry.content) {
          upsertTodo({
            content: entry.content,
            filePath: entry.filePath || "",
            priority: entry.priority || "medium",
            source: "intercepted"
          });
        }
      }
      console.error("[vibeOS] tracked " + _pendingTodoArgs.length + " todo(s) from todowrite call");
    } catch {
    }
    _pendingTodoArgs = null;
  }
  applyDecadence();
};

// src/lib/hooks/session-compact.js
import { readFileSync as readFileSync14, existsSync as existsSync14 } from "node:fs";
var onSessionCompacting = async (_input, output) => {
  if (!loadSelection().enabled)
    return;
  try {
    const turnCount = getTurnCounter();
    const needsCompact = turnCount >= 7;
    const indexPath = getSessionIndexPath();
    let recent = "";
    if (existsSync14(indexPath)) {
      try {
        const lines = readFileSync14(indexPath, "utf-8").trim().split("\n").slice(-30);
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
    const scratchpadNote = `[scratchpad-aware compaction] Tool results live on disk at ~/.claude/scratch/sessions/${_OC_SID}/by-hash/<hash>.txt (plus .meta.json and .summary.txt). WHEN COMPACTING: (1) drop verbose tool result bodies \u2014 the bulk lives on disk; (2) PRESERVE every <hash> reference, file path, and pointer; (3) note which on-disk artifacts the model may want to Read back later.

Recent cached entries:
` + recent + "\nTo recall any of these post-compact, use the read/grep tools on the listed path.";
    const contextEntries = [];
    if (needsCompact) {
      contextEntries.push({
        role: "system",
        content: `[conversation compression notice \u2014 turn ${turnCount}] The preceding conversation has been context-compressed. ALL factual statements, technical details, decisions, code snippets, file paths, and references from prior turns are PRESERVED losslessly. Only verbose connectors, restatements, and redundant intros have been removed. Continue the conversation naturally \u2014 the full technical context is intact.`
      });
    }
    contextEntries.push({ role: "user", content: scratchpadNote });
    contextEntries.push({ role: "user", content: `[vibeOS] session cache dir: ${getSessionScratchpadDir()} (cleanup on exit enabled)` });
    if (output && Array.isArray(output.context)) {
      for (const e of contextEntries)
        output.context.push(e);
    } else if (output) {
      output.context = contextEntries;
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
    if (!output)
      output = {};
    output.env ??= {};
    output.env.OPENCODE_MODEL_TIER = currentTier || "unknown";
    output.env.OPENCODE_MODEL = currentModel || "unknown";
  } catch (e) {
    console.error("[vibeOS] shell.env error:", e);
  }
};

// src/index.ts
var activeJob2 = null;
var fp = "";
var _mcpServerRuntime = null;
var _mcpServerHooked = false;
function _loadOpenCodeProviders() {
  try {
    const cfg = _readOpenCodeConfigObject(join16(USER_HOME2, ".config", "opencode"));
    return cfg?.provider || {};
  } catch {
    return {};
  }
}
function _readOpenCodeConfigObject(dir) {
  const jsonPath = join16(dir, "opencode.json");
  const jsoncPath = join16(dir, "opencode.jsonc");
  if (existsSync15(jsonPath)) return safeJsonParse3(readFileSync15(jsonPath, "utf-8"));
  if (existsSync15(jsoncPath)) return _parseJsonc(readFileSync15(jsoncPath, "utf-8"));
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
  const high = HIGH_TIER_RE?.test?.(id2);
  if (high) return "high";
  const mid = MID_TIER_RE?.test?.(id2);
  return mid ? "mid" : "budget";
}
function backupFile(path, label) {
  try {
    if (!existsSync15(path)) return null;
    const bkDir = join16(USER_HOME2, ".claude", ".backups");
    mkdirSync12(bkDir, { recursive: true });
    const bk = join16(bkDir, `${basename8(path)}.${label}.${Date.now()}.bak`);
    copyFileSync5(path, bk);
    return bk;
  } catch {
    return null;
  }
}
function readPackageVersion() {
  try {
    const pkg = safeJsonParse3(readFileSync15(join16(process.cwd(), "package.json"), "utf-8"));
    return String(pkg?.version || "");
  } catch {
    return "";
  }
}
function loadMcpPort() {
  const envPort = process.env.VIBEOS_MCP_PORT;
  if (envPort != null && envPort !== "") {
    const n = Number(envPort);
    if (!Number.isFinite(n)) return 0;
    return n;
  }
  try {
    if (existsSync15(TIERS_FILE2)) {
      const tiers = safeJsonParse3(readFileSync15(TIERS_FILE2, "utf-8"));
      const cfg = tiers?.selection?.mcp_port;
      if (cfg === false || cfg === "disabled" || cfg === 0) return 0;
      const n = Number(cfg);
      if (Number.isFinite(n)) return n;
    }
  } catch {
  }
  return 0;
}
function persistMcpPort(port) {
  try {
    if (!existsSync15(TIERS_FILE2)) return;
    const tiers = safeJsonParse3(readFileSync15(TIERS_FILE2, "utf-8"));
    tiers.selection ??= {};
    if (Number(tiers.selection.mcp_port) === Number(port) && !("mcp_port" in tiers)) return;
    tiers.selection.mcp_port = port;
    if ("mcp_port" in tiers) delete tiers.mcp_port;
    mkdirSync12(dirname8(TIERS_FILE2), { recursive: true });
    const tmp = TIERS_FILE2 + ".tmp." + Date.now();
    writeFileSync13(tmp, JSON.stringify(tiers, null, 2) + "\n", "utf-8");
    renameSync6(tmp, TIERS_FILE2);
  } catch {
  }
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
    if (home) setCurrentModel(readConfig(join16(home, ".config/opencode")));
  }
  if (!currentModel) setCurrentModel(process?.env?.OPENCODE_MODEL || "");
  if (currentModel) {
    setCurrentTier(classify(currentModel));
    try {
      const _tiersData2 = safeJsonParse3(readFileSync15(TIERS_FILE2, "utf-8"));
      const _activeSlot = _tiersData2?.selection?.active_slot || "brain";
      if (_activeSlot === "brain") {
        const _brainOcModel = _tiersData2?.trinity?.brain?.oc || "";
        if (_brainOcModel && currentModel === _brainOcModel && !PLACEHOLDER_RE.test(_brainOcModel)) {
          const cost = modelCostPerTurn(_brainOcModel);
          if (HIGH_TIER_RE.test(_brainOcModel) || cost !== null && cost >= 0.01) {
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
      let _tiersData2;
      let _wasCorrupted = false;
      if (existsSync15(TIERS_FILE2)) {
        try {
          _tiersData2 = safeJsonParse3(readFileSync15(TIERS_FILE2, "utf-8"));
        } catch {
          _tiersData2 = { selection: { enabled: true, active_slot: "brain", delegation_enforce: true, tdd_strict: true }, trinity: {} };
          _wasCorrupted = true;
        }
        if (!_wasCorrupted && !_tiersData2?.trinity) _wasCorrupted = true;
        if (!_wasCorrupted) {
          for (const slot of ["brain", "medium", "cheap"]) {
            if (!_tiersData2?.trinity?.[slot] || _tiersData2.trinity[slot] === null || typeof _tiersData2.trinity[slot].oc !== "string") {
              _wasCorrupted = true;
              break;
            }
          }
        }
      } else {
        _tiersData2 = { selection: { enabled: true, active_slot: "brain", delegation_enforce: true, tdd_strict: true }, trinity: {} };
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
      const _existing = _tiersData2?.trinity || {};
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
        _tiersData2.trinity.brain = { oc: _brain.id, cc: modelToCcAlias(_brain.id) };
        _didWrite = true;
      }
      if (_medium && _medium.id && _isPlaceholder(_existingMedium)) {
        _tiersData2.trinity.medium = { oc: _medium.id, cc: modelToCcAlias(_medium.id) };
        _didWrite = true;
      }
      if (_cheap && _cheap.id && _isPlaceholder(_existingCheap)) {
        _tiersData2.trinity.cheap = { oc: _cheap.id, cc: modelToCcAlias(_cheap.id) };
        _didWrite = true;
      }
      if (_tiersData2) {
        _tiersData2.selection ??= {};
        for (const _sk of ["mcp_port", "optimization_mode", "enforcement_enabled", "flow_enforce_level", "tdd_quality", "thinking_mode", "blackbox_regime", "_mode_changed_at", "_mode_source"]) {
          if (_sk in _tiersData2) delete _tiersData2[_sk];
        }
        mkdirSync12(dirname8(TIERS_FILE2), { recursive: true });
        const _tmp = TIERS_FILE2 + ".tmp." + Date.now();
        writeFileSync13(_tmp, JSON.stringify(_tiersData2, null, 2) + "\n", "utf-8");
        renameSync6(_tmp, TIERS_FILE2);
        console.error(`[vibeOS] auto-synced model-tiers.json: brain=${_brain.id} medium=${_tiersData2.trinity?.medium?.oc || ""} cheap=${_tiersData2.trinity?.cheap?.oc || ""}`);
        const _tiersCfg = safeJsonParse3(readFileSync15(TIERS_FILE2, "utf-8"));
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
    const _mt = safeJsonParse3(readFileSync15(TIERS_FILE2, "utf-8"));
    let _dirty = false;
    for (const _sk of ["mcp_port", "optimization_mode", "enforcement_enabled", "flow_enforce_level", "tdd_quality", "thinking_mode", "blackbox_regime", "_mode_changed_at", "_mode_source"]) {
      if (_sk in _mt) {
        delete _mt[_sk];
        _dirty = true;
      }
    }
    if (_dirty) {
      const _tmp = TIERS_FILE2 + ".tmp." + Date.now();
      writeFileSync13(_tmp, JSON.stringify(_mt, null, 2) + "\n", "utf-8");
      renameSync6(_tmp, TIERS_FILE2);
    }
  } catch {
  }
  if (detectContext7()) console.error(`[vibeOS] context7 detected \u2014 docs nudge enabled`);
  fp = projectFingerprint(directory3);
  setCurrentProjectFingerprint(fp);
  setCurrentProjectName(directory3 ? directory3.split("/").pop() : "unknown");
  activeJob2 = getActiveJobForProject(fp);
  try {
    const state = loadProjectState();
    const bucket = ensureProjectBucket(state, fp);
    bucket.totalSessions = (bucket.totalSessions || 0) + 1;
    bucket.lastSeen = (/* @__PURE__ */ new Date()).toISOString();
    saveProjectState(state);
  } catch (err) {
    console.error(`[vibeOS] project-memory init failed for ${fp}: ${err.message}`);
  }
  try {
    if (directory3 && existsSync15(directory3)) {
      const techStack = detectTechStack(directory3);
      const result = ensureProjectDocs(directory3, techStack);
      if (result.created.length > 0) console.error(`[vibeOS] Project Guard: created ${result.created.join(", ")}`);
      const skillResult = ensureProjectSkill(directory3, fp);
      if (skillResult.created) {
        console.error(`[vibeOS] Project Guard: created ${skillResult.path}`);
      }
    }
  } catch (err) {
    console.error(`[vibeOS] Project Guard init failed: ${err.message}`);
  }
  try {
    writeSelection("enabled", true);
  } catch {
  }
  try {
    const bootstrap = bootstrapOptimizationSession();
    if (!_modelLocked) {
      const applied = applySlot2(bootstrap.slot);
      if (applied?.ok) {
        console.error(`[vibeOS] bootstrap slot \u2192 ${bootstrap.slot} (${applied.ocModel})`);
      }
    }
    void remoteCall("blackboxSelectMode", ["INIT", 0], null).catch(() => {
    });
  } catch {
  }
  const _tiersData = (() => {
    try {
      return safeJsonParse3(readFileSync15(TIERS_FILE2, "utf-8"));
    } catch {
      return {};
    }
  })();
  const trinityDeps = {
    tool,
    _lazyRefresh,
    _readAuth,
    _tiersData,
    _loadOpenCodeProviders,
    _modelCost: _modelCost2,
    _modelTier: _modelTier2,
    _modelLocked,
    _blackboxEnabled,
    _latestBlackboxState,
    currentModel,
    currentTier,
    currentProjectFingerprint,
    currentProjectName,
    get latestUserIntent() {
      return latestUserIntent;
    },
    directory: directory3,
    safeJsonParse: safeJsonParse3,
    readFileSync: readFileSync15,
    writeFileSync: writeFileSync13,
    existsSync: existsSync15,
    renameSync: renameSync6,
    TIERS_FILE: TIERS_FILE2,
    USER_HOME: USER_HOME2,
    STATE_FILE,
    CREDIT_CACHE_F,
    SAVINGS_LEDGER_FILE,
    PROJECT_STATE_FILE,
    REPORTS_DIR,
    REPORTS_INDEX,
    loadSelection,
    writeSelection,
    loadCredit,
    thinkingLevel,
    readLifetimeSavings,
    readFullState,
    _OC_SID,
    formatUsd,
    getBlackboxResolution,
    scoreStress,
    applySlot: applySlot2,
    saveOptimizationMode,
    getFlowWarns,
    projectFingerprint,
    loadProjectState,
    saveProjectState,
    ensureProjectBucket,
    mergeProjectBucket,
    clearProjectPatterns,
    projectPatternRows,
    promotedProjectPatterns,
    detectTechStack,
    ensureProjectDocs,
    discoverAvailableModels,
    classifyAndRankModels,
    modelToCcAlias,
    probeModel,
    setBlackboxEnabled,
    loadBlackboxState,
    saveBlackboxState,
    reportsIndex,
    saveReportsIndex,
    backupFile,
    writeSessionSlot: writeSessionSlot2,
    _refreshModel,
    setApiToken,
    loadTodos,
    upsertTodo,
    getTodos,
    markTodoDone,
    syncFlowTodosToNative,
    get _blackboxTracker() {
      return getBlackboxTracker();
    },
    set _blackboxTracker(v) {
      resetBlackboxTracker();
    }
  };
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
    "experimental.text.complete": async (_input, output) => {
      await _appendFooter(_input, output, directory3);
    },
    "message.updated": async (_input, output) => {
      await _appendFooter(_input, output, directory3);
    },
    tool: {
      trinity: tool(createTrinityTool(trinityDeps)),
      "research-audit": tool({
        description: "Scan session for research anti-patterns (domain chains, redundant queries, no synthesis). hours=N (default 24).",
        args: { hours: tool.schema.number().optional() },
        async execute({ hours } = {}) {
          const report = researchAudit({ hours: hours ?? 24 });
          try {
            const state = loadProjectState();
            const bucket = ensureProjectBucket(state, fp);
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
          getState: () => ({
            ...buildStatusPayload({
              selection: loadSelection(),
              tiersData: (() => {
                try {
                  return safeJsonParse3(readFileSync15(TIERS_FILE2, "utf-8"));
                } catch {
                  return {};
                }
              })(),
              currentModel: currentModel || "",
              creditPercent: loadCredit(),
              version: readPackageVersion(),
              todos: loadTodos(),
              fallbackThinking: thinkingLevel(loadCredit()),
              backendConnected: isApiConnected(),
              backendHealthUrl: `${VIBEOS_API_URL}/health`,
              modelLocked: _modelLocked,
              lockedSlot: _lockedSlot,
              lockedModel: _lockedModel
            }),
            sessions_raw: readFullState()?.sessions || {}
          }),
          getSavings: () => buildSavingsPayload({
            lifetime: readLifetimeSavings(),
            session: readFullState()?.sessions?.[_OC_SID] || {}
          }),
          getSessionMetrics: () => computeSessionMetrics(readFullState(), _OC_SID),
          getTodos: () => loadTodos(),
          listReports: (filter) => {
            if (!existsSync15(REPORTS_DIR)) {
              const e = new Error("reports dir not found");
              e.status = 404;
              throw e;
            }
            return listReports(filter || {});
          },
          readReport: (rvId) => readReport(rvId),
          runDiagnose: async () => diagnoseStructuredFromText(await pluginHooks.tool.trinity.execute({ action: "diagnose" }), loadCredit()),
          runProject: async () => projectStructuredFromText(await pluginHooks.tool.trinity.execute({ action: "project" }), loadSelection(), loadCredit()),
          runTrinity: async (rvAction, params = {}) => pluginHooks.tool.trinity.execute({ action: rvAction, slot: params.slot, level: params.level }),
          runResearchAudit: (hours) => researchAudit({ hours: hours ?? 24 }),
          saveReport: (data) => saveReport(data),
          getCurrentSessionId: () => _OC_SID,
          generateSessionCheckout: () => {
            const state = readFullState();
            const metrics = computeSessionMetrics(state, _OC_SID);
            const session = state?.sessions?.[_OC_SID] || {};
            const flowWarns = getFlowWarns().filter((w) => String(w?.sid || "") === String(process.pid || ""));
            const checkout = buildSessionCheckout({
              sessionId: _OC_SID,
              metrics,
              session,
              flowWarns
            });
            const reportId = saveReport(checkout.report);
            return { ok: true, summary: checkout.summary, report_id: reportId };
          }
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
{
  try {
    const pluginsDir = join16(homedir10(), ".config", "opencode", "plugins");
    if (existsSync15(pluginsDir)) {
      const sub = spawn2("npm", ["install", "vibeostheog@latest"], {
        stdio: "ignore",
        detached: true,
        cwd: pluginsDir
      });
      sub.unref();
    }
  } catch {
  }
}
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
  HIGH_TIER_RE,
  MID_TIER_RE,
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
  detectTechStack,
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
  loadTierRegexes,
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
