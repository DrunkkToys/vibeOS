// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
const DEFAULT_API_URL = "https://api.vibetheog.com";
const REQUEST_TIMEOUT = 10000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 1000;
class VibeOSApiClient {
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
            Authorization: "Bearer " + (isAdmin ? this.masterKey : this.apiToken),
        };
        let lastError = null;
        let attempt = 0;
        while (attempt <= MAX_RETRIES) {
            if (attempt > 0) {
                const delay = BASE_RETRY_DELAY * Math.pow(2, attempt - 1);
                await new Promise(r => setTimeout(r, delay));
            }
            attempt++;
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.timeout);
                const res = await fetch(url, {
                    method: body ? "POST" : "GET",
                    headers,
                    body: body ? JSON.stringify(body) : null,
                    signal: controller.signal,
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
            }
            catch (err) {
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
    async delegateCheck(tool, tier, model, prompt, dynamicCache = {}) {
        return this.request("/api/v1/delegate/check", { tool, tier, model, prompt, dynamic_cache: dynamicCache });
    }
    async delegateSoftQuota(tool, currentCount, limit = 5) {
        return this.request("/api/v1/delegate/soft-quota", { tool, current_count: currentCount, limit });
    }
    async delegateCost(model, dynamicCache = {}) {
        return this.request("/api/v1/delegation/cost", { model, dynamic_cache: dynamicCache });
    }
    async routeModel(prompt, currentTier, trinityCheap, trinityMedium, learnedExploratory = [], stressScore = 0) {
        return this.request("/api/v1/route/model", {
            prompt,
            current_tier: currentTier,
            trinity_cheap: trinityCheap,
            trinity_medium: trinityMedium,
            learned_exploratory: learnedExploratory,
            stress_score: stressScore,
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
            entropy: entry.entropy ?? 1.0,
            uncertainty: entry.uncertainty ?? 50,
            embedding: entry.embedding || null,
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
    async patternsObserve(sessionId, toolName, input, output, directory) {
        return this.request("/api/v1/patterns/observe", {
            session_id: sessionId,
            tool_name: toolName,
            input,
            output,
            directory,
        });
    }
    async patternsRecord(sessionId, kind, key, summary, meta = {}) {
        return this.request("/api/v1/patterns/record", {
            session_id: sessionId,
            kind,
            key,
            summary,
            meta,
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
    async compressContext(text, threshold = 2000) {
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
}
class VibeOSAuthError extends Error {
    statusCode;
    code;
    constructor(message, statusCode, code) {
        super(message);
        this.name = "VibeOSAuthError";
        this.statusCode = statusCode;
        this.code = code;
    }
}
class VibeOSTimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = "VibeOSTimeoutError";
    }
}
class VibeOSNetworkError extends Error {
    constructor(message) {
        super(message);
        this.name = "VibeOSNetworkError";
    }
}
export { VibeOSApiClient, VibeOSAuthError, VibeOSTimeoutError, VibeOSNetworkError };
