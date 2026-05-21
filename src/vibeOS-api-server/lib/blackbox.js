import { ResolutionTracker as SharedResolutionTracker } from "./resolution-tracker.js"

const SUB_REGIMES = ["INIT", "DIVERGENT", "EXPLORING", "REFINING", "CONVERGING", "CLOSED", "LOOPING"]

class ResolutionTracker {
  constructor(sessionId, projectId, maxHistory = 50) {
    this._inner = new SharedResolutionTracker(sessionId, maxHistory)
    this.projectId = projectId || null
  }

  update(entry) {
    const userText = entry.userText || ""
    const features = entry.features && typeof entry.features === "object" && !Array.isArray(entry.features)
      ? entry.features
      : {}
    const action = (entry.actions && entry.actions.length > 0) ? entry.actions[0] : (entry.action || "explore")
    const entropy = entry.entropy ?? 1.0
    const uncertainty = entry.uncertainty ?? 50
    const embedding = entry.embedding || null

    return this._inner.update(userText, features, action, entropy, uncertainty, embedding)
  }

  getState() {
    const snap = this._inner.snapshot()
    return {
      sub_regime: snap.sub_regime || "INIT",
      resolution: snap.resolution || "unresolved",
      momentum: snap.momentum || 0,
      signals: snap.signals || {},
      intent_state: snap.intent_state || { volatility_score: 0, drift_rate: 0, core_goal_embedding: null },
      continuity_state: snap.continuity_state || null,
      is_looping: snap.is_looping || false,
      loop_consecutive: snap.loop_consecutive || 0,
      loop_intervention_level: snap.loop_intervention_level || "none",
      pivot_detected: snap.pivot_detected || false,
      pivot_score: snap.pivot_score || 0,
      outcome: snap.outcome || null,
      n_interactions: snap.n_interactions || 0,
      loop_count: snap.is_looping ? snap.loop_consecutive || 1 : 0,
      turn_count: snap.n_interactions || 0,
      history_length: this._inner.getHistory().length,
    }
  }

  recordOutcome(outcome) {
    this._inner.recordOutcome(outcome)
  }

  getLoopIntervention() {
    return this._inner.getLoopIntervention()
  }

  getPivotDirective() {
    return this._inner.getPivotDirective()
  }

  setCalibratedWeights(weights) {
    this._inner.setCalibratedWeights(weights)
  }

  getOutcomeHistory() {
    return this._inner.getOutcomeHistory()
  }

  reset() {
    this._inner.reset()
  }

  serialize() {
    return this._inner.serialize()
  }

  static deserialize(data) {
    const tracker = new ResolutionTracker(data.sessionId)
    tracker._inner = SharedResolutionTracker.deserialize(data)
    return tracker
  }
}

function extractFeatures(text) {
  if (!text || typeof text !== "string") return {}
  const len = text.length
  const words = text.split(/\s+/).filter(w => w.length > 0)
  const wordCount = words.length
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0)
  const sentenceCount = sentences.length
  const avgWordLen = wordCount > 0 ? words.reduce((s, w) => s + w.length, 0) / wordCount : 0
  const questions = (text.match(/\?/g) || []).length
  const questionRatio = sentenceCount > 0 ? questions / sentenceCount : 0
  const codeBlocks = (text.match(/```/g) || []).length / 2
  const urgency = /urgent|asap|immediately|critical|broken|failing|crash|error|bug/i.test(text) ? 1.0 : 0.0
  const repetition = wordCount > 5
    ? (text.toLowerCase().match(/(\b\w+\b).*?\1/g) || []).length / wordCount
    : 0
  const sentimentIndicators = /thanks|great|perfect|awesome/i.test(text) ? 0.2
    : /frustrat|annoy|not working|doesn't work|stupid|useless/i.test(text) ? 0.8
    : 0.5

  return {
    length: Math.min(1.0, len / 5000),
    word_count: Math.min(1.0, wordCount / 500),
    sentence_count: Math.min(1.0, sentenceCount / 50),
    avg_word_length: Math.min(1.0, avgWordLen / 10),
    question_ratio: Math.min(1.0, questionRatio),
    code_blocks: Math.min(1.0, codeBlocks / 5),
    urgency,
    repetition: Math.min(1.0, repetition * 10),
    sentiment: sentimentIndicators,
  }
}

export { ResolutionTracker, SUB_REGIMES, extractFeatures }
