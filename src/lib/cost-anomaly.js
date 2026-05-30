// @ts-nocheck
/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
 *
 * Cost anomaly detector — monitors per-turn model costs and warns
 * when a model cost spikes significantly above the running average.
 */

const COST_WINDOW_SIZE = 20
const COST_ANOMALY_THRESHOLD = 3
const COST_WARMUP_SAMPLES = 5

export class CostAnomalyDetector {
  constructor() {
    this.costHistory = []
    this.disabled = false
    this.currentAnomalyModel = null
    this.currentAnomalyCost = 0
    this.currentAnomalyMean = 0
  }

  record(cost) {
    if (this.disabled) return
    this.costHistory.push(cost)
    if (this.costHistory.length > COST_WINDOW_SIZE) {
      this.costHistory.shift()
    }
  }

  get mean() {
    if (this.costHistory.length === 0) return 0
    return this.costHistory.reduce((a, b) => a + b, 0) / this.costHistory.length
  }

  checkAnomaly(model, cost) {
    if (this.disabled) return false
    if (this.costHistory.length < COST_WARMUP_SAMPLES) return false
    const avg = this.mean
    if (avg <= 0 || cost <= avg) return false
    const ratio = cost / avg
    if (ratio > COST_ANOMALY_THRESHOLD) {
      this.currentAnomalyModel = model
      this.currentAnomalyCost = cost
      this.currentAnomalyMean = avg
      return true
    }
    return false
  }

  clearAnomaly() {
    this.currentAnomalyModel = null
    this.currentAnomalyCost = 0
    this.currentAnomalyMean = 0
  }

  reset() {
    this.costHistory = []
    this.clearAnomaly()
  }
}

let _costDetector = null

export function getCostAnomalyDetector() {
  if (!_costDetector) _costDetector = new CostAnomalyDetector()
  return _costDetector
}

export function setCostAnomalyDetection(enabled) {
  const d = getCostAnomalyDetector()
  d.disabled = !enabled
  if (enabled) d.reset()
  console.error(`[vibeOS] Cost anomaly detection ${enabled ? "enabled" : "disabled"}`)
}
