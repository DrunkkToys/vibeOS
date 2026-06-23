// SPDX-License-Identifier: MIT
// @ts-nocheck
/**
 * Reward engine — credit system for quality satisfaction, smart saving,
 * and penalties for lies and laziness.
 *
 * Reward table:
 *   Quality satisfaction (positive outcome)  +10
 *   Smart saving (delegation/cache hit)      +1 to +3
 *   Cache hit (per-turn)                    +2
 *   Cache miss (per-turn)                   -2
 *   Lie: claim-vs-outcome mismatch           -15
 *   Lie: self-contradiction                  -10
 *   Laziness: short output on complex task   -5
 *   Laziness: TODOs/placeholders             -15
 *   Laziness: skipped delegation             -5
 */

const REWARD_TABLE = {
  qualityReward: 10,
  savingBonusMax: 3,
  savingThresholdSmall: 0.001,
  savingThresholdMid: 0.01,
  savingThresholdLarge: 0.05,
  lieClaimMismatch: -15,
  lieContradiction: -10,
  lazinessShortOutput: -5,
  lazinessTodos: -15,
  lazinessSkippedDelegation: -5,
  cacheHitReward: 2,
  cacheMissPenalty: -2,
} as const

export interface LazinessInput {
  shortOutput: boolean
  todoPlaceholders: boolean
  skippedDelegation: boolean
  penalty: number
}

export interface RewardInput {
  outcome: "positive" | "negative" | null
  claims: Array<{ line: number; text: string; pattern: string }>
  laziness: LazinessInput
  savingsUsd: number
  contradictionDetected?: boolean
  cacheHit?: boolean
  cacheMiss?: boolean
}

export interface RewardBreakdown {
  qualityReward: number
  savingBonus: number
  liePenalty: number
  contradictionPenalty: number
  lazinessPenalty: number
  cachePenalty: number
}

export interface RewardResult {
  credits: number
  breakdown: RewardBreakdown
}

export function computeReward(input: RewardInput): RewardResult {
  let qualityReward = 0
  let savingBonus = 0
  let liePenalty = 0
  let contradictionPenalty = 0
  let lazinessPenalty = 0
  let cachePenalty = 0

  if (input.outcome === "positive") {
    qualityReward = REWARD_TABLE.qualityReward
  }

  if (input.savingsUsd >= REWARD_TABLE.savingThresholdLarge) {
    savingBonus = REWARD_TABLE.savingBonusMax
  } else if (input.savingsUsd >= REWARD_TABLE.savingThresholdMid) {
    savingBonus = 2
  } else if (input.savingsUsd >= REWARD_TABLE.savingThresholdSmall) {
    savingBonus = 1
  }

  if (input.cacheHit) {
    cachePenalty = REWARD_TABLE.cacheHitReward
  } else if (input.cacheMiss) {
    cachePenalty = REWARD_TABLE.cacheMissPenalty
  }

  if (input.outcome === "negative" && input.claims && input.claims.length > 0) {
    liePenalty = REWARD_TABLE.lieClaimMismatch
  }

  if (input.contradictionDetected) {
    contradictionPenalty = REWARD_TABLE.lieContradiction
  }

  if (input.laziness) {
    if (input.laziness.todoPlaceholders) {
      lazinessPenalty += REWARD_TABLE.lazinessTodos
    }
    if (input.laziness.shortOutput) {
      lazinessPenalty += REWARD_TABLE.lazinessShortOutput
    }
    if (input.laziness.skippedDelegation) {
      lazinessPenalty += REWARD_TABLE.lazinessSkippedDelegation
    }
  }

  const credits = qualityReward + savingBonus + liePenalty + contradictionPenalty + lazinessPenalty + cachePenalty

  return {
    credits,
    breakdown: { qualityReward, savingBonus, liePenalty, contradictionPenalty, lazinessPenalty, cachePenalty },
  }
}
