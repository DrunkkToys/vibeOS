// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// @ts-nocheck
// Decision Taxonomy — maps human situations to appropriate action categories.
// Ported from theWay: src/decision/taxonomy.py
const SITUATION_TYPES = ["work", "relationship", "opportunity", "health", "financial"];
const KEYWORDS = {
    work: ["job", "work", "career", "boss", "colleague", "company", "quit", "leave", "fire", "hire", "promote", "resign"],
    relationship: ["partner", "relationship", "friend", "family", "marriage", "date", "love", "breakup", "divorce"],
    opportunity: ["opportunity", "offer", "chance", "option", "possibility", "new", "startup", "venture"],
    health: ["health", "doctor", "exercise", "diet", "sick", "pain", "medical", "therapy", "hospital"],
    financial: ["money", "invest", "buy", "sell", "stock", "crypto", "save", "debt", "budget", "loan", "mortgage"],
};
const ACTION_MAP = {
    work: {
        high_exposure: ["change", "negotiate", "lead"],
        low_exposure: ["wait", "observe", "prepare"],
        default: "negotiate",
    },
    relationship: {
        high_exposure: ["invest", "commit", "express"],
        low_exposure: ["observe", "distance", "reflect"],
        default: "observe",
    },
    opportunity: {
        high_exposure: ["act", "explore", "commit"],
        low_exposure: ["ignore", "defer", "watch"],
        default: "explore",
    },
    health: {
        high_exposure: ["act", "consult", "prioritize"],
        low_exposure: ["maintain", "monitor", "wait"],
        default: "consult",
    },
    financial: {
        high_exposure: ["invest", "diversify", "act"],
        low_exposure: ["hold", "reduce", "wait"],
        default: "hold",
    },
};
export function classifySituation(text) {
    const textLower = text.toLowerCase();
    const scores = {};
    for (const stype of SITUATION_TYPES) {
        scores[stype] = 0;
    }
    for (const [stype, words] of Object.entries(KEYWORDS)) {
        for (const word of words) {
            if (textLower.includes(word)) {
                scores[stype]++;
            }
        }
    }
    let bestType = "opportunity";
    let bestScore = 0;
    for (const [stype, score] of Object.entries(scores)) {
        if (score > bestScore) {
            bestScore = score;
            bestType = stype;
        }
    }
    return bestScore > 0 ? bestType : "opportunity";
}
export function getActions(situationType, exposure) {
    const actionMap = ACTION_MAP[situationType] || ACTION_MAP.opportunity;
    if (exposure.total >= 45) {
        return actionMap.high_exposure;
    }
    return actionMap.low_exposure;
}
export function recommendAction(state) {
    const situationType = state.situation_type || "opportunity";
    const exposure = state.exposure;
    const hB = state.uncertainty_total / 100;
    const actions = getActions(situationType, exposure);
    let action;
    let confidence;
    let reasoning;
    let exposureGuidance;
    if (hB >= 0.5) {
        action = actions.length > 1 ? actions[actions.length - 1] : actions[0];
        confidence = Math.max(0.3, 1.0 - hB);
        reasoning = `High epistemic uncertainty (H(B)=${hB.toFixed(2)}). Insufficient information to act decisively.`;
        exposureGuidance = "Gather more information before committing.";
    }
    else if (hB <= 0.2) {
        action = actions[0];
        confidence = Math.min(0.95, 0.5 + (1.0 - hB));
        reasoning = `Low epistemic uncertainty (H(B)=${hB.toFixed(2)}). Good information basis for action.`;
        exposureGuidance = "Appropriate conditions for committed action.";
    }
    else {
        action = actions.length > 2 ? actions[Math.floor(actions.length / 2)] : actions[0];
        confidence = 0.6;
        reasoning = `Moderate epistemic uncertainty (H(B)=${hB.toFixed(2)}). Proceed with awareness.`;
        exposureGuidance = "Exploratory approach recommended.";
    }
    return {
        action,
        confidence,
        reasoning,
        exposure_guidance: exposureGuidance,
    };
}
export function getSituationTypes() {
    return [...SITUATION_TYPES];
}
