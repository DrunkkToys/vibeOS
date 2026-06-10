// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// @ts-nocheck
// Local blackbox stub — minimal degraded-mode implementation.
// The full engine runs on the API server; this stub covers offline fallback.
class LocalBlackboxStub {
    history;
    loopCount;
    constructor() {
        this.history = [];
        this.loopCount = 0;
    }
    normalizeText(text) {
        return (text || "")
            .toLowerCase()
            .replace(/[^a-z0-9\s]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }
    getRepeatStreak() {
        if (this.history.length < 2)
            return 0;
        const normalizedLast = this.normalizeText(this.history[this.history.length - 1].text);
        if (!normalizedLast)
            return 0;
        let streak = 1;
        for (let i = this.history.length - 2; i >= 0; i--) {
            const normalized = this.normalizeText(this.history[i].text);
            if (!normalized || normalized !== normalizedLast)
                break;
            streak++;
        }
        return streak;
    }
    extractFeatures(text) {
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
    classifyAction(text) {
        if (/refactor|change|replace|switch|pivot|migrate/i.test(text))
            return "change";
        if (/commit|save|push|merge|release|deploy|finalize/i.test(text))
            return "commit";
        if (/write|create|build|make|add|implement|generate/i.test(text))
            return "act";
        if (/explain|why|how|what|analyze|review|check|find|search|look/i.test(text))
            return "explore";
        if (/show|list|get|read|see|view|display|print/i.test(text))
            return "observe";
        return "explore";
    }
    computeEntropy(features) {
        return Math.min(2.58, 0.5
            + (features.question_ratio || 0) * 0.5
            + (features.complexity || 0) * 0.8
            + (features.repetition || 0) * 0.6
            + (features.instruction_density || 0) * 0.4);
    }
    computeUncertainty(features) {
        return Math.min(100, Math.max(10, 50 + (features.question_ratio || 0) * 40
            - (features.code_blocks || 0) * 10
            + (features.sentiment || 0.5) * 30
            - (features.urgency || 0) * 20));
    }
    update(text) {
        const features = this.extractFeatures(text);
        const action = this.classifyAction(text);
        const entropy = this.computeEntropy(features);
        const uncertainty = this.computeUncertainty(features);
        this.history.push({ text, timestamp: Date.now() / 1000 });
        if (this.history.length > 10)
            this.history.shift();
        const repeatStreak = this.getRepeatStreak();
        const isLooping = repeatStreak >= 2 || this.detectBasicLoop(text);
        if (isLooping)
            this.loopCount++;
        else
            this.loopCount = Math.max(0, this.loopCount - 1);
        return {
            sub_regime: isLooping ? "LOOPING" : "EXPLORING",
            resolution: isLooping ? "looping" : "unresolved",
            momentum: isLooping ? -0.3 : 0.3,
            signals: { action_consistency: 1.0, entropy_trend: 0.0, feature_contradiction: 0.0, embedding_delta: 0.0 },
            intent_state: { volatility_score: 0.0, drift_rate: 0.0, core_goal_embedding: null },
            continuity_state: "MEDIUM",
            is_looping: isLooping,
            loop_consecutive: this.loopCount,
            repeat_streak: repeatStreak,
            loop_intervention_level: repeatStreak >= 3 || this.loopCount >= 3 ? "escalated" : repeatStreak >= 2 || this.loopCount >= 2 ? "assertive" : this.loopCount >= 1 ? "gentle" : "none",
            pivot_detected: false,
            pivot_score: 0.0,
            outcome: null,
            n_interactions: this.history.length,
            features,
            action,
            entropy,
            uncertainty,
        };
    }
    detectBasicLoop(text, threshold = 0.5) {
        if (this.history.length < 3)
            return false;
        const currWords = new Set(this.normalizeText(text).split(/\s+/).filter(w => w.length > 3));
        const pastWords = new Set(this.normalizeText(this.history[this.history.length - 3].text).split(/\s+/).filter(w => w.length > 3));
        if (currWords.size === 0 || pastWords.size === 0)
            return false;
        const intersection = new Set([...currWords].filter(w => pastWords.has(w)));
        const union = new Set([...currWords, ...pastWords]);
        return (intersection.size / Math.max(union.size, 1)) > threshold;
    }
    getLoopIntervention() {
        if (this.loopCount < 1)
            return null;
        const interventions = {
            gentle: { level: "gentle", directive: "You may be repeating the same answer path — stop and restate the core question from a new angle.", resetSuggested: false },
            assertive: { level: "assertive", directive: "You are stuck in a loop. STOP repeating the current answer path and list 3 alternative approaches.", resetSuggested: false },
            escalated: { level: "escalated", directive: "CRITICAL: repeated loop detected. STOP the current approach entirely and SWITCH topics or reset strategy.", resetSuggested: true },
        };
        return this.getRepeatStreak() >= 3 || this.loopCount >= 3 ? interventions.escalated : this.getRepeatStreak() >= 2 || this.loopCount >= 2 ? interventions.assertive : interventions.gentle;
    }
    getPivotDirective() { return null; }
    recordOutcome(_outcome) { }
    serialize() {
        return { history: this.history, loopCount: this.loopCount };
    }
    static deserialize(data) {
        const stub = new LocalBlackboxStub();
        stub.history = data.history || [];
        stub.loopCount = data.loopCount || 0;
        return stub;
    }
    snapshot() { return this.update(""); }
}
export { LocalBlackboxStub };
