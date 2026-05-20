// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// Blackbox — theWay decision core ported to TypeScript.
// Barrel export for all blackbox modules.

export {
  buildAdvice,
  buildDecisionBlock,
  computeModality,
  humanReadableAction,
  compressMetrics,
  compressUncertainty,
  compressEntropy,
  enforceClosure,
  stabilityScore,
  shouldUseFastPath,
  buildCautionNote,
  scoreUsefulness,
  getFallbackPlan,
  getActionSuggestion,
  getCuriosityPrompt,
} from "./advice-layer.js"

export type {
  ResolutionState as AdviceResolutionState,
  Diagnostics,
  DecisionBlock,
  AdviceOutput,
  UsefulnessScore,
} from "./advice-layer.js"

export {
  classifySituation,
  getActions,
  recommendAction,
  getSituationTypes,
} from "./taxonomy.js"

export type {
  ActionCategory,
  ExposureLevel as TaxonomyExposureLevel,
  DecisionState,
} from "./taxonomy.js"

export { ResolutionTracker } from "./resolution-tracker.js"

export type {
  ResolutionEntry,
  ResolutionState as TrackerResolutionState,
} from "./resolution-tracker.js"

export { ExposureModel } from "./exposure-model.js"

export type {
  ExposureLevel as ModelExposureLevel,
  ExposureGuidance,
} from "./exposure-model.js"

export {
  ACTION_TARGET,
  ACTION_TYPE,
  FALLBACK_PLANS,
  ACTION_SUGGESTIONS,
  CURIOSITY_PROMPTS,
} from "./crew-constants.js"

export {
  computeControlVector,
  buildControlHistoryEntry,
  REGIME_CONTROL_TABLE,
} from "./meta-controller.js"

export type {
  ControlVector,
} from "./meta-controller.js"
