// SPDX-License-Identifier: MIT
// Compatibility shim for the historical `classifiers` module path.
// The implementations now live in `cascade.ts`.

export {
  detectOutcomeSignal,
  scoreStress,
  estimateContextBudget,
} from "./cascade.js"
