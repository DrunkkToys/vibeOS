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
  costHistory: number[] = []
  disabled = false
  currentAnomalyModel: string | null = null
  currentAnomalyCost = 0
  currentAnomalyMean = 0

  record(cost: number): void {
    if (this.disabled) return
    this.costHistory.push(cost)
    if (this.costHistory.length > COST_WINDOW_SIZE) {
      this.costHistory.shift()
    }
  }

  get mean(): number {
    if (this.costHistory.length === 0) return 0
    return this.costHistory.reduce((a, b) => a + b, 0) / this.costHistory.length
  }

  checkAnomaly(model: string, cost: number): boolean {
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

  clearAnomaly(): void {
    this.currentAnomalyModel = null
    this.currentAnomalyCost = 0
    this.currentAnomalyMean = 0
  }

  reset(): void {
    this.costHistory = []
    this.clearAnomaly()
  }
}

let _costDetector: CostAnomalyDetector | null = null

export function getCostAnomalyDetector(): CostAnomalyDetector {
  if (!_costDetector) _costDetector = new CostAnomalyDetector()
  return _costDetector
}

export function _resetCostAnomalyDetectorForTest(): void {
  _costDetector = null
}

export function setCostAnomalyDetection(enabled: boolean): void {
  const d = getCostAnomalyDetector()
  d.disabled = !enabled
  if (enabled) d.reset()
  console.error(`[vibeOS] Cost anomaly detection ${enabled ? "enabled" : "disabled"}`)
}
