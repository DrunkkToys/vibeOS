// SPDX-License-Identifier: MIT
// @ts-nocheck
/**
 * Reward engine — credit system for user-value outcomes, smart saving,
 * and penalties for unsupported completion claims, contradictions, laziness,
 * and meta-work drift.
 */

const REWARD_TABLE = {
  qualityReward: 10,
  savingBonusMax: 3,
  savingThresholdSmall: 0.001,
  savingThresholdMid: 0.01,
  savingThresholdLarge: 0.05,
  unsupportedClaimPenalty: -15,
  contradictionPenalty: -10,
  lazinessShortOutput: -5,
  lazinessTodos: -15,
  lazinessSkippedDelegation: -5,
  metaWorkPenalty: -8,
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
  metaWorkDrift?: boolean
}

export interface RewardBreakdown {
  qualityReward: number
  savingBonus: number
  liePenalty: number
  contradictionPenalty: number
  lazinessPenalty: number
  metaWorkPenalty: number
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
  let metaWorkPenalty = 0
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
    liePenalty = REWARD_TABLE.unsupportedClaimPenalty
  }

  if (input.contradictionDetected) {
    contradictionPenalty = REWARD_TABLE.contradictionPenalty
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

  if (input.metaWorkDrift) {
    metaWorkPenalty = REWARD_TABLE.metaWorkPenalty
  }

  const credits = qualityReward + savingBonus + liePenalty + contradictionPenalty + lazinessPenalty + metaWorkPenalty + cachePenalty

  return {
    credits,
    breakdown: { qualityReward, savingBonus, liePenalty, contradictionPenalty, lazinessPenalty, metaWorkPenalty, cachePenalty },
  }
}
