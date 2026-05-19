// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// Resolution Tracker — state-of-progress estimator for dialogue trajectory.
// Ported from theWay: src/decision/resolution_tracker.py

export type ResolutionEntry = {
  text: string
  features: Record<string, number>
  action: string
  entropy: number
  uncertainty: number
  embedding: number[] | null
  timestamp: number
}

export type ResolutionState = {
  sub_regime: string
  resolution: string
  momentum: number
  signals: {
    action_consistency: number
    entropy_trend: number
    feature_contradiction: number
    embedding_delta: number
  }
  intent_state: {
    volatility_score: number
    drift_rate: number
    core_goal_embedding: number[] | null
  }
  continuity_state: string
  is_looping: boolean
  n_interactions: number
}

export class ResolutionTracker {
  static SUB_REGIMES = ["INIT", "DIVERGENT", "EXPLORING", "REFINING", "CONVERGING", "CLOSED", "LOOPING"] as const

  private sessionId: string
  private maxHistory: number
  private history: ResolutionEntry[]

  constructor(sessionId: string, maxHistory: number = 10) {
    this.sessionId = sessionId
    this.maxHistory = maxHistory
    this.history = []
  }

  update(
    userText: string,
    features: Record<string, number>,
    action: string,
    entropy: number,
    uncertainty: number,
    embedding: number[] | null = null,
  ): ResolutionState {
    const entry: ResolutionEntry = {
      text: userText,
      features: { ...features },
      action,
      entropy,
      uncertainty,
      embedding: embedding ? [...embedding] : null,
      timestamp: Date.now() / 1000,
    }
    this.history.push(entry)

    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }

