// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// Exposure Model — inverse uncertainty mapping with guidance dict.
// Ported from theWay: src/decision/exposure.py

export type ExposureLevel = {
  total: number
}

export type ExposureGuidance = {
  level: string
  message: string
  suggestion: string
  caution: string | null
}

export class ExposureModel {
  computeExposure(uncertaintyTotal: number): ExposureLevel {
    const total = Math.max(0, Math.min(100, 100 - uncertaintyTotal))
    return { total }
  }

  getExposureGuidance(exposure: ExposureLevel): ExposureGuidance {
    if (exposure.total >= 75) {
      return {
        level: "high",
        message: "High engagement recommended.",
        suggestion: "Commit fully.",
        caution: null,
      }
    }
    if (exposure.total >= 50) {
      return {
        level: "moderate_high",
        message: "Good engagement possible.",
        suggestion: "Move forward while staying adaptable.",
        caution: "Keep some flexibility.",
      }
    }
    if (exposure.total >= 30) {
      return {
        level: "moderate_low",
        message: "Limited engagement recommended.",
        suggestion: "Take small steps.",
        caution: "Avoid over-committing.",
      }
    }
    return {
      level: "low",
      message: "Minimal engagement recommended.",
      suggestion: "Hold back.",
      caution: "Acting now carries high risk.",
    }
  }
}
