// SPDX-License-Identifier: MIT
// @ts-nocheck
import { getVibeOSHome } from "./state.js"
import {
  evaluateClaimEvidence,
  extractClaimMatches,
  type ClaimEvidenceResult,
  type ClaimMatch,
} from "./session-health.js"

export interface ClaimVerificationResult extends ClaimEvidenceResult {}

export function evaluateClaimVerification({
  text,
  vibeHome = getVibeOSHome(),
  sessionId = "",
  turnId = "",
  now = Date.now(),
  windowMs = 120000,
  userText = "",
  prevAssistantTexts = [],
}: {
  text: string
  vibeHome?: string
  sessionId?: string
  turnId?: string
  now?: number
  windowMs?: number
  userText?: string
  prevAssistantTexts?: string[]
}): ClaimVerificationResult {
  return evaluateClaimEvidence({
    text,
    vibeHome,
    sessionId,
    turnId,
    userText,
    prevAssistantTexts,
    now,
    windowMs,
  })
}

export { extractClaimMatches, type ClaimMatch }

