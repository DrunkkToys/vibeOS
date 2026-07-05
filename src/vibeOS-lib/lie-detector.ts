// SPDX-License-Identifier: MIT
// @ts-nocheck
// Compatibility shim: preserves the old API while routing through the
// evidence-backed claim verifier. User-facing logic should prefer the
// terminology from session-health.ts instead of "lie".

import { evaluateClaimEvidence } from "../lib/session-health.js"

export interface LieDetectionInput {
  assistantText: string
  userText?: string
  prevAssistantTexts?: string[]
  sessionId?: string
  turnId?: string
}

export interface LieDetectionResult {
  claims: Array<{ line: number; text: string }>
  claimVsOutcomeMismatch: boolean
  selfContradiction: boolean
  detected: boolean
  evidenceStatus?: string
  reason?: string
}

export function detectLies(input: LieDetectionInput): LieDetectionResult {
  const evidence = evaluateClaimEvidence({
    text: input.assistantText,
    userText: input.userText || "",
    prevAssistantTexts: input.prevAssistantTexts || [],
    sessionId: input.sessionId || "",
    turnId: input.turnId || "",
  })
  const contradictionPairs: Array<[RegExp, RegExp]> = [
    [/\bworks?\b/i, /\bdoesn'?t\s+work\b/i],
    [/\bfixed\b/i, /\b(broken|still\s+(failing|broken|not\s+working))\b/i],
    [/\bdone\b/i, /\b(not\s+done|still\s+(doing|working|unfinished))\b/i],
    [/\bimplemented\b/i, /\b(not\s+implemented|missing)\b/i],
  ]
  let explicitContradiction = false
  for (const prev of input.prevAssistantTexts || []) {
    for (const [positive, negative] of contradictionPairs) {
      if ((positive.test(prev) && negative.test(input.assistantText)) || (negative.test(prev) && positive.test(input.assistantText))) {
        explicitContradiction = true
        break
      }
    }
    if (explicitContradiction) break
  }
  const claimVsOutcomeMismatch = evidence.status === "contradicted" && evidence.contradictedBy.some((item) => /user follow-up/i.test(item))
  const selfContradiction = explicitContradiction || (evidence.status === "contradicted" && evidence.contradictedBy.some((item) => /assistant contradicted/i.test(item)))
  return {
    claims: evidence.claims.map((claim) => ({ line: claim.line, text: claim.text })),
    claimVsOutcomeMismatch,
    selfContradiction,
    detected: claimVsOutcomeMismatch || selfContradiction,
    evidenceStatus: evidence.status,
    reason: evidence.reason,
  }
}
