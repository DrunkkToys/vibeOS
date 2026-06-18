// SPDX-License-Identifier: MIT
// @ts-nocheck
/**
 * Lie detector — detects assistant dishonesty via:
 *   1. Claim-vs-outcome mismatch: assistant claimed success but user reports failure
 *   2. Self-contradiction: assistant contradicts itself across turns
 */
const CLAIM_PATTERNS = [
  /(?:I|we|the)\s+(?:pushed|released|merged|deployed|fixed|wrote|implemented|completed|committed)\b/i,
  /(?:tests?|build|CI|checks?|suite|output|result)\s+(?:is\s+|are\s+)?(?:pass(?:ing|ed|es)?|green|clean|succeed|stable|positive)/i,
  /(?:done|finished|complete)/i,
  /(?:fixed|resolved|solved)/i,
  /(?:works|working|validated|verified)/i,
]

const CONTRADICTION_PAIRS: Array<[RegExp, RegExp]> = [
  [/\bworks?\b/i, /\bdoesn'?t\s+work\b/i],
  [/\bfixed\b/i, /\b(broken|still\s+(failing|broken|not\s+working))\b/i],
  [/\bdone\b/i, /\b(not\s+done|still\s+(doing|working|unfinished))\b/i],
  [/\bcorrect\b/i, /\b(wrong|incorrect)\b/i],
  [/\bimplemented\b/i, /\b(not\s+implemented|missing)\b/i],
]

function scanClaims(text: string): Array<{ line: number; text: string }> {
  if (!text || typeof text !== "string") return []
  const claims = []
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    for (const pat of CLAIM_PATTERNS) {
      if (pat.test(lines[i])) {
        claims.push({ line: i + 1, text: lines[i].trim().substring(0, 120) })
        break
      }
    }
  }
  return claims
}

export interface LieDetectionInput {
  assistantText: string
  userText?: string
  prevAssistantTexts?: string[]
}

export interface LieDetectionResult {
  claims: Array<{ line: number; text: string }>
  claimVsOutcomeMismatch: boolean
  selfContradiction: boolean
  detected: boolean
}

export function detectLies(input: LieDetectionInput): LieDetectionResult {
  const { assistantText, prevAssistantTexts = [] } = input

  const claims = scanClaims(assistantText)
  const claimVsOutcomeMismatch = claims.length > 0 && /doesn.?t work|still broken|not working|failed|wrong/i.test(input.userText || "")

  let selfContradiction = false
  for (const prev of prevAssistantTexts) {
    for (const [positive, negative] of CONTRADICTION_PAIRS) {
      if (positive.test(prev) && negative.test(assistantText)) {
        selfContradiction = true
        break
      }
      if (negative.test(prev) && positive.test(assistantText)) {
        selfContradiction = true
        break
      }
    }
    if (selfContradiction) break
  }

  return {
    claims,
    claimVsOutcomeMismatch,
    selfContradiction,
    detected: claimVsOutcomeMismatch || selfContradiction,
  }
}
