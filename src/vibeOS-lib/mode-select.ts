// SPDX-License-Identifier: MIT
// Pure mode-selection helper extracted from cascade.ts to break the
// cascade <-> blackbox/vibemax import cycle. This module has NO imports on
// purpose: both src/lib (cascade.ts) and src/vibeOS-lib (blackbox/vibemax.ts)
// depend down on it, keeping the layer graph acyclic.

export type OptimizationMode =
  | "balanced"
  | "budget"
  | "quality"
  | "speed"
  | "longrun"
  | "auto"
  | "forensic"
  | "audit"
  | "vibeultrax"
  | "vibeqmax"
  | "vibemax"
  | "vibelitex"

export const QUALITY_STRESS_THRESHOLD = 1.5

export const AUTO_MODE_BY_REGIME: Record<string, OptimizationMode> = {
  AUDIT: "audit",
  FORENSIC: "forensic",
  LOOPING: "quality",
  CONVERGING: "quality",
  CLOSED: "quality",
  IMPLEMENTING: "quality",
  RESEARCH: "longrun",
  DESIGNING: "longrun",
  REVIEWING: "audit",
}

export function autoSelectMode(subRegime: string, stressMultiplier?: number): OptimizationMode {
  const regime = String(subRegime || "INIT").toUpperCase()
  const stress = Number(stressMultiplier ?? 0)
  if (AUTO_MODE_BY_REGIME[regime]) return AUTO_MODE_BY_REGIME[regime]
  if (stress > QUALITY_STRESS_THRESHOLD) return "quality"
  return "quality"
}
