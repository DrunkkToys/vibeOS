// @ts-nocheck
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, readdirSync, openSync, readSync, closeSync, rmSync, copyFileSync, renameSync } from "node:fs";
import { join, dirname, relative, basename } from "node:path";
import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { loadSelection, writeSelection, DFLT_SEL } from "./selection-manager.js";
// ── File system constants ────────────────────────────────────────────
const USER_HOME = (() => { try {
    return homedir();
}
catch {
    return tmpdir();
} })();
const FILE_LOCK_DIR = join(USER_HOME, ".claude/.vibeOS-locks");
const DELEGATION_STATE_FILE = join(USER_HOME, ".claude/delegation-state.json");
const SAVINGS_LEDGER_FILE = join(USER_HOME, ".claude/savings-ledger.jsonl");
const GLOBAL_LEARNING_FILE = join(USER_HOME, ".claude/global-learning.json");
const PRICING_CACHE_FILE = join(USER_HOME, ".claude/model-pricing-cache.json");
const BLACKBOX_STATE_FILE = join(USER_HOME, ".claude/blackbox-state.json");
const PROJECT_STATE_FILE = join(USER_HOME, ".claude/project-states.json");
const TIERS_FILE = join(USER_HOME, ".claude/model-tiers.json");
const ACTIVE_JOBS_FILE = join(USER_HOME, ".claude/active-jobs.json");
const AUTH_F = join(USER_HOME, ".local", "share", "opencode", "auth.json");
const CREDIT_CACHE_F = join(USER_HOME, ".claude/credit-snapshot.json");
const FLOW_TODO_QUEUE_FILE = join(USER_HOME, ".claude/.flow-todo-queue.jsonl");
const FLOW_DEDUP_FILE = join(USER_HOME, ".claude/.flow-dedup-keys.json");
const ENFORCEMENT_COOLDOWN_FILE = join(USER_HOME, ".claude/.enforcement-cooldown.jsonl");
const REPORTS_DIR = join(USER_HOME, ".claude/reports");
const CONTEXT7_INSTALL_FLAG = join(USER_HOME, ".claude/.context7-install-suggested");
const TRINITY_OPENCODE_CONFIG = join(USER_HOME, ".config/opencode/opencode.json");
const TRINITY_OPENCODE_CONFIGC = join(USER_HOME, ".config/opencode/opencode.jsonc");
// ── Scratchpad paths ─────────────────────────────────────────────────
const SCRATCHPAD_ROOT = join(USER_HOME, ".claude/scratch");
const SCRATCHPAD_GLOBAL_DIR = join(SCRATCHPAD_ROOT, "by-hash");
const SCRATCHPAD_SESSIONS_DIR = join(SCRATCHPAD_ROOT, "sessions");
const SCRATCHPAD_SESSION_TTL_MS = 48 * 60 * 60 * 1000;
const SCRATCHPAD_MAX_AGE_SEC = Number(process.env.CLAUDE_SCRATCHPAD_MAX_AGE_SEC || 86400);
const MAX_SCRATCHPAD_FILES = 1000;
const MAX_SCRATCHPAD_BYTES = 10 * 1024 * 1024;
const MAX_SESSION_SCRATCHPAD_FILES = 200;
const MAX_SESSION_SCRATCHPAD_BYTES = 2 * 1024 * 1024;
// ── Scratchpad decadence thresholds ──────────────────────────────────
const DECADENCE_FRESH_MS = 5 * 60 * 1000;
const DECADENCE_WARM_MS = 60 * 60 * 1000;
const DECADENCE_COLD_MS = 24 * 60 * 60 * 1000;
const DECADENCE_EXPIRE_MS = 48 * 60 * 60 * 1000;
const DECADENCE_THROTTLE_MS = 60 * 1000;
const DECADENCE_GLOBAL_THROTTLE_MS = 5 * 60 * 1000;
// ── Tool name normalization for scratchpad cache keys ─────────────────
const TOOL_NAME_NORMALIZE = {
    read: "Read", bash: "Bash", grep: "Grep", glob: "Glob",
    webfetch: "WebFetch", websearch: "WebSearch", list: "LS",
    "context7_query-docs": "Context7QueryDocs",
    "context7_resolve-library-id": "Context7ResolveLibrary",
    obsidian: "Obsidian",
};
const SCRATCHPAD_TOOLS = new Set(Object.keys(TOOL_NAME_NORMALIZE));
// ── Warning constants ────────────────────────────────────────────────
const WARN_DEDUPE_WINDOW_MS = 120 * 1000;
const WARN_MAX_PER_SESSION = 3;
const WARN_COALESCE_THRESHOLD = 10;
const MAX_LOG_LINES = 500;
// ── Soft quota ──────────────────────────────────────────────────────
const SOFT_QUOTA_LIMIT = 5;
// ── Session identity ─────────────────────────────────────────────────
const _OC_SID = "opencode-" + (process.pid || "x") + "-" + Date.now();
const _sessionStart = Date.now();
const _sessionTimer = function () { return Date.now() - _sessionStart; };
function getOcSessionId() { return _OC_SID; }
function getSessionTimer() { return Date.now() - _sessionStart; }
// ── Module-level state ───────────────────────────────────────────────
let currentTier = null;
let currentModel = null;
let currentProjectFingerprint = "";
let currentProjectName = "";
export function setCurrentTier(v) { currentTier = v; }
export function setCurrentModel(v) { currentModel = v; }
export function setCurrentProjectFingerprint(v) { currentProjectFingerprint = v; }
export function setCurrentProjectName(v) { currentProjectName = v; }
const textCompletePainted = new Set();
const softQuotaCounts = {};
// ── Warning/coalescing state ─────────────────────────────────────────
const warnLogThrottle = new Map();
const recentToolEvents = [];
const frictionSessionKeys = new Set();
const routineSessionKeys = new Set();
let lastMutationEvent = null;
export function setLastMutationEvent(v) { lastMutationEvent = v; }
const warnPerSession = new Map();
const warnCoalesceCounters = new Map();
// ── Savings cache (cross-process guard) ──────────────────────────────
let _savingsCache = null;
let _savingsCacheMtime = 0;
let _ledgerReconciledMtime = 0;
// ── ML Router state ──────────────────────────────────────────────────
import { createPatternGraph, deserializeGraph } from "../vibeOS-lib/ml-router.js";
import { createCacheDatabase, evictStaleEntries, deserializeCacheDb } from "../vibeOS-lib/smart-cache.js";
let _mlGraph = createPatternGraph();
let _cacheDb = createCacheDatabase();
const ML_ENABLED = true;
const ML_CONFIDENCE_THRESHOLD = 0.6;
let _mlSavePending = false;
export function setMlSavePending(v) { _mlSavePending = v; }
// ── Blackbox state ──────────────────────────────────────────────────
let _blackboxTracker = null;
let _blackboxEnabled = true;
let _latestBlackboxState = null;
let _latestBlackboxLoopMsg = null;
let _latestBlackboxPivotMsg = null;
let _modelLocked = false;
let _detectedFramework = null;
// ── Log rotation mtime guard ─────────────────────────────────────────
let _lastLogRotated = 0;
// ── Pattern learning state ──────────────────────────────────────────
const _patternFiredKeys = new Set();
// ── One-shot flags ──────────────────────────────────────────────────
let context7AlertedThisSession = false;
let _sessionCleanupRegistered = false;
let _sessionCacheCleaned = false;
let prunedThisProcess = false;
let _lastDecadenceRun = 0;
let _lastGlobalDecadenceRun = 0;
let enforcementBlocked = false;
let taskSlotRestore = null;
let pendingUiNote = null;
const briefedProjects = new Set();
// ── Ledger write buffer ─────────────────────────────────────────────
let _ledgerBuffer = [];
let _ledgerBufferTimer = null;
const LEDGER_BUFFER_MAX = 10;
const LEDGER_BUFFER_FLUSH_MS = 5000;
// ── Test reminder state ──────────────────────────────────────────────
const testReminderSeen = new Set();
// ── Default selection & global learning ──────────────────────────────
const DFLT_GL = { exploratory_words: {}, task_first_words: {}, updatedAt: null };
// ── Tool helper (minimal, avoids @opencode-ai/plugin dependency) ──────
function _zType(base) {
    return Object.assign((...a) => _zType({ ...base, args: a }), {
        optional: () => _zType({ ...base, optional: true }),
        _isZod: true, _base: base,
    });
}
const tool = Object.assign((def) => def, {
    schema: {
        string: (o) => _zType({ kind: "string", ...(o || {}) }),
        number: (o) => _zType({ kind: "number", ...(o || {}) }),
        enum: (values) => _zType({ kind: "enum", values }),
    }
});
// ── State corruption handler ─────────────────────────────────────────
function _handleStateCorruption(path) {
    const backupDir = join(USER_HOME, ".claude", ".backups");
    mkdirSync(backupDir, { recursive: true });
    const backupPath = join(backupDir, basename(path) + ".corrupted." + Date.now());
    try {
        copyFileSync(path, backupPath);
    }
    catch { }
    const logPath = join(USER_HOME, ".claude", ".state-corruption-log.jsonl");
    try {
        appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), path, backup: backupPath }) + "\n");
    }
    catch { }
}
// ── File locking ─────────────────────────────────────────────────────
function _lockPathFor(filePath) {
    const hash = createHash("sha1").update(String(filePath || "")).digest("hex");
    return join(FILE_LOCK_DIR, `${hash}.lock`);
}
function withFileLock(filePath, fn, opts = {}) {
    const staleMs = Number(opts.staleMs || 30_000);
    const timeoutMs = Number(opts.timeoutMs || 2_000);
    const lockPath = _lockPathFor(filePath);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            mkdirSync(FILE_LOCK_DIR, { recursive: true });
            const fd = openSync(lockPath, "wx");
            try {
                writeFileSync(fd, `${process.pid}\n${Date.now()}\n`);
            }
            catch { }
            try {
                return fn();
            }
            finally {
                try {
                    closeSync(fd);
                }
                catch { }
                try {
                    rmSync(lockPath, { force: true });
                }
                catch { }
            }
        }
        catch (err) {
            try {
                if (existsSync(lockPath)) {
                    const age = Date.now() - statSync(lockPath).mtimeMs;
                    if (age > staleMs) {
                        try {
                            rmSync(lockPath, { force: true });
                        }
                        catch { }
                    }
                }
            }
            catch { }
        }
    }
    throw new Error(`[vibeOS] lock not acquired for ${filePath} after ${timeoutMs}ms`);
}
// ── JSONC-tolerant JSON.parse ────────────────────────────────────────
function safeJsonParse(raw) {
    if (raw == null || raw === '')
        return null;
    try {
        return JSON.parse(raw);
    }
    catch { }
    let cleaned = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/,\s*([}\]])/g, '$1');
    try {
        return JSON.parse(cleaned);
    }
    catch (e) {
        throw e;
    }
}
// ── State validation ─────────────────────────────────────────────────
function validateState(state, path) {
    if (!state || typeof state !== 'object') {
        console.error(`[vibeOS] State validation failed: not an object at ${path}`);
        return;
    }
    if (state.session_started_at && isNaN(Date.parse(state.session_started_at))) {
        console.error(`[vibeOS] State validation warning: invalid session_started_at at ${path}, resetting`);
        state.session_started_at = new Date().toISOString();
    }
    if (state.sessions && Array.isArray(state.sessions)) {
        console.error(`[vibeOS] State validation: converting legacy sessions array to object at ${path}`);
        state.sessions = {};
    }
    else if (state.sessions && !Array.isArray(state.sessions) && (typeof state.sessions !== "object" || state.sessions === null)) {
        console.error(`[vibeOS] State validation warning: sessions is invalid type at ${path}, resetting`);
        state.sessions = {};
    }
    if (state.lifetime && typeof state.lifetime !== 'object') {
        console.error(`[vibeOS] State validation warning: lifetime is not object at ${path}, resetting`);
        state.lifetime = {};
    }
}
// ── JSON file readers / writers ─────────────────────────────────────
function readJsonOrEmpty(filePath) {
    try {
        if (!existsSync(filePath))
            return {};
        const st = statSync(filePath);
        if (st.size > 10485760) {
            _handleStateCorruption(filePath);
            return {};
        }
        return safeJsonParse(readFileSync(filePath, "utf-8"));
    }
    catch {
        _handleStateCorruption(filePath);
        return {};
    }
}
function updateState(mutator) {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const result = withFileLock(DELEGATION_STATE_FILE, () => {
                const preGen = (readJsonOrEmpty(DELEGATION_STATE_FILE)._gen || 0);
                let state = readJsonOrEmpty(DELEGATION_STATE_FILE);
                if (!state || typeof state !== "object")
                    state = {};
                if (!state.session_started_at || state.session_started_at === "not-a-valid-date" || isNaN(Date.parse(state.session_started_at))) {
                    state.session_started_at = new Date().toISOString();
                }
                state.lifetime ??= {};
                state.lifetime.missed_context7_usd ??= 0;
                state.lifetime.cache_savings_usd ??= 0;
                state._ledgerFormatVersion ??= 2;
                state._gen = preGen + 1;
                const next = mutator(state) ?? state;
                validateState(next, DELEGATION_STATE_FILE);
                mkdirSync(dirname(DELEGATION_STATE_FILE), { recursive: true });
                const tmp = DELEGATION_STATE_FILE + ".tmp";
                writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
                renameSync(tmp, DELEGATION_STATE_FILE);
                return next;
            });
            return result;
        }
        catch (err) {
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
        if (!existsSync(DELEGATION_STATE_FILE))
            return {};
        const st = statSync(DELEGATION_STATE_FILE);
        if (st.size > 10485760) {
            _handleStateCorruption(DELEGATION_STATE_FILE);
            return {};
        }
        return safeJsonParse(readFileSync(DELEGATION_STATE_FILE, "utf-8"));
    }
    catch {
        _handleStateCorruption(DELEGATION_STATE_FILE);
        return {};
    }
}
function writeFullState(state) {
    try {
        withFileLock(DELEGATION_STATE_FILE, () => {
            validateState(state, DELEGATION_STATE_FILE);
            mkdirSync(dirname(DELEGATION_STATE_FILE), { recursive: true });
            const tmp = DELEGATION_STATE_FILE + ".tmp";
            writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
            renameSync(tmp, DELEGATION_STATE_FILE);
        });
    }
    catch (err) {
        console.error(`[vibeOS] writeFullState failed: ${err.message}`);
    }
}
// ── Round to 4 decimal places ────────────────────────────────────────
function roundUsd(v) {
    return Math.round((Number(v) || 0) * 10000) / 10000;
}
// ── Tier regexes ─────────────────────────────────────────────────────
const FALLBACK_HIGH = /opus|gemini-.*-pro|deepseek\/deepseek-v4-pro|gpt-5|(^|\/)o[134]($|-|\/)/i;
const FALLBACK_MID = /deepseek\/deepseek-v4-flash|claude.*sonnet|gemini-.*-flash|gpt-4o(?!-mini)/i;
function _safeRegex(cfg, fallback, label) {
    if (!cfg)
        return fallback;
    try {
        return new RegExp(cfg, "i");
    }
    catch (e) {
        console.error(`[vibeOS] Invalid ${label}-tier regex in model-tiers.json: ${e.message}. Falling back.`);
        return fallback;
    }
}
function loadTierRegexes() {
    try {
        const p = join(USER_HOME, ".claude/model-tiers.json");
        if (!existsSync(p))
            return { high: FALLBACK_HIGH, mid: FALLBACK_MID };
        const j = safeJsonParse(readFileSync(p, "utf-8"));
        const highRe = _safeRegex(j?.tiers?.high?.regex, FALLBACK_HIGH, "high");
        const midRe = _safeRegex(j?.tiers?.mid?.regex, FALLBACK_MID, "mid");
        return { high: highRe, mid: midRe };
    }
    catch {
        return { high: FALLBACK_HIGH, mid: FALLBACK_MID };
    }
}
const { high: HIGH_TIER_RE, mid: MID_TIER_RE } = loadTierRegexes();
// ── Selection management (model-tiers.json) ──────────────────────────
// loadSelection, writeSelection, and DFLT_SEL are imported from selection-manager.js
// ── Global learning ──────────────────────────────────────────────────
function loadGlobalLearning() {
    try {
        if (!existsSync(GLOBAL_LEARNING_FILE))
            return DFLT_GL;
        const st = statSync(GLOBAL_LEARNING_FILE);
        if (st.size > 10485760) {
            _handleStateCorruption(GLOBAL_LEARNING_FILE);
            return DFLT_GL;
        }
        const j = safeJsonParse(readFileSync(GLOBAL_LEARNING_FILE, "utf-8"));
        if (!j || typeof j !== "object")
            return DFLT_GL;
        j.exploratory_words ??= {};
        j.task_first_words ??= {};
        return j;
    }
    catch {
        _handleStateCorruption(GLOBAL_LEARNING_FILE);
        return DFLT_GL;
    }
}
function updateGlobalLearning(mutator) {
    return withFileLock(GLOBAL_LEARNING_FILE, () => {
        const s = loadGlobalLearning();
        const next = mutator(s) ?? s;
        next.updatedAt = new Date().toISOString();
        mkdirSync(dirname(GLOBAL_LEARNING_FILE), { recursive: true });
        const tmp = GLOBAL_LEARNING_FILE + ".tmp";
        writeFileSync(tmp, JSON.stringify(next, null, 2));
        renameSync(tmp, GLOBAL_LEARNING_FILE);
        return next;
    });
}
function getLearnedExploratoryWords() {
    const out = new Set();
    try {
        const gl = loadGlobalLearning();
        for (const [w, meta] of Object.entries(gl.exploratory_words || {})) {
            if (meta?.count >= 1)
                out.add(String(w));
        }
    }
    catch { }
    return out;
}
// ── ML Router state ──────────────────────────────────────────────────
function loadMLState() {
    try {
        const gl = loadGlobalLearning();
        if (gl.ml_graph_raw)
            _mlGraph = deserializeGraph(gl.ml_graph_raw);
        if (gl.ml_cache_raw)
            _cacheDb = deserializeCacheDb(gl.ml_cache_raw);
        evictStaleEntries(_cacheDb, 86400 * 7);
    }
    catch { }
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
    }
    catch {
        return false;
    }
}
loadMLState();
// ── Blackbox state management ───────────────────────────────────────
function loadBlackboxState() {
    try {
        if (!existsSync(BLACKBOX_STATE_FILE))
            return { enabled: true, sessions: {} };
        const st = statSync(BLACKBOX_STATE_FILE);
        if (st.size > 10485760) {
            _handleStateCorruption(BLACKBOX_STATE_FILE);
            return { enabled: false, sessions: {} };
        }
        return safeJsonParse(readFileSync(BLACKBOX_STATE_FILE, "utf-8")) || { enabled: false, sessions: {} };
    }
    catch {
        _handleStateCorruption(BLACKBOX_STATE_FILE);
        return { enabled: false, sessions: {} };
    }
}
function saveBlackboxState(state) {
    try {
        mkdirSync(dirname(BLACKBOX_STATE_FILE), { recursive: true });
        const tmp = BLACKBOX_STATE_FILE + ".tmp";
        writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
        renameSync(tmp, BLACKBOX_STATE_FILE);
    }
    catch (err) {
        console.error(`[vibeOS] saveBlackboxState failed: ${err.message}`);
    }
}
function getBlackboxTracker() {
    return _blackboxTracker;
}
function getBlackboxResolution() {
    return _blackboxTracker?.resolution || null;
}
// ── Session scratchpad helpers ──────────────────────────────────────
function getSessionRoot() { return join(SCRATCHPAD_SESSIONS_DIR, _OC_SID); }
function getSessionScratchpadDir() { return join(getSessionRoot(), "by-hash"); }
function getSessionIndexPath() { return join(getSessionRoot(), "index.jsonl"); }
function getGlobalIndexPath() { return join(SCRATCHPAD_ROOT, "index.jsonl"); }
function ensureSessionScratchpadDirs() {
    try {
        mkdirSync(getSessionScratchpadDir(), { recursive: true });
        return true;
    }
    catch {
        return false;
    }
}
function safeCopyIntoSession(hash, fromPath) {
    try {
        if (!ensureSessionScratchpadDirs())
            return;
        const sessionPath = join(getSessionScratchpadDir(), `${hash}.txt`);
        if (!existsSync(sessionPath)) {
            copyFileSync(fromPath, sessionPath);
            const globalSummary = join(SCRATCHPAD_GLOBAL_DIR, `${hash}.summary.txt`);
            const sessionSummary = join(getSessionScratchpadDir(), `${hash}.summary.txt`);
            if (existsSync(globalSummary) && !existsSync(sessionSummary)) {
                copyFileSync(globalSummary, sessionSummary);
            }
        }
    }
    catch { }
}
function cleanupCurrentSessionScratchpad() {
    if (_sessionCacheCleaned)
        return;
    _sessionCacheCleaned = true;
    try {
        rmSync(getSessionRoot(), { recursive: true, force: true });
    }
    catch { }
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
    process.on("exit", () => { _flushLedgerBuffer(); cleanupCurrentSessionScratchpad(); });
    process.on("SIGINT", () => {
        cleanupCurrentSessionScratchpad();
        process.exit(130);
    });
}
// ── Ledger buffer ────────────────────────────────────────────────────
function _flushLedgerBuffer() {
    if (_ledgerBufferTimer) {
        clearTimeout(_ledgerBufferTimer);
        _ledgerBufferTimer = null;
    }
    if (_ledgerBuffer.length === 0)
        return;
    const batch = _ledgerBuffer.splice(0);
    const lines = batch.map(e => typeof e === "string" ? e.trimEnd() : String(e).trimEnd());
    const joined = lines.filter(Boolean).map(l => l + "\n").join("");
    try {
        appendFileSync(SAVINGS_LEDGER_FILE, joined);
    }
    catch { }
}
function recordSavingsLedgerEntry(entry) {
    try {
        _ledgerBuffer.push(JSON.stringify(entry) + "\n");
        if (_ledgerBuffer.length >= LEDGER_BUFFER_MAX)
            _flushLedgerBuffer();
        else if (!_ledgerBufferTimer)
            _ledgerBufferTimer = setTimeout(_flushLedgerBuffer, LEDGER_BUFFER_FLUSH_MS);
    }
    catch { }
}
function loadSavingsLedger(limit = 1000) {
    try {
        if (!existsSync(SAVINGS_LEDGER_FILE))
            return [];
        const raw = readFileSync(SAVINGS_LEDGER_FILE, "utf-8");
        if (!raw.trim())
            return [];
        const lines = raw.split("\n").filter(Boolean);
        const recent = limit ? lines.slice(-limit) : lines;
        const entries = [];
        for (const line of recent) {
            try {
                const rec = JSON.parse(line);
                if (rec && typeof rec === "object")
                    entries.push(rec);
            }
            catch {
                const matches = line.match(/\{[^{}]*\{[^}]*}[^{}]*\}|\{[^}]+\}/g);
                if (matches) {
                    for (const m of matches) {
                        try {
                            const rec = JSON.parse(m);
                            if (rec && typeof rec === "object")
                                entries.push(rec);
                        }
                        catch { }
                    }
                }
            }
        }
        return entries;
    }
    catch {
        return [];
    }
}
// ── Stable JSON serialization (sorted keys, matches CC shasum) ──────
function stableJson(obj) {
    if (obj === null || typeof obj !== "object")
        return JSON.stringify(obj);
    if (Array.isArray(obj))
        return "[" + obj.map(stableJson).join(",") + "]";
    return "{" + Object.keys(obj).sort()
        .map(k => JSON.stringify(k) + ":" + stableJson(obj[k]))
        .join(",") + "}";
}
function _readHead(fullPath) {
    try {
        const buf = Buffer.alloc(120);
        const fd = openSync(fullPath, "r");
        const { bytesRead } = readSync(fd, buf, 0, 120, 0);
        closeSync(fd);
        return buf.toString("utf-8", 0, bytesRead);
    }
    catch {
        return "";
    }
}
function indexAppend(hash, tool, size, extra) {
    try {
        const entryObj = {
            ts: new Date().toISOString(),
            hash, tool, size,
            pid: process.pid || 0,
            session: _OC_SID,
            source: "opencode",
            ...extra,
        };
        const entry = JSON.stringify(entryObj) + "\n";
        const globalIndex = getGlobalIndexPath();
        const sessionIndex = getSessionIndexPath();
        mkdirSync(dirname(globalIndex), { recursive: true });
        mkdirSync(dirname(sessionIndex), { recursive: true });
        appendFileSync(globalIndex, entry);
        appendFileSync(sessionIndex, entry);
    }
    catch (err) {
        console.error(`[vibeOS] index write failed: ${err.message}`);
    }
}
// ── Scratchpad hit detection ─────────────────────────────────────────
const scratchpadHitsSeen = new Set();
function scanRecentScratchpad(dir, titleCase, maxScan = 2000) {
    try {
        if (!existsSync(dir))
            return null;
        const entries = readdirSync(dir);
        const txtFiles = entries.filter(e => e.endsWith(".txt") && !e.endsWith(".summary.txt"));
        if (txtFiles.length === 0)
            return null;
        const candidateHashes = [];
        for (let i = txtFiles.length - 1; i >= 0; i--) {
            const f = txtFiles[i];
            const head = _readHead(join(dir, f));
            if (head && head.includes(`[ctx-compressed-v1]`)) {
                candidateHashes.push(f.replace(/\.txt$/, ""));
            }
            if (candidateHashes.length > 50)
                break;
        }
        for (const hash of candidateHashes) {
            const f = join(dir, `${hash}.txt`);
            if (!existsSync(f))
                continue;
            const st = statSync(f);
            const ageSec = (Date.now() - st.mtimeMs) / 1000;
            if (ageSec > SCRATCHPAD_MAX_AGE_SEC)
                continue;
            const sumPath = join(dir, `${hash}.summary.txt`);
            return { hash, fullPath: f, sizeBytes: st.size, ageSec: Math.round(ageSec), summaryPath: existsSync(sumPath) ? sumPath : null };
        }
        return null;
    }
    catch {
        return null;
    }
}
function getScratchpadHit(toolLower, args, baseDir = null) {
    if (!SCRATCHPAD_TOOLS.has(toolLower))
        return null;
    const titleCase = TOOL_NAME_NORMALIZE[toolLower];
    const inputJson = stableJson(args ?? {});
    const hash = createHash("sha256").update(`${titleCase}\n${inputJson}\n`).digest("hex").slice(0, 16);
    const sessionDir = baseDir || getSessionScratchpadDir();
    const globalDir = SCRATCHPAD_GLOBAL_DIR;
    const sessionPath = join(sessionDir, `${hash}.txt`);
    const globalPath = join(globalDir, `${hash}.txt`);
    let fullPath = existsSync(sessionPath) ? sessionPath : (existsSync(globalPath) ? globalPath : null);
    if (!fullPath) {
        const recent = scanRecentScratchpad(sessionDir, titleCase, 2000) || scanRecentScratchpad(globalDir, titleCase, 2000);
        if (recent)
            return recent;
        return null;
    }
    try {
        const st = statSync(fullPath);
        const ageSec = (Date.now() - st.mtimeMs) / 1000;
        if (ageSec > SCRATCHPAD_MAX_AGE_SEC)
            return null;
        if (fullPath === globalPath)
            safeCopyIntoSession(hash, globalPath);
        const sessionSummaryPath = join(sessionDir, `${hash}.summary.txt`);
        const globalSummaryPath = join(globalDir, `${hash}.summary.txt`);
        const summaryPath = existsSync(sessionSummaryPath) ? sessionSummaryPath : globalSummaryPath;
        return {
            hash, fullPath, sizeBytes: st.size, ageSec: Math.round(ageSec),
            summaryPath: existsSync(summaryPath) ? summaryPath : null,
        };
    }
    catch {
        return null;
    }
}
function recordScratchpadObservation(toolLower, args, fileSize, meta = {}) {
    if (!SCRATCHPAD_TOOLS.has(toolLower))
        return;
    try {
        const titleCase = TOOL_NAME_NORMALIZE[toolLower];
        const inputJson = stableJson(args ?? {});
        const hash = createHash("sha256").update(`${titleCase}\n${inputJson}\n`).digest("hex").slice(0, 16);
        const dedupeKey = `${toolLower}:${hash}`;
        if (scratchpadHitsSeen.has(dedupeKey))
            return;
        scratchpadHitsSeen.add(dedupeKey);
        indexAppend(hash, toolLower, fileSize, { ...meta, input: inputJson.slice(0, 200) });
    }
    catch { }
}
// ── Scratchpad decadence pruning ──────────────────────────────────────────
function _pruneScratchpadDir(targetDir, opts = {}) {
    const { maxFiles = MAX_SCRATCHPAD_FILES, maxBytes = MAX_SCRATCHPAD_BYTES, rotate = true } = opts;
    const now = Date.now();
    if (!existsSync(targetDir))
        return { dataFiles: 0, totalBytes: 0, deleted: 0, rotated: 0 };
    const entries = readdirSync(targetDir);
    let dataFiles = 0;
    let totalBytes = 0;
    let deleted = 0;
    let rotated = 0;
    for (const entry of entries) {
        if (entry.endsWith(".meta.json") || entry.endsWith(".summary.txt"))
            continue;
        const fullPath = join(targetDir, entry);
        let st;
        try {
            st = statSync(fullPath);
        }
        catch {
            continue;
        }
        const age = now - st.mtimeMs;
        const hash = entry.replace(/\.txt$/, "");
        if (age > DECADENCE_EXPIRE_MS) {
            try {
                rmSync(fullPath);
            }
            catch { }
            const meta = join(targetDir, hash + ".meta.json");
            if (existsSync(meta))
                try {
                    rmSync(meta);
                }
                catch { }
            const summary = join(targetDir, hash + ".summary.txt");
            if (existsSync(summary))
                try {
                    rmSync(summary);
                }
                catch { }
            deleted++;
            continue;
        }
        dataFiles++;
        totalBytes += st.size;
        if (!rotate)
            continue;
        if (age > DECADENCE_COLD_MS) {
            const summaryPath = join(targetDir, hash + ".summary.txt");
            if (!existsSync(summaryPath))
                try {
                    const content = readFileSync(fullPath, "utf-8");
                    writeFileSync(summaryPath, content.slice(0, 200).replace(/\n+/g, " ").trim() + (content.length > 200 ? "…" : ""));
                }
                catch { }
            const head = _readHead(fullPath);
            if (!head.includes("[cold-storage]"))
                try {
                    writeFileSync(fullPath, `[cold-storage] ${st.size}B original → ${hash}.summary.txt`);
                    rotated++;
                }
                catch { }
            continue;
        }
        if (age > DECADENCE_FRESH_MS && st.size > 1024) {
            const summaryPath = join(targetDir, hash + ".summary.txt");
            if (!existsSync(summaryPath))
                try {
                    const content = readFileSync(fullPath, "utf-8");
                    writeFileSync(summaryPath, content.slice(0, 500).replace(/\n+/g, " ").trim() + (content.length > 500 ? "…" : ""));
                }
                catch { }
            const head = _readHead(fullPath);
            if (!head.includes("[warm-storage]") && !head.includes("[cold-storage]"))
                try {
                    writeFileSync(fullPath, `[warm-storage] ${st.size}B original at ${hash}.summary.txt`);
                    rotated++;
                }
                catch { }
        }
    }
    return { dataFiles, totalBytes, deleted, rotated };
}
function runDecadenceCycle() {
    const now = Date.now();
    if (now - _lastDecadenceRun < DECADENCE_THROTTLE_MS)
        return;
    _lastDecadenceRun = now;
    try {
        const sessionDir = getSessionScratchpadDir();
        _pruneScratchpadDir(sessionDir, { maxFiles: MAX_SESSION_SCRATCHPAD_FILES, maxBytes: MAX_SESSION_SCRATCHPAD_BYTES, rotate: true });
    }
    catch { }
    if (now - _lastGlobalDecadenceRun >= DECADENCE_GLOBAL_THROTTLE_MS) {
        _lastGlobalDecadenceRun = now;
        try {
            _pruneScratchpadDir(SCRATCHPAD_GLOBAL_DIR, { maxFiles: MAX_SCRATCHPAD_FILES, maxBytes: MAX_SCRATCHPAD_BYTES, rotate: true });
        }
        catch { }
    }
}
function applyDecadence() {
    const now = Date.now();
    if (now - _lastDecadenceRun >= DECADENCE_THROTTLE_MS) {
        _lastDecadenceRun = now;
        try {
            const ses = _pruneScratchpadDir(getSessionScratchpadDir(), {
                maxFiles: MAX_SESSION_SCRATCHPAD_FILES,
                maxBytes: MAX_SESSION_SCRATCHPAD_BYTES,
                rotate: false,
            });
            if (ses.deleted > 0) {
                console.error(`[vibeOS] session-decadence: deleted=${ses.deleted} (${ses.dataFiles} files, ${Math.round(ses.totalBytes / 1024)}KB)`);
            }
        }
        catch (err) {
            console.error(`[vibeOS] session decadence error: ${err.message}`);
        }
    }
    if (now - _lastGlobalDecadenceRun >= DECADENCE_GLOBAL_THROTTLE_MS) {
        _lastGlobalDecadenceRun = now;
        try {
            const global = _pruneScratchpadDir(SCRATCHPAD_GLOBAL_DIR, {
                maxFiles: MAX_SCRATCHPAD_FILES,
                maxBytes: MAX_SCRATCHPAD_BYTES,
                rotate: true,
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
        }
        catch (err) {
            console.error(`[vibeOS] global decadence error: ${err.message}`);
        }
    }
}
// ── Cleanup stale session scratchpads ──────────────────────────────────────
function cleanupStaleSessionScratchpads() {
    try {
        if (!existsSync(SCRATCHPAD_SESSIONS_DIR))
            return;
        const dirs = readdirSync(SCRATCHPAD_SESSIONS_DIR);
        const now = Date.now();
        for (const d of dirs) {
            const full = join(SCRATCHPAD_SESSIONS_DIR, d);
            try {
                const st = statSync(full);
                if (now - st.mtimeMs > SCRATCHPAD_SESSION_TTL_MS) {
                    rmSync(full, { recursive: true, force: true });
                }
            }
            catch { }
        }
    }
    catch { }
}
// ── Plugin scratchpad prune ───────────────────────────────────────────────
function pruneScratchpadOnce() {
    if (prunedThisProcess)
        return;
    prunedThisProcess = true;
    try {
        const script = join(USER_HOME, ".claude/hooks/scratchpad-prune.sh");
        if (existsSync(script)) {
            const child = spawn("bash", [script], { detached: true, stdio: "ignore" });
            child.unref();
        }
    }
    catch { /* prune is best-effort */ }
    // Inline size cap: use decadence thresholds, remove oldest 30%
    try {
        const dir = SCRATCHPAD_GLOBAL_DIR;
        if (!existsSync(dir))
            return;
        const entries = readdirSync(dir);
        const txtFiles = entries.filter((e) => e.endsWith(".txt") && !e.endsWith(".meta.json") && !e.endsWith(".summary.txt")).map((e) => join(dir, e));
        if (txtFiles.length <= MAX_SCRATCHPAD_FILES)
            return;
        const totalSize = txtFiles.reduce((a, f) => a + (statSync(f).size || 0), 0);
        if (totalSize < MAX_SCRATCHPAD_BYTES)
            return;
        txtFiles.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
        const remove = Math.ceil(txtFiles.length * 0.3);
        for (let i = 0; i < remove; i++) {
            try {
                rmSync(txtFiles[i]);
            }
            catch { }
            const meta = txtFiles[i].replace(".txt", ".meta.json");
            if (existsSync(meta))
                try {
                    rmSync(meta);
                }
                catch { }
        }
    }
    catch { }
}
// ── Active jobs ──────────────────────────────────────────────────────
function loadActiveJobs() {
    try {
        if (!existsSync(ACTIVE_JOBS_FILE))
            return {};
        const st = statSync(ACTIVE_JOBS_FILE);
        if (st.size > 10485760) {
            _handleStateCorruption(ACTIVE_JOBS_FILE);
            return {};
        }
        const raw = safeJsonParse(readFileSync(ACTIVE_JOBS_FILE, "utf-8"));
        if (!raw || typeof raw !== "object")
            return {};
        return raw;
    }
    catch {
        _handleStateCorruption(ACTIVE_JOBS_FILE);
        return {};
    }
}
function getActiveJobForProject(fp = currentProjectFingerprint) {
    if (!fp)
        return null;
    const jobs = loadActiveJobs();
    const job = jobs[fp];
    if (!job || typeof job !== "object")
        return null;
    return job;
}
function saveActiveJobForProject(job, fp = currentProjectFingerprint) {
    if (!fp || !job || typeof job !== "object")
        return;
    try {
        const jobs = loadActiveJobs();
        jobs[fp] = job;
        mkdirSync(dirname(ACTIVE_JOBS_FILE), { recursive: true });
        const tmp = ACTIVE_JOBS_FILE + ".tmp";
        writeFileSync(tmp, JSON.stringify(jobs, null, 2));
        renameSync(tmp, ACTIVE_JOBS_FILE);
    }
    catch { }
}
function saveJobRecord(jobId, record) {
    try {
        const jobs = loadActiveJobs();
        jobs[jobId] = record;
        mkdirSync(dirname(ACTIVE_JOBS_FILE), { recursive: true });
        const tmp = ACTIVE_JOBS_FILE + ".tmp";
        writeFileSync(tmp, JSON.stringify(jobs, null, 2));
        renameSync(tmp, ACTIVE_JOBS_FILE);
    }
    catch { }
}
function loadJobRecord(jobId) {
    try {
        const jobs = loadActiveJobs();
        return jobs[jobId] || null;
    }
    catch {
        return null;
    }
}
// ── Project memory ───────────────────────────────────────────────────
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
    }
    catch { }
    return { project_hashes: {} };
}
function saveProjectState(state) {
    try {
        withFileLock(PROJECT_STATE_FILE, () => {
            mkdirSync(dirname(PROJECT_STATE_FILE), { recursive: true });
            const _tmp = PROJECT_STATE_FILE + ".tmp." + Date.now();
            writeFileSync(_tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
            renameSync(_tmp, PROJECT_STATE_FILE);
        });
    }
    catch (err) {
        console.error(`[vibeOS] project state write failed: ${err.message}`);
    }
}
function ensureProjectBucket(state, fp) {
    state.project_hashes ??= {};
    if (!state.project_hashes[fp]) {
        state.project_hashes[fp] = {
            totalSessions: 0,
            researchChains: 0,
            context7Bypasses: 0,
            commonTopics: [],
            techStack: detectTechStack(process.cwd()),
        };
    }
    return state.project_hashes[fp];
}
function mergeProjectBucket(dst, src) {
    const a = dst || {};
    const b = src || {};
    const topics = [...new Set([...(a.commonTopics || []), ...(b.commonTopics || [])])].slice(-20);
    const mergePatterns = (kind) => {
        const out = {};
        for (const srcObj of [a.userPatterns?.[kind], b.userPatterns?.[kind]]) {
            for (const [key, val] of Object.entries(srcObj || {})) {
                const v = val;
                const row = out[key] || { count: 0, sessions: [], lastSeen: null, summary: v?.summary || "" };
                row.count += Number(v?.count || 0);
                row.sessions = [...new Set([...(row.sessions || []), ...(v?.sessions || [])])].slice(-10);
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
            routines: mergePatterns("routines"),
        },
        lastSeen: [a.lastSeen, b.lastSeen].filter(Boolean).sort().slice(-1)[0] || new Date().toISOString(),
    };
}
// ── Tech stack detection ─────────────────────────────────────────────
function detectTechStack(dir) {
    const stacks = [];
    try {
        const pkg = safeJsonParse(readFileSync(join(dir, "package.json"), "utf-8"));
        if (pkg) {
            if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript || existsSync(join(dir, "tsconfig.json")))
                stacks.push("typescript");
            if (pkg.dependencies?.react || pkg.devDependencies?.react)
                stacks.push("react");
            stacks.push("javascript");
        }
    }
    catch { }
    try {
        if (existsSync(join(dir, "Cargo.toml")))
            stacks.push("rust");
    }
    catch { }
    try {
        if (existsSync(join(dir, "go.mod")))
            stacks.push("go");
    }
    catch { }
    try {
        if (existsSync(join(dir, "requirements.txt")))
            stacks.push("python");
        if (existsSync(join(dir, "setup.py")))
            stacks.push("python");
        if (existsSync(join(dir, "pyproject.toml")))
            stacks.push("python");
    }
    catch { }
    return [...new Set(stacks)];
}
// ── Path normalization / command helpers ─────────────────────────────
function normalizeObservedPath(filePath, directory) {
    if (!filePath || typeof filePath !== "string")
        return "unknown";
    let p = filePath;
    try {
        if (directory && p.startsWith("/")) {
            const rel = relative(directory, p);
            if (rel && !rel.startsWith("..") && !rel.startsWith("/"))
                p = rel;
        }
    }
    catch { }
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
// ── Pattern learning ─────────────────────────────────────────────────
function promotedProjectPatterns(fp) {
    try {
        const p = loadProjectState().project_hashes?.[fp];
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
    }
    catch {
        return [];
    }
}
function projectPatternRows(fp) {
    try {
        const p = loadProjectState().project_hashes?.[fp];
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
                    lastSeen: r?.lastSeen || "",
                });
            }
        }
        rows.sort((a, b) => b.sessions - a.sessions || b.count - a.count || String(b.lastSeen).localeCompare(String(a.lastSeen)));
        return rows;
    }
    catch {
        return [];
    }
}
function clearProjectPatterns(fp) {
    try {
        const pstate = loadProjectState();
        const bucket = pstate.project_hashes?.[fp];
        if (!bucket?.userPatterns)
            return 0;
        const count = Object.keys(bucket.userPatterns.friction || {}).length + Object.keys(bucket.userPatterns.routines || {}).length;
        bucket.userPatterns = { friction: {}, routines: {} };
        bucket.lastSeen = new Date().toISOString();
        saveProjectState(pstate);
        return count;
    }
    catch (err) {
        console.error(`[vibeOS] pattern learner clear failed: ${err.message}`);
        return 0;
    }
}
// ── Log rotation helpers ──────────────────────────────────────────────
function _rotateLog(filePath, maxLines) {
    try {
        if (!existsSync(filePath))
            return;
        const mtime = statSync(filePath).mtimeMs;
        if (mtime === _lastLogRotated)
            return;
        const data = readFileSync(filePath, "utf-8");
        const lines = data.split("\n");
        if (lines.length <= maxLines)
            return;
        const kept = lines.slice(-Math.floor(maxLines / 2)).join("\n") + "\n";
        writeFileSync(filePath, kept);
        _lastLogRotated = statSync(filePath).mtimeMs;
    }
    catch { }
}
function getLastLines(filePath, n = 5, maxBytes = 1024) {
    try {
        if (!existsSync(filePath))
            return [];
        const st = statSync(filePath);
        if (st.size === 0)
            return [];
        const bufSize = Math.min(maxBytes, st.size);
        const pos = Math.max(0, st.size - bufSize);
        const buf = Buffer.alloc(bufSize);
        const fd = openSync(filePath, "r");
        let bytesRead = 0;
        try {
            const result = readSync(fd, buf, 0, bufSize, pos);
            bytesRead = result.bytesRead;
        }
        finally {
            closeSync(fd);
        }
        const chunk = buf.toString("utf-8", 0, bytesRead);
        const lines = chunk.split("\n").filter(Boolean);
        return lines.slice(-n).map((l) => l.trim());
    }
    catch {
        return [];
    }
}
function getLastLine(filePath) {
    const lines = getLastLines(filePath, 1, 200);
    return lines[0] || "";
}
// ── Session pruning ──────────────────────────────────────────────────
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
function loadScrapbookIndex() {
    try {
        const path = getGlobalIndexPath();
        if (!existsSync(path))
            return [];
        const raw = readFileSync(path, "utf-8");
        if (!raw.trim())
            return [];
        const entries = [];
        for (const line of raw.split("\n")) {
            const ln = line.trim();
            if (!ln)
                continue;
            try {
                const rec = JSON.parse(ln);
                if (rec && typeof rec === "object" && rec.hash)
                    entries.push(rec);
            }
            catch { }
        }
        return entries;
    }
    catch {
        return [];
    }
}
function saveScrapbookIndex(index) {
    try {
        const path = getGlobalIndexPath();
        mkdirSync(dirname(path), { recursive: true });
        const tmp = path + ".tmp";
        writeFileSync(tmp, index.map(e => JSON.stringify(e)).join("\n") + "\n");
        renameSync(tmp, path);
    }
    catch { }
}
function _scanScrubpadDir(dir) {
    const entries = [];
    try {
        if (!existsSync(dir))
            return entries;
        const files = readdirSync(dir).filter((f) => f.endsWith(".txt") && !f.endsWith(".summary.txt"));
        for (const f of files) {
            const hash = f.replace(/\.txt$/, "");
            const full = join(dir, f);
            try {
                const st = statSync(full);
                const head = _readHead(full);
                entries.push({ hash, tool: "unknown", size: st.size, ts: new Date(st.mtimeMs).toISOString(), head: head.slice(0, 100) });
            }
            catch { }
        }
    }
    catch { }
    return entries;
}
function rebuildScrapbookIndex() {
    try {
        const globalEntries = _scanScrubpadDir(SCRATCHPAD_GLOBAL_DIR);
        const sessionDir = getSessionScratchpadDir();
        const sessionEntries = _scanScrubpadDir(sessionDir);
        const merged = new Map();
        for (const e of globalEntries)
            merged.set(e.hash, e);
        for (const e of sessionEntries)
            if (!merged.has(e.hash))
                merged.set(e.hash, e);
        const index = Array.from(merged.values());
        saveScrapbookIndex(index);
        return index;
    }
    catch {
        return [];
    }
}
// ── Legacy aliases (backward compat) ──────────────────────────────────────
// These provide the interface the task requested even if the old code used
// different function names.
const STATE_FILE = DELEGATION_STATE_FILE;
function recordDelegation(tool, saveEst, meta = {}) {
    // Delegation savings are recorded via updateState
    // This wrapper provides the legacy interface expected by callers
    try {
        return updateState((s) => {
            const now = new Date().toISOString();
            const delta = Number(saveEst || 0);
            s.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" };
            s.lifetime.est_savings_usd = roundUsd(Number(s.lifetime.est_savings_usd || 0) + delta);
            s.lifetime.last_updated = now;
            s.sessions ??= {};
            const sid = _OC_SID;
            s.sessions[sid] ??= { started: now, session_started_at: now, source: "opencode", tool_counts: {}, warns: [] };
            if (currentProjectFingerprint)
                s.sessions[sid].project_fingerprint = currentProjectFingerprint;
            if (currentProjectName)
                s.sessions[sid].project_name = currentProjectName;
            s.sessions[sid].total_savings_usd = roundUsd(Number(s.sessions[sid].total_savings_usd || 0) + delta);
            _pruneOldSessions(s);
            return s;
        });
    }
    catch (err) {
        console.error(`[vibeOS] recordDelegation failed: ${err.message}`);
        return null;
    }
}
function recordCacheSaving(tool, saveEst, meta = {}) {
    try {
        const state = updateState((s) => {
            const now = new Date().toISOString();
            const delta = Number(saveEst || 0);
            s.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" };
            s.lifetime.cache_savings_usd = roundUsd(Number(s.lifetime.cache_savings_usd || 0) + delta);
            s.lifetime.last_updated = now;
            s.sessions ??= {};
            const sid = _OC_SID;
            s.sessions[sid] ??= { started: now, session_started_at: now, source: "opencode", tool_counts: {}, warns: [] };
            if (currentProjectFingerprint)
                s.sessions[sid].project_fingerprint = currentProjectFingerprint;
            if (currentProjectName)
                s.sessions[sid].project_name = currentProjectName;
            s.sessions[sid].session_cache_dir = getSessionScratchpadDir();
            s.sessions[sid].tool_counts[tool] = (s.sessions[sid].tool_counts[tool] || 0) + 1;
            s.sessions[sid].cache_savings_usd = roundUsd(Number(s.sessions[sid].cache_savings_usd || 0) + delta);
            if (meta?.hash) {
                s.sessions[sid].cache_hits ??= [];
                s.sessions[sid].cache_hits.push({
                    at: now,
                    tool,
                    hash: meta.hash,
                    est_savings_usd: roundUsd(delta),
                });
                if (s.sessions[sid].cache_hits.length > 200) {
                    console.error(`[vibeOS] session cache_hits truncated from ${s.sessions[sid].cache_hits.length} to 200 for ${sid}`);
                    s.sessions[sid].cache_hits = s.sessions[sid].cache_hits.slice(-200);
                }
            }
            _pruneOldSessions(s);
            return s;
        });
        const sid = _OC_SID;
        try {
            _ledgerBuffer.push(JSON.stringify({ v: 2, at: new Date().toISOString(), kind: "cache", amount_usd: Number(saveEst || 0), sid, tool }) + "\n");
            if (_ledgerBuffer.length >= LEDGER_BUFFER_MAX)
                _flushLedgerBuffer();
            else if (!_ledgerBufferTimer)
                _ledgerBufferTimer = setTimeout(_flushLedgerBuffer, LEDGER_BUFFER_FLUSH_MS);
        }
        catch { }
        return {
            lifetime: state?.lifetime?.cache_savings_usd || 0,
            session: state?.sessions?.[sid]?.cache_savings_usd || 0,
        };
    }
    catch (err) {
        console.error(`[vibeOS] cache state write failed: ${err.message}`);
        return null;
    }
}
function recordMissedContext7(saveEst) {
    try {
        const state = updateState((s) => {
            s.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" };
            s.lifetime.missed_context7_usd = Math.round(((s.lifetime.missed_context7_usd || 0) + saveEst) * 100) / 100;
            return s;
        });
        try {
            if (currentProjectFingerprint) {
                const pstate = loadProjectState();
                const bucket = ensureProjectBucket(pstate, currentProjectFingerprint);
                bucket.context7Bypasses = (bucket.context7Bypasses || 0) + 1;
                bucket.lastSeen = new Date().toISOString();
                saveProjectState(pstate);
            }
        }
        catch { }
        return state?.lifetime?.missed_context7_usd ?? null;
    }
    catch {
        return null;
    }
}
// ── Savings ledger reconciliation ────────────────────────────────────
function readLedgerTotals() {
    const empty = { delegation: 0, cache: 0, total: 0, entries: 0 };
    try {
        if (!existsSync(SAVINGS_LEDGER_FILE))
            return empty;
        const raw = readFileSync(SAVINGS_LEDGER_FILE, "utf-8");
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
            }
            catch {
                continue;
            }
            if (!rec || typeof rec !== "object")
                continue;
            if (rec.v !== undefined && rec.v !== 2)
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
            delegation: Math.round(delegation * 1000) / 1000,
            cache: Math.round(cache * 1000) / 1000,
            total: Math.round(total * 1000) / 1000,
            entries,
        };
    }
    catch {
        return empty;
    }
}
function reconcileStateFromLedger() {
    try {
        const ledgerMtime = existsSync(SAVINGS_LEDGER_FILE) ? statSync(SAVINGS_LEDGER_FILE).mtimeMs : 0;
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
        if (Math.abs(stTotal - l.total) < 0.0005)
            return;
        updateState((s) => {
            s.lifetime ??= { warn_count: 0, est_savings_usd: 0, last_updated: "" };
            s.lifetime.est_savings_usd = l.delegation;
            s.lifetime.total_savings_usd = l.delegation;
            s.lifetime.cache_savings_usd = l.cache;
            s.lifetime.last_updated = new Date().toISOString();
            s.lifetime.rebuilt_from_ledger = true;
            s.lifetime.ledger_entries_reconciled = l.entries;
            return s;
        });
    }
    catch { }
}
function readLifetimeSavings() {
    const empty = { ltTasks: 0, ltCache: 0, ltCost: 0, count: 0, scratchpadHits: 0, missedC7: 0, sesTasks: 0, sesEdit: 0, sesCredit: 0, sesC7: 0, sesQuota: 0, sesTaskDelegations: 0, sesDuration: 0, sesRatePerHour: 0, sesTrend: "stable", sesToolBreakdown: {}, sesModelTurns: { brain: 0, worker: 0 }, quality_avg: 0 };
    try {
        reconcileStateFromLedger();
        if (!existsSync(DELEGATION_STATE_FILE))
            return empty;
        const mtime = statSync(DELEGATION_STATE_FILE).mtimeMs;
        if (_savingsCache && mtime === _savingsCacheMtime)
            return _savingsCache;
        const s = safeJsonParse(readFileSync(DELEGATION_STATE_FILE, "utf-8"));
        _savingsCache = _computeSessionMetrics(s, _OC_SID);
        _savingsCacheMtime = mtime;
        return _savingsCache;
    }
    catch {
        return empty;
    }
}
function readPackageVersion() {
    try {
        const pkg = safeJsonParse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
        return String(pkg?.version || "");
    }
    catch {
        return "";
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
            ts: new Date().toISOString(),
            cost: session.cost_usd || 0,
            cache_savings: session.cache_savings_usd || 0,
            total_savings: session.total_savings_usd || 0,
            tool_counts: session.tool_counts || {},
            warns: session.warns?.length || 0,
            model: session.model || "",
        };
        const cpPath = join(getSessionRoot(), "checkpoint.json");
        mkdirSync(dirname(cpPath), { recursive: true });
        const tmp = cpPath + ".tmp";
        writeFileSync(tmp, JSON.stringify(cp, null, 2) + "\n");
        renameSync(tmp, cpPath);
    }
    catch { }
}
// ── Lightweight computeSessionMetrics (replacement to avoid circular dependency) ──
function _computeSessionMetrics(state, sid) {
    const session = state?.sessions?.[sid] || {};
    const warns = Array.isArray(session?.warns) ? session.warns : [];
    const toolCounts = session?.tool_counts || {};
    const toolBreakdown = {};
    for (const [t, c] of Object.entries(toolCounts)) {
        toolBreakdown[String(t)] = Number(c || 0);
    }
    const startedAt = session?.started ? new Date(session.started).getTime() : Date.now();
    const durationSec = Math.floor((Date.now() - startedAt) / 1000);
    const hours = Math.max(durationSec / 3600, 0.001);
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
        quality_avg: 0,
    };
}
// ── Export ───────────────────────────────────────────────────────────
export { 
// File system constants
USER_HOME, FILE_LOCK_DIR, DELEGATION_STATE_FILE as DELEGATION_STATE_FILE, SAVINGS_LEDGER_FILE, GLOBAL_LEARNING_FILE, PRICING_CACHE_FILE, BLACKBOX_STATE_FILE, PROJECT_STATE_FILE, TIERS_FILE, ACTIVE_JOBS_FILE, FLOW_TODO_QUEUE_FILE, FLOW_DEDUP_FILE, ENFORCEMENT_COOLDOWN_FILE, AUTH_F, CREDIT_CACHE_F, REPORTS_DIR, CONTEXT7_INSTALL_FLAG, TRINITY_OPENCODE_CONFIG, TRINITY_OPENCODE_CONFIGC, STATE_FILE, 
// Scratchpad paths
SCRATCHPAD_ROOT, SCRATCHPAD_GLOBAL_DIR, SCRATCHPAD_SESSIONS_DIR, SCRATCHPAD_SESSION_TTL_MS, SCRATCHPAD_MAX_AGE_SEC, MAX_SCRATCHPAD_FILES, MAX_SCRATCHPAD_BYTES, MAX_SESSION_SCRATCHPAD_FILES, MAX_SESSION_SCRATCHPAD_BYTES, DECADENCE_FRESH_MS, DECADENCE_WARM_MS, DECADENCE_COLD_MS, DECADENCE_EXPIRE_MS, DECADENCE_THROTTLE_MS, DECADENCE_GLOBAL_THROTTLE_MS, TOOL_NAME_NORMALIZE, SCRATCHPAD_TOOLS, 
// Warning constants
WARN_DEDUPE_WINDOW_MS, WARN_MAX_PER_SESSION, WARN_COALESCE_THRESHOLD, MAX_LOG_LINES, SOFT_QUOTA_LIMIT, 
// Session identity
_OC_SID, getOcSessionId, getSessionTimer, 
// Tool helper
tool, _zType, 
// Module state
currentTier, currentModel, currentProjectFingerprint, currentProjectName, textCompletePainted, softQuotaCounts, warnLogThrottle, recentToolEvents, frictionSessionKeys, routineSessionKeys, lastMutationEvent, warnPerSession, warnCoalesceCounters, enforcementBlocked, taskSlotRestore, pendingUiNote, briefedProjects, testReminderSeen, context7AlertedThisSession, _sessionCleanupRegistered, _sessionCacheCleaned, prunedThisProcess, _lastDecadenceRun, _lastGlobalDecadenceRun, _patternFiredKeys, 
// Savings cache
_savingsCache, _savingsCacheMtime, _ledgerReconciledMtime, _lastLogRotated, 
// ML Router state
_mlGraph, _cacheDb, ML_ENABLED, ML_CONFIDENCE_THRESHOLD, _mlSavePending, loadMLState, saveMLState, 
// Tier regexes
FALLBACK_HIGH, FALLBACK_MID, HIGH_TIER_RE, MID_TIER_RE, loadTierRegexes, 
// Selection
DFLT_SEL, loadSelection, writeSelection, 
// Global learning
DFLT_GL, loadGlobalLearning, updateGlobalLearning, getLearnedExploratoryWords, 
// Blackbox state
_blackboxTracker, _blackboxEnabled, _latestBlackboxState, _latestBlackboxLoopMsg, _latestBlackboxPivotMsg, _modelLocked, _detectedFramework, 
// JSONC parsing
safeJsonParse, 
// State management
validateState, readJsonOrEmpty, updateState, readFullState, writeFullState, withFileLock, _lockPathFor, _handleStateCorruption, 
// Session scratchpad
getSessionRoot, getSessionScratchpadDir, getSessionIndexPath, getGlobalIndexPath, ensureSessionScratchpadDirs, safeCopyIntoSession, cleanupCurrentSessionScratchpad, registerSessionCleanupHandlers, 
// Ledger buffer
LEDGER_BUFFER_MAX, LEDGER_BUFFER_FLUSH_MS, _ledgerBuffer, _ledgerBufferTimer, _flushLedgerBuffer, recordSavingsLedgerEntry, loadSavingsLedger, 
// Stable JSON
stableJson, _readHead, indexAppend, 
// Scratchpad hits
scratchpadHitsSeen, scanRecentScratchpad, getScratchpadHit, recordScratchpadObservation, _pruneScratchpadDir, runDecadenceCycle, applyDecadence, cleanupStaleSessionScratchpads, pruneScratchpadOnce, 
// Active jobs
loadActiveJobs, getActiveJobForProject, saveActiveJobForProject, saveJobRecord, loadJobRecord, 
// Project memory
projectFingerprint, loadProjectState, saveProjectState, ensureProjectBucket, mergeProjectBucket, detectTechStack, 
// Path normalization / command helpers
normalizeObservedPath, commandFamily, commandFailed, 
// Pattern learning
promotedProjectPatterns, projectPatternRows, clearProjectPatterns, 
// Log rotation
_rotateLog, getLastLines, getLastLine, 
// Session pruning
_pruneOldSessions, 
// Scrapbook index
loadScrapbookIndex, saveScrapbookIndex, rebuildScrapbookIndex, 
// Savings operations
roundUsd, recordDelegation, recordCacheSaving, recordMissedContext7, readLedgerTotals, reconcileStateFromLedger, readLifetimeSavings, readPackageVersion, saveSessionCheckpoint, 
// Blackbox state functions
loadBlackboxState, saveBlackboxState, getBlackboxTracker, getBlackboxResolution, };
// ── Status / Savings Payload Stubs ────────────────────────────────────
// These are defined inline in index.ts but imported from state.js.
// The import in index.ts evaluates first; index.ts then shadows with its own definitions.
// These stubs throw if index.ts is not loaded (isolated module test).
export function computeStatusPayload() { throw new Error("computeStatusPayload not initialized — import from index.ts"); }
export function computeSavingsPayload() { throw new Error("computeSavingsPayload not initialized — import from index.ts"); }
export function computeSessionCheckout() { throw new Error("computeSessionCheckout not initialized — import from index.ts"); }
export function diagnoseStructuredFromText(raw) { throw new Error("diagnoseStructuredFromText not initialized — import from index.ts"); }
export function projectStructuredFromText(raw) { throw new Error("projectStructuredFromText not initialized — import from index.ts"); }
export function loadMcpPort() { throw new Error("loadMcpPort not initialized — import from index.ts"); }
export function persistMcpPort(port) { throw new Error("persistMcpPort not initialized — import from index.ts"); }
