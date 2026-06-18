// SPDX-License-Identifier: MIT
// @ts-nocheck
/**
 * Laziness detector — identifies low-effort assistant outputs.
 *
 * Signals:
 *   shortOutput     — < 100 chars on non-trivial tasks
 *   todoPlaceholders — contains TODO/FIXME/placeholder/TBD markers
 *   skippedDelegation — brain-tier doing write/edit when should delegate
 */
import type { LazinessInput } from "./reward-engine.js"

const TODO_RE = /\b(TODO|FIXME|PLACEHOLDER|TBD|XXX|lorem ipsum)\b/i
const SHORT_THRESHOLD = 100

export interface LazinessDetectionInput {
  assistantText: string
  userIntent?: string
  toolCallCount?: number
  writeEditCount?: number
  isBrainTier?: boolean
}

export function detectLaziness(input: LazinessDetectionInput): LazinessInput {
  const { assistantText, writeEditCount = 0, isBrainTier = false } = input

  const shortOutput = (assistantText || "").length < SHORT_THRESHOLD
  const todoPlaceholders = TODO_RE.test(assistantText || "")
  const skippedDelegation = isBrainTier && writeEditCount > 0

  let penalty = 0
  if (shortOutput) penalty += 5
  if (todoPlaceholders) penalty += 15
  if (skippedDelegation) penalty += 5

  return { shortOutput, todoPlaceholders, skippedDelegation, penalty }
}
