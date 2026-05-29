// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// @ts-nocheck
// Resolution Tracker — state-of-progress estimator for dialogue trajectory.
// Ported from theWay: src/decision/resolution_tracker.py
export class ResolutionTracker {
    static SUB_REGIMES = ["INIT", "DIVERGENT", "EXPLORING", "REFINING", "CONVERGING", "CLOSED", "LOOPING"];
    sessionId;
    maxHistory;
    history;
    loopCount;
    pivotHistory;
    outcomeHistory;
    calibratedWeights;
    constructor(sessionId, maxHistory = 10) {
        this.sessionId = sessionId;
        this.maxHistory = maxHistory;
        this.history = [];
        this.loopCount = 0;
        this.pivotHistory = [];
        this.outcomeHistory = [];
        this.calibratedWeights = null;
    }
    update(userText, features, action, entropy, uncertainty, embedding = null) {
        const entry = {
            text: userText,
            features: { ...features },
            action,
            entropy,
            uncertainty,
            embedding: embedding ? [...embedding] : null,
            timestamp: Date.now() / 1000,
        };
        if (this.history.length >= 2) {
            entry.is_pivot = this.detectPivotSignal(entry, this.history[this.history.length - 1]);
            if (entry.is_pivot) {
                this.pivotHistory.push(this.history.length);
            }
        }
        this.history.push(entry);
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }
        const state = this.computeState();
        if (state.is_looping) {
            this.loopCount++;
            this.history[this.history.length - 1].outcome = this.history[this.history.length - 1].outcome || "loop_detected";
        }
        else if (state.sub_regime !== "LOOPING") {
            this.loopCount = Math.max(0, this.loopCount - 1);
        }
        return state;
    }
    detectPivotSignal(current, previous) {
        const drift = this.history.length >= 4
            ? this.computeIntentState().drift_rate
            : 0;
        const repeatRatio = (current.features?.repetition || 0);
        const instructionChange = Math.abs((current.features?.instruction_density || 0.6) - (previous.features?.instruction_density || 0.6));
        const lengthRatio = previous.text.length > 0
            ? Math.abs(current.text.length - previous.text.length) / previous.text.length
            : 0;
        const pivotScore = drift * 0.35 + repeatRatio * 0.15 + instructionChange * 0.25 + lengthRatio * 0.25;
        return pivotScore > 0.45;
    }
    computeState() {
        const n = this.history.length;
        if (n < 1) {
            return {
                sub_regime: "INIT",
                resolution: "unresolved",
                momentum: 0.0,
                signals: { action_consistency: 1.0, entropy_trend: 0.0, feature_contradiction: 0.0, embedding_delta: 0.0 },
                intent_state: { volatility_score: 0.0, drift_rate: 0.0, core_goal_embedding: null },
                continuity_state: "HIGH",
                is_looping: false,
                loop_consecutive: 0,
                loop_intervention_level: "none",
                pivot_detected: false,
                pivot_score: 0.0,
                outcome: null,
                n_interactions: 0,
            };
        }
        const actionConsistency = this.calcActionConsistency();
        const entropyTrend = this.calcEntropyTrend();
        const featureContradiction = this.calcFeatureContradiction();
        const embeddingDelta = this.calcEmbeddingDelta();
        const isLooping = this.detectLoop();
        const intentState = this.computeIntentState();
        const continuityState = this.continuityState(intentState);
        let subRegime;
        if (n === 1) {
            subRegime = "INIT";
        }
        else if (isLooping) {
            subRegime = "LOOPING";
        }
        else if (this.isClosed(actionConsistency, embeddingDelta, featureContradiction)) {
            subRegime = "CLOSED";
        }
        else if (this.isDivergent(entropyTrend, featureContradiction, actionConsistency)) {
            subRegime = "DIVERGENT";
        }
        else if (this.isExploring(featureContradiction, entropyTrend, actionConsistency)) {
            subRegime = "EXPLORING";
        }
        else if (this.isRefining(featureContradiction, embeddingDelta, actionConsistency, entropyTrend)) {
            subRegime = "REFINING";
        }
        else if (this.isConverging(actionConsistency, embeddingDelta, entropyTrend)) {
            subRegime = "CONVERGING";
        }
        else {
            subRegime = "EXPLORING";
        }
        let resolution;
        if (isLooping) {
            resolution = "looping";
        }
        else if (subRegime === "CLOSED") {
            resolution = "solved";
        }
        else if (subRegime === "CONVERGING" && actionConsistency > 0.5) {
            resolution = "converging";
        }
        else {
            resolution = "unresolved";
        }
        const lastEntry = this.history[this.history.length - 1];
        const momentum = this.calcMomentum(entropyTrend, actionConsistency, embeddingDelta, isLooping, lastEntry.action, lastEntry.entropy);
        let loopLevel = "none";
        if (isLooping) {
            if (this.loopCount >= 4)
                loopLevel = "escalated";
            else if (this.loopCount >= 3)
                loopLevel = "assertive";
            else if (this.loopCount >= 2)
                loopLevel = "suggestive";
            else
                loopLevel = "gentle";
        }
        const pivotDetected = lastEntry.is_pivot || false;
        const pivotScore = pivotDetected ? 1.0
            : (intentState.drift_rate * 0.6 + (intentState.volatility_score * 0.4));
        return {
            sub_regime: subRegime,
            resolution,
            momentum: Math.round(momentum * 10000) / 10000,
            signals: {
                action_consistency: Math.round(actionConsistency * 10000) / 10000,
                entropy_trend: Math.round(entropyTrend * 10000) / 10000,
                feature_contradiction: Math.round(featureContradiction * 10000) / 10000,
                embedding_delta: Math.round(embeddingDelta * 10000) / 10000,
            },
            intent_state: {
                volatility_score: Math.round(intentState.volatility_score * 10000) / 10000,
                drift_rate: Math.round(intentState.drift_rate * 10000) / 10000,
                core_goal_embedding: intentState.core_goal_embedding,
            },
            continuity_state: continuityState,
            is_looping: isLooping,
            loop_consecutive: this.loopCount,
            loop_intervention_level: loopLevel,
            pivot_detected: pivotDetected,
            pivot_score: Math.round(pivotScore * 10000) / 10000,
            outcome: lastEntry.outcome || null,
            n_interactions: n,
        };
    }
    calcActionConsistency() {
        if (this.history.length < 2)
            return 1.0;
        const recent = this.history.slice(-5).map(e => e.action);
        const counts = {};
        for (const a of recent) {
            counts[a] = (counts[a] || 0) + 1;
        }
        let mostCommonCount = 0;
        for (const count of Object.values(counts)) {
            if (count > mostCommonCount)
                mostCommonCount = count;
        }
        return mostCommonCount / recent.length;
    }
    calcEntropyTrend() {
        if (this.history.length < 2)
            return 0.0;
        const entropies = this.history.slice(-5).map(e => e.entropy);
        if (entropies.length < 2)
            return 0.0;
        return linearTrend(entropies);
    }
    calcFeatureContradiction() {
        if (this.history.length < 2)
            return 0.0;
        const current = this.history[this.history.length - 1].features;
        const prev = this.history[this.history.length - 2].features;
        let contradictionCount = 0;
        for (const key of Object.keys(current)) {
            if (key in prev) {
                const delta = Math.abs(current[key] - prev[key]);
                if (delta > 0.2) {
                    contradictionCount++;
                }
            }
        }
        return Math.min(1.0, contradictionCount / 6.0);
    }
    calcEmbeddingDelta() {
        if (this.history.length < 2)
            return 0.0;
        const embPrev = this.history[this.history.length - 2].embedding;
        const embCurr = this.history[this.history.length - 1].embedding;
        if (!embPrev || !embCurr)
            return 0.0;
        const similarity = cosineSimilarity(embPrev, embCurr);
        return 1.0 - similarity;
    }
    detectLoop(k = 3, threshold = 0.6) {
        const effectiveThreshold = this.calibratedWeights?.loopJaccard ?? threshold;
        const effectiveK = this.calibratedWeights?.loopK ?? k;
        if (this.history.length < effectiveK + 1)
            return false;
        const currWords = new Set(this.history[this.history.length - 1].text.toLowerCase().split(/\s+/));
        const pastWords = new Set(this.history[this.history.length - (effectiveK + 1)].text.toLowerCase().split(/\s+/));
        if (currWords.size === 0 || pastWords.size === 0)
            return false;
        const intersection = new Set([...currWords].filter(w => pastWords.has(w)));
        const union = new Set([...currWords, ...pastWords]);
        const jaccard = intersection.size / Math.max(union.size, 1);
        const infoGain = this.history[this.history.length - 1].entropy < this.history[this.history.length - (k + 1)].entropy;
        return jaccard > effectiveThreshold && !infoGain;
    }
    isExploring(contradiction, entropyTrend, _actionConsistency = 0.0) {
        const ec = this.calibratedWeights?.exploringContradiction ?? 0.2;
        const ee = this.calibratedWeights?.exploringEntropyTrend ?? 0.005;
        return contradiction > ec || entropyTrend > ee;
    }
    isRefining(contradiction, delta, actionConsistency = 0.0, entropyTrend = 0.0) {
        return contradiction < 0.2 && delta < 0.3 && actionConsistency > 0.3 && entropyTrend > -0.01;
    }
    isConverging(consistency, delta, entropyTrend) {
        return consistency >= 0.5 && delta < 0.2 && entropyTrend < 0;
    }
    isClosed(consistency, delta, contradiction) {
        if (this.history.length === 0)
            return false;
        const lastAction = this.history[this.history.length - 1].action;
        const lastEntropy = this.history[this.history.length - 1].entropy;
        const ccThreshold = this.calibratedWeights?.closureConfidence ?? 0.7;
        const cd = this.calibratedWeights?.closedDelta ?? 0.1;
        const cc = this.calibratedWeights?.closedContradiction ?? 0.1;
        const ce = this.calibratedWeights?.closedEntropy ?? 0.5;
        return (consistency > ccThreshold &&
            delta < cd &&
            contradiction < cc &&
            ["act", "commit"].includes(lastAction) &&
            lastEntropy < ce);
    }
    isDivergent(entropyTrend, contradiction, actionConsistency) {
        const de = this.calibratedWeights?.divergentEntropyTrend ?? 0.03;
        const dc = this.calibratedWeights?.divergentContradiction ?? 0.3;
        return entropyTrend > de && (contradiction > dc || actionConsistency < 0.3);
    }
    computeIntentState() {
        if (this.history.length < 2) {
            return { volatility_score: 0.0, drift_rate: 0.0, core_goal_embedding: null };
        }
        const actionIndices = { observe: 0, defer: 1, explore: 2, act: 3, commit: 4, change: 5 };
        const actions = this.history.slice(-5).map(e => e.action);
        const indices = actions.map(a => actionIndices[a] ?? 2);
        const actionVar = variance(indices) / 6.0;
        const embs = this.history.slice(-5).map(e => e.embedding).filter((e) => e !== null);
        let embVar = 0.0;
        if (embs.length >= 3) {
            const embMean = embs[0].map((_, i) => embs.reduce((sum, e) => sum + e[i], 0) / embs.length);
            embVar = embs.reduce((sum, e) => sum + euclideanDistance(e, embMean), 0) / embs.length;
        }
        const volatility = Math.min(1.0, actionVar * 0.6 + embVar * 0.4);
        let drift = 0.0;
        if (embs.length >= 4) {
            const mid = Math.floor(embs.length / 2);
            const firstHalf = embs.slice(0, mid);
            const secondHalf = embs.slice(mid);
            const firstMean = firstHalf[0].map((_, i) => firstHalf.reduce((sum, e) => sum + e[i], 0) / firstHalf.length);
            const secondMean = secondHalf[0].map((_, i) => secondHalf.reduce((sum, e) => sum + e[i], 0) / secondHalf.length);
            drift = 1.0 - cosineSimilarity(firstMean, secondMean);
        }
        const coreGoal = embs.length > 0
            ? embs[0].map((_, i) => embs.reduce((sum, e) => sum + e[i], 0) / embs.length)
            : null;
        return {
            volatility_score: Math.round(volatility * 10000) / 10000,
            drift_rate: Math.round(drift * 10000) / 10000,
            core_goal_embedding: coreGoal ? coreGoal.map(v => Math.round(v * 10000) / 10000) : null,
        };
    }
    continuityState(intentState) {
        const drift = intentState.drift_rate;
        const volatility = intentState.volatility_score;
        if (drift < 0.15 && volatility < 0.3)
            return "HIGH";
        if (drift > 0.4 || volatility > 0.6)
            return "LOW";
        return "MEDIUM";
    }
    static detectOverconfident(diagnostics) {
        const confidence = diagnostics.confidence ?? 0.5;
        const entropy = diagnostics.entropy ?? 1.0;
        return confidence > 0.7 && entropy > 1.5;
    }
    calcMomentum(entropyTrend, actionConsistency, embeddingDelta, isLooping = false, action = "", entropy = 0.0) {
        if (isLooping)
            return -1.0;
        const w = this.calibratedWeights?.momentum || [-0.3, 0.5, 0.2];
        const entropyComponent = entropyTrend * w[0];
        const consistencyComponent = actionConsistency * w[1];
        const deltaComponent = (1.0 - Math.min(1.0, embeddingDelta)) * w[2];
        let momentum = entropyComponent + consistencyComponent + deltaComponent;
        if (["commit", "change"].includes(action) && entropy > 0.8) {
            momentum -= 0.05;
        }
        else if (["observe", "defer"].includes(action) && entropy < 0.5) {
            momentum += 0.05;
        }
        return Math.max(-1.0, Math.min(1.0, momentum));
    }
    reset() {
        this.history = [];
        this.loopCount = 0;
        this.pivotHistory = [];
        this.outcomeHistory = [];
    }
    recordOutcome(outcome) {
        const entry = this.history[this.history.length - 1];
        if (entry) {
            entry.outcome = outcome;
            this.outcomeHistory.push({
                turn: this.history.length,
                outcome,
                timestamp: Date.now() / 1000,
            });
        }
    }
    getLoopIntervention() {
        const state = this.snapshot();
        if (!state.is_looping)
            return null;
        const interventions = {
            gentle: {
                directive: "You may be repeating yourself — try rephrasing the core question differently or approaching from a new angle.",
                resetSuggested: false,
            },
            suggestive: {
                directive: "The conversation is looping. Step back and identify what new information you need. Consider asking a different question or taking a break from this topic.",
                resetSuggested: false,
            },
            assertive: {
                directive: "You are stuck in a loop. The current approach is not productive. PIVOT: list 3 alternative approaches you haven't tried and pick one.",
                resetSuggested: false,
            },
            escalated: {
                directive: "CRITICAL: You have been looping for several turns. STOP the current approach entirely. Either SWITCH to a completely different topic or reset your strategy. Continued looping wastes time and tokens.",
                resetSuggested: true,
            },
        };
        return {
            level: state.loop_intervention_level,
            ...interventions[state.loop_intervention_level] || interventions.gentle,
        };
    }
    getPivotDirective() {
        const state = this.snapshot();
        if (!state.pivot_detected)
            return null;
        return ("PIVOT DETECTED: The conversation has shifted context. " +
            "The previous resolution state may no longer apply. " +
            "Acknowledge the context change and adapt your guidance accordingly. " +
            "If the new topic is entirely unrelated to the project, confirm the scope change before proceeding.");
    }
    setCalibratedWeights(weights) {
        this.calibratedWeights = weights;
    }
    snapshot() {
        return this.computeState();
    }
    getHistory() {
        return [...this.history];
    }
    getOutcomeHistory() {
        return [...this.outcomeHistory];
    }
    serialize() {
        return {
            sessionId: this.sessionId,
            maxHistory: this.maxHistory,
            history: this.history,
            loopCount: this.loopCount,
            pivotHistory: this.pivotHistory,
            outcomeHistory: this.outcomeHistory,
            calibratedWeights: this.calibratedWeights,
        };
    }
    static deserialize(data) {
        const tracker = new ResolutionTracker(data.sessionId, data.maxHistory);
        tracker.history = data.history || [];
        tracker.loopCount = data.loopCount || 0;
        tracker.pivotHistory = data.pivotHistory || [];
        tracker.outcomeHistory = data.outcomeHistory || [];
        tracker.calibratedWeights = data.calibratedWeights || null;
        return tracker;
    }
    static extractFeatures(text) {
        if (!text || typeof text !== "string")
            return {};
        const len = text.length;
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const wordCount = words.length;
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        const sentenceCount = sentences.length;
        const avgWordLen = wordCount > 0 ? words.reduce((s, w) => s + w.length, 0) / wordCount : 0;
        const questions = (text.match(/\?/g) || []).length;
        const questionRatio = sentenceCount > 0 ? questions / sentenceCount : 0;
        const codeBlocks = (text.match(/```/g) || []).length / 2;
        const urgency = /urgent|asap|immediately|critical|broken|failing|crash|error|bug/i.test(text) ? 1.0 : 0.0;
        const repetition = wordCount > 5
            ? (text.toLowerCase().match(/(\b\w+\b).*?\1/g) || []).length / wordCount
            : 0;
        const sentimentInds = /thanks|great|perfect|awesome/i.test(text) ? 0.2
            : /frustrat|annoy|not working|doesn't work|stupid|useless/i.test(text) ? 0.8
                : 0.5;
        const complexity = /complex|difficult|hard|confusing|trick|subtle|nuance/i.test(text) ? 1.0 : 0.0;
        const instructionDensity = /do not|must|should|always|never|critical/i.test(text) ? 1.0
            : /please|could you|maybe|perhaps/i.test(text) ? 0.3
                : 0.6;
        return {
            length: Math.min(1.0, len / 5000),
            word_count: Math.min(1.0, wordCount / 500),
            sentence_count: Math.min(1.0, sentenceCount / 50),
            avg_word_length: Math.min(1.0, avgWordLen / 10),
            question_ratio: Math.min(1.0, questionRatio),
            code_blocks: Math.min(1.0, codeBlocks / 5),
            urgency,
            repetition: Math.min(1.0, repetition * 10),
            sentiment: sentimentInds,
            complexity,
            instruction_density: instructionDensity,
        };
    }
}
// ── Math Helpers ───────────────────────────────────────────────────────────
function linearTrend(values) {
    const n = values.length;
    if (n < 2)
        return 0.0;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
        const xi = i - xMean;
        numerator += xi * (values[i] - yMean);
        denominator += xi * xi;
    }
    return denominator === 0 ? 0.0 : numerator / denominator;
}
function cosineSimilarity(a, b) {
    if (a.length !== b.length || a.length === 0)
        return 0.0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0.0 : dot / denom;
}
function euclideanDistance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        sum += diff * diff;
    }
    return Math.sqrt(sum);
}
function variance(values) {
    if (values.length === 0)
        return 0.0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / values.length;
}
