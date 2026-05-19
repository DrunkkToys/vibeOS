// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// Blackbox — theWay decision core ported to TypeScript.
// Barrel export for all blackbox modules.
export { buildAdvice, buildDecisionBlock, computeModality, humanReadableAction, compressMetrics, compressUncertainty, compressEntropy, enforceClosure, stabilityScore, shouldUseFastPath, buildCautionNote, scoreUsefulness, getFallbackPlan, getActionSuggestion, getCuriosityPrompt, } from "./advice-layer.js";
export { classifySituation, getActions, recommendAction, getSituationTypes, } from "./taxonomy.js";
export { ResolutionTracker } from "./resolution-tracker.js";
export { ExposureModel } from "./exposure-model.js";
export { ACTION_TARGET, ACTION_TYPE, FALLBACK_PLANS, ACTION_SUGGESTIONS, CURIOSITY_PROMPTS, } from "./crew-constants.js";
