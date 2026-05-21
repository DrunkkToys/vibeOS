// @ts-nocheck
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { classify, modelCostPerTurn, _refreshModel, TRINITY_BRAIN, TRINITY_MEDIUM, TRINITY_CHEAP } from "../pricing.js";
import { latestUserIntent } from "./chat-transform.js";
import { scoreStress, resolveEnforcementMode, detectOutcomeSignal, getBlackboxTracker, syncOutcomeToApi, loadOptimizationMode, autoSelectMode, classifyTurnSimple } from "../turn-classify.js";
import { saveReport } from "../reporting.js";
import { currentModel, currentTier, setCurrentModel, setCurrentTier, currentProjectFingerprint, currentProjectName, _modelLocked, _blackboxEnabled } from "../state.js";
const USER_HOME = (() => { try {
    return homedir();
}
catch {
    return tmpdir();
} })();
const STATE_FILE = join(USER_HOME, ".claude/delegation-state.json");
const SAVINGS_LEDGER_FILE = join(USER_HOME, ".claude/savings-ledger.jsonl");
let _prevOutputText = "";
let _autoReportCount = 0;
const textCompletePainted = new Set();
const SAVE_EST = {
    WRITE_EDIT: 0.005,
    SOFT_QUOTA: 0.0003,
    CONTEXT7: 0.002,
    OPUS_DISABLE: 0.03,
};
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
function shortModelName(modelId) {
    if (!modelId || typeof modelId !== "string")
        return "?";
    if (/^[^/]+\/[^/]+:free$/i.test(modelId)) {
        const free = modelId.replace(":free", "");
        const p = free.split("/");
        return p[p.length - 1].replace(/:free$/i, "") + " (free)";
    }
    if (/^[^/]+\/[^/]+$/.test(modelId)) {
        const p = modelId.split("/");
        return p[p.length - 1].replace(/:free$/i, "");
    }
    if (modelId.length <= 30)
        return modelId;
    return modelId.slice(0, 27) + "...";
}
function roundUsd(v, precision = 6) {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0)
        return 0;
    if (Math.abs(n) < 1e-12)
        return 0;
    return Number(n.toFixed(precision));
}
function formatUsd(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0)
        return "0.00";
    const abs = Math.abs(n);
    if (abs < 0.01)
        return (n >= 0 ? "+" : "") + "$" + n.toFixed(4);
    if (abs < 1)
        return (n >= 0 ? "+" : "") + "$" + n.toFixed(3);
    return (n >= 0 ? "+" : "") + "$" + n.toFixed(2);
}
function loadSelection() {
    try {
        const raw = readFileSync(join(USER_HOME, ".claude/model-tiers.json"), "utf-8");
        return safeJsonParse(raw)?.selection || { active_slot: "medium", enabled: true, delegation_enforce: false, flow_enabled: false, flow_enforce: false, tdd_enforce: false, tdd_strict: false, savings_goal_usd: 0 };
    }
    catch {
        return { active_slot: "medium", enabled: true, delegation_enforce: false, flow_enabled: false, flow_enforce: false, tdd_enforce: false, tdd_strict: false, savings_goal_usd: 0 };
    }
}
function readLifetimeSavings() {
    try {
        const raw = readFileSync(STATE_FILE, "utf-8");
        const state = safeJsonParse(raw);
        const ses = state?.sessions?.[(typeof _OC_SID !== "undefined" ? _OC_SID : "")] || {};
        return {
            ltTasks: roundUsd((state?.lifetime?.total_savings_usd || 0) + (state?.lifetime?.delegation_savings_usd || 0)),
            ltCache: roundUsd(state?.lifetime?.cache_savings_usd || 0),
            ltCost: roundUsd(state?.lifetime?.total_cost_usd || 0),
            count: state?.lifetime?.warn_count || 0,
            sesTasks: roundUsd(ses?.total_savings_usd || 0),
            sesEdit: roundUsd(ses?.edit_savings_usd || 0),
            sesCredit: roundUsd(ses?.credit_savings_usd || 0),
            sesC7: roundUsd(ses?.context7_savings_usd || 0),
            sesQuota: roundUsd(ses?.quota_savings_usd || 0),
            sesCache: roundUsd(ses?.cache_savings_usd || 0),
            sesTaskDelegations: ses?.task_delegations_count || 0,
            sesDuration: ses?.duration_seconds || 0,
            sesRatePerHour: ses?.rate_per_hour || 0,
            sesTrend: ses?.trend || "",
            sesToolBreakdown: ses?.tool_breakdown || {},
            sesModelTurns: ses?.model_turns || {},
            quality_avg: ses?.quality_avg || 0,
        };
    }
    catch {
        return { ltTasks: 0, ltCache: 0, ltCost: 0, count: 0, sesTasks: 0, sesEdit: 0, sesCredit: 0, sesC7: 0, sesQuota: 0, sesCache: 0, sesTaskDelegations: 0, sesDuration: 0, sesRatePerHour: 0, sesTrend: "", sesToolBreakdown: {}, sesModelTurns: {}, quality_avg: 0 };
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
async function _appendFooter(input, output, directory) {
    if (!loadSelection().enabled)
        return;
    _refreshModel(directory);
    let _footerStress = 0;
    if (latestUserIntent)
        _footerStress = scoreStress(latestUserIntent);
    // Lazy model detection: try client API once
    if (!currentModel) {
        try {
            const cfg = await client.config.get("model");
            if (cfg) {
                setCurrentModel(String(cfg));
                setCurrentTier(classify(String(cfg)));
                console.error(`[vibeOS] client-detected model: ${currentModel} (tier=${currentTier})`);
            }
        }
        catch { /* client.config may not be available */ }
    }
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
        const text = typeof output?.text === "string" ? output.text :
            typeof output?.result === "string" ? output.result :
                typeof output?.content === "string" ? output.content :
                    "";
        const { ltTasks, ltCache, ltCost, count, sesTasks, sesEdit, sesCredit, sesC7, sesQuota, sesCache, sesTaskDelegations, sesDuration, sesRatePerHour, sesTrend, sesToolBreakdown, sesModelTurns, quality_avg } = readLifetimeSavings();
        const brainModel = TRINITY_BRAIN || currentModel || "";
        let modelTag = `[${shortModelName(brainModel)}]`;
        const _workerModel = (currentTier === "high" && TRINITY_MEDIUM) ? TRINITY_MEDIUM : TRINITY_CHEAP;
        const totalTurns = (sesModelTurns?.brain || 0) + (sesModelTurns?.worker || 0);
        if (_workerModel && _workerModel !== brainModel) {
            const brainPct = Math.round(((sesModelTurns?.brain || 0) / (totalTurns || 1)) * 100);
            modelTag = `[${shortModelName(brainModel)} ${brainPct}% → ${shortModelName(_workerModel)} ${100 - brainPct}%]`;
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
                        model: currentModel,
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
                console.error("[vibeOS] auto-report:", e.message);
            }
        }
        // Enforcement state tags for footer — dynamically adjusted by control vector
        const selNowFooter = loadSelection();
        const enfTagsFooter = [];
        const bbMode = resolveEnforcementMode();
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
        // Optimization mode tag
        const optModeFooter = loadOptimizationMode();
        let optTagFooter = "";
        if (optModeFooter === "budget")
            optTagFooter = "[BUDGET]";
        else if (optModeFooter === "quality")
            optTagFooter = "[QUALITY]";
        else if (optModeFooter === "speed")
            optTagFooter = "[SPEED]";
        else if (optModeFooter === "longrun")
            optTagFooter = "[LONGRUN]";
        else if (optModeFooter === "auto") {
            const autoSavings = readLifetimeSavings();
            const autoActive = autoSelectMode(autoSavings?.sesCache || 0, classifyTurnSimple(latestUserIntent || ""));
            const autoTag = { budget: "BUDGET", quality: "QUALITY", speed: "SPEED", longrun: "LONGRUN", balanced: "BALANCED" };
            optTagFooter = `[AUTO→${autoTag[autoActive] || autoActive.toUpperCase()}]`;
        }
        modelTag = `${modelTag}${optTagFooter}${enfSuffixFooter || ""}`;
        const stripped = text.replace(/\n\n— .+(?: —)?$/, "");
        if (stripped !== text)
            return;
        const ltTotal = ltTasks + ltCache;
        const trendIcon = sesTrend === "down" ? "↓" : sesTrend === "up" ? "↑" : "→";
        const brainModelCost = currentModel ? (modelCostPerTurn(currentModel) ?? 0) : 0;
        const cheapModelCost = _workerModel ? (modelCostPerTurn(_workerModel) ?? 0) : 0;
        const imputedMultiplier = (brainModelCost > SAVE_EST.WRITE_EDIT && cheapModelCost > 0 && brainModelCost > cheapModelCost) ? (brainModelCost / cheapModelCost) : 0;
        let footerText;
        if (ltTotal > 0) {
            let savingsDisplay = `vibeOS: ${formatUsd(ltTotal)} saved ${trendIcon}`;
            if (imputedMultiplier > 2) {
                const imputedActual = ltTotal * imputedMultiplier;
                savingsDisplay += ` (${formatUsd(imputedActual)} actual)`;
            }
            const selGoal = loadSelection();
            const goalUsd = selGoal.savings_goal_usd || 0;
            if (goalUsd > 0) {
                const pct = Math.min(100, Math.round((ltTotal / goalUsd) * 100));
                const filled = Math.floor(pct / 10);
                const bar = "\u2588".repeat(filled) + "\u2591".repeat(10 - filled);
                savingsDisplay += ` | ${formatUsd(ltTotal)} / ${formatUsd(goalUsd)} [${bar}]`;
            }
            const stressBar = _footerStress > 0.85 ? "█" : _footerStress > 0.7 ? "▆" : _footerStress > 0.5 ? "▅" : _footerStress > 0.3 ? "▃" : _footerStress > 0.1 ? "▂" : "▁";
            const stressLabel = _footerStress > 0.7 ? "high" : _footerStress > 0.4 ? "elevated" : "calm";
            footerText = stripped + `\n\n— ${modelTag} | ${savingsDisplay} | stress: ${stressBar} ${stressLabel} —`;
        }
        else {
            footerText = stripped + `\n\n— ${modelTag} —`;
        }
        if (_blackboxEnabled) {
            try {
                const prevText = _prevOutputText;
                _prevOutputText = typeof output?.text === "string" ? output.text : typeof output?.result === "string" ? output.result : "";
                if (_prevOutputText && prevText && _prevOutputText !== prevText) {
                    const outcome = detectOutcomeSignal(_prevOutputText);
                    if (outcome) {
                        const tracker = getBlackboxTracker();
                        tracker.recordOutcome(outcome);
                        syncOutcomeToApi(outcome);
                    }
                }
            }
            catch { }
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
    }
    catch (err) {
        console.error(`[vibeOS] footer failed: ${err.message}`);
    }
}
export { _appendFooter, scoreTaskQuality };