    return this.computeState()
  }

  private computeState(): ResolutionState {
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
        n_interactions: 0,
      }
    }

    const actionConsistency = this.calcActionConsistency()
    const entropyTrend = this.calcEntropyTrend()
    const featureContradiction = this.calcFeatureContradiction()
    const embeddingDelta = this.calcEmbeddingDelta()
    const isLooping = this.detectLoop()

    const intentState = this.computeIntentState()
    const continuityState = this.continuityState(intentState)

    let subRegime: string
    if (n === 1) {
      subRegime = "INIT"
    } else if (isLooping) {
      subRegime = "LOOPING"
    } else if (this.isClosed(actionConsistency, embeddingDelta, featureContradiction)) {
      subRegime = "CLOSED"
    } else if (this.isDivergent(entropyTrend, featureContradiction, actionConsistency)) {
      subRegime = "DIVERGENT"
    } else if (this.isExploring(featureContradiction, entropyTrend, actionConsistency)) {
      subRegime = "EXPLORING"
    } else if (this.isRefining(featureContradiction, embeddingDelta, actionConsistency, entropyTrend)) {
      subRegime = "REFINING"
    } else if (this.isConverging(actionConsistency, embeddingDelta, entropyTrend)) {
      subRegime = "CONVERGING"
    } else {
      subRegime = "EXPLORING"
    }

    let resolution: string
    if (isLooping) {
      resolution = "looping"
    } else if (subRegime === "CLOSED") {
      resolution = "solved"
    } else if (subRegime === "CONVERGING" && actionConsistency > 0.5) {
      resolution = "converging"
    } else {
      resolution = "unresolved"
    }

    const lastEntry = this.history[this.history.length - 1]
    const momentum = this.calcMomentum(
      entropyTrend,
      actionConsistency,
      embeddingDelta,
      isLooping,
      lastEntry.action,
      lastEntry.entropy,
    )

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
      n_interactions: n,
    }
  }

  private calcActionConsistency(): number {
    if (this.history.length < 2) return 1.0

    const recent = this.history.slice(-5).map(e => e.action)
    const counts: Record<string, number> = {}
    for (const a of recent) {
      counts[a] = (counts[a] || 0) + 1
    }

    let mostCommonCount = 0
    for (const count of Object.values(counts)) {
      if (count > mostCommonCount) mostCommonCount = count
    }

    return mostCommonCount / recent.length
  }

  private calcEntropyTrend(): number {
    if (this.history.length < 2) return 0.0

    const entropies = this.history.slice(-5).map(e => e.entropy)
    if (entropies.length < 2) return 0.0

    return linearTrend(entropies)
  }

  private calcFeatureContradiction(): number {
    if (this.history.length < 2) return 0.0

    const current = this.history[this.history.length - 1].features
    const prev = this.history[this.history.length - 2].features

    let contradictionCount = 0
    for (const key of Object.keys(current)) {
      if (key in prev) {
        const delta = Math.abs(current[key] - prev[key])
        if (delta > 0.2) {
          contradictionCount++
        }
      }
    }

    return Math.min(1.0, contradictionCount / 6.0)
  }

  private calcEmbeddingDelta(): number {
    if (this.history.length < 2) return 0.0

    const embPrev = this.history[this.history.length - 2].embedding
    const embCurr = this.history[this.history.length - 1].embedding

    if (!embPrev || !embCurr) return 0.0

    const similarity = cosineSimilarity(embPrev, embCurr)
    return 1.0 - similarity
  }

  private detectLoop(k: number = 3, threshold: number = 0.6): boolean {
    if (this.history.length < k + 1) return false

    const currWords = new Set(this.history[this.history.length - 1].text.toLowerCase().split(/\s+/))
    const pastWords = new Set(this.history[this.history.length - (k + 1)].text.toLowerCase().split(/\s+/))

    if (currWords.size === 0 || pastWords.size === 0) return false

    const intersection = new Set([...currWords].filter(w => pastWords.has(w)))
    const union = new Set([...currWords, ...pastWords])
    const jaccard = intersection.size / Math.max(union.size, 1)

    const infoGain = this.history[this.history.length - 1].entropy < this.history[this.history.length - (k + 1)].entropy

    return jaccard > threshold && !infoGain
  }

  private isExploring(contradiction: number, entropyTrend: number, _actionConsistency: number = 0.0): boolean {
    return contradiction > 0.2 || entropyTrend > 0.005
  }

  private isRefining(
    contradiction: number,
    delta: number,
    actionConsistency: number = 0.0,
    entropyTrend: number = 0.0,
  ): boolean {
    return contradiction < 0.2 && delta < 0.3 && actionConsistency > 0.3 && entropyTrend > -0.01
  }

  private isConverging(consistency: number, delta: number, entropyTrend: number): boolean {
    return consistency >= 0.5 && delta < 0.2 && entropyTrend < 0
  }

  private isClosed(consistency: number, delta: number, contradiction: number): boolean {
    if (this.history.length === 0) return false

    const lastAction = this.history[this.history.length - 1].action
    const lastEntropy = this.history[this.history.length - 1].entropy

    return (
      consistency > 0.7 &&
      delta < 0.1 &&
      contradiction < 0.1 &&
      ["act", "commit"].includes(lastAction) &&
      lastEntropy < 0.5
    )
  }

  private isDivergent(entropyTrend: number, contradiction: number, actionConsistency: number): boolean {
    return entropyTrend > 0.03 && (contradiction > 0.3 || actionConsistency < 0.3)
  }

  private computeIntentState(): { volatility_score: number; drift_rate: number; core_goal_embedding: number[] | null } {
    if (this.history.length < 2) {
      return { volatility_score: 0.0, drift_rate: 0.0, core_goal_embedding: null }
    }

    const actionIndices: Record<string, number> = { observe: 0, defer: 1, explore: 2, act: 3, commit: 4, change: 5 }
    const actions = this.history.slice(-5).map(e => e.action)
    const indices = actions.map(a => actionIndices[a] ?? 2)
    const actionVar = variance(indices) / 6.0

    const embs = this.history.slice(-5).map(e => e.embedding).filter((e): e is number[] => e !== null)

    let embVar = 0.0
    if (embs.length >= 3) {
      const embMean = embs[0].map((_, i) => embs.reduce((sum, e) => sum + e[i], 0) / embs.length)
      embVar = embs.reduce((sum, e) => sum + euclideanDistance(e, embMean), 0) / embs.length
    }

    const volatility = Math.min(1.0, actionVar * 0.6 + embVar * 0.4)

    let drift = 0.0
    if (embs.length >= 4) {
      const mid = Math.floor(embs.length / 2)
      const firstHalf = embs.slice(0, mid)
      const secondHalf = embs.slice(mid)
      const firstMean = firstHalf[0].map((_, i) => firstHalf.reduce((sum, e) => sum + e[i], 0) / firstHalf.length)
      const secondMean = secondHalf[0].map((_, i) => secondHalf.reduce((sum, e) => sum + e[i], 0) / secondHalf.length)
      drift = 1.0 - cosineSimilarity(firstMean, secondMean)
    }

    const coreGoal = embs.length > 0
      ? embs[0].map((_, i) => embs.reduce((sum, e) => sum + e[i], 0) / embs.length)
      : null

    return {
      volatility_score: Math.round(volatility * 10000) / 10000,
      drift_rate: Math.round(drift * 10000) / 10000,
      core_goal_embedding: coreGoal ? coreGoal.map(v => Math.round(v * 10000) / 10000) : null,
    }
  }

  private continuityState(intentState: { volatility_score: number; drift_rate: number }): string {
    const drift = intentState.drift_rate
    const volatility = intentState.volatility_score

    if (drift < 0.15 && volatility < 0.3) return "HIGH"
    if (drift > 0.4 || volatility > 0.6) return "LOW"
    return "MEDIUM"
  }

  static detectOverconfident(diagnostics: Record<string, number>): boolean {
    const confidence = diagnostics.confidence ?? 0.5
    const entropy = diagnostics.entropy ?? 1.0
    return confidence > 0.7 && entropy > 1.5
  }

  private calcMomentum(
    entropyTrend: number,
    actionConsistency: number,
    embeddingDelta: number,
    isLooping: boolean = false,
    action: string = "",
    entropy: number = 0.0,
  ): number {
    if (isLooping) return -1.0

    const entropyComponent = -entropyTrend * 0.3
    const consistencyComponent = actionConsistency * 0.5
    const deltaComponent = (1.0 - Math.min(1.0, embeddingDelta)) * 0.2

    let momentum = entropyComponent + consistencyComponent + deltaComponent

    if (["commit", "change"].includes(action) && entropy > 0.8) {
      momentum -= 0.05
    } else if (["observe", "defer"].includes(action) && entropy < 0.5) {
      momentum += 0.05
    }

    return Math.max(-1.0, Math.min(1.0, momentum))
  }

  reset(): void {
    this.history = []
  }

  snapshot(): ResolutionState {
    return this.computeState()
  }

  getHistory(): ResolutionEntry[] {
    return [...this.history]
  }

  serialize(): Record<string, any> {
    return {
      sessionId: this.sessionId,
      maxHistory: this.maxHistory,
      history: this.history,
    }
  }

  static deserialize(data: Record<string, any>): ResolutionTracker {
    const tracker = new ResolutionTracker(data.sessionId, data.maxHistory)
    tracker.history = data.history || []
    return tracker
  }
}

// ── Math Helpers ───────────────────────────────────────────────────────────

function linearTrend(values: number[]): number {
  const n = values.length
  if (n < 2) return 0.0

  const xMean = (n - 1) / 2
  const yMean = values.reduce((a, b) => a + b, 0) / n

  let numerator = 0
  let denominator = 0
  for (let i = 0; i < n; i++) {
    const xi = i - xMean
    numerator += xi * (values[i] - yMean)
    denominator += xi * xi
  }

  return denominator === 0 ? 0.0 : numerator / denominator
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0.0

  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0.0 : dot / denom
}

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

function variance(values: number[]): number {
  if (values.length === 0) return 0.0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / values.length
}
