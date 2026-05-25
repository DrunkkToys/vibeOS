// @ts-nocheck
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { modelCostPerTurn, normalizeModelId, _parseOpenRouterTurnCost, _writeDynamicPricingCache, HIGH_TIER_RE, MID_TIER_RE } from "./pricing.js";
function getOpenCodeHome() {
    return process.env.VIBEOS_OPENCODE_HOME || join(process.env.HOME || "", ".config", "opencode");
}
function safeJsonParse(raw) {
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
// ── trinity rebuild helpers: discover, classify, probe ────────────────
const MODEL_RANK = { high: 3, mid: 2, budget: 1 };
const OPENCODE_GO_CATALOG = [
    "deepseek/deepseek-v4-flash",
    "deepseek/deepseek-chat",
    "deepseek/deepseek-reasoner",
];
function _loadOpenCodeProviders() {
    try {
        const cfg = readOpenCodeConfigObject(getOpenCodeHome());
        return cfg?.provider || {};
    }
    catch {
        return {};
    }
}
function _modelCost(id) {
    if (!id)
        return 0;
    const c = modelCostPerTurn(id);
    if (c != null)
        return c;
    const stripped = id.replace(/^(openrouter|opencode|deepseek)\//, "");
    return modelCostPerTurn(stripped) ?? modelCostPerTurn("deepseek/" + stripped) ?? 0;
}
function _modelTier(id) {
    if (!id)
        return "budget";
    const high = HIGH_TIER_RE?.test?.(id);
    if (high)
        return "high";
    const mid = MID_TIER_RE?.test?.(id);
    return mid ? "mid" : "budget";
}
export async function discoverAvailableModels(providers, auth) {
    const all = [];
    const seen = new Set();
    const push = (m) => {
        if (seen.has(m.id))
            return;
        seen.add(m.id);
        all.push(m);
    };
    const pushIfNew = (id, provider) => push({ id, provider, cost: _modelCost(id), tier: _modelTier(id) });
    if (providers.deepseek?.models) {
        for (const rawId of Object.keys(providers.deepseek.models)) {
            const id = rawId.includes("/") ? rawId : "deepseek/" + rawId;
            pushIfNew(id, "deepseek");
        }
    }
    if (auth.deepseek?.key) {
        try {
            const res = await fetch("https://api.deepseek.com/models", {
                headers: { Authorization: "Bearer " + auth.deepseek.key },
                signal: AbortSignal.timeout(4000)
            });
            if (res.ok) {
                const body = await res.json();
                const list = body?.data || body?.models || [];
                for (const m of list) {
                    const rawId = (typeof m === "string" ? m : m.id) || "";
                    if (!rawId)
                        continue;
                    const id = rawId.includes("/") ? rawId : "deepseek/" + rawId;
                    pushIfNew(id, "deepseek");
                }
            }
        }
        catch { }
    }
    if (auth.openrouter?.key) {
        try {
            const res = await fetch("https://openrouter.ai/api/v1/models", {
                headers: { Authorization: "Bearer " + auth.openrouter.key },
                signal: AbortSignal.timeout(5000)
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
                    const id = "openrouter/" + rawId;
                    pushIfNew(id, "openrouter");
                }
                if (Object.keys(pricingMap).length > 0)
                    _writeDynamicPricingCache(pricingMap);
            }
        }
        catch (e) {
            console.error("[vibeOS] OpenRouter probe failed:", e.message);
        }
    }
    for (const id of OPENCODE_GO_CATALOG) {
        pushIfNew(id, "opencode");
    }
    return all;
}
export function classifyAndRankModels(models) {
    if (!models || models.length === 0)
        return null;
    const unique = [];
    const seen = new Set();
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
        cheap: cheapest[0],
    };
}
export function modelToCcAlias(modelId) {
    if (!modelId)
        return "haiku";
    let m = String(modelId).toLowerCase()
        .replace(/\./g, "-")
        .replace(/^(openrouter|opencode|deepseek|anthropic|google)\//, "");
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
        "qwq": "sonnet",
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
export async function probeModel(modelId, auth) {
    if (!modelId || !auth)
        return true;
    const id = String(modelId || "");
    if (id.startsWith("opencode/"))
        return true;
    let apiUrl, apiKey, reqModel;
    if (id.startsWith("deepseek/")) {
        apiUrl = "https://api.deepseek.com/chat/completions";
        apiKey = auth.deepseek?.key;
        reqModel = id.replace("deepseek/", "");
    }
    else if (id.startsWith("openrouter/")) {
        apiUrl = "https://openrouter.ai/api/v1/chat/completions";
        apiKey = auth.openrouter?.key;
        reqModel = id.replace("openrouter/", "");
    }
    else {
        return true;
    }
    if (!apiKey) {
        console.error("[vibeOS] probeModel: no API key for " + id);
        return false;
    }
    try {
        const res = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + apiKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: reqModel,
                messages: [{ role: "user", content: "ok" }],
                max_tokens: 1,
            }),
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            console.error("[vibeOS] probeModel FAIL " + id + ": HTTP " + res.status + " " + errBody.slice(0, 200));
            return false;
        }
        return true;
    }
    catch (err) {
        console.error("[vibeOS] probeModel ERROR " + id + ": " + err.message);
        return false;
    }
}
