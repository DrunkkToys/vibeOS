#!/usr/bin/env node
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

// src/lib/selection-manager.js
import { readFileSync, writeFileSync, existsSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
function getVibeOSHome() {
  return process.env.VIBEOS_HOME || join(process.env.HOME || homedir(), ".claude");
}
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
  } catch (e) {
    throw e;
  }
}
function loadSelection() {
  const TIERS_FILE3 = join(getVibeOSHome(), "model-tiers.json");
  try {
    if (!existsSync(TIERS_FILE3))
      return DFLT_SEL;
    const st = statSync(TIERS_FILE3);
    if (st.size > 10485760) {
      _handleStateCorruption2(TIERS_FILE3);
      return DFLT_SEL;
    }
    const j = safeJsonParse(readFileSync(TIERS_FILE3, "utf-8"));
    return {
      enabled: j?.selection?.enabled !== false,
      active_slot: j?.selection?.active_slot || null,
      slot_locked: j?.selection?.slot_locked === true,
      active_pipeline: j?.selection?.active_pipeline || null,
      optimization_mode: j?.selection?.optimization_mode || null,
      thinking_level: j?.selection?.thinking_level || "off",
      flow_enabled: j?.selection?.flow_enabled === true,
      tdd_enforce: j?.selection?.tdd_enforce === true,
      tdd_strict: j?.selection?.tdd_strict === true,
      tdd_quality: j?.selection?.tdd_quality !== false,
      flow_enforce: j?.selection?.flow_enforce === true,
      delegation_enforce: j?.selection?.delegation_enforce !== false,
      onboarding_mode: j?.selection?.onboarding_mode || null,
      selected_provider: j?.selection?.selected_provider || null,
      selected_quality_tier: j?.selection?.selected_quality_tier || null,
      selected_model: j?.selection?.selected_model || null,
      executed_provider: j?.selection?.executed_provider || null,
      executed_quality_tier: j?.selection?.executed_quality_tier || null,
      executed_model: j?.selection?.executed_model || null,
      requested_optimization_mode: j?.selection?.requested_optimization_mode || null,
      previous_default_agent: j?.selection?.previous_default_agent || null,
      previous_optimization_mode: j?.selection?.previous_optimization_mode || null
    };
  } catch {
    _handleStateCorruption2(TIERS_FILE3);
    return DFLT_SEL;
  }
}
function writeSelection(key, value) {
  const TIERS_FILE3 = join(getVibeOSHome(), "model-tiers.json");
  try {
    return withFileLock(TIERS_FILE3, () => {
      const j = safeJsonParse(readFileSync(TIERS_FILE3, "utf-8"));
      if (!j.selection)
        j.selection = {};
      j.selection[key] = value;
      const tmp = TIERS_FILE3 + ".tmp." + Date.now() + "." + Math.random().toString(36).slice(2, 8);
      writeFileSync(tmp, JSON.stringify(j, null, 2) + "\n");
      renameSync(tmp, TIERS_FILE3);
      return true;
    });
  } catch (err) {
    console.error(`[vibeOS] writeSelection failed: ${err.message}`);
    return false;
  }
}
function loadSessionSlot(sid) {
  const BLACKBOX_FILE = join(getVibeOSHome(), "blackbox-state.json");
  try {
    if (!existsSync(BLACKBOX_FILE))
      return null;
    const j = safeJsonParse(readFileSync(BLACKBOX_FILE, "utf-8"));
    return j?.sessions?.[sid]?.active_slot || null;
  } catch {
    return null;
  }
}
function writeSessionSlot2(sid, slot) {
  const BLACKBOX_FILE = join(getVibeOSHome(), "blackbox-state.json");
  try {
    const j = existsSync(BLACKBOX_FILE) ? safeJsonParse(readFileSync(BLACKBOX_FILE, "utf-8")) : {};
    if (!j.sessions)
      j.sessions = {};
    if (!j.sessions[sid])
      j.sessions[sid] = {};
    j.sessions[sid].active_slot = slot;
    const tmp = BLACKBOX_FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(j, null, 2) + "\n");
    renameSync(tmp, BLACKBOX_FILE);
    return true;
  } catch (err) {
    console.error("[vibeOS] writeSessionSlot failed: " + err.message);
    return false;
  }
}
function loadSessionOptMode(sid) {
  const BLACKBOX_FILE = join(getVibeOSHome(), "blackbox-state.json");
  try {
    if (!existsSync(BLACKBOX_FILE))
      return null;
    const j = safeJsonParse(readFileSync(BLACKBOX_FILE, "utf-8"));
    return j?.sessions?.[sid]?.optimization_mode || null;
  } catch {
    return null;
  }
}
function loadGlobalOptMode() {
  try {
    const sel = loadSelection();
    return sel.optimization_mode || null;
  } catch {
    return null;
  }
}
function saveGlobalOptMode(mode) {
  return writeSelection("optimization_mode", mode);
}
function writeSessionOptMode2(sid, mode) {
  const BLACKBOX_FILE = join(getVibeOSHome(), "blackbox-state.json");
  try {
    const j = existsSync(BLACKBOX_FILE) ? safeJsonParse(readFileSync(BLACKBOX_FILE, "utf-8")) : {};
    if (!j.sessions)
      j.sessions = {};
    if (!j.sessions[sid])
      j.sessions[sid] = {};
    j.sessions[sid].optimization_mode = mode;
    const tmp = BLACKBOX_FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(j, null, 2) + "\n");
    renameSync(tmp, BLACKBOX_FILE);
    return true;
  } catch (err) {
    console.error("[vibeOS] writeSessionOptMode failed: " + err.message);
    return false;
  }
}
var USER_HOME, DFLT_SEL;
var init_selection_manager = __esm({
  "src/lib/selection-manager.js"() {
    "use strict";
    init_state();
    USER_HOME = (() => {
      try {
        return homedir();
      } catch {
        return tmpdir();
      }
    })();
    DFLT_SEL = { enabled: true, active_slot: null, slot_locked: false, thinking_level: "off", flow_enabled: true, tdd_enforce: false, tdd_strict: false, tdd_quality: true, flow_enforce: true, delegation_enforce: true, onboarding_mode: null, selected_provider: null, selected_quality_tier: null, selected_model: null, executed_provider: null, executed_quality_tier: null, executed_model: null, requested_optimization_mode: null, previous_default_agent: null, previous_optimization_mode: null };
  }
});

// src/lib/pattern-helpers.js
import { relative, basename } from "node:path";
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
  return basename(p) || "unknown";
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
var init_pattern_helpers = __esm({
  "src/lib/pattern-helpers.js"() {
    "use strict";
  }
});

// src/lib/runtime-state.js
function getRuntimeState() {
  const g = globalThis;
  if (!g[RUNTIME_KEY]) {
    g[RUNTIME_KEY] = {
      apiConnected: true,
      apiFallbackMode: false,
      apiFallbackSince: null,
      apiEnabled: true,
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
function setApiEnabled(enabled) {
  getRuntimeState().apiEnabled = !!enabled;
}
function isApiEnabled() {
  return !!getRuntimeState().apiEnabled;
}
function isApiFallbackMode() {
  return getRuntimeState().apiFallbackMode;
}
var RUNTIME_KEY;
var init_runtime_state = __esm({
  "src/lib/runtime-state.js"() {
    "use strict";
    RUNTIME_KEY = "__vibeOSRuntimeState";
  }
});

// src/vibeOS-lib/ml-router.js
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
function cascadeDecide(prompt, cheapModelCost, mediumModelCost, brainModelCost, cheapSuccessRate) {
  const diff = computeDifficulty(prompt);
  if (diff.level === "simple" && diff.confidence >= 0.7) {
    const savings2 = brainModelCost - cheapModelCost;
    return {
      useCheap: true,
      escalate: false,
      confidence: diff.confidence,
      reason: `simple query (difficulty ${diff.score.toFixed(2)})`,
      estimatedSavings: Math.max(0, savings2)
    };
  }
  if (diff.level === "complex" && diff.confidence >= 0.7) {
    return {
      useCheap: false,
      escalate: true,
      confidence: diff.confidence,
      reason: `complex query (difficulty ${diff.score.toFixed(2)})`,
      estimatedSavings: 0
    };
  }
  const expectedCheapCost = cheapModelCost / (cheapSuccessRate || 0.01);
  const cascadeCost = cheapModelCost + (1 - cheapSuccessRate) * brainModelCost;
  if (expectedCheapCost < cascadeCost && diff.level !== "complex") {
    const savings2 = Math.max(0, brainModelCost - cheapModelCost);
    return {
      useCheap: true,
      escalate: true,
      confidence: diff.confidence,
      reason: `cascade: cheap (${cheapModelCost}) \u2192 escalate if fail`,
      estimatedSavings: savings2 * cheapSuccessRate
    };
  }
  const tierCost = diff.level === "simple" ? cheapModelCost : mediumModelCost;
  const savings = Math.max(0, brainModelCost - tierCost);
  return {
    useCheap: diff.level === "simple",
    escalate: diff.level !== "complex",
    confidence: diff.confidence,
    reason: `tier match: ${diff.level} (difficulty ${diff.score.toFixed(2)})`,
    estimatedSavings: savings
  };
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
var SIMPLE_ACTIONS, COMPLEX_ACTIONS, ERROR_SIGNAL_WORDS, COMPLEXITY_INDICATORS, FILE_PATH_PATTERN, WORD_FREQUENCY;
var init_ml_router = __esm({
  "src/vibeOS-lib/ml-router.js"() {
    "use strict";
    SIMPLE_ACTIONS = /* @__PURE__ */ new Set([
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
    COMPLEX_ACTIONS = /* @__PURE__ */ new Set([
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
    ERROR_SIGNAL_WORDS = /\b(?:bug|error|fail|crash|broken|wrong|incorrect|issue|problem|exception|stackoverflow|traceback|segfault|race|deadlock|leak|corrupt)\b/g;
    COMPLEXITY_INDICATORS = /multi.*(?:file|module|step|stage|phase|tenant|region|thread|process)|concurrent|async|parallel|distributed|replicated|shard|cluster|microservice|framework|database|schema|migration|backward.*compat|breaking.*change|api.*(?:version|breaking)|protocol|encoding|serializ/;
    FILE_PATH_PATTERN = /(?:^|[\s"'(])\.{0,2}\/[a-zA-Z0-9._/-]+|\.(?:js|ts|tsx|jsx|py|rs|go|java|cpp|c|h|json|yaml|yml|toml|sql|css|html|md)\b|package\.json|tsconfig\.json|dockerfile|makefile|docker-compose/i;
    WORD_FREQUENCY = {
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
  }
});

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
function extractRecentCacheOutputs(db, limit = 10) {
  if (!db?.entries || !Array.isArray(db.entries))
    return [];
  const now = Date.now();
  return db.entries.slice(-limit).map((e) => ({
    hash: e.hash || "",
    tool: e.tool || "",
    prompt: e.prompt?.slice(0, 120) || "",
    sizeBytes: e.sizeBytes || 1024,
    ageSec: e.at ? Math.round((now - new Date(e.at).getTime()) / 1e3) : 3600
  }));
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
var CACHE_HIGH_WEIGHT_WORDS;
var init_smart_cache = __esm({
  "src/vibeOS-lib/smart-cache.js"() {
    "use strict";
    CACHE_HIGH_WEIGHT_WORDS = /* @__PURE__ */ new Set([
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
  }
});

// src/lib/state.js
import { readFileSync as readFileSync2, writeFileSync as writeFileSync2, appendFileSync, existsSync as existsSync2, mkdirSync, statSync as statSync2, readdirSync, openSync, readSync, closeSync, rmSync, copyFileSync, renameSync as renameSync2 } from "node:fs";
import { join as join2, dirname, basename as basename2 } from "node:path";
import { spawn } from "node:child_process";
import { homedir as homedir2, tmpdir as tmpdir2 } from "node:os";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
function getVibeOSHome2() {
  return VIBEOS_CONTEXT.getStore()?.home || process.env.VIBEOS_HOME || join2(process.env.HOME || "", ".claude");
}
function hasOpenCodeConfig(dir) {
  return existsSync2(join2(dir, "opencode.json")) || existsSync2(join2(dir, "opencode.jsonc"));
}
function resolveOpenCodeHomes() {
  const override = process.env.VIBEOS_OPENCODE_HOME;
  if (override)
    return [override];
  const base = process.env.HOME || USER_HOME2;
  const desktopHome = process.env.VIBEOS_OPENCODE_DESKTOP_HOME || (process.platform === "darwin" ? join2(base, "Library", "Application Support", "ai.opencode.desktop") : null);
  const configHome = join2(base, ".config", "opencode");
  const dotHome = join2(base, ".opencode");
  return [desktopHome, configHome, dotHome].filter(Boolean);
}
function resolveOpenCodeHome() {
  const homes = resolveOpenCodeHomes();
  for (const home of homes) {
    if (hasOpenCodeConfig(home))
      return home;
  }
  for (const home of homes) {
    if (existsSync2(home))
      return home;
  }
  return homes[0] || join2(process.env.HOME || USER_HOME2, ".config", "opencode");
}
function getOpenCodeHome() {
  return resolveOpenCodeHome();
}
function setVibeOSHomeContext(home) {
  VIBEOS_CONTEXT.enterWith({ home: String(home || "") });
}
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
function setCurrentSessionId(v) {
  currentSessionId = String(v || _OC_SID);
}
function getCurrentSessionId() {
  return currentSessionId || _OC_SID;
}
function setLastMutationEvent(v) {
  lastMutationEvent = v;
}
function invalidateSavingsCache() {
  _savingsCache = null;
  _savingsCacheMtime = 0;
}
function setMlSavePending(v) {
  _mlSavePending = v;
}
function setBlackboxEnabled(val) {
  _blackboxEnabled = val;
}
function setModelLocked(val) {
  _modelLocked = !!val;
}
function setLockedSlot(val) {
  _lockedSlot = val ? String(val) : null;
}
function setLockedModel(val) {
  _lockedModel = val ? String(val) : null;
}
function setLedgerBufferTimer(val) {
  _ledgerBufferTimer = val;
}
function _zType(base) {
  return Object.assign((...a) => _zType({ ...base, args: a }), {
    optional: () => _zType({ ...base, optional: true }),
    _isZod: true,
    _base: base
  });
}
function _pruneCorruptionBackups(backupDir) {
  try {
    if (!existsSync2(backupDir))
      return;
    const now = Date.now();
    const backups = readdirSync(backupDir).map((name) => {
      const path = join2(backupDir, name);
      try {
        const st = statSync2(path);
        return { name, path, mtimeMs: st.mtimeMs };
      } catch {
        return null;
      }
    }).filter((entry) => !!entry && entry.name.includes(".corrupted.")).sort((a, b) => b.mtimeMs - a.mtimeMs);
    const keep = new Set(backups.slice(0, CORRUPTION_BACKUP_MAX).map((b) => b.path));
    for (const backup of backups) {
      const isExpired = now - backup.mtimeMs > CORRUPTION_BACKUP_TTL_MS;
      if (isExpired || !keep.has(backup.path)) {
        try {
          rmSync(backup.path, { force: true });
        } catch {
        }
      }
    }
  } catch {
  }
}
function runStartupMaintenanceOnce() {
  try {
    const home = getVibeOSHome2();
    if (!home || home === _startupMaintenanceHome)
      return;
    _startupMaintenanceHome = home;
    _pruneCorruptionBackups(join2(home, ".backups"));
    loadActiveJobs();
    _compactSavingsLedgerIfNeeded();
  } catch {
  }
}
function _ensureVibeOSHomeDir() {
  try {
    if (!existsSync2(VIBEOS_HOME)) {
      mkdirSync(VIBEOS_HOME, { recursive: true });
      return VIBEOS_HOME;
    }
    const st = statSync2(VIBEOS_HOME);
    if (!st.isDirectory()) {
      const backup = VIBEOS_HOME + ".backup." + Date.now();
      renameSync2(VIBEOS_HOME, backup);
      mkdirSync(VIBEOS_HOME, { recursive: true });
    }
    return VIBEOS_HOME;
  } catch {
    return VIBEOS_HOME;
  }
}
function _handleStateCorruption2(path) {
  _ensureVibeOSHomeDir();
  const backupDir = join2(VIBEOS_HOME, ".backups");
  try {
    mkdirSync(backupDir, { recursive: true });
  } catch {
  }
  const backupPath = join2(backupDir, basename2(path) + ".corrupted." + Date.now());
  try {
    copyFileSync(path, backupPath);
  } catch {
  }
  const logPath = join2(VIBEOS_HOME, ".state-corruption-log.jsonl");
  try {
    appendFileSync(logPath, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), path, backup: backupPath }) + "\n");
  } catch {
  }
  _pruneCorruptionBackups(backupDir);
  return backupPath;
}
function _lockPathFor(filePath) {
  const hash = createHash("sha1").update(String(filePath || "")).digest("hex");
  return join2(FILE_LOCK_DIR, `${hash}.lock`);
}
function withFileLock(filePath, fn, opts = {}) {
  const staleMs = Number(opts.staleMs || 3e4);
  const timeoutMs = Number(opts.timeoutMs || 2e3);
  const lockPath = _lockPathFor(filePath);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      mkdirSync(FILE_LOCK_DIR, { recursive: true });
      const fd = openSync(lockPath, "wx");
      try {
        writeFileSync2(fd, `${process.pid}
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
        if (existsSync2(lockPath)) {
          const age = Date.now() - statSync2(lockPath).mtimeMs;
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
    if (!existsSync2(filePath))
      return {};
    const st = statSync2(filePath);
    if (st.size > 10485760) {
      _handleStateCorruption2(filePath);
      return {};
    }
    return safeJsonParse2(readFileSync2(filePath, "utf-8"));
  } catch {
    _handleStateCorruption2(filePath);
    return {};
  }
}
function updateState(mutator) {
  const delegationStateFile = join2(getVibeOSHome2(), "delegation-state.json");
  const MAX_RETRIES2 = 3;
  for (let attempt = 0; attempt < MAX_RETRIES2; attempt++) {
    try {
      const result = withFileLock(delegationStateFile, () => {
        const preGen = readJsonOrEmpty(delegationStateFile)._gen || 0;
        let state = readJsonOrEmpty(delegationStateFile);
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
        validateState(next, delegationStateFile);
        mkdirSync(dirname(delegationStateFile), { recursive: true });
        const tmp = delegationStateFile + ".tmp";
        writeFileSync2(tmp, JSON.stringify(next, null, 2) + "\n");
        renameSync2(tmp, delegationStateFile);
        invalidateSavingsCache();
        return next;
      });
      return result;
    } catch (err) {
      if (attempt === MAX_RETRIES2 - 1) {
        if (process.env.VIBEOS_DEBUG_INTERNALS === "1") {
          console.error(`[vibeOS] updateState failed after ${MAX_RETRIES2} retries: ${err.message}`);
        }
        return null;
      }
    }
  }
  return null;
}
function readFullState() {
  const delegationStateFile = join2(getVibeOSHome2(), "delegation-state.json");
  try {
    if (!existsSync2(delegationStateFile))
      return {};
    const st = statSync2(delegationStateFile);
    if (st.size > 10485760) {
      _handleStateCorruption2(delegationStateFile);
      return {};
    }
    return safeJsonParse2(readFileSync2(delegationStateFile, "utf-8"));
  } catch {
    _handleStateCorruption2(delegationStateFile);
    return {};
  }
}
function roundUsd(v) {
  return Math.round((Number(v) || 0) * 1e4) / 1e4;
}
function _safeRegex(cfg, fallback2, label) {
  if (!cfg)
    return fallback2;
  try {
    return new RegExp(cfg, "i");
  } catch (e) {
    console.error(`[vibeOS] Invalid ${label}-tier regex in model-tiers.json: ${e.message}. Falling back.`);
    return fallback2;
  }
}
function loadTierRegexes() {
  try {
    const p = join2(getVibeOSHome2(), "model-tiers.json");
    if (!existsSync2(p))
      return { high: FALLBACK_HIGH, mid: FALLBACK_MID };
    const j = safeJsonParse2(readFileSync2(p, "utf-8"));
    const highRe = _safeRegex(j?.tiers?.high?.regex, FALLBACK_HIGH, "high");
    const midRe = _safeRegex(j?.tiers?.mid?.regex, FALLBACK_MID, "mid");
    return { high: highRe, mid: midRe };
  } catch {
    return { high: FALLBACK_HIGH, mid: FALLBACK_MID };
  }
}
function loadGlobalLearning() {
  const globalLearningFile = join2(getVibeOSHome2(), "global-learning.json");
  try {
    if (!existsSync2(globalLearningFile))
      return DFLT_GL;
    const st = statSync2(globalLearningFile);
    if (st.size > 10485760) {
      _handleStateCorruption2(globalLearningFile);
      return DFLT_GL;
    }
    const j = safeJsonParse2(readFileSync2(globalLearningFile, "utf-8"));
    if (!j || typeof j !== "object")
      return DFLT_GL;
    j.exploratory_words ??= {};
    j.task_first_words ??= {};
    j.context7_bypasses ??= 0;
    j.context7_missed_usd ??= 0;
    j.context7_last_seen ??= null;
    return j;
  } catch {
    _handleStateCorruption2(globalLearningFile);
    return DFLT_GL;
  }
}
function updateGlobalLearning(mutator) {
  const globalLearningFile = join2(getVibeOSHome2(), "global-learning.json");
  return withFileLock(globalLearningFile, () => {
    const s = loadGlobalLearning();
    const next = mutator(s) ?? s;
    next.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    mkdirSync(dirname(globalLearningFile), { recursive: true });
    const tmp = globalLearningFile + ".tmp";
    writeFileSync2(tmp, JSON.stringify(next, null, 2));
    renameSync2(tmp, globalLearningFile);
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
function loadBlackboxState() {
  const blackboxFile = join2(getVibeOSHome2(), "blackbox-state.json");
  try {
    if (!existsSync2(blackboxFile))
      return { enabled: true, sessions: {} };
    const st = statSync2(blackboxFile);
    if (st.size > 10485760) {
      _handleStateCorruption2(blackboxFile);
      return { enabled: false, sessions: {} };
    }
    const raw = safeJsonParse2(readFileSync2(blackboxFile, "utf-8")) || { enabled: false, sessions: {} };
    if (!raw.sessions || typeof raw.sessions !== "object")
      raw.sessions = {};
    const now = Date.now();
    let changed = false;
    for (const [sid, session] of Object.entries(raw.sessions)) {
      if (!session || typeof session !== "object")
        continue;
      const { record: next, changed: recordChanged } = normalizeBlackboxRecord(session, sid, now);
      raw.sessions[sid] = next;
      if (recordChanged)
        changed = true;
    }
    if (changed) {
      try {
        saveBlackboxState(raw);
      } catch {
      }
    }
    return raw;
  } catch {
    _handleStateCorruption2(blackboxFile);
    return { enabled: false, sessions: {} };
  }
}
function saveBlackboxState(state) {
  const blackboxFile = join2(getVibeOSHome2(), "blackbox-state.json");
  try {
    const next = state && typeof state === "object" ? state : { enabled: true, sessions: {} };
    next.sessions ??= {};
    const now = Date.now();
    for (const [sid, session] of Object.entries(next.sessions)) {
      if (!session || typeof session !== "object")
        continue;
      next.sessions[sid] = normalizeBlackboxRecord(session, sid, now).record;
    }
    mkdirSync(dirname(blackboxFile), { recursive: true });
    const tmp = blackboxFile + ".tmp";
    writeFileSync2(tmp, JSON.stringify(next, null, 2) + "\n");
    renameSync2(tmp, blackboxFile);
  } catch (err) {
    console.error(`[vibeOS] saveBlackboxState failed: ${err.message}`);
  }
}
function normalizeBlackboxRecord(record, sid, now) {
  const next = { ...record || {} };
  let changed = false;
  const createdAtRaw = typeof next.createdAt === "string" ? next.createdAt : "";
  const updatedAtRaw = typeof next.updatedAt === "string" ? next.updatedAt : "";
  const startedRaw = typeof next.started === "string" ? next.started : "";
  const sessionStartedRaw = typeof next.session_started_at === "string" ? next.session_started_at : "";
  const anchorRaw = [createdAtRaw, updatedAtRaw, startedRaw, sessionStartedRaw].find((v) => v && !Number.isNaN(Date.parse(v)));
  const anchorMs = anchorRaw ? Date.parse(anchorRaw) : NaN;
  if (!Number.isFinite(Date.parse(createdAtRaw))) {
    next.createdAt = Number.isFinite(anchorMs) ? new Date(anchorMs).toISOString() : new Date(now).toISOString();
    changed = true;
  }
  if (!Number.isFinite(Date.parse(updatedAtRaw))) {
    next.updatedAt = next.createdAt || new Date(now).toISOString();
    changed = true;
  }
  if (typeof next.sessionId !== "string" || !next.sessionId.trim()) {
    next.sessionId = String(sid || "");
    changed = true;
  }
  if (typeof next.project_fingerprint !== "string" || !next.project_fingerprint.trim()) {
    if (typeof currentProjectFingerprint === "string" && currentProjectFingerprint.trim()) {
      next.project_fingerprint = currentProjectFingerprint.trim();
      changed = true;
    }
  }
  if (typeof next.project_name !== "string" || !next.project_name.trim()) {
    if (typeof currentProjectName === "string" && currentProjectName.trim()) {
      next.project_name = currentProjectName.trim();
      changed = true;
    }
  }
  if (typeof next.regime !== "string" || !next.regime.trim()) {
    next.regime = typeof next.sub_regime === "string" && next.sub_regime.trim() ? next.sub_regime.trim() : "INIT";
    changed = true;
  }
  if (typeof next.sub_regime !== "string" || !next.sub_regime.trim()) {
    next.sub_regime = "INIT";
    changed = true;
  }
  if (typeof next.resolution !== "string" || !next.resolution.trim()) {
    next.resolution = "unresolved";
    changed = true;
  }
  if (!Number.isFinite(Number(next.momentum))) {
    next.momentum = 0;
    changed = true;
  }
  if (!Number.isFinite(Number(next.turn_counter))) {
    next.turn_counter = 0;
    changed = true;
  }
  if (!Number.isFinite(Number(next.loopCount))) {
    next.loopCount = 0;
    changed = true;
  }
  if (!Number.isFinite(Number(next.loop_consecutive))) {
    next.loop_consecutive = Number(next.loopCount || 0);
    changed = true;
  }
  if (!Array.isArray(next.history)) {
    next.history = [];
    changed = true;
  }
  if (!Array.isArray(next.pivotHistory)) {
    next.pivotHistory = [];
    changed = true;
  }
  if (!Array.isArray(next.outcomeHistory)) {
    next.outcomeHistory = [];
    changed = true;
  }
  return { record: next, changed };
}
function getSessionRoot() {
  return join2(SCRATCHPAD_SESSIONS_DIR, _OC_SID);
}
function getSessionScratchpadDir() {
  return join2(getSessionRoot(), "by-hash");
}
function getSessionIndexPath() {
  return join2(getSessionRoot(), "index.jsonl");
}
function getGlobalIndexPath() {
  return join2(SCRATCHPAD_ROOT, "index.jsonl");
}
function ensureSessionScratchpadDirs() {
  try {
    mkdirSync(getSessionScratchpadDir(), { recursive: true });
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
    appendFileSync(SAVINGS_LEDGER_FILE, joined);
    _compactSavingsLedgerIfNeeded();
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
    mkdirSync(dirname(globalIndex), { recursive: true });
    mkdirSync(dirname(sessionIndex), { recursive: true });
    appendFileSync(globalIndex, entry);
    appendFileSync(sessionIndex, entry);
  } catch (err) {
    console.error(`[vibeOS] index write failed: ${err.message}`);
  }
}
function scanRecentScratchpad(dir, titleCase, maxScan = 2e3) {
  try {
    if (!existsSync2(dir))
      return null;
    const entries = readdirSync(dir);
    const ptrFiles = entries.filter((e) => e.endsWith(".ptr"));
    const ptrCandidates = [];
    for (const pf of ptrFiles) {
      if (ptrCandidates.length >= MAX_PTR_CANDIDATES)
        break;
      try {
        const st = statSync2(join2(dir, pf));
        ptrCandidates.push({ ptrPath: join2(dir, pf), mtimeMs: st.mtimeMs });
      } catch {
      }
    }
    ptrCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    let scanned = 0;
    for (const { ptrPath } of ptrCandidates) {
      if (scanned++ >= maxScan)
        break;
      try {
        const ptrData = safeJsonParse2(readFileSync2(ptrPath, "utf-8"));
        if (!ptrData?.contentHash)
          continue;
        const ptrTool = typeof ptrData.tool === "string" ? TOOL_NAME_NORMALIZE[ptrData.tool] || ptrData.tool : null;
        if (titleCase && ptrTool && ptrTool !== titleCase)
          continue;
        const contentHash = String(ptrData.contentHash);
        const f = join2(dir, `${contentHash}.txt`);
        if (!existsSync2(f))
          continue;
        const st = statSync2(f);
        const ageSec = (Date.now() - st.mtimeMs) / 1e3;
        if (ageSec > SCRATCHPAD_MAX_AGE_SEC)
          continue;
        const sumPath = join2(dir, `${contentHash}.summary.txt`);
        return { hash: contentHash, fullPath: f, sizeBytes: st.size, ageSec: Math.round(ageSec), summaryPath: existsSync2(sumPath) ? sumPath : null };
      } catch {
      }
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
  const sessionPath = join2(sessionDir, `${hash}.txt`);
  let fullPath = existsSync2(sessionPath) ? sessionPath : null;
  if (!fullPath) {
    const ptrSessionPath = join2(sessionDir, `${hash}.ptr`);
    const ptrPath = existsSync2(ptrSessionPath) ? ptrSessionPath : null;
    let resolvedHash = hash;
    if (ptrPath) {
      try {
        const ptrData = safeJsonParse2(readFileSync2(ptrPath, "utf-8"));
        if (ptrData?.contentHash) {
          resolvedHash = ptrData.contentHash;
          const rSessionPath = join2(sessionDir, `${resolvedHash}.txt`);
          fullPath = existsSync2(rSessionPath) ? rSessionPath : null;
        }
      } catch {
      }
    }
    if (!fullPath) {
      const recent = scanRecentScratchpad(sessionDir, titleCase, 2e3);
      if (recent)
        return recent;
      return null;
    }
  }
  try {
    const st = statSync2(fullPath);
    const ageSec = (Date.now() - st.mtimeMs) / 1e3;
    if (ageSec > SCRATCHPAD_MAX_AGE_SEC)
      return null;
    const summaryPath = join2(sessionDir, `${hash}.summary.txt`);
    const finalSummary = existsSync2(summaryPath) ? summaryPath : null;
    return {
      hash,
      fullPath,
      sizeBytes: st.size,
      ageSec: Math.round(ageSec),
      summaryPath: finalSummary
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
  if (!existsSync2(targetDir))
    return { dataFiles: 0, totalBytes: 0, deleted: 0, rotated: 0 };
  const entries = readdirSync(targetDir);
  let dataFiles = 0;
  let totalBytes = 0;
  let deleted = 0;
  let rotated = 0;
  for (const entry of entries) {
    if (entry.endsWith(".meta.json") || entry.endsWith(".summary.txt"))
      continue;
    const fullPath = join2(targetDir, entry);
    let st;
    try {
      st = statSync2(fullPath);
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
      const meta = join2(targetDir, hash + ".meta.json");
      if (existsSync2(meta))
        try {
          rmSync(meta);
        } catch {
        }
      const summary = join2(targetDir, hash + ".summary.txt");
      if (existsSync2(summary))
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
      const summaryPath = join2(targetDir, hash + ".summary.txt");
      if (!existsSync2(summaryPath))
        try {
          const content = readFileSync2(fullPath, "utf-8");
          writeFileSync2(summaryPath, content.slice(0, 200).replace(/\n+/g, " ").trim() + (content.length > 200 ? "\u2026" : ""));
        } catch {
        }
      const head = _readHead(fullPath);
      if (!head.includes("[cold-storage]"))
        try {
          writeFileSync2(fullPath, `[cold-storage] ${st.size}B original \u2192 ${hash}.summary.txt`);
          rotated++;
        } catch {
        }
      continue;
    }
    if (age > DECADENCE_FRESH_MS && st.size > 1024) {
      const summaryPath = join2(targetDir, hash + ".summary.txt");
      if (!existsSync2(summaryPath))
        try {
          const content = readFileSync2(fullPath, "utf-8");
          writeFileSync2(summaryPath, content.slice(0, SUMMARY_HEAD_TRUNCATE).replace(/\n+/g, " ").trim() + (content.length > SUMMARY_HEAD_TRUNCATE ? "\u2026" : ""));
        } catch {
        }
      const head = _readHead(fullPath);
      if (!head.includes("[warm-storage]") && !head.includes("[cold-storage]"))
        try {
          writeFileSync2(fullPath, `[warm-storage] ${st.size}B original at ${hash}.summary.txt`);
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
    if (!existsSync2(SCRATCHPAD_SESSIONS_DIR))
      return;
    const dirs = readdirSync(SCRATCHPAD_SESSIONS_DIR);
    const now = Date.now();
    for (const d of dirs) {
      const full = join2(SCRATCHPAD_SESSIONS_DIR, d);
      try {
        const st = statSync2(full);
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
    const script = join2(VIBEOS_HOME, "hooks/scratchpad-prune.sh");
    if (existsSync2(script)) {
      const child = spawn("bash", [script], { detached: true, stdio: "ignore" });
      child.unref();
    }
  } catch {
  }
  cleanupStaleSessionScratchpads();
}
function _readActiveJobsRaw() {
  try {
    if (!existsSync2(ACTIVE_JOBS_FILE))
      return {};
    const raw = safeJsonParse2(readFileSync2(ACTIVE_JOBS_FILE, "utf-8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    _handleStateCorruption2(ACTIVE_JOBS_FILE);
    return {};
  }
}
function _writeActiveJobsRaw(jobs) {
  try {
    mkdirSync(dirname(ACTIVE_JOBS_FILE), { recursive: true });
    const tmp = ACTIVE_JOBS_FILE + ".tmp";
    writeFileSync2(tmp, JSON.stringify(jobs, null, 2) + "\n");
    renameSync2(tmp, ACTIVE_JOBS_FILE);
  } catch {
  }
}
function _normalizeActiveJobRecord(record, now = Date.now(), strict = false) {
  if (!record || typeof record !== "object")
    return { record: null, changed: false, stale: false };
  const next = { ...record };
  let changed = false;
  const updatedAtRaw = typeof next.updatedAt === "string" ? next.updatedAt : "";
  const createdAtRaw = typeof next.createdAt === "string" ? next.createdAt : "";
  const updatedAtMs = Date.parse(updatedAtRaw);
  const createdAtMs = Date.parse(createdAtRaw);
  const anchorMs = Number.isFinite(updatedAtMs) ? updatedAtMs : createdAtMs;
  const stale = Number.isFinite(anchorMs) && now - anchorMs > ACTIVE_JOBS_STALE_MS;
  if (strict && (!next.status || typeof next.status !== "string" || !next.status.trim()))
    return { record: null, changed: false, stale };
  if (strict && !Number.isFinite(createdAtMs))
    return { record: null, changed: false, stale };
  if (!Number.isFinite(createdAtMs)) {
    next.createdAt = Number.isFinite(anchorMs) ? new Date(anchorMs).toISOString() : new Date(now).toISOString();
    changed = true;
  }
  if (!Number.isFinite(updatedAtMs)) {
    next.updatedAt = next.createdAt || new Date(now).toISOString();
    changed = true;
  }
  if (typeof next.status !== "string" || !next.status.trim()) {
    next.status = "active";
    changed = true;
  }
  if (stale && next.status !== "completed") {
    next.status = "completed";
    next.completedAt = new Date(now).toISOString();
    changed = true;
  }
  return { record: next, changed, stale };
}
function loadActiveJobs() {
  try {
    return withFileLock(ACTIVE_JOBS_FILE, () => {
      const raw = _readActiveJobsRaw();
      const next = {};
      let changed = false;
      const now = Date.now();
      for (const [key, value] of Object.entries(raw || {})) {
        const norm = _normalizeActiveJobRecord(value, now, true);
        if (!norm.record || norm.stale && norm.record.status === "completed" && norm.record.completedAt) {
          changed = true;
          continue;
        }
        next[key] = norm.record;
        if (norm.changed)
          changed = true;
      }
      if (changed)
        _writeActiveJobsRaw(next);
      return next;
    });
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
    withFileLock(ACTIVE_JOBS_FILE, () => {
      const jobs = _readActiveJobsRaw();
      const norm = _normalizeActiveJobRecord(job);
      jobs[fp2] = norm.record || job;
      _writeActiveJobsRaw(jobs);
    });
  } catch {
  }
}
function projectFingerprint(dir) {
  if (!dir)
    return "unknown";
  return createHash("sha256").update(dir).digest("hex").slice(0, 12);
}
function loadProjectState() {
  const projectStateFile = join2(getVibeOSHome2(), "project-states.json");
  try {
    const state = readJsonOrEmpty(projectStateFile);
    if (state && typeof state === "object") {
      state.project_hashes ??= {};
      return state;
    }
  } catch {
  }
  return { project_hashes: {} };
}
function saveProjectState(state) {
  const projectStateFile = join2(getVibeOSHome2(), "project-states.json");
  try {
    withFileLock(projectStateFile, () => {
      mkdirSync(dirname(projectStateFile), { recursive: true });
      const _tmp = projectStateFile + ".tmp." + Date.now();
      writeFileSync2(_tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
      renameSync2(_tmp, projectStateFile);
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
      sessions: [],
      reports: [],
      updatedAt: null,
      lastSeen: null,
      techStack: detectTechStack(process.cwd())
    };
  }
  return state.project_hashes[fp2];
}
function touchProjectBucket(state, fp2, meta = {}) {
  if (!fp2 || fp2 === "unknown")
    return null;
  const bucket = ensureProjectBucket(state, fp2);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  bucket.updatedAt = now;
  bucket.lastSeen = now;
  if (typeof meta.projectName === "string" && meta.projectName.trim()) {
    bucket.projectName = meta.projectName.trim();
  }
  if (typeof meta.sessionId === "string" && meta.sessionId.trim()) {
    bucket.sessions ??= [];
    if (!bucket.sessions.includes(meta.sessionId)) {
      bucket.sessions.push(meta.sessionId);
      bucket.sessions = bucket.sessions.slice(-30);
      bucket.totalSessions = Number(bucket.totalSessions || 0) + 1;
    }
    bucket.totalSessions = Math.max(Number(bucket.totalSessions || 0), bucket.sessions.length, 1);
  }
  if (typeof meta.reportId === "string" && meta.reportId.trim()) {
    bucket.reports ??= [];
    if (!bucket.reports.includes(meta.reportId)) {
      bucket.reports.push(meta.reportId);
      bucket.reports = bucket.reports.slice(-50);
    }
  }
  if (typeof meta.topic === "string" && meta.topic.trim()) {
    bucket.commonTopics ??= [];
    if (!bucket.commonTopics.includes(meta.topic)) {
      bucket.commonTopics.push(meta.topic);
      bucket.commonTopics = bucket.commonTopics.slice(-20);
    }
  }
  return bucket;
}
function detectTechStack(dir) {
  const stacks = [];
  try {
    const pkg = safeJsonParse2(readFileSync2(join2(dir, "package.json"), "utf-8"));
    if (pkg) {
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript || existsSync2(join2(dir, "tsconfig.json")))
        stacks.push("typescript");
      if (pkg.dependencies?.react || pkg.devDependencies?.react)
        stacks.push("react");
      stacks.push("javascript");
    }
  } catch {
  }
  try {
    if (existsSync2(join2(dir, "Cargo.toml")))
      stacks.push("rust");
  } catch {
  }
  try {
    if (existsSync2(join2(dir, "go.mod")))
      stacks.push("go");
  } catch {
  }
  try {
    if (existsSync2(join2(dir, "requirements.txt")))
      stacks.push("python");
    if (existsSync2(join2(dir, "setup.py")))
      stacks.push("python");
    if (existsSync2(join2(dir, "pyproject.toml")))
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
        const minSessions = label === "routine" ? 2 : 3;
        if (sessions.size >= minSessions)
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
function recordCacheSaving(tool2, saveEst, meta = {}) {
  try {
    const state = updateState((s) => {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const delta = Number(saveEst || 0);
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" };
      s.lifetime.last_updated = now;
      s.sessions ??= {};
      const sid2 = _OC_SID;
      s.sessions[sid2] ??= { started: now, session_started_at: now, source: "opencode", tool_counts: {}, warns: [] };
      if (currentProjectFingerprint && !s.sessions[sid2].project_fingerprint)
        s.sessions[sid2].project_fingerprint = currentProjectFingerprint;
      if (currentProjectName && !s.sessions[sid2].project_name)
        s.sessions[sid2].project_name = currentProjectName;
      s.sessions[sid2].session_cache_dir = getSessionScratchpadDir();
      s.sessions[sid2].tool_counts[tool2] = (s.sessions[sid2].tool_counts[tool2] || 0) + 1;
      if (meta?.hash) {
        s.sessions[sid2].cache_hits ??= [];
        if (!s.sessions[sid2].cache_hits.some((h) => h.hash === meta.hash)) {
          s.sessions[sid2].cache_hits.push({
            at: now,
            tool: tool2,
            hash: meta.hash,
            est_savings_usd: roundUsd(delta)
          });
          s.sessions[sid2].cache_savings_usd = roundUsd(Number(s.sessions[sid2].cache_savings_usd || 0) + delta);
          s.lifetime.cache_savings_usd = roundUsd(Number(s.lifetime.cache_savings_usd || 0) + delta);
          if (s.sessions[sid2].cache_hits.length > 200) {
            console.error(`[vibeOS] session cache_hits truncated from ${s.sessions[sid2].cache_hits.length} to 200 for ${sid2}`);
            s.sessions[sid2].cache_hits = s.sessions[sid2].cache_hits.slice(-200);
          }
        }
      } else {
        s.sessions[sid2].cache_savings_usd = roundUsd(Number(s.sessions[sid2].cache_savings_usd || 0) + delta);
        s.lifetime.cache_savings_usd = roundUsd(Number(s.lifetime.cache_savings_usd || 0) + delta);
      }
      try {
        if (currentProjectFingerprint) {
          const pstate = loadProjectState();
          touchProjectBucket(pstate, currentProjectFingerprint, {
            sessionId: sid2,
            projectName: currentProjectName || "",
            topic: meta?.hash ? String(meta.hash).slice(0, 16) : "cache"
          });
          saveProjectState(pstate);
        }
      } catch {
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
      try {
        if (currentProjectFingerprint) {
          const pstate = loadProjectState();
          const bucket = touchProjectBucket(pstate, currentProjectFingerprint, {
            sessionId: sid,
            projectName: currentProjectName || "",
            topic: "context7"
          });
          if (bucket)
            bucket.context7Bypasses = (bucket.context7Bypasses || 0) + 1;
          saveProjectState(pstate);
        }
      } catch {
      }
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
    if (!existsSync2(TODOS_FILE))
      return [];
    const raw = readFileSync2(TODOS_FILE, "utf-8");
    const parsed = safeJsonParse2(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveTodos(todos) {
  try {
    mkdirSync(dirname(TODOS_FILE), { recursive: true });
    const tmp = TODOS_FILE + ".tmp." + Date.now();
    writeFileSync2(tmp, JSON.stringify(todos, null, 2), "utf-8");
    renameSync2(tmp, TODOS_FILE);
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
function _compactSavingsLedgerIfNeeded() {
  try {
    if (!existsSync2(SAVINGS_LEDGER_FILE))
      return;
    const st = statSync2(SAVINGS_LEDGER_FILE);
    if (st.size <= LEDGER_ROTATE_MAX_BYTES)
      return;
    withFileLock(SAVINGS_LEDGER_FILE, () => {
      if (!existsSync2(SAVINGS_LEDGER_FILE))
        return;
      const lockedStat = statSync2(SAVINGS_LEDGER_FILE);
      if (lockedStat.size <= LEDGER_ROTATE_MAX_BYTES)
        return;
      const raw = readFileSync2(SAVINGS_LEDGER_FILE, "utf-8");
      if (!raw.trim())
        return;
      const now = Date.now();
      const rows = raw.split("\n").filter(Boolean).map((line) => {
        let rec = null;
        try {
          rec = JSON.parse(line);
        } catch {
          rec = null;
        }
        const atRaw = rec && typeof rec === "object" ? String(rec.at || rec.ts || "") : "";
        const atMs = Date.parse(atRaw);
        return { raw: line.trim(), atMs: Number.isFinite(atMs) ? atMs : null };
      }).filter((row) => row.raw);
      const recent = rows.filter((row) => row.atMs != null && now - Number(row.atMs) <= LEDGER_ROTATE_MAX_AGE_MS);
      const pool = recent.length > 0 ? recent : rows;
      const capped = pool.length > LEDGER_ROTATE_MAX_LINES ? pool.slice(-LEDGER_ROTATE_MAX_LINES) : pool;
      let size = 0;
      const kept = [];
      for (let i = capped.length - 1; i >= 0; i--) {
        const line = capped[i].raw;
        const lineBytes = Buffer.byteLength(line + "\n", "utf-8");
        if (kept.length > 0 && size + lineBytes > LEDGER_ROTATE_MAX_BYTES)
          break;
        kept.push(line);
        size += lineBytes;
      }
      const compacted = kept.reverse().join("\n") + "\n";
      if (compacted.trim() && compacted !== raw) {
        const tmp = SAVINGS_LEDGER_FILE + ".tmp." + Date.now();
        writeFileSync2(tmp, compacted, "utf-8");
        renameSync2(tmp, SAVINGS_LEDGER_FILE);
      }
    }, { timeoutMs: 4e3 });
  } catch {
  }
}
function readLedgerTotals() {
  const empty = { delegation: 0, cache: 0, context7: 0, total: 0, entries: 0 };
  try {
    if (!existsSync2(SAVINGS_LEDGER_FILE)) {
      _ledgerTotalsCache = { mtime: 0, size: 0, delegation: 0, cache: 0, context7: 0, entries: 0 };
      return empty;
    }
    const st = statSync2(SAVINGS_LEDGER_FILE);
    if (st.size === 0) {
      _ledgerTotalsCache = { mtime: st.mtimeMs, size: 0, delegation: 0, cache: 0, context7: 0, entries: 0 };
      return empty;
    }
    if (st.size > LEDGER_ROTATE_MAX_BYTES) {
      _compactSavingsLedgerIfNeeded();
    }
    const currentStat = statSync2(SAVINGS_LEDGER_FILE);
    if (currentStat.size === 0) {
      _ledgerTotalsCache = { mtime: currentStat.mtimeMs, size: 0, delegation: 0, cache: 0, context7: 0, entries: 0 };
      return empty;
    }
    if (_ledgerTotalsCache.mtime === currentStat.mtimeMs && _ledgerTotalsCache.size === currentStat.size) {
      return {
        delegation: Math.round(_ledgerTotalsCache.delegation * 1e3) / 1e3,
        cache: Math.round(_ledgerTotalsCache.cache * 1e3) / 1e3,
        context7: Math.round(_ledgerTotalsCache.context7 * 1e3) / 1e3,
        total: Math.round((_ledgerTotalsCache.delegation + _ledgerTotalsCache.cache) * 1e3) / 1e3,
        entries: _ledgerTotalsCache.entries
      };
    }
    let delegation = 0;
    let cache = 0;
    let context7 = 0;
    let entries = 0;
    let raw = "";
    let incremental = _ledgerTotalsCache.size > 0 && currentStat.size >= _ledgerTotalsCache.size && _ledgerTotalsCache.mtime > 0;
    if (incremental) {
      const deltaSize = currentStat.size - _ledgerTotalsCache.size;
      if (deltaSize > 0) {
        const fd = openSync(SAVINGS_LEDGER_FILE, "r");
        try {
          const buf = Buffer.allocUnsafe(deltaSize);
          const bytesRead = readSync(fd, buf, 0, deltaSize, _ledgerTotalsCache.size);
          raw = buf.toString("utf-8", 0, bytesRead);
        } finally {
          try {
            closeSync(fd);
          } catch {
          }
        }
      } else {
        incremental = false;
      }
      delegation = _ledgerTotalsCache.delegation;
      cache = _ledgerTotalsCache.cache;
      context7 = _ledgerTotalsCache.context7;
      entries = _ledgerTotalsCache.entries;
    }
    if (!incremental) {
      raw = readFileSync2(SAVINGS_LEDGER_FILE, "utf-8");
    }
    if (!raw.trim()) {
      _ledgerTotalsCache = {
        mtime: currentStat.mtimeMs,
        size: currentStat.size,
        delegation,
        cache,
        context7,
        entries
      };
      return {
        delegation: Math.round(delegation * 1e3) / 1e3,
        cache: Math.round(cache * 1e3) / 1e3,
        context7: Math.round(context7 * 1e3) / 1e3,
        total: Math.round((delegation + cache) * 1e3) / 1e3,
        entries
      };
    }
    const lines = raw.split("\n");
    if (raw.endsWith("\n"))
      lines.pop();
    for (const line of lines) {
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
    _ledgerTotalsCache = { mtime: currentStat.mtimeMs, size: currentStat.size, delegation, cache, context7, entries };
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
    const ledgerStat = existsSync2(SAVINGS_LEDGER_FILE) ? statSync2(SAVINGS_LEDGER_FILE) : null;
    const ledgerMtime = ledgerStat?.mtimeMs || 0;
    const ledgerSize = ledgerStat?.size || 0;
    if (ledgerMtime === _ledgerReconciledMtime && ledgerSize === (_savingsCache?._ledgerSize || 0))
      return;
    _ledgerReconciledMtime = ledgerMtime;
    _flushLedgerBuffer();
    const l = readLedgerTotals();
    if (l.total <= 0 && l.context7 <= 0)
      return;
    const delegationStateFile = join2(getVibeOSHome2(), "delegation-state.json");
    const state = readJsonOrEmpty(delegationStateFile);
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
    _savingsCache = null;
    _savingsCacheMtime = 0;
    invalidateSavingsCache();
  } catch {
  }
}
function readLifetimeSavings() {
  const empty = { ltTasks: 0, ltCache: 0, ltCost: 0, count: 0, scratchpadHits: 0, missedC7: 0, sesTasks: 0, sesEdit: 0, sesCredit: 0, sesC7: 0, sesQuota: 0, sesTaskDelegations: 0, sesDuration: 0, sesRatePerHour: 0, sesTrend: "stable", sesToolBreakdown: {}, sesModelTurns: { brain: 0, worker: 0 }, quality_avg: 0, telemetry: readTelemetrySummary({}, _OC_SID) };
  try {
    reconcileStateFromLedger();
    const delegationStateFile = join2(getVibeOSHome2(), "delegation-state.json");
    if (!existsSync2(delegationStateFile))
      return empty;
    const mtime = statSync2(delegationStateFile).mtimeMs;
    if (_savingsCache && mtime === _savingsCacheMtime)
      return _savingsCache;
    const s = safeJsonParse2(readFileSync2(delegationStateFile, "utf-8"));
    const ledgerSize = existsSync2(SAVINGS_LEDGER_FILE) ? statSync2(SAVINGS_LEDGER_FILE).size : 0;
    _savingsCache = { ..._computeSessionMetrics(s, _OC_SID), telemetry: readTelemetrySummary(s, _OC_SID), _ledgerSize: ledgerSize };
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
    const cpPath = join2(getSessionRoot(), "checkpoint.json");
    mkdirSync(dirname(cpPath), { recursive: true });
    const tmp = cpPath + ".tmp";
    writeFileSync2(tmp, JSON.stringify(cp, null, 2) + "\n");
    renameSync2(tmp, cpPath);
  } catch {
  }
}
var USER_HOME2, VIBEOS_CONTEXT, VIBEOS_HOME, OPENCODE_HOME, FILE_LOCK_DIR, DELEGATION_STATE_FILE, SAVINGS_LEDGER_FILE, GLOBAL_LEARNING_FILE, PRICING_CACHE_FILE, BLACKBOX_STATE_FILE, PROJECT_STATE_FILE, TIERS_FILE, ACTIVE_JOBS_FILE, AUTH_F, CREDIT_CACHE_F, FLOW_TODO_QUEUE_FILE, FLOW_DEDUP_FILE, ENFORCEMENT_COOLDOWN_FILE, TODOS_FILE, REPORTS_DIR, CONTEXT7_INSTALL_FLAG, TRINITY_OPENCODE_CONFIG, TRINITY_OPENCODE_CONFIGC, SCRATCHPAD_ROOT, SCRATCHPAD_GLOBAL_DIR, SCRATCHPAD_SESSIONS_DIR, SCRATCHPAD_SESSION_TTL_MS, SCRATCHPAD_MAX_AGE_SEC, MAX_SCRATCHPAD_FILES, MAX_SCRATCHPAD_BYTES, MAX_SESSION_SCRATCHPAD_FILES, MAX_SESSION_SCRATCHPAD_BYTES, CORRUPTION_BACKUP_MAX, CORRUPTION_BACKUP_TTL_MS, LEDGER_ROTATE_MAX_BYTES, LEDGER_ROTATE_MAX_LINES, LEDGER_ROTATE_MAX_AGE_MS, ACTIVE_JOBS_STALE_MS, MAX_PTR_CANDIDATES, SUMMARY_HEAD_TRUNCATE, DECADENCE_FRESH_MS, DECADENCE_WARM_MS, DECADENCE_COLD_MS, DECADENCE_EXPIRE_MS, DECADENCE_THROTTLE_MS, DECADENCE_GLOBAL_THROTTLE_MS, TOOL_NAME_NORMALIZE, SCRATCHPAD_TOOLS, WARN_DEDUPE_WINDOW_MS, SOFT_QUOTA_LIMIT, _OC_SID, currentSessionId, _sessionStart, currentTier, currentModel, currentProjectFingerprint, currentProjectName, recentToolEvents, frictionSessionKeys, routineSessionKeys, lastMutationEvent, _savingsCache, _savingsCacheMtime, _ledgerReconciledMtime, _ledgerTotalsCache, _mlGraph, _cacheDb, ML_ENABLED, ML_CONFIDENCE_THRESHOLD, _mlSavePending, _blackboxEnabled, _latestBlackboxState, _latestBlackboxLoopMsg, _latestBlackboxPivotMsg, _modelLocked, _lockedSlot, _lockedModel, _patternFiredKeys, _sessionCleanupRegistered, _sessionCacheCleaned, prunedThisProcess, _lastDecadenceRun, briefedProjects, _ledgerBuffer, _ledgerBufferTimer, LEDGER_BUFFER_MAX, LEDGER_BUFFER_FLUSH_MS, testReminderSeen, DFLT_GL, tool, _startupMaintenanceHome, FALLBACK_HIGH, FALLBACK_MID, HIGH_TIER_RE, MID_TIER_RE, scratchpadHitsSeen;
var init_state = __esm({
  "src/lib/state.js"() {
    "use strict";
    init_selection_manager();
    init_pattern_helpers();
    init_runtime_state();
    init_ml_router();
    init_smart_cache();
    USER_HOME2 = (() => {
      try {
        return homedir2();
      } catch {
        return tmpdir2();
      }
    })();
    VIBEOS_CONTEXT = new AsyncLocalStorage();
    VIBEOS_HOME = process.env.VIBEOS_HOME || join2(process.env.HOME || USER_HOME2, ".claude");
    OPENCODE_HOME = resolveOpenCodeHome();
    FILE_LOCK_DIR = join2(VIBEOS_HOME, ".vibeOS-locks");
    DELEGATION_STATE_FILE = join2(VIBEOS_HOME, "delegation-state.json");
    SAVINGS_LEDGER_FILE = join2(VIBEOS_HOME, "savings-ledger.jsonl");
    GLOBAL_LEARNING_FILE = join2(VIBEOS_HOME, "global-learning.json");
    PRICING_CACHE_FILE = join2(VIBEOS_HOME, "model-pricing-cache.json");
    BLACKBOX_STATE_FILE = join2(VIBEOS_HOME, "blackbox-state.json");
    PROJECT_STATE_FILE = join2(VIBEOS_HOME, "project-states.json");
    TIERS_FILE = join2(VIBEOS_HOME, "model-tiers.json");
    ACTIVE_JOBS_FILE = join2(VIBEOS_HOME, "active-jobs.json");
    AUTH_F = join2(USER_HOME2, ".local", "share", "opencode", "auth.json");
    CREDIT_CACHE_F = join2(VIBEOS_HOME, "credit-snapshot.json");
    FLOW_TODO_QUEUE_FILE = join2(VIBEOS_HOME, ".flow-todo-queue.jsonl");
    FLOW_DEDUP_FILE = join2(VIBEOS_HOME, ".flow-dedup-keys.json");
    ENFORCEMENT_COOLDOWN_FILE = join2(VIBEOS_HOME, ".enforcement-cooldown.jsonl");
    TODOS_FILE = join2(VIBEOS_HOME, "todos.json");
    REPORTS_DIR = join2(VIBEOS_HOME, "reports");
    CONTEXT7_INSTALL_FLAG = join2(VIBEOS_HOME, ".context7-install-suggested");
    TRINITY_OPENCODE_CONFIG = join2(OPENCODE_HOME, "opencode.json");
    TRINITY_OPENCODE_CONFIGC = join2(OPENCODE_HOME, "opencode.jsonc");
    SCRATCHPAD_ROOT = join2(VIBEOS_HOME, "scratch");
    SCRATCHPAD_GLOBAL_DIR = join2(SCRATCHPAD_ROOT, "by-hash");
    SCRATCHPAD_SESSIONS_DIR = join2(SCRATCHPAD_ROOT, "sessions");
    SCRATCHPAD_SESSION_TTL_MS = 48 * 60 * 60 * 1e3;
    SCRATCHPAD_MAX_AGE_SEC = Number(process.env.CLAUDE_SCRATCHPAD_MAX_AGE_SEC || 86400);
    MAX_SCRATCHPAD_FILES = 1e3;
    MAX_SCRATCHPAD_BYTES = 10 * 1024 * 1024;
    MAX_SESSION_SCRATCHPAD_FILES = 200;
    MAX_SESSION_SCRATCHPAD_BYTES = 2 * 1024 * 1024;
    CORRUPTION_BACKUP_MAX = 5;
    CORRUPTION_BACKUP_TTL_MS = 24 * 60 * 60 * 1e3;
    LEDGER_ROTATE_MAX_BYTES = 256 * 1024;
    LEDGER_ROTATE_MAX_LINES = 1e4;
    LEDGER_ROTATE_MAX_AGE_MS = 48 * 60 * 60 * 1e3;
    ACTIVE_JOBS_STALE_MS = 72 * 60 * 60 * 1e3;
    MAX_PTR_CANDIDATES = 50;
    SUMMARY_HEAD_TRUNCATE = 500;
    DECADENCE_FRESH_MS = 5 * 60 * 1e3;
    DECADENCE_WARM_MS = 60 * 60 * 1e3;
    DECADENCE_COLD_MS = 24 * 60 * 60 * 1e3;
    DECADENCE_EXPIRE_MS = 48 * 60 * 60 * 1e3;
    DECADENCE_THROTTLE_MS = 60 * 1e3;
    DECADENCE_GLOBAL_THROTTLE_MS = 5 * 60 * 1e3;
    TOOL_NAME_NORMALIZE = {
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
    SCRATCHPAD_TOOLS = new Set(Object.keys(TOOL_NAME_NORMALIZE));
    WARN_DEDUPE_WINDOW_MS = 120 * 1e3;
    SOFT_QUOTA_LIMIT = 5;
    _OC_SID = getOcSessionId();
    currentSessionId = _OC_SID;
    _sessionStart = Date.now();
    currentTier = null;
    currentModel = null;
    currentProjectFingerprint = "";
    currentProjectName = "";
    recentToolEvents = [];
    frictionSessionKeys = /* @__PURE__ */ new Set();
    routineSessionKeys = /* @__PURE__ */ new Set();
    lastMutationEvent = null;
    _savingsCache = null;
    _savingsCacheMtime = 0;
    _ledgerReconciledMtime = 0;
    _ledgerTotalsCache = {
      mtime: 0,
      size: 0,
      delegation: 0,
      cache: 0,
      context7: 0,
      entries: 0
    };
    _mlGraph = createPatternGraph();
    _cacheDb = createCacheDatabase();
    ML_ENABLED = true;
    ML_CONFIDENCE_THRESHOLD = 0.6;
    _mlSavePending = false;
    _blackboxEnabled = true;
    _latestBlackboxState = null;
    _latestBlackboxLoopMsg = null;
    _latestBlackboxPivotMsg = null;
    _modelLocked = false;
    _lockedSlot = null;
    _lockedModel = null;
    _patternFiredKeys = /* @__PURE__ */ new Set();
    _sessionCleanupRegistered = false;
    _sessionCacheCleaned = false;
    prunedThisProcess = false;
    _lastDecadenceRun = 0;
    briefedProjects = /* @__PURE__ */ new Set();
    _ledgerBuffer = [];
    _ledgerBufferTimer = null;
    LEDGER_BUFFER_MAX = 10;
    LEDGER_BUFFER_FLUSH_MS = 5e3;
    testReminderSeen = /* @__PURE__ */ new Set();
    DFLT_GL = {
      exploratory_words: {},
      task_first_words: {},
      context7_bypasses: 0,
      context7_missed_usd: 0,
      context7_last_seen: null,
      updatedAt: null
    };
    tool = Object.assign((def) => def, {
      schema: {
        string: (o) => _zType({ kind: "string", ...o || {} }),
        number: (o) => _zType({ kind: "number", ...o || {} }),
        enum: (values) => _zType({ kind: "enum", values })
      }
    });
    _startupMaintenanceHome = "";
    FALLBACK_HIGH = /opus|gemini-.*-pro|gpt-5|(^|\/)o[134]($|-|\/)|claude.*opus|reasoner|r1/i;
    FALLBACK_MID = /sonnet|gemini-.*-flash|gpt-4o(?!-mini)|haiku|flash|4o/i;
    ({ high: HIGH_TIER_RE, mid: MID_TIER_RE } = loadTierRegexes());
    loadMLState();
    scratchpadHitsSeen = /* @__PURE__ */ new Set();
    try {
      loadActiveJobs();
    } catch {
    }
  }
});

// src/vibeOS-lib/flow-enforcer.js
var flow_enforcer_exports = {};
__export(flow_enforcer_exports, {
  addFlowRule: () => addFlowRule,
  checkFlowRules: () => checkFlowRules,
  ensureProjectDocs: () => ensureProjectDocs,
  getFlowTodos: () => getFlowTodos,
  getFlowWarns: () => getFlowWarns,
  getRealityCheckView: () => getRealityCheckView,
  getSessionFlowCounts: () => getSessionFlowCounts,
  recordFlowTodo: () => recordFlowTodo,
  resetAll: () => resetAll,
  resetForTest: () => resetForTest,
  resolveRulesPath: () => resolveRulesPath,
  setFlowStateWriter: () => setFlowStateWriter,
  syncFlowTodosToNative: () => syncFlowTodosToNative
});
import { readFileSync as readFileSync3, existsSync as existsSync3, mkdirSync as mkdirSync2, writeFileSync as writeFileSync3, statSync as statSync3, appendFileSync as appendFileSync2, renameSync as renameSync3 } from "node:fs";
import { join as join3, dirname as dirname2 } from "node:path";
import { fileURLToPath } from "node:url";
function getVibeOSHome3() {
  return process.env.VIBEOS_HOME || join3(process.env.HOME || "", ".claude");
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
function getRealityCheckSettingsFile() {
  return join3(getVibeOSHome3(), "reality-check-settings.json");
}
function resolveRulesPath() {
  if (process.env.VIBEOS_FLOW_RULES_PATH && existsSync3(process.env.VIBEOS_FLOW_RULES_PATH)) {
    return process.env.VIBEOS_FLOW_RULES_PATH;
  }
  for (const candidate of RULES_PATH_CANDIDATES) {
    if (existsSync3(candidate))
      return candidate;
  }
  const override = process.env.VIBEOS_FLOW_RULES_PATH;
  if (override)
    return override;
  return RULES_PATH_CANDIDATES[0];
}
function ensureProjectDocs(dir, techStack) {
  const created = [];
  const skipped = [];
  const agentsPath = join3(dir, "AGENTS.md");
  const readmePath = join3(dir, "README.md");
  try {
    if (!existsSync3(agentsPath)) {
      try {
        writeFileSync3(agentsPath, GUARD_AGENTS_TEMPLATE, "utf-8");
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
    if (!existsSync3(readmePath)) {
      const name = dir ? dir.split("/").pop() || "Project" : "Project";
      const stack = techStack || [];
      const content = GUARD_README_TEMPLATE(name, stack);
      try {
        writeFileSync3(readmePath, content, "utf-8");
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
  return join3(getVibeOSHome3(), "delegation-state.json");
}
function getFlowTodoFile() {
  return join3(getVibeOSHome3(), ".flow-todo-queue.jsonl");
}
function setFlowStateWriter(writer) {
  _stateWriter = typeof writer === "function" ? writer : null;
}
function loadFlowDedupKeys() {
  try {
    if (existsSync3(FLOW_DEDUP_FILE2)) {
      const raw = readFileSync3(FLOW_DEDUP_FILE2, "utf-8");
      const keys = safeJsonParse3(raw);
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
    mkdirSync2(dirname2(FLOW_DEDUP_FILE2), { recursive: true });
    let keys = [];
    if (existsSync3(FLOW_DEDUP_FILE2)) {
      try {
        keys = safeJsonParse3(readFileSync3(FLOW_DEDUP_FILE2, "utf-8"));
      } catch {
      }
      if (!Array.isArray(keys))
        keys = [];
    }
    if (!keys.includes(key)) {
      keys.push(key);
      if (keys.length > 1e3)
        keys = keys.slice(-500);
      writeFileSync3(FLOW_DEDUP_FILE2, JSON.stringify(keys), "utf-8");
    }
  } catch {
  }
}
function normalizeRule(rule) {
  if (!rule || typeof rule !== "object")
    return null;
  const id2 = String(rule.id || "").trim();
  const trigger = String(rule.trigger || "").trim();
  const pattern = String(rule.pattern || "").trim();
  const severity = String(rule.severity || "").trim();
  if (!id2 || !trigger || !pattern || !["warn", "hint", "flag"].includes(severity))
    return null;
  return {
    id: id2,
    trigger,
    pattern,
    severity,
    description: typeof rule.description === "string" ? rule.description : void 0
  };
}
function defaultRealityCheckRules() {
  return [
    {
      id: "require-read-before-claim",
      severity: "warn",
      trigger: "Edit",
      pattern: "(?i)\\b(done|complete|success|trained|ready|works|fixed)\\b",
      description: "Success claim detected \u2014 verify live state before asserting completion"
    },
    {
      id: "verify-state-on-disk",
      severity: "flag",
      trigger: "Edit",
      pattern: "(?i)\\b(assume|guess|probably|likely|maybe|seems|appears)\\b",
      description: "Inference language detected \u2014 verify actual files/state first"
    },
    {
      id: "postmortem-trigger",
      severity: "warn",
      trigger: "Edit",
      pattern: "(?i)\\breality check\\b",
      description: "Reality check requested \u2014 read and verify live state before reporting"
    }
  ];
}
function readRealityCheckSettings() {
  const settingsFile = getRealityCheckSettingsFile();
  const settingsMtime = existsSync3(settingsFile) ? statSync3(settingsFile).mtimeMs : 0;
  if (_cachedRealityCheck && settingsMtime === _realityCheckMtime) {
    return _cachedRealityCheck;
  }
  let parsed = {};
  try {
    if (existsSync3(settingsFile)) {
      const raw = readFileSync3(settingsFile, "utf-8");
      const json2 = safeJsonParse3(raw);
      if (json2 && typeof json2 === "object")
        parsed = json2;
    }
  } catch {
  }
  const globalRules = Array.isArray(parsed.global?.rules) ? parsed.global.rules : defaultRealityCheckRules();
  _cachedRealityCheck = {
    version: 1,
    global: {
      enabled: parsed.global?.enabled !== false,
      rules: globalRules.map(normalizeRule).filter(Boolean)
    },
    projects: parsed.projects && typeof parsed.projects === "object" ? parsed.projects : {}
  };
  _realityCheckMtime = settingsMtime;
  return _cachedRealityCheck;
}
function getRealityCheckRulesForProject(projectFingerprint2 = currentProjectFingerprint || "") {
  const settings = readRealityCheckSettings();
  const fp2 = String(projectFingerprint2 || "").trim();
  const project = fp2 && settings.projects?.[fp2] ? settings.projects[fp2] : null;
  const scope = project ? "project" : "global";
  const enabled = scope === "project" ? project?.enabled ?? settings.global?.enabled !== false : settings.global?.enabled !== false;
  const source = scope === "project" ? Array.isArray(project?.rules) && project?.rules.length > 0 ? project.rules : settings.global?.rules || defaultRealityCheckRules() : settings.global?.rules || defaultRealityCheckRules();
  if (!enabled)
    return [];
  const seen = /* @__PURE__ */ new Map();
  for (const rule of source) {
    const normalized = normalizeRule(rule);
    if (!normalized || !REALITY_CHECK_RULE_IDS.has(normalized.id))
      continue;
    seen.set(normalized.id, normalized);
  }
  if (seen.size === 0) {
    for (const rule of defaultRealityCheckRules()) {
      const normalized = normalizeRule(rule);
      if (normalized && REALITY_CHECK_RULE_IDS.has(normalized.id))
        seen.set(normalized.id, normalized);
    }
  }
  return Array.from(seen.values());
}
function getRealityCheckView(projectFingerprint2 = currentProjectFingerprint || "") {
  const settings = readRealityCheckSettings();
  const fp2 = String(projectFingerprint2 || "").trim();
  const project = fp2 && settings.projects?.[fp2] ? settings.projects[fp2] : null;
  const scope = project ? "project" : "global";
  const enabled = scope === "project" ? project?.enabled ?? settings.global?.enabled !== false : settings.global?.enabled !== false;
  const rules = getRealityCheckRulesForProject(fp2);
  return {
    scope,
    project_id: project ? fp2 : null,
    enabled,
    rules
  };
}
function mergeManagedRules(baseRules, managedRules) {
  const base = baseRules.filter((rule) => !REALITY_CHECK_RULE_IDS.has(rule.id));
  const seen = new Set(base.map((rule) => rule.id));
  const merged = [...base];
  for (const rule of managedRules) {
    if (!rule || seen.has(rule.id))
      continue;
    merged.push(rule);
    seen.add(rule.id);
  }
  return merged;
}
function compileFlowPattern(pattern) {
  const source = String(pattern || "").trim();
  if (!source)
    return new RegExp("$^");
  if (source.startsWith("(?i)")) {
    return new RegExp(source.slice(4), "i");
  }
  return new RegExp(source);
}
function loadRules() {
  const rulesPath = resolveRulesPath();
  try {
    const rulesMtime = existsSync3(rulesPath) ? statSync3(rulesPath).mtimeMs : 0;
    const realityFile = getRealityCheckSettingsFile();
    const realityMtime = existsSync3(realityFile) ? statSync3(realityFile).mtimeMs : 0;
    const scopeKey = String(currentProjectFingerprint || "");
    const cacheKey = `${rulesMtime}:${realityMtime}:${scopeKey}`;
    if (_cachedRules && _realityCheckCacheKey === "__test__")
      return _cachedRules;
    if (_cachedRules && cacheKey === _realityCheckCacheKey)
      return _cachedRules;
    if (!existsSync3(rulesPath)) {
      _cachedRules = mergeManagedRules([], getRealityCheckRulesForProject(scopeKey));
      _realityCheckCacheKey = cacheKey;
      return _cachedRules;
    }
    const j = safeJsonParse3(readFileSync3(rulesPath, "utf-8"));
    const baseRules = Array.isArray(j.rules) ? j.rules.map(normalizeRule).filter(Boolean) : [];
    _cachedRules = mergeManagedRules(baseRules, getRealityCheckRulesForProject(scopeKey));
    _rulesMtime = rulesMtime;
    _realityCheckCacheKey = cacheKey;
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
    if (existsSync3(stateFile)) {
      try {
        state = safeJsonParse3(readFileSync3(stateFile, "utf-8"));
      } catch {
      }
    } else {
      mkdirSync2(dirname2(stateFile), { recursive: true });
    }
    state.flow_warns ??= [];
    const dedupKey = `${hit.id}|${hit.filePath}`;
    const anyExisting = state.flow_warns.some((w) => {
      const wKey = `${w.rule_id}|${w.filePath}`;
      return wKey === dedupKey;
    });
    if (!anyExisting) {
      state.flow_warns.push({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        sid: process.pid || "?",
        rule_id: hit.id,
        severity: hit.severity,
        filePath: hit.filePath,
        description: hit.description
      });
    }
    if (state.flow_warns.length > 200) {
      state.flow_warns = state.flow_warns.slice(-200);
    }
    const fp2 = { flow_warns: state.flow_warns };
    if (_stateWriter)
      _stateWriter(fp2);
    else {
      const stateFile2 = getStateFile();
      const existing = safeJsonParse3(existsSync3(stateFile2) ? readFileSync3(stateFile2, "utf-8") : "{}");
      const merged = Object.assign({}, existing, fp2);
      const tmpFile = stateFile2 + ".tmp." + Date.now();
      writeFileSync3(tmpFile, JSON.stringify(merged, null, 2));
      renameSync3(tmpFile, stateFile2);
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
      re = compileFlowPattern(rule.pattern);
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
    if (!existsSync3(stateFile))
      return [];
    const s = safeJsonParse3(readFileSync3(stateFile, "utf-8"));
    return s?.flow_warns || [];
  } catch {
    return [];
  }
}
function getSessionFlowCounts() {
  const counts = { warn: 0, hint: 0, flag: 0 };
  const rules = loadRules();
  for (const key of _flowWarnsSeen) {
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
  _cachedRealityCheck = null;
  _realityCheckMtime = 0;
  _realityCheckCacheKey = "__test__";
  try {
    _rulesMtime = statSync3(resolveRulesPath()).mtimeMs;
  } catch {
  }
}
function resetAll() {
  _flowWarnsSeen.clear();
  _cachedRules = null;
  _rulesMtime = 0;
  _cachedRealityCheck = null;
  _realityCheckMtime = 0;
  _realityCheckCacheKey = "";
}
function addFlowRule(rule) {
  const rules = loadRules();
  rules.push(rule);
  writeFileSync3(resolveRulesPath(), JSON.stringify({ rules }, null, 2), "utf-8");
  _cachedRules = rules;
  _rulesMtime = statSync3(resolveRulesPath()).mtimeMs;
}
function recordFlowTodo({ filePath, content }) {
  try {
    const flowTodoFile = getFlowTodoFile();
    mkdirSync2(dirname2(flowTodoFile), { recursive: true });
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
    const existingLines = existsSync3(flowTodoFile) ? readFileSync3(flowTodoFile, "utf-8").trim().split("\n").filter(Boolean) : [];
    const existingKeys = /* @__PURE__ */ new Set();
    for (const line of existingLines) {
      try {
        const entry2 = safeJsonParse3(line);
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
    appendFileSync2(flowTodoFile, entry);
    try {
      const lines = readFileSync3(flowTodoFile, "utf-8").trim().split("\n").filter(Boolean);
      if (lines.length > MAX_FLOW_TODOS) {
        writeFileSync3(flowTodoFile, lines.slice(-Math.floor(MAX_FLOW_TODOS / 2)).join("\n") + "\n");
      }
    } catch {
    }
    console.error(`[flow-enforcer] \u{1F4CB} Extracted ${todos.length} TODO(s) from ${filePath} \u2192 .flow-todo-queue.jsonl`);
    return todos.length;
  } catch {
    return 0;
  }
}
function getFlowTodos() {
  try {
    const flowTodoFile = getFlowTodoFile();
    if (!existsSync3(flowTodoFile))
      return [];
    const raw = readFileSync3(flowTodoFile, "utf-8").trim();
    if (!raw)
      return [];
    return raw.split("\n").filter(Boolean).map((line) => safeJsonParse3(line)).filter(Boolean);
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
var VIBEOS_STDERR_DEBUG, VIBEOS_CONSOLE_ERROR_GUARD, globalConsoleState, __dirname2, REALITY_CHECK_RULE_IDS, RULES_PATH_CANDIDATES, GUARD_AGENTS_TEMPLATE, GUARD_README_TEMPLATE, FLOW_DEDUP_FILE2, MAX_FLOW_TODOS, _flowWarnsSeen, _stateWriter, _cachedRules, _rulesMtime, _cachedRealityCheck, _realityCheckMtime, _realityCheckCacheKey;
var init_flow_enforcer = __esm({
  "src/vibeOS-lib/flow-enforcer.js"() {
    "use strict";
    init_state();
    VIBEOS_STDERR_DEBUG = process.env.VIBEOS_DEBUG_STDERR === "1" || process.env.VIBEOS_DEBUG_LOGS === "1";
    VIBEOS_CONSOLE_ERROR_GUARD = "__vibeOSConsoleErrorGuard";
    globalConsoleState = globalThis;
    if (!VIBEOS_STDERR_DEBUG && !globalConsoleState[VIBEOS_CONSOLE_ERROR_GUARD]) {
      const originalConsoleError = console.error.bind(console);
      console.error = (...args) => {
        let text = "";
        for (const arg of args) {
          if (typeof arg === "string") {
            text += arg;
          } else if (arg instanceof Error) {
            text += `${arg.name}: ${arg.message}`;
          } else if (arg && typeof arg === "object") {
            try {
              text += JSON.stringify(arg);
            } catch {
              text += String(arg);
            }
          } else {
            text += String(arg);
          }
          text += " ";
        }
        if (text.includes("[vibeOS]") || text.includes("[flow-enforcer]") || text.includes("[delegation]"))
          return;
        originalConsoleError(...args);
      };
      globalConsoleState[VIBEOS_CONSOLE_ERROR_GUARD] = true;
    }
    __dirname2 = dirname2(fileURLToPath(import.meta.url));
    REALITY_CHECK_RULE_IDS = /* @__PURE__ */ new Set([
      "require-read-before-claim",
      "verify-state-on-disk",
      "postmortem-trigger"
    ]);
    RULES_PATH_CANDIDATES = [
      join3(process.cwd(), "src", "vibeOS-lib", "flow-rules.json"),
      join3(process.cwd(), "dist-ts", "vibeOS-lib", "flow-rules.json"),
      join3(process.cwd(), "dist", "assets", "flow-rules.json"),
      join3(__dirname2, "flow-rules.json")
    ];
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
    FLOW_DEDUP_FILE2 = join3(getVibeOSHome3(), ".flow-dedup-keys.json");
    MAX_FLOW_TODOS = 200;
    _flowWarnsSeen = /* @__PURE__ */ new Set();
    _stateWriter = null;
    _cachedRules = null;
    _rulesMtime = 0;
    _cachedRealityCheck = null;
    _realityCheckMtime = 0;
    _realityCheckCacheKey = "";
    loadFlowDedupKeys();
  }
});

// src/vibeOS-lib/blackbox/meta-controller.js
function autoSelectMode(subRegime, stressMultiplier) {
  const regime = String(subRegime || "INIT").toUpperCase();
  if (regime === "AUDIT" || regime === "FORENSIC")
    return regime.toLowerCase();
  if (regime === "LOOPING")
    return "quality";
  if (regime === "CONVERGING" || regime === "CLOSED")
    return "quality";
  if (regime === "IMPLEMENTING")
    return "quality";
  if (regime === "RESEARCH" || regime === "DESIGNING")
    return "longrun";
  if (regime === "REVIEWING")
    return "audit";
  if (stressMultiplier && stressMultiplier > QUALITY_STRESS_THRESHOLD)
    return "quality";
  return "litex";
}
var REGIME_CONTROL, DEFAULT_CONTROL, QUALITY_STRESS_THRESHOLD;
var init_meta_controller = __esm({
  "src/vibeOS-lib/blackbox/meta-controller.js"() {
    "use strict";
    REGIME_CONTROL = {
      INIT: {
        enforcement_mode: "normal",
        enforcement_reason: "fresh session \u2014 baseline enforcement",
        flow_mode: "normal",
        flow_focus: [],
        tdd_mode: "normal",
        tdd_focus: [],
        tier_bias: "auto",
        thinking_mode: "auto",
        stress_multiplier: 1,
        context7_urgency: "preferred",
        wbp_verbosity: "normal"
      },
      DIVERGENT: {
        enforcement_mode: "relaxed",
        enforcement_reason: "signals scattered \u2014 avoid interrupting exploration",
        flow_mode: "audit",
        flow_focus: ["no-write-without-clarification"],
        tdd_mode: "lazy",
        tdd_focus: [],
        tier_bias: "medium",
        thinking_mode: "off",
        stress_multiplier: 0.5,
        context7_urgency: "optional",
        wbp_verbosity: "detailed"
      },
      EXPLORING: {
        enforcement_mode: "relaxed",
        enforcement_reason: "user researching \u2014 minimal enforcement, save brain for real work",
        flow_mode: "audit",
        flow_focus: [],
        tdd_mode: "lazy",
        tdd_focus: [],
        tier_bias: "cheap",
        thinking_mode: "off",
        stress_multiplier: 0.7,
        context7_urgency: "optional",
        wbp_verbosity: "detailed"
      },
      REFINING: {
        enforcement_mode: "normal",
        enforcement_reason: "user narrowing down \u2014 balanced mode",
        flow_mode: "normal",
        flow_focus: [],
        tdd_mode: "normal",
        tdd_focus: [],
        tier_bias: "auto",
        thinking_mode: "auto",
        stress_multiplier: 1,
        context7_urgency: "preferred",
        wbp_verbosity: "normal"
      },
      IMPLEMENTING: {
        enforcement_mode: "strict",
        enforcement_reason: "implementation work \u2014 validate code changes and keep tests on",
        flow_mode: "strict",
        flow_focus: ["write-edit-check", "no-untouched-files"],
        tdd_mode: "strict",
        tdd_focus: ["skeleton-on-write", "assertion-check"],
        tier_bias: "brain",
        thinking_mode: "brief",
        stress_multiplier: 1.3,
        context7_urgency: "required",
        wbp_verbosity: "normal"
      },
      RESEARCH: {
        enforcement_mode: "normal",
        enforcement_reason: "research mode \u2014 collect evidence before changing anything",
        flow_mode: "audit",
        flow_focus: ["trace-audit"],
        tdd_mode: "lazy",
        tdd_focus: [],
        tier_bias: "brain",
        thinking_mode: "full",
        stress_multiplier: 1.2,
        context7_urgency: "required",
        wbp_verbosity: "detailed"
      },
      REVIEWING: {
        enforcement_mode: "strict",
        enforcement_reason: "review mode \u2014 validate diffs and surface risks",
        flow_mode: "strict",
        flow_focus: ["write-edit-check", "no-untouched-files", "no-lgtm"],
        tdd_mode: "quality",
        tdd_focus: ["full-coverage", "edge-cases"],
        tier_bias: "brain",
        thinking_mode: "brief",
        stress_multiplier: 1.1,
        context7_urgency: "required",
        wbp_verbosity: "normal"
      },
      DESIGNING: {
        enforcement_mode: "normal",
        enforcement_reason: "design mode \u2014 explore architecture and tradeoffs",
        flow_mode: "audit",
        flow_focus: ["trace-audit"],
        tdd_mode: "normal",
        tdd_focus: [],
        tier_bias: "brain",
        thinking_mode: "full",
        stress_multiplier: 1.1,
        context7_urgency: "required",
        wbp_verbosity: "detailed"
      },
      CONVERGING: {
        enforcement_mode: "strict",
        enforcement_reason: "user about to commit \u2014 full enforcement, catch violations",
        flow_mode: "strict",
        flow_focus: ["write-edit-check", "no-untouched-files"],
        tdd_mode: "strict",
        tdd_focus: ["skeleton-on-write", "assertion-check"],
        tier_bias: "brain",
        thinking_mode: "brief",
        stress_multiplier: 1.5,
        context7_urgency: "required",
        wbp_verbosity: "minimal"
      },
      LOOPING: {
        enforcement_mode: "strict",
        enforcement_reason: "user stuck \u2014 tighten enforcement and switch to recovery posture",
        flow_mode: "strict",
        flow_focus: ["write-edit-check", "no-untouched-files", "suggest-alternative"],
        tdd_mode: "strict",
        tdd_focus: ["skeleton-on-write", "assertion-check"],
        tier_bias: "brain",
        thinking_mode: "brief",
        stress_multiplier: 2,
        context7_urgency: "required",
        wbp_verbosity: "detailed"
      },
      CLOSED: {
        enforcement_mode: "strict",
        enforcement_reason: "finalizing \u2014 full enforcement, max stress sensitivity",
        flow_mode: "strict",
        flow_focus: ["write-edit-check", "no-untouched-files", "no-lgtm"],
        tdd_mode: "quality",
        tdd_focus: ["full-coverage", "edge-cases"],
        tier_bias: "brain",
        thinking_mode: "brief",
        stress_multiplier: 2,
        context7_urgency: "required",
        wbp_verbosity: "minimal"
      },
      FORENSIC: {
        enforcement_mode: "strict",
        enforcement_reason: "forensic analysis \u2014 full enforcement, deep investigation",
        flow_mode: "strict",
        flow_focus: ["write-edit-check", "no-untouched-files", "trace-audit"],
        tdd_mode: "quality",
        tdd_focus: ["full-coverage", "edge-cases", "property-based"],
        tier_bias: "brain",
        thinking_mode: "full",
        stress_multiplier: 1.5,
        context7_urgency: "required",
        wbp_verbosity: "detailed"
      },
      AUDIT: {
        enforcement_mode: "strict",
        enforcement_reason: "security audit \u2014 full enforcement, OWASP validation",
        flow_mode: "strict",
        flow_focus: ["write-edit-check", "no-untouched-files", "security-scan"],
        tdd_mode: "quality",
        tdd_focus: ["full-coverage", "edge-cases", "security-test"],
        tier_bias: "brain",
        thinking_mode: "full",
        stress_multiplier: 1.2,
        context7_urgency: "required",
        wbp_verbosity: "detailed"
      }
    };
    DEFAULT_CONTROL = REGIME_CONTROL.EXPLORING;
    QUALITY_STRESS_THRESHOLD = 1.5;
  }
});

// src/vibeOS-lib/blackbox/pivot-cache.js
import { existsSync as existsSync7, mkdirSync as mkdirSync6, readFileSync as readFileSync6, writeFileSync as writeFileSync7 } from "node:fs";
import { join as join6, dirname as dirname6 } from "node:path";
import { homedir as homedir5 } from "node:os";
var PivotCache;
var init_pivot_cache = __esm({
  "src/vibeOS-lib/blackbox/pivot-cache.js"() {
    "use strict";
    PivotCache = class {
      store;
      baseDir;
      pivotSequence;
      currentWorkflow;
      lastTokens;
      constructor(baseDir) {
        this.baseDir = baseDir || join6(homedir5(), ".claude");
        this.pivotSequence = [];
        this.currentWorkflow = null;
        this.lastTokens = /* @__PURE__ */ new Set();
        this.store = this._load();
      }
      _storePath() {
        return join6(this.baseDir, ".vibeos-pivot-cache.json");
      }
      _load() {
        try {
          const p = this._storePath();
          if (existsSync7(p)) {
            return JSON.parse(readFileSync6(p, "utf-8"));
          }
        } catch {
        }
        return { pivots: {}, version: 3 };
      }
      save() {
        try {
          const p = this._storePath();
          const dir = dirname6(p);
          if (!existsSync7(dir))
            mkdirSync6(dir, { recursive: true });
          writeFileSync7(p, JSON.stringify(this.store, null, 2), "utf-8");
        } catch {
        }
      }
      tokenize(text) {
        const tl = text.toLowerCase();
        const tokens = /* @__PURE__ */ new Set();
        if (/deploy|redeploy|bundle|release|npm/.test(tl))
          tokens.add("deploy");
        if (/(?:\bgit\b|\bcommit\b|\bpush\b|\bmerge\b|\bpr\b|\bpull\b|\brebase\b)/.test(tl))
          tokens.add("git");
        if (/budget|cost|price|pricing/.test(tl))
          tokens.add("pricing");
        if (/debug|fix|bug|error|broken/.test(tl))
          tokens.add("debug");
        if (/context|cache|pivot|compression/.test(tl))
          tokens.add("caching");
        if (/test|experiment|verify|validate/.test(tl))
          tokens.add("test");
        if (/config|token|api|secret|env|auth/.test(tl))
          tokens.add("config");
        if (/create|add|implement|build|write/.test(tl))
          tokens.add("create");
        if (/read|check|see|show|status|list/.test(tl))
          tokens.add("inspect");
        if (/refactor|clean|rename|move|restructure/.test(tl))
          tokens.add("refactor");
        if (tokens.size === 0)
          tokens.add("misc");
        return tokens;
      }
      detectPivot(current, previous, timeGap = 0) {
        const cur = this.tokenize(current);
        const prev = this.tokenize(previous);
        const inter = new Set([...cur].filter((x) => prev.has(x)));
        const union = /* @__PURE__ */ new Set([...cur, ...prev]);
        const sim = union.size === 0 ? 1 : inter.size / union.size;
        const timePenalty = Math.min(0.3, timeGap / 600);
        const adjusted = sim - timePenalty;
        return { isPivot: adjusted < 0.3, similarity: Math.round(adjusted * 1e3) / 1e3 };
      }
      snapshot(workflowId, context) {
        const entry = {
          id: workflowId,
          captured_at: (/* @__PURE__ */ new Date()).toISOString(),
          tokens: context.tokens || [],
          intent: context.intent || "",
          decisions: context.decisions || [],
          files: context.files || [],
          code_snippets: context.code_snippets || [],
          blockers: context.blockers || [],
          access_count: 0,
          useful_sections: ["decisions", "files"],
          skip_sections: [],
          toolOutputs: context.toolOutputs || []
        };
        this.store.pivots[workflowId] = entry;
        if (!this.pivotSequence.includes(workflowId)) {
          this.pivotSequence.push(workflowId);
        }
        this.save();
      }
      detectPivotBack(tokens, confidenceThreshold = 0.5) {
        if (this.pivotSequence.length < 2) {
          return { matchedId: null, confidence: 0, reason: "not_enough_pivots" };
        }
        const candidates = [];
        for (let i = 0; i < this.pivotSequence.length; i++) {
          const pid = this.pivotSequence[i];
          if (pid === this.pivotSequence[this.pivotSequence.length - 1])
            continue;
          const entry = this.store.pivots[pid];
          if (!entry)
            continue;
          const cached = new Set(entry.tokens);
          if (cached.size === 0)
            continue;
          const inter = new Set([...tokens].filter((x) => cached.has(x)));
          const union = /* @__PURE__ */ new Set([...tokens, ...cached]);
          const jaccard = union.size === 0 ? 0 : inter.size / union.size;
          const exactBonus = tokens.size === cached.size && [...tokens].every((t) => cached.has(t)) ? 0.2 : 0;
          const recency = i / Math.max(this.pivotSequence.length, 1);
          const accessBonus = Math.min(0.1, (entry.access_count || 0) * 0.02);
          const confidence = jaccard + exactBonus + recency * 0.1 + accessBonus;
          candidates.push([pid, confidence, jaccard]);
        }
        if (candidates.length === 0) {
          return { matchedId: null, confidence: 0, reason: "no_candidates" };
        }
        candidates.sort((a, b) => b[1] - a[1]);
        const [bestId, bestConf] = candidates[0];
        if (bestConf < confidenceThreshold) {
          return { matchedId: null, confidence: bestConf, reason: "low_confidence" };
        }
        if (this.store.pivots[bestId]) {
          this.store.pivots[bestId].access_count = (this.store.pivots[bestId].access_count || 0) + 1;
        }
        this.save();
        return { matchedId: bestId, confidence: bestConf, reason: "matched" };
      }
      buildInjection(workflowId, maxSections = 3) {
        const entry = this.store.pivots[workflowId];
        if (!entry)
          return "";
        const parts = [];
        const skip = new Set(entry.skip_sections);
        const intent = entry.intent || entry.tokens.join(", ") || "";
        if (intent) {
          parts.push(`[PIVOT BACK] Returning to workflow: "${intent}". Context from previous session follows.`);
        }
        if (!skip.has("files") && entry.files.length > 0) {
          parts.push(`[files modified] ${entry.files.slice(0, 6).join(", ")}`);
        }
        if (!skip.has("decisions") && entry.decisions.length > 0) {
          const filtered = entry.decisions.filter((d) => d !== "previous workflow captured at pivot point");
          if (filtered.length > 0) {
            parts.push(`[decisions] ${filtered.slice(0, 3).join(" | ")}`);
          }
        }
        if (!skip.has("blockers") && entry.blockers.length > 0) {
          parts.push(`[blockers] ${entry.blockers.slice(0, 2).join(" | ")}`);
        }
        if (entry.code_snippets.length > 0 && entry.useful_sections.includes("code") && !skip.has("code")) {
          parts.push(`[code context] ${entry.code_snippets.slice(0, 2).join(" | ")}`);
        }
        if (parts.length <= 1 && entry.tokens.length > 0) {
          return `[PIVOT BACK] Returning to workflow tagged: ${entry.tokens.join(", ")}. Intent: ${intent}`;
        }
        return parts.join("\n");
      }
      learn(workflowId, usedSections, unusedSections) {
        const entry = this.store.pivots[workflowId];
        if (!entry)
          return;
        for (const s of usedSections) {
          if (!entry.useful_sections.includes(s))
            entry.useful_sections.push(s);
        }
        for (const s of unusedSections) {
          if (!entry.skip_sections.includes(s) && (entry.access_count || 0) > 3) {
            entry.skip_sections.push(s);
          }
        }
        this.save();
      }
      resetSequence() {
        this.pivotSequence = [];
        this.currentWorkflow = null;
        this.lastTokens = /* @__PURE__ */ new Set();
      }
      getRecentPivots(n = 5) {
        return this.pivotSequence.slice(-n);
      }
    };
  }
});

// src/vibeOS-lib/blackbox/vibemax.js
var vibemax_exports = {};
__export(vibemax_exports, {
  getPivotCache: () => getPivotCache,
  getVibeMaXModelMeta: () => getVibeMaXModelMeta,
  loadVibeMaXModel: () => loadVibeMaXModel,
  predictVibeMaX: () => predictVibeMaX,
  resetVibeMaXPipeline: () => resetVibeMaXPipeline,
  saveVibeMaXModel: () => saveVibeMaXModel,
  trainVibeMaXModelFromTelemetry: () => trainVibeMaXModelFromTelemetry,
  vibemaxPipeline: () => vibemaxPipeline,
  vibemaxSelectMode: () => vibemaxSelectMode
});
import { existsSync as existsSync8, mkdirSync as mkdirSync7, readFileSync as readFileSync7, writeFileSync as writeFileSync8 } from "node:fs";
import { resolve as resolve2, dirname as dirname7 } from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
function fallback(sr, text) {
  if (sr === "LOOPING")
    return "quality";
  const t = String(text || "").toLowerCase();
  if (sr === "INIT" && t.length <= 42 && !/[\.\/\\]/.test(t))
    return "budget";
  return "quality";
}
function rng(seed) {
  let s = seed | 0;
  return () => {
    s |= 0;
    s = s + 1831565813 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function gini(samples, label) {
  return 1 - samples.filter((s) => s.label === label).length ** 2 / samples.length ** 2;
}
function buildTree(samples, classes, depth, maxDepth, minLeaf, rngFn) {
  if (samples.length <= minLeaf || depth >= maxDepth || new Set(samples.map((s) => s.label)).size === 1) {
    const counts = Object.fromEntries(classes.map((c) => [c, 0]));
    for (const s of samples)
      counts[s.label]++;
    const total = samples.length || 1;
    return { prediction: classes.reduce((a, b) => counts[a] > counts[b] ? a : b), probs: classes.map((c) => counts[c] / total) };
  }
  const nFeats = samples[0]?.features?.length || 1;
  const featSample = Math.max(2, Math.min(nFeats, Math.floor(Math.sqrt(nFeats)) + 1));
  const cols = /* @__PURE__ */ new Set();
  while (cols.size < featSample)
    cols.add(Math.floor(rngFn() * nFeats));
  let bestG = 0, bestC = -1, bestV = 0;
  for (const c of cols) {
    const vals = [...new Set(samples.map((s) => s.features[c]))].sort((a, b) => a - b);
    for (const v of vals) {
      const l = samples.filter((s) => s.features[c] <= v);
      const r = samples.filter((s) => s.features[c] > v);
      if (l.length < minLeaf || r.length < minLeaf)
        continue;
      const gParent = classes.reduce((sum, cl) => sum + gini(samples, cl), 0);
      const gChild = l.length / samples.length * classes.reduce((sum, cl) => sum + gini(l, cl), 0) + r.length / samples.length * classes.reduce((sum, cl) => sum + gini(r, cl), 0);
      const gain = gParent - gChild;
      if (gain > bestG) {
        bestG = gain;
        bestC = c;
        bestV = v;
      }
    }
  }
  if (bestC === -1 || bestG <= 0) {
    const counts = Object.fromEntries(classes.map((c) => [c, 0]));
    for (const s of samples)
      counts[s.label]++;
    const total = samples.length || 1;
    return { prediction: classes.reduce((a, b) => counts[a] > counts[b] ? a : b), probs: classes.map((c) => counts[c] / total) };
  }
  return { column: bestC, value: bestV, left: buildTree(samples.filter((s) => s.features[bestC] <= bestV), classes, depth + 1, maxDepth, minLeaf, rngFn), right: buildTree(samples.filter((s) => s.features[bestC] > bestV), classes, depth + 1, maxDepth, minLeaf, rngFn) };
}
function predictTree(tree, features) {
  if (tree.prediction)
    return tree;
  return features[tree.column] <= tree.value ? predictTree(tree.left, features) : predictTree(tree.right, features);
}
function getPivotCache() {
  if (!pivotCache)
    pivotCache = new PivotCache();
  return pivotCache;
}
function resetVibeMaXPipeline() {
  prevMessage = "";
  if (pivotCache)
    pivotCache.resetSequence();
}
function vibemaxSelectMode(input = {}) {
  const stress = Number(input.stress_multiplier || input.stress || 0);
  const pm = autoSelectMode(input.sub_regime, stress) || fallback(input.sub_regime, input.user_text || input.prompt || "");
  const vm = VIBEMAX_MAP[pm] || "optimized";
  if (vm === "budget") {
    return { mode: "budget", source: "vibemax", source_prediction: pm, confidence: 0, auto_result: null, ...BUDGET_CFG, cost: 0.1 };
  }
  const cfg = loadVibeMaXModel()?.config || { think: "full", wbp: "normal", kp: [3, 6] };
  const text = input.user_text || input.prompt || "";
  const pc = getPivotCache();
  const tokens = pc.tokenize(text);
  const pivotBack = text && tokens.size > 0 ? pc.detectPivotBack(tokens, 0.5) : { matchedId: null, confidence: 0, reason: "no_text" };
  const isPivotBack = pivotBack.matchedId !== null;
  const think = isPivotBack ? "brief" : cfg.think || "full";
  const injection = isPivotBack ? pc.buildInjection(pivotBack.matchedId) : "";
  return {
    mode: "vibemax",
    source: "vibemax",
    source_prediction: pm,
    confidence: 0,
    auto_result: null,
    tier: "medium",
    thinking: think,
    tdd: "quality",
    flow: "strict",
    enforcement: "strict",
    wbp: cfg.wbp || "normal",
    c7: "required",
    kp: cfg.kp || [3, 6],
    tc: 0.3,
    amode: "plan",
    cost: 0.3,
    pivot: isPivotBack ? {
      matchedId: pivotBack.matchedId,
      confidence: pivotBack.confidence,
      injection,
      intent: pivotBack.intent,
      toolOutputs: pc.read(pivotBack.matchedId)?.toolOutputs || []
    } : null
  };
}
function vibemaxPipeline(input = {}) {
  const text = input.user_text || input.prompt || "";
  const pc = getPivotCache();
  const isPivot = prevMessage && text ? pc.detectPivot(text, prevMessage) : { isPivot: false, similarity: 1 };
  if (isPivot.isPivot && prevMessage) {
    const prevTokens = pc.tokenize(prevMessage);
    const prevId = "wf-" + Date.now();
    pc.snapshot(prevId, {
      tokens: [...prevTokens],
      intent: prevMessage.substring(0, 60),
      decisions: input._pivotContext?.decisions?.length ? input._pivotContext.decisions : [`workflow: ${prevMessage.substring(0, 80)}`],
      files: input._pivotContext?.files || [],
      code_snippets: input._pivotContext?.code_snippets || [],
      blockers: input._pivotContext?.blockers || [],
      toolOutputs: input._pivotContext?.toolOutputs || []
    });
  }
  const result = vibemaxSelectMode(input);
  if (isPivot.isPivot) {
    result.mode = "budget";
    result.tier = "cheap";
    result.thinking = "off";
    result.flow = "audit";
    result.enforcement = "relaxed";
    result.tdd = "normal";
    result.cost = 0.1;
  }
  if (text)
    prevMessage = text;
  return {
    ...result,
    pivot_detected: isPivot.isPivot || false,
    pivot_similarity: isPivot.similarity || 1,
    pivot_back: result.pivot?.matchedId || null
  };
}
function predictVibeMaX(input = {}) {
  const r = vibemaxSelectMode(input);
  return { label: r.mode, confidence: r.confidence, source: "vibemax", source_prediction: r.source_prediction, pivot_back: r.pivot?.matchedId || null };
}
function extractVibeMaXFeatures(text, sr) {
  const t = (text || "").toLowerCase();
  const words = t.split(/\s+/).filter(Boolean);
  const f = {
    length: text.length / 5e3,
    word_count: words.length / 500,
    sentence_count: text.split(/[.!?]+/).filter((s) => s.trim()).length / 50,
    question_ratio: (text.match(/\?/g) || []).length / Math.max(text.split(/[.!?]+/).length, 1),
    code_blocks: (text.match(/```/g) || []).length / 10,
    urgency: /urgent|asap|immediately|critical|broken|failing|crash|error|bug/i.test(text) ? 1 : 0,
    complexity: /complex|difficult|hard|confusing|trick|subtle|nuance/i.test(text) ? 1 : 0,
    instruction_density: /do not|must|should|always|never|critical/i.test(text) ? 1 : /please|could you|maybe|perhaps/i.test(text) ? 0.3 : 0.6
  };
  return {
    ...Object.fromEntries(Object.entries(f).filter(([_, v]) => typeof v === "number")),
    word_count: words.length,
    has_question: t.includes("?") ? 1 : 0,
    has_debug: /debug|fix|broken|error|bug/.test(t) ? 1 : 0,
    has_explain: /explain|what|how|why|compare|review/.test(t) ? 1 : 0,
    has_refactor: /refactor|optimize|clean|improve/.test(t) ? 1 : 0,
    has_short: words.length <= 3 ? 1 : 0
  };
}
function extractFeatureVector(text, sr) {
  const feats = extractVibeMaXFeatures(text, sr);
  return Object.values(feats).filter((v) => typeof v === "number" && Number.isFinite(v));
}
function trainVibeMaXModelFromTelemetry(telemetryPath) {
  const raw = readFileSync7(telemetryPath, "utf-8").trim();
  const entries = raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const fbMode = { audit: "optimized", budget: "budget", quality: "optimized", speed: "budget", longrun: "optimized" };
  const classes = ["optimized", "budget"];
  const samples = [];
  for (const e of entries) {
    const t = e.telemetry || {};
    const text = t.input?.user_text || e.text || "";
    const sr = t.signals?.sub_regime || t.input?.sub_regime || "INIT";
    const mode = t.selection?.optimization_mode || t.control_vector?.optimization_mode || t.mode || "";
    if (!text || text.length < 2)
      continue;
    const target = fbMode[mode] || "optimized";
    const features = extractFeatureVector(text, sr);
    if (features.length > 0)
      samples.push({ features, label: target, text, sr, original_mode: mode });
  }
  if (samples.length < 2) {
    const boot = [
      // Technical / coding (16)
      { text: "hi", sr: "INIT", label: "budget" },
      { text: "what time is it", sr: "INIT", label: "budget" },
      { text: "show current status", sr: "INIT", label: "budget" },
      { text: "just give me quick answer", sr: "INIT", label: "budget" },
      { text: "review error handling", sr: "EXPLORING", label: "optimized" },
      { text: "this is broken fix it immediately", sr: "REFINING", label: "optimized" },
      { text: "help me debug this failing test", sr: "REFINING", label: "optimized" },
      { text: "we are repeating the same solution", sr: "LOOPING", label: "budget" },
      { text: "I need complete investigation with reasoning", sr: "RESEARCH", label: "optimized" },
      { text: "research the right documentation", sr: "RESEARCH", label: "optimized" },
      { text: "implement new feature with comprehensive tests", sr: "REFINING", label: "optimized" },
      { text: "lets wrap up and ship final change", sr: "CONVERGING", label: "optimized" },
      { text: "compare Redis vs Memcached performance", sr: "EXPLORING", label: "optimized" },
      { text: "search for all TODO comments", sr: "EXPLORING", label: "optimized" },
      { text: "whats the next step", sr: "INIT", label: "budget" },
      { text: "why does this keep looping", sr: "LOOPING", label: "budget" },
      // Non-technical (20)
      { text: "summarize this article", sr: "INIT", label: "budget" },
      { text: "tell me a joke", sr: "INIT", label: "budget" },
      { text: "translate hello to spanish", sr: "INIT", label: "budget" },
      { text: "whats the weather like", sr: "INIT", label: "budget" },
      { text: "write a quick email", sr: "INIT", label: "budget" },
      { text: "draft a meeting agenda", sr: "INIT", label: "audit" },
      { text: "analyze this spreadsheet data and find outliers", sr: "EXPLORING", label: "optimized" },
      { text: "compare these two products for my purchase decision", sr: "EXPLORING", label: "optimized" },
      { text: "review this contract for legal issues", sr: "EXPLORING", label: "optimized" },
      { text: "help me brainstorm marketing ideas", sr: "DIVERGENT", label: "audit" },
      { text: "edit this essay for grammar and clarity", sr: "REFINING", label: "audit" },
      { text: "improve the structure of this presentation", sr: "REFINING", label: "optimized" },
      { text: "proofread this resume and suggest improvements", sr: "REFINING", label: "optimized" },
      { text: "create a budget spreadsheet for my startup", sr: "REFINING", label: "optimized" },
      { text: "write a detailed business report on market trends", sr: "RESEARCH", label: "optimized" },
      { text: "research competitors for my business idea", sr: "RESEARCH", label: "optimized" },
      { text: "study this financial model and verify projections", sr: "RESEARCH", label: "optimized" },
      { text: "generate a social media content calendar", sr: "REFINING", label: "optimized" },
      { text: "we keep going in circles on this decision", sr: "LOOPING", label: "budget" },
      { text: "finalize the press release", sr: "CONVERGING", label: "optimized" }
    ];
    for (const b of boot) {
      const features = extractFeatureVector(b.text, b.sr);
      if (features.length > 0)
        samples.push({ features, label: b.label, text: b.text, sr: b.sr, original_mode: b.label });
    }
  }
  const treeCount = 29, maxDepth = 5, minLeaf = 2;
  const rngFn = rng(42);
  const trees = [];
  for (let i = 0; i < treeCount; i++) {
    const bag = [];
    for (let j = 0; j < samples.length; j++)
      bag.push(samples[Math.floor(rngFn() * samples.length)]);
    trees.push(buildTree(bag, classes, 0, maxDepth, minLeaf, rngFn));
  }
  let correct = 0;
  for (const s of samples) {
    const votes = {};
    for (const t of trees) {
      const r = predictTree(t, s.features);
      votes[r.prediction] = (votes[r.prediction] || 0) + 1;
    }
    const pred = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || classes[0];
    if (pred === s.label)
      correct++;
  }
  const model = { trees, classes, trained_at: (/* @__PURE__ */ new Date()).toISOString(), samples: samples.length, metrics: { accuracy: correct / Math.max(samples.length, 1), total_samples: samples.length }, config: { think: "full", wbp: "normal", kp: [3, 6] } };
  saveVibeMaXModel(model);
  return model;
}
function loadVibeMaXModel() {
  if (existsSync8(MODEL_PATH))
    return JSON.parse(readFileSync7(MODEL_PATH, "utf-8"));
  return null;
}
function saveVibeMaXModel(model) {
  mkdirSync7(dirname7(MODEL_PATH), { recursive: true });
  writeFileSync8(MODEL_PATH, JSON.stringify(model, null, 2) + "\n", "utf-8");
}
function getVibeMaXModelMeta() {
  const m = loadVibeMaXModel();
  if (!m)
    return { available: false, path: MODEL_PATH, message: "not trained" };
  return { available: true, path: MODEL_PATH, trained_at: m.trained_at, accuracy: m.metrics?.accuracy, samples: m.samples, trees: m.trees?.length, classes: m.classes };
}
var __dirname3, MODEL_PATH, BUDGET_CFG, VIBEMAX_MAP, pivotCache, prevMessage;
var init_vibemax = __esm({
  "src/vibeOS-lib/blackbox/vibemax.js"() {
    "use strict";
    init_meta_controller();
    init_pivot_cache();
    __dirname3 = dirname7(fileURLToPath4(import.meta.url));
    MODEL_PATH = process.env.VIBEOS_VIBEMAX_MODEL_PATH || resolve2(__dirname3, "..", "..", "..", "data", "vibemax-model.json");
    BUDGET_CFG = { tier: "cheap", thinking: "off", tdd: "normal", flow: "audit", enforcement: "relaxed", wbp: "minimal", c7: "skippable", kp: [1, 3], tc: 0.1, amode: "build" };
    VIBEMAX_MAP = { quality: "optimized", longrun: "optimized", audit: "optimized", speed: "budget", budget: "budget" };
    pivotCache = null;
    prevMessage = "";
  }
});

// src/vibeOS-lib/blackbox/vibeultrax.js
var vibeultrax_exports = {};
__export(vibeultrax_exports, {
  vibeultraxControlVector: () => vibeultraxControlVector,
  vibeultraxPipeline: () => vibeultraxPipeline
});
function normalizeText2(input = {}) {
  return String(input.user_text || input.prompt || input.text || "").trim();
}
function tierFromModelName(modelName) {
  const lower = String(modelName || "").toLowerCase();
  if (!lower)
    return null;
  if (/_?chat\b/.test(lower) || /(^|\/)deepseek\/deepseek-chat$/.test(lower))
    return "cheap";
  if (/_?flash\b/.test(lower) || /(^|\/)deepseek\/deepseek-v4-flash$/.test(lower))
    return "medium";
  return "brain";
}
function supportForPrediction(graph, firstWord, modelName) {
  const node = graph?.nodes?.[firstWord];
  const modelNode = graph?.nodes?.[modelName];
  if (!node || !modelNode)
    return 0;
  const totalRoutes = Object.values(node.edges || {}).reduce((sum, count) => sum + Number(count || 0), 0);
  if (!totalRoutes)
    return 0;
  const routeSupport = Number(node.edges?.[modelName] || 0) / totalRoutes;
  const okEdges = Object.entries(modelNode.edges || {}).filter(([key]) => String(key).endsWith("::ok")).reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const totalEdges = Object.values(modelNode.edges || {}).reduce((sum, count) => sum + Number(count || 0), 0) || 0;
  const successRate = totalEdges > 0 ? okEdges / totalEdges : 0;
  return routeSupport * 0.45 + successRate * 0.55;
}
function learnedRouteFromGraph(text) {
  const firstWord = String(text || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
  if (!firstWord || !_mlGraph?.nodes)
    return null;
  const predictedModel = predictBestModel(_mlGraph, firstWord, "brain");
  if (!predictedModel)
    return null;
  const learnedTier = tierFromModelName(predictedModel);
  if (!learnedTier)
    return null;
  const support = supportForPrediction(_mlGraph, firstWord, predictedModel);
  if (support < 0.5)
    return null;
  return { firstWord, predictedModel, learnedTier, support };
}
function profileFromCascade(decision, learned = null) {
  if (learned?.learnedTier === "cheap")
    return { profile: "direct", cascade_depth: 1, pipeline_root: ["local"], tier_bias: "cheap" };
  if (learned?.learnedTier === "medium")
    return { profile: "standard", cascade_depth: 2, pipeline_root: ["medium", "brain"], tier_bias: "medium" };
  if (learned?.learnedTier === "brain")
    return { profile: "deep", cascade_depth: 3, pipeline_root: ["local", "medium", "brain"], tier_bias: "brain" };
  if (decision.useCheap && decision.escalate)
    return { profile: "deep", cascade_depth: 3, pipeline_root: ["local", "medium", "brain"], tier_bias: "brain" };
  if (decision.escalate)
    return { profile: "standard", cascade_depth: 2, pipeline_root: ["medium", "brain"], tier_bias: "brain" };
  return { profile: "direct", cascade_depth: 1, pipeline_root: ["local"], tier_bias: "cheap" };
}
function getPivotCache2() {
  if (!globalThis.__vibeultraxPivotCache)
    globalThis.__vibeultraxPivotCache = new PivotCache();
  return globalThis.__vibeultraxPivotCache;
}
function vibeultraxControlVector(input = {}) {
  const text = normalizeText2(input);
  const cascade = cascadeDecide(text, CHEAP, MEDIUM, BRAIN, 0.85);
  const learned = learnedRouteFromGraph(text);
  const profile = profileFromCascade(cascade, learned);
  return {
    optimization_mode: "vibeultrax",
    mode_root: "vibeultrax",
    mode_family: "cascade",
    cascade_depth: profile.cascade_depth,
    pipeline_root: profile.pipeline_root,
    tier_bias: profile.tier_bias,
    enforcement_mode: "strict",
    flow_mode: "strict",
    tdd_mode: "quality",
    thinking_mode: profile.profile === "direct" ? "brief" : "full",
    stress_multiplier: 1,
    context7_urgency: "required",
    wbp_verbosity: profile.profile === "deep" ? "detailed" : "normal",
    ultrax_profile: profile.profile,
    ultrax_confidence: cascade.confidence,
    ultrax_reason: cascade.reason,
    ultrax_estimated_savings: cascade.estimatedSavings,
    ultrax_learned_model: learned?.predictedModel || null,
    ultrax_learned_tier: learned?.learnedTier || null,
    ultrax_learned_support: learned?.support || 0,
    directives: [`[ultrax root] cascade profile=${profile.profile}; reason=${cascade.reason}${learned ? `; learned=${learned.predictedModel}` : ""}`]
  };
}
function vibeultraxPipeline(input = {}) {
  const text = normalizeText2(input);
  const pc = getPivotCache2();
  const cascade = cascadeDecide(text, CHEAP, MEDIUM, BRAIN, 0.85);
  const learned = learnedRouteFromGraph(text);
  const profile = profileFromCascade(cascade, learned);
  const tokens = text ? pc.tokenize(text) : /* @__PURE__ */ new Set();
  const pivotBack = text && tokens.size > 0 ? pc.detectPivotBack(tokens, 0.5) : { matchedId: null, confidence: 0, reason: "no_text" };
  const isPivotBack = pivotBack.matchedId !== null;
  return {
    ...vibeultraxControlVector(input),
    mode: "vibeultrax",
    source: "vibeultrax",
    profile: profile.profile,
    source_strategy: learned ? "learned" : "cascade",
    learned_model: learned?.predictedModel || null,
    learned_tier: learned?.learnedTier || null,
    learned_support: learned?.support || 0,
    pivot: isPivotBack ? {
      matchedId: pivotBack.matchedId,
      confidence: pivotBack.confidence,
      reason: pivotBack.reason,
      injection: pc.buildInjection(pivotBack.matchedId),
      toolOutputs: pc.read(pivotBack.matchedId)?.toolOutputs || []
    } : null,
    pivot_detected: isPivotBack,
    pivot_confidence: pivotBack.confidence || 0,
    pivot_reason: pivotBack.reason || null,
    pipeline: profile.pipeline_root,
    cascade_depth: profile.cascade_depth,
    ultrax_reason: cascade.reason,
    ultrax_confidence: cascade.confidence,
    ultrax_estimated_savings: cascade.estimatedSavings
  };
}
var CHEAP, MEDIUM, BRAIN;
var init_vibeultrax = __esm({
  "src/vibeOS-lib/blackbox/vibeultrax.js"() {
    "use strict";
    init_ml_router();
    init_state();
    init_pivot_cache();
    CHEAP = 1e-4;
    MEDIUM = 1e-3;
    BRAIN = 0.01;
  }
});

// src/index.ts
init_flow_enforcer();
import { readFileSync as readFileSync17, writeFileSync as writeFileSync16, existsSync as existsSync18, mkdirSync as mkdirSync14, copyFileSync as copyFileSync2, renameSync as renameSync6, statSync as statSync9 } from "node:fs";
import { join as join18, dirname as dirname13, basename as basename5 } from "node:path";

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

// src/lib/vibeos-mcp-server.js
import http from "node:http";
import { parse as parseUrl } from "node:url";
import { createReadStream, existsSync as existsSync4, mkdirSync as mkdirSync3, statSync as statSync4, writeFileSync as writeFileSync4 } from "node:fs";
import { extname, join as join4, dirname as dirname3 } from "node:path";
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}
function parseBody(req) {
  return new Promise((resolve3, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk || "");
      if (raw.length > 1024 * 1024) {
        reject(new Error("payload too large"));
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve3({});
        return;
      }
      try {
        resolve3(JSON.parse(raw));
      } catch {
        reject(new Error("invalid request"));
      }
    });
    req.on("error", reject);
  });
}
var _MCP_FILENAME = fileURLToPath2(import.meta.url);
var _MCP_DIR = dirname3(_MCP_FILENAME);
function resolveDashboardDir() {
  const c = [
    join4(_MCP_DIR, "dashboard", "dist"),
    join4(_MCP_DIR, "assets", "dashboard"),
    join4(_MCP_DIR, "assets", "dashboard", "dist")
  ];
  for (const p of c) {
    if (existsSync4(join4(p, "index.html")))
      return p;
  }
  return c[0];
}
var DASHBOARD_DIR = resolveDashboardDir();
var DASHBOARD_CONFIG_PATH = join4(DASHBOARD_DIR, "vibeos-dashboard-config.js");
function writeDashboardBaseConfig(baseUrl) {
  try {
    if (!baseUrl)
      return null;
    mkdirSync3(DASHBOARD_DIR, { recursive: true });
    const payload = `window.__VIBEOS_DASHBOARD_BASE__ = ${JSON.stringify(baseUrl.replace(/\/$/, ""))};
`;
    writeFileSync4(DASHBOARD_CONFIG_PATH, payload, "utf-8");
    return DASHBOARD_CONFIG_PATH;
  } catch {
    return null;
  }
}
function resolveBackendHealthUrl() {
  const explicit = process.env.VIBEOS_BACKEND_HEALTH_URL?.trim();
  if (explicit)
    return explicit;
  const apiBase = process.env.VIBEOS_API_URL?.trim();
  if (apiBase) {
    try {
      return new URL("health", apiBase.endsWith("/") ? apiBase : `${apiBase}/`).href;
    } catch {
    }
  }
  return "https://api.vibetheog.com/health";
}
var BACKEND_HEALTH_URL = resolveBackendHealthUrl();
var BACKEND_HEALTH_TTL_MS = 5e3;
var backendHealth = { ok: null, checkedAt: 0, version: null };
async function probeBackendHealth(force = false) {
  const now = Date.now();
  if (!force && backendHealth.ok !== null && now - backendHealth.checkedAt < BACKEND_HEALTH_TTL_MS) {
    return { ok: backendHealth.ok, version: backendHealth.version };
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(BACKEND_HEALTH_URL, { signal: ctl.signal });
    clearTimeout(timer);
    let version = null;
    try {
      const body = await res.clone().json();
      const candidate = body?.backend_version ?? body?.version ?? null;
      if (typeof candidate === "string" && candidate.trim())
        version = candidate.trim();
    } catch {
    }
    if (!version) {
      const headerVersion = res.headers.get("x-backend-version");
      version = headerVersion && headerVersion.trim() ? headerVersion.trim() : null;
    }
    backendHealth = { ok: res.ok, checkedAt: now, version };
    return { ok: res.ok, version };
  } catch {
    backendHealth = { ok: false, checkedAt: now, version: null };
    return { ok: false, version: null };
  }
}
function sendFile(res, fp2) {
  if (!existsSync4(fp2)) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("not found");
    return;
  }
  const ext = extname(fp2).toLowerCase();
  const mime = MIME_MAP[ext] || "application/octet-stream";
  const st = statSync4(fp2);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.statusCode = 200;
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Length", st.size);
  res.setHeader("Cache-Control", "no-cache");
  const s = createReadStream(fp2);
  s.pipe(res);
  s.on("error", () => {
    res.statusCode = 500;
    res.end();
  });
}
function serveDashboard(res, p) {
  const idx = join4(DASHBOARD_DIR, "index.html");
  let fp2 = join4(DASHBOARD_DIR, p === "/" ? "index.html" : p);
  if (existsSync4(fp2) && statSync4(fp2).isFile()) {
    sendFile(res, fp2);
    return;
  }
  if (existsSync4(idx)) {
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
      if (method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
        res.statusCode = 204;
        res.end();
        return;
      }
      if (method === "GET" && path === "/status") {
        const state = deps.getState();
        const probe = await probeBackendHealth();
        const bb = deps.getBlackboxState();
        json(res, 200, { ...state, backend_connected: probe.ok === true, backend_health_url: BACKEND_HEALTH_URL, backend_version: probe.version, blackbox: bb ?? null });
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
      if (method === "GET" && path === "/blackbox") {
        json(res, 200, deps.getBlackboxState() || {});
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
      if (method === "POST" && path === "/blackbox/vector") {
        let body;
        try {
          body = await parseBody(req);
        } catch {
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
        } catch {
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "server error";
      json(res, 500, { error: message, status: 500 });
    }
  };
  return {
    async start(port) {
      if (server2)
        return server2;
      if (startPromise)
        return startPromise;
      startPromise = new Promise((resolve3, reject) => {
        const srv = http.createServer((req, res) => {
          void handler(req, res);
        });
        srv.once("error", reject);
        srv.listen(port, () => {
          server2 = srv;
          resolve3(srv);
        });
      });
      try {
        return await startPromise;
      } finally {
        startPromise = null;
      }
    },
    async close() {
      if (!server2)
        return;
      if (closePromise)
        return closePromise;
      closePromise = new Promise((resolve3, reject) => {
        server2?.close((err) => err ? reject(err) : resolve3());
      });
      try {
        await closePromise;
      } finally {
        server2 = null;
        closePromise = null;
      }
    }
  };
}

// src/lib/api-client.js
init_runtime_state();
import { readFileSync as readFileSync4, writeFileSync as writeFileSync5, existsSync as existsSync5, mkdirSync as mkdirSync4, rmSync as rmSync2 } from "node:fs";
import { dirname as dirname4 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
import { homedir as homedir3 } from "node:os";
var DEFAULT_API_URL = "https://api.vibetheog.com";
var EMBEDDED_API_TOKEN = "vos_8d73804b13bb46711b9a47f036dba7b4d026fd9583d96960e663716e62815a69";
var API_TOKEN_RE = /^vos_[a-f0-9]{64}$/i;
var API_DISABLED_RE = /^(1|true|yes|on)$/i;
var REQUEST_TIMEOUT = 1e4;
var MAX_RETRIES = 3;
var BASE_RETRY_DELAY = 1e3;
var ALPHA_BUILD_CHANNEL = String(process.env.VIBEOS_BUILD_CHANNEL || "alpha").toLowerCase();
var BOOTSTRAP_EXCHANGE_PATH = "/api/v1/auth/bootstrap/exchange";
var BOOTSTRAP_RETRY_COOLDOWN_MS = 6e4;
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
var ANOMALY_BURST_WINDOW_MS = 5e3;
var ANOMALY_BURST_THRESHOLD = 10;
var ANOMALY_FREQ_WINDOW_MS = 6e5;
var ANOMALY_STDDEV_FACTOR = 3;
var ANOMALY_WARMUP_MS = 3e4;
var ANOMALY_COOLDOWN_MS = 12e4;
var TokenAnomalyDetector = class {
  burstHistory = [];
  freqHistory = [];
  lastWarnTime = 0;
  anomalyTriggered = false;
  disabled = false;
  startedAt = Date.now();
  get isWarmup() {
    return Date.now() - this.startedAt < ANOMALY_WARMUP_MS;
  }
  record() {
    if (this.disabled || this.isWarmup)
      return;
    const now = Date.now();
    this.burstHistory = this.burstHistory.filter((t) => now - t < ANOMALY_BURST_WINDOW_MS);
    this.burstHistory.push(now);
    this.freqHistory.push(now);
  }
  checkBurst() {
    return this.burstHistory.length > ANOMALY_BURST_THRESHOLD;
  }
  checkFrequency() {
    const now = Date.now();
    const window = this.freqHistory.filter((t) => now - t < ANOMALY_FREQ_WINDOW_MS);
    if (window.length < 10)
      return false;
    const mean = window.length / (ANOMALY_FREQ_WINDOW_MS / 6e4);
    const recent = this.burstHistory.length / (ANOMALY_BURST_WINDOW_MS / 1e3);
    return recent > mean * ANOMALY_STDDEV_FACTOR;
  }
  throttleIfAnomalous() {
    const now = Date.now();
    if (this.disabled || this.isWarmup)
      return false;
    if (this.anomalyTriggered)
      return true;
    if (this.checkBurst() || this.checkFrequency()) {
      this.anomalyTriggered = true;
      this.lastWarnTime = now;
      console.error("[vibeOS] Token anomaly detected \u2014 throttling API calls");
      return true;
    }
    if (this.lastWarnTime && now - this.lastWarnTime > ANOMALY_COOLDOWN_MS) {
      this.anomalyTriggered = false;
    }
    return this.anomalyTriggered;
  }
  reset() {
    this.burstHistory = [];
    this.freqHistory = [];
    this.anomalyTriggered = false;
    this.lastWarnTime = 0;
  }
};
function normalizeApiToken(token, fallback2 = "") {
  const clean = String(token || "").trim();
  return API_TOKEN_RE.test(clean) ? clean : fallback2;
}
function normalizeDirectApiToken(token) {
  const clean = normalizeApiToken(token, "");
  return clean && clean !== EMBEDDED_API_TOKEN ? clean : "";
}
function isTruthyFlag(value) {
  return API_DISABLED_RE.test(String(value || "").trim());
}
function editEnvLine(content, key, value) {
  const lines = String(content || "").split(/\r?\n/);
  const next = [];
  let found = false;
  for (const line of lines) {
    if (line.startsWith(`${key}=`)) {
      found = true;
      if (value !== null)
        next.push(`${key}=${value}`);
      continue;
    }
    next.push(line);
  }
  if (!found && value !== null)
    next.push(`${key}=${value}`);
  while (next.length > 0 && next[next.length - 1] === "")
    next.pop();
  return next.join("\n") + "\n";
}
function persistPrimaryApiEnvState(next) {
  const primaryPath = _envPaths[0] + "/.env.production";
  try {
    let envContent = existsSync5(primaryPath) ? readFileSync4(primaryPath, "utf8") : "";
    if (next.disabled !== void 0) {
      envContent = editEnvLine(envContent, "VIBEOS_API_DISABLED", next.disabled ? "true" : null);
    }
    if (next.token !== void 0) {
      envContent = editEnvLine(envContent, "VIBEOS_API_TOKEN", next.token ? String(next.token).trim() : null);
    }
    if (!envContent.trim()) {
      try {
        if (existsSync5(primaryPath))
          rmSync2(primaryPath, { force: true });
      } catch {
      }
      return;
    }
    const parentDir = _envPaths[0];
    if (!existsSync5(parentDir))
      mkdirSync4(parentDir, { recursive: true });
    writeFileSync5(primaryPath, envContent.endsWith("\n") ? envContent : envContent + "\n", "utf8");
  } catch (diskErr) {
    console.error("[vibeOS] Failed to persist API env state:", diskErr.message);
  }
}
var VibeOSApiClient = class {
  baseUrl;
  apiToken;
  masterKey;
  timeout;
  fallbackMode;
  fallbackStubs;
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.VIBEOS_API_URL || DEFAULT_API_URL;
    this.apiToken = normalizeApiToken(options.apiToken || process.env.VIBEOS_API_TOKEN || "", "") || null;
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
  async exchangeBootstrapToken(bootstrapToken, buildChannel = ALPHA_BUILD_CHANNEL) {
    const token = String(bootstrapToken || "").trim();
    if (!token) {
      throw new Error("VIBEOS_API_BOOTSTRAP_TOKEN is not set");
    }
    const url = this.baseUrl + BOOTSTRAP_EXCHANGE_PATH;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token
        },
        body: JSON.stringify({
          build_channel: buildChannel,
          client: "opencode"
        }),
        signal: controller.signal
      });
      if (res.status === 401 || res.status === 403) {
        const errorBody = await res.json().catch(() => ({}));
        throw new VibeOSAuthError(errorBody.message || "Bootstrap exchange failed", res.status, errorBody.code);
      }
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error("API error " + res.status + ": " + (errorBody.error || res.statusText));
      }
      const data = await res.json().catch(() => ({}));
      const apiToken = String(data?.api_token || data?.token || data?.access_token || "").trim();
      if (!apiToken)
        throw new Error("Bootstrap exchange returned no API token");
      return apiToken;
    } finally {
      clearTimeout(timeoutId);
    }
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
  async getModes() {
    return this.request("/api/v1/modes", {}, "GET");
  }
  async selectMode(mode) {
    return this.request("/api/v1/mode/select", { mode });
  }
  async classifyQuery(text, state) {
    return this.request("/api/v1/mode/classify", { text, state: state || {} });
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
  async vibemaxSelect(input = {}) {
    return this.request("/api/v1/vibemax/select", input);
  }
  async vibemaxPipeline(input = {}) {
    return this.request("/api/v1/vibemax/pipeline", input);
  }
  async vibemaxReset() {
    return this.request("/api/v1/vibemax/reset", null);
  }
  async vibemaxModel() {
    return this.request("/api/v1/vibemax/model", null);
  }
  async vibemaxTrain(telemetryPath = null) {
    return this.request("/api/v1/vibemax/train", { telemetry_path: telemetryPath });
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
    const result = await this.request("/health", null, false);
    recordBackendVersion(result);
    return result;
  }
  isFallback() {
    return this.fallbackMode;
  }
};
var VIBEOS_API_URL = process.env.VIBEOS_API_URL || "https://api.vibetheog.com";
var _apiDir = typeof __dirname !== "undefined" ? __dirname : dirname4(fileURLToPath3(import.meta.url));
var _envPaths = [homedir3() + "/.claude", _apiDir, process.cwd(), homedir3()];
var _bootstrapEnvPath = _envPaths[0] + "/.env.alpha";
function readApiDisabledFromDisk() {
  for (const dir of _envPaths) {
    try {
      const env = readFileSync4(dir + "/.env.production", "utf8");
      const m = env.match(/^VIBEOS_API_DISABLED=(.+)$/m);
      if (m && isTruthyFlag(m[1]))
        return true;
    } catch {
    }
  }
  return false;
}
function readTokenFromDisk() {
  if (readApiDisabledFromDisk())
    return "";
  for (const dir of _envPaths) {
    try {
      const env = readFileSync4(dir + "/.env.production", "utf8");
      const m = env.match(/^VIBEOS_API_TOKEN=(.+)$/m);
      if (m) {
        const clean = normalizeDirectApiToken(m[1]);
        if (clean)
          return clean;
      }
    } catch {
    }
  }
  return "";
}
function hasPrimaryTokenOnDisk() {
  if (readApiDisabledFromDisk())
    return false;
  try {
    const env = readFileSync4(_envPaths[0] + "/.env.production", "utf8");
    return /^VIBEOS_API_TOKEN=/m.test(env);
  } catch {
    return false;
  }
}
function readBootstrapTokenFromDisk() {
  if (readApiDisabledFromDisk())
    return "";
  try {
    const env = readFileSync4(_bootstrapEnvPath, "utf8");
    const m = env.match(/^VIBEOS_API_BOOTSTRAP_TOKEN=(.+)$/m);
    if (m)
      return m[1].trim();
  } catch {
  }
  return "";
}
var VIBEOS_API_DISABLED = readApiDisabledFromDisk() || isTruthyFlag(process.env.VIBEOS_API_DISABLED);
var VIBEOS_API_TOKEN = VIBEOS_API_DISABLED ? "" : readTokenFromDisk() || normalizeDirectApiToken(process.env.VIBEOS_API_TOKEN) || (!hasPrimaryTokenOnDisk() ? EMBEDDED_API_TOKEN : "");
var VIBEOS_API_BOOTSTRAP_TOKEN = VIBEOS_API_DISABLED ? "" : readBootstrapTokenFromDisk() || process.env.VIBEOS_API_BOOTSTRAP_TOKEN || EMBEDDED_API_TOKEN;
var VIBEOS_API_ENABLED = !VIBEOS_API_DISABLED && process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN);
setApiEnabled(VIBEOS_API_ENABLED);
function syncApiEnabledState(next) {
  VIBEOS_API_ENABLED = !!next;
  setApiEnabled(VIBEOS_API_ENABLED);
}
var _anomalyDetector = null;
function getAnomalyDetector() {
  if (!_anomalyDetector)
    _anomalyDetector = new TokenAnomalyDetector();
  return _anomalyDetector;
}
function persistBootstrapToken(token) {
  const clean = String(token || "").trim();
  try {
    if (!clean) {
      try {
        if (existsSync5(_bootstrapEnvPath))
          rmSync2(_bootstrapEnvPath, { force: true });
      } catch {
      }
      return;
    }
    const parentDir = _envPaths[0];
    if (!existsSync5(parentDir))
      mkdirSync4(parentDir, { recursive: true });
    writeFileSync5(_bootstrapEnvPath, `VIBEOS_API_BOOTSTRAP_TOKEN=${clean}
`, "utf8");
  } catch (diskErr) {
    console.error("[vibeOS] Failed to persist alpha bootstrap token:", diskErr.message);
  }
}
function setApiToken(newToken) {
  try {
    VIBEOS_API_DISABLED = false;
    VIBEOS_API_TOKEN = normalizeDirectApiToken(newToken);
    VIBEOS_API_BOOTSTRAP_TOKEN = readBootstrapTokenFromDisk() || VIBEOS_API_BOOTSTRAP_TOKEN;
    syncApiEnabledState(process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN));
    _apiClient = null;
    _apiFallbackMode = false;
    _apiFallbackSince = null;
    persistPrimaryApiEnvState({ token: VIBEOS_API_TOKEN, disabled: false });
    if (_anomalyDetector)
      _anomalyDetector.reset();
    markApiConnected();
    console.error("[vibeOS] API token updated via setApiToken");
  } catch (e) {
    console.error("[vibeOS] Failed to update API token:", e.message);
  }
}
function invalidateApiToken() {
  try {
    VIBEOS_API_DISABLED = true;
    VIBEOS_API_TOKEN = "";
    VIBEOS_API_BOOTSTRAP_TOKEN = "";
    syncApiEnabledState(false);
    _apiClient = null;
    _apiFallbackMode = false;
    _apiFallbackSince = null;
    if (_anomalyDetector)
      _anomalyDetector.reset();
    persistBootstrapToken("");
    persistPrimaryApiEnvState({ token: "", disabled: true });
    resetApiConnection();
    console.error("[vibeOS] API token invalidated and remote API disabled");
  } catch (e) {
    console.error("[vibeOS] Failed to invalidate API token:", e.message);
  }
}
function setApiBootstrapToken(newToken) {
  try {
    VIBEOS_API_DISABLED = false;
    VIBEOS_API_BOOTSTRAP_TOKEN = String(newToken || "").trim();
    syncApiEnabledState(process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN));
    markApiConnected();
    persistPrimaryApiEnvState({ disabled: false });
    persistBootstrapToken(VIBEOS_API_BOOTSTRAP_TOKEN);
    console.error("[vibeOS] Alpha bootstrap token updated");
  } catch (e) {
    console.error("[vibeOS] Failed to update alpha bootstrap token:", e.message);
  }
}
var _apiClient = null;
var _apiFallbackMode = false;
var _apiFallbackSince = null;
var _bootstrapExchangeInFlight = null;
var _bootstrapExchangeFailedAt = 0;
var _backendVersion = "";
var FALLBACK_COOLDOWN_MS = process.env.VIBEOS_FAST_CI === "1" ? 5e3 : 6e4;
function tryResetFallbackCooldown() {
  if (!_apiFallbackMode || !_apiFallbackSince)
    return false;
  const elapsed = Date.now() - new Date(_apiFallbackSince).getTime();
  if (elapsed > FALLBACK_COOLDOWN_MS) {
    _apiFallbackMode = false;
    _apiFallbackSince = null;
    markApiConnected();
    return true;
  }
  return false;
}
function getApiFallbackSince() {
  return _apiFallbackSince;
}
function recordBackendVersion(payload) {
  if (!payload || typeof payload !== "object")
    return;
  const version = String(payload.version || "").trim();
  if (version)
    _backendVersion = version;
}
async function ensureBootstrapExchange() {
  syncApiTokenFromDisk();
  if (VIBEOS_API_DISABLED)
    return false;
  if (VIBEOS_API_TOKEN)
    return true;
  if (!VIBEOS_API_BOOTSTRAP_TOKEN)
    return false;
  if (ALPHA_BUILD_CHANNEL !== "alpha")
    return false;
  const now = Date.now();
  if (_bootstrapExchangeInFlight)
    return _bootstrapExchangeInFlight;
  if (_bootstrapExchangeFailedAt && now - _bootstrapExchangeFailedAt < BOOTSTRAP_RETRY_COOLDOWN_MS)
    return false;
  _bootstrapExchangeInFlight = (async () => {
    try {
      const client2 = new VibeOSApiClient({
        baseUrl: VIBEOS_API_URL,
        timeout: 5e3
      });
      const apiToken = await client2.exchangeBootstrapToken(VIBEOS_API_BOOTSTRAP_TOKEN, ALPHA_BUILD_CHANNEL);
      if (!apiToken)
        return false;
      setApiToken(apiToken);
      markApiConnected();
      return true;
    } catch (err) {
      _bootstrapExchangeFailedAt = Date.now();
      console.error("[vibeOS] Alpha bootstrap exchange failed:", err.message);
      return false;
    } finally {
      _bootstrapExchangeInFlight = null;
    }
  })();
  return _bootstrapExchangeInFlight;
}
function syncApiTokenFromDisk() {
  const diskDisabled = readApiDisabledFromDisk() || isTruthyFlag(process.env.VIBEOS_API_DISABLED);
  const diskToken = readTokenFromDisk() || "";
  const diskBootstrapToken = readBootstrapTokenFromDisk() || "";
  const envToken = normalizeDirectApiToken(process.env.VIBEOS_API_TOKEN);
  if (diskDisabled) {
    if (!VIBEOS_API_DISABLED || VIBEOS_API_TOKEN || VIBEOS_API_BOOTSTRAP_TOKEN || VIBEOS_API_ENABLED) {
      VIBEOS_API_DISABLED = true;
      VIBEOS_API_TOKEN = "";
      VIBEOS_API_BOOTSTRAP_TOKEN = "";
      syncApiEnabledState(false);
      _apiClient = null;
      _apiFallbackMode = false;
      _apiFallbackSince = null;
      resetApiConnection();
      console.error("[vibeOS] API token disabled from disk (alpha kill switch active)");
    }
    return;
  }
  if (diskToken && diskToken !== VIBEOS_API_TOKEN) {
    VIBEOS_API_DISABLED = false;
    VIBEOS_API_TOKEN = diskToken;
    syncApiEnabledState(process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN));
    _apiClient = null;
    _apiFallbackMode = false;
    _apiFallbackSince = null;
    markApiConnected();
    console.error("[vibeOS] API token synced from disk (disk is newer)");
  } else if (diskBootstrapToken && diskBootstrapToken !== VIBEOS_API_BOOTSTRAP_TOKEN) {
    VIBEOS_API_DISABLED = false;
    VIBEOS_API_BOOTSTRAP_TOKEN = diskBootstrapToken;
    syncApiEnabledState(process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN));
    _apiFallbackMode = false;
    _apiFallbackSince = null;
    markApiConnected();
    console.error("[vibeOS] Alpha bootstrap token synced from disk (disk is newer)");
  } else if (!diskToken && VIBEOS_API_TOKEN) {
    persistPrimaryApiEnvState({ token: VIBEOS_API_TOKEN, disabled: false });
    console.error("[vibeOS] API token persisted to disk from memory (disk was empty)");
    syncApiEnabledState(process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN);
    markApiConnected();
  } else if (envToken && !diskToken && !VIBEOS_API_TOKEN) {
    VIBEOS_API_DISABLED = false;
    VIBEOS_API_TOKEN = envToken;
    syncApiEnabledState(process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN));
    markApiConnected();
    console.error("[vibeOS] API token loaded from VIBEOS_API_TOKEN env var");
  } else {
    VIBEOS_API_DISABLED = false;
    if (!VIBEOS_API_TOKEN && !hasPrimaryTokenOnDisk()) {
      VIBEOS_API_TOKEN = EMBEDDED_API_TOKEN;
    }
    VIBEOS_API_BOOTSTRAP_TOKEN ||= EMBEDDED_API_TOKEN;
    syncApiEnabledState(process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN));
    markApiConnected();
  }
}
function getApiClient2() {
  syncApiTokenFromDisk();
  if (!_apiClient && isApiEnabled() && VIBEOS_API_TOKEN) {
    _apiClient = new VibeOSApiClient({
      baseUrl: VIBEOS_API_URL,
      apiToken: VIBEOS_API_TOKEN,
      timeout: 5e3
    });
  }
  return _apiClient;
}
function isApiFallback() {
  return _apiFallbackMode || isApiFallbackMode() || !isApiEnabled();
}
function isApiConnected() {
  tryResetFallbackCooldown();
  return isApiEnabled();
}
function getBackendVersion() {
  return _backendVersion;
}
async function remoteCall(method, args, fallbackFn) {
  syncApiTokenFromDisk();
  if (!VIBEOS_API_TOKEN && VIBEOS_API_BOOTSTRAP_TOKEN) {
    await ensureBootstrapExchange();
    syncApiTokenFromDisk();
  }
  if (tryResetFallbackCooldown()) {
    if (process.env.VIBEOS_DEBUG)
      console.warn("[vibeOS] API fallback cooldown expired \u2014 retrying API");
  }
  if (!isApiEnabled() || _apiFallbackMode) {
    if (fallbackFn)
      return fallbackFn();
    return null;
  }
  const detector = getAnomalyDetector();
  detector.record();
  if (detector.throttleIfAnomalous()) {
    if (fallbackFn)
      return fallbackFn();
    return null;
  }
  try {
    const client2 = getApiClient2();
    if (!client2) {
      if (fallbackFn)
        return fallbackFn();
      return null;
    }
    const result = await client2[method](...args);
    if (method === "health")
      recordBackendVersion(result);
    if (_apiFallbackMode) {
      _apiFallbackMode = false;
      _apiFallbackSince = null;
      if (process.env.VIBEOS_DEBUG)
        console.warn(`[vibeOS] API reconnected \u2014 ${method} OK`);
    }
    _apiFallbackMode = false;
    _apiFallbackSince = null;
    markApiConnected();
    return result;
  } catch (err) {
    const status = err?.statusCode || err?.status || 0;
    const body = err?.response?.body || err?.body || "";
    const bodyPreview = typeof body === "string" ? body.substring(0, 120) : String(body).substring(0, 120);
    const detail = status ? `status=${status} body=${bodyPreview}` : `message=${err?.message || err}`;
    if (!_apiFallbackMode) {
      _apiFallbackMode = true;
      _apiFallbackSince = (/* @__PURE__ */ new Date()).toISOString();
      console.error(`[vibeOS] API fallback activated (${method}): ${detail}`);
    }
    if (status === 401 || status === 403) {
      console.warn(`[vibeOS] API auth failed (${method}): server reachable but token rejected \u2014 will retry after cooldown`);
    } else {
      markApiDisconnected();
    }
    if (fallbackFn) {
      try {
        return fallbackFn();
      } catch (fe) {
        console.error(`[vibeOS] fallback also failed: ${fe?.message || fe}`);
      }
    }
    return null;
  }
}

// src/lib/pricing.js
init_state();
import { readFileSync as readFileSync5, writeFileSync as writeFileSync6, existsSync as existsSync6, mkdirSync as mkdirSync5, statSync as statSync5, renameSync as renameSync4, openSync as openSync2, closeSync as closeSync2, rmSync as rmSync3, readdirSync as readdirSync2 } from "node:fs";
import { join as join5, dirname as dirname5, resolve } from "node:path";
import { homedir as homedir4, tmpdir as tmpdir3 } from "node:os";
import { createHash as createHash2 } from "node:crypto";
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
var DEFAULT_TRINITY_SLOTS = ["brain", "medium", "cheap"];
var LABEL_MODES = ["Fast", "Balanced", "High Quality", "Cheap"];
var DEBUG_INTERNALS = process.env.VIBEOS_DEBUG_INTERNALS === "1";
function getVibeOSHome4() {
  return process.env.VIBEOS_HOME || join5(process.env.HOME || homedir4(), ".claude");
}
function getOpenCodeDesktopHome() {
  return process.env.VIBEOS_OPENCODE_DESKTOP_HOME || join5(process.env.HOME || homedir4(), "Library", "Application Support", "ai.opencode.desktop");
}
var TIERS_FILE2 = join5(getVibeOSHome4(), "model-tiers.json");
function _lockPathFor2(filePath) {
  const hash = createHash2("sha1").update(String(filePath || "")).digest("hex");
  return join5(getVibeOSHome4(), ".vibeOS-locks", `${hash}.lock`);
}
function withFileLock2(filePath, fn, opts = {}) {
  const staleMs = Number(opts.staleMs || 3e4);
  const timeoutMs = Number(opts.timeoutMs || 2e3);
  const lockPath = _lockPathFor2(filePath);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      mkdirSync5(join5(getVibeOSHome4(), ".vibeOS-locks"), { recursive: true });
      const fd = openSync2(lockPath, "wx");
      try {
        writeFileSync6(fd, `${process.pid}
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
          rmSync3(lockPath, { force: true });
        } catch {
        }
      }
    } catch (err) {
      try {
        if (existsSync6(lockPath)) {
          const age = Date.now() - statSync5(lockPath).mtimeMs;
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
  throw new Error(`[vibeOS] lock not acquired for ${filePath} after ${timeoutMs}ms`);
}
function classify(m) {
  const s = String(m || "").toLowerCase();
  if (HIGH_TIER_RE.test(s))
    return "high";
  if (MID_TIER_RE.test(s))
    return "mid";
  const bare = s.includes("/") ? s.split("/").slice(1).join("/") : s;
  if (HIGH_TIER_RE.test(bare))
    return "high";
  if (MID_TIER_RE.test(bare))
    return "mid";
  return "budget";
}
function modelToSlotLabel(modelId, effectiveTier) {
  const tier = effectiveTier ?? classify(modelId);
  const icon = tier === "high" ? "\u{1F9E0}" : tier === "mid" ? "\u25D0" : "\u26A1";
  return `[${icon} ${tier.charAt(0).toUpperCase() + tier.slice(1)}]`;
}
function getModelProvider(modelId) {
  const raw = String(modelId || "").trim();
  if (!raw)
    return "";
  const idx = raw.indexOf("/");
  return idx > 0 ? raw.slice(0, idx) : "";
}
function formatProviderName(providerName) {
  const raw = String(providerName || "").trim();
  if (!raw)
    return "Unknown";
  if (raw === "openai")
    return "OpenAI";
  if (raw === "openrouter")
    return "OpenRouter";
  if (raw === "anthropic")
    return "Anthropic";
  if (raw === "google")
    return "Google";
  if (raw === "opencode-go")
    return "OpenCode Go";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
function formatQualityName(quality) {
  const raw = String(quality || "").trim().toLowerCase();
  if (raw === "brain" || raw === "high")
    return "Brain";
  if (raw === "medium" || raw === "mid")
    return "Medium";
  if (raw === "cheap" || raw === "budget")
    return "Cheap";
  if (raw === "free")
    return "Free";
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Unknown";
}
function resolveExecutionIdentity(modelId, directory3 = "") {
  const raw = String(modelId || "").trim();
  const resolved = resolveDisplayModelId(raw, directory3) || raw;
  const provider = getModelProvider(resolved) || getModelProvider(raw) || "";
  const normalized = normalizeModelId(resolved || raw);
  const quality = isModelFree(resolved || raw) ? "free" : classify(resolved || raw) === "high" ? "brain" : classify(resolved || raw) === "mid" ? "medium" : "cheap";
  return {
    provider,
    provider_label: formatProviderName(provider),
    quality,
    quality_label: formatQualityName(quality),
    model: resolved || raw,
    model_label: shortModelName(resolved || raw)
  };
}
function resolveTrinityDisplayModel(directory3 = "", activeSlot = "", liveModel = "", currentModelId = "") {
  const slot = String(activeSlot || "").trim();
  const slotModel = slot === "brain" ? TRINITY_BRAIN || "" : slot === "medium" ? TRINITY_MEDIUM || "" : slot === "cheap" ? TRINITY_CHEAP || "" : "";
  const raw = [slotModel, liveModel, currentModelId].map((value) => String(value || "").trim()).find(Boolean) || "";
  return resolveDisplayModelId(raw, directory3) || raw;
}
function _providerOfModel(modelId, fallbackProvider = "") {
  const provider = getModelProvider(modelId);
  return provider || String(fallbackProvider || "").trim();
}
function _sortByQualityDesc(models = []) {
  return [...models].sort((a, b) => {
    const ar = classify(a?.id) === "high" ? 3 : classify(a?.id) === "mid" ? 2 : 1;
    const br = classify(b?.id) === "high" ? 3 : classify(b?.id) === "mid" ? 2 : 1;
    if (br !== ar)
      return br - ar;
    const ac = Number(a?.cost ?? 0);
    const bc = Number(b?.cost ?? 0);
    if (bc !== ac)
      return bc - ac;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}
function _sortByCostAsc(models = []) {
  return [...models].sort((a, b) => {
    const af = isModelFree(a?.id) ? 0 : 1;
    const bf = isModelFree(b?.id) ? 0 : 1;
    if (af !== bf)
      return af - bf;
    const ac = Number(a?.cost ?? 0);
    const bc = Number(b?.cost ?? 0);
    if (ac !== bc)
      return ac - bc;
    const ar = classify(a?.id) === "high" ? 3 : classify(a?.id) === "mid" ? 2 : 1;
    const br = classify(b?.id) === "high" ? 3 : classify(b?.id) === "mid" ? 2 : 1;
    if (ar !== br)
      return ar - br;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}
function buildDeterministicTrinity(models, options = {}) {
  const list = Array.isArray(models) ? models.filter((m) => m && typeof m === "object" && String(m.id || "").trim()) : [];
  if (list.length === 0)
    return null;
  const selectedModelId = String(options.selectedModelId || "").trim();
  const providerHint = String(options.provider || "").trim();
  const selectedModel = selectedModelId ? list.find((m) => m.id === selectedModelId || normalizeModelId(m.id) === normalizeModelId(selectedModelId)) || null : null;
  const provider = _providerOfModel(selectedModel?.id || selectedModelId, providerHint) || _providerOfModel(list[0]?.id || "", providerHint);
  const providerModels = list.filter((m) => _providerOfModel(m.id, provider) === provider);
  const scoped = providerModels.length > 0 ? providerModels : list;
  const qualityRanked = _sortByQualityDesc(scoped);
  const costRanked = _sortByCostAsc(scoped);
  const brain = selectedModel || qualityRanked[0] || costRanked[0] || scoped[0] || list[0];
  const medium = qualityRanked.find((m) => m.id !== brain?.id) || brain;
  const freeModel = scoped.find((m) => isModelFree(m.id));
  const cheap = freeModel || costRanked[0] || medium;
  const brainClass = isModelFree(brain?.id) ? "free" : classify(brain?.id);
  return {
    provider,
    selected_tier: brainClass,
    selected_model: brain?.id || selectedModelId || "",
    brain: brain?.id || "",
    medium: medium?.id || "",
    cheap: cheap?.id || "",
    label_modes: [...LABEL_MODES]
  };
}
function shortModelName(modelId) {
  const raw = String(modelId || "").trim();
  if (!raw)
    return "unknown";
  const parts = raw.split("/");
  return parts[parts.length - 1] || raw;
}
var MODEL_DISPLAY_PREFIXES = /^(deepseek|claude|gemini|gpt|davinci|llama|qwq|qwen)-/i;
function modelDisplayName(modelId) {
  const short = shortModelName(modelId);
  const isFree = short.endsWith("-free");
  const base = isFree ? short.slice(0, -5) : short;
  const cleaned = base.replace(MODEL_DISPLAY_PREFIXES, "");
  if (!cleaned)
    return short;
  const display = cleaned.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return isFree ? `${display} Free` : display;
}
function trendDisplay(sesTrend) {
  const t = sesTrend === "up" || sesTrend === "down" ? sesTrend : "stable";
  const icon = t === "up" ? "\u2191" : t === "down" ? "\u2193" : "\u2192";
  return `${icon} ${t}`;
}
var CACHE_SAVED_PER_1M_INPUT_TOKENS = 0.1;
var AVG_TOKENS_PER_TURN = 375;
function parseOpenRouterInputPer1M(modelRow) {
  const p = modelRow?.pricing || {};
  const inTok = Number(p.prompt ?? p.input ?? p.request);
  if (Number.isFinite(inTok) && inTok > 0) {
    return Math.round(inTok * 1e6 * 1e4) / 1e4;
  }
  return null;
}
function cacheSavePer1MInputTokens(model) {
  if (!model)
    return CACHE_SAVED_PER_1M_INPUT_TOKENS;
  if (isModelFree(model))
    return 0;
  const rawKey = String(model || "");
  const key = normalizeModelId(model);
  const rawNoPrefix = rawKey.includes("/") ? rawKey.split("/")[rawKey.split("/").length - 1] : rawKey;
  try {
    const cache = _loadDynamicPricingCache();
    for (const candidate of [rawKey, key, rawNoPrefix]) {
      const entry = cache[candidate];
      const rate = parseOpenRouterInputPer1M(entry);
      if (rate !== null)
        return rate;
    }
    for (const [ck, cv] of Object.entries(cache)) {
      if (ck.endsWith("/" + rawNoPrefix)) {
        const rate = parseOpenRouterInputPer1M(cv);
        if (rate !== null)
          return rate;
      }
    }
  } catch {
  }
  for (const candidate of [rawKey, key, rawNoPrefix]) {
    const known = MODEL_PRICING_PER_1M[candidate];
    if (known && Number.isFinite(known.input))
      return known.input;
  }
  const turnCost = modelCostPerTurn(model);
  if (Number.isFinite(turnCost) && turnCost > 0) {
    return Math.round(turnCost * AVG_TOKENS_PER_TURN * 100) / 100;
  }
  return CACHE_SAVED_PER_1M_INPUT_TOKENS;
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
var FREE_MODEL_TURN_USD = 1e-10;
var FREE_MODELS = /* @__PURE__ */ new Set([
  // OpenCode Zen free models
  "opencode/big-pickle",
  "opencode/mimo-v2.5-free",
  "opencode/deepseek-v4-flash-free",
  "opencode/nemotron-3-ultra-free",
  // Normalized variants (after opencode/ prefix stripped)
  "big-pickle",
  "mimo-v2.5-free",
  "deepseek-v4-flash-free",
  "nemotron-3-ultra-free"
]);
var MODEL_PRICING_PER_1M = {
  // ── Anthropic (native + OpenRouter) ─────────────────────
  "anthropic/claude-opus-4-8-fast": { input: 10, output: 50 },
  "anthropic/claude-opus-4-8": { input: 5, output: 25 },
  "anthropic/claude-opus-4-7-fast": { input: 30, output: 150 },
  "anthropic/claude-opus-4-7": { input: 5, output: 25 },
  "anthropic/claude-opus-4-6-fast": { input: 30, output: 150 },
  "anthropic/claude-opus-4-6": { input: 5, output: 25 },
  "anthropic/claude-opus-4-5": { input: 5, output: 25 },
  "anthropic/claude-opus-4.1": { input: 15, output: 75 },
  "anthropic/claude-opus-4": { input: 15, output: 75 },
  "anthropic/claude-sonnet-4-6": { input: 3, output: 15 },
  "anthropic/claude-sonnet-4-5": { input: 3, output: 15 },
  "anthropic/claude-sonnet-4": { input: 3, output: 15 },
  "anthropic/claude-haiku-4-5": { input: 1, output: 5 },
  "anthropic/claude-3.5-haiku": { input: 0.8, output: 4 },
  "anthropic/claude-3-haiku": { input: 0.25, output: 1.25 },
  "haiku": { input: 0.8, output: 4 },
  // ── DeepSeek (native — free for chat, paid for pro/flash/r1) ──
  "deepseek-chat": { input: 0, output: 0 },
  // native → free
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
  // native r1
  // ── DeepSeek (OpenRouter route) ────────────────────────
  "deepseek/deepseek-v4-pro": { input: 0.435, output: 0.87 },
  "deepseek/deepseek-v4-flash": { input: 0.098, output: 0.197 },
  "deepseek/deepseek-chat": { input: 0.229, output: 0.914 },
  "deepseek/deepseek-v3.2": { input: 0.252, output: 0.378 },
  "deepseek/deepseek-v3.2-exp": { input: 0.27, output: 0.41 },
  "deepseek/deepseek-chat-v3.1": { input: 0.21, output: 0.79 },
  "deepseek/deepseek-chat-v3-0324": { input: 0.2, output: 0.77 },
  "deepseek/deepseek-v3.1-terminus": { input: 0.27, output: 0.95 },
  "deepseek/deepseek-r1-0528": { input: 0.5, output: 2.15 },
  "deepseek/deepseek-r1": { input: 0.7, output: 2.5 },
  "deepseek/deepseek-r1-distill-qwen-32b": { input: 0.29, output: 0.29 },
  "deepseek/deepseek-r1-distill-llama-70b": { input: 0.7, output: 0.8 },
  "deepseek/deepseek-v3": { input: 0.252, output: 0.378 },
  "deepseek/haiku": { input: 0.8, output: 4 },
  // ── Google Gemini (OpenRouter route) ──────────────────
  "google/gemini-2.5-pro": { input: 1.25, output: 10 },
  "google/gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "google/gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "google/gemini-2.0-flash-001": { input: 0.1, output: 0.4 },
  "google/gemini-2.0-flash-lite-001": { input: 0.075, output: 0.3 },
  "google/gemma-4-31b-it": { input: 0.12, output: 0.37 },
  "google/gemma-4-26b-a4b-it": { input: 0.06, output: 0.33 },
  // ── OpenAI (OpenRouter route) ─────────────────────────
  "openai/gpt-5.5-pro": { input: 30, output: 180 },
  "openai/gpt-5.5": { input: 5, output: 30 },
  "openai/gpt-5.4-pro": { input: 30, output: 180 },
  "openai/gpt-5.4": { input: 2.5, output: 15 },
  "openai/gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "openai/gpt-5.4-nano": { input: 0.2, output: 1.25 },
  "openai/gpt-5.3-chat": { input: 1.75, output: 14 },
  "openai/gpt-5.3-codex": { input: 1.75, output: 14 },
  "openai/gpt-5.2": { input: 1.75, output: 14 },
  "openai/gpt-5.2-pro": { input: 21, output: 168 },
  "openai/gpt-5.1": { input: 1.25, output: 10 },
  "openai/gpt-5": { input: 1.25, output: 10 },
  "openai/gpt-5-mini": { input: 0.25, output: 2 },
  "openai/gpt-5-nano": { input: 0.05, output: 0.4 },
  "openai/gpt-4o": { input: 2.5, output: 10 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
  "openai/gpt-4.1": { input: 2, output: 8 },
  "openai/gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "openai/gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "openai/o4-mini": { input: 1.1, output: 4.4 },
  "openai/o4-mini-high": { input: 1.1, output: 4.4 },
  "openai/o3-pro": { input: 20, output: 80 },
  "openai/o3": { input: 2, output: 8 },
  "openai/o3-mini": { input: 1.1, output: 4.4 },
  "openai/o1-pro": { input: 150, output: 600 },
  "openai/o1": { input: 15, output: 60 },
  "openai/gpt-4-turbo": { input: 10, output: 30 },
  "openai/gpt-4": { input: 30, output: 60 },
  "openai/gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  // ── Mistral (OpenRouter route) ────────────────────────
  "mistralai/mistral-medium-3-5": { input: 1.5, output: 7.5 },
  "mistralai/mistral-large-2512": { input: 0.5, output: 1.5 },
  "mistralai/mistral-small-2603": { input: 0.15, output: 0.6 },
  "mistralai/mistral-nemo": { input: 0.02, output: 0.03 },
  // ── OpenCode Go ─────────────────────────────
  "opencode-go/glm-5.1": { input: 1.4, output: 4.4 },
  "opencode-go/glm-5": { input: 1, output: 3.2 },
  "opencode-go/kimi-k2.6": { input: 0.95, output: 4 },
  "opencode-go/kimi-k2.5": { input: 0.6, output: 3 },
  "opencode-go/mimo-v2.5": { input: 0.14, output: 0.28 },
  "opencode-go/mimo-v2.5-pro": { input: 1.74, output: 3.48 },
  "opencode-go/minimax-m3": { input: 0.6, output: 2.4 },
  "opencode-go/minimax-m2.7": { input: 0.3, output: 1.2 },
  "opencode-go/minimax-m2.5": { input: 0.3, output: 1.2 },
  "opencode-go/qwen3.7-max": { input: 2.5, output: 7.5 },
  "opencode-go/qwen3.7-plus": { input: 0.4, output: 1.6 },
  "opencode-go/qwen3.6-plus": { input: 0.5, output: 3 },
  // ── OpenCode Zen (bare model names, opencode/ prefix stripped) ──
  "minimax-m2.7": { input: 0.3, output: 1.2 },
  "minimax-m2.5": { input: 0.3, output: 1.2 },
  "glm-5.1": { input: 1.4, output: 4.4 },
  "glm-5": { input: 1, output: 3.2 },
  "kimi-k2.5": { input: 0.6, output: 3 },
  "kimi-k2.6": { input: 0.95, output: 4 },
  "qwen3.7-max": { input: 2.5, output: 7.5 },
  "qwen3.7-plus": { input: 0.4, output: 1.6 },
  "qwen3.6-plus": { input: 0.5, output: 3 },
  "qwen3.5-plus": { input: 0.2, output: 1.2 },
  "deepseek-v4-flash": { input: 0.14, output: 0.28 },
  "grok-build-0.1": { input: 1, output: 2 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-opus-4-1": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "gemini-3.5-flash": { input: 1.5, output: 9 },
  "gemini-3.1-pro": { input: 2, output: 12 },
  "gemini-3-flash": { input: 0.5, output: 3 },
  "gpt-5.5": { input: 5, output: 30 },
  "gpt-5.5-pro": { input: 30, output: 180 },
  "gpt-5.4": { input: 2.5, output: 15 },
  "gpt-5.4-pro": { input: 30, output: 180 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
  "gpt-5.3-codex-spark": { input: 1.75, output: 14 },
  "gpt-5.3-codex": { input: 1.75, output: 14 },
  "gpt-5.2": { input: 1.75, output: 14 },
  "gpt-5.2-codex": { input: 1.75, output: 14 },
  "gpt-5.1": { input: 1.07, output: 8.5 },
  "gpt-5.1-codex": { input: 1.07, output: 8.5 },
  "gpt-5.1-codex-max": { input: 1.25, output: 10 },
  "gpt-5.1-codex-mini": { input: 0.25, output: 2 },
  "gpt-5": { input: 1.07, output: 8.5 },
  "gpt-5-codex": { input: 1.07, output: 8.5 },
  "gpt-5-nano": { input: 0.05, output: 0.4 }
};
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
  "deepseek/deepseek-chat": 1e-12,
  "deepseek-chat": 1e-12,
  "deepseek/deepseek-v3": 182e-6,
  "deepseek/deepseek-r1": 124e-5,
  "deepseek/deepseek-reasoner": 182e-6,
  "deepseek/haiku": 22e-4,
  // ── Google Gemini ────────────────────────────────────────
  "google/gemini-2.5-pro": 39e-4,
  "google/gemini-2.5-flash": 96e-5,
  "google/gemini-2.0-flash": 19e-5,
  "google/gemini-3-pro-preview": 5e-3,
  "google/gemini-3-1-pro-preview": 5e-3,
  "google/gemini-3-pro": 5e-3,
  "google/gemini-3-1-pro": 5e-3,
  "google/gemini-3-pro-image-preview": 5e-3,
  "google/gemini-3-flash-preview": 125e-5,
  "google/gemini-3-5-flash-preview": 125e-5,
  "google/gemini-3-flash": 125e-5,
  "google/gemini-3-5-flash": 125e-5,
  // ── OpenAI ───────────────────────────────────────────────
  "openai/gpt-4o": 475e-5,
  "openai/gpt-4.1": 38e-4,
  "openai/gpt-4o-mini": 29e-5,
  "openai/gpt-4.1-mini": 19e-5,
  "openai/o3": 38e-4,
  "openai/o4-mini": 21e-4,
  // ── OpenCode Go ─────────────────────────────
  "opencode-go/glm-5.1": 23e-4,
  "opencode-go/glm-5": 166e-5,
  "opencode-go/kimi-k2.6": 187e-5,
  "opencode-go/kimi-k2.5": 132e-5,
  "opencode-go/mimo-v2.5": 182e-6,
  "opencode-go/mimo-v2.5-pro": 226e-5,
  "opencode-go/minimax-m3": 114e-5,
  "opencode-go/minimax-m2.7": 57e-5,
  "opencode-go/minimax-m2.5": 57e-5,
  "opencode-go/qwen3.7-max": 4e-3,
  "opencode-go/qwen3.7-plus": 76e-5,
  "opencode-go/qwen3.6-plus": 125e-5,
  // ── OpenCode Zen (bare model names, opencode/ prefix stripped by normalizeModelId) ──
  "minimax-m2.7": 57e-5,
  "minimax-m2.5": 57e-5,
  "glm-5.1": 23e-4,
  "glm-5": 166e-5,
  "kimi-k2.5": 132e-5,
  "kimi-k2.6": 187e-5,
  "qwen3.7-max": 4e-3,
  "qwen3.7-plus": 76e-5,
  "qwen3.6-plus": 125e-5,
  "qwen3.5-plus": 5e-4,
  "deepseek-v4-flash": 182e-6,
  "grok-build-0.1": 13e-4,
  "claude-opus-4-8": 0.011,
  "claude-opus-4-7": 0.011,
  "claude-opus-4-6": 0.011,
  "claude-opus-4-5": 0.011,
  "claude-opus-4-1": 0.033,
  "claude-sonnet-4-6": 66e-4,
  "claude-sonnet-4-5": 66e-4,
  "claude-sonnet-4": 66e-4,
  "claude-haiku-4-5": 22e-4,
  "gemini-3.5-flash": 375e-5,
  "gemini-3.1-pro": 5e-3,
  "gemini-3-flash": 125e-5,
  "gpt-5.5": 0.0125,
  "gpt-5.5-pro": 0.075,
  "gpt-5.4": 625e-5,
  "gpt-5.4-pro": 0.075,
  "gpt-5.4-mini": 188e-5,
  "gpt-5.4-nano": 52e-5,
  "gpt-5.3-codex-spark": 543e-5,
  "gpt-5.3-codex": 543e-5,
  "gpt-5.2": 543e-5,
  "gpt-5.2-codex": 543e-5,
  "gpt-5.1": 33e-4,
  "gpt-5.1-codex": 33e-4,
  "gpt-5.1-codex-max": 388e-5,
  "gpt-5.1-codex-mini": 78e-5,
  "gpt-5": 33e-4,
  "gpt-5-codex": 33e-4,
  "gpt-5-nano": 16e-5
};
var _pricingOverridesCache = null;
var _pricingOverridesLoadedAt = 0;
var _pricingOverridesHome = "";
var TURN_BLEND_INPUT_TOKENS = 700;
var TURN_BLEND_OUTPUT_TOKENS = 300;
var _dynamicPricingCache = null;
var _dynamicPricingCacheLoadedAt = 0;
var _dynamicPricingCacheHome = "";
function _loadDynamicPricingCache() {
  const home = getVibeOSHome4();
  const now = Date.now();
  if (_dynamicPricingCache && _dynamicPricingCacheHome === home && now - _dynamicPricingCacheLoadedAt < 1e4)
    return _dynamicPricingCache;
  _dynamicPricingCacheLoadedAt = now;
  _dynamicPricingCacheHome = home;
  const PRICING_CACHE_FILE2 = join5(home, "model-pricing-cache.json");
  try {
    if (!existsSync6(PRICING_CACHE_FILE2))
      return {};
    const st = statSync5(PRICING_CACHE_FILE2);
    if (st.size > 10485760) {
      _handleStateCorruption2(PRICING_CACHE_FILE2);
      _dynamicPricingCache = {};
      return {};
    }
    const raw = safeJsonParse2(readFileSync5(PRICING_CACHE_FILE2, "utf-8"));
    const map = raw?.models && typeof raw.models === "object" ? raw.models : {};
    _dynamicPricingCache = map;
  } catch {
    _handleStateCorruption2(PRICING_CACHE_FILE2);
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
  const PRICING_CACHE_FILE2 = join5(getVibeOSHome4(), "model-pricing-cache.json");
  try {
    withFileLock2(PRICING_CACHE_FILE2, () => {
      mkdirSync5(dirname5(PRICING_CACHE_FILE2), { recursive: true });
      let merged = {};
      try {
        if (existsSync6(PRICING_CACHE_FILE2)) {
          const raw = safeJsonParse2(readFileSync5(PRICING_CACHE_FILE2, "utf-8"));
          const existing = raw?.models && typeof raw.models === "object" ? raw.models : {};
          merged = { ...existing };
        }
      } catch {
      }
      merged = { ...merged, ...modelsMap };
      const tmp = PRICING_CACHE_FILE2 + ".tmp";
      writeFileSync6(tmp, JSON.stringify({
        ts: Date.now(),
        source: "dynamic-model-pricing",
        models: merged
      }, null, 2) + "\n");
      renameSync4(tmp, PRICING_CACHE_FILE2);
    });
    _dynamicPricingCache = { ..._loadDynamicPricingCache(), ...modelsMap };
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
function _loadPricingOverrides() {
  const home = getVibeOSHome4();
  const now = Date.now();
  if (_pricingOverridesCache && _pricingOverridesHome === home && now - _pricingOverridesLoadedAt < 1e4)
    return _pricingOverridesCache;
  _pricingOverridesLoadedAt = now;
  _pricingOverridesHome = home;
  try {
    const tiersFile = join5(home, "model-tiers.json");
    if (!existsSync6(tiersFile))
      return {};
    const st = statSync5(tiersFile);
    if (st.size > 10485760) {
      _handleStateCorruption2(tiersFile);
      _pricingOverridesCache = {};
      return {};
    }
    const raw = safeJsonParse2(readFileSync5(tiersFile, "utf-8"));
    const models = raw?.pricing?.models && typeof raw.pricing.models === "object" ? raw.pricing.models : {};
    const out = {};
    for (const [key, value] of Object.entries(models)) {
      let cost = null;
      if (typeof value === "number") {
        cost = value;
      } else if (value && typeof value === "object") {
        const candidate = value.turn_usd ?? value.cost_per_turn ?? value.usd_per_turn ?? value.usd ?? value.cost;
        const n = Number(candidate);
        if (Number.isFinite(n))
          cost = n;
      }
      if (!Number.isFinite(cost))
        continue;
      const rawKey = String(key || "").trim();
      if (!rawKey)
        continue;
      const normalized = normalizeModelId(rawKey);
      out[rawKey] = cost;
      out[normalized] = cost;
      const bare = rawKey.includes("/") ? rawKey.split("/").pop() : rawKey;
      if (bare)
        out[bare] = cost;
    }
    _pricingOverridesCache = out;
  } catch {
    _handleStateCorruption2(join5(home, "model-tiers.json"));
    _pricingOverridesCache = {};
  }
  return _pricingOverridesCache;
}
function modelCostPerTurn(model) {
  if (!model)
    return 0;
  const dyn = _dynamicCostFor(model);
  if (dyn != null)
    return dyn;
  const key = normalizeModelId(model);
  if (key.endsWith("-free"))
    return FREE_MODEL_TURN_USD;
  const overrides = _loadPricingOverrides();
  if (Object.prototype.hasOwnProperty.call(overrides, key))
    return overrides[key];
  if (Object.prototype.hasOwnProperty.call(overrides, model))
    return overrides[model];
  const bare = String(model || "").includes("/") ? String(model).split("/").pop() : String(model || "");
  if (bare && Object.prototype.hasOwnProperty.call(overrides, bare))
    return overrides[bare];
  const map = _getNormalizedCostMap();
  if (Object.prototype.hasOwnProperty.call(map, key))
    return map[key];
  for (const [k, v] of Object.entries(map)) {
    if (key.startsWith(k) && /-\d+$/.test(k) && key.charAt(k.length) === "-")
      return v;
  }
  for (const candidate of [model, key, bare]) {
    const pricing = MODEL_PRICING_PER_1M[candidate];
    if (pricing && Number.isFinite(pricing.input) && Number.isFinite(pricing.output)) {
      const blended = (pricing.input * 700 + pricing.output * 300) / 1e6;
      return Number.isFinite(blended) ? blended : FREE_MODEL_TURN_USD;
    }
  }
  console.error(`[vibeOS] modelCostPerTurn: unknown model '${model}' (normalized: '${key}') \u2014 add to MODEL_USD_PER_TURN`);
  const tier = classify(model);
  const TIER_FALLBACK = { high: 0.01175, mid: 66e-4, budget: 144e-5 };
  return TIER_FALLBACK[tier] ?? 144e-5;
}
function isModelFree(model) {
  if (!model || typeof model !== "string")
    return false;
  if (FREE_MODELS.has(model))
    return true;
  if (FREE_MODELS.has(normalizeModelId(model)))
    return true;
  const cost = modelCostPerTurn(model);
  return cost <= FREE_MODEL_TURN_USD;
}
var CONTEXT7_CONFIG_FILES = [
  join5(getVibeOSHome4(), "settings.json"),
  join5(getVibeOSHome4(), ".claude.json"),
  join5(getOpenCodeHome(), "opencode.json"),
  join5(process.cwd(), "opencode.json")
];
function _scanOpenCodeConfigs(baseDir) {
  try {
    if (!existsSync6(baseDir))
      return;
    for (const entry of readdirSync2(baseDir)) {
      if (!entry.endsWith(".json"))
        continue;
      const full = join5(baseDir, entry);
      if (existsSync6(full) && /context7/i.test(readFileSync5(full, "utf-8")))
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
        if (existsSync6(join5(dir, "context7")))
          return true;
        if (existsSync6(join5(dir, "context7.cmd")))
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
    const npxDir = join5(USER_HOME3, ".npm/_npx");
    if (!existsSync6(npxDir))
      return false;
    for (const hashDir of readdirSync2(npxDir)) {
      const ctxDir = join5(npxDir, hashDir, "node_modules", "context7");
      try {
        if (existsSync6(join5(ctxDir, "package.json")))
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
      if (existsSync6(f) && /context7/i.test(readFileSync5(f, "utf-8")))
        return true;
    } catch {
    }
  }
  if (_scanOpenCodeConfigs(getOpenCodeHome()))
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
function loadSelection2() {
  const TIERS_FILE3 = join5(getVibeOSHome4(), "model-tiers.json");
  try {
    if (!existsSync6(TIERS_FILE3))
      return DFLT_SEL2;
    const st = statSync5(TIERS_FILE3);
    if (st.size > 10485760) {
      _handleStateCorruption2(TIERS_FILE3);
      return DFLT_SEL2;
    }
    const j = safeJsonParse2(readFileSync5(TIERS_FILE3, "utf-8"));
    return {
      enabled: j?.selection?.enabled !== false,
      active_slot: j?.selection?.active_slot || null,
      slot_locked: j?.selection?.slot_locked === true,
      thinking_level: j?.selection?.thinking_level || "off",
      flow_enabled: j?.selection?.flow_enabled === true,
      tdd_enforce: j?.selection?.tdd_enforce === true,
      tdd_strict: j?.selection?.tdd_strict === true,
      tdd_quality: j?.selection?.tdd_quality !== false,
      flow_enforce: j?.selection?.flow_enforce === true,
      delegation_enforce: true,
      selected_provider: j?.selection?.selected_provider || null,
      selected_quality_tier: j?.selection?.selected_quality_tier || null,
      selected_model: j?.selection?.selected_model || null,
      executed_provider: j?.selection?.executed_provider || null,
      executed_quality_tier: j?.selection?.executed_quality_tier || null,
      executed_model: j?.selection?.executed_model || null
    };
  } catch {
    _handleStateCorruption2(TIERS_FILE3);
    return DFLT_SEL2;
  }
}
var DFLT_SEL2 = { enabled: true, active_slot: null, slot_locked: false, thinking_level: "off", flow_enabled: true, tdd_enforce: false, tdd_strict: false, tdd_quality: true, flow_enforce: true, delegation_enforce: true, selected_provider: null, selected_quality_tier: null, selected_model: null, executed_provider: null, executed_quality_tier: null, executed_model: null };
function readConfig(dir) {
  try {
    const configs = [];
    const projectCfg = readOpenCodeConfigObject(dir);
    if (projectCfg && typeof projectCfg === "object")
      configs.push(projectCfg);
    const homeDir = getOpenCodeHome();
    if (dir !== homeDir) {
      const homeCfg = readOpenCodeConfigObject(homeDir);
      if (homeCfg && typeof homeCfg === "object")
        configs.push(homeCfg);
    }
    const workspaceModel = readWorkspaceSessionModel(dir);
    if (workspaceModel)
      return resolveConfiguredModelId(workspaceModel, configs) || workspaceModel;
    const selectedCfg = configs[0] || {};
    const selectedModel = selectedCfg?.agent?.build?.model || selectedCfg?.model || "";
    return resolveConfiguredModelId(selectedModel, configs);
  } catch {
    return "";
  }
}
function readWorkspaceSessionModel(directory3 = "") {
  const sid = readLatestOpenCodeSessionId(directory3);
  if (!sid)
    return "";
  const roots = [getOpenCodeDesktopHome(), getOpenCodeHome()];
  for (const root of roots) {
    try {
      if (!existsSync6(root) || !statSync5(root).isDirectory())
        continue;
      const files = readdirSync2(root).filter((name) => /^opencode\.workspace\..*\.dat$/i.test(name)).map((name) => join5(root, name)).sort((a, b) => statSync5(b).mtimeMs - statSync5(a).mtimeMs);
      for (const file of files) {
        try {
          const raw = readFileSync5(file, "utf-8");
          if (!raw.includes(sid) || !raw.includes("workspace:model-selection"))
            continue;
          const match = raw.match(/"workspace:model-selection"\s*:\s*"((?:\\.|[^"\\])*)"/s);
          if (!match)
            continue;
          const decoded = JSON.parse(`"${match[1]}"`);
          const parsed = safeJsonParse2(decoded);
          const session = parsed?.session?.[sid];
          const providerID = String(session?.model?.providerID || "").trim();
          const modelID = String(session?.model?.modelID || "").trim();
          if (providerID && modelID)
            return `${providerID}/${modelID}`;
          if (modelID)
            return modelID;
        } catch {
        }
      }
    } catch {
    }
  }
  return "";
}
function clearWorkspaceFollowupPauseForSession(sessionId = "") {
  let changed = false;
  const sid = String(sessionId || "").trim();
  const latestSid = String(readLatestOpenCodeSessionId() || "").trim();
  const candidates = [...new Set([sid, latestSid].filter(Boolean))];
  if (candidates.length === 0)
    return false;
  const roots = [getOpenCodeDesktopHome(), getOpenCodeHome()];
  for (const root of roots) {
    try {
      if (!existsSync6(root) || !statSync5(root).isDirectory())
        continue;
      const files = readdirSync2(root).filter((name) => /^opencode\.workspace\..*\.dat$/i.test(name)).map((name) => join5(root, name)).sort((a, b) => statSync5(b).mtimeMs - statSync5(a).mtimeMs);
      for (const file of files) {
        try {
          const outer = safeJsonParse2(readFileSync5(file, "utf-8"));
          const followupRaw = outer?.["workspace:followup"];
          const followup = typeof followupRaw === "string" ? safeJsonParse2(followupRaw) : followupRaw;
          if (!followup || typeof followup !== "object" || !followup.paused)
            continue;
          let touched = false;
          for (const candidate of candidates) {
            if (followup.paused[candidate]) {
              delete followup.paused[candidate];
              touched = true;
            }
          }
          if (!touched)
            continue;
          outer["workspace:followup"] = JSON.stringify(followup);
          writeFileSync6(file, JSON.stringify(outer, null, 2) + "\n");
          changed = true;
        } catch {
        }
      }
    } catch {
    }
  }
  return changed;
}
function readLatestOpenCodeSessionId(directory3 = "") {
  try {
    const globalPath = join5(getOpenCodeDesktopHome(), "opencode.global.dat");
    if (!existsSync6(globalPath))
      return "";
    const st = statSync5(globalPath);
    if (!st.isFile() || st.size > 10485760)
      return "";
    const raw = safeJsonParse2(readFileSync5(globalPath, "utf-8"));
    const notifications = typeof raw?.notification === "string" ? safeJsonParse2(raw.notification) : raw?.notification;
    const list = Array.isArray(notifications?.list) ? notifications.list : [];
    const targetDir = directory3 ? resolve(directory3) : "";
    const rows = list.filter((entry) => {
      const entryDir = String(entry?.directory || "").trim();
      const session = String(entry?.session || "").trim();
      if (!entryDir || !session)
        return false;
      if (!targetDir)
        return true;
      try {
        return resolve(entryDir) === targetDir;
      } catch {
        return entryDir === targetDir;
      }
    });
    rows.sort((a, b) => Number(b?.time || 0) - Number(a?.time || 0));
    return String(rows[0]?.session || "").trim();
  } catch {
    return "";
  }
}
function parseJsonc(raw) {
  const noBlockComments = String(raw || "").replace(/\/\*[\s\S]*?\*\//g, "");
  const noLineComments = noBlockComments.replace(/(^|\s)\/\/.*$/gm, "$1");
  const noTrailingCommas = noLineComments.replace(/,\s*([}\]])/g, "$1");
  return safeJsonParse2(noTrailingCommas);
}
function readOpenCodeConfigObject(dir) {
  const jsonPath = join5(dir, "opencode.json");
  const jsoncPath = join5(dir, "opencode.jsonc");
  if (existsSync6(jsonPath)) {
    return safeJsonParse2(readFileSync5(jsonPath, "utf-8"));
  }
  if (existsSync6(jsoncPath)) {
    return parseJsonc(readFileSync5(jsoncPath, "utf-8"));
  }
  return {};
}
function collectConfiguredProviderModelsFromConfig(cfg) {
  const out = [];
  const providers = cfg && typeof cfg === "object" ? cfg?.provider || {} : {};
  for (const [providerName, providerCfg] of Object.entries(providers)) {
    const models = providerCfg?.models || {};
    for (const rawId of Object.keys(models)) {
      const id2 = String(rawId || "").trim();
      if (!id2)
        continue;
      out.push(id2.includes("/") ? id2 : `${providerName}/${id2}`);
    }
  }
  return out;
}
function resolveConfiguredModelId(model, configs = []) {
  const raw = String(model || "").trim();
  if (!raw)
    return "";
  if (raw.includes("/"))
    return raw;
  const normalized = normalizeModelId(raw);
  const matches = /* @__PURE__ */ new Set();
  for (const cfg of configs) {
    for (const id2 of collectConfiguredProviderModelsFromConfig(cfg)) {
      const bare = String(id2 || "").includes("/") ? String(id2).split("/").pop() : id2;
      if (normalizeModelId(id2) === normalized || normalizeModelId(bare) === normalized)
        matches.add(id2);
    }
  }
  if (matches.size === 0) {
    for (const cfg of configs) {
      for (const id2 of collectConfiguredProviderModelsFromConfig(cfg)) {
        const bare = String(id2 || "").includes("/") ? String(id2).split("/").pop() : id2;
        const nb = normalizeModelId(bare);
        if (nb.includes(normalized) || normalized.includes(nb))
          matches.add(id2);
      }
    }
  }
  if (matches.size === 0)
    return "";
  if (matches.size === 1)
    return [...matches][0];
  const qualified = [...matches].find((m) => m.includes("/"));
  return qualified || raw;
}
function resolveDisplayModelId(model, directory3 = "") {
  const raw = String(model || "").trim();
  if (!raw)
    return "";
  if (raw.includes("/"))
    return raw;
  const configs = [];
  const projectCfg = readOpenCodeConfigObject(directory3);
  if (projectCfg && typeof projectCfg === "object")
    configs.push(projectCfg);
  const homeDir = getOpenCodeHome();
  const homeCfg = readOpenCodeConfigObject(homeDir);
  if (homeCfg && typeof homeCfg === "object")
    configs.push(homeCfg);
  return resolveConfiguredModelId(raw, configs);
}
function _setTrinitySlotsFromTiers(tiersData) {
  const brain = String(tiersData?.trinity?.brain?.oc || "").trim();
  const medium = String(tiersData?.trinity?.medium?.oc || "").trim();
  const cheap = String(tiersData?.trinity?.cheap?.oc || "").trim();
  setTrinityBrain(brain && !PLACEHOLDER_RE.test(brain) ? brain : null);
  setTrinityMedium(medium && !PLACEHOLDER_RE.test(medium) ? medium : null);
  setTrinityCheap(cheap && !PLACEHOLDER_RE.test(cheap) ? cheap : null);
  return { brain: TRINITY_BRAIN, medium: TRINITY_MEDIUM, cheap: TRINITY_CHEAP };
}
function loadTrinitySlotsFromTiersFile() {
  try {
    const TIERS_FILE3 = join5(getVibeOSHome4(), "model-tiers.json");
    if (!existsSync6(TIERS_FILE3))
      return false;
    const st = statSync5(TIERS_FILE3);
    if (st.size > 10485760) {
      _handleStateCorruption2(TIERS_FILE3);
      return false;
    }
    const tiersData = safeJsonParse2(readFileSync5(TIERS_FILE3, "utf-8")) || {};
    _setTrinitySlotsFromTiers(tiersData);
    return true;
  } catch {
    return false;
  }
}
var PLACEHOLDER_RE = /^[^/]+\/[a-z-]+-model$/i;
function getTrinitySlotOrder(tiersData = null) {
  const configured = Array.isArray(tiersData?.selection?.slot_order) ? tiersData.selection.slot_order : null;
  const valid = (configured || []).map((slot) => String(slot || "").trim()).filter(Boolean);
  return valid.length > 0 ? valid : DEFAULT_TRINITY_SLOTS;
}
function _refreshModel(directory3) {
  try {
    const TIERS_FILE3 = join5(getVibeOSHome4(), "model-tiers.json");
    const sel = loadSelection2();
    if (!sel.enabled)
      return;
    const tiersData = safeJsonParse2(readFileSync5(TIERS_FILE3, "utf-8"));
    _setTrinitySlotsFromTiers(tiersData);
    const slotOrder = getTrinitySlotOrder(tiersData);
    const activeSlot = slotOrder.includes(sel.active_slot) ? sel.active_slot : slotOrder[0] || "brain";
    let slotOcModel = tiersData?.trinity?.[activeSlot]?.oc || "";
    if (slotOcModel && PLACEHOLDER_RE.test(slotOcModel)) {
      slotOcModel = "";
      if (DEBUG_INTERNALS)
        console.error(`[vibeOS] placeholder model detected in ${activeSlot} slot \u2014 skipping, will auto-detect`);
    }
    if (slotOcModel) {
      const nextTier = activeSlot === (slotOrder[0] || "brain") ? "high" : classify(slotOcModel);
      const modelChanged = currentModel !== slotOcModel;
      const tierChanged = currentTier !== nextTier;
      if (modelChanged || tierChanged) {
        const oldModel = currentModel;
        const oldTier = currentTier;
        setCurrentModel(slotOcModel);
        setCurrentTier(nextTier);
        if (DEBUG_INTERNALS)
          console.error(`[vibeOS] model refresh: ${oldModel}(${oldTier}) \u2192 ${currentModel}(${currentTier}) (slot=${activeSlot})`);
      }
    }
    if (!currentModel) {
      const detected = readConfig(directory3) || readConfig(getOpenCodeHome()) || process?.env?.OPENCODE_MODEL || "";
      if (detected) {
        setCurrentModel(detected);
        setCurrentTier(classify(detected));
        if (DEBUG_INTERNALS)
          console.error(`[vibeOS] auto-detected model: ${currentModel} (tier=${currentTier})`);
      }
    }
    if (!(_modelLocked || sel.slot_locked === true)) {
      const activeIsManual = tiersData?.trinity?.[activeSlot]?.manual === true;
      const currentSlotModel = activeIsManual ? "" : slotOcModel;
      if (!currentSlotModel) {
        const cfgModel = readConfig(directory3) || readConfig(getOpenCodeHome()) || "";
        if (cfgModel && cfgModel.includes("/") && cfgModel !== currentModel) {
          const oldModel = currentModel;
          const oldTier = currentTier;
          setCurrentModel(cfgModel);
          setCurrentTier(classify(cfgModel));
          if (DEBUG_INTERNALS)
            console.error(`[vibeOS] model refresh (config fallback): ${oldModel}(${oldTier}) \u2192 ${currentModel}(${currentTier})`);
          try {
            if (existsSync6(TIERS_FILE3)) {
              withFileLock2(TIERS_FILE3, () => {
                const t = safeJsonParse2(readFileSync5(TIERS_FILE3, "utf-8"));
                for (const s of getTrinitySlotOrder(t)) {
                  if (t?.trinity?.[s]?.oc === cfgModel) {
                    t.selection.active_slot = s;
                    const _tmp = TIERS_FILE3 + ".tmp." + Date.now() + "." + Math.random().toString(36).slice(2, 8);
                    writeFileSync6(_tmp, JSON.stringify(t, null, 2) + "\n", "utf-8");
                    renameSync4(_tmp, TIERS_FILE3);
                    if (DEBUG_INTERNALS)
                      console.error(`[vibeOS] model refresh (config fallback): synced active_slot \u2192 ${s}`);
                    break;
                  }
                }
              });
            }
          } catch {
          }
        }
      }
    }
  } catch {
  }
}
function applySlot2(slot, projectDir = "") {
  try {
    const TIERS_FILE3 = join5(getVibeOSHome4(), "model-tiers.json");
    return withFileLock2(TIERS_FILE3, () => {
      const j = safeJsonParse2(readFileSync5(TIERS_FILE3, "utf-8"));
      const ocModel = j?.trinity?.[slot]?.oc;
      if (!ocModel)
        return { ok: false, reason: `slot '${slot}' has no oc model` };
      j.selection.active_slot = slot;
      const _tmp = TIERS_FILE3 + ".tmp." + Date.now();
      writeFileSync6(_tmp, JSON.stringify(j, null, 2) + "\n", "utf-8");
      renameSync4(_tmp, TIERS_FILE3);
      const dir = projectDir || process.cwd();
      const localOcConfig = join5(dir, "opencode.json");
      const ocConfig = existsSync6(localOcConfig) ? localOcConfig : join5(getOpenCodeHome(), "opencode.json");
      if (existsSync6(ocConfig)) {
        const oc = safeJsonParse2(readFileSync5(ocConfig, "utf-8"));
        oc.model = ocModel;
        writeFileSync6(ocConfig, JSON.stringify(oc, null, 2) + "\n");
      }
      _refreshModel(dir);
      return { ok: true, ocModel };
    });
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// src/lib/turn-classify.js
import { readFileSync as readFileSync8, writeFileSync as writeFileSync9, existsSync as existsSync9, mkdirSync as mkdirSync8, renameSync as renameSync5 } from "node:fs";
import { join as join7, dirname as dirname8 } from "node:path";

// src/vibeOS-lib/blackbox/resolution-tracker.js
var ResolutionTracker = class _ResolutionTracker {
  static SUB_REGIMES = ["INIT", "DIVERGENT", "EXPLORING", "REFINING", "IMPLEMENTING", "RESEARCH", "REVIEWING", "DESIGNING", "CONVERGING", "CLOSED", "LOOPING"];
  sessionId;
  maxHistory;
  history;
  loopCount;
  pivotHistory;
  outcomeHistory;
  calibratedWeights;
  constructor(sessionId, maxHistory = 10) {
    this.sessionId = sessionId;
    this.maxHistory = maxHistory;
    this.history = [];
    this.loopCount = 0;
    this.pivotHistory = [];
    this.outcomeHistory = [];
    this.calibratedWeights = null;
    this.recentMessageLengths = [];
  }
  static extractFeatures(text) {
    if (!text || typeof text !== "string")
      return {};
    const len = text.length;
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    const wordCount = words.length;
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const sentenceCount = sentences.length;
    const avgWordLen = wordCount > 0 ? words.reduce((sum, word) => sum + word.length, 0) / wordCount : 0;
    const questions = (text.match(/\?/g) || []).length;
    const questionRatio = sentenceCount > 0 ? questions / sentenceCount : 0;
    const codeBlocks = (text.match(/```/g) || []).length / 2;
    const urgency = /urgent|asap|immediately|critical|broken|failing|crash|error|bug/i.test(text) ? 1 : 0;
    const repetition = wordCount > 5 ? (text.toLowerCase().match(/(\b\w+\b).*?\1/g) || []).length / wordCount : 0;
    const sentimentInds = /thanks|great|perfect|awesome/i.test(text) ? 0.2 : /frustrat|annoy|not working|doesn't work|stupid|useless/i.test(text) ? 0.8 : 0.5;
    const complexity = /complex|difficult|hard|confusing|trick|subtle|nuance/i.test(text) ? 1 : 0;
    const instructionDensity = /do not|must|should|always|never|critical/i.test(text) ? 1 : /please|could you|maybe|perhaps/i.test(text) ? 0.3 : 0.6;
    return {
      length: Math.min(1, len / 5e3),
      word_count: Math.min(1, wordCount / 500),
      sentence_count: Math.min(1, sentenceCount / 50),
      avg_word_length: Math.min(1, avgWordLen / 10),
      question_ratio: Math.min(1, questionRatio),
      code_blocks: Math.min(1, codeBlocks / 5),
      urgency,
      repetition: Math.min(1, repetition * 10),
      sentiment: sentimentInds,
      complexity,
      instruction_density: instructionDensity
    };
  }
  normalizeText(text) {
    return (text || "").toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
  }
  normalizeActivity(activity, action, text) {
    const fallbackSignature = this.normalizeText(action || text || "");
    if (!activity) {
      return {
        signature: fallbackSignature || "",
        tool: null,
        target: null,
        action: action || null,
        repeat_count: 1,
        outcome: null
      };
    }
    if (typeof activity === "string") {
      const sig = this.normalizeText(activity);
      return {
        signature: sig || fallbackSignature || "",
        tool: null,
        target: null,
        action: action || null,
        repeat_count: 1,
        outcome: null
      };
    }
    const tool2 = this.normalizeText(activity.tool || activity.toolName || activity.kind || "");
    const target = this.normalizeText(activity.target || activity.filePath || activity.file_path || activity.path || activity.command || "");
    const normalizedAction = this.normalizeText(activity.action || activity.kind || action || "");
    const signature = this.normalizeText(activity.signature || [tool2, target, normalizedAction, activity.outcome || ""].filter(Boolean).join(" "));
    return {
      signature: signature || fallbackSignature || "",
      tool: tool2 || null,
      target: target || null,
      action: normalizedAction || action || null,
      repeat_count: Number(activity.repeat_count || activity.repeatCount || 1) || 1,
      outcome: typeof activity.outcome === "string" ? activity.outcome : activity.outcome ?? null
    };
  }
  getRepeatStreak() {
    if (this.history.length < 2)
      return 0;
    const lastWords = new Set(this.history[this.history.length - 1].text.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    if (lastWords.size === 0)
      return 0;
    let streak = 1;
    for (let i = this.history.length - 2; i >= 0; i--) {
      const currWords = new Set(this.history[i].text.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
      if (currWords.size === 0)
        break;
      const intersection = new Set([...lastWords].filter((w) => currWords.has(w)));
      const union = /* @__PURE__ */ new Set([...lastWords, ...currWords]);
      const jaccard = intersection.size / Math.max(union.size, 1);
      if (jaccard < 0.7)
        break;
      streak++;
    }
    return streak;
  }
  getActivityRepeatStreak() {
    if (this.history.length < 2)
      return 0;
    const normalizedLast = this.normalizeActivity(this.history[this.history.length - 1].activity, this.history[this.history.length - 1].action, this.history[this.history.length - 1].text).signature;
    if (!normalizedLast)
      return 0;
    let streak = 1;
    for (let i = this.history.length - 2; i >= 0; i--) {
      const normalized = this.normalizeActivity(this.history[i].activity, this.history[i].action, this.history[i].text).signature;
      if (!normalized || normalized !== normalizedLast)
        break;
      streak++;
    }
    return streak;
  }
  getTargetRepeatStreak() {
    if (this.history.length < 2)
      return 0;
    const normalizedLast = this.normalizeActivity(this.history[this.history.length - 1].activity, this.history[this.history.length - 1].action, this.history[this.history.length - 1].text).target;
    if (!normalizedLast)
      return 0;
    let streak = 1;
    for (let i = this.history.length - 2; i >= 0; i--) {
      const normalized = this.normalizeActivity(this.history[i].activity, this.history[i].action, this.history[i].text).target;
      if (!normalized || normalized !== normalizedLast)
        break;
      streak++;
    }
    return streak;
  }
  getRecentNegativeOutcomeStreak() {
    if (this.outcomeHistory.length < 1)
      return 0;
    let streak = 0;
    for (let i = this.outcomeHistory.length - 1; i >= 0; i--) {
      const o = this.outcomeHistory[i];
      if (/negative|failed|unresolved|loop_detected/i.test(String(o?.outcome || "")))
        streak++;
      else
        break;
    }
    return streak;
  }
  computeMessageLengthTrend() {
    const lengths = this.recentMessageLengths;
    if (lengths.length < 3)
      return { trend: "stable", slope: 0 };
    const pairs = lengths.slice(-4);
    let decreasingCount = 0;
    let totalSlope = 0;
    for (let i = 1; i < pairs.length; i++) {
      const diff = pairs[i] - pairs[i - 1];
      if (diff < 0)
        decreasingCount++;
      totalSlope += diff;
    }
    const ratio = decreasingCount / (pairs.length - 1);
    const avgSlope = pairs.length > 1 ? totalSlope / (pairs.length - 1) : 0;
    return {
      trend: ratio >= 0.6 && avgSlope < 0 ? "shortening" : "stable",
      slope: avgSlope
    };
  }
  update(userText, features, action, entropy, uncertainty, embedding = null, activity = null) {
    const normalizedActivity = this.normalizeActivity(activity, action, userText);
    const entry = {
      text: userText,
      features: { ...features },
      action,
      entropy,
      uncertainty,
      embedding: embedding ? [...embedding] : null,
      activity: normalizedActivity,
      timestamp: Date.now() / 1e3
    };
    if (this.history.length >= 2) {
      entry.is_pivot = this.detectPivotSignal(entry, this.history[this.history.length - 1]);
      if (entry.is_pivot) {
        this.pivotHistory.push(this.history.length);
      }
    }
    this.history.push(entry);
    this.recentMessageLengths.push((userText || "").length);
    if (this.recentMessageLengths.length > 6)
      this.recentMessageLengths.shift();
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    const state = this.computeState();
    if (state.is_looping) {
      this.loopCount++;
      this.history[this.history.length - 1].outcome = this.history[this.history.length - 1].outcome || "loop_detected";
    } else if (state.sub_regime !== "LOOPING") {
      this.loopCount = Math.max(0, this.loopCount - 1);
    }
    return state;
  }
  detectPivotSignal(current, previous) {
    if (!current.embedding || !previous.embedding) {
      const currWords = new Set((current.text || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3));
      const prevWords = new Set((previous.text || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3));
      if (currWords.size === 0 || prevWords.size === 0)
        return false;
      const intersection = new Set([...currWords].filter((w) => prevWords.has(w)));
      const union = /* @__PURE__ */ new Set([...currWords, ...prevWords]);
      const jaccardSim = intersection.size / Math.max(union.size, 1);
      const instructionChange2 = Math.abs((current.features?.instruction_density || 0.6) - (previous.features?.instruction_density || 0.6));
      const lengthRatio2 = previous.text.length > 0 ? Math.abs(current.text.length - previous.text.length) / previous.text.length : 0;
      const actionChange = current.action !== previous.action ? 0.3 : 0;
      const pivotScore2 = (1 - jaccardSim) * 0.4 + instructionChange2 * 0.2 + Math.min(lengthRatio2, 1) * 0.2 + actionChange * 0.2;
      return pivotScore2 > 0.45;
    }
    const embeddingDelta = 1 - cosineSimilarity2(current.embedding, previous.embedding);
    const drift = this.history.length >= 4 ? this.computeIntentState().drift_rate : 0;
    const repeatRatio = current.features?.repetition || 0;
    const instructionChange = Math.abs((current.features?.instruction_density || 0.6) - (previous.features?.instruction_density || 0.6));
    const lengthRatio = previous.text.length > 0 ? Math.abs(current.text.length - previous.text.length) / previous.text.length : 0;
    const pivotScore = drift * 0.2 + embeddingDelta * 0.35 + repeatRatio * 0.1 + instructionChange * 0.15 + lengthRatio * 0.2;
    return pivotScore > 0.4;
  }
  computeState() {
    const n = this.history.length;
    if (n < 1) {
      return {
        sub_regime: "INIT",
        resolution: "unresolved",
        momentum: 0,
        signals: { action_consistency: 1, entropy_trend: 0, feature_contradiction: 0, embedding_delta: 0 },
        intent_state: { volatility_score: 0, drift_rate: 0, core_goal_embedding: null },
        continuity_state: "HIGH",
        is_looping: false,
        loop_consecutive: 0,
        loop_intervention_level: "none",
        pivot_detected: false,
        pivot_score: 0,
        outcome: null,
        n_interactions: 0
      };
    }
    const actionConsistency = this.calcActionConsistency();
    const entropyTrend = this.calcEntropyTrend();
    const featureContradiction = this.calcFeatureContradiction();
    const embeddingDelta = this.calcEmbeddingDelta();
    const repeatStreak = this.getRepeatStreak();
    const activityRepeatStreak = this.getActivityRepeatStreak();
    const targetRepeatStreak = this.getTargetRepeatStreak();
    const isLooping = this.detectLoop();
    const intentState = this.computeIntentState();
    const continuityState = this.continuityState(intentState);
    let subRegime;
    if (n === 1) {
      subRegime = "INIT";
    } else if (isLooping) {
      subRegime = "LOOPING";
    } else if (this.isClosed(actionConsistency, embeddingDelta, featureContradiction)) {
      subRegime = "CLOSED";
    } else if (this.isDivergent(entropyTrend, featureContradiction, actionConsistency)) {
      subRegime = "DIVERGENT";
    } else if (this.isExploring(featureContradiction, entropyTrend, actionConsistency)) {
      subRegime = "EXPLORING";
    } else if (this.isRefining(featureContradiction, embeddingDelta, actionConsistency, entropyTrend)) {
      subRegime = "REFINING";
    } else if (this.isConverging(actionConsistency, embeddingDelta, entropyTrend)) {
      subRegime = "CONVERGING";
    } else {
      subRegime = "EXPLORING";
    }
    let resolution;
    if (isLooping) {
      resolution = "looping";
    } else if (subRegime === "CLOSED") {
      resolution = "solved";
    } else if (subRegime === "CONVERGING" && actionConsistency > 0.5) {
      resolution = "converging";
    } else {
      resolution = "unresolved";
    }
    const lastEntry = this.history[this.history.length - 1];
    const momentum = this.calcMomentum(entropyTrend, actionConsistency, embeddingDelta, isLooping, lastEntry.action, lastEntry.entropy);
    let loopLevel = "none";
    if (isLooping) {
      const repeatSignal = Math.max(repeatStreak, activityRepeatStreak, targetRepeatStreak);
      if (repeatSignal >= 3 || this.loopCount >= 4)
        loopLevel = "escalated";
      else if (repeatSignal >= 2 || this.loopCount >= 3)
        loopLevel = "assertive";
      else if (this.loopCount >= 2)
        loopLevel = "suggestive";
      else
        loopLevel = "gentle";
    }
    const pivotDetected = lastEntry.is_pivot || false;
    const pivotScore = pivotDetected ? 1 : intentState.drift_rate * 0.6 + intentState.volatility_score * 0.4;
    return {
      sub_regime: subRegime,
      resolution,
      momentum: Math.round(momentum * 1e4) / 1e4,
      signals: {
        action_consistency: Math.round(actionConsistency * 1e4) / 1e4,
        entropy_trend: Math.round(entropyTrend * 1e4) / 1e4,
        feature_contradiction: Math.round(featureContradiction * 1e4) / 1e4,
        embedding_delta: Math.round(embeddingDelta * 1e4) / 1e4,
        activity_repeat_streak: Math.round(activityRepeatStreak * 1e4) / 1e4,
        target_repeat_streak: Math.round(targetRepeatStreak * 1e4) / 1e4
      },
      intent_state: {
        volatility_score: Math.round(intentState.volatility_score * 1e4) / 1e4,
        drift_rate: Math.round(intentState.drift_rate * 1e4) / 1e4,
        core_goal_embedding: intentState.core_goal_embedding
      },
      continuity_state: continuityState,
      is_looping: isLooping,
      loop_consecutive: this.loopCount,
      repeat_streak: repeatStreak,
      activity_repeat_streak: activityRepeatStreak,
      target_repeat_streak: targetRepeatStreak,
      loop_intervention_level: loopLevel,
      pivot_detected: pivotDetected,
      pivot_score: Math.round(pivotScore * 1e4) / 1e4,
      outcome: lastEntry.outcome || null,
      outcome_negative_streak: this.getRecentNegativeOutcomeStreak(),
      message_length_trend: this.computeMessageLengthTrend().trend,
      message_length_slope: this.computeMessageLengthTrend().slope,
      n_interactions: n
    };
  }
  calcActionConsistency() {
    if (this.history.length < 2)
      return 1;
    const recent = this.history.slice(-5).map((e) => e.action);
    const counts = {};
    for (const a of recent) {
      counts[a] = (counts[a] || 0) + 1;
    }
    let mostCommonCount = 0;
    for (const count of Object.values(counts)) {
      if (count > mostCommonCount)
        mostCommonCount = count;
    }
    return mostCommonCount / recent.length;
  }
  calcEntropyTrend() {
    if (this.history.length < 2)
      return 0;
    const recent = this.history.slice(-4).map((e) => e.entropy || 0);
    if (recent.length < 2)
      return 0;
    const deltas = [];
    for (let i = 1; i < recent.length; i++) {
      deltas.push(recent[i] - recent[i - 1]);
    }
    return deltas.reduce((a, b) => a + b, 0) / deltas.length;
  }
  calcFeatureContradiction() {
    if (this.history.length < 2)
      return 0;
    const recent = this.history.slice(-4);
    const values = recent.map((e) => e.features?.instruction_density || 0);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    return Math.min(1, Math.sqrt(variance) * 1.5);
  }
  calcEmbeddingDelta() {
    if (this.history.length < 2)
      return 0;
    const a = this.history[this.history.length - 1].embedding;
    const b = this.history[this.history.length - 2].embedding;
    if (!a || !b)
      return 0;
    return 1 - cosineSimilarity2(a, b);
  }
  detectLoop() {
    const repeatSignal = Math.max(this.getRepeatStreak(), this.getActivityRepeatStreak(), this.getTargetRepeatStreak());
    const negativeOutcomeStreak = this.getRecentNegativeOutcomeStreak();
    return this.loopCount >= 2 || repeatSignal >= 2 || negativeOutcomeStreak >= 2;
  }
  computeIntentState() {
    const last = this.history[this.history.length - 1];
    const prev = this.history[this.history.length - 2];
    const driftRate = prev ? Math.min(1, Math.abs((last?.features?.instruction_density || 0.6) - (prev?.features?.instruction_density || 0.6)) * 2) : 0;
    const volatilityScore = Math.min(1, this.getRepeatStreak() / 5 + driftRate * 0.5);
    return {
      volatility_score: volatilityScore,
      drift_rate: driftRate,
      core_goal_embedding: null
    };
  }
  continuityState(intentState) {
    if (intentState.volatility_score > 0.7)
      return "LOW";
    if (intentState.volatility_score > 0.35)
      return "MEDIUM";
    return "HIGH";
  }
  isClosed(actionConsistency, embeddingDelta, featureContradiction) {
    return actionConsistency > 0.85 && embeddingDelta < 0.15 && featureContradiction < 0.2;
  }
  isDivergent(entropyTrend, featureContradiction, actionConsistency) {
    return entropyTrend > 0.1 && featureContradiction > 0.3 && actionConsistency < 0.75;
  }
  isExploring(featureContradiction, entropyTrend, actionConsistency) {
    return featureContradiction > 0.15 && entropyTrend >= -0.05 && actionConsistency < 0.9;
  }
  isRefining(featureContradiction, embeddingDelta, actionConsistency, entropyTrend) {
    return actionConsistency > 0.55 && actionConsistency < 0.95 && embeddingDelta < 0.35 && featureContradiction < 0.45 && entropyTrend <= 0.2;
  }
  isConverging(actionConsistency, embeddingDelta, entropyTrend) {
    return actionConsistency > 0.7 && embeddingDelta < 0.25 && entropyTrend <= 0.15;
  }
  calcMomentum(entropyTrend, actionConsistency, embeddingDelta, isLooping, action, entropy) {
    const base = actionConsistency * 0.4 + (1 - Math.min(1, embeddingDelta)) * 0.3 + Math.max(0, 0.3 - Math.abs(entropyTrend)) * 0.3;
    return isLooping ? Math.max(-1, base - 0.6) : Math.min(1, base + 0.1);
  }
  reset() {
    this.history = [];
    this.loopCount = 0;
    this.pivotHistory = [];
    this.outcomeHistory = [];
    this.recentMessageLengths = [];
  }
  recordOutcome(outcome) {
    const entry = this.history[this.history.length - 1];
    if (entry) {
      entry.outcome = outcome;
      this.outcomeHistory.push({
        turn: this.history.length,
        outcome,
        timestamp: Date.now() / 1e3
      });
    }
  }
  getLoopIntervention() {
    const state = this.snapshot();
    if (!state.is_looping)
      return null;
    const interventions = {
      gentle: {
        directive: "You may be repeating the same answer path \u2014 stop and restate the core question from a new angle before continuing.",
        resetSuggested: false
      },
      suggestive: {
        directive: "The conversation is looping. Do not continue the same answer path. Step back, identify what new information is missing, and ask for a different constraint or approach.",
        resetSuggested: false
      },
      assertive: {
        directive: "You are stuck in a loop. STOP repeating the current answer path. PIVOT: list 3 alternative approaches you have not tried and choose one.",
        resetSuggested: false
      },
      escalated: {
        directive: "CRITICAL: repeated loop detected. STOP the current approach entirely. Reset the strategy, SWITCH topics or scope, and do not continue the same line of reasoning.",
        resetSuggested: true
      }
    };
    return {
      level: state.loop_intervention_level,
      ...interventions[state.loop_intervention_level] || interventions.gentle
    };
  }
  getPivotDirective() {
    const state = this.snapshot();
    if (!state.pivot_detected)
      return null;
    return "PIVOT DETECTED: The conversation has shifted context. The previous resolution state may no longer apply. Acknowledge the context change and adapt your guidance accordingly. If the new topic is entirely unrelated to the project, confirm the scope change before proceeding.";
  }
  setCalibratedWeights(weights) {
    this.calibratedWeights = weights;
  }
  snapshot() {
    return this.computeState();
  }
  getHistory() {
    return [...this.history];
  }
  getOutcomeHistory() {
    return [...this.outcomeHistory];
  }
  serialize() {
    return {
      sessionId: this.sessionId,
      maxHistory: this.maxHistory,
      history: this.history,
      loopCount: this.loopCount,
      pivotHistory: this.pivotHistory,
      outcomeHistory: this.outcomeHistory,
      recentMessageLengths: this.recentMessageLengths,
      calibratedWeights: this.calibratedWeights
    };
  }
  static deserialize(data) {
    const tracker = new _ResolutionTracker(data.sessionId || "session", data.maxHistory || 10);
    tracker.history = Array.isArray(data.history) ? data.history.map((entry) => ({
      ...entry,
      activity: entry?.activity || null
    })) : [];
    tracker.loopCount = Number(data.loopCount || 0);
    tracker.pivotHistory = Array.isArray(data.pivotHistory) ? data.pivotHistory : [];
    tracker.outcomeHistory = Array.isArray(data.outcomeHistory) ? data.outcomeHistory : [];
    tracker.recentMessageLengths = Array.isArray(data.recentMessageLengths) ? data.recentMessageLengths : [];
    tracker.calibratedWeights = data.calibratedWeights || null;
    return tracker;
  }
};
function cosineSimilarity2(a, b) {
  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0)
    return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// src/vibeOS-lib/blackbox/index.js
init_meta_controller();
init_vibemax();

// src/vibeOS-lib/blackbox/vibeqmax.js
init_ml_router();
function normalizeText(input = {}) {
  return String(input.user_text || input.prompt || input.text || "").trim();
}
function qmaxStrategyFromDifficulty(diff, text) {
  const lower = String(text || "").toLowerCase();
  if (/audit|security|compliance|legal|vulnerability|owasp|cve|csrf|xss|auth|permission|privacy/.test(lower))
    return "audit";
  if (diff.level === "complex" || diff.features.fileMentions >= 2 || diff.features.errorSignals >= 2)
    return "longrun";
  if (diff.features.questionDensity > 0.02 || diff.features.length > 120 || /research|analyze|compare|investigate|review|explain|why|how/.test(lower))
    return "longrun";
  return "quality";
}
function qmaxControlBlock(strategy) {
  if (strategy === "audit") {
    return {
      enforcement_mode: "strict",
      flow_mode: "strict",
      tdd_mode: "quality",
      thinking_mode: "full",
      tier_bias: "brain",
      context7_urgency: "required",
      wbp_verbosity: "detailed"
    };
  }
  if (strategy === "longrun") {
    return {
      enforcement_mode: "strict",
      flow_mode: "strict",
      tdd_mode: "quality",
      thinking_mode: "full",
      tier_bias: "brain",
      context7_urgency: "required",
      wbp_verbosity: "detailed"
    };
  }
  return {
    enforcement_mode: "strict",
    flow_mode: "strict",
    tdd_mode: "quality",
    thinking_mode: "full",
    tier_bias: "brain",
    context7_urgency: "required",
    wbp_verbosity: "normal"
  };
}
function vibeqmaxSelectMode(input = {}) {
  const text = normalizeText(input);
  const diff = computeDifficulty(text);
  const strategy = qmaxStrategyFromDifficulty(diff, text);
  const block = qmaxControlBlock(strategy);
  return {
    mode: "vibeqmax",
    source: "vibeqmax",
    mode_root: "vibeqmax",
    mode_family: "brain-ml",
    cascade_depth: 1,
    pipeline_root: ["brain"],
    qmax_strategy: strategy,
    qmax_difficulty_score: diff.score,
    qmax_difficulty_level: diff.level,
    qmax_confidence: diff.confidence,
    qmax_suggested_tier: diff.suggestedTier,
    qmax_features: diff.features,
    qmax_reason: strategy === "audit" ? "audit-sensitive prompt" : strategy === "longrun" ? "long-context or multi-step prompt" : "brain-tier quality prompt",
    ...block
  };
}
function vibeqmaxControlVector(input = {}) {
  const selected = vibeqmaxSelectMode(input);
  return {
    optimization_mode: "vibeqmax",
    mode_root: "vibeqmax",
    mode_family: "brain-ml",
    cascade_depth: 1,
    pipeline_root: ["brain"],
    enforcement_mode: selected.enforcement_mode,
    enforcement_reason: "[optimize: vibeqmax] difficulty-driven brain route",
    flow_mode: selected.flow_mode,
    flow_focus: [],
    tdd_mode: selected.tdd_mode,
    tdd_focus: [],
    tier_bias: selected.tier_bias,
    thinking_mode: selected.thinking_mode,
    stress_multiplier: Number(input.stress_multiplier ?? input.stress ?? 0),
    context7_urgency: selected.context7_urgency,
    wbp_verbosity: selected.wbp_verbosity,
    qmax_strategy: selected.qmax_strategy,
    qmax_difficulty_score: selected.qmax_difficulty_score,
    qmax_difficulty_level: selected.qmax_difficulty_level,
    qmax_confidence: selected.qmax_confidence,
    qmax_suggested_tier: selected.qmax_suggested_tier,
    qmax_features: selected.qmax_features,
    directives: [`[qmax root] difficulty=${selected.qmax_difficulty_level}; strategy=${selected.qmax_strategy}`]
  };
}

// src/vibeOS-lib/blackbox/index.js
init_vibeultrax();
init_pivot_cache();

// src/lib/turn-classify.js
init_state();
init_selection_manager();

// src/lib/classifiers.js
init_state();
function detectOutcomeSignal(text) {
  if (!text)
    return null;
  if (/thank|perfect|exactly|that.?s it|works great|works perfectly|solved|fixed|awesome|you rock|that works|finally|progress|much better|getting there|closer now/i.test(text))
    return "positive";
  if (/doesn.?t work|still broken|not working|incorrect|wrong|failed|error|useless|stuck|still failing|broke again|worse|regression|new (problem|bug|issue|error)|made it worse|every (fix|change|attempt) (broke|breaks|introduces)|went backwards|back to square|start over|same (issue|problem|error) (again|still)|(another|yet another|different) (error|problem|issue)|(still|again|still not) (the|at|same)|\d+\s*(times|attempts|tries) (and|but) (still|same|same result)/i.test(text))
    return "negative";
  return null;
}
function normalizeActivitySignature(event) {
  if (!event || typeof event !== "object")
    return "";
  const tool2 = String(event.tool || "").trim().toLowerCase();
  const target = String(event.target || "").trim().toLowerCase();
  const action = String(event.action || event.kind || "").trim().toLowerCase();
  return [tool2, target, action].filter(Boolean).join(":");
}
function countBehavioralRepeat(items, signatureOf, minLength = 2) {
  if (!Array.isArray(items) || items.length < minLength)
    return 0;
  const last = signatureOf(items[items.length - 1]);
  if (!last)
    return 0;
  let streak = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (signatureOf(items[i]) !== last)
      break;
    streak++;
  }
  return streak;
}
function getBehavioralStressSignals(context, blackboxState) {
  const recentEvents = Array.isArray(context?.recentToolEvents) ? context.recentToolEvents : Array.isArray(recentToolEvents) ? recentToolEvents : [];
  const recentWindow = recentEvents.slice(-8);
  const toolRepeatStreak = countBehavioralRepeat(recentWindow, normalizeActivitySignature);
  const targetRepeatStreak = countBehavioralRepeat(recentWindow, (event) => String(event?.target || "").trim().toLowerCase());
  const outcomeHistory = Array.isArray(context?.outcomeHistory) ? context.outcomeHistory : Array.isArray(blackboxState?.outcomeHistory) ? blackboxState.outcomeHistory : [];
  const negativeOutcomes = outcomeHistory.slice(-5).filter((o) => /negative|failed|unresolved|loop_detected/i.test(String(o?.outcome || ""))).length;
  const loopCount = Number(blackboxState?.loop_count ?? blackboxState?.loopConsecutive ?? blackboxState?.loop_consecutive ?? 0);
  const repeatStreak = Number(blackboxState?.repeat_streak ?? 0);
  const activityRepeatStreak = Number(blackboxState?.activity_repeat_streak ?? 0);
  const targetRepeatStateStreak = Number(blackboxState?.target_repeat_streak ?? 0);
  const messageLengthTrend = String(blackboxState?.message_length_trend || "stable");
  const messageLengthSlope = Number(blackboxState?.message_length_slope ?? 0);
  return {
    toolRepeatStreak,
    targetRepeatStreak,
    negativeOutcomes,
    loopCount,
    repeatStreak,
    activityRepeatStreak,
    targetRepeatStateStreak,
    messageLengthTrend,
    messageLengthSlope
  };
}
function scoreStress(text, context = {}) {
  const blackboxState = loadBlackboxState();
  if (!text || typeof text !== "string")
    return 0;
  const t = text.toLowerCase();
  let score = 0;
  const aggressive = ["fuck", "shit", "bullshit", "useless", "wrong", "bad", "slow", "broken", "stupid", "idiot", "hell", "damn", "waste", "annoying", "terrible", "hate"];
  for (const w of aggressive) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
    const hits = (t.match(re) || []).length;
    score += hits * 0.18;
  }
  const urgency = ["fix", "now", "fast", "urgent", "important", "critical", "hurry", "immediately", "asap", "stressed", "stress", "frustrated", "overwhelmed", "panic", "panicked", "anxious"];
  for (const w of urgency) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
    const hits = (t.match(re) || []).length;
    score += hits * 0.16;
  }
  const negative = ["no", "not", "don't", "can't", "won't", "doesn't", "isn't", "shouldn't", "never", "stop"];
  for (const w of negative) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
    const hits = (t.match(re) || []).length;
    score += hits * 0.06;
  }
  const capsAcronyms = /* @__PURE__ */ new Set(["ai", "ui", "api", "cli", "ssh", "dns", "http", "url", "json", "xml", "css", "html", "sql", "csv", "yaml", "ide", "tdd", "pr", "ci", "cd", "env", "os", "sdk", "gui", "crud", "rest", "crlf", "utf", "ascii"]);
  const words = text.split(/\s+/);
  for (const w of words) {
    if (w.length >= 3 && /^[A-Z]+$/.test(w) && !capsAcronyms.has(w.toLowerCase())) {
      score += 0.05;
    }
  }
  const exclamParts = text.match(/!{2,}/g);
  if (exclamParts)
    score += exclamParts.length * 0.08;
  const qmarkParts = text.match(/\?{2,}/g);
  if (qmarkParts)
    score += qmarkParts.length * 0.05;
  const qeCombos = text.match(/\?!|!\?/g);
  if (qeCombos)
    score += qeCombos.length * 0.1;
  const behavioralPhrases = [
    { re: /\b(restart|restarts|restarted|restart again|restart it|retry|retries|retrial|rerun|redo|repeat the step|try again|another attempt|another pass)\b/gi, weight: 0.09 },
    { re: /\b(still failing|keeps failing|keeps breaking|still broken|same issue|same result|same error|new error|new issue|broke again|breaks again|every fix|every time|over and over|again and again)\b/gi, weight: 0.12 },
    { re: /\b(blocked again|stuck again|failed again|fails again|this is not working|nothing changed|no change)\b/gi, weight: 0.1 },
    { re: /\b(start over|from scratch|back to square|back to the drawing board|reset|rethink|different approach)\b/gi, weight: 0.12 },
    { re: /\b(made it worse|went backwards|regression|introduced (a |a new |another )(problem|bug|issue)|worse than before|new (problem|bug|issue) (emerged|appeared|showed))\b/gi, weight: 0.15 },
    { re: /\b(\d+)\s*(times|attempts|tries)\b/gi, dynamic: true }
  ];
  for (const { re, weight, dynamic } of behavioralPhrases) {
    const matches = t.match(re);
    if (!matches)
      continue;
    if (dynamic) {
      for (const m of matches) {
        const num = parseInt(m, 10) || 0;
        score += Math.min(0.2, num * 0.04);
      }
    } else {
      score += matches.length * weight;
    }
  }
  const { toolRepeatStreak, targetRepeatStreak, negativeOutcomes, loopCount, repeatStreak, activityRepeatStreak, targetRepeatStateStreak, messageLengthTrend, messageLengthSlope } = getBehavioralStressSignals(context, blackboxState);
  if (toolRepeatStreak >= 2) {
    score += 0.08 + Math.min(0.24, (toolRepeatStreak - 1) * 0.05);
  }
  if (targetRepeatStreak >= 2) {
    score += 0.05 + Math.min(0.16, (targetRepeatStreak - 1) * 0.035);
  }
  if (negativeOutcomes >= 1) {
    score += 0.05 * negativeOutcomes + Math.min(0.18, negativeOutcomes * 0.03);
  }
  if (blackboxState?.is_looping || loopCount >= 2) {
    score += 0.1 + Math.min(0.18, loopCount * 0.03);
  }
  if (repeatStreak >= 2) {
    score += 0.06 + Math.min(0.12, repeatStreak * 0.025);
  }
  if (activityRepeatStreak >= 2) {
    score += 0.05 + Math.min(0.1, activityRepeatStreak * 0.02);
  }
  if (targetRepeatStateStreak >= 2) {
    score += 0.04 + Math.min(0.08, targetRepeatStateStreak * 0.015);
  }
  if (messageLengthTrend === "shortening" && messageLengthSlope < -0.3) {
    score += 0.08;
  }
  if (text.length < 30)
    score += 0.06;
  else if (text.length < 80)
    score += 0.05;
  else if (text.length < 150)
    score += 0.03;
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
  if (/(security|vulnerability|audit|owasp|compliance|gdpr|privacy|analyze dependencies|license audit|xss|csrf|authn|authz|pentest)/i.test(lower)) {
    return "AUDIT";
  }
  if (/(inject|exploit|penetration|cve|attack|threat|encrypt|forensic|research|deep analysis|investigate|root cause|reverse engineer|disassemble|memory dump|core dump)/i.test(lower)) {
    return "FORENSIC";
  }
  const IMPL_VERBS = "fix|write|create|build|implement|change|edit|modify|update|refactor|generate|delete|remove|migrate|deploy|commit|push";
  if (new RegExp("^(can you|could you|tell me|we should|we need to|please) (" + IMPL_VERBS + ")\\b", "i").test(lower)) {
    return "REFINING";
  }
  if (new RegExp("^I (need|want|would like) to (" + IMPL_VERBS + ")\\b", "i").test(lower)) {
    return "REFINING";
  }
  if (/^(the |there is |there are |i think |looks like |seems like |i see |why (is|are|does|did) )/i.test(lower)) {
    return "EXPLORING";
  }
  if (/^(how|what|why|when|where|who|can you|could you|let me|tell me|explain|describe|show|list|check|is there|are there|does|do you|summarize|elaborate|clarify|inspect|trace|find|search|look|read|show me|dump|debug)/i.test(lower)) {
    return "EXPLORING";
  }
  if (new RegExp("\\b(" + IMPL_VERBS + ")\\b", "i").test(lower)) {
    return "REFINING";
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
init_vibeultrax();
var _lastClassifiedByApi = false;
function classifyTurnSimple2(userText) {
  return classifyTurnSimple(userText);
}
async function classifyTurnRemote(text) {
  try {
    const client2 = getApiClient2();
    if (!client2 || isApiFallback()) {
      _lastClassifiedByApi = false;
      return classifyTurnSimple(text);
    }
    const res = await client2.blackboxAnalyze(_OC_SID, {
      session_id: _OC_SID,
      project_id: currentProjectFingerprint || null,
      userText: text,
      lastRegime: null,
      lastIntent: "",
      lastAction: "",
      stress: 0,
      state: {}
    });
    if (res && typeof res === "object" && "sub_regime" in res) {
      _lastClassifiedByApi = true;
      return res.sub_regime;
    }
  } catch {
  }
  _lastClassifiedByApi = false;
  return classifyTurnSimple(text);
}
function getVibeOSHome5() {
  return process.env.VIBEOS_HOME || join7(process.env.HOME || "", ".claude");
}
var QUALITY_STRESS_THRESHOLD2 = 1.5;
function autoSelectMode2(subRegime, stressMultiplier) {
  const regime = String(subRegime || "INIT").toUpperCase();
  const stress = Number(stressMultiplier ?? 0);
  if (regime === "AUDIT" || regime === "FORENSIC")
    return regime.toLowerCase();
  if (regime === "LOOPING")
    return "quality";
  if (regime === "CONVERGING" || regime === "CLOSED")
    return "quality";
  if (regime === "IMPLEMENTING")
    return "quality";
  if (regime === "RESEARCH" || regime === "DESIGNING")
    return "longrun";
  if (regime === "REVIEWING")
    return "audit";
  if (stress > QUALITY_STRESS_THRESHOLD2)
    return "quality";
  return "vibelitex";
}
function resolveOptimizationMode(subRegime, stressMultiplier, optimizationMode) {
  const normalized = String(optimizationMode || "auto").toLowerCase();
  if (normalized === "auto" || normalized === "")
    return autoSelectMode2(subRegime || "INIT", stressMultiplier);
  if (isApiFallback())
    return "vibelitex";
  if (normalized === "balanced" || normalized === "budget" || normalized === "quality" || normalized === "speed" || normalized === "longrun" || normalized === "audit" || normalized === "forensic" || normalized === "vibeultrax" || normalized === "vibeqmax" || normalized === "vibemax" || normalized === "vibelitex") {
    return normalized;
  }
  return "budget";
}
async function selectOptimizationModeRemote(subRegime, stressMultiplier, fallbackMode) {
  const normalizedRequestedMode = String(fallbackMode || "auto").toLowerCase();
  const fallback2 = resolveOptimizationMode(subRegime, stressMultiplier, fallbackMode);
  if (normalizedRequestedMode !== "auto" && normalizedRequestedMode !== "")
    return fallback2;
  if (isApiFallback())
    return fallback2;
  try {
    const client2 = getApiClient2();
    if (client2) {
      const res = await client2.blackboxSelectMode(subRegime || "INIT", Number(stressMultiplier ?? 0));
      const selected = String(res?.mode || "").toLowerCase();
      if (selected === "balanced" || selected === "budget" || selected === "quality" || selected === "speed" || selected === "longrun" || selected === "audit" || selected === "forensic" || selected === "vibeultrax" || selected === "vibeqmax" || selected === "vibemax") {
        return selected;
      }
    }
  } catch {
  }
  return fallback2;
}
function computeControlVector2(_state, _action, _optimizationMode) {
  const mode = resolveOptimizationMode(_state?.sub_regime, _state?.latest_stress_multiplier, _optimizationMode);
  const modeRoot = mode === "vibeultrax" ? vibeultraxControlVector({
    user_text: _state?.user_text || _state?.prompt || "",
    stress_multiplier: _state?.latest_stress_multiplier ?? 0,
    sub_regime: _state?.sub_regime || "INIT"
  }) : mode === "vibeqmax" ? { mode_root: "vibeqmax", mode_family: "brain-ml", cascade_depth: 1, pipeline_root: ["brain"] } : mode === "vibemax" ? { mode_root: "vibemax", mode_family: "medium-ml", cascade_depth: 1, pipeline_root: ["medium"] } : mode === "quality" ? { mode_root: "quality", mode_family: "brain-runtime", cascade_depth: 1, pipeline_root: ["brain"] } : { mode_root: mode, mode_family: "runtime", cascade_depth: 1, pipeline_root: mode === "speed" ? ["medium"] : mode === "budget" || mode === "balanced" || mode === "longrun" ? ["cheap"] : ["cheap"] };
  if (mode === "vibeqmax") {
    const qmax = vibeqmaxControlVector({
      sub_regime: _state?.sub_regime || "INIT",
      stress_multiplier: _state?.latest_stress_multiplier ?? 0,
      user_text: _state?.user_text || _state?.prompt || ""
    });
    return {
      enforcement_mode: qmax.enforcement_mode,
      enforcement_reason: `[optimize: vibeqmax] difficulty-driven brain root`,
      flow_mode: qmax.flow_mode,
      flow_focus: qmax.flow_focus || [],
      tdd_mode: qmax.tdd_mode,
      tdd_focus: qmax.tdd_focus || [],
      tier_bias: qmax.tier_bias,
      thinking_mode: qmax.thinking_mode,
      stress_multiplier: qmax.stress_multiplier,
      context7_urgency: qmax.context7_urgency,
      wbp_verbosity: qmax.wbp_verbosity,
      agent_mode: (String(_state?.sub_regime || "").toUpperCase() === "REFINING" || String(_state?.sub_regime || "").toUpperCase() === "CONVERGING" || String(_state?.sub_regime || "").toUpperCase() === "CLOSED") && Number(_state?.latest_stress_multiplier ?? 0) <= QUALITY_STRESS_THRESHOLD2 ? "plan" : void 0,
      optimization_mode: "vibeqmax",
      mode_root: qmax.mode_root,
      mode_family: qmax.mode_family,
      cascade_depth: qmax.cascade_depth || 1,
      pipeline_root: qmax.pipeline_root || ["brain"],
      qmax_strategy: qmax.qmax_strategy,
      qmax_difficulty_score: qmax.qmax_difficulty_score,
      qmax_difficulty_level: qmax.qmax_difficulty_level,
      qmax_confidence: qmax.qmax_confidence,
      qmax_source_prediction: qmax.qmax_strategy,
      qmax_suggested_tier: qmax.qmax_suggested_tier,
      qmax_features: qmax.qmax_features,
      directives: [`[qmax root] Dedicated brain-ml root active for ${_state?.sub_regime || "INIT"}.`]
    };
  }
  if (mode === "vibeultrax") {
    const ultra = vibeultraxControlVector({
      sub_regime: _state?.sub_regime || "INIT",
      stress_multiplier: _state?.latest_stress_multiplier ?? 0,
      user_text: _state?.user_text || _state?.prompt || ""
    });
    return {
      enforcement_mode: ultra.enforcement_mode,
      enforcement_reason: `[optimize: vibeultrax] cascade root`,
      flow_mode: ultra.flow_mode,
      flow_focus: [],
      tdd_mode: ultra.tdd_mode,
      tdd_focus: [],
      tier_bias: ultra.tier_bias,
      thinking_mode: ultra.thinking_mode,
      stress_multiplier: ultra.stress_multiplier,
      context7_urgency: ultra.context7_urgency,
      wbp_verbosity: ultra.wbp_verbosity,
      agent_mode: ultra.ultrax_profile === "deep" ? "plan" : void 0,
      optimization_mode: "vibeultrax",
      mode_root: ultra.mode_root,
      mode_family: ultra.mode_family,
      cascade_depth: ultra.cascade_depth,
      pipeline_root: ultra.pipeline_root,
      ultrax_profile: ultra.ultrax_profile,
      ultrax_confidence: ultra.ultrax_confidence,
      ultrax_reason: ultra.ultrax_reason,
      ultrax_estimated_savings: ultra.ultrax_estimated_savings,
      directives: [`[ultrax root] Dedicated cascade root active for ${_state?.sub_regime || "INIT"}.`]
    };
  }
  const isStrict = mode === "quality" || mode === "vibemax" || mode === "vibeqmax" || mode === "vibeultrax" || mode === "forensic" || mode === "audit";
  const isRelaxed = mode === "budget" || mode === "speed";
  const subRegime = _state?.sub_regime || "INIT";
  const stress = Number(_state?.latest_stress_multiplier ?? 0);
  const tierBias = stress > QUALITY_STRESS_THRESHOLD2 ? "brain" : subRegime === "CONVERGING" || subRegime === "CLOSED" ? "brain" : subRegime === "REFINING" || subRegime === "LOOPING" ? "medium" : mode === "quality" || mode === "longrun" || mode === "vibeultrax" || mode === "vibeqmax" || mode === "forensic" || mode === "audit" ? "brain" : mode === "speed" || mode === "vibemax" || mode === "vibelitex" ? "medium" : mode === "balanced" ? "auto" : "cheap";
  const loopingHardening = String(subRegime).toUpperCase() === "LOOPING";
  const hardenedTierBias = loopingHardening ? "brain" : tierBias;
  const hardenedMode = loopingHardening ? "quality" : mode;
  const hardenedModeRoot = loopingHardening ? { mode_root: "quality", mode_family: "brain-runtime", cascade_depth: 1, pipeline_root: ["brain"] } : modeRoot;
  return {
    enforcement_mode: loopingHardening ? "strict" : isStrict ? "strict" : isRelaxed ? "relaxed" : "normal",
    enforcement_reason: loopingHardening ? "[optimize: LOOPING] recovery posture \u2014 tighten enforcement and preserve outcome detection" : `[optimize: ${mode}] using safe offline defaults`,
    flow_mode: loopingHardening ? "strict" : isStrict ? "strict" : isRelaxed ? "audit" : "normal",
    flow_focus: [],
    tdd_mode: loopingHardening ? "strict" : isStrict ? "strict" : isRelaxed ? "lazy" : "normal",
    tdd_focus: [],
    tier_bias: hardenedTierBias,
    thinking_mode: loopingHardening ? "brief" : isStrict ? "full" : mode === "longrun" ? "brief" : isRelaxed ? "off" : "auto",
    stress_multiplier: loopingHardening ? Math.max(1.5, stress) : 1,
    context7_urgency: loopingHardening ? "required" : isStrict ? "required" : "preferred",
    wbp_verbosity: loopingHardening ? "detailed" : isStrict ? "verbose" : isRelaxed ? "minimal" : "normal",
    agent_mode: (subRegime === "REFINING" || subRegime === "CONVERGING" || subRegime === "CLOSED") && stress <= QUALITY_STRESS_THRESHOLD2 ? "plan" : void 0,
    optimization_mode: hardenedMode,
    ...hardenedModeRoot,
    outcome_detection: true,
    directives: isRelaxed && !loopingHardening && (subRegime === "EXPLORING" || subRegime === "INIT" || subRegime === "AUDIT" || subRegime === "FORENSIC" || subRegime === "LOOPING") ? [
      `[speed guard] VERIFY BEFORE ACT - Speed-oriented mode "${mode}" is active and user intent is ${subRegime}. Before modifying files or executing commands, first verify the current state. When a request is ambiguous between "check and report" vs "fix", always choose CHECK FIRST. Treat "look at", "check", "investigate", "tell me about" as requests for information, not action items.`
    ] : []
  };
}
function buildControlHistoryEntry2(turn, regime, control, reward = null) {
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
function classifyBlackboxAction(text) {
  if (/refactor|change|replace|switch|pivot|migrate/i.test(text))
    return "change";
  if (/commit|save|push|merge|release|finalize/i.test(text))
    return "commit";
  if (/write|create|build|make|add|implement|generate/i.test(text))
    return "act";
  if (/explain|why|how|what|analyze|review|check|find|search|look/i.test(text))
    return "explore";
  if (/show|list|get|read|see|view|display|print/i.test(text))
    return "observe";
  return "explore";
}
function computeBlackboxEntropy(features) {
  const questionRatio = Number(features?.question_ratio || 0);
  const complexity = Number(features?.complexity || 0);
  const repetition = Number(features?.repetition || 0);
  const instructionDensity = Number(features?.instruction_density || 0);
  return Math.min(2.58, 0.5 + questionRatio * 0.5 + complexity * 0.8 + repetition * 0.6 + instructionDensity * 0.4);
}
function computeBlackboxUncertainty(features) {
  const questionRatio = Number(features?.question_ratio || 0);
  const codeBlocks = Number(features?.code_blocks || 0);
  const sentiment = Number(features?.sentiment || 0.5);
  const urgency = Number(features?.urgency || 0);
  return Math.min(100, Math.max(10, 50 + questionRatio * 40 - codeBlocks * 10 + sentiment * 30 - urgency * 20));
}
function normalizeBlackboxFeatures(text) {
  const features = ResolutionTracker.extractFeatures(text);
  return {
    features,
    action: classifyBlackboxAction(text),
    entropy: computeBlackboxEntropy(features),
    uncertainty: computeBlackboxUncertainty(features)
  };
}
function summarizeRecentToolActivity(limit = 5) {
  const events = Array.isArray(recentToolEvents) ? recentToolEvents.slice(-limit) : [];
  if (events.length === 0)
    return null;
  const last = events[events.length - 1] || {};
  const actionType = String(last.action || last.kind || "").trim().toLowerCase();
  const toolTarget = `${String(last.tool || "").trim().toLowerCase()}:${String(last.target || "").trim().toLowerCase()}`;
  const signature = `${toolTarget}:${actionType}`;
  let repeatCount = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const cur = events[i] || {};
    const curAction = String(cur.action || cur.kind || "").trim().toLowerCase();
    const curSig = `${String(cur.tool || "").trim().toLowerCase()}:${String(cur.target || "").trim().toLowerCase()}:${curAction}`;
    if (curSig !== signature)
      break;
    repeatCount++;
  }
  return {
    tool: String(last.tool || "").toLowerCase(),
    target: String(last.target || "").toLowerCase(),
    action: actionType,
    signature,
    repeat_count: repeatCount,
    recent_count: events.length
  };
}
function normalizeBlackboxHistoryEntry(entry) {
  const text = typeof entry?.text === "string" ? entry.text : "";
  const fallback2 = normalizeBlackboxFeatures(text);
  const entryFeatures = entry?.features && typeof entry.features === "object" ? { ...fallback2.features, ...entry.features } : fallback2.features;
  return {
    text,
    features: entryFeatures,
    action: typeof entry?.action === "string" && entry.action ? entry.action : fallback2.action,
    entropy: Number.isFinite(Number(entry?.entropy)) ? Number(entry.entropy) : fallback2.entropy,
    uncertainty: Number.isFinite(Number(entry?.uncertainty)) ? Number(entry.uncertainty) : fallback2.uncertainty,
    embedding: Array.isArray(entry?.embedding) ? [...entry.embedding] : null,
    timestamp: Number.isFinite(Number(entry?.timestamp)) ? Number(entry.timestamp) : Date.now() / 1e3,
    is_pivot: Boolean(entry?.is_pivot),
    outcome: typeof entry?.outcome === "string" ? entry.outcome : entry?.outcome ?? null,
    activity: entry?.activity && typeof entry.activity === "object" ? { ...entry.activity } : null
  };
}
function normalizeBlackboxHistory(history) {
  if (!Array.isArray(history))
    return [];
  return history.map(normalizeBlackboxHistoryEntry);
}
function createResolutionTracker(data) {
  const tracker = new ResolutionTracker(data?.sessionId || _OC_SID, data?.maxHistory || 10);
  tracker.history = normalizeBlackboxHistory(data?.history || []);
  tracker.loopCount = Number(data?.loopCount || 0);
  tracker.pivotHistory = Array.isArray(data?.pivotHistory) ? [...data.pivotHistory] : [];
  tracker.outcomeHistory = Array.isArray(data?.outcomeHistory) ? [...data.outcomeHistory] : [];
  tracker.calibratedWeights = data?.calibratedWeights || null;
  return tracker;
}
var _BlackboxStub = class __BlackboxStub {
  tracker;
  static deserialize(data) {
    return new __BlackboxStub(data);
  }
  constructor(data = null) {
    this.tracker = createResolutionTracker(data);
  }
  update(text) {
    const normalized = normalizeBlackboxFeatures(text);
    const recentActivity = summarizeRecentToolActivity();
    const state = this.tracker.update(text, normalized.features, normalized.action, normalized.entropy, normalized.uncertainty, null, recentActivity);
    return { ...state, ...normalized };
  }
  snapshot() {
    return this.tracker.snapshot();
  }
  serialize() {
    return this.tracker.serialize();
  }
  recordOutcome(outcome) {
    this.tracker.recordOutcome(outcome);
  }
  getLoopIntervention() {
    return this.tracker.getLoopIntervention();
  }
  getPivotDirective() {
    return this.tracker.getPivotDirective();
  }
  setCalibratedWeights(weights) {
    this.tracker.setCalibratedWeights(weights);
  }
  getHistory() {
    return this.tracker.getHistory();
  }
  getOutcomeHistory() {
    return this.tracker.getOutcomeHistory();
  }
};
var _blackboxTracker = null;
var _latestBlackboxState2 = null;
var _latestBlackboxLoopMsg2 = null;
var _latestBlackboxPivotMsg2 = null;
var WARN_DEDUPE_WINDOW_MS2 = 120 * 1e3;
var warnLogThrottle = /* @__PURE__ */ new Map();
var warnPerSession = /* @__PURE__ */ new Map();
var WARN_MAX_PER_SESSION = 3;
var WARN_COALESCE_THRESHOLD = 10;
var warnCoalesceCounters = /* @__PURE__ */ new Map();
function loadTrinityModels() {
  try {
    const p = join7(getVibeOSHome5(), "model-tiers.json");
    if (!existsSync9(p))
      return { brain: "", cheap: "", medium: "" };
    const j = safeJsonParse2(readFileSync8(p, "utf-8"));
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
    if (sid && sid !== "undefined" && state.sessions?.[sid]?.history) {
      _blackboxTracker = _BlackboxStub.deserialize(state.sessions[sid]);
    } else if (currentProjectFingerprint && sid && sid !== "undefined") {
      const projectKeys = Object.keys(state.sessions || {}).filter((k) => state.sessions[k].project_fingerprint === currentProjectFingerprint && k !== "undefined" && k !== null && k.trim() !== "");
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
    const localCal = computeLocalCalibration();
    if (localCal && _blackboxTracker?.setCalibratedWeights) {
      _blackboxTracker.setCalibratedWeights(localCal);
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
function computeLocalCalibration() {
  try {
    const calFile = join7(getVibeOSHome5(), "calibration-data.jsonl");
    if (!existsSync9(calFile))
      return null;
    const lines = readFileSync8(calFile, "utf-8").trim().split("\n").filter(Boolean);
    if (lines.length < 10)
      return null;
    const recent = lines.slice(-50);
    const state = loadBlackboxState();
    const allOutcomes = [];
    for (const [sid, session] of Object.entries(state.sessions || {})) {
      if (session?.outcomeHistory?.length) {
        for (const o of session.outcomeHistory) {
          allOutcomes.push({ sid, outcome: o.outcome, turn: o.turn });
        }
      }
    }
    if (allOutcomes.length < 5)
      return null;
    const positiveCount = allOutcomes.filter((o) => o.outcome === "positive").length;
    const ratio = positiveCount / allOutcomes.length;
    return {
      loopJaccard: ratio > 0.7 ? 0.55 : 0.65,
      closureConfidence: ratio > 0.7 ? 0.75 : 0.65,
      exploringContradiction: ratio > 0.7 ? 0.15 : 0.25,
      momentum: [-0.3, 0.5, 0.2]
    };
  } catch {
    return null;
  }
}
function resolveEnforcementMode() {
  const sub = _latestBlackboxState2?.sub_regime || "INIT";
  if (sub === "EXPLORING" || sub === "DIVERGENT")
    return "relaxed";
  if (sub === "LOOPING")
    return "strict";
  if (sub === "CONVERGING" || sub === "CLOSED")
    return "strict";
  return "normal";
}
async function syncOutcomeToApi(outcome) {
  try {
    const client2 = getApiClient2();
    if (!client2 || isApiFallback())
      return;
    await client2.blackboxOutcome(_OC_SID, outcome);
  } catch {
  }
}
async function fetchBlackboxEnrichment(sessionId, localState) {
  try {
    const client2 = getApiClient2();
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
      _latestBlackboxLoopMsg2 = result.loop_intervention_directive || null;
      _latestBlackboxPivotMsg2 = result.pivot_directive || null;
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
function setBlackboxEnabled2(val) {
  setBlackboxEnabled(val);
}
var DFLT_OPTIMIZATION_MODE = "budget";
function recoverOptimizationModeFromSelection(sel) {
  const slot = String(sel?.active_slot || "").toLowerCase();
  if (slot === "brain")
    return "quality";
  if (slot === "medium")
    return "vibemax";
  if (slot === "cheap")
    return "budget";
  return "budget";
}
function recoverOptimizationModeFromLiveState(sel) {
  const liveTier = String(currentTier || "").toLowerCase();
  if (liveTier === "high")
    return "quality";
  if (liveTier === "mid")
    return "vibemax";
  if (liveTier === "cheap" || liveTier === "budget")
    return "budget";
  return recoverOptimizationModeFromSelection(sel);
}
function loadOptimizationMode() {
  try {
    const sel = loadSelection();
    const persistedMode = sel.optimization_mode || null;
    const prevKey = `${_OC_SID}_prev_opt`;
    const sessionMode = loadSessionOptMode(_OC_SID);
    const globalMode = loadGlobalOptMode();
    const liveRecovery = recoverOptimizationModeFromLiveState(sel);
    const storedModes = [
      persistedMode,
      sel.previous_optimization_mode,
      loadSessionOptMode(prevKey),
      sessionMode,
      globalMode
    ].map((mode) => String(mode || "").toLowerCase());
    if (storedModes.includes("vibelitex")) {
      const recoveryMode = (sel.previous_optimization_mode && sel.previous_optimization_mode !== "vibelitex" ? sel.previous_optimization_mode : "") || loadSessionOptMode(prevKey) || (sessionMode && sessionMode !== "vibelitex" ? sessionMode : "") || (globalMode && globalMode !== "vibelitex" ? globalMode : "") || liveRecovery;
      if (recoveryMode && recoveryMode !== "vibelitex") {
        try {
          writeSelection("optimization_mode", recoveryMode);
        } catch {
        }
        try {
          writeSelection("previous_optimization_mode", null);
        } catch {
        }
        try {
          writeSessionOptMode2(_OC_SID, recoveryMode);
        } catch {
        }
        try {
          writeSessionOptMode2(prevKey, "");
        } catch {
        }
        return recoveryMode;
      }
    }
    if (sessionMode && sessionMode !== "auto")
      return sessionMode;
    if (globalMode && globalMode !== "auto")
      return globalMode;
    return DFLT_OPTIMIZATION_MODE;
  } catch {
    return DFLT_OPTIMIZATION_MODE;
  }
}
function saveOptimizationMode(mode) {
  try {
    writeSessionOptMode2(_OC_SID, mode);
  } catch (e) {
    console.error("[vibeOS] saveOptimizationMode session write failed: " + e.message);
  }
  try {
    if (mode && mode !== "auto")
      saveGlobalOptMode(mode);
    return true;
  } catch (e) {
    console.error("[vibeOS] saveOptimizationMode global write failed: " + e.message);
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
function incrementTurnCounter() {
  try {
    const state = loadBlackboxState();
    const sid = _OC_SID;
    if (!state.sessions)
      state.sessions = {};
    if (sid && sid !== "undefined") {
      if (!state.sessions[sid])
        state.sessions[sid] = {};
      const next = (state.sessions[sid].turn_counter || 0) + 1;
      state.sessions[sid].turn_counter = next;
    }
    saveBlackboxState(state);
    return 0;
  } catch {
    return 0;
  }
}
function resetBlackboxTracker() {
  _blackboxTracker = null;
}

// src/index.ts
init_state();

// src/lib/research-audit.js
init_state();
import { readFileSync as readFileSync9, existsSync as existsSync10 } from "node:fs";
import { join as join8 } from "node:path";
function getVibeOSHome6() {
  return process.env.VIBEOS_HOME || join8(process.env.HOME || "", ".claude");
}
var _OC_SID2 = "opencode-" + (process.pid || "x") + "-" + Date.now();
var SCRATCHPAD_ROOT2 = join8(getVibeOSHome6(), "scratch");
var SCRATCHPAD_GLOBAL_DIR2 = join8(SCRATCHPAD_ROOT2, "by-hash");
var SCRATCHPAD_SESSIONS_DIR2 = join8(SCRATCHPAD_ROOT2, "sessions");
var STATE_FILE = join8(getVibeOSHome6(), "delegation-state.json");
var currentModel2 = null;
function getSessionRoot2() {
  return join8(SCRATCHPAD_SESSIONS_DIR2, _OC_SID2);
}
function getSessionScratchpadDir2() {
  return join8(getSessionRoot2(), "by-hash");
}
function getGlobalIndexPath2() {
  return join8(SCRATCHPAD_ROOT2, "index.jsonl");
}
var FETCH_TOOLS = /* @__PURE__ */ new Set(["WebFetch", "WebSearch", "webfetch", "websearch"]);
function researchAudit({ hours = 24, session: sessionFilter } = {}) {
  const cutoff = Date.now() - hours * 3600 * 1e3;
  const report = { totalFetches: 0, totalBytes: 0, estCost: 0, chains: [], byDomain: {}, sessions: 0, redundant: 0 };
  try {
    const indexPath = getGlobalIndexPath2();
    if (existsSync10(indexPath)) {
      const lines = readFileSync9(indexPath, "utf-8").trim().split("\n").filter(Boolean);
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
        const summaryPathSession = join8(getSessionScratchpadDir2(), hash + ".summary.txt");
        const summaryPathGlobal = join8(SCRATCHPAD_GLOBAL_DIR2, hash + ".summary.txt");
        const summaryPath = existsSync10(summaryPathSession) ? summaryPathSession : summaryPathGlobal;
        if (existsSync10(summaryPath)) {
          const summary = readFileSync9(summaryPath, "utf-8").slice(0, 200);
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
    if (existsSync10(STATE_FILE)) {
      const state = safeJsonParse2(readFileSync9(STATE_FILE, "utf-8"));
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
function buildStatusPayload({ selection, tiersData, currentModel: currentModel3, creditPercent, version, todos, backendConnected, backendHealthUrl, backendVersion, apiFallbackMode, apiFallbackSince, modelLocked, lockedSlot, lockedModel }) {
  const activeSlot = selection?.active_slot || "brain";
  const todoList = Array.isArray(todos) ? todos : [];
  const pendingTodos = todoList.filter((t) => t?.status === "pending").length;
  const totalTodos = todoList.length;
  const current = tiersData?.trinity?.[activeSlot]?.oc || currentModel3 || "";
  const lockActive = Boolean(modelLocked);
  const resolvedLockedSlot = lockActive ? lockedSlot || activeSlot : null;
  const resolvedLockedModel = lockActive ? lockedModel || current || null : null;
  const execution = resolveExecutionIdentity(current || currentModel3 || "", "");
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
    current_provider: execution.provider_label,
    current_quality_tier: execution.quality_label,
    credit_percent: creditPercent,
    version,
    todos: { total: totalTodos, pending: pendingTodos },
    backend_connected: Boolean(backendConnected),
    backend_health_url: backendHealthUrl || null,
    backend_version: backendVersion || null,
    api_fallback: Boolean(apiFallbackMode),
    api_fallback_since: apiFallbackSince || null,
    model_locked: lockActive,
    locked_slot: resolvedLockedSlot,
    locked_model: resolvedLockedModel,
    label_modes: [...LABEL_MODES]
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
  let apiFallback = { active: false, since: null };
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
    if (/api fallback/i.test(trimmed)) {
      apiFallback = {
        active: /\b(on|active|true)\b/i.test(trimmed) && !/\boff\b/i.test(trimmed),
        since: trimmed.includes("since") ? trimmed.split(/since/i)[1].trim() : null
      };
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
    api_fallback: apiFallback,
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
init_state();
init_runtime_state();
import { readFileSync as readFileSync10, writeFileSync as writeFileSync10, existsSync as existsSync11, mkdirSync as mkdirSync9, statSync as statSync6, rmSync as rmSync4 } from "node:fs";
import { join as join9 } from "node:path";
function getVibeOSHome7() {
  return process.env.VIBEOS_HOME || join9(process.env.HOME || "", ".claude");
}
function getReportsDir() {
  return join9(getVibeOSHome7(), "reports");
}
function getReportsIndexPath() {
  return join9(getReportsDir(), "index.json");
}
var REPORTS_DIR2 = getReportsDir();
var REPORTS_INDEX = getReportsIndexPath();
var currentProjectFingerprint2 = "";
var currentProjectName2 = "";
var currentSessionId2 = "";
function readJsonOrEmpty2(filePath) {
  try {
    if (!existsSync11(filePath))
      return {};
    const st = statSync6(filePath);
    if (st.size > 10485760) {
      _handleStateCorruption2(filePath);
      return {};
    }
    return safeJsonParse2(readFileSync10(filePath, "utf-8"));
  } catch {
    _handleStateCorruption2(filePath);
    return {};
  }
}
function reportsIndex() {
  const idx = readJsonOrEmpty2(getReportsIndexPath());
  if (!idx || !Array.isArray(idx.reports))
    return { reports: [] };
  return idx;
}
function saveReportsIndex(idx) {
  try {
    const reportsIndexPath = getReportsIndexPath();
    const reportsDir = getReportsDir();
    withFileLock(reportsIndexPath, () => {
      mkdirSync9(reportsDir, { recursive: true });
      writeFileSync10(reportsIndexPath, JSON.stringify(idx, null, 2) + "\n");
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
function _wouldBeDuplicate(type, summary, scope) {
  if (typeof summary !== "string")
    return false;
  const key = `${getVibeOSHome7()}::${type || ""}::${String(scope || "unknown")}::${summary}`;
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
          rmSync4(join9(getReportsDir(), `${r.id}.json`));
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
function _textHasProductionClaim(text) {
  const lower = String(text || "").toLowerCase();
  return /\bproduction[-\s]?ready\b/.test(lower) || /\bread(y|ied) for production\b/.test(lower) || /\bworked in production\b/.test(lower) || /\bworks in production\b/.test(lower) || /\bshipped to production\b/.test(lower) || /\bdeployed to production\b/.test(lower) || /\bproduction claim\b/.test(lower) || /\bproduction proof\b/.test(lower) || /\bproduction verified\b/.test(lower) || /\bin production\b/.test(lower) && /\b(worked|works|verified|proven|proved|shipped|deployed|confirmed|validated|fixed|passed)\b/.test(lower);
}
function _productionEvidenceKind(metricsObject, tags = []) {
  const reportId = String(metricsObject?.reportId || metricsObject?.report_id || "").trim();
  if (reportId && reportId !== "unknown")
    return "report";
  const sessionId = String(metricsObject?.sessionId || metricsObject?.session_id || "").trim();
  if (sessionId && sessionId !== "unknown")
    return "session";
  if (metricsObject?.liveArtifact === true || metricsObject?.productionArtifact === true)
    return "artifact";
  const tagList = Array.isArray(tags) ? tags.map((tag) => String(tag || "").toLowerCase()) : [];
  if (tagList.includes("live") || tagList.includes("session") || tagList.includes("production"))
    return "tag";
  return null;
}
function verifyProductionClaim({ summary = "", narrative = "", tags = [], metrics = {}, outcome_verified = false } = {}) {
  const claimDetected = _textHasProductionClaim(summary) || _textHasProductionClaim(narrative) || Array.isArray(tags) && tags.some((tag) => _textHasProductionClaim(tag));
  const metricsObject = metrics && typeof metrics === "object" && !Array.isArray(metrics) ? metrics : {};
  const evidence = _productionEvidenceKind(metricsObject, tags);
  const verified = claimDetected ? Boolean(evidence) : Boolean(outcome_verified);
  return {
    claimDetected,
    evidence,
    verified,
    note: claimDetected ? evidence ? `production claim backed by ${evidence} evidence` : "production claims require a live session/report artifact" : null
  };
}
function saveReport({ type = "manual", summary = "", findings = null, metrics = null, narrative = "", tags = [], fingerprint = null, status = "pending", task_description = "", outcome_verified = false } = {}) {
  const parsedFindings = _parseFindings(findings);
  const parsedMetrics = _parseMetrics(metrics);
  const metricsObject = parsedMetrics && typeof parsedMetrics === "object" && !Array.isArray(parsedMetrics) ? parsedMetrics : {};
  const metricsSessionId = typeof metricsObject.sessionId === "string" && metricsObject.sessionId.trim() ? metricsObject.sessionId.trim() : "";
  const metricsProjectName = typeof metricsObject.projectName === "string" && metricsObject.projectName.trim() ? metricsObject.projectName.trim() : "";
  const metricsProjectFingerprint = typeof metricsObject.projectFingerprint === "string" && metricsObject.projectFingerprint.trim() ? metricsObject.projectFingerprint.trim() : "";
  const dedupScope = fingerprint || metricsProjectFingerprint || currentProjectFingerprint || currentProjectFingerprint2 || metricsProjectName || currentProjectName || currentProjectName2 || "unknown";
  if (_wouldBeDuplicate(type, summary, dedupScope))
    return null;
  if (!currentProjectFingerprint2 && metricsProjectFingerprint)
    currentProjectFingerprint2 = metricsProjectFingerprint;
  if (!currentProjectName2 && metricsProjectName)
    currentProjectName2 = metricsProjectName;
  if (!currentSessionId2 && metricsSessionId)
    currentSessionId2 = metricsSessionId;
  const liveSessionId = getCurrentSessionId() || getOcSessionId() || "";
  const fp2 = fingerprint || metricsProjectFingerprint || currentProjectFingerprint || currentProjectFingerprint2 || "unknown";
  const projectName = metricsProjectName || currentProjectName || currentProjectName2 || "unknown";
  const sessionId = metricsSessionId || liveSessionId || currentSessionId2 || "unknown";
  const productionVerification = verifyProductionClaim({
    summary,
    narrative,
    tags,
    metrics: metricsObject,
    outcome_verified
  });
  const normalizedOutcomeVerified = productionVerification.claimDetected ? productionVerification.verified : Boolean(outcome_verified);
  const id2 = generateReportId(type, fp2);
  const report = {
    meta: { id: id2, project: projectName, fingerprint: fp2, type, created: (/* @__PURE__ */ new Date()).toISOString(), sessionId },
    summary,
    findings: parsedFindings,
    metrics: parsedMetrics,
    narrative,
    tags,
    status,
    task_description,
    outcome_verified: normalizedOutcomeVerified,
    verification: productionVerification.claimDetected ? {
      kind: "production",
      evidence: productionVerification.evidence,
      note: productionVerification.note,
      verified: productionVerification.verified
    } : null
  };
  try {
    const reportsIndexPath = getReportsIndexPath();
    const reportsDir = getReportsDir();
    withFileLock(reportsIndexPath, () => {
      mkdirSync9(reportsDir, { recursive: true });
      writeFileSync10(join9(reportsDir, `${id2}.json`), JSON.stringify(report, null, 2) + "\n");
      const idx = reportsIndex();
      const _sum = (summary || "").slice(0, 80);
      idx.reports.push({ id: id2, type, project: report.meta.project, fingerprint: fp2, created: report.meta.created, summary: _sum });
      writeFileSync10(reportsIndexPath, JSON.stringify(idx, null, 2) + "\n");
    });
    try {
      if (fp2 && fp2 !== "unknown") {
        const pstate = loadProjectState();
        touchProjectBucket(pstate, fp2, {
          sessionId,
          projectName: projectName || "",
          reportId: id2,
          topic: type || "report"
        });
        saveProjectState(pstate);
      }
    } catch {
    }
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
  const path = join9(getReportsDir(), `${id2}.json`);
  try {
    if (!existsSync11(path))
      return null;
    return safeJsonParse2(readFileSync10(path, "utf-8"));
  } catch {
    return null;
  }
}

// src/index.ts
init_selection_manager();

// src/lib/credit-api.js
import { readFileSync as readFileSync11, writeFileSync as writeFileSync11, existsSync as existsSync12 } from "node:fs";
import { join as join10 } from "node:path";
init_state();
function getVibeOSHome8() {
  return process.env.VIBEOS_HOME || join10(process.env.HOME || "", ".claude");
}
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
    return existsSync12(AUTH_F) ? safeJsonParse4(readFileSync11(AUTH_F, "utf-8")) : {};
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
    writeFileSync11(CREDIT_CACHE_F, JSON.stringify({ total, providers: provs, ts: Date.now() }));
  } catch {
  }
}
function _cachedPct() {
  try {
    if (!existsSync12(CREDIT_CACHE_F))
      return null;
    const s = safeJsonParse4(readFileSync11(CREDIT_CACHE_F, "utf-8"));
    if (s?.total == null || !s.ts)
      return null;
    let budget = 50;
    try {
      const p = join10(getVibeOSHome8(), "model-tiers.json");
      if (existsSync12(p)) {
        const j = safeJsonParse4(readFileSync11(p, "utf-8"));
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
async function refreshCreditSnapshot() {
  await _snapshot();
  return loadCredit();
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
    const f = join10(getVibeOSHome8(), "credit-percent");
    if (existsSync12(f)) {
      const n = parseInt(readFileSync11(f, "utf-8").trim(), 10);
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
import { join as join11, dirname as dirname9 } from "node:path";

// src/lib/mode-router.js
var BRANDED_MODES = [
  {
    id: "vibeultrax",
    index: 1,
    name: "VibeUltraX",
    icon: "\u{1F3C6}",
    pipeline: ["local", "medium", "brain"],
    thinking: "full",
    tdd: "quality",
    enforcement: "strict",
    flow: "strict",
    qualityVsBrain: 107,
    costVsBrain: 58,
    desc: "3-model debate: local proposes, medium reviews, brain refines."
  },
  {
    id: "vibeqmax",
    index: 2,
    name: "VibeQMaX",
    icon: "\u2B50",
    pipeline: ["brain"],
    thinking: "full",
    tdd: "quality",
    enforcement: "strict",
    flow: "strict",
    qualityVsBrain: 100,
    costVsBrain: 50,
    desc: "Brain tier only. Same quality as Raw Brain at half cost."
  },
  {
    id: "vibemax",
    index: 3,
    name: "VibeMaX",
    icon: "\u26A1",
    pipeline: ["medium"],
    thinking: "off",
    tdd: "lazy",
    enforcement: "relaxed",
    flow: "audit",
    qualityVsBrain: 75,
    costVsBrain: 18,
    default: true,
    desc: "Default mode. Medium tier auto-escalate. Speed-first."
  },
  {
    id: "vibelitex",
    index: 4,
    name: "VibeLiteX",
    icon: "\u{1F4A1}",
    pipeline: ["medium"],
    thinking: "brief",
    tdd: "lazy",
    enforcement: "normal",
    flow: "audit",
    qualityVsBrain: 65,
    costVsBrain: 20,
    desc: "Local fallback. Medium tier with enforcement. No API required."
  }
];
var RUNTIME_MODES = [
  {
    id: "balanced",
    index: 4,
    name: "Balanced",
    icon: "\u2696\uFE0F",
    pipeline: ["medium"],
    thinking: "brief",
    tdd: "lazy",
    enforcement: "relaxed",
    flow: "audit",
    qualityVsBrain: 70,
    costVsBrain: 30,
    defaultRuntime: true,
    desc: "Default runtime. Auto-selects behavior per query."
  },
  {
    id: "speed",
    index: 5,
    name: "Speed",
    icon: "\u{1F680}",
    pipeline: ["medium"],
    thinking: "off",
    tdd: "off",
    enforcement: "relaxed",
    flow: "off",
    qualityVsBrain: 55,
    costVsBrain: 32,
    desc: "Medium tier. Fast responses, no overhead."
  },
  {
    id: "budget",
    index: 6,
    name: "Budget",
    icon: "\u{1F4B8}",
    pipeline: ["cheap"],
    thinking: "off",
    tdd: "off",
    enforcement: "off",
    flow: "off",
    qualityVsBrain: 40,
    costVsBrain: 100,
    desc: "Cheap tier only. Zero cost."
  },
  {
    id: "quality",
    index: 7,
    name: "Quality",
    icon: "\u{1F4AF}",
    pipeline: ["brain"],
    thinking: "full",
    tdd: "quality",
    enforcement: "strict",
    flow: "strict",
    qualityVsBrain: 100,
    costVsBrain: 60,
    desc: "Brain tier with full thinking and enforcement."
  },
  {
    id: "audit",
    index: 8,
    name: "Audit",
    icon: "\u{1F50D}",
    pipeline: ["brain"],
    thinking: "full",
    tdd: "quality",
    enforcement: "strict",
    flow: "strict",
    qualityVsBrain: 100,
    costVsBrain: 55,
    desc: "Brain tier security audit. OWASP validation."
  },
  {
    id: "longrun",
    index: 6,
    name: "Longrun",
    icon: "\u{1F4C8}",
    pipeline: ["cheap"],
    thinking: "off",
    tdd: "off",
    enforcement: "off",
    flow: "off",
    qualityVsBrain: 15,
    costVsBrain: 100,
    desc: "Extended sessions. Cheap tier only."
  },
  {
    id: "forensic",
    index: 7,
    name: "Forensic",
    icon: "\u{1F52C}",
    pipeline: ["brain"],
    thinking: "full",
    tdd: "quality",
    enforcement: "strict",
    flow: "strict",
    qualityVsBrain: 100,
    costVsBrain: 65,
    desc: "Deep analysis and web research. Full audit trail."
  }
];
var RAW_MODE = {
  id: "raw",
  index: 10,
  name: "Raw Brain",
  icon: "\u{1F9E0}",
  pipeline: ["brain"],
  thinking: "full",
  tdd: "\u2014",
  enforcement: "\u2014",
  flow: "\u2014",
  qualityVsBrain: 100,
  costVsBrain: 0,
  desc: "Pure v4 Pro baseline. No vibeOS overhead."
};
var ALL_MODES = [...BRANDED_MODES, ...RUNTIME_MODES, RAW_MODE];
function resolveCascadeSlot(pipeline = []) {
  const normalized = Array.isArray(pipeline) ? pipeline.map((t) => String(t || "").toLowerCase()) : [];
  if (normalized.includes("brain"))
    return "brain";
  if (normalized.includes("medium"))
    return "medium";
  return "cheap";
}

// src/lib/trinity-tool.js
init_flow_enforcer();
var MIN_TOOL_BREAKDOWN_THRESHOLD = 5e-3;
var STRESS_GAUGE_CRITICAL = 0.85;
var STRESS_GAUGE_HIGH = 0.7;
var STRESS_GAUGE_ELEVATED = 0.5;
var STRESS_GAUGE_CALM = 0.3;
var STRESS_GAUGE_MIN = 0.1;
var MOMENTUM_SIGNIFICANT_THRESHOLD = 0.3;
var DIAGNOSE_BUDGET_LINES = 50;
var CREDIT_MIN_OK = 40;
function createTrinityTool(deps) {
  return {
    description: "Control the vibeOS plugin and active model slot. Use action='status' to see the current state. Use action='enable' or 'disable' to toggle the plugin immediately. Use action='set' with slot='brain'|'medium'|'cheap' to switch model tiers (writes opencode.json). Optionally pass model='<model_id>' to set a custom model for that slot. Use action='mode' with slot='vibeultrax'|'vibeqmax'|'vibemax'|'budget'|'quality'|'speed'|'longrun'|'auto'|'balanced'|'audit'|'forensic' to switch optimization mode. Use action='thinking' with level='full'|'brief'|'off'. Use action='rebuild' to detect available models from configured providers and reassign brain/medium/cheap slots. Use action='flow' with slot='on'|'off' to toggle flow enforcer, or action='flow' alone for audit. Use action='flow' with slot='enforce' and level='on'|'off' to toggle auto-extract TODOs. Use action='enforce' with slot='on'|'off' to toggle delegation enforcement. Use action='tdd' with slot='on'|'off' to toggle auto-create test skeletons. Use action='tdd' with slot='strict' and level='on'|'off' to toggle strict failing TODO test templates. Use action='tdd' alone for audit. Use action='setup' to create a compatibility profile for first-time users. Use action='project' to show per-project analytics and optimization suggestions. Use action='patterns' to inspect learned project patterns or slot='clear' to clear them. Use action='guard' to keep AGENTS.md and README.md current. Use action='reality-check' to read verified live state and report only evidence-backed facts. Use action='api-token' with token='<new_token>' to update the API token or token='invalidate' to disable the embedded alpha token. Use action='api-bootstrap-token' with token='<new_token>' to store an alpha bootstrap token and exchange it for a normal API token on alpha builds. Call this when the user says things like 'switch to medium', 'use cheap model', 'disable plugin', or 'trinity status'.",
    args: {
      action: deps.tool.schema.enum(["status", "enable", "disable", "set", "mode", "thinking", "flow", "tdd", "setup", "project", "patterns", "rebuild", "diagnose", "help", "enforce", "repair-state", "blackbox", "report", "target", "guard", "reality-check", "api-token", "api-bootstrap-token", "todo", "todo-done", "todo-sync"]).optional(),
      slot: deps.tool.schema.enum(["brain", "medium", "cheap", "budget", "quality", "speed", "longrun", "auto", "balanced", "audit", "forensic", "vibeultrax", "vibeqmax", "vibemax", "vibelitex", "on", "off", "enforce", "strict", "preview", "apply", "clear", "savings"]).optional(),
      level: deps.tool.schema.enum(["full", "brief", "off", "on"]).optional(),
      model: deps.tool.schema.string().optional(),
      token: deps.tool.schema.string().optional()
    },
    async execute({ action, slot, level, model, token } = {}) {
      if (typeof deps._lazyRefresh === "function")
        deps._lazyRefresh();
      if (!action)
        action = "status";
      if (["brain", "medium", "cheap"].includes(action)) {
        slot = action;
        action = "set";
      }
      const keepExistingTrinitySlot = (existingSlot, nextModel) => {
        const currentOc = String(existingSlot?.oc || "").trim();
        if (currentOc && !/placeholder/i.test(currentOc) && !/^[^/]+\/[a-z-]+-model$/i.test(currentOc)) {
          return { ...existingSlot, cc: existingSlot?.cc || deps.modelToCcAlias(currentOc) };
        }
        return { oc: nextModel, cc: deps.modelToCcAlias(nextModel) };
      };
      const _brandedModeIds = ["vibeultrax", "vibeqmax", "vibemax", "vibelitex"];
      const _builtInModeIds = ["budget", "quality", "speed", "longrun", "auto", "balanced", "audit", "forensic"];
      if (!action || action === "status") {
        if (slot && (_brandedModeIds.includes(slot) || _builtInModeIds.includes(slot))) {
          action = "mode";
        } else if (["brain", "medium", "cheap"].includes(slot)) {
          action = "set";
        } else if (["full", "brief", "off"].includes(slot)) {
          action = "thinking";
          level = slot;
          slot = void 0;
        }
      } else if (_brandedModeIds.includes(action) || _builtInModeIds.includes(action)) {
        slot = action;
        action = "mode";
      } else if (["full", "brief", "off"].includes(action)) {
        level = action;
        action = "thinking";
      } else if (["on", "off"].includes(action) && !slot) {
        slot = action;
      }
      if (action === "status") {
        const sel = deps.loadSelection();
        let tiers = {};
        try {
          tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8")).trinity || {};
        } catch {
        }
        let cheapModel = "(unset)";
        const credit = deps.loadCredit();
        const effectiveLevel = sel.thinking_level || deps.thinkingLevel(credit);
        const apiFallbackActive = typeof deps.isApiFallback === "function" ? deps.isApiFallback() : false;
        const currentProvider = String(deps.currentModel || "").split("/")[0] || "";
        const selectedProvider = String(sel.selected_provider || "").split("/")[0] || "";
        const fallbackModelGuard = currentProvider === "opencode" && selectedProvider !== "opencode";
        if (deps.currentModel && sel.selected_model && deps.currentModel !== sel.selected_model && !apiFallbackActive && !fallbackModelGuard && !deps._modelLocked) {
          try {
            const providers = typeof deps._loadOpenCodeProviders === "function" ? deps._loadOpenCodeProviders(deps.directory) : {};
            const auth = deps._readAuth();
            const models = await deps.discoverAvailableModels(providers, auth);
            const trinity = buildDeterministicTrinity(models, { selectedModelId: deps.currentModel });
            if (trinity && trinity.brain) {
              const probed = {
                brain: models.find((m) => m.id === trinity.brain) || { id: trinity.brain, cost: deps._modelCost(trinity.brain), tier: deps._modelTier(trinity.brain) },
                medium: models.find((m) => m.id === trinity.medium) || { id: trinity.medium, cost: deps._modelCost(trinity.medium), tier: deps._modelTier(trinity.medium) },
                cheap: models.find((m) => m.id === trinity.cheap) || { id: trinity.cheap, cost: deps._modelCost(trinity.cheap), tier: deps._modelTier(trinity.cheap) }
              };
              const tiersData = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"));
              const oldTiers = tiersData.trinity || {};
              const oldProvider = tiersData.selection?.selected_provider || "";
              const newProvider = trinity.provider || resolveExecutionIdentity(deps.currentModel, deps.directory)?.provider || "";
              tiersData.trinity ??= {};
              const slots = ["brain", "medium", "cheap"];
              for (const s of slots) {
                const autoModel = probed[s].id;
                tiersData.trinity[s] = keepExistingTrinitySlot(oldTiers[s], autoModel);
              }
              tiersData.selection ??= {};
              tiersData.selection.selected_provider = trinity.provider || resolveExecutionIdentity(deps.currentModel, deps.directory)?.provider || "";
              tiersData.selection.selected_model = deps.currentModel;
              tiersData.selection.executed_provider = tiersData.selection.selected_provider;
              tiersData.selection.executed_model = deps.currentModel;
              const _tmp = deps.TIERS_FILE + ".tmp." + Date.now();
              deps.writeFileSync(_tmp, JSON.stringify(tiersData, null, 2) + "\n", "utf-8");
              deps.renameSync(_tmp, deps.TIERS_FILE);
              tiers = tiersData.trinity;
              sel.selected_provider = tiersData.selection.selected_provider;
              sel.selected_model = deps.currentModel;
            }
          } catch (e) {
            console.error("[vibeOS] auto-rebuild on model change failed:", e.message);
          }
        }
        const sv = deps.readLifetimeSavings();
        const ltTotal = (sv.ltTasks || 0) + (sv.ltCache || 0);
        const sesTasks = sv.sesTasks || 0;
        const sesCache = Number(deps.readFullState()?.sessions?.[deps._OC_SID]?.cache_savings_usd || 0);
        const sesWarns = Array.isArray(deps.readFullState()?.sessions?.[deps._OC_SID]?.warns) ? deps.readFullState().sessions[deps._OC_SID].warns.length : 0;
        const sesTrend = sv.sesTrend || "stable";
        const sesRate = sv.sesRatePerHour || 0;
        const missedC7 = sv.missedC7 || 0;
        const toolBreakdown = sv.sesToolBreakdown || {};
        const topTools = Object.entries(toolBreakdown).filter(([, v]) => v > MIN_TOOL_BREAKDOWN_THRESHOLD).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const brainModel = tiers?.brain?.oc || "(unset)";
        const mediumModel = tiers?.medium?.oc || "(unset)";
        cheapModel = tiers?.cheap?.oc || cheapModel;
        const activeSlot = sel.active_slot || "brain";
        const lockedSlot = deps._lockedSlot || null;
        const lockedModel = deps._lockedModel || null;
        const onboardingMode = sel.onboarding_mode || "strict";
        const currentProjectFingerprint3 = deps.currentProjectFingerprint || (typeof deps.projectFingerprint === "function" ? deps.projectFingerprint(deps.directory || "") : "");
        const reality = getRealityCheckView(currentProjectFingerprint3);
        const stressScore = deps.latestUserIntent ? deps.scoreStress(deps.latestUserIntent) : 0;
        const stressBar = stressScore > STRESS_GAUGE_CRITICAL ? "\u2588" : stressScore > STRESS_GAUGE_HIGH ? "\u2586" : stressScore > STRESS_GAUGE_ELEVATED ? "\u2585" : stressScore > STRESS_GAUGE_CALM ? "\u2583" : stressScore > STRESS_GAUGE_MIN ? "\u2582" : "\u2581";
        const stressLabel = stressScore > STRESS_GAUGE_HIGH ? "high" : stressScore > 0.4 ? "elevated" : stressScore > STRESS_GAUGE_MIN ? "calm" : "none";
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
              const momentumIcon = res.momentum > MOMENTUM_SIGNIFICANT_THRESHOLD ? "\u2197" : res.momentum > 0 ? "\u2191" : res.momentum < -MOMENTUM_SIGNIFICANT_THRESHOLD ? "\u2198" : res.momentum < 0 ? "\u2193" : "\u2192";
              const loopTag = res.is_looping ? " (loop)" : "";
              decisionLine = `${res.resolution} ${res.sub_regime} ${momentumIcon}${loopTag}`;
            }
          } catch {
          }
        }
        const execution = resolveExecutionIdentity(tiers?.[activeSlot]?.oc || deps.currentModel || "", deps.directory);
        const lines = [
          `[vibeOS-dashboard]`,
          `Model: ${activeSlot} (${tiers?.[activeSlot]?.oc || deps.currentModel || "(unset)"})`,
          `Provider: ${execution.provider_label}`,
          `Quality: ${execution.quality_label}`,
          ...isApiConnected() ? [`Backend: connected${getBackendVersion() ? ` (${getBackendVersion()})` : ""}`] : [`Backend: offline`],
          ...sel.requested_optimization_mode ? [`Requested mode: ${sel.requested_optimization_mode}`] : [],
          ...totalTurns > 0 ? [`Split: brain ${brainPct}% / worker ${workerPct}% (${totalTurns} total)`] : [],
          `Thinking: ${effectiveLevel}`,
          `Credit: ${credit}%`,
          ...qualityAvg > 0 ? [`Quality: ${Math.round(qualityAvg)}%`] : [],
          ...decisionLine ? [`Decision: ${decisionLine}`] : [],
          `|`,
          `Stress: ${stressBar} (${stressLabel})`,
          `|`,
          `Guards:`,
          `  Flow: ${sel.flow_enabled !== false ? "ON" : "OFF"}${sel.flow_enabled !== false && sel.flow_enforce ? " (extract)" : ""}`,
          `  TDD: ${sel.tdd_enforce ? "ON" : "OFF"}${sel.tdd_strict !== false ? " strict" : ""}${sel.tdd_quality !== false ? " quality" : ""}`,
          `  Enforce: ${sel.delegation_enforce ? "ON (mandatory)" : "OFF (compatibility)"}`,
          `  Lock: ${deps._modelLocked ? `LOCK ON${lockedSlot ? ` (${lockedSlot})` : ""}${lockedModel ? ` ${lockedModel}` : ""}` : "LOCK OFF"}`,
          `  Reality-check: ${reality.enabled ? `ON (${reality.scope}${reality.project_id ? `:${reality.project_id}` : ""})` : "OFF"}`,
          `  Compatibility: ${onboardingMode === "assist" ? "ASSIST (soft defaults, progressive activation)" : "STRICT (full guardrails)"}`,
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
          `  cheap:  ${cheapModel}${activeSlot === "cheap" ? "  *" : ""}`,
          `  Labels: ${(LABEL_MODES || []).join(", ")}`
        ];
        return lines.join("\n");
      }
      if (action === "reality-check") {
        const projectFingerprint2 = deps.currentProjectFingerprint || (typeof deps.projectFingerprint === "function" ? deps.projectFingerprint(deps.directory || "") : "");
        const reality = getRealityCheckView(projectFingerprint2);
        const projectState = typeof deps.loadProjectState === "function" ? deps.loadProjectState() : {};
        const projectBucket = projectFingerprint2 ? projectState?.project_hashes?.[projectFingerprint2] : null;
        const fullState = typeof deps.readFullState === "function" ? deps.readFullState() : {};
        const session = fullState?.sessions?.[deps._OC_SID] || null;
        const realityFile = join11(deps.VIBEOS_HOME || join11(process.env.HOME || "", ".claude"), "reality-check-settings.json");
        const stateFile = deps.STATE_FILE;
        const projectStateFile = join11(deps.VIBEOS_HOME || join11(process.env.HOME || "", ".claude"), "project-states.json");
        const lines = ["[vibeOS-reality-check] Verified facts only"];
        lines.push(`Project: ${deps.currentProjectName || projectBucket?.projectName || projectFingerprint2 || "unknown"}`);
        lines.push(`Project fingerprint: ${projectFingerprint2 || "(unset)"}`);
        lines.push(`State files: delegation=${deps.existsSync(stateFile) ? "present" : "missing"}, project=${deps.existsSync(projectStateFile) ? "present" : "missing"}, reality=${deps.existsSync(realityFile) ? "present" : "missing"}`);
        lines.push(`Scope: ${reality.scope}${reality.project_id ? ` (${reality.project_id})` : ""}`);
        lines.push(`Enabled: ${reality.enabled ? "YES" : "NO"}`);
        lines.push(`Rules loaded: ${reality.rules.length}`);
        for (const rule of reality.rules.slice(0, 8)) {
          lines.push(`  - ${rule.id}: ${rule.description || rule.pattern}`);
        }
        if (projectBucket?.totalSessions != null) {
          lines.push(`Project sessions: ${projectBucket.totalSessions}`);
        }
        if (session) {
          const warnCount = Array.isArray(session.warns) ? session.warns.length : 0;
          lines.push(`Session warns: ${warnCount}`);
          if (session.cache_savings_usd != null) {
            lines.push(`Session cache savings: $${Number(session.cache_savings_usd || 0).toFixed(2)}`);
          }
        }
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
        if (model) {
          try {
            const tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"));
            if (!tiers.trinity)
              tiers.trinity = {};
            if (!tiers.trinity[slot])
              tiers.trinity[slot] = {};
            tiers.trinity[slot].oc = model;
            tiers.trinity[slot].cc = model;
            tiers.trinity[slot].manual = true;
            const _tmp = deps.TIERS_FILE + ".tmp." + Date.now() + "." + Math.random().toString(36).slice(2, 8);
            deps.writeFileSync(_tmp, JSON.stringify(tiers, null, 2) + "\n");
            deps.renameSync(_tmp, deps.TIERS_FILE);
          } catch (e) {
            return `\u274C Failed to write model to tiers: ${e.message}`;
          }
        } else {
          try {
            const tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"));
            if (tiers?.trinity?.[slot]?.manual) {
              delete tiers.trinity[slot].manual;
              const _tmp = deps.TIERS_FILE + ".tmp." + Date.now() + "." + Math.random().toString(36).slice(2, 8);
              deps.writeFileSync(_tmp, JSON.stringify(tiers, null, 2) + "\n");
              deps.renameSync(_tmp, deps.TIERS_FILE);
            }
          } catch {
          }
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
          const ok = await deps.probeModel(targetModel, auth, deps._loadOpenCodeProviders());
          if (!ok)
            console.error("[vibeOS] WARN: " + targetModel + " probe failed - switching anyway");
        } catch (e) {
          console.error("[vibeOS] WARN: probe error for " + targetModel + ": " + e.message + " - switching anyway");
        }
        deps.writeSessionSlot(deps._OC_SID, slot);
        deps.writeSelection("slot_locked", true);
        const result = deps.applySlot(slot, deps.directory);
        if (!result.ok)
          return `\u274C Failed to set slot: ${result.reason}`;
        try {
          const selected = resolveExecutionIdentity(result.ocModel, deps.directory);
          if (selected) {
            deps.writeSelection("selected_provider", selected.provider || "");
            deps.writeSelection("selected_quality_tier", selected.quality || slot);
            deps.writeSelection("selected_model", selected.model || result.ocModel);
            deps.writeSelection("executed_provider", selected.provider || "");
            deps.writeSelection("executed_quality_tier", selected.quality || slot);
            deps.writeSelection("executed_model", selected.model || result.ocModel);
          }
        } catch {
        }
        deps._refreshModel(deps.directory);
        return `\u2705 Switched to ${slot} slot (${result.ocModel}). Active now (no restart needed).`;
      }
      if (action === "mode") {
        const builtInIds = ["balanced", "budget", "quality", "speed", "longrun", "audit", "forensic"];
        const brandedIds = BRANDED_MODES.map((m) => m.id);
        const allModeIds = [...builtInIds, "auto", ...brandedIds];
        if (!slot)
          return `Provide mode: ${builtInIds.join(" | ")} | auto | ${brandedIds.join(" | ")}`;
        const modeAlias = { vibemax: "vibemax" };
        const resolvedSlot = modeAlias[slot] || slot;
        const requestedMode = ["vibeultrax", "vibeqmax", "vibemax", "vibelitex"].includes(slot) ? slot : slot === resolvedSlot ? null : slot;
        if (!allModeIds.includes(resolvedSlot)) {
          return `Provide mode: ${builtInIds.join(" | ")} | auto | ${brandedIds.join(" | ")}`;
        }
        const ok = deps.saveOptimizationMode(resolvedSlot);
        if (!ok)
          return `Failed to write mode`;
        deps.writeSessionOptMode(deps._OC_SID + "_opt", resolvedSlot);
        deps.writeSelection("requested_optimization_mode", requestedMode);
        const allEntries = [...BRANDED_MODES, ...RUNTIME_MODES];
        const modeEntry = allEntries.find((e) => e.id === slot);
        if (modeEntry) {
          const tierSlot = resolveCascadeSlot(modeEntry.pipeline);
          deps.writeSessionSlot(deps._OC_SID, tierSlot);
          deps.writeSelection("slot_locked", resolvedSlot !== "auto");
          deps.writeSelection("active_slot", tierSlot);
          deps.writeSelection("active_pipeline", modeEntry.pipeline);
          deps.writeSelection("onboarding_mode", modeEntry.tdd === "quality" || modeEntry.enforcement === "strict" ? "strict" : "assist");
          deps.writeSelection("delegation_enforce", modeEntry.enforcement === "strict" || modeEntry.enforcement === "on");
          deps.writeSelection("flow_enabled", modeEntry.flow === "strict" || modeEntry.flow === "on" || modeEntry.flow === "audit");
          deps.writeSelection("flow_enforce", modeEntry.flow === "strict" || modeEntry.flow === "on");
          deps.writeSelection("tdd_enforce", modeEntry.tdd === "quality" || modeEntry.tdd === "on" || modeEntry.tdd === "strict");
          deps.writeSelection("thinking_level", modeEntry.thinking);
          const pipelineStr = modeEntry.pipeline.join(" \u2192 ");
          return `Mode set to ${slot.toUpperCase()}. Tier: ${tierSlot}. Pipeline: ${pipelineStr}`;
        }
        if (resolvedSlot === "auto") {
          deps.writeSelection("slot_locked", false);
        }
        return `Mode set to ${slot.toUpperCase()}.`;
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
          if (ok)
            deps.writeSelection("flow_enforce", slot === "on");
          if (ok && slot === "on")
            deps.writeSelection("onboarding_mode", "strict");
          return ok ? `\u2705 Flow enforcer ${slot === "on" ? "ENABLED" : "DISABLED"}` : `\u274C Failed to write model-tiers.json`;
        }
        if (slot === "enforce") {
          if (level !== "on" && level !== "off")
            return "\u274C Provide level on|off for `trinity flow enforce`";
          const enforceOn = level === "on";
          const ok = deps.writeSelection("flow_enforce", enforceOn);
          if (ok && enforceOn)
            deps.writeSelection("onboarding_mode", "strict");
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
          const sel2 = deps.loadSelection();
          if (sel2.onboarding_mode === "assist" && sel2.delegation_enforce !== true) {
            return `\u2705 Delegation enforcement is already OFF in compatibility mode.`;
          }
          return `\u274C Delegation enforcement is mandatory and cannot be disabled.`;
        }
        if (slot === "on") {
          const ok = deps.writeSelection("delegation_enforce", true);
          if (ok)
            deps.writeSelection("onboarding_mode", "strict");
          return ok ? `Delegation enforcement ENABLED \u2014 direct writes/edits are blocked on brain tier` : `\u274C Failed to write model-tiers.json`;
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
          return `LOCK ON \u2014 ${lockModel} will not change unless you force with \`trinity set\` or \`trinity lock off\`.`;
        }
        if (slot === "off") {
          deps._modelLocked = false;
          deps._lockedSlot = null;
          deps._lockedModel = null;
          console.error(`[vibeOS] model UNLOCKED \u2014 auto-reconcile re-enabled`);
          return `LOCK OFF \u2014 will auto-follow OpenCode config changes.`;
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
          if (ok && level === "on")
            deps.writeSelection("onboarding_mode", "strict");
          return ok ? `\u2705 TDD strict ${level === "on" ? "ENABLED (TODO tests fail loudly)" : "DISABLED (TODO tests non-blocking)"}` : `\u274C Failed to write model-tiers.json`;
        }
        if (slot === "quality") {
          if (level !== "on" && level !== "off") {
            return "\u274C Provide level on|off for `trinity tdd quality`";
          }
          const ok = deps.writeSelection("tdd_quality", level === "on");
          if (ok && level === "on")
            deps.writeSelection("onboarding_mode", "strict");
          return ok ? `\u2705 TDD quality templates ${level === "on" ? "ENABLED (real assertions, invalid-input, edge-case stubs)" : "DISABLED (TODO-only stubs)"}` : `\u274C Failed to write model-tiers.json`;
        }
        if (slot === "on" || slot === "off") {
          const ok = deps.writeSelection("tdd_enforce", slot === "on");
          if (ok && slot === "on")
            deps.writeSelection("onboarding_mode", "strict");
          return ok ? `\u2705 TDD enforcement ${slot === "on" ? "ENABLED (auto-create skeletons)" : "DISABLED (nudge only)"}` : `\u274C Failed to write model-tiers.json`;
        }
        const stateFile = deps.STATE_FILE;
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
      if (action === "setup") {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const existing = deps.existsSync(deps.TIERS_FILE) ? deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8")) || {} : {};
        const providers = typeof deps._loadOpenCodeProviders === "function" ? deps._loadOpenCodeProviders(deps.directory) : {};
        const auth = typeof deps._readAuth === "function" ? deps._readAuth() : {};
        let discovered = [];
        try {
          if (typeof deps.discoverAvailableModels === "function") {
            discovered = await deps.discoverAvailableModels(providers, auth);
          }
        } catch {
        }
        let selectedModel = deps.currentModel || existing?.selection?.selected_model || existing?.selection?.executed_model || "";
        if (!selectedModel) {
          try {
            for (const dir of [deps.directory || process.cwd(), deps.OPENCODE_HOME].filter(Boolean)) {
              const p = join11(dir, "opencode.json");
              if (deps.existsSync(p)) {
                const oc = deps.safeJsonParse(deps.readFileSync(p, "utf-8"));
                if (oc?.model) {
                  selectedModel = oc.model;
                  break;
                }
              }
            }
          } catch {
          }
        }
        const trinity = buildDeterministicTrinity(discovered, { selectedModelId: selectedModel });
        const brain = trinity?.brain || existing?.trinity?.brain?.oc || selectedModel || "";
        const medium = trinity?.medium || existing?.trinity?.medium?.oc || brain;
        const cheap = trinity?.cheap || existing?.trinity?.cheap?.oc || medium || brain;
        const tiers = existing && typeof existing === "object" ? existing : {};
        tiers.selection ??= {};
        tiers.trinity ??= {};
        tiers.selection.enabled = true;
        tiers.selection.active_slot = tiers.selection.active_slot || (brain ? "brain" : "medium");
        tiers.selection.onboarding_mode = "assist";
        tiers.selection.delegation_enforce = false;
        tiers.selection.flow_enabled = false;
        tiers.selection.flow_enforce = false;
        tiers.selection.tdd_enforce = false;
        tiers.selection.tdd_strict = false;
        tiers.selection.tdd_quality = false;
        tiers.selection.thinking_level = "off";
        tiers.selection.setup_completed_at = now;
        tiers.selection.selected_provider = trinity?.provider || resolveExecutionIdentity(selectedModel, deps.directory)?.provider || "";
        tiers.selection.selected_quality_tier = trinity?.selected_tier || "brain";
        tiers.selection.selected_model = trinity?.selected_model || selectedModel || "";
        tiers.selection.executed_provider = tiers.selection.selected_provider;
        tiers.selection.executed_quality_tier = tiers.selection.selected_quality_tier;
        tiers.selection.executed_model = tiers.selection.selected_model;
        if (brain)
          tiers.trinity.brain = keepExistingTrinitySlot(existing?.trinity?.brain, brain);
        if (medium)
          tiers.trinity.medium = keepExistingTrinitySlot(existing?.trinity?.medium, medium);
        if (cheap)
          tiers.trinity.cheap = keepExistingTrinitySlot(existing?.trinity?.cheap, cheap);
        deps.mkdirSync(dirname9(deps.TIERS_FILE), { recursive: true });
        deps.writeFileSync(deps.TIERS_FILE, JSON.stringify(tiers, null, 2) + "\n");
        if (typeof deps._refreshModel === "function")
          deps._refreshModel(deps.directory);
        const lines = [
          "\u2705 Compatibility profile created.",
          `  Mode: assist`,
          `  Models: ${brain || "(unset)"}${medium && medium !== brain ? ` / ${medium}` : ""}${cheap && cheap !== medium ? ` / ${cheap}` : ""}`,
          `  Provider: ${trinity?.provider || resolveExecutionIdentity(selectedModel, deps.directory)?.provider_label || "Unknown"}`,
          `  Delegation: off`,
          `  Flow: off`,
          `  TDD: off`,
          `  Blackbox: on`
        ];
        if (discovered.length > 0)
          lines.push(`  Discovered models: ${discovered.length}`);
        lines.push("Use `trinity mode quality` or `trinity enforce on` to graduate to strict mode.");
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
Small wins:`);
          for (const s of suggestions)
            lines.push(`  ${s}`);
        } else {
          lines.push(`
\u2705 No optimization suggestions \u2014 looking good.`);
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
        const _fp = deps.projectFingerprint(deps.directory);
        if (_fp) {
          try {
            deps.ensureProjectSkill(deps.directory, _fp);
          } catch (_e) {
          }
        }
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
          return "Usage: trinity api-token <token|invalidate>\nProvide a valid VIBEOS_API_TOKEN to enable remote control-vector computation, or 'invalidate' to disable it for alpha.";
        const cleanToken = String(token).trim();
        if (["invalidate", "disable", "clear", "revoke"].includes(cleanToken.toLowerCase())) {
          invalidateApiToken();
          return "[vibeOS] API token invalidated. Remote API disabled until a new token is set.";
        }
        deps.setApiToken(token);
        return "[vibeOS] API token updated. Remote API re-enabled.";
      }
      if (action === "api-bootstrap-token") {
        if (!token)
          return "Usage: trinity api-bootstrap-token <token>\nProvide an alpha bootstrap token to exchange for a normal API token on alpha builds.";
        deps.setApiBootstrapToken(token);
        const ok = typeof deps.ensureBootstrapExchange === "function" ? await deps.ensureBootstrapExchange() : false;
        if (ok)
          return "[vibeOS] Alpha bootstrap token exchanged successfully. Remote API re-enabled.";
        return "[vibeOS] Alpha bootstrap token saved. Remote API will retry the exchange on the next call.";
      }
      if (action === "rebuild") {
        const providers = typeof deps._loadOpenCodeProviders === "function" ? deps._loadOpenCodeProviders(deps.directory) : {};
        const auth = deps._readAuth();
        const models = await deps.discoverAvailableModels(providers, auth);
        const selectedModel = deps.currentModel || deps.loadSelection?.().selected_model || deps.loadSelection?.().executed_model || "";
        const trinity = buildDeterministicTrinity(models, { selectedModelId: selectedModel });
        if (!trinity) {
          return "\u274C No models discovered from any configured provider.";
        }
        const probed = {
          brain: models.find((m) => m.id === trinity.brain) || { id: trinity.brain, cost: deps._modelCost(trinity.brain), tier: deps._modelTier(trinity.brain) },
          medium: models.find((m) => m.id === trinity.medium) || { id: trinity.medium, cost: deps._modelCost(trinity.medium), tier: deps._modelTier(trinity.medium) },
          cheap: models.find((m) => m.id === trinity.cheap) || { id: trinity.cheap, cost: deps._modelCost(trinity.cheap), tier: deps._modelTier(trinity.cheap) }
        };
        const failed = [];
        for (const slot2 of ["brain", "medium", "cheap"]) {
          const candidate = probed[slot2];
          if (!candidate?.id)
            continue;
          const ok = await deps.probeModel(candidate.id, auth, providers);
          if (!ok)
            failed.push(`${slot2}: ${candidate.id}`);
        }
        if (!probed.brain) {
          return "\u274C No models responded to probe. Try checking your API keys.\n" + (failed.length > 0 ? "Failed:\n  " + failed.join("\n  ") : "No models discovered.");
        }
        try {
          const tiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"));
          const existing = tiers.trinity || {};
          tiers.trinity = {
            brain: keepExistingTrinitySlot(existing.brain, probed.brain.id),
            medium: keepExistingTrinitySlot(existing.medium, probed.medium.id),
            cheap: keepExistingTrinitySlot(existing.cheap, probed.cheap.id)
          };
          tiers.selection ??= {};
          tiers.selection.selected_provider = trinity.provider || resolveExecutionIdentity(selectedModel, deps.directory)?.provider || "";
          tiers.selection.selected_quality_tier = trinity.selected_tier || "brain";
          tiers.selection.selected_model = trinity.selected_model || selectedModel || "";
          tiers.selection.executed_provider = tiers.selection.selected_provider;
          tiers.selection.executed_quality_tier = tiers.selection.selected_quality_tier;
          tiers.selection.executed_model = tiers.selection.selected_model;
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
        const _finalTiers = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"));
        const _trinity = _finalTiers?.trinity || {};
        const _pMan = (s) => _trinity[s]?.manual === true ? " [manual, preserved]" : "";
        const lines = [
          `\u{1F50D} Auto-detected models from provider: ${trinity.provider || "unknown"}`,
          "  \u{1F9E0} brain  \u2192 " + probed.brain.id + " (tier: " + probed.brain.tier + ", $" + probed.brain.cost.toFixed(4) + "/turn) \u2705" + _pMan("brain"),
          "  \u2699  medium \u2192 " + probed.medium.id + " (tier: " + probed.medium.tier + ", $" + probed.medium.cost.toFixed(4) + "/turn) \u2705" + _pMan("medium"),
          "  \u26A1 cheap  \u2192 " + probed.cheap.id + " (tier: " + probed.cheap.tier + ", $" + probed.cheap.cost.toFixed(4) + "/turn) \u2705" + _pMan("cheap")
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
        const ocConfig = join11(deps.OPENCODE_HOME, "opencode.json");
        const apiFallbackActive = typeof deps.isApiFallback === "function" ? deps.isApiFallback() : false;
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
        if (apiFallbackActive) {
          results.push({
            ok: false,
            okLabel: "\u26A0",
            label: "model probe",
            detail: "API fallback active",
            fix: "re-enter `trinity api-token <token>` to retry the remote API"
          });
        } else if (deps.currentModel || !deps.existsSync(deps.TIERS_FILE)) {
          try {
            const auth = deps._readAuth();
            const ok = await deps.probeModel(deps.currentModel, auth, typeof deps._loadOpenCodeProviders === "function" ? deps._loadOpenCodeProviders(deps.directory) : {});
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
        let budget = DIAGNOSE_BUDGET_LINES;
        let totalBal = 0;
        let cheapModel = "";
        try {
          const j = deps.safeJsonParse(deps.readFileSync(deps.TIERS_FILE, "utf-8"));
          cheapModel = j?.trinity?.cheap?.oc || cheapModel;
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
        const apiFallbackSince = deps._apiFallbackSince || null;
        results.push({
          ok: !apiFallbackActive,
          okLabel: !apiFallbackActive ? "\u2705" : "\u26A0",
          label: "api fallback",
          detail: apiFallbackActive ? `active${apiFallbackSince ? ` since ${apiFallbackSince}` : ""}` : "off",
          fix: apiFallbackActive ? "re-enter `trinity api-token <token>` to retry the remote API" : null
        });
        const runway = typeof deps.estimateTurnsRemaining === "function" ? deps.estimateTurnsRemaining(totalBal, cheapModel) : { balanceUsd: totalBal, costPerTurn: deps.modelCostPerTurn?.(cheapModel) ?? null, turnsRemaining: null, unlimited: false };
        const runwayText = runway.costPerTurn === 0 ? `unlimited on ${cheapModel}` : runway.turnsRemaining != null && runway.costPerTurn != null ? `${Number(runway.turnsRemaining).toLocaleString()} turns on ${cheapModel} @ $${deps.formatUsd(runway.costPerTurn)}/turn` : totalBal > 0 ? `balance snapshot present; turn estimate unavailable for ${cheapModel || "cheap slot"}` : "n/a";
        const runwayOk = totalBal > 0 || runway.turnsRemaining != null || runway.costPerTurn === 0;
        const creditOk = credit >= CREDIT_MIN_OK;
        results.push({
          ok: creditOk,
          okLabel: creditOk ? "\u2705" : "\u274C",
          label: "credits",
          detail: `${credit}%${totalBal > 0 ? ` ($${totalBal.toFixed(2)} of $${budget})` : ` (of $${budget})`}`,
          fix: creditOk ? null : "run `trinity medium` to reduce spend"
        });
        results.push({
          ok: runwayOk,
          okLabel: runwayOk ? "\u2705" : "\u274C",
          label: "runway",
          detail: totalBal > 0 ? `$${totalBal.toFixed(2)} left -> ${runwayText}` : "no cached balance yet",
          fix: runwayOk ? null : "wait for a balance snapshot or configure a known cheap slot"
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
          const rf = join11(deps.REPORTS_DIR, `${r.id}.json`);
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
          if (typeof deps.setBlackboxEnabled === "function")
            deps.setBlackboxEnabled(true);
          else
            deps._blackboxEnabled = true;
          const state = deps.loadBlackboxState();
          state.enabled = true;
          deps.saveBlackboxState(state);
          return "\u2705 Blackbox decision engine ENABLED \u2014 will track resolution state and enhance system prompts.";
        }
        if (mode === "off") {
          if (typeof deps.setBlackboxEnabled === "function")
            deps.setBlackboxEnabled(false);
          else
            deps._blackboxEnabled = false;
          const state = deps.loadBlackboxState();
          state.enabled = false;
          deps.saveBlackboxState(state);
          return "\u23F8 Blackbox decision engine DISABLED.";
        }
        if (mode === "reset") {
          if (typeof deps.resetBlackboxTracker === "function")
            deps.resetBlackboxTracker();
          else
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
          "  trinity mode <profile>   Set optimization profile (balanced|budget|quality|speed|longrun|audit|forensic|auto + branded modes)",
          "  trinity thinking full|brief|off  Set reasoning depth",
          "",
          "GUARDRAILS:",
          "  trinity flow on/off       Toggle flow enforcer (code quality checks)",
          "  trinity tdd on/off        Toggle auto test skeleton creation",
          "  trinity setup             Create a compatibility profile for new users",
          "  trinity guard             Ensure AGENTS.md/README.md exist and are current",
          "  trinity reality-check     Read live state and report only verified facts",
          "  trinity api-token <token|invalidate>  Update or invalidate VIBEOS_API_TOKEN",
          "  trinity api-token <token|invalidate>  Update or invalidate VIBEOS_API_TOKEN",
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
init_state();
import { readFileSync as readFileSync12, existsSync as existsSync13 } from "node:fs";
import { join as join12 } from "node:path";
function normalizeProviderModels(providerName, models) {
  const out = [];
  if (!models || typeof models !== "object")
    return out;
  for (const rawId of Object.keys(models)) {
    const id2 = String(rawId || "").trim();
    if (!id2)
      continue;
    out.push(id2.includes("/") ? id2 : providerName + "/" + id2);
  }
  return out;
}
function resolveProviderModel(modelId, providers) {
  const raw = String(modelId || "").trim();
  if (!raw)
    return null;
  const normalized = normalizeModelId(raw);
  const entries = Object.entries(providers || {});
  for (const [providerName, providerCfg] of entries) {
    const ids = normalizeProviderModels(providerName, providerCfg?.models);
    for (const id2 of ids) {
      const bare = String(id2 || "").includes("/") ? String(id2).split("/").slice(1).join("/") : String(id2);
      if (normalizeModelId(id2) === normalized || normalizeModelId(bare) === normalized) {
        return { providerName, providerCfg, id: id2 };
      }
    }
  }
  const prefix = raw.includes("/") ? raw.split("/")[0] : "";
  if (prefix && providers?.[prefix]) {
    return { providerName: prefix, providerCfg: providers[prefix], id: raw };
  }
  return null;
}
function providerApiBaseURL(providerName, providerCfg) {
  const options = providerCfg?.options || {};
  const baseURL = String(options?.baseURL || options?.baseUrl || providerCfg?.baseURL || providerCfg?.baseUrl || providerCfg?.url || "").trim();
  if (baseURL)
    return baseURL.replace(/\/+$/, "");
  if (providerName === "deepseek")
    return "https://api.deepseek.com/v1";
  if (providerName === "openrouter")
    return "https://openrouter.ai/api/v1";
  if (providerName === "google")
    return "https://generativelanguage.googleapis.com/v1beta";
  return "";
}
function providerApiKey(providerName, providerCfg, auth) {
  const options = providerCfg?.options || {};
  const direct = String(options?.apiKey || providerCfg?.apiKey || providerCfg?.key || "").trim();
  if (direct)
    return direct;
  const scoped = String(auth?.[providerName]?.key || "").trim();
  if (scoped)
    return scoped;
  return "";
}
function _parseModelsDevTurnCost(modelRow) {
  const cost = modelRow?.cost || modelRow?.pricing || {};
  const input = Number(cost?.input ?? cost?.prompt ?? cost?.request);
  const output = Number(cost?.output ?? cost?.completion ?? cost?.response);
  if (Number.isFinite(input) && Number.isFinite(output)) {
    return (input * 700 + output * 300) / 1e6;
  }
  const single = Number(cost?.price ?? cost?.total ?? cost?.usd ?? cost?.turn_usd);
  if (Number.isFinite(single))
    return single;
  return null;
}
function _extractModelsDevPricingMap(payload, wantedIds = null) {
  const wanted = wantedIds instanceof Set ? wantedIds : null;
  const out = {};
  if (!payload || typeof payload !== "object")
    return out;
  const providerEntries = [];
  if (payload.providers && typeof payload.providers === "object") {
    if (Array.isArray(payload.providers)) {
      for (const provider of payload.providers) {
        if (!provider || typeof provider !== "object")
          continue;
        const providerName = String(provider.id || provider.name || provider.provider || "").trim();
        if (!providerName)
          continue;
        providerEntries.push([providerName, provider]);
      }
    } else {
      providerEntries.push(...Object.entries(payload.providers));
    }
  } else {
    for (const [providerName, provider] of Object.entries(payload)) {
      if (!provider || typeof provider !== "object")
        continue;
      if (!provider.models || typeof provider.models !== "object")
        continue;
      providerEntries.push([providerName, provider]);
    }
  }
  for (const [providerName, provider] of providerEntries) {
    const models = provider?.models;
    if (!models || typeof models !== "object")
      continue;
    for (const [rawId, modelRow] of Object.entries(models)) {
      const raw = String(rawId || "").trim();
      if (!raw)
        continue;
      const fullId = raw.includes("/") ? raw : `${providerName}/${raw}`;
      const normalized = normalizeModelId(fullId);
      if (wanted && !wanted.has(normalized) && !wanted.has(fullId) && !wanted.has(raw))
        continue;
      const cost = _parseModelsDevTurnCost(modelRow);
      if (cost != null && Number.isFinite(cost)) {
        out[normalized] = cost;
      }
    }
  }
  return out;
}
function collectConfiguredProviderModels(providers) {
  const all = [];
  const seen = /* @__PURE__ */ new Set();
  for (const [providerName, cfg] of Object.entries(providers || {})) {
    const ids = normalizeProviderModels(providerName, cfg?.models);
    for (const id2 of ids) {
      if (seen.has(id2))
        continue;
      seen.add(id2);
      all.push({ id: id2, provider: providerName, cost: _modelCost(id2), tier: _modelTier(id2) });
    }
  }
  return all;
}
var MODEL_RANK = { high: 3, mid: 2, budget: 1 };
function _modelCost(id2) {
  if (!id2)
    return 0;
  const c = modelCostPerTurn(id2);
  if (c != null)
    return c;
  const stripped = String(id2).includes("/") ? String(id2).split("/").slice(1).join("/") : String(id2);
  return modelCostPerTurn(stripped) ?? 0;
}
function _modelTier(id2) {
  if (!id2)
    return "budget";
  const high = HIGH_TIER_RE?.test?.(id2);
  if (high)
    return "high";
  const mid = MID_TIER_RE?.test?.(id2);
  if (mid)
    return "mid";
  const bare = String(id2).includes("/") ? String(id2).split("/").slice(1).join("/") : String(id2);
  if (HIGH_TIER_RE?.test?.(bare))
    return "high";
  if (MID_TIER_RE?.test?.(bare))
    return "mid";
  return "budget";
}
async function discoverAvailableModels(providers, auth) {
  const all = collectConfiguredProviderModels(providers);
  const seen = new Set(all.map((m) => m.id));
  const wantedIds = new Set(all.map((m) => normalizeModelId(m.id)));
  const pushIfNew = (id2, provider) => {
    if (seen.has(id2))
      return;
    seen.add(id2);
    all.push({ id: id2, provider, cost: _modelCost(id2), tier: _modelTier(id2) });
  };
  const mergePricing = (pricingMap) => {
    if (!pricingMap || typeof pricingMap !== "object")
      return;
    const next = {};
    for (const [key, value] of Object.entries(pricingMap)) {
      if (!Number.isFinite(Number(value)))
        continue;
      next[normalizeModelId(key)] = Number(value);
    }
    if (Object.keys(next).length > 0)
      _writeDynamicPricingCache(next);
  };
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
  const wantsModelsDev = Object.keys(providers || {}).some((name) => /^(google|opencode|qwen)$/i.test(name)) || all.some((m) => /^(google|opencode|qwen)\//i.test(m.id));
  if (wantsModelsDev) {
    try {
      const res = await fetch("https://models.dev/api.json", {
        signal: AbortSignal.timeout(5e3)
      });
      if (res.ok) {
        const body = await res.json();
        const pricingMap = _extractModelsDevPricingMap(body, wantedIds);
        mergePricing(pricingMap);
      }
    } catch (e) {
      console.error("[vibeOS] models.dev pricing probe failed:", e.message);
    }
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
  const normalizeModelIdLocal = (id2) => String(id2 || "").toLowerCase().replace(/\./g, "-").replace(/^(openrouter|opencode|deepseek|anthropic|google)\//, "");
  const isDeprecatedDeepseekChat = (id2) => normalizeModelIdLocal(id2).includes("deepseek-chat");
  const hasReplacementDeepseek = unique.some((m) => {
    const raw = normalizeModelIdLocal(m.id);
    return raw.startsWith("deepseek-") && !raw.includes("deepseek-chat");
  });
  const ranked = hasReplacementDeepseek ? unique.filter((m) => !isDeprecatedDeepseekChat(m.id)) : unique;
  if (ranked.length === 0)
    return null;
  const modelPreference = (id2) => {
    const raw = normalizeModelIdLocal(id2);
    if (raw.includes("deepseek-v4-flash"))
      return 2;
    if (raw.includes("deepseek-chat"))
      return -1;
    return 0;
  };
  ranked.sort((a, b) => {
    const ra = MODEL_RANK[a.tier] || 0;
    const rb = MODEL_RANK[b.tier] || 0;
    if (rb !== ra)
      return rb - ra;
    const pref = modelPreference(b.id) - modelPreference(a.id);
    return pref !== 0 ? pref : b.cost - a.cost;
  });
  const cheapest = [...ranked].sort((a, b) => {
    if (a.cost !== b.cost)
      return a.cost - b.cost;
    const pref = modelPreference(b.id) - modelPreference(a.id);
    return pref !== 0 ? pref : (MODEL_RANK[b.tier] || 0) - (MODEL_RANK[a.tier] || 0);
  });
  return {
    brain: ranked[0],
    medium: ranked.length > 1 ? ranked[1] : ranked[0],
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
async function probeModel(modelId, auth, providers = null) {
  if (!modelId || !auth)
    return true;
  const id2 = String(modelId || "");
  if (id2.startsWith("opencode/"))
    return true;
  const provider = resolveProviderModel(id2, providers);
  const providerName = provider?.providerName || (id2.includes("/") ? id2.split("/")[0] : "");
  const providerCfg = provider?.providerCfg || providers?.[providerName] || {};
  const reqModel = provider?.id ? provider.id.includes("/") ? provider.id.split("/").slice(1).join("/") : provider.id : id2.includes("/") ? id2.split("/").slice(1).join("/") : id2;
  const apiKey = providerApiKey(providerName, providerCfg, auth);
  const baseURL = providerApiBaseURL(providerName, providerCfg);
  if (!providerName || !reqModel) {
    return true;
  }
  if (!apiKey) {
    console.error("[vibeOS] probeModel: no API key for " + id2);
    return false;
  }
  if (!baseURL && providerName !== "google") {
    return true;
  }
  try {
    const isGoogleDirect = providerName === "google" && !String(baseURL || "").includes("chat/completions");
    const apiUrl = isGoogleDirect ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(reqModel)}:generateContent?key=${encodeURIComponent(apiKey)}` : `${baseURL || providerApiBaseURL(providerName, providerCfg) || ""}/chat/completions`;
    const headers = isGoogleDirect ? { "Content-Type": "application/json", "x-goog-api-key": apiKey } : {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json"
    };
    const body = isGoogleDirect ? JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "ok" }] }],
      generationConfig: { maxOutputTokens: 1 }
    }) : JSON.stringify({
      model: reqModel,
      messages: [{ role: "user", content: "ok" }],
      max_tokens: 1
    });
    const res = await fetch(apiUrl, {
      method: "POST",
      headers,
      body,
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
import { readFileSync as readFileSync14, appendFileSync as appendFileSync4, mkdirSync as mkdirSync11 } from "node:fs";
import { join as join15 } from "node:path";

// src/lib/hooks/chat-transform.js
init_state();
import { readFileSync as readFileSync13, writeFileSync as writeFileSync13, appendFileSync as appendFileSync3, existsSync as existsSync14, mkdirSync as mkdirSync10, rmSync as rmSync5, readdirSync as readdirSync3, statSync as statSync7 } from "node:fs";
import { join as join14, dirname as dirname10, basename as basename3 } from "node:path";
import { createHash as createHash3 } from "node:crypto";

// src/lib/mode-policy.js
init_state();
var STRESS_QUALITY_THRESHOLD = 1.5;
var BASELINE_MODE = "budget";
var LOOP_REGIMES = /* @__PURE__ */ new Set(["LOOPING", "DIVERGENT"]);
var QUALITY_REGIMES = /* @__PURE__ */ new Set(["CONVERGING", "CLOSED"]);
var MANUAL_MODES = /* @__PURE__ */ new Set(["balanced", "quality", "speed", "longrun", "audit", "forensic", "vibemax", "vibeqmax", "vibeultrax"]);
function normalizeMode(mode) {
  const normalized = String(mode || BASELINE_MODE).toLowerCase();
  if (normalized === "auto" || normalized === "")
    return BASELINE_MODE;
  if (normalized === "budget" || normalized === "quality" || normalized === "speed" || normalized === "longrun" || normalized === "balanced" || normalized === "audit" || normalized === "forensic" || normalized === "vibemax" || normalized === "vibeqmax" || normalized === "vibeultrax") {
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
  if (suggestedMode === "vibeultrax" || suggestedMode === "vibeqmax" || suggestedMode === "vibemax" || suggestedMode === "audit" || suggestedMode === "forensic")
    return suggestedMode;
  if (regime === "LOOPING")
    return "quality";
  if (suggestedMode === "speed")
    return "speed";
  if (LOOP_REGIMES.has(regime))
    return "speed";
  if (QUALITY_REGIMES.has(regime) || suggestedMode === "quality")
    return "quality";
  return stress > STRESS_QUALITY_THRESHOLD ? "quality" : "budget";
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
  if (normalized === "quality" || normalized === "longrun" || normalized === "audit" || normalized === "forensic" || normalized === "vibeultrax" || normalized === "vibeqmax")
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
    const shouldStartEpisode = LOOP_REGIMES.has(regime) || suggested === "speed" || QUALITY_REGIMES.has(regime) || Number(policy.problem_streak || 0) >= 2 || Number(policy.problem_streak || 0) >= 1 && stress > 1.5;
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

// src/lib/hooks/chat-transform.js
init_smart_cache();
init_selection_manager();

// src/lib/index-helpers.js
init_state();
init_pattern_helpers();
import { join as join13 } from "node:path";
import { writeFileSync as writeFileSync12 } from "node:fs";

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
    row.sessions = [.../* @__PURE__ */ new Set([...row.sessions || [], getCurrentSessionId()])].slice(-10);
    row.lastSeen = now;
    if (meta.family)
      row.family = meta.family;
    if (meta.path)
      row.path = meta.path;
    target[key] = row;
    touchProjectBucket(pstate, currentProjectFingerprint, {
      sessionId: getCurrentSessionId(),
      projectName: currentProjectName || "",
      topic: key
    });
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
  try {
    const client2 = getApiClient();
    if (client2 && _OC_SID) {
      client2.patternsObserve(_OC_SID, meta?.family || meta?.path || "unknown", summary, key, currentProjectFingerprint || "").catch(() => {
      });
    }
  } catch {
  }
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
      const family = t === "bash" ? commandFamily(args.command || args.cmd || args.script || "") : t;
      const generalizedKey = `pattern:${t}:${family}`;
      const summary = `Pattern detected: repeated ${t} calls (${family}) \u2014 ${target}`;
      recordFrictionPattern(generalizedKey, summary, { family: family || t, path: target, tool: t });
      _patternFiredKeys.add(generalizedKey);
    }
    if (repeat > 8) {
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
      if (prev.tool !== ev.tool) {
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
var MAX_SAVE_EST_PER_WARN = 5;
function recordSaving(tool2, reason, saveEst, meta = {}) {
  try {
    if (!saveEst || saveEst <= 0)
      return 0;
    if (saveEst > MAX_SAVE_EST_PER_WARN)
      saveEst = MAX_SAVE_EST_PER_WARN;
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
      if (reason && firstWord) {
        const now = Date.now();
        const warnKey = `${_OC_SID}:${firstWord}`;
        ses.seenWarnKeys ??= {};
        let deduped = false;
        for (let i = ses.warns.length - 1; i >= 0 && !deduped; i--) {
          const w = ses.warns[i];
          if (w?.key === warnKey && now - w.ts < WARN_DEDUPE_WINDOW_MS) {
            w.count = (w.count || 1) + 1;
            w.est_savings_usd = roundUsd(Number(w.est_savings_usd || 0) + saveEst);
            w.saveEst = roundUsd(Number(w.saveEst || 0) + saveEst);
            ses.total_savings_usd = roundUsd(Number(ses.total_savings_usd || 0) + saveEst);
            s.lifetime.total_savings_usd = roundUsd(Number(s.lifetime.total_savings_usd || 0) + saveEst);
            deduped = true;
          }
        }
        if (!deduped) {
          ses.total_savings_usd = roundUsd(Number(ses.total_savings_usd || 0) + saveEst);
          s.lifetime.total_savings_usd = roundUsd(Number(s.lifetime.total_savings_usd || 0) + saveEst);
          s.lifetime.warn_count = (s.lifetime.warn_count || 0) + 1;
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
          const sp = join13(sd, "delegation-state-hint.txt");
          try {
            writeFileSync12(sp, JSON.stringify({ sid, total_savings: s.lifetime.total_savings_usd, last_reason: reason }), "utf8");
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
    const projectFingerprint2 = typeof meta?.projectFingerprint === "string" && meta.projectFingerprint.trim() ? meta.projectFingerprint.trim() : currentProjectFingerprint || "";
    const projectName = typeof meta?.projectName === "string" && meta.projectName.trim() ? meta.projectName.trim() : currentProjectName || "";
    const sessionId = typeof meta?.sessionId === "string" && meta.sessionId.trim() ? meta.sessionId.trim() : getCurrentSessionId() || _OC_SID;
    const entry = JSON.stringify({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      usd: saveEst,
      sid: _OC_SID,
      tool: tool2,
      reason,
      saveEst,
      fgp: projectFingerprint2
    });
    _ledgerBuffer.push(entry);
    try {
      if (projectFingerprint2) {
        const pstate = loadProjectState();
        touchProjectBucket(pstate, projectFingerprint2, {
          sessionId,
          projectName,
          topic: tool2 || reason || "saving"
        });
        saveProjectState(pstate);
      }
    } catch {
    }
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
  CONTEXT7: 14e-5
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
  },
  speed: {
    tier_bias: "medium",
    thinking_mode: "off",
    enforcement_mode: "relaxed",
    flow_mode: "audit",
    tdd_mode: "lazy",
    context7_urgency: "preferred",
    wbp_verbosity: "minimal",
    agent_mode: "auto",
    directive: "[SPEED mode] Break the loop. Try a different approach. Verify each step before proceeding. If stuck, step back and reassess assumptions. Do NOT repeat the same failing strategy. Prioritize getting a working solution over optimal code. Use Task subagents to parallelize exploration. After 3 failed attempts, explicitly ask the user for guidance."
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
function resolveTemplate(prevTemplate, stressScore, userText, creditPercent, subRegime) {
  if (detectSecuritySignal(userText))
    return "security";
  if (detectBudgetSignal(creditPercent)) {
    const regime = String(subRegime || "").toUpperCase();
    if (regime === "LOOPING" || regime === "DIVERGENT")
      return "quality";
    return "save";
  }
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
init_flow_enforcer();
var BYTES_PER_TOKEN = 4;
function getVibeOSHome9() {
  return process.env.VIBEOS_HOME || join14(process.env.HOME || "", ".claude");
}
function mergeRemoteControlVector(remoteControlVector, localControlVector) {
  return {
    ...remoteControlVector,
    agent_mode: localControlVector?.agent_mode,
    tier_bias: localControlVector?.tier_bias,
    optimization_mode: localControlVector?.optimization_mode,
    enforcement_mode: localControlVector?.enforcement_mode,
    flow_mode: localControlVector?.flow_mode,
    tdd_mode: localControlVector?.tdd_mode,
    thinking_mode: localControlVector?.thinking_mode
  };
}
function resolveRestorableOpenCodeAgent(currentSel) {
  const remembered = typeof currentSel?.previous_default_agent === "string" ? currentSel.previous_default_agent.trim() : "";
  if (remembered && remembered !== "plan")
    return remembered;
  try {
    const configDir = dirname10(TRINITY_OPENCODE_CONFIG || join14(getOpenCodeHome(), "opencode.json"));
    const candidates = readdirSync3(configDir).filter((name) => /^opencode\.json\.bak/.test(name)).map((name) => {
      const path = join14(configDir, name);
      return { path, mtime: statSync7(path).mtimeMs };
    }).sort((a, b) => b.mtime - a.mtime);
    for (const candidate of candidates) {
      try {
        const snapshot = safeJsonParse2(readFileSync13(candidate.path, "utf-8"));
        const agent = typeof snapshot?.default_agent === "string" ? snapshot.default_agent.trim() : "";
        if (agent && agent !== "plan")
          return agent;
      } catch {
      }
    }
  } catch {
  }
  return null;
}
function ensureProjectContext(hookDirectory) {
  const resolved = projectFingerprint(hookDirectory || currentProjectFingerprint || process.cwd() || "");
  if (resolved && resolved !== currentProjectFingerprint)
    setCurrentProjectFingerprint(resolved);
  if (hookDirectory) {
    const name = hookDirectory.split("/").filter(Boolean).pop() || "unknown";
    if (name && name !== currentProjectName)
      setCurrentProjectName(name);
  }
  try {
    if (resolved) {
      const pstate = loadProjectState();
      touchProjectBucket(pstate, resolved, {
        sessionId: _OC_SID3,
        projectName: currentProjectName || (hookDirectory ? hookDirectory.split("/").filter(Boolean).pop() || "" : "")
      });
      saveProjectState(pstate);
    }
  } catch {
  }
  return resolved;
}
var latestUserIntent = null;
var _OC_SID3 = "opencode-" + (process.pid || "x") + "-" + Date.now();
var _latestBlackboxState3 = null;
var _latestBlackboxLoopMsg3 = null;
var _latestBlackboxPivotMsg3 = null;
var _prevBlackboxRegime = null;
var _currentTemplate = DEFAULT_TEMPLATE;
var _prevTemplate = null;
var _turnCountInject = 0;
var correctionSeenKeys = /* @__PURE__ */ new Set();
async function apiComputeControlVector(state, action, optimizationMode) {
  try {
    const res = await remoteCall("blackboxControlVector", [state, action, optimizationMode], null);
    if (res?.control_vector) {
      const local = computeControlVector2(state, action, optimizationMode);
      const merged = mergeRemoteControlVector(res.control_vector, local);
      if (res.rf_prediction?.mode && res.rf_prediction.mode !== res.control_vector?.optimization_mode) {
        merged.optimization_mode = res.rf_prediction.mode;
      }
      return merged;
    }
  } catch {
  }
  return computeControlVector2(state, action, optimizationMode);
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
  const label = currentProjectName || (directory3 ? basename3(directory3) : "");
  if (!label)
    return null;
  return `[project memory] Active project: ${label}. Stay focused on the current repository and prefer the existing workflow.`;
}
function ensureProjectSkill(dir, fp2) {
  const skillsDir = join14(dir, ".opencode", "skills");
  const projectName = basename3(dir);
  const skillDir = join14(skillsDir, projectName);
  const skillPath = join14(skillDir, "SKILL.md");
  if (existsSync14(skillPath)) {
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
    mkdirSync10(skillDir, { recursive: true });
    writeFileSync13(skillPath, content, "utf-8");
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
    const sid = _OC_SID3;
    if (!cv.agent_mode) {
      try {
        clearWorkspaceFollowupPauseForSession(sid);
      } catch {
      }
    }
    const persistOptimizationMode = options.persistOptimizationMode !== false;
    const currentSel = loadSelection();
    const userSetMode = loadSessionOptMode(sid + "_opt");
    const userOptMode = userSetMode || loadOptimizationMode();
    const isManualMode = userSetMode && userOptMode !== "auto";
    const writeIf = (key, val) => {
      const sel = loadSelection();
      if (sel[key] !== val)
        writeSelection(key, val);
    };
    if (isManualMode) {
      const allEntries = [...BRANDED_MODES, ...RUNTIME_MODES];
      const modeEntry = allEntries.find((e) => e.id === userOptMode);
      if (modeEntry) {
        writeIf("active_pipeline", JSON.stringify(modeEntry.pipeline));
      }
    }
    writeIf("enabled", true);
    const compatibilityMode = currentSel.onboarding_mode === "assist";
    const flowManuallyDisabled = currentSel.flow_enabled === false && currentSel.flow_enforce === false;
    writeIf("delegation_enforce", compatibilityMode ? cv.enforcement_mode === "strict" : cv.enforcement_mode !== "relaxed");
    if (!flowManuallyDisabled) {
      if (compatibilityMode) {
        writeIf("flow_enabled", cv.flow_mode === "strict");
        writeIf("flow_enforce", cv.flow_mode === "strict");
      } else if (cv.flow_mode === "audit") {
        writeIf("flow_enabled", true);
        writeIf("flow_enforce", false);
      } else {
        writeIf("flow_enabled", true);
        writeIf("flow_enforce", true);
      }
    }
    if (compatibilityMode) {
      writeIf("tdd_enforce", cv.tdd_mode === "strict");
      writeIf("tdd_strict", cv.tdd_mode === "strict");
    } else if (cv.tdd_mode === "lazy") {
      writeIf("tdd_enforce", false);
      writeIf("tdd_strict", false);
    } else {
      writeIf("tdd_enforce", true);
      writeIf("tdd_strict", cv.tdd_mode === "strict");
    }
    if (cv.thinking_mode) {
      const nextThinking = cv.thinking_mode === "auto" ? "off" : cv.thinking_mode;
      if (currentSel.thinking_level !== nextThinking)
        writeIf("thinking_level", nextThinking);
    }
    if (persistOptimizationMode && cv.optimization_mode && userOptMode !== "auto") {
      const fallbackPinned = isApiFallback() && cv.optimization_mode === "vibelitex";
      const previousOptMode2 = typeof currentSel.previous_optimization_mode === "string" ? currentSel.previous_optimization_mode : null;
      const prevSessionKey2 = `${sid}_prev_opt`;
      const sessionPreviousOptMode = loadSessionOptMode(prevSessionKey2);
      const liveSlot = String(currentSel.active_slot || cv.tier_bias || "").toLowerCase();
      const inferredRecoveryMode = liveSlot === "brain" ? "quality" : liveSlot === "medium" ? "vibemax" : "budget";
      const restoreMode = sessionPreviousOptMode || previousOptMode2 || inferredRecoveryMode;
      const canRestorePrevious = !!restoreMode && cv.optimization_mode !== "vibelitex" && (previousOptMode2 !== null || sessionPreviousOptMode !== null);
      if (fallbackPinned) {
        const snapshotMode = currentSel.optimization_mode && currentSel.optimization_mode !== "vibelitex" ? currentSel.optimization_mode : previousOptMode2 || sessionPreviousOptMode || inferredRecoveryMode;
        if (snapshotMode && snapshotMode !== "vibelitex") {
          writeIf("previous_optimization_mode", snapshotMode);
          writeSessionOptMode(prevSessionKey2, snapshotMode);
        }
      } else if (canRestorePrevious) {
        writeIf("optimization_mode", restoreMode);
        writeIf("previous_optimization_mode", null);
        writeSessionOptMode(sid, restoreMode);
        writeSessionOptMode(prevSessionKey2, "");
      } else if (userOptMode !== cv.optimization_mode) {
        writeIf("optimization_mode", cv.optimization_mode);
        if (previousOptMode2)
          writeIf("previous_optimization_mode", null);
      }
    }
    const slot = cv.tier_bias;
    const slotLocked = currentSel.slot_locked === true;
    if (slot && slot !== "auto" && !slotLocked && !_modelLocked) {
      const existingSlot = loadSessionSlot(sid);
      if (existingSlot !== slot) {
        writeSessionSlot2(sid, slot);
        writeIf("vector_changed_slot", slot);
        writeIf("vector_changed_at", Date.now());
        const applied = applySlot2(slot);
        if (!applied?.ok) {
          console.error(`[vibeOS] failed to apply slot ${slot}: ${applied?.reason || "unknown"}`);
        }
      }
    }
    if (cv.agent_mode) {
      try {
        const OC_CONFIG = TRINITY_OPENCODE_CONFIG || join14(getOpenCodeHome(), "opencode.json");
        if (existsSync14(OC_CONFIG)) {
          const oc = safeJsonParse2(readFileSync13(OC_CONFIG, "utf-8"));
          if (oc.default_agent !== cv.agent_mode) {
            if (cv.agent_mode === "plan" && oc.default_agent && oc.default_agent !== "plan") {
              writeSelection("previous_default_agent", oc.default_agent);
            }
            oc.default_agent = cv.agent_mode;
            writeFileSync13(OC_CONFIG, JSON.stringify(oc, null, 2) + "\n");
          }
        }
      } catch {
      }
    } else {
      try {
        const OC_CONFIG = TRINITY_OPENCODE_CONFIG || join14(getOpenCodeHome(), "opencode.json");
        if (existsSync14(OC_CONFIG)) {
          const oc = safeJsonParse2(readFileSync13(OC_CONFIG, "utf-8"));
          const restoreAgent = oc.default_agent === "plan" ? resolveRestorableOpenCodeAgent(currentSel) : null;
          if (restoreAgent && oc.default_agent === "plan") {
            oc.default_agent = restoreAgent;
            writeFileSync13(OC_CONFIG, JSON.stringify(oc, null, 2) + "\n");
            if (currentSel.previous_default_agent)
              writeSelection("previous_default_agent", null);
          }
        }
      } catch {
      }
    }
    if (cv.optimization_mode && cv.optimization_mode !== "vibelitex") {
      const finalSel = loadSelection();
      if (finalSel.optimization_mode === "vibelitex") {
        const liveSlot = String(finalSel.active_slot || currentSel.active_slot || cv.tier_bias || "").toLowerCase();
        const restoreCandidate = finalSel.previous_optimization_mode || loadSessionOptMode(prevSessionKey) || previousOptMode || (liveSlot === "brain" ? "quality" : liveSlot === "medium" ? "vibemax" : "budget");
        if (restoreCandidate && restoreCandidate !== "vibelitex") {
          writeSelection("optimization_mode", restoreCandidate);
          writeSelection("previous_optimization_mode", null);
          writeSessionOptMode(sid, restoreCandidate);
          writeSessionOptMode(prevSessionKey, "");
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
  const scoped = onSystemTransform._briefedProjects || briefedProjects;
  if (scoped.has(key))
    return true;
  scoped.add(key);
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
      const globalDir = join14(SCRATCHPAD_ROOT, "by-hash");
      const sessPath = join14(getSessionScratchpadDir(), `${hash}.txt`);
      const globalPath = join14(globalDir, `${hash}.txt`);
      try {
        mkdirSync10(globalDir, { recursive: true });
        ensureSessionScratchpadDirs();
        if (!existsSync14(globalPath)) {
          writeFileSync13(globalPath, raw);
          indexAppend(hash, part.tool, raw.length);
          if (existsSync14(sessPath))
            rmSync5(sessPath, { force: true });
        }
        const invPart = parts.slice(0, parts.indexOf(part)).reverse().find((p) => p?.type === "tool" && p?.tool === part.tool && p?.state?.input && p?.state?.status !== "completed");
        if (invPart?.state?.input) {
          const toolKey2 = TOOL_NAME_NORMALIZE[part.tool] || part.tool;
          const inputHash = createHash3("sha256").update(`${toolKey2}
${stableJson(invPart.state.input)}
`).digest("hex").slice(0, 16);
          const ptrPath = join14(getSessionScratchpadDir(), `${inputHash}.ptr`);
          try {
            writeFileSync13(ptrPath, JSON.stringify({ contentHash: hash, tool: part.tool }));
          } catch {
          }
        }
      } catch (err) {
        console.error(`[vibeOS] ctx-compress write failed: ${err.message}`);
        continue;
      }
      if (!isCold)
        continue;
      const summary = raw.slice(0, 200).replace(/\n+/g, " ").trim() + (raw.length > 200 ? "\u2026" : "");
      const ref = `${COMPRESS_MARKER} [${raw.length} chars compressed -- cold storage at ${globalPath}] [summary] ${summary}`;
      state.output = ref;
      compressedBytes += raw.length - ref.length;
      const toolKey = TOOL_NAME_NORMALIZE[part.tool] || part.tool;
      const rate = cacheSavePer1MInputTokens(currentModel);
      if (rate > 0) {
        const inputTokens = Math.max(1, Math.round((raw.length - ref.length) / BYTES_PER_TOKEN));
        const saveEst = Math.max(1e-4, Math.round(inputTokens * rate / 1e6 * 1e4) / 1e4);
        recordCacheSaving(toolKey, saveEst, { hash });
      }
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
    const sid = _OC_SID3;
    ensureProjectContext(process.cwd() || "");
    const serialized = tracker.serialize();
    const existingSession = state.sessions[sid] || {};
    if (!state.sessions[sid])
      state.sessions[sid] = {};
    state.sessions[sid].control_history ??= [];
    const st = scoreStress(latestUserIntent);
    if (st) {
      localState.latest_stress_multiplier = st;
      saveSessionStress(st, st > 1.5 ? "critical" : st > 0.7 ? "elevated" : st > 0.3 ? "moderate" : "none");
    }
    localState.user_text = latestUserIntent;
    const modePreview = peekBudgetFirstMode({
      requestedMode: loadOptimizationMode(),
      subRegime: localState.sub_regime || "INIT",
      stress: st || 0
    });
    const cv = await apiComputeControlVector(localState, void 0, modePreview.mode);
    const lastEntry = state.sessions[sid].control_history?.[state.sessions[sid].control_history.length - 1];
    const cvFingerprint = JSON.stringify({ regime: localState.sub_regime, mode: cv?.enforcement_mode });
    const isDuplicate = lastEntry && (lastEntry.fingerprint === cvFingerprint || lastEntry.regime === localState.sub_regime && lastEntry.enforcement === cv?.enforcement_mode);
    if (!isDuplicate) {
      const turnNum = (existingSession.turn_counter || 0) + 1;
      const entry = buildControlHistoryEntry2(turnNum, localState.sub_regime || "INIT", cv);
      entry.fingerprint = cvFingerprint;
      state.sessions[sid].control_history.push(entry);
      if (state.sessions[sid].control_history.length > 100) {
        state.sessions[sid].control_history = state.sessions[sid].control_history.slice(-100);
      }
    }
    state.sessions[sid] = {
      ...existingSession,
      ...serialized,
      project_fingerprint: currentProjectFingerprint || existingSession.project_fingerprint || "",
      sub_regime: localState.sub_regime || existingSession.sub_regime || "INIT",
      regime: localState.sub_regime || existingSession.regime || "INIT",
      resolution: localState.resolution || existingSession.resolution || "unresolved",
      momentum: localState.momentum ?? existingSession.momentum ?? 0,
      signals: localState.signals || existingSession.signals || {},
      intent_state: localState.intent_state || existingSession.intent_state || {},
      continuity_state: localState.continuity_state || existingSession.continuity_state || "HIGH",
      is_looping: localState.is_looping ?? existingSession.is_looping ?? false,
      loop_consecutive: localState.loop_consecutive ?? existingSession.loop_consecutive ?? 0,
      loop_intervention_level: localState.loop_intervention_level || existingSession.loop_intervention_level || "none",
      pivot_detected: localState.pivot_detected ?? existingSession.pivot_detected ?? false,
      pivot_score: localState.pivot_score ?? existingSession.pivot_score ?? 0,
      outcome: localState.outcome || existingSession.outcome || null,
      control_history: state.sessions[sid].control_history,
      optimization_mode: existingSession.optimization_mode || null,
      active_slot: existingSession.active_slot || null,
      turn_counter: (existingSession.turn_counter || 0) + 1
    };
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
  return "[cost policy] If mcp__context7__resolve-library-id and mcp__context7__get-library-docs are available, prefer them over WebFetch/WebSearch for library and framework docs (docs.*, readthedocs.*, npmjs.com/package/*, pypi.org/project/*, pkg.go.dev, /api/reference/). Use the cheapest accurate source first. This usually saves about $0.06/turn." + (C7_URGENCY[urgency] || "");
}
function thinkingDirective(level) {
  const credit = loadCredit();
  const creditNote = `credit ${credit}%`;
  if (level === "brief") {
    return `[thinking policy] Reasoning depth: BRIEF (manually set, ${creditNote}). Keep the answer crisp and only expand when the task truly needs it.`;
  }
  return `[thinking policy] Reasoning depth: OFF (manually set, ${creditNote}). Respond directly, avoid extra scratch work, and reserve extended thinking for when the user asks for it.`;
}
function regimeAwareToolStyleDirective(regime, mode, stress) {
  const normalizedRegime = String(regime || "INIT").toUpperCase();
  const normalizedMode = String(mode || "budget").toLowerCase();
  const stressLabel = stress > 1.5 ? "high stress" : stress > 0.4 ? "elevated stress" : "calm";
  const regimeToneByName = {
    INIT: "The session is starting, so keep descriptions lightweight, status-oriented, and easy to scan.",
    DIVERGENT: "The session is branching, so keep descriptions exploratory and open to alternatives without sounding vague.",
    EXPLORING: "The session is investigating, so keep descriptions discovery-oriented, specific, and lightweight.",
    REFINING: "The session is polishing implementation, so keep descriptions action-oriented, concrete, and tied to the next visible code step.",
    IMPLEMENTING: "The session is executing implementation work, so keep descriptions exact, build-focused, and next-step driven.",
    RESEARCH: "The session is researching, so keep descriptions evidence-seeking, careful, and explicit about what was checked.",
    REVIEWING: "The session is reviewing, so keep descriptions audit-style, traceable, and focused on proof.",
    DESIGNING: "The session is designing, so keep descriptions structured, intent-driven, and aligned to the target shape.",
    CONVERGING: "The session is converging, so keep descriptions closure-oriented, exact, and ready for final verification.",
    CLOSED: "The session is closing, so keep descriptions final, concise, and clearly outcome-focused.",
    LOOPING: "The session is looping, so keep descriptions verification-first, state-aware, and loop-breaking.",
    AUDIT: "The session is auditing, so keep descriptions evidence-first, compliance-aware, and traceable.",
    FORENSIC: "The session is doing forensic work, so keep descriptions investigative, reproducible, and proof-heavy."
  };
  const regimeTone = regimeToneByName[normalizedRegime] || "The session should stay aligned to the active regime and avoid generic filler.";
  return `[tool style: dopamine] Active regime: ${normalizedRegime}; mode: ${normalizedMode}; stress: ${stressLabel}. When calling the bash tool, use a short, calm, progress-focused description that matches the current regime. ${regimeTone} Name the user-visible milestone being advanced, keep the wording human, and avoid hype or raw technical labels. Combine independent bash commands into a single call with && or ;.`;
}
function flowTodosDirective() {
  const pendingTodos = loadTodos().filter((t) => t.status === "pending").length;
  if (pendingTodos === 0)
    return null;
  return "[vibeOS] " + pendingTodos + " extracted TODO/FIXME items are waiting. If useful, call `todowrite` so they land in the native task list.";
}
function empiricalAnswerDirective() {
  return '[empirical answer] Prefer verified facts over assumptions. If something is not directly checked against tools, files, logs, or user-provided evidence, label it as unverified or say "I cannot verify that". Separate evidence, inference, and suggestions. In multi-turn work, carry forward only evidence-backed facts and keep any guess explicitly marked as a guess.';
}
function realityCheckDirective() {
  const view = getRealityCheckView(currentProjectFingerprint || "");
  if (!view.enabled)
    return null;
  const scope = view.scope === "project" && view.project_id ? `project:${view.project_id}` : "global";
  return `[reality-check ${scope}] Before saying something is done, complete, ready, successful, trained, fixed, or working, verify the actual files and state on disk. If the user asks for a reality check, read the relevant files first and report only verified facts.`;
}
function patternDirective(fp2) {
  const patterns = promotedProjectPatterns(fp2);
  if (!patterns || patterns.length === 0)
    return null;
  const gl = loadGlobalLearning();
  const pq = gl.patternQuality || { ignoredCount: 0, trustedCount: 0 };
  if (pq.ignoredCount > 0 && (pq.trustedCount === 0 || pq.ignoredCount >= pq.trustedCount * 5))
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
    tiers = safeJsonParse2(readFileSync13(TIERS_FILE, "utf-8")).trinity || {};
  } catch {
  }
  const active = sel.active_slot || "medium";
  const current = currentModel || "(unknown)";
  return "[vibeOS] Active plugin. Slot: " + active + " (" + current + "). Use `trinity status` for a quick check, `trinity help` for the full command list, or `trinity set`, `trinity mode`, and `trinity rebuild` to move forward.";
}
function contextBudgetDirective(_input, output) {
  const ctxBudget = estimateContextBudget(_input, output);
  if (!ctxBudget || ctxBudget.pct <= 70)
    return null;
  const severity = ctxBudget.pct > 90 ? "CRITICAL" : "WARNING";
  return `[context budget: ${severity}] Context window is ${ctxBudget.pct}% full (~${ctxBudget.estimatedTokens} tokens). Use Task subagents for heavy work, compress tool output, or start a fresh session before context gets cramped.`;
}
var onSystemTransform = async (_input, output) => {
  try {
    __require("fs").appendFileSync("/tmp/st_debug", "ENTER_ON_SYSTEM_TRANSFORM\n");
  } catch (e) {
  }
  if (!loadSelection().enabled)
    return;
  try {
    const hookDirectory = String(onSystemTransform._directory || "");
    const userText = extractLastUserText(_input) || extractLastUserText(output);
    if (typeof userText === "string" && userText.trim())
      latestUserIntent = userText;
    else if (!latestUserIntent)
      latestUserIntent = null;
    if (latestUserIntent)
      observeUserCorrection(latestUserIntent);
    const classifiedRegime = _latestBlackboxState3?.sub_regime || (latestUserIntent ? await classifyTurnRemote(latestUserIntent) : "INIT");
    const optimizationSuggestion = await selectOptimizationModeRemote(classifiedRegime, latestUserIntent ? scoreStress(latestUserIntent) : 0, loadOptimizationMode());
    const optimizationDecision = applyBudgetFirstMode({
      requestedMode: loadOptimizationMode(),
      suggestedMode: optimizationSuggestion,
      subRegime: classifiedRegime,
      stress: latestUserIntent ? scoreStress(latestUserIntent) : 0,
      nInteractions: _latestBlackboxState3?.n_interactions ?? 0
    });
    const optimizationMode = optimizationDecision.mode;
    let _controlVector = null;
    ensureProjectContext(hookDirectory);
    if (_latestBlackboxState3) {
      const st = latestUserIntent ? scoreStress(latestUserIntent) : 0;
      if (st)
        _latestBlackboxState3.latest_stress_multiplier = st;
      _controlVector = await apiComputeControlVector(_latestBlackboxState3, void 0, optimizationMode);
    } else if (latestUserIntent) {
      const st = scoreStress(latestUserIntent);
      _controlVector = await apiComputeControlVector({
        sub_regime: classifiedRegime,
        latest_stress_multiplier: st || void 0,
        user_text: latestUserIntent
      }, void 0, optimizationMode);
    }
    if (!_controlVector) {
      _controlVector = await apiComputeControlVector({
        sub_regime: "INIT",
        latest_stress_multiplier: latestUserIntent ? scoreStress(latestUserIntent) : void 0,
        user_text: latestUserIntent || void 0
      }, void 0, optimizationMode);
    }
    const system = output?.system;
    if (!Array.isArray(system))
      return;
    if (isApiConnected()) {
      try {
        const bb = loadBlackboxState();
        if (!bb.enabled || _blackboxEnabled === false) {
          setBlackboxEnabled2(true);
          if (!bb.enabled) {
            bb.enabled = true;
            saveBlackboxState(bb);
          }
        }
      } catch {
      }
    } else if (_blackboxEnabled === false) {
      try {
        const bb = loadBlackboxState();
        if (!bb.enabled) {
          bb.enabled = true;
          saveBlackboxState(bb);
        }
        setBlackboxEnabled2(true);
      } catch {
      }
    }
    const sel = loadSelection();
    syncControlSettings(_controlVector, { persistOptimizationMode: optimizationDecision.shouldPersistRequestedMode });
    const fp2 = ensureProjectContext(hookDirectory);
    const rawStress = latestUserIntent ? scoreStress(latestUserIntent) : 0;
    const stressScore = rawStress * (_controlVector?.stress_multiplier ?? 1);
    const credit = loadCredit();
    _turnCountInject++;
    if (latestUserIntent && _blackboxEnabled !== false) {
      try {
        let pivotResult = null;
        const pivotPipeline = String(optimizationMode || "").toLowerCase() === "vibeultrax" ? "vibeultraxPipeline" : "vibemaxPipeline";
        try {
          const remote = await remoteCall(pivotPipeline, [{
            user_text: latestUserIntent,
            _pivotContext: {
              files: onSystemTransform._recentFiles || [],
              decisions: onSystemTransform._recentDecisions || [],
              blockers: onSystemTransform._recentBlockers || [],
              toolOutputs: _cacheDb ? extractRecentCacheOutputs(_cacheDb, 10) : []
            }
          }], null);
          if (remote?.pivot)
            pivotResult = remote;
        } catch {
        }
        if (!pivotResult) {
          const localModule = pivotPipeline === "vibeultraxPipeline" ? await Promise.resolve().then(() => (init_vibeultrax(), vibeultrax_exports)) : await Promise.resolve().then(() => (init_vibemax(), vibemax_exports));
          const localPipeline = pivotPipeline === "vibeultraxPipeline" ? localModule.vibeultraxPipeline : localModule.vibemaxPipeline;
          pivotResult = await localPipeline({
            user_text: latestUserIntent,
            _pivotContext: {
              files: onSystemTransform._recentFiles || [],
              decisions: onSystemTransform._recentDecisions || [],
              blockers: onSystemTransform._recentBlockers || [],
              toolOutputs: _cacheDb ? extractRecentCacheOutputs(_cacheDb, 10) : []
            }
          });
        }
        if (pivotResult?.pivot?.injection) {
          pushSystem(output, pivotResult.pivot.injection);
          if (pivotResult.pivot.workflowId && pivotResult.pivot.toolOutputs?.length > 0) {
            try {
              for (const entry of pivotResult.pivot.toolOutputs) {
                addCacheEntry(_cacheDb, entry.hash, entry.tool, entry.prompt, entry.sizeBytes || 1024, entry.ageSec || 3600);
              }
            } catch {
            }
          }
        }
      } catch {
      }
    }
    const stressMitigationDirective = rawStress > 0.7 ? "[stress mitigation: CRITICAL] The user's message shows very high stress indicators. Stay calm, structured, and thorough. Lead with the answer, keep steps explicit, and avoid playful language or overload. Do not mirror the user's urgency." : rawStress > 0.4 ? "[stress mitigation: elevated] The user's message has elevated stress indicators. Keep the response structured, readable, and lightly reassuring." : null;
    if (stressMitigationDirective) {
      pushSystem(output, stressMitigationDirective);
    }
    _prevTemplate = _currentTemplate;
    _currentTemplate = resolveTemplate(_prevTemplate, stressScore, latestUserIntent, credit, _latestBlackboxState3?.sub_regime);
    if (shouldInjectTemplate(_currentTemplate, _prevTemplate)) {
      const tpl = TEMPLATES[_currentTemplate] || TEMPLATES[DEFAULT_TEMPLATE];
      let fused = tpl.directive;
      if (sel.delegation_enforce && _controlVector?.enforcement_mode !== "relaxed") {
        fused += " Keep brain for planning \u2014 hand file changes to Task subagents. Parallel Task calls are encouraged for independent work.";
      }
      if (sel.tdd_enforce && _controlVector?.tdd_mode !== "lazy") {
        fused += " Keep test skeletons ready for changed source files.";
      }
      if (sel.flow_enabled && _controlVector?.flow_mode !== "audit") {
        fused += " Stay close to existing code conventions and project patterns.";
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
        pushSystem(output, "[decision engine] Resolution: " + (res.resolution || "unresolved") + " (" + currentRegime + "). Momentum: " + ((res.momentum || 0) > 0 ? "\u2197 positive" : (res.momentum || 0) < 0 ? "\u2198 negative" : "\u2192 steady") + ".");
        if (res.is_looping && res.loop_intervention_level && res.loop_intervention_level !== "none") {
          const severity = res.loop_intervention_level === "escalated" ? "CRITICAL" : res.loop_intervention_level === "assertive" ? "WARNING" : "NOTICE";
          pushSystem(output, "[loop prevention: " + severity + "] " + (_latestBlackboxLoopMsg3 || "The conversation may be looping \u2014 try a different approach.") + " (level: " + res.loop_intervention_level + ")");
        }
        if (res.pivot_detected && _latestBlackboxPivotMsg3) {
          pushSystem(output, "[context switch: PIVOT] " + _latestBlackboxPivotMsg3);
        }
      }
    }
    const projectJob2 = onSystemTransform._activeJob || getActiveJobForProject(fp2);
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
    pushSystem(output, "[anti-fabrication] Always work honestly \u2014 do NOT make up tool names, file paths, function signatures, code snippets, or exact outputs. If you must explain something you cannot verify, say 'I cannot verify that' and propose how to verify it. Under NO circumstance invent tool invocations, file contents, or final results. If you must correct an earlier response, say exactly what was wrong and then provide the corrected response. DO NOT LGTM.");
    pushSystem(output, empiricalAnswerDirective());
    const realityDirective = realityCheckDirective();
    if (realityDirective)
      pushSystem(output, realityDirective);
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
    const calDir = getVibeOSHome9();
    const calFile = join14(calDir, "calibration-data.jsonl");
    const regime2 = _latestBlackboxState3?.sub_regime || classifyTurnSimple2(latestUserIntent || "");
    const calRecord = JSON.stringify({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      sid: _OC_SID3,
      mode: _currentTemplate,
      regime: regime2,
      stress: stressScore,
      fp: currentProjectFingerprint || ""
    }) + "\n";
    try {
      mkdirSync10(calDir, { recursive: true });
      appendFileSync3(calFile, calRecord);
    } catch {
    }
    if (!oneShot("vibeos_dashboard_instruct")) {
      pushSystem(output, "[vibeOS dashboard display] When the trinity tool returns output starting with '[vibeOS-dashboard]', use the question tool to display that data in a clean, human-readable format. Use the question field (not the header) to show the dashboard data. Format it with clear sections separated by blank lines, aligned columns with spaces, and plain text only. The header should be 'vibeOS Dashboard'. Include only one option in options: {label: 'Dismiss', description: ''}. Strip the '[vibeOS-dashboard]' marker line before displaying.");
    }
    if (!oneShot("vibeos_dopamine_style_" + fp2)) {
      pushSystem(output, regimeAwareToolStyleDirective(_latestBlackboxState3?.sub_regime || classifiedRegime, _currentTemplate, stressScore));
    }
  } catch (err) {
    console.error(`[vibeOS] system.transform failed: ${err.message}`);
  }
};

// src/lib/hooks/footer.js
init_state();
init_selection_manager();

// src/lib/hooks/shared-footer.js
var REGIME_TAG = {
  INIT: "INIT",
  DIVERGENT: "DVRG",
  EXPLORING: "XPLR",
  REFINING: "RFNE",
  IMPLEMENTING: "IMPL",
  RESEARCH: "RSCH",
  REVIEWING: "RVW",
  DESIGNING: "DSGN",
  CONVERGING: "CVGE",
  CLOSED: "CLSD",
  LOOPING: "LOOP",
  AUDIT: "AUDT",
  FORENSIC: "FRNC"
};
var REGIME_ICON = {
  INIT: "\u25CC",
  DIVERGENT: "\u21C4",
  EXPLORING: "\u2315",
  REFINING: "\u270E",
  IMPLEMENTING: "\u2699",
  RESEARCH: "\u2301",
  REVIEWING: "\u2713",
  DESIGNING: "\u25EB",
  CONVERGING: "\u27F2",
  CLOSED: "\u25C6",
  LOOPING: "\u21BB",
  AUDIT: "\u2611",
  FORENSIC: "\u27C1"
};
var BRAND_MAP = {
  vibeultrax: "VibeUltraX",
  vibeqmax: "VibeQMaX",
  vibemax: "VibeMaX",
  litex: "VibeLiteX",
  quality: "VibeQMaX",
  audit: "VibeQMaX",
  forensic: "VibeQMaX"
};
var TIER_ICON = {
  brain: "\u{1F9E0}",
  medium: "\u25D0",
  cheap: "\u26A1",
  free: "\u{1F381}"
};
function resolveBrand(optMode, activeSlot) {
  return BRAND_MAP[optMode] || (activeSlot === "brain" ? "VibeQMaX" : "VibeMaX");
}
function resolveTierIcon(slot) {
  return TIER_ICON[slot] || "\u26A1";
}
function resolveRegimeIcon(subRegime) {
  return REGIME_ICON[String(subRegime || "").toUpperCase()] || "\u25E6";
}
function formatModeLabel(optMode) {
  const normalized = String(optMode || "").toLowerCase();
  if (!normalized)
    return "";
  if (normalized === "vibemax" || normalized === "vibelitex" || normalized === "budget")
    return "Budget";
  if (normalized === "vibeqmax" || normalized === "quality")
    return "Quality";
  if (normalized === "vibeultrax")
    return "VibeUltraX";
  if (normalized === "speed")
    return "Speed";
  if (normalized === "longrun")
    return "Longrun";
  if (normalized === "audit")
    return "Audit";
  if (normalized === "forensic")
    return "Forensic";
  if (normalized === "balanced")
    return "Balanced";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
function formatVectorPulse(vectorChangedSlot) {
  if (!vectorChangedSlot)
    return "";
  return `\u27E1 ${vectorChangedSlot}`;
}
function formatEnforcementPulse(enfTags) {
  const tags = new Set(enfTags || []);
  const parts = [];
  if (tags.has("[Q&A]")) {
    parts.push("quiet mode");
  } else {
    if (tags.has("[ENF ON]") || tags.has("[STRICT]"))
      parts.push("guarded");
    if (tags.has("[FLOW ON]"))
      parts.push("flow steady");
    if (tags.has("[TDD ON]"))
      parts.push("tests live");
  }
  if (tags.has("[LOCK ON]"))
    parts.push("locked");
  return parts.join(" \xB7 ");
}
function trendGlyph(trend) {
  if (trend === "up")
    return "\u2197";
  if (trend === "down")
    return "\u2198";
  return "\u2192";
}
function formatSavingsPulse(amountUsd, trend) {
  const amount = Number(amountUsd || 0);
  if (!Number.isFinite(amount) || amount <= 0)
    return "";
  const arrow = trendGlyph(trend);
  return `$${amount.toFixed(2)} saved${arrow !== "\u2192" ? ` ${arrow}` : ""}`;
}
function buildEnforcementTags(opts) {
  const tags = [];
  if (opts.quietIntent || opts.bbMode === "relaxed") {
    tags.push("[Q&A]");
  } else {
    if (opts.delegationEnforce)
      tags.push("[ENF ON]");
    if (opts.flowEnforce)
      tags.push("[FLOW ON]");
    if (opts.tddEnforce)
      tags.push("[TDD ON]");
    if (opts.bbMode === "strict")
      tags.push("[STRICT]");
  }
  if (opts.modelLocked)
    tags.push("[LOCK ON]");
  return tags;
}
function buildFooterLine(input) {
  const { activeSlot, sessionSlot, providerLabel, modelName, ltTotal, ltTrend, vibeBrand, optMode, flashIcon, enfTags, vectorChangedSlot, subRegime } = input;
  const tierIcon = resolveTierIcon(activeSlot);
  const regimeTag = subRegime ? REGIME_TAG[subRegime] || subRegime.slice(0, 4) : null;
  const regimeIcon = subRegime ? resolveRegimeIcon(subRegime) : null;
  const modeLabel = formatModeLabel(optMode);
  let line = `\u2014 ${tierIcon} ${activeSlot} | ${providerLabel} | ${modelName}${regimeTag ? ` \u25B6 ${regimeIcon} ${regimeTag}` : ""}`;
  if (ltTotal > 0) {
    const savingsPulse = formatSavingsPulse(ltTotal, ltTrend);
    if (savingsPulse)
      line += ` | ${savingsPulse}`;
  }
  line += ` | ${vibeBrand}${flashIcon}`;
  if (optMode && optMode !== "auto") {
    line += ` \xB7 ${modeLabel}`;
  }
  if (vectorChangedSlot && vectorChangedSlot !== activeSlot) {
    line += ` | ${formatVectorPulse(vectorChangedSlot)}`;
  }
  const enforcementPulse = formatEnforcementPulse(enfTags);
  if (enforcementPulse) {
    line += ` | ${enforcementPulse}`;
  }
  if (input.stressGauge) {
    line += ` | ${input.stressGauge}`;
  }
  if (sessionSlot && sessionSlot !== activeSlot) {
    line += ` | session:${sessionSlot}`;
  }
  line += " \u2014";
  return line;
}

// src/lib/hooks/footer.js
var IS_CLI_RUNTIME = Boolean(process.stdout?.isTTY || process.stderr?.isTTY || process.stdin?.isTTY);
var IS_TEST_RUNTIME = process.env.VIBEOS_MCP_PORT === "0" || process.env.NODE_ENV === "test" || process.env.CI === "true";
var FOOTER_DEBUG_STDERR = process.env.VIBEOS_DEBUG_FOOTER === "1" || !IS_CLI_RUNTIME && !IS_TEST_RUNTIME;
function footerDebug(...args) {
  if (FOOTER_DEBUG_STDERR)
    console.error(...args);
}
function getVibeOSHome10() {
  return process.env.VIBEOS_HOME || join15(process.env.HOME || "", ".claude");
}
var STATE_FILE2 = join15(getVibeOSHome10(), "delegation-state.json");
var SAVINGS_LEDGER_FILE2 = join15(getVibeOSHome10(), "savings-ledger.jsonl");
var _prevOutputText = "";
var _autoReportCount = 0;
var textCompletePainted = /* @__PURE__ */ new Set();
var _lastStrippedText = "";
function loadSelection3() {
  try {
    const raw = readFileSync14(join15(getVibeOSHome10(), "model-tiers.json"), "utf-8");
    return safeJsonParse2(raw)?.selection || { active_slot: "medium", enabled: true, delegation_enforce: true, flow_enabled: true, flow_enforce: true, tdd_enforce: false, tdd_strict: false };
  } catch {
    return { active_slot: "medium", enabled: true, delegation_enforce: true, flow_enabled: true, flow_enforce: true, tdd_enforce: false, tdd_strict: false };
  }
}
function isGreetingLike(text) {
  const value = String(text || "").trim().toLowerCase();
  return value === "hi" || value === "hello" || value === "hey" || value === "yo" || /^hi[!.?\s]*$/.test(value) || /^hello[!.?\s]*$/.test(value) || /^hey[!.?\s]*$/.test(value);
}
function readLifetimeSavings2() {
  try {
    reconcileStateFromLedger();
    const raw = readFileSync14(STATE_FILE2, "utf-8");
    const state = safeJsonParse2(raw);
    const ses = state?.sessions?.[getSessionId()] || {};
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
function getSessionId() {
  return getCurrentSessionId();
}
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
function readRewardSignals() {
  try {
    const state = loadBlackboxState();
    const session = state?.sessions?.[getSessionId()] || {};
    const policy = session?.mode_policy || {};
    return {
      stableStreak: Math.max(0, Number(policy.stable_streak || 0)),
      problemStreak: Math.max(0, Number(policy.problem_streak || 0))
    };
  } catch {
    return { stableStreak: 0, problemStreak: 0 };
  }
}
async function _appendFooter(input, output, directory3) {
  _refreshModel(directory3);
  let _footerStress = 0;
  if (latestUserIntent)
    _footerStress = scoreStress(latestUserIntent);
  try {
    const cfg = await client.config.get("model");
    if (cfg) {
      const cfgModel = String(cfg);
      if (cfgModel !== currentModel) {
        setCurrentModel(cfgModel);
        setCurrentTier(classify(cfgModel));
        footerDebug(`[vibeOS] client-detected model: ${currentModel} (tier=${currentTier})`);
      }
    }
  } catch {
  }
  try {
    let _payload2 = function(obj) {
      if (obj?.message && typeof obj.message === "object")
        return obj.message;
      return obj;
    }, _extractText2 = function(obj) {
      const payload = _payload2(obj);
      if (typeof payload?.text === "string")
        return payload.text;
      if (typeof payload?.result === "string")
        return payload.result;
      if (typeof payload?.content === "string")
        return payload.content;
      if (Array.isArray(payload?.content))
        return payload.content.filter((p) => p?.type === "text").map((p) => p.text).filter(Boolean).join("\n");
      if (Array.isArray(payload?.parts))
        return payload.parts.filter((p) => p?.type === "text").map((p) => p.text).filter(Boolean).join("\n");
      return "";
    }, _setFooter2 = function(obj, text2) {
      const target = _payload2(obj);
      if (typeof target?.text === "string")
        target.text = text2;
      else if (typeof target?.result === "string")
        target.result = text2;
      else if (typeof target?.content === "string")
        target.content = text2;
      else if (Array.isArray(target?.content)) {
        const textParts = target.content.filter((p) => p?.type === "text");
        if (textParts.length > 0)
          textParts[textParts.length - 1].text = text2;
        else
          target.content.push({ type: "text", text: text2 });
      } else if (Array.isArray(target?.parts)) {
        const textParts = target.parts.filter((p) => p?.type === "text");
        if (textParts.length > 0)
          textParts[textParts.length - 1].text = text2;
        else
          target.parts.push({ type: "text", text: text2 });
      } else
        target.text = text2;
    };
    var _payload = _payload2, _extractText = _extractText2, _setFooter = _setFooter2;
    const messageID = input?.messageID || input?.messageId || input?.message?.id || output?.messageID || output?.messageId || output?.message?.id || null;
    if (messageID && textCompletePainted.has(messageID))
      return;
    const text = _extractText2(output);
    if (!text)
      return;
    const { ltTasks, ltCache, ltCost, count, sesTasks, sesEdit, sesCredit, sesC7, sesQuota, sesCache, sesTaskDelegations, sesDuration, sesRatePerHour, sesTrend, sesToolBreakdown, sesModelTurns, quality_avg } = readLifetimeSavings2();
    const { stableStreak, problemStreak } = readRewardSignals();
    const sid = getSessionId();
    const sessionSlot = loadBlackboxState()?.sessions?.[sid]?.active_slot || loadSessionSlot(sid);
    const slot = sessionSlot || loadSelection3().active_slot || "brain";
    const brainModel = slot === "brain" ? TRINITY_BRAIN || currentModel : slot === "medium" ? TRINITY_MEDIUM || currentModel : TRINITY_CHEAP || currentModel || "";
    let liveModel = "";
    try {
      const cfg = await client.config.get("model");
      if (cfg)
        liveModel = String(cfg);
    } catch {
    }
    if (!liveModel) {
      liveModel = readConfig(directory3) || readConfig(join15(process.env.HOME || "", ".config", "opencode")) || process?.env?.OPENCODE_MODEL || "";
    }
    const displayModel = resolveTrinityDisplayModel(directory3, slot, liveModel, currentModel) || brainModel || liveModel || currentModel;
    const resolvedModel = displayModel || liveModel || brainModel || currentModel || "";
    if (resolvedModel && resolvedModel !== currentModel) {
      setCurrentModel(resolvedModel);
      setCurrentTier(classify(resolvedModel));
    }
    const execution = resolveExecutionIdentity(displayModel || resolvedModel || "", directory3);
    let modelTag = `[${shortModelName(displayModel)}]`;
    const _workerModel = slot === "brain" ? TRINITY_MEDIUM : null;
    const totalTurns = (sesModelTurns?.brain || 0) + (sesModelTurns?.worker || 0);
    if (_workerModel && _workerModel !== brainModel) {
      const brainPct = Math.round((sesModelTurns?.brain || 0) / (totalTurns || 1) * 100);
      modelTag = `[${shortModelName(displayModel)} ${brainPct}% \u2192 ${shortModelName(_workerModel)} ${100 - brainPct}%]`;
    }
    _autoReportCount = (_autoReportCount || 0) + 1;
    if (_autoReportCount % 5 === 0) {
      try {
        saveReport({
          type: "session",
          summary: "Session cost: $" + formatUsd(ltCost) + " | cache saved: $" + formatUsd(ltCache) + " | delegation saved: $" + formatUsd(Number(sesTasks || 0)) + " | task delegations: " + Number(sesTaskDelegations || 0),
          metrics: {
            sessionId: sid,
            projectFingerprint: currentProjectFingerprint || "unknown",
            projectName: currentProjectName || "unknown",
            sessionCost: ltCost,
            cacheSavings: ltCache,
            delegationSavingsUsd: sesTasks,
            taskDelegationCount: sesTaskDelegations,
            // Backward compatibility (legacy field historically misnamed)
            tasksDelegated: sesTaskDelegations,
            model: resolvedModel || currentModel,
            slot: loadSelection3().active_slot || "unknown",
            editSavings: sesEdit,
            creditSavings: sesCredit,
            context7Savings: sesC7,
            quotaSavings: sesQuota
          },
          tags: ["auto", "cost"]
        });
      } catch (e) {
        footerDebug("[vibeOS] auto-report:", e.message);
      }
    }
    const selNowFooter = loadSelection3();
    const normalizedIntent = classifyTurnSimple2(latestUserIntent || "");
    const currentSubRegime = _latestBlackboxState?.sub_regime || normalizedIntent;
    const bbMode = resolveEnforcementMode();
    const enfTags = buildEnforcementTags({
      delegationEnforce: selNowFooter.delegation_enforce,
      flowEnforce: selNowFooter.flow_enforce,
      tddEnforce: selNowFooter.tdd_enforce,
      bbMode,
      modelLocked: _modelLocked,
      quietIntent: isGreetingLike(latestUserIntent || "")
    });
    const stripped = text.replace(/\u2014 [^\u2014]+ \u2014\s*/g, "").trimEnd();
    if (stripped !== text)
      return;
    if (stripped === _lastStrippedText)
      return;
    const ltTotal = ltTasks + ltCache;
    const activeSlot = selNowFooter.active_slot || "brain";
    const flashIcon = isApiConnected() ? " \u26A1" : "";
    const displayMode = autoSelectMode2(currentSubRegime, _footerStress);
    const vibeBrand = resolveBrand(loadOptimizationMode() || displayMode, activeSlot);
    const vibeLine = buildFooterLine({
      activeSlot,
      providerLabel: execution.provider_label,
      modelName: modelDisplayName(execution.model),
      ltTotal,
      ltTrend: sesTrend,
      vibeBrand,
      optMode: displayMode,
      flashIcon,
      enfTags,
      sessionSlot,
      vectorChangedSlot: selNowFooter?.vector_changed_slot,
      subRegime: currentSubRegime,
      stressGauge: _footerStress > 0.85 ? "\u2588" : _footerStress > 0.7 ? "\u2586" : _footerStress > 0.5 ? "\u2585" : _footerStress > 0.3 ? "\u2583" : _footerStress > 0.1 ? "\u2582" : "\u2581"
    });
    const footerText = stripped + `

${vibeLine}`;
    if (_blackboxEnabled) {
      try {
        const prevText = _prevOutputText;
        _prevOutputText = _extractText2(output) || "";
        if (_prevOutputText && prevText && _prevOutputText !== prevText) {
          const outcome = detectOutcomeSignal(_prevOutputText);
          const regime = _latestBlackboxState?.sub_regime || classifyTurnSimple2(latestUserIntent || "");
          const stress = _footerStress;
          const isLooping = String(regime || "").toUpperCase() === "LOOPING";
          const isStressed = Number(stress || 0) > 0.3;
          const passiveNegative = isLooping && isStressed && !outcome ? "negative" : null;
          const finalOutcome = outcome || passiveNegative;
          if (finalOutcome) {
            recordBudgetFirstOutcome({
              outcome: finalOutcome,
              subRegime: regime,
              stress
            });
            const tracker = getBlackboxTracker();
            tracker.recordOutcome(finalOutcome);
            syncOutcomeToApi(finalOutcome);
            try {
              mkdirSync11(getVibeOSHome10(), { recursive: true });
              appendFileSync4(join15(getVibeOSHome10(), "calibration-data.jsonl"), JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), event: "outcome", sid: getSessionId(), outcome: finalOutcome }) + "\n");
            } catch {
            }
          }
        }
      } catch {
      }
    }
    _setFooter2(output, footerText);
    _lastStrippedText = stripped;
    if (!process.stdout?.isTTY) {
      console.error(`
${vibeLine} \u2014`);
    }
    textCompletePainted.add(messageID);
    if (textCompletePainted.size > 500) {
      const it = textCompletePainted.values();
      for (let i = 0; i < 100; i++)
        textCompletePainted.delete(it.next().value);
    }
  } catch (err) {
    footerDebug(`[vibeOS] footer failed: ${err.message}`);
  }
}

// src/lib/hooks/tool-execute.js
init_state();
import { writeFileSync as writeFileSync15, appendFileSync as appendFileSync6, existsSync as existsSync16, mkdirSync as mkdirSync13 } from "node:fs";
import { join as join17, dirname as dirname12, basename as basename4 } from "node:path";
import { createHash as createHash5 } from "node:crypto";
init_selection_manager();

// src/lib/cost-anomaly.js
var COST_WINDOW_SIZE = 20;
var COST_ANOMALY_THRESHOLD = 3;
var COST_WARMUP_SAMPLES = 5;
var CostAnomalyDetector = class {
  costHistory = [];
  disabled = false;
  currentAnomalyModel = null;
  currentAnomalyCost = 0;
  currentAnomalyMean = 0;
  record(cost) {
    if (this.disabled)
      return;
    this.costHistory.push(cost);
    if (this.costHistory.length > COST_WINDOW_SIZE) {
      this.costHistory.shift();
    }
  }
  get mean() {
    if (this.costHistory.length === 0)
      return 0;
    return this.costHistory.reduce((a, b) => a + b, 0) / this.costHistory.length;
  }
  checkAnomaly(model, cost) {
    if (this.disabled)
      return false;
    if (this.costHistory.length < COST_WARMUP_SAMPLES)
      return false;
    const avg = this.mean;
    if (avg <= 0 || cost <= avg)
      return false;
    const ratio = cost / avg;
    if (ratio > COST_ANOMALY_THRESHOLD) {
      this.currentAnomalyModel = model;
      this.currentAnomalyCost = cost;
      this.currentAnomalyMean = avg;
      return true;
    }
    return false;
  }
  clearAnomaly() {
    this.currentAnomalyModel = null;
    this.currentAnomalyCost = 0;
    this.currentAnomalyMean = 0;
  }
  reset() {
    this.costHistory = [];
    this.clearAnomaly();
  }
};
var _costDetector = null;
function getCostAnomalyDetector() {
  if (!_costDetector)
    _costDetector = new CostAnomalyDetector();
  return _costDetector;
}

// src/lib/hooks/tool-execute.js
init_flow_enforcer();
init_ml_router();
init_smart_cache();

// src/lib/tdd-enforcer.js
init_state();
import { readFileSync as readFileSync15, writeFileSync as writeFileSync14, appendFileSync as appendFileSync5, existsSync as existsSync15, mkdirSync as mkdirSync12, statSync as statSync8, readdirSync as readdirSync4, rmSync as rmSync6, openSync as openSync3 } from "node:fs";
import { join as join16, dirname as dirname11 } from "node:path";
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
function getVibeOSHome11() {
  return process.env.VIBEOS_HOME || join16(process.env.HOME || "", ".claude");
}
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
    const pkgPath = join16(root, "package.json");
    if (existsSync15(pkgPath)) {
      const pkg = JSON.parse(readFileSync15(pkgPath, "utf-8"));
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
        const dirPath = join16(root, td);
        if (!existsSync15(dirPath))
          continue;
        const files = readdirSync4(dirPath).filter((f) => /\.test\./.test(f) || /\.spec\./.test(f));
        if (files.length > 0) {
          const content = readFileSync15(join16(dirPath, files[0]), "utf-8");
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
var ENFORCEMENT_LOCK_DIR = join16(getVibeOSHome11(), ".enforcement-lock");
var LOCK_EXPIRE_MS = 3e4;
var ENFORCEMENT_COOLDOWN_FILE2 = join16(getVibeOSHome11(), ".enforcement-cooldown.jsonl");
var COOLDOWN_MS = 6e4;
var _enforcementCooldown = /* @__PURE__ */ new Set();
function _acquireLock(testPath) {
  try {
    mkdirSync12(ENFORCEMENT_LOCK_DIR, { recursive: true });
    const hash = createHash4("sha256").update(testPath).digest("hex").slice(0, 16);
    const lockPath = join16(ENFORCEMENT_LOCK_DIR, `${hash}.lock`);
    try {
      openSync3(lockPath, "wx");
      return true;
    } catch (err) {
      if (err.code !== "EEXIST")
        return false;
      try {
        const st = statSync8(lockPath);
        if (Date.now() - st.mtimeMs >= LOCK_EXPIRE_MS) {
          rmSync6(lockPath, { force: true });
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
    const lockPath = join16(ENFORCEMENT_LOCK_DIR, `${hash}.lock`);
    rmSync6(lockPath);
  } catch {
  }
}
function _isInCooldown(testPath) {
  try {
    if (!existsSync15(ENFORCEMENT_COOLDOWN_FILE2))
      return false;
    const hash = createHash4("sha256").update(testPath).digest("hex").slice(0, 16);
    const lines = readFileSync15(ENFORCEMENT_COOLDOWN_FILE2, "utf-8").trim().split("\n").filter(Boolean);
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
    mkdirSync12(dirname11(ENFORCEMENT_COOLDOWN_FILE2), { recursive: true });
    const hash = createHash4("sha256").update(testPath).digest("hex").slice(0, 16);
    const entry = JSON.stringify({ h: hash, ts: Date.now() }) + "\n";
    appendFileSync5(ENFORCEMENT_COOLDOWN_FILE2, entry);
    const lines = readFileSync15(ENFORCEMENT_COOLDOWN_FILE2, "utf-8").trim().split("\n").filter(Boolean);
    if (lines.length > 500) {
      writeFileSync14(ENFORCEMENT_COOLDOWN_FILE2, lines.slice(-200).join("\n") + "\n");
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
  return { path: testPath, content: skeletonFn(name, exports, "full", strict, quality, sourceContent), dir: dirname11(testPath) };
}
function enforceTestFile(filePath) {
  console.error(`[vibeOS] [tdd-enforce] enforceTestFile called for ${filePath}`);
  let sourceContent = "";
  try {
    if (existsSync15(filePath)) {
      sourceContent = readFileSync15(filePath, "utf-8");
    }
  } catch {
  }
  const sel = loadSelection();
  const skeleton = buildTestSkeleton(filePath, sourceContent, { strict: sel.tdd_strict !== false, quality: sel.tdd_quality !== false });
  if (!skeleton)
    return null;
  if (existsSync15(skeleton.path))
    return null;
  if (_enforcementCooldown.has(skeleton.path))
    return null;
  if (_isInCooldown(skeleton.path))
    return null;
  if (!_acquireLock(skeleton.path))
    return null;
  try {
    mkdirSync12(skeleton.dir, { recursive: true });
    writeFileSync14(skeleton.path, skeleton.content);
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
function isGreetingLike2(text) {
  const value = String(text || "").trim().toLowerCase();
  return value === "hi" || value === "hello" || value === "hey" || value === "yo" || /^hi[!.?\s]*$/.test(value) || /^hello[!.?\s]*$/.test(value) || /^hey[!.?\s]*$/.test(value);
}
var BYTES_PER_TOKEN2 = 4;
var DEBUG_INTERNALS2 = process.env.VIBEOS_DEBUG_INTERNALS === "1";
var IS_CLI_RUNTIME2 = Boolean(process.stdout?.isTTY || process.stderr?.isTTY || process.stdin?.isTTY);
function getVibeOSHome12() {
  return process.env.VIBEOS_HOME || join17(process.env.HOME || "", ".claude");
}
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
  return projectDirectory ? join17(projectDirectory, raw).replace(/\\/g, "/") : raw;
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
  const blockedBase = basename4(blockedPath || "") || "blocked";
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
      const rate = cacheSavePer1MInputTokens(currentModel);
      _cacheSave = 0;
      if (rate > 0) {
        const _inputTokens = Math.max(1, Math.round(hit.sizeBytes / BYTES_PER_TOKEN2));
        _cacheSave = Math.max(1e-4, Math.round(_inputTokens * rate / 1e6 * 1e4) / 1e4);
      }
      const cacheSaved = recordCacheSaving(t, _cacheSave, { hash: hit.hash });
      const sumNote = hit.summaryPath ? ` (summary: ${hit.summaryPath})` : "";
      const cacheNote = cacheSaved ? `, cache+$${(cacheSaved.lifetime || 0).toFixed(3)} lt` : "";
      if (DEBUG_INTERNALS2) {
        console.error(`[vibeOS] \u{1F4E6} scratchpad hit for ${t}: ${hit.fullPath} ${hit.sizeBytes}B ${hit.ageSec}s old${sumNote} \u2014 total observed: ${total ?? "?"}${cacheNote}`);
      }
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
            if (prediction.shouldWarm && prediction.confidence >= 0.6 && prediction.similarEntries.length > 0) {
              try {
                const titleCase = TOOL_NAME_NORMALIZE[t];
                if (titleCase) {
                  const argsJson = stableJson(args ?? inArgs ?? {});
                  const curHash = createHash5("sha256").update(`${titleCase}
${argsJson}
`).digest("hex").slice(0, 16);
                  const sessionDir = getSessionScratchpadDir();
                  const globalDir = SCRATCHPAD_GLOBAL_DIR;
                  const ptrPath = join17(sessionDir, `${curHash}.ptr`);
                  if (!existsSync16(ptrPath)) {
                    for (const similar of prediction.similarEntries) {
                      const targetHash = similar.entry.hash;
                      if (targetHash.length < 16)
                        continue;
                      const cachedFile = join17(sessionDir, `${targetHash}.txt`);
                      const globalFile = join17(globalDir, `${targetHash}.txt`);
                      if (existsSync16(cachedFile) || existsSync16(globalFile)) {
                        ensureSessionScratchpadDirs();
                        writeFileSync15(ptrPath, JSON.stringify({
                          contentHash: targetHash,
                          tool: titleCase,
                          warmed: true,
                          at: (/* @__PURE__ */ new Date()).toISOString(),
                          confidence: prediction.confidence,
                          reason: prediction.reason
                        }));
                        if (DEBUG_INTERNALS2) {
                          console.error(`[vibeOS] \u{1F52E} Smart cache: warmed ${t} \u2192 ${targetHash.slice(0, 8)} (conf: ${(prediction.confidence * 100).toFixed(0)}%)`);
                        }
                        break;
                      }
                    }
                  }
                }
              } catch (warmErr) {
                if (DEBUG_INTERNALS2) {
                  console.error(`[vibeOS] Smart cache warming error: ${warmErr.message}`);
                }
              }
            }
          }
        }
      } catch (scErr) {
        if (DEBUG_INTERNALS2) {
          console.error(`[vibeOS] Smart cache error: ${scErr.message}`);
        }
      }
    }
  }
  let _credit = loadCredit();
  if (_credit < 40) {
    try {
      const refreshed = await refreshCreditSnapshot();
      if (Number.isFinite(refreshed))
        _credit = refreshed;
    } catch {
    }
  }
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
      if (currentTier === "high" && !_exploratoryTarget && TRINITY_MEDIUM && _target === TRINITY_CHEAP) {
        _target = TRINITY_MEDIUM;
        console.error(`[vibeOS] \u{1F500} Task floor: preserving medium tier for high-tier brain task`);
      }
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
    const activePipeline = loadSelection().active_pipeline;
    if (activePipeline && Array.isArray(activePipeline) && activePipeline.length > 1 && TRINITY_CHEAP && TRINITY_MEDIUM) {
      try {
        const cheapCost = 1e-3;
        const mediumCost = 5e-3;
        const brainCost = 0.02;
        const cascadeResult = cascadeDecide(_prompt, cheapCost, mediumCost, brainCost, 0.85);
        const tierMap = { cheap: TRINITY_CHEAP, medium: TRINITY_MEDIUM, brain: TRINITY_BRAIN || TRINITY_MEDIUM, local: TRINITY_CHEAP };
        const pipelineModels = activePipeline.map((t2) => tierMap[t2] || TRINITY_CHEAP);
        if (cascadeResult.escalate && pipelineModels.length > 1) {
          const escalated = pipelineModels[1];
          if (escalated && escalated !== currentModel && (!_target || escalated !== _target)) {
            _target = escalated;
            console.error(`[vibeOS] \u{1F500} Cascade escalate: ${cascadeResult.reason} \u2192 ${escalated}`);
          }
        } else if (cascadeResult.useCheap && !_target) {
          _target = pipelineModels[0];
          if (_target && _target !== currentModel) {
            console.error(`[vibeOS] \u{1F500} Cascade cheap: ${cascadeResult.reason} \u2192 ${_target}`);
          }
        }
      } catch (cascadeErr) {
        console.error(`[vibeOS] Cascade router error: ${cascadeErr.message}`);
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
  const _rawEdit = Math.max(0, _brainCost - _workerCost);
  const _estEdit = Math.max(_rawEdit, SAVE_EST.WRITE_EDIT * 0.1);
  const _estOpus = Math.max(_brainCost, _estEdit);
  const _estC7 = Math.max(_brainCost, SAVE_EST.CONTEXT7);
  const _tierWord = currentTier === "high" ? "Brain" : currentTier === "mid" ? "Medium" : "Budget";
  const _firstWord = extractFirstWordFromArgs(t, args || inArgs);
  const sel = loadSelection();
  const compatibilityMode = sel.onboarding_mode === "assist";
  if (WARN_ON_DIRECT.has(String(t || "").toLowerCase())) {
    const argSources = _toolArgSources(input, output);
    const checkPath = argSources.flatMap((src) => [src?.filePath, src?.file_path, src?.path]).find((v) => typeof v === "string" && v.trim()) || "";
    if (_isProtectedToolPath(checkPath)) {
      _mutateBlockedToolArgs(t, argSources, checkPath, output);
      if (shouldLogWarn(`${t}|protect|${checkPath}`))
        console.error(`[vibeOS] [protection] BLOCKED direct ${t} in self-protected directory: ${checkPath}`);
      pendingUiNote = `[LOCK] Self-modification paused: ${basename4(checkPath)} is in a protected project tree. Use a manual git workflow.`;
      enforcementBlocked = true;
      return;
    }
  }
  const costDetector = getCostAnomalyDetector();
  if (!costDetector.disabled && currentModel) {
    const modelCost = modelCostPerTurn(currentModel);
    const fullModelName = currentModel;
    if (costDetector.checkAnomaly(fullModelName, modelCost)) {
      const avg = costDetector.currentAnomalyMean;
      const ratio = avg > 0 ? (modelCost / avg).toFixed(1) : "?";
      const msg = `Cost spike: ${shortModelName(fullModelName)} at $${modelCost.toFixed(4)}/turn \u2014 ${ratio}x above the recent average of $${avg.toFixed(4)}. Switch to \`trinity medium\` or \`trinity cheap\` to keep momentum.`;
      if (shouldLogWarn(`${t}|cost-anomaly|${fullModelName}|${modelCost.toFixed(4)}`)) {
        console.error(`[vibeOS] [cost-anomaly] ${msg}`);
      }
      pendingUiNote = `[SLOW DOWN] ${msg}`;
      enforcementBlocked = true;
      return;
    }
    costDetector.record(modelCost);
  }
  const tLower = String(t || "").toLowerCase();
  const lowCreditNudge = _credit < 40 && !compatibilityMode;
  if (lowCreditNudge) {
    const total = recordSaving(t, "credit<40% high-tier", _estEdit, {
      firstWord: _firstWord,
      projectFingerprint: currentProjectFingerprint,
      projectName: currentProjectName || "",
      sessionId: getCurrentSessionId()
    });
    const msg = `[vibeOS] Quick win: ${resolveTierIcon("cheap")} cheap lane open \xB7 switch to ${resolveTierIcon("medium")} medium to save about ~$${_estEdit.toFixed(3)}/turn.`;
    if (shouldLogWarn(`${t}|credit|${_tierWord}`) && process.env.VIBEOS_DEBUG_DELEGATION === "1") {
      console.error(`[vibeOS] [delegation] ${msg}`);
    }
    pendingUiNote = msg;
    if (!WARN_ON_DIRECT.has(tLower))
      return;
  }
  if (WARN_ON_DIRECT.has(tLower)) {
    const argSources = _toolArgSources(input, output);
    if (process.env.VIBEOS_DEBUG_DELEGATION === "1")
      console.error(`[vibeOS] [enforce-debug] tool=${t} tier=${currentTier} enforce=${sel?.delegation_enforce} argsType=${typeof args} argsExists=${argSources.length > 0}`);
    if (!compatibilityMode && sel.delegation_enforce && currentTier === "high") {
      const originalPath = argSources.flatMap((src) => [src?.filePath, src?.file_path, src?.path]).find((v) => typeof v === "string" && v.trim()) || "";
      const basename6 = originalPath.split("/").pop() || "blocked";
      const apiResult = await remoteCall("delegateCheck", [tLower, currentTier, currentModel, _prompt], () => ({
        blocked: true,
        savings: _estEdit,
        _fallback: true
      }));
      const remoteSavings = Number(apiResult?.savings);
      const savings = Number.isFinite(remoteSavings) ? Math.min(remoteSavings, _estEdit) : _estEdit;
      const MIN_MEANINGFUL_SAVINGS = 1e-3;
      const isFallback = apiResult?._fallback === true;
      const isBlocked = apiResult?.blocked !== false && (isFallback || savings >= MIN_MEANINGFUL_SAVINGS);
      if (isBlocked) {
        if (!lowCreditNudge) {
          const total = recordSaving(t, "delegation enforced", savings, {
            firstWord: _firstWord,
            projectFingerprint: currentProjectFingerprint,
            projectName: currentProjectName || "",
            sessionId: getCurrentSessionId()
          });
        }
        pendingUiNote = `[delegation] This is a good candidate for a Task subagent \u2014 ${resolveTierIcon("brain")} brain handles orchestration, let cheaper tiers do the write/edit. Switch to ${resolveTierIcon("medium")} medium with \`trinity medium\` if you'd rather do it directly.`;
        enforcementBlocked = true;
        _mutateBlockedToolArgs(t, argSources, originalPath, output);
        if (shouldLogWarn(`${t}|enforced|${_tierWord}`))
          console.error(`[vibeOS] [enforcement] BLOCKED direct ${t} on high tier \u2192 delegate via Task`);
        return;
      }
      if (!lowCreditNudge) {
        const total = recordSaving(t, "direct edit", _estEdit, {
          firstWord: _firstWord,
          projectFingerprint: currentProjectFingerprint,
          projectName: currentProjectName || "",
          sessionId: getCurrentSessionId()
        });
      }
      if (!compatibilityMode) {
        const msg = `[vibeOS] ${resolveTierIcon("cheap")} cheap lane \xB7 save about ~$${_estEdit.toFixed(3)} by delegating to Task. Try ${resolveTierIcon("medium")} medium.`;
        if (shouldLogWarn(`${t}|direct|${_tierWord}`) && process.env.VIBEOS_DEBUG_DELEGATION === "1") {
          console.error(`[vibeOS] [delegation] ${msg}`);
        }
        pendingUiNote = msg;
        return;
      }
    }
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
          if (!existsSync16(CONTEXT7_INSTALL_FLAG)) {
            try {
              mkdirSync13(dirname12(CONTEXT7_INSTALL_FLAG), { recursive: true });
              writeFileSync15(CONTEXT7_INSTALL_FLAG, "");
            } catch {
            }
            console.error(`[vibeOS] Small win: install context7 MCP to save about ~$0.06/turn on docs: \`claude mcp add context7 npx @upstash/context7-mcp\``);
          } else if (!context7AlertedThisSession) {
            context7AlertedThisSession = true;
            console.error(`[vibeOS] context7 is still off \u2014 about ~$${(missed ?? 0).toFixed(2)} in savings slipped this session.`);
          }
        }
      }
    }
    softQuotaCounts[t] = (softQuotaCounts[t] ?? 0) + 1;
    const n = softQuotaCounts[t];
    if (n === SOFT_QUOTA_LIMIT + 1) {
      const total = recordSaving(t, `soft quota exceeded (limit ${SOFT_QUOTA_LIMIT})`, SAVE_EST.SOFT_QUOTA, {
        projectFingerprint: currentProjectFingerprint,
        projectName: currentProjectName || "",
        sessionId: getCurrentSessionId()
      });
      console.error(`[vibeOS] Bash usage is getting heavy (${n}/${SOFT_QUOTA_LIMIT}) \u2014 hand the next step to a Task subagent.`);
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
  try {
    incrementTurnCounter();
  } catch {
  }
  let _footerText = "";
  try {
    if (t !== "task") {
      const { ltTasks, ltCache, ltCost, sesTrend } = readLifetimeSavings();
      const ltTotal = ltTasks + ltCache;
      const selNow = loadSelection();
      let liveModel = "";
      try {
        const cfg = await client.config.get("model");
        if (cfg)
          liveModel = String(cfg);
      } catch {
      }
      if (!liveModel) {
        liveModel = readConfig(projectDirectory) || readConfig(join17(process.env.HOME || "", ".config", "opencode")) || process?.env?.OPENCODE_MODEL || "";
      }
      const displayModel = resolveTrinityDisplayModel(projectDirectory, selNow.active_slot || "", liveModel, currentModel) || liveModel || currentModel;
      const resolvedModel = displayModel || liveModel || currentModel || "";
      if (resolvedModel && resolvedModel !== currentModel) {
        setCurrentModel(resolvedModel);
        setCurrentTier(classify(resolvedModel));
      }
      const execution = resolveExecutionIdentity(displayModel || resolvedModel || "", projectDirectory);
      const currentSid = _OC_SID;
      const currentSubRegime = loadBlackboxState()?.sessions?.[currentSid]?.sub_regime || classifyTurnSimple2(latestUserIntent || "");
      const bbMode = resolveEnforcementMode();
      const enfTags = buildEnforcementTags({
        delegationEnforce: selNow.delegation_enforce,
        flowEnforce: selNow.flow_enforce,
        tddEnforce: selNow.tdd_enforce,
        bbMode,
        modelLocked: _modelLocked,
        quietIntent: isGreetingLike2(latestUserIntent || "")
      });
      const activeSlot = selNow.active_slot || (execution.quality === "brain" ? "brain" : execution.quality === "medium" ? "medium" : "cheap");
      const displayMode = autoSelectMode2(currentSubRegime, latestUserIntent ? scoreStress(latestUserIntent) : 0);
      const vibeBrand = resolveBrand(displayMode, activeSlot);
      const sessionSlot = loadSessionSlot(currentSid);
      const flashIcon = isApiConnected() ? " \u26A1" : "";
      _footerText = buildFooterLine({
        activeSlot,
        providerLabel: execution.provider_label,
        modelName: modelDisplayName(execution.model),
        ltTotal,
        ltTrend: sesTrend || "",
        vibeBrand,
        optMode: displayMode,
        flashIcon,
        enfTags,
        sessionSlot,
        vectorChangedSlot: selNow.vector_changed_slot,
        subRegime: currentSubRegime
      }) + "\n\n";
      const footerTarget = _payload(output);
      output.title = _footerText.trim();
      if (footerTarget !== output && footerTarget && typeof footerTarget === "object") {
        footerTarget.title = _footerText.trim();
      }
      if (typeof footerTarget?.output === "string")
        footerTarget.output = _footerText + footerTarget.output;
      else if (typeof footerTarget?.result === "string")
        footerTarget.result = _footerText + footerTarget.result;
      else if (typeof footerTarget?.text === "string")
        footerTarget.text = _footerText + footerTarget.text;
      else if (typeof footerTarget?.content === "string")
        footerTarget.content = _footerText + footerTarget.content;
      else
        footerTarget.output = _footerText;
      _autoReportCount2 = (_autoReportCount2 || 0) + 1;
      if (_autoReportCount2 % 5 === 0 && ltTotal > 0) {
        saveReport({
          type: "session",
          summary: `Session cost: $${formatUsd(ltCost)} | cache saved: $${formatUsd(ltCache)} | delegation saved: $${formatUsd(ltTasks)}`,
          metrics: { sessionId: _OC_SID, sessionCost: ltCost, cacheSavings: ltCache, delegationSavingsUsd: ltTasks, model: resolvedModel || currentModel, slot: selNow.active_slot || "unknown" },
          tags: ["auto", "cost"]
        });
      }
    }
  } catch {
  }
  try {
    incrementTurnCounter();
  } catch {
  }
  const t = input?.tool ?? "";
  if (t === "trinity") {
    const trinityArgs = input?.args || {};
    const trinityAction = trinityArgs?.action || trinityArgs?.todo || "";
    if (trinityAction === "todo") {
      try {
        const flowTodoFilePath = join17(getVibeOSHome12(), ".flow-todo-queue.jsonl");
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
    const taskOutput = output?.result || output?.text || output?.state?.output || output?.state?.result || "";
    const taskPrompt = input?.args?.prompt || input?.args?.description || "";
    const quality = scoreTaskQuality(taskOutput, taskPrompt);
    try {
      appendFileSync6(SAVINGS_LEDGER_FILE, JSON.stringify({
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
  function _payload(obj) {
    if (obj?.message && typeof obj.message === "object")
      return obj.message;
    return obj;
  }
  if (enforcementBlocked) {
    const target = _payload(output);
    const blockMsg = pendingUiNote || `[delegation] ${String(input?.tool || "tool")} blocked by enforcement`;
    const replaceIfNeeded = (key) => {
      if (typeof target?.[key] === "string" && /oldString not found/i.test(target[key]))
        target[key] = blockMsg;
    };
    replaceIfNeeded("error");
    replaceIfNeeded("result");
    replaceIfNeeded("text");
    replaceIfNeeded("content");
  }
  if (pendingUiNote) {
    const target = _payload(output);
    if (enforcementBlocked) {
      const note = pendingUiNote;
      if (typeof target?.result === "string")
        target.result += `

${note}`;
      else if (typeof target?.text === "string")
        target.text += `

${note}`;
      else if (typeof target?.content === "string")
        target.content += `

${note}`;
      else
        target.result = pendingUiNote;
    } else {
      const note = `

${pendingUiNote}`;
      if (typeof target?.result === "string")
        target.result += note;
      else if (typeof target?.text === "string")
        target.text += note;
      else if (typeof target?.content === "string")
        target.content += note;
      else
        target.result = pendingUiNote;
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
        const intentClass2 = classifyTurnSimple2(latestUserIntent);
        const isResearchSession2 = intentClass2 === "EXPLORING" || intentClass2 === "DIVERGENT";
        if (sel.tdd_enforce && !isTestPath && !isResearchSession2) {
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
    const intentClass = classifyTurnSimple2(latestUserIntent);
    const isResearchSession = intentClass === "EXPLORING" || intentClass === "DIVERGENT";
    if (sel.tdd_enforce && !isTestPath && !isResearchSession) {
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
        const fn = basename4(fp3);
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
init_state();
import { readFileSync as readFileSync16, existsSync as existsSync17 } from "node:fs";
var onSessionCompacting = async (_input, output) => {
  if (!loadSelection().enabled)
    return;
  try {
    const turnCount = getTurnCounter();
    const needsCompact = turnCount >= 7;
    const indexPath = getSessionIndexPath();
    let recent = "";
    if (existsSync17(indexPath)) {
      try {
        const lines = readFileSync16(indexPath, "utf-8").trim().split("\n").slice(-30);
        recent = lines.map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        }).filter((e) => e && e.hash).map((e) => `  \u2022 ${e.tool} \u2192 ${getSessionScratchpadDir()}/${e.hash}.txt (${e.size}B)`).join("\n");
      } catch {
      }
    }
    if (!recent)
      recent = "  (no recent scratchpad entries)";
    const scratchpadNote = `[scratchpad-aware compaction] Tool results live on disk at ${getSessionScratchpadDir()}/<hash>.txt (plus .meta.json and .summary.txt). WHEN COMPACTING: (1) drop verbose tool result bodies \u2014 the bulk lives on disk; (2) PRESERVE every <hash> reference, file path, and pointer; (3) note which on-disk artifacts the model may want to Read back later.

Recent cached entries:
` + recent + "\nTo recall any of these post-compact, use the read/grep tools on the listed path.";
    const contextEntries = [];
    if (needsCompact) {
      contextEntries.push({
        role: "system",
        content: `[conversation compression notice \u2014 turn ${turnCount}] The preceding conversation has been context-compressed. ALL factual statements, technical details, decisions, code snippets, file paths, and references from prior turns are PRESERVED losslessly. Any unverified assumption from earlier turns must stay labeled as unverified until checked. Only verbose connectors, restatements, and redundant intros have been removed. Continue the conversation naturally \u2014 the full technical context is intact.`
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
    if (needsCompact && output) {
      try {
        updateState((state) => {
          const now = (/* @__PURE__ */ new Date()).toISOString();
          state.sessions ??= {};
          const sid = _OC_SID;
          state.sessions[sid] ??= {};
          state.sessions[sid].telemetry ??= {};
          state.sessions[sid].telemetry.last_compacted_at = now;
          state.lifetime ??= {};
          state.lifetime.telemetry ??= {};
          state.lifetime.telemetry.last_compacted_at = now;
          return state;
        });
      } catch {
      }
    }
  } catch (err) {
    console.error(`[vibeOS] session.compacting failed: ${err.message}`);
  }
};

// src/lib/hooks/shell-env.js
init_state();
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
    const shellTier = currentTier === "high" ? "brain" : currentTier === "mid" ? "medium" : currentTier === "budget" ? "cheap" : currentTier === "free" ? "free" : currentTier || "unknown";
    output.env.VIBEOS_SHELL_BADGE = `${resolveTierIcon(shellTier)} ${shellTier} | ${currentModel || "unknown"}`;
  } catch (e) {
    console.error("[vibeOS] shell.env error:", e);
  }
};

// src/index.ts
init_state();
init_state();
function getVibeOSHome13() {
  return process.env.VIBEOS_HOME || join18(process.env.HOME || "", ".claude");
}
function getTiersFile() {
  return join18(getVibeOSHome13(), "model-tiers.json");
}
function getReportsDir2() {
  return join18(getVibeOSHome13(), "reports");
}
function ensureDeferredBootstrap() {
  if (_deferredBootstrapDone || _modelLocked)
    return;
  _deferredBootstrapDone = true;
  try {
    _runDeferredStartupBootstrap?.();
  } catch {
  }
}
var activeJob2 = null;
var fp = "";
var _mcpServerRuntime = null;
var _mcpServerHooked = false;
var _mcpServerStartupPromise = null;
var _mcpServerRestartTimer = null;
var _mcpServerShouldRun = false;
var _mcpServerClosing = false;
var _pluginHooksRuntime = null;
var _deferredBootstrapDone = false;
var _skillsEnsured = /* @__PURE__ */ new Set();
var _runDeferredStartupBootstrap = null;
function _readOpenCodeConfigObject(dir) {
  const jsonPath = join18(dir, "opencode.json");
  const jsoncPath = join18(dir, "opencode.jsonc");
  if (existsSync18(jsonPath))
    return safeJsonParse2(readFileSync17(jsonPath, "utf-8"));
  if (existsSync18(jsoncPath))
    return _parseJsonc(readFileSync17(jsoncPath, "utf-8"));
  return {};
}
function _loadOpenCodeProviders(directory3) {
  try {
    const merged = {};
    const dirs = [directory3 ? join18(directory3, ".") : null, getOpenCodeHome()].filter(Boolean);
    for (const dir of dirs) {
      const cfg = _readOpenCodeConfigObject(String(dir));
      const providers = cfg?.provider || {};
      for (const [providerName, providerCfg] of Object.entries(providers)) {
        if (!merged[providerName])
          merged[providerName] = {};
        merged[providerName] = {
          ...merged[providerName],
          ...providerCfg,
          models: {
            ...merged[providerName]?.models || {},
            ...providerCfg?.models || {}
          }
        };
      }
    }
    return merged;
  } catch {
    return {};
  }
}
async function _resolveBootstrapModel(client2, directory3) {
  const normalize = (value) => {
    const model = String(value || "").trim();
    return model && !PLACEHOLDER_RE.test(model) ? model : "";
  };
  const projectModel = normalize(readConfig(directory3));
  if (projectModel)
    return { model: projectModel, source: "project-config" };
  const home = process.env.HOME || "";
  if (home) {
    const globalModel = normalize(readConfig(getOpenCodeHome()));
    if (globalModel)
      return { model: globalModel, source: "global-config" };
  }
  const envModel = normalize(process?.env?.OPENCODE_MODEL || "");
  if (envModel)
    return { model: envModel, source: "env" };
  return { model: "", source: "" };
}
function _loadActiveJobForProject(directory3, fp2 = "") {
  const candidates = [getVibeOSHome13(), directory3 ? join18(directory3, "..") : ""].filter(Boolean);
  for (const base of candidates) {
    try {
      const activeJobsPath = join18(String(base), ".claude", "active-jobs.json");
      if (!existsSync18(activeJobsPath))
        continue;
      const jobs = safeJsonParse2(readFileSync17(activeJobsPath, "utf-8")) || {};
      const job = fp2 ? jobs?.[fp2] : null;
      if (job && typeof job === "object")
        return job;
    } catch {
    }
  }
  return getActiveJobForProject(fp2);
}
function _tiersNeedRepair(tiers) {
  const slots = ["brain", "medium", "cheap"];
  if (!tiers || typeof tiers !== "object") return true;
  return slots.some((slot) => {
    const oc = String(tiers?.trinity?.[slot]?.oc || "").trim();
    return !oc || PLACEHOLDER_RE.test(oc);
  });
}
async function _seedOrRepairModelTiers(directory3) {
  const TIERS_FILE3 = getTiersFile();
  let existing = null;
  if (existsSync18(TIERS_FILE3)) {
    try {
      const st = statSync9(TIERS_FILE3);
      if (st.size > 10485760) {
        _handleStateCorruption(TIERS_FILE3);
        return false;
      }
      existing = safeJsonParse2(readFileSync17(TIERS_FILE3, "utf-8")) || {};
    } catch {
      existing = null;
    }
  }
  if (existing && !_tiersNeedRepair(existing))
    return false;
  const providers = _loadOpenCodeProviders(directory3);
  const auth = typeof _readAuth === "function" ? _readAuth() : {};
  let discovered = [];
  try {
    discovered = await discoverAvailableModels(providers, auth);
  } catch {
  }
  let trinity = null;
  try {
    trinity = buildDeterministicTrinity(discovered, { selectedModelId: currentModel });
  } catch {
  }
  let brain = trinity?.brain || currentModel || readConfig(directory3) || readConfig(getOpenCodeHome()) || process?.env?.OPENCODE_MODEL || "";
  let medium = trinity?.medium || brain;
  let cheap = trinity?.cheap || medium || brain;
  if (!brain) {
    brain = "deepseek/deepseek-v4-pro";
    medium = "deepseek/deepseek-v4-flash";
    cheap = "deepseek/deepseek-chat";
    console.error("[vibeOS] no providers detected \u2014 using default model tiers (brain=v4-pro, medium=v4-flash, cheap=v4-chat)");
  }
  const existingSelection = existing?.selection && typeof existing.selection === "object" ? existing.selection : {};
  const existingTrinity = existing?.trinity && typeof existing.trinity === "object" ? existing.trinity : {};
  const keepExistingSlot = (slotRow, fallbackModel) => {
    const currentOc = String(slotRow?.oc || "").trim();
    if (currentOc && !PLACEHOLDER_RE.test(currentOc) && !/placeholder/i.test(currentOc)) {
      return { ...slotRow, cc: slotRow?.cc || modelToCcAlias(currentOc) };
    }
    return { oc: fallbackModel, cc: modelToCcAlias(fallbackModel) };
  };
  const nextTrinity = {
    brain: keepExistingSlot(existingTrinity.brain, brain),
    medium: keepExistingSlot(existingTrinity.medium, medium),
    cheap: keepExistingSlot(existingTrinity.cheap, cheap)
  };
  const activeSlot = ["brain", "medium", "cheap"].includes(String(existingSelection.active_slot || "").trim()) ? String(existingSelection.active_slot) : "brain";
  const tiers = {
    ...existing,
    selection: {
      ...existingSelection,
      enabled: existingSelection.enabled !== false,
      active_slot: activeSlot,
      thinking_level: existingSelection.thinking_level || "off",
      delegation_enforce: existingSelection.delegation_enforce !== false,
      flow_enabled: existingSelection.flow_enabled === true,
      flow_enforce: existingSelection.flow_enforce === true,
      tdd_enforce: existingSelection.tdd_enforce === true,
      tdd_strict: existingSelection.tdd_strict === true,
      tdd_quality: existingSelection.tdd_quality !== false,
      onboarding_mode: existingSelection.onboarding_mode || "assist",
      setup_completed_at: existingSelection.setup_completed_at || (/* @__PURE__ */ new Date()).toISOString()
    },
    trinity: nextTrinity
  };
  mkdirSync14(dirname13(TIERS_FILE3), { recursive: true });
  writeFileSync16(TIERS_FILE3, JSON.stringify(tiers, null, 2) + "\n", "utf-8");
  return true;
}
function _parseJsonc(raw) {
  const noBlock = String(raw || "").replace(/\/\*[\s\S]*?\*\//g, "");
  const noLine = noBlock.replace(/(^|\s)\/\/.*$/gm, "$1");
  const noTrailing = noLine.replace(/,\s*([}\]])/g, "$1");
  return safeJsonParse2(noTrailing);
}
function _modelCost2(id2) {
  if (!id2)
    return 0;
  const c = modelCostPerTurn(id2);
  if (c != null)
    return c;
  const stripped = String(id2).includes("/") ? String(id2).split("/").slice(1).join("/") : String(id2);
  return modelCostPerTurn(stripped) ?? 0;
}
function _modelTier2(id2) {
  if (!id2)
    return "budget";
  const high = HIGH_TIER_RE?.test?.(id2);
  if (high)
    return "high";
  const mid = MID_TIER_RE?.test?.(id2);
  return mid ? "mid" : "budget";
}
function readPackageVersion() {
  try {
    const pkg = safeJsonParse2(readFileSync17(join18(process.cwd(), "package.json"), "utf-8"));
    return String(pkg?.version || "");
  } catch {
    return "";
  }
}
function loadMcpPort() {
  const envPort = process.env.VIBEOS_MCP_PORT;
  if (envPort != null && envPort !== "") {
    const n = Number(envPort);
    if (!Number.isFinite(n))
      return 0;
    return n;
  }
  try {
    if (existsSync18(getTiersFile())) {
      const tiers = safeJsonParse2(readFileSync17(getTiersFile(), "utf-8"));
      const cfg = tiers?.selection?.mcp_port;
      if (cfg === false || cfg === "disabled" || cfg === 0)
        return 0;
      const n = Number(cfg);
      if (Number.isFinite(n))
        return n;
    }
  } catch {
  }
  return null;
}
function persistMcpPort(port) {
  try {
    if (!existsSync18(getTiersFile()))
      return;
    const tiers = safeJsonParse2(readFileSync17(getTiersFile(), "utf-8"));
    tiers.selection ??= {};
    if (Number(tiers.selection.mcp_port) === Number(port) && !("mcp_port" in tiers))
      return;
    tiers.selection.mcp_port = port;
    if ("mcp_port" in tiers)
      delete tiers.mcp_port;
    mkdirSync14(dirname13(getTiersFile()), { recursive: true });
    const tmp = getTiersFile() + ".tmp." + Date.now();
    writeFileSync16(tmp, JSON.stringify(tiers, null, 2) + "\n", "utf-8");
    renameSync6(tmp, getTiersFile());
  } catch {
  }
}
function clearMcpRestartTimer() {
  if (_mcpServerRestartTimer != null) {
    clearTimeout(_mcpServerRestartTimer);
    _mcpServerRestartTimer = null;
  }
}
function scheduleMcpServerRestart() {
  if (_mcpServerClosing || !_mcpServerShouldRun)
    return;
  if (_mcpServerRestartTimer != null)
    return;
  _mcpServerRestartTimer = setTimeout(() => {
    _mcpServerRestartTimer = null;
    void ensureMcpServerRunning();
  }, 500);
  if (typeof _mcpServerRestartTimer.unref === "function") _mcpServerRestartTimer.unref();
}
function attachMcpServerWatchdog(server2) {
  server2?.once?.("close", () => {
    if (_mcpServerClosing)
      return;
    _mcpServerRuntime = null;
    scheduleMcpServerRestart();
  });
  server2?.once?.("error", () => {
    if (_mcpServerClosing)
      return;
    _mcpServerRuntime = null;
    scheduleMcpServerRestart();
  });
}
async function ensureMcpServerRunning() {
  const port = loadMcpPort();
  if (port === 0)
    return null;
  if (_mcpServerRuntime)
    return _mcpServerRuntime;
  if (_mcpServerStartupPromise)
    return _mcpServerStartupPromise;
  _mcpServerClosing = false;
  _mcpServerShouldRun = true;
  _mcpServerStartupPromise = Promise.resolve().then(async () => {
    try {
      if (!_mcpServerRuntime) {
        _mcpServerRuntime = createMcpServer({
          getState: () => ({
            ...buildStatusPayload({
              selection: loadSelection(),
              tiersData: (() => {
                try {
                  return safeJsonParse2(readFileSync17(getTiersFile(), "utf-8"));
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
              backendVersion: getBackendVersion(),
              apiFallbackMode: isApiFallback(),
              apiFallbackSince: getApiFallbackSince(),
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
            if (!existsSync18(getReportsDir2())) {
              const e = new Error("reports dir not found");
              e.status = 404;
              throw e;
            }
            return listReports(filter || {});
          },
          readReport: (rvId) => readReport(rvId),
          runDiagnose: async () => {
            const trinity = _pluginHooksRuntime?.tool?.trinity;
            if (!trinity?.execute)
              return { error: "trinity runtime unavailable" };
            return diagnoseStructuredFromText(await trinity.execute({ action: "diagnose" }), loadCredit());
          },
          runProject: async () => {
            const trinity = _pluginHooksRuntime?.tool?.trinity;
            if (!trinity?.execute)
              return { error: "trinity runtime unavailable" };
            return projectStructuredFromText(await trinity.execute({ action: "project" }), loadSelection(), loadCredit());
          },
          runTrinity: async (rvAction, params = {}) => {
            const trinity = _pluginHooksRuntime?.tool?.trinity;
            if (!trinity?.execute)
              return { error: "trinity runtime unavailable" };
            return trinity.execute({ action: rvAction, slot: params.slot, level: params.level });
          },
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
          },
          getBlackboxState: () => {
            const tracker = getBlackboxTracker();
            const res = getBlackboxResolution();
            return {
              sub_regime: res?.sub_regime || _latestBlackboxState?.sub_regime || "INIT",
              resolution: res?.resolution || "INIT",
              momentum: res?.momentum ?? 0,
              features: _latestBlackboxState?.features || {},
              signals: _latestBlackboxState?.signals || {},
              loop: {
                active: _latestBlackboxLoopMsg !== null,
                message: _latestBlackboxLoopMsg,
                intervention_level: _latestBlackboxLoopMsg?.intervention_level || _latestBlackboxState?.loop?.intervention_level || 0,
                consecutive_loops: _latestBlackboxState?.loop?.consecutive_loops || 0
              },
              pivot: {
                detected: _latestBlackboxPivotMsg !== null,
                message: _latestBlackboxPivotMsg
              },
              continuity_state: _latestBlackboxState?.continuity_state || null,
              turn_index: _latestBlackboxState?.turn_index ?? 0,
              stress_level: _latestBlackboxState?.stress_level ?? 0,
              session_id: _OC_SID,
              project_fingerprint: currentProjectFingerprint
            };
          },
          saveBlackboxVector: (vector) => {
            const state = loadBlackboxState() || {};
            const sid = getCurrentSessionId() || _OC_SID;
            if (!state.sessions)
              state.sessions = {};
            if (!state.sessions[sid])
              state.sessions[sid] = {};
            if (!state.sessions[sid].dashboard_vectors)
              state.sessions[sid].dashboard_vectors = [];
            state.sessions[sid].dashboard_vectors.push({
              timestamp: Date.now(),
              received_at: (/* @__PURE__ */ new Date()).toISOString(),
              ...vector
            });
            saveBlackboxState(state);
          },
          saveBlackboxOutcome: (outcome) => {
            const state = loadBlackboxState() || {};
            const sid = getCurrentSessionId() || _OC_SID;
            if (!state.sessions)
              state.sessions = {};
            if (!state.sessions[sid])
              state.sessions[sid] = {};
            if (!state.sessions[sid].dashboard_outcomes)
              state.sessions[sid].dashboard_outcomes = [];
            state.sessions[sid].dashboard_outcomes.push({
              timestamp: Date.now(),
              received_at: (/* @__PURE__ */ new Date()).toISOString(),
              ...outcome
            });
            saveBlackboxState(state);
          }
        });
      }
      const requestedPort = port == null ? 0 : port;
      const mcpServer = await _mcpServerRuntime.start(requestedPort);
      const actualPort = Number(mcpServer?.address?.()?.port || requestedPort);
      if (actualPort && actualPort !== requestedPort)
        persistMcpPort(actualPort);
      if (actualPort)
        writeDashboardBaseConfig(`http://127.0.0.1:${actualPort}`);
      console.error(`[vibeOS] MCP server on http://127.0.0.1:${actualPort}`);
      if (actualPort)
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
      clearMcpRestartTimer();
      attachMcpServerWatchdog(mcpServer);
      return mcpServer;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || "unknown error");
      console.error(`[vibeOS] MCP startup failed: ${msg}`);
      _mcpServerRuntime = null;
      scheduleMcpServerRestart();
      return null;
    } finally {
      _mcpServerStartupPromise = null;
    }
  });
  return _mcpServerStartupPromise;
}
async function DelegationEnforcer({ client: client2, directory: directory3 } = {}) {
  console.error(`[vibeOS] LOADED cwd=${directory3}`);
  const hookHome = process.env.HOME || USER_HOME2;
  const hookFp = projectFingerprint(directory3 || "");
  if (!globalThis.__vibeOS_sessionId) {
    globalThis.__vibeOS_sessionId = `opencode-${process.pid || "x"}-${Date.now()}`;
  }
  const hookSessionId = globalThis.__vibeOS_sessionId;
  setVibeOSHomeContext(getVibeOSHome13());
  setCurrentSessionId(hookSessionId);
  if (hookFp) {
    setCurrentProjectFingerprint(hookFp);
    setCurrentProjectName(directory3 ? directory3.split("/").pop() : "unknown");
  }
  if (typeof setToolDirectory === "function")
    setToolDirectory(directory3 || "");
  if (typeof setShellDirectory === "function")
    setShellDirectory(directory3 || "");
  registerSessionCleanupHandlers();
  pruneScratchpadOnce();
  runStartupMaintenanceOnce();
  const _bootstrapModel = await _resolveBootstrapModel(client2, directory3);
  if (_bootstrapModel.model) {
    setCurrentModel(_bootstrapModel.model);
    setCurrentTier(classify(_bootstrapModel.model));
  }
  if (currentModel) {
    setCurrentTier(classify(currentModel));
    try {
      const _tiersData2 = safeJsonParse2(readFileSync17(getTiersFile(), "utf-8"));
      const _slotOrder = getTrinitySlotOrder(_tiersData2);
      const _primarySlot = _slotOrder[0] || "brain";
      const _activeSlot = _tiersData2?.selection?.active_slot || _primarySlot;
      if (_activeSlot === _primarySlot) {
        const _brainOcModel = _tiersData2?.trinity?.[_primarySlot]?.oc || "";
        if (_brainOcModel && currentModel === _brainOcModel && !PLACEHOLDER_RE.test(_brainOcModel)) {
          const cost = modelCostPerTurn(_brainOcModel);
          if (HIGH_TIER_RE.test(_brainOcModel) || cost !== null && cost >= 0.01) {
            setCurrentTier("high");
            console.error(`[vibeOS] tier override \u2192 high (primary slot)`);
          }
        }
      }
    } catch {
    }
    console.error(`[vibeOS] ACTIVE: model=${currentModel} tier=${currentTier}`);
  } else {
    console.error("[vibeOS] NO MODEL \u2014 enforcement disabled, will auto-detect on first hook");
  }
  try {
    const startupSelection = loadSelection();
    if (startupSelection?.slot_locked === true) {
      const lockedSlot = ["brain", "medium", "cheap"].includes(String(startupSelection.active_slot || "").trim()) ? String(startupSelection.active_slot) : "brain";
      let lockedModel = currentModel || null;
      try {
        const tiers = safeJsonParse2(readFileSync17(getTiersFile(), "utf-8"));
        lockedModel = tiers?.trinity?.[lockedSlot]?.oc || lockedModel || null;
      } catch {
      }
      setModelLocked(true);
      setLockedSlot(lockedSlot);
      setLockedModel(lockedModel);
      console.error(`[vibeOS] startup lock restored \u2192 ${lockedSlot}${lockedModel ? ` (${lockedModel})` : ""}`);
    } else {
      setModelLocked(false);
      setLockedSlot(null);
      setLockedModel(null);
    }
  } catch {
  }
  console.error(`[vibeOS] auto-config guard: currentModel=${currentModel ? "SET" : "NONE"}, TIERS_FILE=${getTiersFile()}, exists=${existsSync18(getTiersFile())}`);
  try {
    if (!existsSync18(getTiersFile())) {
      console.error(`[vibeOS] model-tiers.json missing at load; will seed on first hook`);
    }
    await _seedOrRepairModelTiers(directory3);
    loadTrinitySlotsFromTiersFile();
  } catch {
  }
  if (detectContext7())
    console.error(`[vibeOS] context7 detected \u2014 docs nudge enabled`);
  fp = projectFingerprint(directory3);
  setCurrentProjectFingerprint(fp);
  setCurrentProjectName(directory3 ? directory3.split("/").pop() : "unknown");
  briefedProjects.clear();
  activeJob2 = _loadActiveJobForProject(directory3, fp);
  const systemBriefedProjects = /* @__PURE__ */ new Set();
  const hookVibeHome = getVibeOSHome13();
  const hookStateFile = join18(hookVibeHome, "delegation-state.json");
  const hookProjectStateFile = join18(hookVibeHome, "project-states.json");
  const hookReportsDir = join18(hookVibeHome, "reports");
  const hookReportsIndex = join18(hookReportsDir, "index.json");
  const hookTiersFile = join18(hookVibeHome, "model-tiers.json");
  const loadProjectStateStable = () => {
    try {
      const state = safeJsonParse2(readFileSync17(hookProjectStateFile, "utf-8"));
      if (state && typeof state === "object") {
        state.project_hashes ??= {};
        return state;
      }
    } catch {
    }
    return { project_hashes: {} };
  };
  const saveProjectStateStable = (state) => {
    try {
      mkdirSync14(dirname13(hookProjectStateFile), { recursive: true });
      const tmp = hookProjectStateFile + ".tmp";
      writeFileSync16(tmp, JSON.stringify(state, null, 2) + "\n");
      renameSync6(tmp, hookProjectStateFile);
    } catch {
    }
  };
  const reportsIndexStable = () => {
    try {
      const idx = safeJsonParse2(readFileSync17(hookReportsIndex, "utf-8"));
      if (!idx || !Array.isArray(idx.reports))
        return { reports: [] };
      return idx;
    } catch {
      return { reports: [] };
    }
  };
  const saveReportsIndexStable = (idx) => {
    try {
      mkdirSync14(hookReportsDir, { recursive: true });
      writeFileSync16(hookReportsIndex, JSON.stringify(idx, null, 2) + "\n");
    } catch {
    }
  };
  const backupFileStable = (path, label) => {
    try {
      if (!existsSync18(path))
        return null;
      const bkDir = join18(hookVibeHome, ".backups");
      mkdirSync14(bkDir, { recursive: true });
      const bk = join18(bkDir, `${basename5(path)}.${label}.${Date.now()}.bak`);
      copyFileSync2(path, bk);
      return bk;
    } catch {
      return null;
    }
  };
  _runDeferredStartupBootstrap = () => {
  };
  const _tiersData = (() => {
    try {
      return safeJsonParse2(readFileSync17(getTiersFile(), "utf-8"));
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
    _latestBlackboxState,
    currentModel,
    currentTier,
    currentProjectFingerprint,
    currentProjectName,
    get latestUserIntent() {
      return latestUserIntent;
    },
    directory: directory3,
    safeJsonParse: safeJsonParse2,
    readFileSync: readFileSync17,
    writeFileSync: writeFileSync16,
    existsSync: existsSync18,
    renameSync: renameSync6,
    mkdirSync: mkdirSync14,
    get TIERS_FILE() {
      return hookTiersFile;
    },
    USER_HOME: USER_HOME2,
    get STATE_FILE() {
      return hookStateFile;
    },
    CREDIT_CACHE_F,
    SAVINGS_LEDGER_FILE,
    PROJECT_STATE_FILE: hookProjectStateFile,
    get REPORTS_DIR() {
      return hookReportsDir;
    },
    get REPORTS_INDEX() {
      return hookReportsIndex;
    },
    get OPENCODE_HOME() {
      return getOpenCodeHome();
    },
    get VIBEOS_HOME() {
      return hookVibeHome;
    },
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
    loadProjectState: loadProjectStateStable,
    saveProjectState: saveProjectStateStable,
    ensureProjectBucket,
    mergeProjectBucket,
    clearProjectPatterns,
    projectPatternRows,
    promotedProjectPatterns,
    detectTechStack,
    ensureProjectDocs,
    ensureProjectSkill,
    discoverAvailableModels,
    classifyAndRankModels,
    modelToCcAlias,
    probeModel,
    setBlackboxEnabled,
    loadBlackboxState,
    saveBlackboxState,
    isApiFallback: () => isApiFallback(),
    get _apiFallbackSince() {
      return getApiFallbackSince();
    },
    reportsIndex: reportsIndexStable,
    saveReportsIndex: saveReportsIndexStable,
    backupFile: backupFileStable,
    writeSessionSlot: writeSessionSlot2,
    writeSessionOptMode: writeSessionOptMode2,
    _refreshModel,
    setApiToken,
    setApiBootstrapToken,
    ensureBootstrapExchange,
    loadTodos,
    upsertTodo,
    getTodos,
    markTodoDone,
    syncFlowTodosToNative,
    resetBlackboxTracker,
    get _blackboxTracker() {
      return getBlackboxTracker();
    },
    set _blackboxTracker(v) {
      resetBlackboxTracker();
    },
    get _blackboxEnabled() {
      return _blackboxEnabled;
    },
    set _blackboxEnabled(v) {
      setBlackboxEnabled(v);
    },
    get _modelLocked() {
      return _modelLocked;
    },
    set _modelLocked(v) {
      setModelLocked(v);
    },
    get _lockedSlot() {
      return _lockedSlot;
    },
    set _lockedSlot(v) {
      setLockedSlot(v);
    },
    get _lockedModel() {
      return _lockedModel;
    },
    set _lockedModel(v) {
      setLockedModel(v);
    }
  };
  const pluginHooks = {
    "tool.execute.before": async (input, output) => {
      setVibeOSHomeContext(hookVibeHome);
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp);
        setCurrentProjectName(directory3 ? directory3.split("/").pop() : "unknown");
      }
      ensureDeferredBootstrap();
      if (directory3 && hookFp && !_skillsEnsured.has(hookFp)) {
        try {
          ensureProjectSkill(directory3, hookFp);
          _skillsEnsured.add(hookFp);
        } catch (_e) {
        }
      }
      onToolExecuteBefore._directory = directory3;
      return onToolExecuteBefore(input, output);
    },
    "tool.execute.after": async (input, output) => {
      setVibeOSHomeContext(hookVibeHome);
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp);
        setCurrentProjectName(directory3 ? directory3.split("/").pop() : "unknown");
      }
      onToolExecuteAfter._directory = directory3;
      return onToolExecuteAfter(input, output);
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      ensureDeferredBootstrap();
      return onMessagesTransform(_input, output);
    },
    "experimental.session.compacting": async (_input, output) => {
      return onSessionCompacting(_input, output);
    },
    "experimental.chat.system.transform": async (_input, output) => {
      setVibeOSHomeContext(hookVibeHome);
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp);
        setCurrentProjectName(directory3 ? directory3.split("/").pop() : "unknown");
      }
      ensureDeferredBootstrap();
      onSystemTransform._directory = directory3;
      onSystemTransform._activeJob = activeJob2;
      onSystemTransform._briefedProjects = systemBriefedProjects;
      return onSystemTransform(_input, output);
    },
    "shell.env": async (_input, output) => {
      setVibeOSHomeContext(hookVibeHome);
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp);
        setCurrentProjectName(directory3 ? directory3.split("/").pop() : "unknown");
      }
      if (typeof setShellDirectory === "function")
        setShellDirectory(directory3 || "");
      return onShellEnv(_input, output);
    },
    "experimental.text.complete": async (_input, output) => {
      setVibeOSHomeContext(hookVibeHome);
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp);
        setCurrentProjectName(directory3 ? directory3.split("/").pop() : "unknown");
      }
      ensureDeferredBootstrap();
      await _appendFooter(_input, output, directory3);
    },
    "message.updated": async (_input, output) => {
      setVibeOSHomeContext(hookVibeHome);
      if (hookFp) {
        setCurrentProjectFingerprint(hookFp);
        setCurrentProjectName(directory3 ? directory3.split("/").pop() : "unknown");
      }
      ensureDeferredBootstrap();
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
            for (const c of report.chains)
              findings.push({ severity: "warn", topic: "Domain chain", detail: `${c.domain}: ${c.count} fetches` });
            if (report.redundant > 0)
              findings.push({ severity: "warn", topic: "Context7 bypass", detail: `${report.redundant} bypasses` });
            if (report.totalFetches > 0)
              findings.push({ severity: "info", topic: "Fetch volume", detail: `${report.totalFetches} fetches, ${(report.totalBytes / 1024).toFixed(0)}KB` });
            saveReport({ type: "research-audit", summary: `${report.totalFetches} fetches, ${report.chains.length} chains`, findings, metrics: report, tags: ["research"] });
          } catch {
          }
          const lines = [`Research audit (last ${hours ?? 24}h):`];
          if (report.totalFetches === 0)
            return lines.concat("  No activity.").join("\n");
          lines.push(`  Fetches: ${report.totalFetches} (${(report.totalBytes / 1024).toFixed(0)}KB)`);
          if (report.redundant > 0)
            lines.push(`  Context7 bypasses: ${report.redundant}`);
          for (const c of report.chains)
            lines.push(`  Chain: ${c.domain} (${c.count}x)`);
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
            if (findings)
              parsedFindings = JSON.parse(findings);
          } catch {
            if (findings)
              for (const line of findings.split("\n").map((l) => l.trim()).filter(Boolean)) {
                const m = line.match(/^(warn|info|hint)\s*:\s*(.+?)\s*:\s*(.+)/i);
                if (m)
                  parsedFindings.push({ severity: m[1].toLowerCase(), topic: m[2].trim(), detail: m[3].trim() });
                else
                  parsedFindings.push({ severity: "info", topic: "Note", detail: line });
              }
          }
          try {
            if (metrics)
              parsedMetrics = JSON.parse(metrics);
          } catch {
            if (metrics)
              for (const line of metrics.split("\n").map((l) => l.trim()).filter(Boolean)) {
                const m = line.match(/^([\w-]+)\s*=\s*([\d.]+)/);
                if (m)
                  parsedMetrics[m[1]] = parseFloat(m[2]);
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
          if (reports.length === 0)
            return "No reports found.";
          const lines = [`Reports (last ${hours ?? 168}h): ${reports.length} total`];
          for (const r of reports.slice(0, 15)) {
            const d = r.created.slice(0, 16).replace("T", " ");
            lines.push(`  [${d}] #${r.id} ${r.type} ${(r.summary || "").slice(0, 80)}`);
          }
          if (reports.length > 15)
            lines.push(`  ... and ${reports.length - 15} more`);
          return lines.join("\n");
        }
      }),
      "report-read": tool({
        description: "Read a report by ID (from report-list).",
        args: { id: tool.schema.string({ description: "Report ID" }) },
        async execute({ id: id2 } = {}) {
          if (!id2 || !/^[\w-]+$/.test(id2))
            return `Invalid ID: ${id2}`;
          const report = readReport(id2);
          if (!report)
            return `Not found: ${id2}`;
          const d = (report?.meta?.created ?? report?.created ?? "?").slice(0, 16).replace("T", " ");
          const lines = [`Report #${id2}`, `  Type: ${report?.meta?.type ?? report?.type ?? "?"}  |  ${d}`];
          if (report.summary)
            lines.push(`  ${report.summary}`);
          if (report.tags?.length)
            lines.push(`  Tags: ${report.tags.join(", ")}`);
          if (report.narrative)
            lines.push(`  ---
${report.narrative}`);
          return lines.join("\n");
        }
      })
    }
  };
  _pluginHooksRuntime = pluginHooks;
  const _inTestEnv = process.env.VIBEOS_MCP_PORT === "0" || process.env.NODE_ENV === "test" || process.execArgv.some((arg) => arg === "--test" || arg.startsWith("--test="));
  if (!_inTestEnv)
    void ensureMcpServerRunning();
  return pluginHooks;
}
var id = "vibeOS";
var server = DelegationEnforcer;
var VERSION = readPackageVersion();
var index_default = { id: "vibeOS", server: DelegationEnforcer };
function closeMcpServer() {
  try {
    _mcpServerClosing = true;
    _mcpServerShouldRun = false;
    clearMcpRestartTimer();
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
  loadMcpPort as _loadMcpPort,
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
  getCurrentSessionId,
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
  setCurrentModel,
  setCurrentProjectFingerprint,
  setCurrentProjectName,
  setCurrentSessionId,
  setCurrentTier,
  setTrinityBrain,
  setTrinityCheap,
  setTrinityMedium,
  trendDisplay
};
