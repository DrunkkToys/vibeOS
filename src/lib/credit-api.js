// @ts-nocheck
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { modelCostPerTurn } from "./pricing.js";
import { AUTH_F, CREDIT_CACHE_F } from "./state.js";
function getVibeOSHome() {
    return process.env.VIBEOS_HOME || join(process.env.HOME || "", ".claude");
}
function safeJsonParse(raw) {
    try {
        return JSON.parse(raw);
    }
    catch { }
    let cleaned = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .replace(/,\s*([}\]])/g, "$1");
    try {
        return JSON.parse(cleaned);
    }
    catch (e) {
        throw e;
    }
}
// ── Credit API: fetch real balances from provider APIs ───────────────
const BALANCE_APIS = {
    deepseek: {
        url: "https://api.deepseek.com/user/balance",
        parse(d) {
            const b = d?.balance_infos?.find(b => b.currency === "USD");
            return b ? parseFloat(b.total_balance) : 0;
        },
    },
    openrouter: {
        url: "https://openrouter.ai/api/v1/credits",
        parse(d) { return parseFloat(d?.data?.total_credits) || 0; },
    },
};
let _creditTimer = null;
export function closeMcpServer() {
    if (!_mcpServerRuntime)
        return Promise.resolve();
    return _mcpServerRuntime.close();
}
let _mcpServerRuntime = null;
let _mcpServerHooked = false;
export function _readAuth() {
    try {
        return existsSync(AUTH_F) ? safeJsonParse(readFileSync(AUTH_F, "utf-8")) : {};
    }
    catch {
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
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok)
            return { provider, balance: 0 };
        return { provider, balance: api.parse(await res.json()) };
    }
    catch {
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
        writeFileSync(CREDIT_CACHE_F, JSON.stringify({ total, providers: provs, ts: Date.now() }));
    }
    catch { }
}
export function _cachedPct() {
    try {
        if (!existsSync(CREDIT_CACHE_F))
            return null;
        const s = safeJsonParse(readFileSync(CREDIT_CACHE_F, "utf-8"));
        if (s?.total == null || !s.ts)
            return null;
        let budget = 50;
        try {
            const p = join(getVibeOSHome(), "model-tiers.json");
            if (existsSync(p)) {
                const j = safeJsonParse(readFileSync(p, "utf-8"));
                if (j?.selection?.monthly_budget_usd)
                    budget = j.selection.monthly_budget_usd;
            }
        }
        catch { }
        return budget > 0 ? Math.min(150, Math.max(0, Math.round((s.total / budget) * 100))) : null;
    }
    catch {
        return null;
    }
}
let _started = false;
export function _lazyRefresh() {
    if (_started)
        return;
    _started = true;
    _snapshot();
    _creditTimer = setInterval(_snapshot, 60 * 60 * 1000);
    if (_creditTimer.unref)
        _creditTimer.unref();
}
export async function refreshCreditSnapshot() {
    await _snapshot();
    return loadCredit();
}
export function loadCredit() {
    const pct = _cachedPct();
    if (pct !== null)
        return pct;
    if (process.env.CLAUDE_CREDIT_PERCENT) {
        const n = parseInt(process.env.CLAUDE_CREDIT_PERCENT, 10);
        if (!isNaN(n))
            return n;
    }
    try {
        const f = join(getVibeOSHome(), "credit-percent");
        if (existsSync(f)) {
            const n = parseInt(readFileSync(f, "utf-8").trim(), 10);
            if (!isNaN(n))
                return n;
        }
    }
    catch { }
    return 50;
}
export function estimateTurnsRemaining(balanceUsd, modelId) {
    const balance = Number(balanceUsd || 0);
    const normalized = String(modelId || "").trim();
    if (!normalized || normalized === "(unset)" || normalized === "unknown") {
        return { balanceUsd: balance > 0 ? balance : 0, costPerTurn: null, turnsRemaining: null, unlimited: false };
    }
    const costPerTurn = modelCostPerTurn(modelId);
    if (!Number.isFinite(balance) || balance <= 0) {
        return { balanceUsd: 0, costPerTurn, turnsRemaining: 0, unlimited: costPerTurn === 0 };
    }
    if (costPerTurn === 0) {
        return { balanceUsd: balance, costPerTurn: 0, turnsRemaining: Number.POSITIVE_INFINITY, unlimited: true };
    }
    if (costPerTurn == null || !Number.isFinite(costPerTurn) || costPerTurn <= 0) {
        return { balanceUsd: balance, costPerTurn: null, turnsRemaining: null, unlimited: false };
    }
    return {
        balanceUsd: balance,
        costPerTurn,
        turnsRemaining: Math.floor(balance / costPerTurn),
        unlimited: false,
    };
}
export function thinkingLevel(credit) {
    if (credit >= 70)
        return "full";
    if (credit >= 40)
        return "brief";
    return "brief";
}
