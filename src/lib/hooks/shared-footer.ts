// SPDX-License-Identifier: MIT
// Compatibility shim for the historical `hooks/shared-footer` module path.
// Footer formatting helpers now live in `hooks/footer.ts`.

export {
  resolveBrand,
  resolveTierIcon,
  resolveActiveCascadeTier,
  resolveRegimeIcon,
  formatModeLabel,
  formatEnforcementPulse,
  trendGlyph,
  formatSavingsPulse,
  formatCascadePulse,
  formatStressGauge,
  resolveFooterState,
  buildResilientFooterLine,
  buildEnforcementTags,
  buildFooterAlert,
  buildFooterLine,
} from "./footer.js"
