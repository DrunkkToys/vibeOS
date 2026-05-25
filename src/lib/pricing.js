// @ts-nocheck
export let TRINITY_BRAIN = null;
export let TRINITY_MEDIUM = null;
export let TRINITY_CHEAP = null;
export function setTrinityBrain(v) { TRINITY_BRAIN = v; }
export function setTrinityMedium(v) { TRINITY_MEDIUM = v; }
export function setTrinityCheap(v) { TRINITY_CHEAP = v; }
/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
 *
 * vibeOS pricing module — extracted from src/index.ts
 *
 * Contains: model cost lookup, tier classification, dynamic pricing,
 * context7 detection, per-turn cost estimation, and slot management.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, copyFileSync, renameSync, openSync, closeSync, rmSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { currentModel, currentTier, setCurrentModel, setCurrentTier, safeJsonParse, HIGH_TIER_RE, MID_TIER_RE, loadTierRegexes, _modelLocked } from "./state.js";
export { HIGH_TIER_RE, MID_TIER_RE, loadTierRegexes };
const USER_HOME = (() => { try {
    return homedir();
}
catch {
    return tmpdir();
} })();
const DEFAULT_TRINITY_SLOTS = ["brain", "medium", "cheap"];
function getVibeOSHome() {
    return process.env.VIBEOS_HOME || join(process.env.HOME || homedir(), ".claude");
}
function getOpenCodeHome() {
    return process.env.VIBEOS_OPENCODE_HOME || join(process.env.HOME || homedir(), ".config", "opencode");
}
const TIERS_FILE = join(getVibeOSHome(), "model-tiers.json");
function _handleStateCorruption(path) {
    const backupDir = join(getVibeOSHome(), ".backups");
    mkdirSync(backupDir, { recursive: true });
    const backupPath = join(backupDir, basename(path) + ".corrupted." + Date.now());
    try {
        copyFileSync(path, backupPath);
    }
    catch { }
    const logPath = join(getVibeOSHome(), ".state-corruption-log.jsonl");
    try {
        appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), path, backup: backupPath }) + "\n");
    }
    catch { }
}
// ── State paths ─────────────────────────────────────────────────────
// ── File locking ────────────────────────────────────────────────────
function _lockPathFor(filePath) {
    const hash = createHash("sha1").update(String(filePath || "")).digest("hex");
    return join(getVibeOSHome(), ".vibeOS-locks", `${hash}.lock`);
}
function withFileLock(filePath, fn, opts = {}) {
    const staleMs = Number(opts.staleMs || 30_000);
    const timeoutMs = Number(opts.timeoutMs || 2_000);
    const lockPath = _lockPathFor(filePath);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            mkdirSync(join(getVibeOSHome(), ".vibeOS-locks"), { recursive: true });
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
// ── Tier classification ─────────────────────────────────────────────
export let _autoReportCount = 0;
export function classify(m) {
    const s = String(m || "").toLowerCase();
    if (HIGH_TIER_RE.test(s))
        return "high";
    if (MID_TIER_RE.test(s))
        return "mid";
    return "budget";
}
// Map a model ID to a human-readable label with tier icon.
// Provider prefix is stripped before matching (everything before last "/").
export function modelToSlotLabel(modelId, effectiveTier) {
    const tier = effectiveTier ?? classify(modelId);
    const icon = tier === "high" ? "🧠" : tier === "mid" ? "⚙" : "⚡";
    return `[${icon} ${tier.charAt(0).toUpperCase() + tier.slice(1)}]`;
}
export function shortModelName(modelId) {
    const raw = String(modelId || "").trim();
    if (!raw)
        return "unknown";
    const parts = raw.split("/");
    return parts[parts.length - 1] || raw;
}
export function trendDisplay(sesTrend) {
    const t = sesTrend === "up" || sesTrend === "down" ? sesTrend : "stable";
    const icon = t === "up" ? "↑" : t === "down" ? "↓" : "→";
    return `${icon} ${t}`;
}
// ── Savings estimates ───────────────────────────────────────────────
// Estimated USD saved per 1M cached input tokens (miss_price - cache_hit_price).
// DeepSeek v4-pro: $0.14 - $0.0028 = $0.1372. General heuristic ~$0.10 across providers.
const CACHE_SAVED_PER_1M_INPUT_TOKENS = 0.10;
// Approximate bytes per token for JSON/text content (varies 3-6, use 4 as safe estimate).
const BYTES_PER_TOKEN = 4;
export function roundUsd(v, precision = 6) {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n))
        return 0;
    const f = 10 ** precision;
    return Math.round(n * f) / f;
}
export function formatUsd(v) {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n) || n === 0)
        return "0.00";
    const abs = Math.abs(n);
    if (abs >= 0.01)
        return n.toFixed(2);
    if (abs >= 0.001)
        return n.toFixed(3);
    return n.toFixed(4);
}
// ── Free model exceptions ───────────────────────────────────────────
// Models with negligible per-turn cost (less than 2e-5 USD/turn).
// These skip enforcement entirely to avoid noise.
// deepseek-chat is DEPRECATED by DeepSeek — now maps to v4-flash ($0.000182/turn).
// No DeepSeek models are free. Only local models (Ollama) qualify.
const FREE_MODELS = new Set([]);
// Approximate USD per typical ~1 K-token turn (blended input+output).
// Blend: 700 input + 300 output tokens per turn (line 272-273).
// Sources: provider API pricing pages, OpenRouter /api/v1/models.
// Add entries as new models appear; unknown models fall back to SAVE_EST constants.
// ── Auto-updated by scripts/sync-pricing.mjs before each release ──
const MODEL_USD_PER_TURN = {
    // ── Anthropic (Claude Code direct API) ─────────────────────
    "anthropic/claude-opus-4-7": 0.033,
    "anthropic/claude-opus-4-5": 0.033,
    "anthropic/claude-sonnet-4-6": 0.0066,
    "anthropic/claude-sonnet-4-5": 0.0066,
    "anthropic/claude-haiku-4-5": 0.0022,
    "anthropic/claude-haiku-4-5-20251001": 0.0022,
    "haiku": 0.0022,
    // ── DeepSeek (OC platform + OpenRouter) ──────────────────
    "deepseek/deepseek-v4-pro": 0.00057,
    "deepseek/deepseek-v4-flash": 0.000182,
    "deepseek/deepseek-chat": 0.000182,
    "deepseek-chat": 0.000182,
    "deepseek/deepseek-v3": 0.000182,
    "deepseek/deepseek-r1": 0.00124,
    "deepseek/deepseek-reasoner": 0.000182,
    "deepseek/haiku": 0.0022,
    // ── Google Gemini ────────────────────────────────────────
    "google/gemini-2.5-pro": 0.0039,
    "google/gemini-2.5-flash": 0.00096,
    "google/gemini-2.0-flash": 0.00019,
    // ── OpenAI ───────────────────────────────────────────────
    "openai/gpt-4o": 0.00475,
    "openai/gpt-4.1": 0.0038,
    "openai/gpt-4o-mini": 0.00029,
    "openai/gpt-4.1-mini": 0.00019,
    "openai/o3": 0.0038,
    "openai/o4-mini": 0.0021,
};
let _pricingOverridesCache = null;
let _pricingOverridesLoadedAt = 0;
const TURN_BLEND_INPUT_TOKENS = 700;
const TURN_BLEND_OUTPUT_TOKENS = 300;
let _dynamicPricingCache = null;
let _dynamicPricingCacheLoadedAt = 0;
function _loadDynamicPricingCache() {
    const now = Date.now();
    if (_dynamicPricingCache && (now - _dynamicPricingCacheLoadedAt) < 10_000)
        return _dynamicPricingCache;
    _dynamicPricingCacheLoadedAt = now;
    const PRICING_CACHE_FILE = join(getVibeOSHome(), "model-pricing-cache.json");
    try {
        if (!existsSync(PRICING_CACHE_FILE))
            return {};
        const st = statSync(PRICING_CACHE_FILE);
        if (st.size > 10485760) {
            _handleStateCorruption(PRICING_CACHE_FILE);
            _dynamicPricingCache = {};
            return {};
        }
        const raw = safeJsonParse(readFileSync(PRICING_CACHE_FILE, "utf-8"));
        const map = raw?.models && typeof raw.models === "object" ? raw.models : {};
        _dynamicPricingCache = map;
    }
    catch {
        _handleStateCorruption(PRICING_CACHE_FILE);
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
export function _parseOpenRouterTurnCost(modelRow) {
    const p = modelRow?.pricing || {};
    const inTok = Number(p.prompt ?? p.input ?? p.request);
    const outTok = Number(p.completion ?? p.output ?? p.response);
    if (Number.isFinite(inTok) && Number.isFinite(outTok)) {
        return inTok * TURN_BLEND_INPUT_TOKENS + outTok * TURN_BLEND_OUTPUT_TOKENS;
    }
    const oneTok = Number(p.price ?? p.total ?? p.input ?? p.output);
    if (Number.isFinite(oneTok))
        return oneTok * 1000;
    return null;
}
export function _writeDynamicPricingCache(modelsMap) {
    if (!modelsMap || typeof modelsMap !== "object")
        return;
    const PRICING_CACHE_FILE = join(getVibeOSHome(), "model-pricing-cache.json");
    try {
        withFileLock(PRICING_CACHE_FILE, () => {
            mkdirSync(dirname(PRICING_CACHE_FILE), { recursive: true });
            const tmp = PRICING_CACHE_FILE + ".tmp";
            writeFileSync(tmp, JSON.stringify({
                ts: Date.now(),
                source: "openrouter-models",
                models: modelsMap,
            }, null, 2) + "\n");
            renameSync(tmp, PRICING_CACHE_FILE);
        });
        _dynamicPricingCache = modelsMap;
        _dynamicPricingCacheLoadedAt = Date.now();
    }
    catch { }
}
// Strip routing prefixes (openrouter/, opencode/) and normalize version dots
// so "openrouter/anthropic/claude-sonnet-4.6" → "anthropic/claude-sonnet-4-6"
export function normalizeModelId(model) {
    let m = String(model || "").toLowerCase();
    if (m.startsWith("openrouter/"))
        m = m.slice("openrouter/".length);
    if (m.startsWith("opencode/"))
        m = m.slice("opencode/".length);
    m = m.replace(/(\d)\.(\d)/g, "$1-$2"); // 4.6 → 4-6
    return m;
}
let _modelCostMapNormalized = null;
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
    const now = Date.now();
    if (_pricingOverridesCache && (now - _pricingOverridesLoadedAt) < 10_000)
        return _pricingOverridesCache;
    _pricingOverridesLoadedAt = now;
    try {
        if (!existsSync(TIERS_FILE))
            return {};
        const st = statSync(TIERS_FILE);
        if (st.size > 10485760) {
            _handleStateCorruption(TIERS_FILE);
            _pricingOverridesCache = {};
            return {};
        }
        const raw = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"));
        const models = raw?.pricing?.models && typeof raw.pricing.models === "object" ? raw.pricing.models : {};
        const out = {};
        for (const [key, value] of Object.entries(models)) {
            let cost = null;
            if (typeof value === "number") {
                cost = value;
            }
            else if (value && typeof value === "object") {
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
    }
    catch {
        _handleStateCorruption(TIERS_FILE);
        _pricingOverridesCache = {};
    }
    return _pricingOverridesCache;
}
export function modelCostPerTurn(model) {
    if (!model)
        return 0;
    const dyn = _dynamicCostFor(model);
    if (dyn != null)
        return dyn;
    const key = normalizeModelId(model);
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
    // Prefix match for versioned model IDs (e.g. "claude-opus-4-7-20251001")
    for (const [k, v] of Object.entries(map)) {
        if (key.startsWith(k) && /-\d+$/.test(k) && key.charAt(k.length) === "-")
            return v;
    }
    // Log unknown models so we can add entries
    console.error(`[vibeOS] modelCostPerTurn: unknown model '${model}' (normalized: '${key}') — add to MODEL_USD_PER_TURN`);
    return null; // unknown — callers fall back to SAVE_EST constants
}
export function isModelFree(model) {
    if (!model || typeof model !== "string")
        return false;
    if (FREE_MODELS.has(model))
        return true;
    if (FREE_MODELS.has(normalizeModelId(model)))
        return true;
    const cost = modelCostPerTurn(model);
    return cost !== null && cost === 0;
}
// Context7 detection — scan known config files for the string "context7".
// Cheap (one-time at module load); falsy → docs nudge stays dormant.
const CONTEXT7_CONFIG_FILES = [
    join(getVibeOSHome(), "settings.json"),
    join(getVibeOSHome(), ".claude.json"),
    join(getOpenCodeHome(), "opencode.json"),
    join(process.cwd(), "opencode.json"),
];
function _scanOpenCodeConfigs(baseDir) {
    try {
        if (!existsSync(baseDir))
            return;
        for (const entry of readdirSync(baseDir)) {
            if (!entry.endsWith(".json"))
                continue;
            const full = join(baseDir, entry);
            if (existsSync(full) && /context7/i.test(readFileSync(full, "utf-8")))
                return true;
        }
    }
    catch { }
    return false;
}
function _context7InPath() {
    try {
        const pathDirs = (process.env.PATH || "").split(":");
        for (const dir of pathDirs) {
            if (!dir)
                continue;
            try {
                if (existsSync(join(dir, "context7")))
                    return true;
                if (existsSync(join(dir, "context7.cmd")))
                    return true;
            }
            catch { }
        }
    }
    catch { }
    return false;
}
function _context7InNpmCache() {
    try {
        const npxDir = join(USER_HOME, ".npm/_npx");
        if (!existsSync(npxDir))
            return false;
        for (const hashDir of readdirSync(npxDir)) {
            const ctxDir = join(npxDir, hashDir, "node_modules", "context7");
            try {
                if (existsSync(join(ctxDir, "package.json")))
                    return true;
            }
            catch { }
        }
    }
    catch { }
    return false;
}
export function detectContext7(files = CONTEXT7_CONFIG_FILES) {
    if (process.env.CLAUDE_CONTEXT7_AVAILABLE)
        return true;
    for (const f of files) {
        try {
            if (existsSync(f) && /context7/i.test(readFileSync(f, "utf-8")))
                return true;
        }
        catch { }
    }
    // Scan ~/.config/opencode/ for any JSON configs with context7 (MCP configs, etc.)
    if (_scanOpenCodeConfigs(getOpenCodeHome()))
        return true;
    if (_context7InPath())
        return true;
    if (_context7InNpmCache())
        return true;
    return false;
}
const DOCS_TARGET_RE = /(docs\.|readthedocs|developer\.mozilla|\/api\/|\/reference\/|\/guide\/|npmjs\.com\/package\/|pypi\.org\/project\/|crates\.io\/crates\/|pkg\.go\.dev|api-docs|\/javadoc\/)/i;
export function isDocsTarget(s) {
    return typeof s === "string" && DOCS_TARGET_RE.test(s);
}
// Per-process dedup so the same docs URL doesn't nudge twice.
const context7Seen = new Set();
// ── Slot management ─────────────────────────────────────────────────
// Read plugin enabled flag + active_slot fresh from model-tiers.json.
// Called per-hook so live edits (trinity on/off) take effect without restart.
function loadSelection() {
    const TIERS_FILE = join(getVibeOSHome(), "model-tiers.json");
    try {
        if (!existsSync(TIERS_FILE))
            return DFLT_SEL;
        const st = statSync(TIERS_FILE);
        if (st.size > 10485760) {
            _handleStateCorruption(TIERS_FILE);
            return DFLT_SEL;
        }
        const j = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"));
        return {
            enabled: j?.selection?.enabled !== false,
            active_slot: j?.selection?.active_slot || null,
            thinking_level: j?.selection?.thinking_level || "off",
            flow_enabled: j?.selection?.flow_enabled === true,
            tdd_enforce: j?.selection?.tdd_enforce === true,
            tdd_strict: j?.selection?.tdd_strict === true,
            tdd_quality: j?.selection?.tdd_quality !== false,
            flow_enforce: j?.selection?.flow_enforce === true,
            delegation_enforce: true,
        };
    }
    catch {
        _handleStateCorruption(TIERS_FILE);
        return DFLT_SEL;
    }
}
const DFLT_SEL = { enabled: true, active_slot: null, thinking_level: "off", flow_enabled: false, tdd_enforce: false, tdd_strict: false, tdd_quality: true, flow_enforce: false, delegation_enforce: true };
export function readConfig(dir) {
    try {
        const c = readOpenCodeConfigObject(dir);
        return c?.agent?.build?.model || c?.model || "";
    }
    catch {
        return "";
    }
}
function parseJsonc(raw) {
    const noBlockComments = String(raw || "").replace(/\/\*[\s\S]*?\*\//g, "");
    const noLineComments = noBlockComments.replace(/(^|\s)\/\/.*$/gm, "$1");
    const noTrailingCommas = noLineComments.replace(/,\s*([}\]])/g, "$1");
    return safeJsonParse(noTrailingCommas);
}
function readOpenCodeConfigObject(dir) {
    const jsonPath = join(dir, "opencode.json");
    const jsoncPath = join(dir, "opencode.jsonc");
    if (existsSync(jsonPath)) {
        return safeJsonParse(readFileSync(jsonPath, "utf-8"));
    }
    if (existsSync(jsoncPath)) {
        return parseJsonc(readFileSync(jsoncPath, "utf-8"));
    }
    return {};
}
// Refresh currentModel/currentTier from disk config.
// Called per-hook so trinity slot changes take effect without restart.
export const PLACEHOLDER_RE = /^[^/]+\/[a-z-]+-model$/i;
export function getTrinitySlotOrder(tiersData = null) {
    const configured = Array.isArray(tiersData?.selection?.slot_order)
        ? tiersData.selection.slot_order
        : null;
    const valid = (configured || [])
        .map((slot) => String(slot || "").trim())
        .filter(Boolean);
    return valid.length > 0 ? valid : DEFAULT_TRINITY_SLOTS;
}
export function _refreshModel(directory) {
    try {
        const TIERS_FILE = join(getVibeOSHome(), "model-tiers.json");
        const sel = loadSelection();
        if (!sel.enabled)
            return;
        const tiersData = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"));
        const slotOrder = getTrinitySlotOrder(tiersData);
        const activeSlot = slotOrder.includes(sel.active_slot) ? sel.active_slot : (slotOrder[0] || "brain");
        let slotOcModel = tiersData?.trinity?.[activeSlot]?.oc || "";
        // Skip placeholder models (e.g. "provider/high-tier-model") — use auto-detected model instead
        if (slotOcModel && PLACEHOLDER_RE.test(slotOcModel)) {
            slotOcModel = "";
            console.error(`[vibeOS] placeholder model detected in ${activeSlot} slot — skipping, will auto-detect`);
        }
        if (slotOcModel) {
            // Always derive tier from active slot so footer/env reflect slot changes,
            // even when multiple slots point to the same model ID.
            const nextTier = activeSlot === (slotOrder[0] || "brain") ? "high" : classify(slotOcModel);
            const modelChanged = currentModel !== slotOcModel;
            const tierChanged = currentTier !== nextTier;
            if (modelChanged || tierChanged) {
                const oldModel = currentModel;
                const oldTier = currentTier;
                setCurrentModel(slotOcModel);
                setCurrentTier(nextTier);
                console.error(`[vibeOS] model refresh: ${oldModel}(${oldTier}) → ${currentModel}(${currentTier}) (slot=${activeSlot})`);
            }
        }
        // If no model from tiers and no existing currentModel, try to auto-detect
        if (!currentModel) {
            const detected = readConfig(directory) || readConfig(getOpenCodeHome()) || process?.env?.OPENCODE_MODEL || "";
            if (detected) {
                setCurrentModel(detected);
                setCurrentTier(classify(detected));
                console.error(`[vibeOS] auto-detected model: ${currentModel} (tier=${currentTier})`);
            }
        }
        // Reconcile with the directory's opencode.json config.
        // The trinity slot is authoritative UNLESS the directory config specifies a different model.
        // This prevents the bootstrap's default slot from overriding a project-local model choice.
        if (!_modelLocked) {
            const cfgModel = readConfig(directory) || readConfig(getOpenCodeHome()) || "";
            if (cfgModel && cfgModel !== currentModel) {
                const oldModel = currentModel;
                const oldTier = currentTier;
                setCurrentModel(cfgModel);
                setCurrentTier(classify(cfgModel));
                console.error(`[vibeOS] model refresh (config): ${oldModel}(${oldTier}) → ${currentModel}(${currentTier})`);
                try {
                    if (existsSync(TIERS_FILE)) {
                        const t = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"));
                        for (const s of getTrinitySlotOrder(t)) {
                            if (t?.trinity?.[s]?.oc === cfgModel) {
                                t.selection.active_slot = s;
                                const _tmp = TIERS_FILE + ".tmp." + Date.now();
                                writeFileSync(_tmp, JSON.stringify(t, null, 2) + "\n", "utf-8");
                                renameSync(_tmp, TIERS_FILE);
                                console.error(`[vibeOS] model refresh (config): synced active_slot → ${s}`);
                                break;
                            }
                        }
                    }
                }
                catch { }
            }
        }
    }
    catch { }
}
export function applySlot(slot) {
    try {
        const TIERS_FILE = join(getVibeOSHome(), "model-tiers.json");
        const j = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"));
        const ocModel = j?.trinity?.[slot]?.oc;
        if (!ocModel)
            return { ok: false, reason: `slot '${slot}' has no oc model` };
        j.selection.active_slot = slot;
        const _tmp = TIERS_FILE + ".tmp." + Date.now();
        writeFileSync(_tmp, JSON.stringify(j, null, 2) + "\n", "utf-8");
        renameSync(_tmp, TIERS_FILE);
        // Prefer project-local config to avoid mutating global provider/dropdown config.
        const localOcConfig = join(process.cwd(), "opencode.json");
        const ocConfig = existsSync(localOcConfig)
            ? localOcConfig
            : join(getOpenCodeHome(), "opencode.json");
        if (existsSync(ocConfig)) {
            const oc = safeJsonParse(readFileSync(ocConfig, "utf-8"));
            oc.model = ocModel;
            writeFileSync(ocConfig, JSON.stringify(oc, null, 2) + "\n");
        }
        _refreshModel(process.cwd());
        return { ok: true, ocModel };
    }
    catch (err) {
        return { ok: false, reason: err.message };
    }
}
