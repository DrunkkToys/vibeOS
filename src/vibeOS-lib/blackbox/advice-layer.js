// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// Advice Layer — translates internal metrics into human-readable guidance.
// Ported from theWay: src/decision/advice_layer.py
import { FALLBACK_PLANS, ACTION_SUGGESTIONS, CURIOSITY_PROMPTS } from "./crew-constants.js";
// ── Thresholds ─────────────────────────────────────────────────────────────
const UNCERTAINTY_LOW = 30;
const UNCERTAINTY_MEDIUM = 60;
const ENTROPY_HIGH = 1.8;
const ENTROPY_LOW = 0.5;
const CONFIDENCE_HIGH = 0.75;
const CONFIDENCE_BASE_THRESHOLD = 0.65;
const STABILITY_WINDOW = 3;
const STABILITY_THRESHOLD = 0.7;
const REGIME_ADJUSTMENTS = {
    CONVERGING: -0.10,
    CLOSED: -0.10,
    DIVERGENT: +0.15,
    REFINING: 0.00,
    EXPLORING: +0.10,
    LOOPING: +0.15,
    INIT: +0.05,
};
const SAFE_ACTION_MAP = {
    observe: "defer",
    explore: "act",
    defer: "defer",
    act: "act",
    commit: "commit",
    change: "defer",
};
// ── Decision Block Templates ───────────────────────────────────────────────
const ACTION_DECISION_BLOCKS = {
    act: {
        do_today: [
            "Take the first visible step in the next 48 hours",
            "Tell one person your plan out loud",
        ],
        avoid_today: [
            "Waiting too long and losing momentum",
        ],
        if_unsure: "Start with the smallest possible commitment",
    },
    commit: {
        do_today: [
            "Make the formal commitment (sign, say yes, transfer funds, announce)",
            "Set clear boundaries around your decision",
        ],
        avoid_today: [
            "Leaving room for doubt — half measures drain more energy",
            "Seeking more validation when you already have enough",
        ],
        if_unsure: "Identify what's holding you back and address it directly",
    },
    explore: {
        do_today: [
            "Research 3 concrete options with real numbers",
            "Run one small experiment this week",
        ],
        avoid_today: [
            "Making a final decision without enough data",
        ],
        if_unsure: "Pick the option that feels most alive and test it with a small bet",
    },
    defer: {
        do_today: [
            "List 5 specific questions that need answers before you decide",
            "Set a firm decision deadline (date + time)",
        ],
        avoid_today: [
            "Forcing a decision before you have enough information",
        ],
        if_unsure: "Deferral without a deadline is avoidance — set a specific review date",
    },
    observe: {
        do_today: [
            "Write down everything you know and everything you don't",
            "Set a 7-day review date on your calendar",
        ],
        avoid_today: [
            "Jumping to conclusions too early",
        ],
        if_unsure: "Observation needs a deadline — set one and stick to it",
    },
    change: {
        do_today: [
            "Name one thing you will stop doing today",
            "Take one small action in the new direction",
        ],
        avoid_today: [
            "Holding onto the old path while trying to pivot",
        ],
        if_unsure: "A single step breaks the inertia — take it today",
    },
};
const HUMAN_ACTION_DESCRIPTIONS = {
    observe: "Watch and wait — the most powerful move right now is paying attention",
    defer: "Hold your position — set a date to re-evaluate when you have more clarity",
    explore: "Test and research — there are paths you haven't considered yet",
    act: "Move forward — take one deliberate step, not the whole journey",
    commit: "Commit fully — everything points in the same direction",
    change: "Pivot — the old way has run its course",
};
// ── Canonical Pipeline ─────────────────────────────────────────────────────
export function computeModality(riskLevel, subRegime) {
    if (riskLevel === "low" && ["CONVERGING", "CLOSED", "REFINING"].includes(subRegime)) {
        return "strict";
    }
    if (riskLevel === "high" || ["DIVERGENT", "LOOPING", "INIT"].includes(subRegime)) {
        return "exploratory";
    }
    return "suggestive";
}
function riskGuidance(riskLevel, subRegime) {
    let base;
    if (riskLevel === "low")
        base = "Proceed normally";
    else if (riskLevel === "medium")
        base = "Proceed with caution";
    else
        base = "Avoid major decisions today";
    if (subRegime === "DIVERGENT") {
        return `${base} — signals are scattered, slow down`;
    }
    return base;
}
function situationDescription(entropy, confidence, subRegime, continuityState) {
    if (subRegime === "DIVERGENT") {
        return "Signals are scattered — don't force a decision until the picture clears";
    }
    if (subRegime === "LOOPING") {
        return "You're going in circles — a fresh perspective might help";
    }
    if (entropy >= ENTROPY_HIGH) {
        return "Things are unclear right now — avoid high-risk decisions today";
    }
    if (["CONVERGING", "CLOSED"].includes(subRegime) || confidence >= CONFIDENCE_BASE_THRESHOLD) {
        if (continuityState === "HIGH") {
            return "You're ready to decide — move forward with confidence";
        }
        if (continuityState === "LOW") {
            return "You seem ready but your goal is shifting — confirm before committing";
        }
        return "You're ready to decide — move forward with confidence";
    }
    if (subRegime === "EXPLORING") {
        return "Gather more info before acting — the picture is still forming";
    }
    return "Take your time — clarity will come with more information";
}
export function humanReadableAction(action, continuityState) {
    let desc = HUMAN_ACTION_DESCRIPTIONS[action] || "Proceed with care";
    if (continuityState === "LOW" && ["act", "commit"].includes(action)) {
        desc += " (but confirm your goal hasn't shifted)";
    }
    return desc;
}
export function buildDecisionBlock(action, modality = "suggestive", originalAction = null) {
    const block = ACTION_DECISION_BLOCKS[action] || ACTION_DECISION_BLOCKS.explore;
    let overrideNote;
    if (originalAction && originalAction !== action) {
        overrideNote = `(internally ${originalAction})`;
    }
    const result = {
        modality,
        if_unsure: block.if_unsure,
        avoid_today: block.avoid_today,
    };
    if (modality === "exploratory") {
        result.consider_today = block.do_today;
    }
    else {
        result.do_today = block.do_today;
    }
    if (overrideNote) {
        result.override_note = overrideNote;
    }
    return result;
}
export function buildAdvice(action, diagnostics, resolutionState = null, originalAction = null) {
    const uncertainty = diagnostics.uncertainty ?? 50;
    const entropy = diagnostics.entropy ?? 1.0;
    const confidence = diagnostics.confidence ?? 0.5;
    const rs = resolutionState || {};
    const subRegime = rs.sub_regime || "INIT";
    const continuityState = rs.continuity_state;
    const riskLevel = uncertainty <= UNCERTAINTY_LOW
        ? "low"
        : uncertainty <= UNCERTAINTY_MEDIUM
            ? "medium"
            : "high";
    const modality = computeModality(riskLevel, subRegime);
    const decisionBlock = buildDecisionBlock(action, modality, originalAction);
    const guidance = riskGuidance(riskLevel, subRegime);
    const situation = situationDescription(entropy, confidence, subRegime, continuityState);
    const actionDesc = humanReadableAction(action, continuityState);
    return {
        action,
        action_description: actionDesc,
        risk_level: riskLevel,
        guidance,
        situation_description: situation,
        decision_block: decisionBlock,
    };
}
// ── Backward Compat Wrappers ───────────────────────────────────────────────
export function compressMetrics(diagnostics, resolutionState = null, action = "explore") {
    const advice = buildAdvice(action, diagnostics, resolutionState);
    return {
        risk_level: advice.risk_level,
        guidance: advice.guidance,
        situation_description: advice.situation_description,
    };
}
export function compressUncertainty(uncertainty) {
    return uncertainty <= UNCERTAINTY_LOW
        ? "low"
        : uncertainty <= UNCERTAINTY_MEDIUM
            ? "medium"
            : "high";
}
export function compressEntropy(entropy, maxEntropy = 2.58) {
    if (entropy <= 0.5)
        return "Your mind seems largely settled on this";
    if (entropy <= 1.2)
        return "Some competing thoughts, but a preference is emerging";
    if (entropy <= 1.8)
        return "You're genuinely torn — multiple paths feel valid";
    return "High internal conflict — you're pulled in many directions at once";
}
// ── Closure Policy ─────────────────────────────────────────────────────────
function effectiveThreshold(subRegime, calibrationBias = 0.0) {
    const adjustment = REGIME_ADJUSTMENTS[subRegime] ?? 0.0;
    return Math.max(0.3, Math.min(0.95, CONFIDENCE_BASE_THRESHOLD + adjustment + calibrationBias));
}
function safeAction(action) {
    return SAFE_ACTION_MAP[action] || "defer";
}
export function enforceClosure(action, confidence, resolutionState = null, calibrationBias = 0.0) {
    const subRegime = (resolutionState || {}).sub_regime || "INIT";
    const threshold = effectiveThreshold(subRegime, calibrationBias);
    if (confidence >= threshold) {
        if (!["act", "commit"].includes(action)) {
            return ["commit", true];
        }
        return [action, false];
    }
    if (["act", "commit"].includes(action)) {
        return [action, false];
    }
    const safe = safeAction(action);
    return [safe, safe !== action];
}
// ── Stability Score & Fast-Path ────────────────────────────────────────────
export function stabilityScore(resolutionState = null, diagnostics = null) {
    const rs = resolutionState || {};
    const diag = diagnostics || {};
    const signals = rs.signals || {};
    const consistency = signals.action_consistency ?? 0.0;
    const entropy = diag.entropy ?? 1.0;
    const entropyPenalty = 1.0 - Math.min(entropy / ENTROPY_HIGH, 1.0) * 0.3;
    return consistency * entropyPenalty;
}
export function shouldUseFastPath(resolutionState = null, diagnostics = null, verificationRequired = false) {
    const rs = resolutionState || {};
    const diag = diagnostics || {};
    const signals = rs.signals || {};
    const regime = rs.sub_regime || "INIT";
    if (!["CONVERGING", "CLOSED"].includes(regime))
        return false;
    const entropy = diag.entropy ?? 1.0;
    if (entropy >= 0.6)
        return false;
    if (stabilityScore(rs, diag) <= STABILITY_THRESHOLD)
        return false;
    const contradiction = signals.feature_contradiction ?? 0.0;
    if (contradiction >= 0.3)
        return false;
    return !verificationRequired;
}
// ── OVERCONFIDENT / Caution ────────────────────────────────────────────────
export function buildCautionNote(verificationRequired, subRegime) {
    if (!verificationRequired)
        return "";
    if (["CONVERGING", "CLOSED"].includes(subRegime)) {
        return "The system is confident but signals are mixed — verify before acting";
    }
    return "Proceed carefully — the situation may be clearer than it seems";
}
// ── Utility Scoring ────────────────────────────────────────────────────────
export function scoreUsefulness(output) {
    const advice = output.advice || {};
    const decisionBlock = advice.decision_block || {};
    const diagnostics = output.diagnostics || {};
    const hasDo = Boolean(decisionBlock.do_today || decisionBlock.consider_today);
    const hasAvoid = Boolean(decisionBlock.avoid_today);
    const hasUnsure = Boolean(decisionBlock.if_unsure);
    const hasAction = Boolean(advice.action_description);
    const actionUsefulness = [hasDo, hasAvoid, hasUnsure, hasAction].filter(Boolean).length / 4.0;
    const hasGuidance = Boolean(advice.guidance);
    const hasSituation = Boolean(advice.situation_description);
    const hasRisk = Boolean(advice.risk_level);
    const emotionalClarity = [hasGuidance, hasSituation, hasRisk].filter(Boolean).length / 3.0;
    const confidence = diagnostics.confidence ?? 0.0;
    const action = advice.action || "";
    let correctness;
    if (["act", "commit"].includes(action) && confidence >= 0.5) {
        correctness = Math.min(confidence * 1.2, 1.0);
    }
    else if (["observe", "defer"].includes(action) && confidence < 0.5) {
        correctness = 1.0 - confidence;
    }
    else {
        correctness = 0.5;
    }
    const hasSymbolic = Boolean(output.symbolic);
    const hasLatent = Boolean(output.latent);
    const hasResolution = Boolean(output.resolution);
    const hasTaxonomy = Boolean(output.taxonomy);
    const analysisDepth = [hasSymbolic, hasLatent, hasResolution, hasTaxonomy].filter(Boolean).length / 4.0;
    const total = actionUsefulness * 0.40 + emotionalClarity * 0.25 + correctness * 0.20 + analysisDepth * 0.15;
    return {
        action_usefulness: Math.round(actionUsefulness * 1000) / 1000,
        emotional_clarity: Math.round(emotionalClarity * 1000) / 1000,
        correctness: Math.round(correctness * 1000) / 1000,
        analysis_depth: Math.round(analysisDepth * 1000) / 1000,
        total: Math.round(total * 1000) / 1000,
    };
}
// ── Fallback Plans & Suggestions ───────────────────────────────────────────
export function getFallbackPlan(action) {
    return FALLBACK_PLANS[action] || FALLBACK_PLANS.explore;
}
export function getActionSuggestion(action) {
    return ACTION_SUGGESTIONS[action] || ACTION_SUGGESTIONS.explore;
}
export function getCuriosityPrompt(action) {
    return CURIOSITY_PROMPTS[action] || CURIOSITY_PROMPTS.explore;
}
