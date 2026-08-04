#!/usr/bin/env node

// src/bin/setup.ts
import { execFileSync } from "node:child_process";
import { readFileSync as readFileSync7, writeFileSync as writeFileSync7, existsSync as existsSync9, mkdirSync as mkdirSync6, renameSync as renameSync7 } from "node:fs";
import { dirname as dirname5, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/lib/opencode-homes.mjs
import { join } from "node:path";
import { homedir } from "node:os";
function resolveOpenCodeHomes({ home = homedir() } = {}) {
  const override = process.env.VIBEOS_OPENCODE_HOME;
  if (override) return [override];
  return [join(home, ".opencode")];
}
function resolveOpenCodeHome(opts = {}) {
  return resolveOpenCodeHomes(opts)[0];
}

// scripts/lib/vibe-tier-agents.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join as join2 } from "node:path";
import { homedir as homedir2 } from "node:os";
var VIBE_TIER_AGENT_BY_SLOT = {
  cheap: "vibe-cheap",
  medium: "vibe-medium",
  brain: "vibe-brain"
};
var VIBE_PRIMARY_AGENT = "vibe";
var NATIVE_OPENCODE_AGENTS = ["build", "plan", "vibe"];
function isNativeOpenCodeAgent(value) {
  return NATIVE_OPENCODE_AGENTS.includes(String(value || "").trim().toLowerCase());
}
function normalizeNativeOpenCodeAgent(value, fallback = VIBE_PRIMARY_AGENT) {
  const normalized = String(value || "").trim().toLowerCase();
  return isNativeOpenCodeAgent(normalized) ? normalized : fallback;
}
function readJson(path) {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf8");
    const cleaned = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function readTiers(home = homedir2()) {
  return readJson(join2(process.env.VIBEOS_HOME || join2(home, ".claude"), "model-tiers.json"));
}
function primaryAgent(existing = {}) {
  const next = {
    ...existing && typeof existing === "object" ? existing : {},
    description: "VibeUltraX primary agent",
    mode: "primary",
    permission: {
      read: "allow",
      edit: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      bash: "allow",
      task: "allow",
      webfetch: "allow",
      websearch: "allow",
      ...existing?.permission && typeof existing.permission === "object" ? existing.permission : {}
    }
  };
  delete next.model;
  return next;
}
function tierAgent(slot, model, existing = {}) {
  return {
    ...existing && typeof existing === "object" ? existing : {},
    description: `VibeUltraX ${slot} tier subagent`,
    mode: "subagent",
    model,
    permission: {
      read: "allow",
      edit: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      bash: "allow",
      task: "allow",
      webfetch: "allow",
      websearch: "allow",
      ...existing?.permission && typeof existing.permission === "object" ? existing.permission : {}
    }
  };
}
function installVibeTierAgentsInConfig(config, tiers = readTiers()) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const trinity = tiers?.trinity || {};
  config.$schema ||= "https://opencode.ai/config.json";
  config.agent = config.agent && typeof config.agent === "object" ? config.agent : {};
  let changed = false;
  const existingPrimary = config.agent[VIBE_PRIMARY_AGENT];
  const nextPrimary = primaryAgent(existingPrimary);
  if (JSON.stringify(existingPrimary || null) !== JSON.stringify(nextPrimary)) {
    config.agent[VIBE_PRIMARY_AGENT] = nextPrimary;
    changed = true;
  }
  const nextDefaultAgent = normalizeNativeOpenCodeAgent(String(config.default_agent || "").trim() || VIBE_PRIMARY_AGENT);
  if (config.default_agent !== nextDefaultAgent) {
    config.default_agent = nextDefaultAgent;
    changed = true;
  }
  for (const slot of ["cheap", "medium", "brain"]) {
    const model = String(trinity?.[slot]?.oc || "").trim();
    const name = VIBE_TIER_AGENT_BY_SLOT[slot];
    if (!model || !name) continue;
    const existing = config.agent[name];
    const next = tierAgent(slot, model, existing);
    if (JSON.stringify(existing || null) !== JSON.stringify(next)) {
      config.agent[name] = next;
      changed = true;
    }
  }
  return changed;
}

// scripts/lib/plugin-config.mjs
import { existsSync as existsSync2 } from "node:fs";
import { resolve } from "node:path";
function resolveVibeOSPluginRef(home) {
  return resolve(home, "plugins", "vibeOS.js");
}
function normalizeVibeOSPluginRefs(pluginList, canonicalPluginRef) {
  const refs = Array.isArray(pluginList) ? pluginList : [];
  const kept = [];
  let hasCanonical = false;
  for (const ref of refs) {
    if (typeof ref !== "string") {
      kept.push(ref);
      continue;
    }
    if (!ref.includes("vibeOS")) {
      kept.push(ref);
      continue;
    }
    const normalized = resolve(ref);
    if (normalized === canonicalPluginRef || ref === canonicalPluginRef) {
      if (!hasCanonical) {
        hasCanonical = true;
        kept.push(canonicalPluginRef);
      }
      continue;
    }
    if (existsSync2(normalized)) continue;
  }
  if (!hasCanonical) kept.push(canonicalPluginRef);
  return kept;
}

// src/lib/runtime-config.ts
import { existsSync as existsSync8, mkdirSync as mkdirSync5, readFileSync as readFileSync6, writeFileSync as writeFileSync6, renameSync as renameSync6, readdirSync as readdirSync3, rmSync as rmSync3 } from "node:fs";
import { basename as basename3, dirname as dirname4, join as join7 } from "node:path";
import { homedir as homedir5 } from "node:os";

// src/lib/state.ts
import { readFileSync as readFileSync5, writeFileSync as writeFileSync5, appendFileSync as appendFileSync3, existsSync as existsSync7, mkdirSync as mkdirSync4, statSync as statSync3, readdirSync as readdirSync2, openSync, readSync, closeSync, rmSync as rmSync2, copyFileSync as copyFileSync2, renameSync as renameSync5 } from "node:fs";
import { join as join6, dirname as dirname3, basename as basename2 } from "node:path";
import { createHash as createHash3 } from "node:crypto";

// src/lib/selection-manager.ts
import { readFileSync as readFileSync3, writeFileSync as writeFileSync3, existsSync as existsSync4, statSync, renameSync as renameSync3 } from "node:fs";
import { join as join3 } from "node:path";
import { homedir as homedir3, tmpdir } from "node:os";

// src/utils/fs-helpers.ts
import { appendFileSync, existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2, renameSync as renameSync2 } from "node:fs";
function ensureDir(dirPath) {
  if (!existsSync3(dirPath)) mkdirSync2(dirPath, { recursive: true });
}
var _rotationCounters = /* @__PURE__ */ new Map();
function appendJsonlWithRotation(filePath, lines, maxLines = 5e3, checkEveryLines = 200) {
  ensureDir(filePath.slice(0, filePath.lastIndexOf("/")));
  const payload = Array.isArray(lines) ? lines.join("") : lines;
  appendFileSync(filePath, payload);
  const count = (_rotationCounters.get(filePath) || 0) + 1;
  if (count < checkEveryLines) {
    _rotationCounters.set(filePath, count);
    return;
  }
  _rotationCounters.set(filePath, 0);
  try {
    withFileLock(filePath, () => {
      const raw = readFileSync2(filePath, "utf-8");
      const allLines = raw.split("\n").filter(Boolean);
      if (allLines.length > maxLines) {
        const trimmed = allLines.slice(-maxLines).join("\n") + "\n";
        const tmp = filePath + ".tmp";
        writeFileSync2(tmp, trimmed);
        renameSync2(tmp, filePath);
      }
    }, { timeoutMs: 4e3 });
  } catch {
  }
}
function safeJsonParse(raw) {
  if (raw == null || raw === "") return null;
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

// src/lib/selection-manager.ts
var _USER_HOME = (() => {
  try {
    return homedir3();
  } catch {
    return tmpdir();
  }
})();

// src/lib/loop-state.ts
var LOOP_HOLD_MS = 10 * 60 * 1e3;

// src/lib/pattern-helpers.ts
import { relative, basename } from "node:path";

// src/lib/runtime-state.ts
var RUNTIME_KEY = "__vibeOSRuntimeState";
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

// src/lib/runtime-paths.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync as existsSync5 } from "node:fs";
import { homedir as homedir4, tmpdir as tmpdir2 } from "node:os";
import { join as join4 } from "node:path";
var USER_HOME = (() => {
  try {
    return homedir4();
  } catch {
    return tmpdir2();
  }
})();
var RUNTIME_HOME_CONTEXT = new AsyncLocalStorage();
function resolveVibeOSHome() {
  return process.env.VIBEOS_HOME || join4(process.env.HOME || USER_HOME, ".claude");
}
function resolveOpenCodeHomes2() {
  const override = process.env.VIBEOS_OPENCODE_HOME || process.env.OPENCODE_HOME;
  if (override) return [override];
  const base = process.env.HOME || USER_HOME;
  const homes = [join4(base, ".opencode")];
  const xdgConfig = process.env.XDG_CONFIG_HOME || join4(base, ".config");
  const xdgOpenCode = join4(xdgConfig, "opencode");
  if (xdgOpenCode !== homes[0]) homes.push(xdgOpenCode);
  return homes;
}
function hasOpenCodeConfig(dir) {
  return existsSync5(join4(dir, "opencode.json")) || existsSync5(join4(dir, "opencode.jsonc"));
}
function resolveOpenCodeHome2() {
  const homes = resolveOpenCodeHomes2();
  for (const home of homes) {
    if (hasOpenCodeConfig(home)) return home;
  }
  for (const home of homes) {
    if (existsSync5(home)) return home;
  }
  return homes[0] || join4(process.env.HOME || USER_HOME, ".config", "opencode");
}
function getVibeOSHome2() {
  return process.env.VIBEOS_HOME || RUNTIME_HOME_CONTEXT.getStore()?.home || join4(process.env.HOME || USER_HOME, ".claude");
}

// src/lib/state/scratchpad-cache.ts
import { readFileSync as readFileSync4, writeFileSync as writeFileSync4, appendFileSync as appendFileSync2, existsSync as existsSync6, mkdirSync as mkdirSync3, statSync as statSync2, readdirSync, rmSync, copyFileSync, renameSync as renameSync4 } from "node:fs";
import { join as join5, dirname as dirname2 } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
var SCRATCHPAD_SESSION_TTL_MS = 48 * 60 * 60 * 1e3;
var SCRATCHPAD_MAX_AGE_SEC = Number(process.env.CLAUDE_SCRATCHPAD_MAX_AGE_SEC || 86400);
var MAX_SCRATCHPAD_BYTES = 10 * 1024 * 1024;
var MAX_SESSION_SCRATCHPAD_BYTES = 2 * 1024 * 1024;
var DECADENCE_FRESH_MS = 5 * 60 * 1e3;
var DECADENCE_COLD_MS = 24 * 60 * 60 * 1e3;
var DECADENCE_EXPIRE_MS = 48 * 60 * 60 * 1e3;
var DECADENCE_THROTTLE_MS = 60 * 1e3;

// src/vibeOS-lib/smart-cache.ts
function createCacheDatabase() {
  return { entries: [], stats: {} };
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

// src/lib/session-orchestrator.ts
import { createHash as createHash2 } from "node:crypto";

// src/lib/templates.ts
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
var TEMPLATE_LIBRARY = Object.entries(TEMPLATES).map(([id, tpl]) => ({
  id,
  label: id === "save" ? "Save" : id.charAt(0).toUpperCase() + id.slice(1),
  summary: tpl.directive,
  directive: tpl.directive,
  tier_bias: tpl.tier_bias,
  thinking_mode: tpl.thinking_mode,
  enforcement_mode: tpl.enforcement_mode,
  flow_mode: tpl.flow_mode,
  tdd_mode: tpl.tdd_mode
}));

// src/lib/state.ts
function loadGlobalLearning() {
  const globalLearningFile = join6(getVibeOSHome(), "global-learning.json");
  try {
    if (!existsSync7(globalLearningFile)) return DFLT_GL;
    const st = statSync3(globalLearningFile);
    if (st.size > 10485760) {
      _handleStateCorruption(globalLearningFile);
      return DFLT_GL;
    }
    const j = safeJsonParse(readFileSync5(globalLearningFile, "utf-8"));
    if (!j || typeof j !== "object") return DFLT_GL;
    j.exploratory_words ??= {};
    j.task_first_words ??= {};
    j.context7_bypasses ??= 0;
    j.context7_missed_usd ??= 0;
    j.context7_last_seen ??= null;
    return j;
  } catch {
    _handleStateCorruption(globalLearningFile);
    return DFLT_GL;
  }
}
var VIBEOS_HOME = resolveVibeOSHome();
var OPENCODE_HOME = resolveOpenCodeHome2();
var FILE_LOCK_DIR = join6(VIBEOS_HOME, ".vibeOS-locks");
var DELEGATION_STATE_FILE = join6(VIBEOS_HOME, "delegation-state.json");
var SAVINGS_LEDGER_FILE = join6(VIBEOS_HOME, "savings-ledger.jsonl");
var GLOBAL_LEARNING_FILE = join6(VIBEOS_HOME, "global-learning.json");
var PRICING_CACHE_FILE = join6(VIBEOS_HOME, "model-pricing-cache.json");
var BLACKBOX_STATE_FILE = join6(VIBEOS_HOME, "blackbox-state.json");
var PROJECT_STATE_FILE = join6(VIBEOS_HOME, "project-states.json");
var TIERS_FILE = join6(VIBEOS_HOME, "model-tiers.json");
var ACTIVE_JOBS_FILE = join6(VIBEOS_HOME, "active-jobs.json");
var AUTH_F = join6(USER_HOME, ".local", "share", "opencode", "auth.json");
var CREDIT_CACHE_F = join6(VIBEOS_HOME, "credit-snapshot.json");
var FLOW_TODO_QUEUE_FILE = join6(VIBEOS_HOME, ".flow-todo-queue.jsonl");
var FLOW_DEDUP_FILE = join6(VIBEOS_HOME, ".flow-dedup-keys.json");
var ENFORCEMENT_COOLDOWN_FILE = join6(VIBEOS_HOME, ".enforcement-cooldown.jsonl");
var TODOS_FILE = join6(VIBEOS_HOME, "todos.json");
var REPORTS_DIR = join6(VIBEOS_HOME, "reports");
var CONTEXT7_INSTALL_FLAG = join6(VIBEOS_HOME, ".context7-install-suggested");
var TRINITY_OPENCODE_CONFIG = join6(OPENCODE_HOME, "opencode.json");
var TRINITY_OPENCODE_CONFIGC = join6(OPENCODE_HOME, "opencode.jsonc");
var SCRATCHPAD_ROOT = join6(VIBEOS_HOME, "scratch");
var SCRATCHPAD_GLOBAL_DIR = join6(SCRATCHPAD_ROOT, "by-hash");
var SCRATCHPAD_SESSIONS_DIR = join6(SCRATCHPAD_ROOT, "sessions");
var SCRATCHPAD_SESSION_TTL_MS2 = 48 * 60 * 60 * 1e3;
var SCRATCHPAD_MAX_AGE_SEC2 = Number(process.env.CLAUDE_SCRATCHPAD_MAX_AGE_SEC || 86400);
var MAX_SCRATCHPAD_BYTES2 = 10 * 1024 * 1024;
var MAX_SESSION_SCRATCHPAD_BYTES2 = 2 * 1024 * 1024;
var CORRUPTION_BACKUP_MAX = 5;
var CORRUPTION_BACKUP_TTL_MS = 24 * 60 * 60 * 1e3;
var LEDGER_ROTATE_MAX_BYTES = 256 * 1024;
var LEDGER_ROTATE_MAX_AGE_MS = 48 * 60 * 60 * 1e3;
var ACTIVE_JOBS_STALE_MS = 72 * 60 * 60 * 1e3;
function getVibeOSHome() {
  return getVibeOSHome2();
}
function ensureCascadeAuditFiles() {
  try {
    const vibeHome = getVibeOSHome();
    if (!vibeHome || vibeHome === "undefined" || vibeHome.startsWith("undefined")) return;
    const dir = join6(vibeHome, "cascade-audit");
    mkdirSync4(dir, { recursive: true });
    for (const file of ["claim-audit.jsonl", "cascade-audit.jsonl"]) {
      const path = join6(dir, file);
      if (!existsSync7(path)) {
        writeFileSync5(path, "");
      }
    }
  } catch {
  }
}
ensureCascadeAuditFiles();
var _globalHookQueue = Promise.resolve();
function syncVibeOSPathBindings(home = resolveVibeOSHome()) {
  VIBEOS_HOME = home;
  OPENCODE_HOME = resolveOpenCodeHome2();
  FILE_LOCK_DIR = join6(VIBEOS_HOME, ".vibeOS-locks");
  DELEGATION_STATE_FILE = join6(VIBEOS_HOME, "delegation-state.json");
  SAVINGS_LEDGER_FILE = join6(VIBEOS_HOME, "savings-ledger.jsonl");
  GLOBAL_LEARNING_FILE = join6(VIBEOS_HOME, "global-learning.json");
  PRICING_CACHE_FILE = join6(VIBEOS_HOME, "model-pricing-cache.json");
  BLACKBOX_STATE_FILE = join6(VIBEOS_HOME, "blackbox-state.json");
  PROJECT_STATE_FILE = join6(VIBEOS_HOME, "project-states.json");
  TIERS_FILE = join6(VIBEOS_HOME, "model-tiers.json");
  ACTIVE_JOBS_FILE = join6(VIBEOS_HOME, "active-jobs.json");
  CREDIT_CACHE_F = join6(VIBEOS_HOME, "credit-snapshot.json");
  FLOW_TODO_QUEUE_FILE = join6(VIBEOS_HOME, ".flow-todo-queue.jsonl");
  FLOW_DEDUP_FILE = join6(VIBEOS_HOME, ".flow-dedup-keys.json");
  ENFORCEMENT_COOLDOWN_FILE = join6(VIBEOS_HOME, ".enforcement-cooldown.jsonl");
  TODOS_FILE = join6(VIBEOS_HOME, "todos.json");
  REPORTS_DIR = join6(VIBEOS_HOME, "reports");
  CONTEXT7_INSTALL_FLAG = join6(VIBEOS_HOME, ".context7-install-suggested");
  TRINITY_OPENCODE_CONFIG = join6(OPENCODE_HOME, "opencode.json");
  TRINITY_OPENCODE_CONFIGC = join6(OPENCODE_HOME, "opencode.jsonc");
  SCRATCHPAD_ROOT = join6(VIBEOS_HOME, "scratch");
  SCRATCHPAD_GLOBAL_DIR = join6(SCRATCHPAD_ROOT, "by-hash");
  SCRATCHPAD_SESSIONS_DIR = join6(SCRATCHPAD_ROOT, "sessions");
}
syncVibeOSPathBindings();
var DECADENCE_FRESH_MS2 = 5 * 60 * 1e3;
var DECADENCE_WARM_MS = 60 * 60 * 1e3;
var DECADENCE_COLD_MS2 = 24 * 60 * 60 * 1e3;
var DECADENCE_EXPIRE_MS2 = 48 * 60 * 60 * 1e3;
var DECADENCE_THROTTLE_MS2 = 60 * 1e3;
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
var _OC_SID = getOcSessionId();
var _sessionStart = Date.now();
var _cacheDb = createCacheDatabase();
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
function _pruneCorruptionBackups(backupDir) {
  try {
    if (!existsSync7(backupDir)) return;
    const now = Date.now();
    const backups = readdirSync2(backupDir).map((name) => {
      const path = join6(backupDir, name);
      try {
        const st = statSync3(path);
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
          rmSync2(backup.path, { force: true });
        } catch {
        }
      }
    }
  } catch {
  }
}
var ORPHAN_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1e3;
function _ensureVibeOSHomeDir() {
  try {
    if (!existsSync7(VIBEOS_HOME)) {
      mkdirSync4(VIBEOS_HOME, { recursive: true });
      return VIBEOS_HOME;
    }
    const st = statSync3(VIBEOS_HOME);
    if (!st.isDirectory()) {
      const backup = VIBEOS_HOME + ".backup." + Date.now();
      renameSync5(VIBEOS_HOME, backup);
      mkdirSync4(VIBEOS_HOME, { recursive: true });
    }
    return VIBEOS_HOME;
  } catch {
    return VIBEOS_HOME;
  }
}
function _handleStateCorruption(path) {
  _ensureVibeOSHomeDir();
  const backupDir = join6(VIBEOS_HOME, ".backups");
  try {
    mkdirSync4(backupDir, { recursive: true });
  } catch {
  }
  const backupPath = join6(backupDir, basename2(path) + ".corrupted." + Date.now());
  try {
    copyFileSync2(path, backupPath);
  } catch {
  }
  const logPath = join6(VIBEOS_HOME, ".state-corruption-log.jsonl");
  try {
    appendJsonlWithRotation(logPath, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), path, backup: backupPath }) + "\n", 500, 50);
  } catch {
  }
  _pruneCorruptionBackups(backupDir);
  return backupPath;
}
function _lockPathFor(filePath) {
  const hash = createHash3("sha1").update(String(filePath || "")).digest("hex");
  return join6(FILE_LOCK_DIR, `${hash}.lock`);
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
        writeFileSync5(fd, `${process.pid}
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
          rmSync2(lockPath, { force: true });
        } catch {
        }
      }
    } catch {
      try {
        if (existsSync7(lockPath)) {
          const age = Date.now() - statSync3(lockPath).mtimeMs;
          if (age > staleMs) {
            try {
              rmSync2(lockPath, { force: true });
            } catch {
            }
          }
        }
      } catch {
      }
      try {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      } catch {
      }
    }
  }
  throw new Error(`[vibeOS] lock not acquired for ${filePath} after ${timeoutMs}ms`);
}
var FALLBACK_HIGH = /opus|gemini-.*-pro|gpt-5|(^|\/)o[134]($|-|\/)|claude.*opus|reasoner|r1/i;
var FALLBACK_MID = /sonnet|gemini-.*-flash|gpt-4o(?!-mini)|haiku|flash|4o/i;
function _safeRegex(cfg, fallback, label) {
  if (!cfg) return fallback;
  try {
    return new RegExp(cfg, "i");
  } catch (e) {
    console.error(`[vibeOS] Invalid ${label}-tier regex in model-tiers.json: ${e.message}. Falling back.`);
    return fallback;
  }
}
function loadTierRegexes() {
  try {
    const p = join6(getVibeOSHome(), "model-tiers.json");
    if (!existsSync7(p)) return { high: FALLBACK_HIGH, mid: FALLBACK_MID };
    const j = safeJsonParse(readFileSync5(p, "utf-8"));
    const highRe = _safeRegex(j?.tiers?.high?.regex, FALLBACK_HIGH, "high");
    const midRe = _safeRegex(j?.tiers?.mid?.regex, FALLBACK_MID, "mid");
    return { high: highRe, mid: midRe };
  } catch {
    return { high: FALLBACK_HIGH, mid: FALLBACK_MID };
  }
}
var { high: HIGH_TIER_RE, mid: MID_TIER_RE } = loadTierRegexes();
function loadMLState() {
  try {
    const gl = loadGlobalLearning();
    if (gl.ml_cache_raw) _cacheDb = deserializeCacheDb(gl.ml_cache_raw);
    evictStaleEntries(_cacheDb, 86400 * 7);
  } catch {
  }
}
loadMLState();
function _readActiveJobsRaw() {
  try {
    if (!existsSync7(ACTIVE_JOBS_FILE)) return {};
    const raw = safeJsonParse(readFileSync5(ACTIVE_JOBS_FILE, "utf-8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    _handleStateCorruption(ACTIVE_JOBS_FILE);
    return {};
  }
}
function _writeActiveJobsRaw(jobs) {
  try {
    mkdirSync4(dirname3(ACTIVE_JOBS_FILE), { recursive: true });
    const tmp = ACTIVE_JOBS_FILE + ".tmp";
    writeFileSync5(tmp, JSON.stringify(jobs, null, 2) + "\n");
    renameSync5(tmp, ACTIVE_JOBS_FILE);
  } catch {
  }
}
function _normalizeActiveJobRecord(record, now = Date.now(), _strict = false) {
  if (!record || typeof record !== "object") return { record: null, changed: false, stale: false };
  const next = { ...record };
  let changed = false;
  const updatedAtRaw = typeof next.updatedAt === "string" ? next.updatedAt : "";
  const createdAtRaw = typeof next.createdAt === "string" ? next.createdAt : "";
  const updatedAtMs = Date.parse(updatedAtRaw);
  const createdAtMs = Date.parse(createdAtRaw);
  const anchorMs = Number.isFinite(updatedAtMs) ? updatedAtMs : createdAtMs;
  const stale = Number.isFinite(anchorMs) && now - anchorMs > ACTIVE_JOBS_STALE_MS;
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
function _isSessionBridgeRecord(record) {
  if (!record || typeof record !== "object") return false;
  const kind = String(record.kind || "").trim().toLowerCase();
  const status = String(record.status || "").trim().toLowerCase();
  const prompt = String(record.prompt || record.prompt_prefix || "").trim();
  return kind === "session-bridge" || status === "handoff" || prompt.startsWith("[session bridge]");
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
        if (norm.record && _isSessionBridgeRecord(norm.record)) {
          changed = true;
          continue;
        }
        if (!norm.record || norm.stale && norm.record.status === "completed" && norm.record.completedAt) {
          changed = true;
          continue;
        }
        next[key] = norm.record;
        if (norm.changed) changed = true;
      }
      if (changed) _writeActiveJobsRaw(next);
      return next;
    });
  } catch {
    _handleStateCorruption(ACTIVE_JOBS_FILE);
    return {};
  }
}
try {
  loadActiveJobs();
} catch {
}

// src/lib/runtime-config.ts
var VIBEOS_UNINSTALLED_MARKER = "vibeOS-uninstalled";
function vibeOSUninstalledMarkerPaths() {
  const override = process.env.VIBEOS_UNINSTALLED_MARKER_DIR?.trim();
  if (override) return [join7(override, VIBEOS_UNINSTALLED_MARKER)];
  const home = homedir5();
  return [
    join7(home, ".opencode", VIBEOS_UNINSTALLED_MARKER),
    join7(home, ".config", "opencode", VIBEOS_UNINSTALLED_MARKER)
  ];
}
function clearVibeOSUninstalledMarker() {
  for (const p of vibeOSUninstalledMarkerPaths()) {
    try {
      if (existsSync8(p)) rmSync3(p, { force: true });
    } catch {
    }
  }
}

// src/bin/setup.ts
var __dirname = dirname5(fileURLToPath(import.meta.url));
var root = resolve2(__dirname, "..");
var args = process.argv.slice(2);
var command = args.find((a) => !a.startsWith("-")) ?? "setup";
var isInstallCommand = command === "setup" || command === "set";
var isUninstallCommand = command === "uninstall" || command === "un";
var isProject = args.includes("--project");
var writeLine = (text = "") => {
  process.stdout.write(text + "\n");
};
if (isUninstallCommand) {
  const uninstallScript = resolve2(root, "scripts", "uninstall.mjs");
  if (!existsSync9(uninstallScript)) {
    console.error("Fatal: scripts/uninstall.mjs not found at", uninstallScript);
    process.exit(1);
  }
  try {
    execFileSync(process.execPath, [uninstallScript], { stdio: "inherit", cwd: process.cwd() });
  } catch (err) {
    console.error("Uninstall failed:", err?.message || err);
    process.exit(1);
  }
  process.exit(0);
}
if (!isInstallCommand || args.includes("--help") || args.includes("-h")) {
  console.error("Usage: npx vibeostheog set [--project]            # install/update plugin");
  console.error("       npx vibeostheog setup [--project]        # alias of set");
  console.error("       npx vibeostheog uninstall                 # clean removal: plugin + state + launch agent + cron + configs");
  console.error("       npx vibeostheog uninstall --quit-app      # also terminate the running OpenCode app");
  console.error("       npx vibeostheog un                       # alias of uninstall");
  process.exit(1);
}
clearVibeOSUninstalledMarker();
writeLine();
writeLine("vibeOS \u2014 cost-aware delegation enforcer for OpenCode");
writeLine();
writeLine("Installing to:");
for (const h of resolveOpenCodeHomes({ cwd: process.cwd() })) writeLine("  " + h);
writeLine();
var deployScript = resolve2(root, "scripts", "deploy.mjs");
if (!existsSync9(deployScript)) {
  console.error("Fatal: scripts/deploy.mjs not found at", deployScript);
  process.exit(1);
}
execFileSync(process.execPath, [deployScript], { stdio: "inherit", cwd: process.cwd() });
if (isProject) {
  const configPath = resolve2(process.cwd(), "opencode.json");
  let config = {};
  if (existsSync9(configPath)) {
    try {
      config = JSON.parse(readFileSync7(configPath, "utf8"));
    } catch {
      config = {};
    }
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) config = {};
  if (!config.$schema) config.$schema = "https://opencode.ai/config.json";
  if (!Array.isArray(config.plugin)) config.plugin = [];
  const installHome = resolveOpenCodeHome({ cwd: process.cwd() });
  const pluginRef = resolveVibeOSPluginRef(installHome);
  config.plugin = normalizeVibeOSPluginRefs(config.plugin, pluginRef);
  installVibeTierAgentsInConfig(config);
  mkdirSync6(dirname5(configPath), { recursive: true });
  const tmp = `${configPath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync7(tmp, JSON.stringify(config, null, 2) + "\n");
  renameSync7(tmp, configPath);
  writeLine(`vibeOS registered in ${configPath}`);
}
writeLine();
writeLine("Done. Restart OpenCode to activate the plugin.");
