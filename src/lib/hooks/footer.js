// @ts-nocheck
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { classify, _refreshModel, readConfig, resolveDisplayModelId, TRINITY_BRAIN, TRINITY_MEDIUM, TRINITY_CHEAP, shortModelName, roundUsd, formatUsd, resolveExecutionIdentity, modelDisplayName } from "../pricing.js";
import { latestUserIntent } from "./chat-transform.js";
import { scoreStress, resolveEnforcementMode, detectOutcomeSignal, getBlackboxTracker, syncOutcomeToApi, loadOptimizationMode, classifyTurnSimple } from "../turn-classify.js";
import { peekBudgetFirstMode, recordBudgetFirstOutcome } from "../mode-policy.js";
import { saveReport } from "../reporting.js";
import { currentModel, currentTier, setCurrentModel, setCurrentTier, currentProjectFingerprint, currentProjectName, _modelLocked, _blackboxEnabled, _latestBlackboxState, reconcileStateFromLedger, safeJsonParse, loadBlackboxState } from "../state.js";
import { loadSessionSlot } from "../selection-manager.js";
import { remoteCall, isApiConnected } from "../api-client.js";
const IS_CLI_RUNTIME = Boolean(process.stdout?.isTTY || process.stderr?.isTTY || process.stdin?.isTTY);
const IS_TEST_RUNTIME = process.env.VIBEOS_MCP_PORT === "0" || process.env.NODE_ENV === "test" || process.env.CI === "true";
const FOOTER_DEBUG_STDERR = process.env.VIBEOS_DEBUG_FOOTER === "1" || (!IS_CLI_RUNTIME && !IS_TEST_RUNTIME);
function footerDebug(...args) {
    if (FOOTER_DEBUG_STDERR)
        console.error(...args);
}
function getVibeOSHome() {
    return process.env.VIBEOS_HOME || join(process.env.HOME || "", ".claude");
}
let _cachedAutoMode = null;
let _cachedAutoModeTs = 0;
const AUTO_CACHE_TTL = 60000;
const DEFAULT_REGIME_MAP = {
    LOOPING: "vibemax", DIVERGENT: "vibemax",
    EXPLORING: "vibemax", INIT: "vibemax",
    REFINING: "vibemax",
    CONVERGING: "quality", CLOSED: "quality",
};
function regimeToMode(regime, stress) {
    if (stress > 1.5)
        return "quality";
    return DEFAULT_REGIME_MAP[regime] || "vibemax";
}
async function apiAutoSelectMode(regime, stress) {
    const now = Date.now();
    if (_cachedAutoMode && now - _cachedAutoModeTs < AUTO_CACHE_TTL)
        return _cachedAutoMode;
    try {
        const res = await remoteCall("blackboxSelectMode", [regime, stress], null);
        if (res?.mode) {
            _cachedAutoMode = res.mode;
            _cachedAutoModeTs = now;
            return res.mode;
        }
    }
    catch (e) {
        footerDebug("[vibeOS] apiAutoSelectMode error:", e.message);
    }
    const fallback = regimeToMode(regime, stress);
    if (!_cachedAutoMode || _cachedAutoMode === "balanced")
        _cachedAutoMode = fallback;
    return _cachedAutoMode || fallback || "balanced";
}
const STATE_FILE = join(getVibeOSHome(), "delegation-state.json");
const SAVINGS_LEDGER_FILE = join(getVibeOSHome(), "savings-ledger.jsonl");
let _prevOutputText = "";
let _autoReportCount = 0;
const textCompletePainted = new Set();
let _lastStrippedText = "";
function loadSelection() {
    try {
        const raw = readFileSync(join(getVibeOSHome(), "model-tiers.json"), "utf-8");
        return safeJsonParse(raw)?.selection || { active_slot: "medium", enabled: true, delegation_enforce: true, flow_enabled: false, flow_enforce: false, tdd_enforce: false, tdd_strict: false };
    }
    catch {
        return { active_slot: "medium", enabled: true, delegation_enforce: true, flow_enabled: false, flow_enforce: false, tdd_enforce: false, tdd_strict: false };
    }
}
function readLifetimeSavings() {
    try {
        reconcileStateFromLedger();
        const raw = readFileSync(STATE_FILE, "utf-8");
        const state = safeJsonParse(raw);
        const ses = state?.sessions?.[(typeof _OC_SID !== "undefined" ? _OC_SID : "")] || {};
        return {
            ltTasks: roundUsd(state?.lifetime?.total_savings_usd || 0),
            ltCache: roundUsd(state?.lifetime?.cache_savings_usd || 0),
            ltCost: roundUsd(state?.lifetime?.total_cost_usd || 0),
            count: state?.lifetime?.warn_count || 0,
            sesTasks: roundUsd(ses?.total_savings_usd || 0),
            sesCache: roundUsd(ses?.cache_savings_usd || 0),
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
            quality_avg: state?.lifetime?.quality_total_count > 0
                ? Math.round((state?.lifetime?.quality_total_score || 0) / state?.lifetime?.quality_total_count)
                : 0,
        };
    }
    catch {
        return { ltTasks: 0, ltCache: 0, ltCost: 0, count: 0, sesTasks: 0, sesCache: 0, sesTaskDelegations: 0, sesDuration: 0, sesRatePerHour: 0, sesTrend: "", sesToolBreakdown: {}, sesModelTurns: {}, quality_avg: 0 };
    }
}
let _OC_SID = "opencode-" + (process.pid || "x") + "-" + Date.now();
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
    if (outputText.length > 1000)
        score += 5;
    return Math.max(0, Math.min(100, score));
}
function readRewardSignals() {
    try {
        const state = loadBlackboxState();
        const session = state?.sessions?.[_OC_SID] || {};
        const policy = session?.mode_policy || {};
        return {
            stableStreak: Math.max(0, Number(policy.stable_streak || 0)),
            problemStreak: Math.max(0, Number(policy.problem_streak || 0)),
        };
    }
    catch {
        return { stableStreak: 0, problemStreak: 0 };
    }
}
async function _appendFooter(input, output, directory) {
    _refreshModel(directory);
    let _footerStress = 0;
    if (latestUserIntent)
        _footerStress = scoreStress(latestUserIntent);
    // Always prefer the live OpenCode model setting when available.
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
    }
    catch { /* client.config may not be available */ }
    try {
        const messageID = input?.messageID ||
            input?.messageId ||
            input?.message?.id ||
            output?.messageID ||
            output?.messageId ||
            output?.message?.id ||
            null;
    if (messageID && textCompletePainted.has(messageID))
        return;
    function _payload(obj) {
        if (obj?.message && typeof obj.message === "object")
            return obj.message;
        return obj;
    }
    function _extractText(obj) {
        const payload = _payload(obj);
        if (typeof payload?.text === "string")
            return payload.text;
        if (typeof payload?.result === "string")
            return payload.result;
        if (typeof payload?.content === "string")
            return payload.content;
        if (Array.isArray(payload?.content))
            return payload.content.filter(p => p?.type === "text").map(p => p.text).filter(Boolean).join("\n");
        if (Array.isArray(payload?.parts))
            return payload.parts.filter(p => p?.type === "text").map(p => p.text).filter(Boolean).join("\n");
        return "";
    }
        const text = _extractText(output);
        if (!text)
            return;
        const { ltTasks, ltCache, ltCost, count, sesTasks, sesEdit, sesCredit, sesC7, sesQuota, sesCache, sesTaskDelegations, sesDuration, sesRatePerHour, sesTrend, sesToolBreakdown, sesModelTurns, quality_avg } = readLifetimeSavings();
        const { stableStreak, problemStreak } = readRewardSignals();
        const sessionSlot = loadSessionSlot(_OC_SID);
        const slot = sessionSlot || loadSelection().active_slot || "brain";
        const brainModel = slot === "brain" ? (TRINITY_BRAIN || currentModel) : slot === "medium" ? (TRINITY_MEDIUM || currentModel) : (TRINITY_CHEAP || currentModel || "");
        let liveModel = "";
        try {
            const cfg = await client.config.get("model");
            if (cfg)
                liveModel = String(cfg);
        }
        catch { }
        if (!liveModel) {
            liveModel = readConfig(directory) || readConfig(join(process.env.HOME || "", ".config", "opencode")) || process?.env?.OPENCODE_MODEL || "";
        }
        const displayModel = resolveDisplayModelId(liveModel || brainModel || currentModel || "", directory) || liveModel || brainModel || currentModel;
        const resolvedModel = displayModel || liveModel || brainModel || currentModel || "";
        if (resolvedModel && resolvedModel !== currentModel) {
            setCurrentModel(resolvedModel);
            setCurrentTier(classify(resolvedModel));
        }
        const execution = resolveExecutionIdentity(input?.args?.model || resolvedModel || "", directory);
        let modelTag = `[${shortModelName(displayModel)}]`;
        const _workerModel = slot === "brain" ? TRINITY_MEDIUM : null;
        const totalTurns = (sesModelTurns?.brain || 0) + (sesModelTurns?.worker || 0);
        if (_workerModel && _workerModel !== brainModel) {
            const brainPct = Math.round(((sesModelTurns?.brain || 0) / (totalTurns || 1)) * 100);
            modelTag = `[${shortModelName(displayModel)} ${brainPct}% → ${shortModelName(_workerModel)} ${100 - brainPct}%]`;
        }
        _autoReportCount = (_autoReportCount || 0) + 1;
        if (_autoReportCount % 5 === 0) {
            try {
                saveReport({
                    type: "session",
                    summary: "Session cost: $" + formatUsd(ltCost) + " | cache saved: $" + formatUsd(ltCache) + " | delegation saved: $" + formatUsd(Number(sesTasks || 0)) + " | task delegations: " + Number(sesTaskDelegations || 0),
                    metrics: {
                        sessionId: _OC_SID,
                        projectFingerprint: currentProjectFingerprint || "unknown",
                        projectName: currentProjectName || "unknown",
                        sessionCost: ltCost,
                        cacheSavings: ltCache,
                        delegationSavingsUsd: sesTasks,
                        taskDelegationCount: sesTaskDelegations,
                        // Backward compatibility (legacy field historically misnamed)
                        tasksDelegated: sesTaskDelegations,
                        model: resolvedModel || currentModel,
                        slot: loadSelection().active_slot || "unknown",
                        editSavings: sesEdit,
                        creditSavings: sesCredit,
                        context7Savings: sesC7,
                        quotaSavings: sesQuota,
                    },
                    tags: ["auto", "cost"],
                });
            }
            catch (e) {
                footerDebug("[vibeOS] auto-report:", e.message);
            }
        }
        // Enforcement state tags for footer — dynamically adjusted by control vector
        const selNowFooter = loadSelection();
        const enfTagsFooter = [];
        const bbMode = resolveEnforcementMode();
        const optModeFooter = loadOptimizationMode();
        if (bbMode === "relaxed") {
            enfTagsFooter.push("[Q&A]");
        }
        else {
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
        // Optimization mode resolver — keep the dopamine footer format.
        const resolvedMode = peekBudgetFirstMode({
            requestedMode: optModeFooter,
            subRegime: _latestBlackboxState?.sub_regime || classifyTurnSimple(latestUserIntent || ""),
            stress: _footerStress,
        }).mode;
        const stripped = text.replace(/— [^—]+ —\s*/g, "").trimEnd();
        if (stripped !== text)
            return;
        if (stripped === _lastStrippedText)
            return;
        const ltTotal = ltTasks + ltCache;
        const modeCapitalized = (mode) => mode.charAt(0).toUpperCase() + mode.slice(1);
        const optMode = (resolvedMode || "budget").toLowerCase();
        const brandMap = { vibeultrax: "VibeUltraX", vibeqmax: "VibeQMaX", vibemax: "VibeMaX", quality: "VibeQMaX", audit: "VibeQMaX", forensic: "VibeQMaX" };
        const brandedToRuntime = { vibeultrax: "Quality", vibeqmax: "Quality", vibemax: "Speed" };
        const activeSlot = selNowFooter.vector_changed_slot || selNowFooter.active_slot || "brain";
        const vibeBrand = brandMap[optModeFooter] || (activeSlot === "brain" ? "VibeQMaX" : "VibeMaX");
        const modeLabel = modeCapitalized(brandedToRuntime[optMode] || optMode);
        const tierIcon = activeSlot === "brain" ? "🧠" : activeSlot === "medium" ? "⚙" : activeSlot === "cheap" ? "🎁" : "⚡";
        const flashIcon = isApiConnected() ? " ⚡" : "";
        let vibeLine = `— ${tierIcon} ${activeSlot} | ${execution.provider_label} | ${modelDisplayName(execution.model)}`;
        if (ltTotal > 0) {
            vibeLine += ` | $${formatUsd(ltTotal)}`;
        }
        if (isApiConnected()) {
            vibeLine += ` | ${vibeBrand}${flashIcon}`;
        }
        const displayMode = selNowFooter?.optimization_mode || optMode || "auto";
        if (displayMode && displayMode !== "auto") {
            vibeLine += ` | ${displayMode}`;
        }
        if (selNowFooter?.vector_changed_slot) {
            vibeLine += ` | → ${selNowFooter.vector_changed_slot}`;
        }
        const footerText = stripped + `\n\n${vibeLine} —`;
        if (_blackboxEnabled) {
            try {
                const prevText = _prevOutputText;
                _prevOutputText = _extractText(output) || "";
                if (_prevOutputText && prevText && _prevOutputText !== prevText) {
                    const outcome = detectOutcomeSignal(_prevOutputText);
                    if (outcome) {
                        recordBudgetFirstOutcome({
                            outcome,
                            subRegime: _latestBlackboxState?.sub_regime || classifyTurnSimple(latestUserIntent || ""),
                            stress: _footerStress,
                        });
                        const tracker = getBlackboxTracker();
                        tracker.recordOutcome(outcome);
                        syncOutcomeToApi(outcome);
                        // Write outcome to calibration log
                        try {
                            mkdirSync(getVibeOSHome(), { recursive: true });
                            appendFileSync(join(getVibeOSHome(), "calibration-data.jsonl"), JSON.stringify({ ts: new Date().toISOString(), event: "outcome", sid: _OC_SID, outcome }) + "\n");
                        }
                        catch { }
                    }
                }
            }
            catch { }
    }
    function _setFooter(obj, text) {
        const target = _payload(obj);
        if (typeof target?.text === "string")
            target.text = text;
        else if (typeof target?.result === "string")
            target.result = text;
        else if (typeof target?.content === "string")
            target.content = text;
        else if (Array.isArray(target?.content)) {
            const textParts = target.content.filter(p => p?.type === "text");
            if (textParts.length > 0)
                textParts[textParts.length - 1].text = text;
            else
                target.content.push({ type: "text", text });
        }
        else if (Array.isArray(target?.parts)) {
            const textParts = target.parts.filter(p => p?.type === "text");
            if (textParts.length > 0)
                textParts[textParts.length - 1].text = text;
            else
                target.parts.push({ type: "text", text });
        }
        else
            target.text = text;
    }
        _setFooter(output, footerText);
        _lastStrippedText = stripped;
        // CLI/pipe mode: stdout is already rendered, write footer to stderr
        if (!process.stdout?.isTTY) {
            console.error(`\n${vibeLine} —`);
        }
        textCompletePainted.add(messageID);
        if (textCompletePainted.size > 500) {
            const it = textCompletePainted.values();
            for (let i = 0; i < 100; i++)
                textCompletePainted.delete(it.next().value);
        }
    }
    catch (err) {
        footerDebug(`[vibeOS] footer failed: ${err.message}`);
    }
}
export { _appendFooter, scoreTaskQuality, readRewardSignals };
