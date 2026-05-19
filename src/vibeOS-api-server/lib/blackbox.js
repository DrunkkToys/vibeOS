const SUB_REGIMES = ["INIT", "DIVERGENT", "EXPLORING", "REFINING", "CONVERGING", "CLOSED", "LOOPING"]

class ResolutionTracker {
  constructor() {
    this.history = []
    this.state = {
      subRegime: "INIT",
      entropy: 0,
      uncertainty: 100,
      momentum: 0,
      loopCount: 0,
      turnCount: 0,
    }
  }

  update(entry) {
    this.history.push({
      turn: this.state.turnCount++,
      timestamp: Date.now(),
      userText: entry.userText || "",
      features: entry.features || [],
      actions: entry.actions || [],
      entropy: entry.entropy ?? this.state.entropy,
      uncertainty: entry.uncertainty ?? this.state.uncertainty,
      embedding: entry.embedding || null,
    })

    if (this.history.length > 50) {
      this.history = this.history.slice(-40)
    }

    this.state.entropy = this.history[this.history.length - 1].entropy
    this.state.uncertainty = this.history[this.history.length - 1].uncertainty
    this.state.subRegime = this.computeSubRegime()
    this.state.momentum = this.calcMomentum()
    this.state.loopCount = this.detectLoop() ? this.state.loopCount + 1 : 0
  }

  computeSubRegime() {
    if (this.history.length < 2) return "INIT"

    const recent = this.history.slice(-5)
    const isLooping = this.detectLoop()
    if (isLooping) return "LOOPING"

    const entropyTrend = this.calcEntropyTrend()
    const actionConsistency = this.calcActionConsistency()

    if (entropyTrend < -0.1 && actionConsistency > 0.7) return "CONVERGING"
    if (entropyTrend > 0.1 && actionConsistency < 0.3) return "DIVERGENT"
    if (entropyTrend > 0.05) return "EXPLORING"
    if (entropyTrend < -0.05) return "REFINING"
    if (this.state.uncertainty < 20) return "CLOSED"

    return "EXPLORING"
  }

  calcEntropyTrend() {
    if (this.history.length < 3) return 0
    const recent = this.history.slice(-5).map(h => h.entropy)
    return linearTrend(recent)
  }

  calcActionConsistency() {
    if (this.history.length < 2) return 1
    const recent = this.history.slice(-5)
    const actionSets = recent.map(h => new Set(h.actions || []))
    let matches = 0
    let total = 0
    for (let i = 1; i < actionSets.length; i++) {
      const intersection = [...actionSets[i - 1]].filter(a => actionSets[i].has(a))
      const union = new Set([...actionSets[i - 1], ...actionSets[i]])
      if (union.size > 0) {
        matches += intersection.length / union.size
        total++
      }
    }
    return total > 0 ? matches / total : 1
  }

  calcEmbeddingDelta() {
    if (this.history.length < 2) return 0
    const last = this.history[this.history.length - 1]
    const prev = this.history[this.history.length - 2]
    if (!last.embedding || !prev.embedding) return 0
    return euclideanDistance(last.embedding, prev.embedding)
  }

  detectLoop(k = 3) {
    if (this.history.length < k * 2) return false
    const recent = this.history.slice(-k)
    const older = this.history.slice(-(k * 2), -k)

    const recentWords = new Set(recent.flatMap(h => (h.userText || "").toLowerCase().split(/\s+/)).filter(w => w.length > 3))
    const olderWords = new Set(older.flatMap(h => (h.userText || "").toLowerCase().split(/\s+/)).filter(w => w.length > 3))

    if (recentWords.size === 0 || olderWords.size === 0) return false

    const intersection = [...recentWords].filter(w => olderWords.has(w))
    const jaccard = intersection.length / new Set([...recentWords, ...olderWords]).size

    const infoGain = this.calcEntropyTrend()
    return jaccard > 0.6 && infoGain > -0.02
  }

  computeIntentState() {
    const actions = this.history.slice(-10).map(h => h.actions || [])
    const embeddings = this.history.slice(-10).filter(h => h.embedding).map(h => h.embedding)

    const volatility = actions.length > 1 ? variance(actions.map(a => a.length)) : 0
    const driftRate = embeddings.length > 2 ? this.calcEmbeddingDelta() : 0

    return {
      volatility: Math.min(volatility / 10, 1),
      drift_rate: Math.min(driftRate, 1),
      continuity: this.continuityState(volatility, driftRate),
    }
  }

  continuityState(volatility, driftRate) {
    const combined = volatility * 0.4 + driftRate * 0.6
    if (combined < 0.2) return "HIGH"
    if (combined < 0.5) return "MEDIUM"
    return "LOW"
  }

  calcMomentum() {
    const entropyTrend = this.calcEntropyTrend()
    const actionConsistency = this.calcActionConsistency()
    const embeddingDelta = this.calcEmbeddingDelta()

    return (entropyTrend * -0.3) + (actionConsistency * 0.5) + ((1 - Math.min(embeddingDelta, 1)) * 0.2)
  }

  getState() {
    return {
      sub_regime: this.state.subRegime,
      entropy: roundTo(this.state.entropy, 3),
      uncertainty: roundTo(this.state.uncertainty, 1),
      momentum: roundTo(this.state.momentum, 3),
      loop_count: this.state.loopCount,
      turn_count: this.state.turnCount,
      intent_state: this.computeIntentState(),
      history_length: this.history.length,
    }
  }
}

function linearTrend(values) {
  if (values.length < 2) return 0
  const n = values.length
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  for (let i = 0; i < n; i++) {
    sumX += i
    sumY += values[i]
    sumXY += i * values[i]
    sumX2 += i * i
  }
  const denom = n * sumX2 - sumX * sumX
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom
}

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

function euclideanDistance(a, b) {
  if (a.length !== b.length) return Infinity
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum)
}

function variance(values) {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
}

function roundTo(n, d) {
  const m = 10 ** d
  return Math.round(n * m) / m
}

export { ResolutionTracker, SUB_REGIMES, linearTrend, cosineSimilarity, euclideanDistance, variance }
