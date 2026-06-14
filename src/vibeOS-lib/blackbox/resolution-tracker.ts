// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// @ts-nocheck
// Resolution Tracker — state-of-progress estimator for dialogue trajectory.
// Ported from theWay: src/decision/resolution_tracker.py
export class ResolutionTracker {
  static SUB_REGIMES = ["INIT", "DIVERGENT", "EXPLORING", "REFINING", "IMPLEMENTING", "RESEARCH", "REVIEWING", "DESIGNING", "CONVERGING", "CLOSED", "LOOPING"]
  sessionId
  maxHistory
  history
  loopCount
  pivotHistory
  outcomeHistory
  calibratedWeights
  constructor(sessionId, maxHistory = 10) {
    this.sessionId = sessionId
    this.maxHistory = maxHistory
    this.history = []
    this.loopCount = 0
    this.pivotHistory = []
    this.outcomeHistory = []
    this.calibratedWeights = null
    this.recentMessageLengths = []
  }
  static extractFeatures(text) {
    if (!text || typeof text !== "string")
      return {}
    const len = text.length
    const words = text.split(/\s+/).filter(w => w.length > 0)
    const wordCount = words.length
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0)
    const sentenceCount = sentences.length
    const avgWordLen = wordCount > 0 ? words.reduce((sum, word) => sum + word.length, 0) / wordCount : 0
    const questions = (text.match(/\?/g) || []).length
    const questionRatio = sentenceCount > 0 ? questions / sentenceCount : 0
    const codeBlocks = (text.match(/```/g) || []).length / 2
    const urgency = /urgent|asap|immediately|critical|broken|failing|crash|error|bug/i.test(text) ? 1.0 : 0.0
    const repetition = wordCount > 5
      ? (text.toLowerCase().match(/(\b\w+\b).*?\1/g) || []).length / wordCount
      : 0
    const sentimentInds = /thanks|great|perfect|awesome/i.test(text) ? 0.2
      : /frustrat|annoy|not working|doesn't work|stupid|useless/i.test(text) ? 0.8
        : 0.5
    const complexity = /complex|difficult|hard|confusing|trick|subtle|nuance/i.test(text) ? 1.0 : 0.0
    const instructionDensity = /do not|must|should|always|never|critical/i.test(text) ? 1.0
      : /please|could you|maybe|perhaps/i.test(text) ? 0.3
        : 0.6
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
    }
  }
  normalizeText(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }
  normalizeActivity(activity, action, text) {
    const fallbackSignature = this.normalizeText(action || text || "")
    if (!activity) {
      return {
        signature: fallbackSignature || "",
        tool: null,
        target: null,
        action: action || null,
        repeat_count: 1,
        outcome: null,
      }
    }
    if (typeof activity === "string") {
      const sig = this.normalizeText(activity)
      return {
        signature: sig || fallbackSignature || "",
        tool: null,
        target: null,
        action: action || null,
        repeat_count: 1,
        outcome: null,
      }
    }
    const tool = this.normalizeText(activity.tool || activity.toolName || activity.kind || "")
    const target = this.normalizeText(activity.target || activity.filePath || activity.file_path || activity.path || activity.command || "")
    const normalizedAction = this.normalizeText(activity.action || activity.kind || action || "")
    const signature = this.normalizeText(activity.signature || [tool, target, normalizedAction, activity.outcome || ""].filter(Boolean).join(" "))
    return {
      signature: signature || fallbackSignature || "",
      tool: tool || null,
      target: target || null,
      action: normalizedAction || action || null,
      repeat_count: Number(activity.repeat_count || activity.repeatCount || 1) || 1,
      outcome: typeof activity.outcome === "string" ? activity.outcome : (activity.outcome ?? null),
    }
  }
  getRepeatStreak() {
    if (this.history.length < 2)
      return 0
    const lastWords = new Set(this.history[this.history.length - 1].text.toLowerCase().split(/\s+/).filter(w => w.length > 2))
    if (lastWords.size === 0)
      return 0
    let streak = 1
    for (let i = this.history.length - 2; i >= 0; i--) {
      const currWords = new Set(this.history[i].text.toLowerCase().split(/\s+/).filter(w => w.length > 2))
      if (currWords.size === 0) break
      const intersection = new Set([...lastWords].filter(w => currWords.has(w)))
      const union = new Set([...lastWords, ...currWords])
      const jaccard = intersection.size / Math.max(union.size, 1)
      if (jaccard < 0.7) break
      streak++
    }
    return streak
  }
  getActivityRepeatStreak() {
    if (this.history.length < 2)
      return 0
    const normalizedLast = this.normalizeActivity(this.history[this.history.length - 1].activity, this.history[this.history.length - 1].action, this.history[this.history.length - 1].text).signature
    if (!normalizedLast)
      return 0
    let streak = 1
    for (let i = this.history.length - 2; i >= 0; i--) {
      const normalized = this.normalizeActivity(this.history[i].activity, this.history[i].action, this.history[i].text).signature
      if (!normalized || normalized !== normalizedLast)
        break
      streak++
    }
    return streak
  }
  getTargetRepeatStreak() {
    if (this.history.length < 2)
      return 0
    const normalizedLast = this.normalizeActivity(this.history[this.history.length - 1].activity, this.history[this.history.length - 1].action, this.history[this.history.length - 1].text).target
    if (!normalizedLast)
      return 0
    let streak = 1
    for (let i = this.history.length - 2; i >= 0; i--) {
      const normalized = this.normalizeActivity(this.history[i].activity, this.history[i].action, this.history[i].text).target
      if (!normalized || normalized !== normalizedLast)
        break
      streak++
    }
    return streak
  }
  getRecentNegativeOutcomeStreak() {
    if (this.outcomeHistory.length < 1) return 0
    let streak = 0
    for (let i = this.outcomeHistory.length - 1; i >= 0; i--) {
      const o = this.outcomeHistory[i]
      if (/negative|failed|unresolved|loop_detected/i.test(String(o?.outcome || "")))
        streak++
      else break
    }
    return streak
  }
  computeMessageLengthTrend() {
    const lengths = this.recentMessageLengths
    if (lengths.length < 3) return { trend: "stable", slope: 0 }
    const pairs = lengths.slice(-4)
    let decreasingCount = 0
    let totalSlope = 0
    for (let i = 1; i < pairs.length; i++) {
      const diff = pairs[i] - pairs[i - 1]
      if (diff < 0) decreasingCount++
      totalSlope += diff
    }
    const ratio = decreasingCount / (pairs.length - 1)
    const avgSlope = pairs.length > 1 ? totalSlope / (pairs.length - 1) : 0
    return {
      trend: ratio >= 0.6 && avgSlope < 0 ? "shortening" : "stable",
      slope: avgSlope,
    }
  }

  update(userText, features, action, entropy, uncertainty, embedding = null, activity = null) {
    const normalizedActivity = this.normalizeActivity(activity, action, userText)
    const entry = {
      text: userText,
      features: { ...features },
      action,
      entropy,
      uncertainty,
      embedding: embedding ? [...embedding] : null,
      activity: normalizedActivity,
      timestamp: Date.now() / 1000,
    }
    if (this.history.length >= 2) {
      entry.is_pivot = this.detectPivotSignal(entry, this.history[this.history.length - 1])
      if (entry.is_pivot) {
        this.pivotHistory.push(this.history.length)
      }
    }
    this.history.push(entry)
    this.recentMessageLengths.push((userText || "").length)
    if (this.recentMessageLengths.length > 6) this.recentMessageLengths.shift()
    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }
    const state = this.computeState()
    if (state.is_looping) {
      this.loopCount++
      this.history[this.history.length - 1].outcome = this.history[this.history.length - 1].outcome || "loop_detected"
    }
    else if (state.sub_regime !== "LOOPING") {
      this.loopCount = Math.max(0, this.loopCount - 1)
    }
    return state
  }
  detectPivotSignal(current, previous) {
    if (!current.embedding || !previous.embedding) {
      const currWords = new Set((current.text || "").toLowerCase().split(/\s+/).filter(w => w.length > 3))
      const prevWords = new Set((previous.text || "").toLowerCase().split(/\s+/).filter(w => w.length > 3))
      if (currWords.size === 0 || prevWords.size === 0) return false
      const intersection = new Set([...currWords].filter(w => prevWords.has(w)))
      const union = new Set([...currWords, ...prevWords])
      const jaccardSim = intersection.size / Math.max(union.size, 1)
      const instructionChange = Math.abs((current.features?.instruction_density || 0.6) - (previous.features?.instruction_density || 0.6))
      const lengthRatio = previous.text.length > 0
        ? Math.abs(current.text.length - previous.text.length) / previous.text.length
        : 0
      const actionChange = current.action !== previous.action ? 0.3 : 0
      const pivotScore = (1.0 - jaccardSim) * 0.4 + instructionChange * 0.2 + Math.min(lengthRatio, 1.0) * 0.2 + actionChange * 0.2
      return pivotScore > 0.45
    }
    const embeddingDelta = 1.0 - cosineSimilarity(current.embedding, previous.embedding)
    const drift = this.history.length >= 4
      ? this.computeIntentState().drift_rate
      : 0
    const repeatRatio = (current.features?.repetition || 0)
    const instructionChange = Math.abs((current.features?.instruction_density || 0.6) - (previous.features?.instruction_density || 0.6))
    const lengthRatio = previous.text.length > 0
      ? Math.abs(current.text.length - previous.text.length) / previous.text.length
      : 0
    const pivotScore = drift * 0.2 + embeddingDelta * 0.35 + repeatRatio * 0.1 + instructionChange * 0.15 + lengthRatio * 0.2
    return pivotScore > 0.4
  }
  computeState() {
    const n = this.history.length
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
      }
    }
    const actionConsistency = this.calcActionConsistency()
    const entropyTrend = this.calcEntropyTrend()
    const featureContradiction = this.calcFeatureContradiction()
    const embeddingDelta = this.calcEmbeddingDelta()
    const repeatStreak = this.getRepeatStreak()
    const activityRepeatStreak = this.getActivityRepeatStreak()
    const targetRepeatStreak = this.getTargetRepeatStreak()
    const isLooping = this.detectLoop()
    const intentState = this.computeIntentState()
    const continuityState = this.continuityState(intentState)
    let subRegime
    if (n === 1) {
      subRegime = "INIT"
    }
    else if (isLooping) {
      subRegime = "LOOPING"
    }
    else if (this.isClosed(actionConsistency, embeddingDelta, featureContradiction)) {
      subRegime = "CLOSED"
    }
    else if (this.isDivergent(entropyTrend, featureContradiction, actionConsistency)) {
      subRegime = "DIVERGENT"
    }
    else if (this.isExploring(featureContradiction, entropyTrend, actionConsistency)) {
      subRegime = "EXPLORING"
    }
    else if (this.isRefining(featureContradiction, embeddingDelta, actionConsistency, entropyTrend)) {
      subRegime = "REFINING"
    }
    else if (this.isConverging(actionConsistency, embeddingDelta, entropyTrend)) {
      subRegime = "CONVERGING"
    }
    else {
      subRegime = "EXPLORING"
    }
    let resolution
    if (isLooping) {
      resolution = "looping"
    }
    else if (subRegime === "CLOSED") {
      resolution = "solved"
    }
    else if (subRegime === "CONVERGING" && actionConsistency > 0.5) {
      resolution = "converging"
    }
    else {
      resolution = "unresolved"
    }
    const lastEntry = this.history[this.history.length - 1]
    const momentum = this.calcMomentum(entropyTrend, actionConsistency, embeddingDelta, isLooping, lastEntry.action, lastEntry.entropy)
    let loopLevel = "none"
    if (isLooping) {
      const repeatSignal = Math.max(repeatStreak, activityRepeatStreak, targetRepeatStreak)
      if (repeatSignal >= 3 || this.loopCount >= 4)
        loopLevel = "escalated"
      else if (repeatSignal >= 2 || this.loopCount >= 3)
        loopLevel = "assertive"
      else if (this.loopCount >= 2)
        loopLevel = "suggestive"
      else
        loopLevel = "gentle"
    }
    const pivotDetected = lastEntry.is_pivot || false
    const pivotScore = pivotDetected ? 1.0
      : (intentState.drift_rate * 0.6 + (intentState.volatility_score * 0.4))
    return {
      sub_regime: subRegime,
      resolution,
      momentum: Math.round(momentum * 10000) / 10000,
      signals: {
        action_consistency: Math.round(actionConsistency * 10000) / 10000,
        entropy_trend: Math.round(entropyTrend * 10000) / 10000,
        feature_contradiction: Math.round(featureContradiction * 10000) / 10000,
        embedding_delta: Math.round(embeddingDelta * 10000) / 10000,
        activity_repeat_streak: Math.round(activityRepeatStreak * 10000) / 10000,
        target_repeat_streak: Math.round(targetRepeatStreak * 10000) / 10000,
      },
      intent_state: {
        volatility_score: Math.round(intentState.volatility_score * 10000) / 10000,
        drift_rate: Math.round(intentState.drift_rate * 10000) / 10000,
        core_goal_embedding: intentState.core_goal_embedding,
      },
      continuity_state: continuityState,
      is_looping: isLooping,
      loop_consecutive: this.loopCount,
      repeat_streak: repeatStreak,
      activity_repeat_streak: activityRepeatStreak,
      target_repeat_streak: targetRepeatStreak,
      loop_intervention_level: loopLevel,
      pivot_detected: pivotDetected,
      pivot_score: Math.round(pivotScore * 10000) / 10000,
      outcome: lastEntry.outcome || null,
      outcome_negative_streak: this.getRecentNegativeOutcomeStreak(),
      message_length_trend: this.computeMessageLengthTrend().trend,
      message_length_slope: this.computeMessageLengthTrend().slope,
      n_interactions: n,
    }
  }
  calcActionConsistency() {
    if (this.history.length < 2)
      return 1.0
    const recent = this.history.slice(-5).map(e => e.action)
    const counts = {}
    for (const a of recent) {
      counts[a] = (counts[a] || 0) + 1
    }
    let mostCommonCount = 0
    for (const count of Object.values(counts)) {
      if (count > mostCommonCount)
        mostCommonCount = count
    }
    return mostCommonCount / recent.length
  }
  calcEntropyTrend() {
    if (this.history.length < 2)
      return 0.0
    const recent = this.history.slice(-4).map(e => e.entropy || 0)
    if (recent.length < 2)
      return 0.0
    const deltas = []
    for (let i = 1; i < recent.length; i++) {
      deltas.push(recent[i] - recent[i - 1])
    }
    return deltas.reduce((a, b) => a + b, 0) / deltas.length
  }
  calcFeatureContradiction() {
    if (this.history.length < 2)
      return 0.0
    const recent = this.history.slice(-4)
    const values = recent.map(e => e.features?.instruction_density || 0)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((a, b) => a + ((b - mean) ** 2), 0) / values.length
    return Math.min(1.0, Math.sqrt(variance) * 1.5)
  }
  calcEmbeddingDelta() {
    if (this.history.length < 2)
      return 0.0
    const a = this.history[this.history.length - 1].embedding
    const b = this.history[this.history.length - 2].embedding
    if (!a || !b)
      return 0.0
    return 1.0 - cosineSimilarity(a, b)
  }
  detectLoop() {
    const repeatSignal = Math.max(
      this.getRepeatStreak(),
      this.getActivityRepeatStreak(),
      this.getTargetRepeatStreak(),
    )
    const negativeOutcomeStreak = this.getRecentNegativeOutcomeStreak()
    return this.loopCount >= 2 || repeatSignal >= 2 || negativeOutcomeStreak >= 2
  }
  computeIntentState() {
    const last = this.history[this.history.length - 1]
    const prev = this.history[this.history.length - 2]
    const driftRate = prev ? Math.min(1.0, Math.abs((last?.features?.instruction_density || 0.6) - (prev?.features?.instruction_density || 0.6)) * 2) : 0.0
    const volatilityScore = Math.min(1.0, (this.getRepeatStreak() / 5) + driftRate * 0.5)
    return {
      volatility_score: volatilityScore,
      drift_rate: driftRate,
      core_goal_embedding: null,
    }
  }
  continuityState(intentState) {
    if (intentState.volatility_score > 0.7)
      return "LOW"
    if (intentState.volatility_score > 0.35)
      return "MEDIUM"
    return "HIGH"
  }
  isClosed(actionConsistency, embeddingDelta, featureContradiction) {
    return actionConsistency > 0.85 && embeddingDelta < 0.15 && featureContradiction < 0.2
  }
  isDivergent(entropyTrend, featureContradiction, actionConsistency) {
    return entropyTrend > 0.1 && featureContradiction > 0.3 && actionConsistency < 0.75
  }
  isExploring(featureContradiction, entropyTrend, actionConsistency) {
    return featureContradiction > 0.15 && entropyTrend >= -0.05 && actionConsistency < 0.9
  }
  isRefining(featureContradiction, embeddingDelta, actionConsistency, entropyTrend) {
    return actionConsistency > 0.55 && actionConsistency < 0.95 && embeddingDelta < 0.35 && featureContradiction < 0.45 && entropyTrend <= 0.2
  }
  isConverging(actionConsistency, embeddingDelta, entropyTrend) {
    return actionConsistency > 0.7 && embeddingDelta < 0.25 && entropyTrend <= 0.15
  }
  calcMomentum(entropyTrend, actionConsistency, embeddingDelta, isLooping, action, entropy) {
    const base = actionConsistency * 0.4 + (1.0 - Math.min(1.0, embeddingDelta)) * 0.3 + Math.max(0.0, 0.3 - Math.abs(entropyTrend)) * 0.3
    return isLooping ? Math.max(-1.0, base - 0.6) : Math.min(1.0, base + 0.1)
  }
  reset() {
    this.history = []
    this.loopCount = 0
    this.pivotHistory = []
    this.outcomeHistory = []
    this.recentMessageLengths = []
  }
  recordOutcome(outcome) {
    const entry = this.history[this.history.length - 1]
    if (entry) {
      entry.outcome = outcome
      this.outcomeHistory.push({
        turn: this.history.length,
        outcome,
        timestamp: Date.now() / 1000,
      })
    }
  }
  getLoopIntervention() {
    const state = this.snapshot()
    if (!state.is_looping)
      return null
    const interventions = {
      gentle: {
        directive: "You may be repeating the same answer path — stop and restate the core question from a new angle before continuing.",
        resetSuggested: false,
      },
      suggestive: {
        directive: "The conversation is looping. Do not continue the same answer path. Step back, identify what new information is missing, and ask for a different constraint or approach.",
        resetSuggested: false,
      },
      assertive: {
        directive: "You are stuck in a loop. STOP repeating the current answer path. PIVOT: list 3 alternative approaches you have not tried and choose one.",
        resetSuggested: false,
      },
      escalated: {
        directive: "CRITICAL: repeated loop detected. STOP the current approach entirely. Reset the strategy, SWITCH topics or scope, and do not continue the same line of reasoning.",
        resetSuggested: true,
      },
    }
    return {
      level: state.loop_intervention_level,
      ...interventions[state.loop_intervention_level] || interventions.gentle,
    }
  }
  getPivotDirective() {
    const state = this.snapshot()
    if (!state.pivot_detected)
      return null
    return ("PIVOT DETECTED: The conversation has shifted context. " +
            "The previous resolution state may no longer apply. " +
            "Acknowledge the context change and adapt your guidance accordingly. " +
            "If the new topic is entirely unrelated to the project, confirm the scope change before proceeding.")
  }
  setCalibratedWeights(weights) {
    this.calibratedWeights = weights
  }
  snapshot() {
    return this.computeState()
  }
  getHistory() {
    return [...this.history]
  }
  getOutcomeHistory() {
    return [...this.outcomeHistory]
  }
  serialize() {
    return {
      sessionId: this.sessionId,
      maxHistory: this.maxHistory,
      history: this.history,
      loopCount: this.loopCount,
      pivotHistory: this.pivotHistory,
      outcomeHistory: this.outcomeHistory,
      recentMessageLengths: this.recentMessageLengths,
      calibratedWeights: this.calibratedWeights,
    }
  }
  static deserialize(data) {
    const tracker = new ResolutionTracker(data.sessionId || "session", data.maxHistory || 10)
    tracker.history = Array.isArray(data.history) ? data.history.map((entry) => ({
      ...entry,
      activity: entry?.activity || null,
    })) : []
    tracker.loopCount = Number(data.loopCount || 0)
    tracker.pivotHistory = Array.isArray(data.pivotHistory) ? data.pivotHistory : []
    tracker.outcomeHistory = Array.isArray(data.outcomeHistory) ? data.outcomeHistory : []
    tracker.recentMessageLengths = Array.isArray(data.recentMessageLengths) ? data.recentMessageLengths : []
    tracker.calibratedWeights = data.calibratedWeights || null
    return tracker
  }
}
function cosineSimilarity(a, b) {
  const len = Math.min(a.length, b.length)
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0)
    return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
