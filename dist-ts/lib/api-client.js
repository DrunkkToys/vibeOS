// @ts-nocheck
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { isApiConnected as isRuntimeApiConnected, markApiConnected, markApiDisconnected, resetApiConnection } from "./runtime-state.js";
const DEFAULT_API_URL = "https://api.vibetheog.com";
// Alpha-only onboarding token: intentionally embedded so fresh installs work
// without manual setup. This is a bootstrap credential, not a secrecy boundary.
const EMBEDDED_API_TOKEN = "vos_8d73804b13bb46711b9a47f036dba7b4d026fd9583d96960e663716e62815a69";
const API_TOKEN_RE = /^vos_[a-f0-9]{64}$/i;
const API_DISABLED_RE = /^(1|true|yes|on)$/i;
const REQUEST_TIMEOUT = 10000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 1000;
const ALPHA_BUILD_CHANNEL = String(process.env.VIBEOS_BUILD_CHANNEL || "alpha").toLowerCase();
const BOOTSTRAP_EXCHANGE_PATH = "/api/v1/auth/bootstrap/exchange";
const BOOTSTRAP_RETRY_COOLDOWN_MS = 60_000;
export class VibeOSAuthError extends Error {
    statusCode;
    code;
    constructor(message, statusCode, code) {
        super(message);
        this.name = "VibeOSAuthError";
        this.statusCode = statusCode;
        this.code = code;
    }
}
export class VibeOSTimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = "VibeOSTimeoutError";
    }
}
export class VibeOSNetworkError extends Error {
    constructor(message) {
        super(message);
        this.name = "VibeOSNetworkError";
    }
}
async;
getModes();
Promise < unknown > {
    return: this.request("/api/v1/modes", {}, "GET")
};
async;
selectMode(mode, string);
Promise < unknown > {
    return: this.request("/api/v1/mode/select", { mode })
};
async;
classifyQuery(text, string, state ?  : Record);
Promise < unknown > {
    return: this.request("/api/v1/mode/classify", { text, state: state || {} })
};
async;
classifyTier(model, string, customRegex, string | null, null);
Promise < unknown > {
    return: this.request("/api/v1/tier/classify", { model, custom_regex: customRegex })
};
async;
isExploratory(prompt, string, learnedExploratory, string[] = []);
Promise < unknown > {
    return: this.request("/api/v1/tier/exploratory", { prompt, learned_exploratory: learnedExploratory })
};
async;
scoreStress(text, string);
Promise < unknown > {
    return: this.request("/api/v1/stress/score", { text })
};
async;
stressLevel(score, number);
Promise < unknown > {
    return: this.request("/api/v1/stress/level", { score })
};
async;
blackboxAnalyze(sessionId, string, entry, BlackboxEntry);
Promise < unknown > {
    return: this.request("/api/v1/blackbox/analyze", {
        session_id: sessionId,
        project_id: entry.project_id || null,
        user_text: entry.userText || "",
        features: entry.features || {},
        action: entry.action || "explore",
        entropy: entry.entropy ?? 1.0,
        uncertainty: entry.uncertainty ?? 50,
        embedding: entry.embedding || null,
    })
};
async;
blackboxState(sessionId, string);
Promise < unknown > {
    return: this.request("/api/v1/blackbox/state", { session_id: sessionId })
};
async;
blackboxReset(sessionId, string);
Promise < unknown > {
    return: this.request("/api/v1/blackbox/reset", { session_id: sessionId })
};
async;
blackboxOutcome(sessionId, string, outcome, unknown);
Promise < unknown > {
    return: this.request("/api/v1/blackbox/outcome", { session_id: sessionId, outcome })
};
async;
blackboxCalibrate(projectId, string);
Promise < unknown > {
    return: this.request("/api/v1/blackbox/calibrate", { project_id: projectId || "global" })
};
async;
blackboxCalibration(projectId, string);
Promise < unknown > {
    return: this.request("/api/v1/blackbox/calibration?project_id=" + (projectId || "global"), null)
};
async;
blackboxControlVector(state, unknown, action, unknown, optimizationMode, string);
Promise < unknown > {
    return: this.request("/api/v1/blackbox/control-vector", { ...state, action, optimization_mode: optimizationMode })
};
async;
blackboxSelectMode(subRegime, string, stressMultiplier, number);
Promise < unknown > {
    return: this.request("/api/v1/blackbox/select-mode", { sub_regime: subRegime, stress_multiplier: stressMultiplier })
};
async;
vibemaxSelect(input, (Record) = {});
Promise < unknown > {
    return: this.request("/api/v1/vibemax/select", input)
};
async;
vibemaxPipeline(input, (Record) = {});
Promise < unknown > {
    return: this.request("/api/v1/vibemax/pipeline", input)
};
async;
vibemaxReset();
Promise < unknown > {
    return: this.request("/api/v1/vibemax/reset", null)
};
async;
vibemaxModel();
Promise < unknown > {
    return: this.request("/api/v1/vibemax/model", null)
};
async;
vibemaxTrain(telemetryPath, string | null, null);
Promise < unknown > {
    return: this.request("/api/v1/vibemax/train", { telemetry_path: telemetryPath })
};
async;
tddExports(sourceContent, string, ext, string);
Promise < unknown > {
    return: this.request("/api/v1/tdd/exports", { source_content: sourceContent, ext })
};
async;
tddParams(sourceContent, string, funcName, string);
Promise < unknown > {
    return: this.request("/api/v1/tdd/params", { source_content: sourceContent, func_name: funcName })
};
async;
tddInferType(paramName, string, defaultValue, unknown);
Promise < unknown > {
    return: this.request("/api/v1/tdd/infer-type", { param_name: paramName, default_value: defaultValue })
};
async;
tddSkeleton(language, string, fileName, string, exports, unknown[], options, (Record) = {});
Promise < unknown > {
    return: this.request("/api/v1/tdd/skeleton", { language, file_name: fileName, exports, options })
};
async;
patternsObserve(sessionId, string, toolName, string, input, unknown, output, unknown, directory, string);
Promise < unknown > {
    return: this.request("/api/v1/patterns/observe", {
        session_id: sessionId,
        tool_name: toolName,
        input,
        output,
        directory,
    })
};
async;
patternsRecord(sessionId, string, kind, string, key, string, summary, string, meta, (Record) = {});
Promise < unknown > {
    return: this.request("/api/v1/patterns/record", {
        session_id: sessionId,
        kind,
        key,
        summary,
        meta,
    })
};
async;
patternsQuery(sessionId, string, kind, string | null, null);
Promise < unknown > {
    return: this.request("/api/v1/patterns/query?kind=" + (kind || ""), null)
};
async;
patternsExploratoryWords(sessionId, string);
Promise < unknown > {
    return: this.request("/api/v1/patterns/exploratory-words", null)
};
async;
patternsClear(sessionId, string);
Promise < unknown > {
    return: this.request("/api/v1/patterns/clear", { session_id: sessionId })
};
async;
pricingFetch(openrouterKey, string, force = false);
Promise < unknown > {
    return: this.request("/api/v1/pricing/fetch", { openrouter_key: openrouterKey, force })
};
async;
pricingLookup(model, string);
Promise < unknown > {
    return: this.request("/api/v1/pricing/lookup", { model })
};
async;
pricingStatic();
Promise < unknown > {
    return: this.request("/api/v1/pricing/static", null)
};
async;
compressContext(text, string, threshold = 2000);
Promise < unknown > {
    return: this.request("/api/v1/compress/context", { text, threshold })
};
async;
adminCreateSeat(name, string, email, string);
Promise < unknown > {
    return: this.request("/admin/seats", { name, email }, true)
};
async;
adminCreateSeatWithToken(name, string, email, string, tokenLabel, string | null, null);
Promise < unknown > {
    return: this.request("/admin/seats", { name, email, with_token: tokenLabel || true }, true)
};
async;
adminListSeats();
Promise < unknown > {
    return: this.request("/admin/seats", null, true)
};
async;
adminUpdateSeat(seatId, string, status, string);
Promise < unknown > {
    return: this.request("/admin/seats/" + seatId, { status }, true)
};
async;
adminCreateToken(seatId, string, label, string, expiresAt, string);
Promise < unknown > {
    return: this.request("/admin/tokens", { seat_id: seatId, label, expires_at: expiresAt }, true)
};
async;
adminListTokens();
Promise < unknown > {
    return: this.request("/admin/tokens", null, true)
};
async;
adminUpdateToken(tokenId, string, status, string);
Promise < unknown > {
    return: this.request("/admin/tokens/" + tokenId, { status }, true)
};
async;
adminDeleteToken(tokenId, string);
Promise < unknown > {
    return: this.request("/admin/tokens/" + tokenId, null, true)
};
async;
adminUsage(days = 30);
Promise < unknown > {
    return: this.request("/admin/usage?days=" + days, null, true)
};
async;
health();
Promise < unknown > {
    return: this.request("/health", null, false)
};
isFallback();
boolean;
{
    return this.fallbackMode;
}
// ── Remote API client (Phase 2) ─────────────────────────────────────
export const VIBEOS_API_URL = process.env.VIBEOS_API_URL || "https://api.vibetheog.com";
const _apiDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
const _envPaths = [homedir() + "/.claude", _apiDir, process.cwd(), homedir()];
const _bootstrapEnvPath = _envPaths[0] + "/.env.alpha";
function readApiDisabledFromDisk() {
    for (const dir of _envPaths) {
        try {
            const env = readFileSync(dir + "/.env.production", "utf8");
            const m = env.match(/^VIBEOS_API_DISABLED=(.+)$/m);
            if (m && isTruthyFlag(m[1]))
                return true;
        }
        catch { }
    }
    return false;
}
function readTokenFromDisk() {
    if (readApiDisabledFromDisk())
        return "";
    for (const dir of _envPaths) {
        try {
            const env = readFileSync(dir + "/.env.production", "utf8");
            const m = env.match(/^VIBEOS_API_TOKEN=(.+)$/m);
            if (m) {
                const clean = normalizeApiToken(m[1], "");
                if (clean)
                    return clean;
            }
        }
        catch { }
    }
    return "";
}
function readBootstrapTokenFromDisk() {
    if (readApiDisabledFromDisk())
        return "";
    try {
        const env = readFileSync(_bootstrapEnvPath, "utf8");
        const m = env.match(/^VIBEOS_API_BOOTSTRAP_TOKEN=(.+)$/m);
        if (m)
            return m[1].trim();
    }
    catch { }
    return "";
}
export let VIBEOS_API_DISABLED = readApiDisabledFromDisk() || isTruthyFlag(process.env.VIBEOS_API_DISABLED);
export let VIBEOS_API_TOKEN = VIBEOS_API_DISABLED ? "" : (readTokenFromDisk() || normalizeApiToken(process.env.VIBEOS_API_TOKEN, "") || EMBEDDED_API_TOKEN);
export let VIBEOS_API_BOOTSTRAP_TOKEN = VIBEOS_API_DISABLED ? "" : (readBootstrapTokenFromDisk() || process.env.VIBEOS_API_BOOTSTRAP_TOKEN || "");
export let VIBEOS_API_ENABLED = !VIBEOS_API_DISABLED && process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN);
function persistBootstrapToken(token) {
    const clean = String(token || "").trim();
    try {
        if (!clean) {
            try {
                if (existsSync(_bootstrapEnvPath))
                    rmSync(_bootstrapEnvPath, { force: true });
            }
            catch { }
            return;
        }
        const parentDir = _envPaths[0];
        if (!existsSync(parentDir))
            mkdirSync(parentDir, { recursive: true });
        writeFileSync(_bootstrapEnvPath, `VIBEOS_API_BOOTSTRAP_TOKEN=${clean}\n`, "utf8");
    }
    catch (diskErr) {
        console.error("[vibeOS] Failed to persist alpha bootstrap token:", diskErr.message);
    }
}
export function setApiToken(newToken) {
    try {
        VIBEOS_API_DISABLED = false;
        VIBEOS_API_TOKEN = normalizeApiToken(newToken, EMBEDDED_API_TOKEN);
        VIBEOS_API_BOOTSTRAP_TOKEN = readBootstrapTokenFromDisk() || VIBEOS_API_BOOTSTRAP_TOKEN;
        VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN);
        persistPrimaryApiEnvState({ token: VIBEOS_API_TOKEN, disabled: false });
        console.error("[vibeOS] API token updated via setApiToken");
    }
    catch (e) {
        console.error("[vibeOS] Failed to update API token:", e.message);
    }
}
export function invalidateApiToken() {
    try {
        VIBEOS_API_DISABLED = true;
        VIBEOS_API_TOKEN = "";
        VIBEOS_API_BOOTSTRAP_TOKEN = "";
        VIBEOS_API_ENABLED = false;
        _apiClient = null;
        _apiFallbackMode = false;
        _apiFallbackSince = null;
        persistBootstrapToken("");
        persistPrimaryApiEnvState({ token: "", disabled: true });
        resetApiConnection();
        console.error("[vibeOS] API token invalidated and remote API disabled");
    }
    catch (e) {
        console.error("[vibeOS] Failed to invalidate API token:", e.message);
    }
}
export function setApiBootstrapToken(newToken) {
    try {
        VIBEOS_API_DISABLED = false;
        VIBEOS_API_BOOTSTRAP_TOKEN = String(newToken || "").trim();
        VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN);
        persistPrimaryApiEnvState({ disabled: false });
        persistBootstrapToken(VIBEOS_API_BOOTSTRAP_TOKEN);
        console.error("[vibeOS] Alpha bootstrap token updated");
    }
    catch (e) {
        console.error("[vibeOS] Failed to update alpha bootstrap token:", e.message);
    }
}
let _apiClient = null;
let _apiFallbackMode = false;
let _apiFallbackSince = null;
let _bootstrapExchangeInFlight = null;
let _bootstrapExchangeFailedAt = 0;
export async function ensureBootstrapExchange() {
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
            const client = new VibeOSApiClient({
                baseUrl: VIBEOS_API_URL,
                timeout: 5000,
            });
            const apiToken = await client.exchangeBootstrapToken(VIBEOS_API_BOOTSTRAP_TOKEN, ALPHA_BUILD_CHANNEL);
            if (!apiToken)
                return false;
            setApiToken(apiToken);
            markApiConnected();
            return true;
        }
        catch (err) {
            _bootstrapExchangeFailedAt = Date.now();
            console.error("[vibeOS] Alpha bootstrap exchange failed:", err.message);
            return false;
        }
        finally {
            _bootstrapExchangeInFlight = null;
        }
    })();
    return _bootstrapExchangeInFlight;
}
function syncApiTokenFromDisk() {
    const diskDisabled = readApiDisabledFromDisk() || isTruthyFlag(process.env.VIBEOS_API_DISABLED);
    const diskToken = readTokenFromDisk() || "";
    const diskBootstrapToken = readBootstrapTokenFromDisk() || "";
    const envToken = normalizeApiToken(process.env.VIBEOS_API_TOKEN, "");
    if (diskDisabled) {
        if (!VIBEOS_API_DISABLED || VIBEOS_API_TOKEN || VIBEOS_API_BOOTSTRAP_TOKEN || VIBEOS_API_ENABLED) {
            VIBEOS_API_DISABLED = true;
            VIBEOS_API_TOKEN = "";
            VIBEOS_API_BOOTSTRAP_TOKEN = "";
            VIBEOS_API_ENABLED = false;
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
        VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN);
        _apiClient = null;
        _apiFallbackMode = false;
        _apiFallbackSince = null;
        resetApiConnection();
        console.error("[vibeOS] API token synced from disk (disk is newer)");
    }
    else if (diskBootstrapToken && diskBootstrapToken !== VIBEOS_API_BOOTSTRAP_TOKEN) {
        VIBEOS_API_DISABLED = false;
        VIBEOS_API_BOOTSTRAP_TOKEN = diskBootstrapToken;
        VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN);
        _apiFallbackMode = false;
        _apiFallbackSince = null;
        resetApiConnection();
        console.error("[vibeOS] Alpha bootstrap token synced from disk (disk is newer)");
    }
    else if (!diskToken && VIBEOS_API_TOKEN) {
        persistPrimaryApiEnvState({ token: VIBEOS_API_TOKEN, disabled: false });
        console.error("[vibeOS] API token persisted to disk from memory (disk was empty)");
        VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && !!VIBEOS_API_TOKEN;
    }
    else if (envToken && !diskToken && !VIBEOS_API_TOKEN) {
        VIBEOS_API_DISABLED = false;
        VIBEOS_API_TOKEN = envToken;
        VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN);
        console.error("[vibeOS] API token loaded from VIBEOS_API_TOKEN env var");
    }
    else {
        VIBEOS_API_DISABLED = false;
        VIBEOS_API_TOKEN ||= EMBEDDED_API_TOKEN;
        VIBEOS_API_ENABLED = process.env.VIBEOS_API_ENABLED !== "false" && (!!VIBEOS_API_TOKEN || !!VIBEOS_API_BOOTSTRAP_TOKEN);
    }
}
export function getApiClient() {
    syncApiTokenFromDisk();
    if (!_apiClient && VIBEOS_API_ENABLED && VIBEOS_API_TOKEN) {
        _apiClient = new VibeOSApiClient({
            baseUrl: VIBEOS_API_URL,
            apiToken: VIBEOS_API_TOKEN,
            timeout: 5000,
        });
    }
    return _apiClient;
}
export function isApiFallback() {
    return _apiFallbackMode || !VIBEOS_API_ENABLED;
}
export function isApiConnected() {
    return isRuntimeApiConnected() && VIBEOS_API_ENABLED && !_apiFallbackMode;
}
export async function remoteCall(method, args, fallbackFn) {
    syncApiTokenFromDisk();
    if (!VIBEOS_API_TOKEN && VIBEOS_API_BOOTSTRAP_TOKEN) {
        await ensureBootstrapExchange();
        syncApiTokenFromDisk();
    }
    if (!VIBEOS_API_ENABLED || _apiFallbackMode) {
        if (fallbackFn)
            return fallbackFn();
        return null;
    }
    try {
        const client = getApiClient();
        if (!client) {
            if (fallbackFn)
                return fallbackFn();
            return null;
        }
        const result = await client[method](...args);
        _apiFallbackMode = false;
        _apiFallbackSince = null;
        markApiConnected();
        return result;
    }
    catch (err) {
        if (!_apiFallbackMode) {
            _apiFallbackMode = true;
            _apiFallbackSince = new Date().toISOString();
            console.error(`[vibeOS] API fallback activated: ${err.message}`);
        }
        markApiDisconnected();
        if (fallbackFn) {
            try {
                return fallbackFn();
            }
            catch (fe) {
                console.error(`[vibeOS] fallback also failed: ${fe.message}`);
            }
        }
        return null;
    }
}
