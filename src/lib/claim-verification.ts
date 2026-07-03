// SPDX-License-Identifier: MIT
// @ts-nocheck
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getVibeOSHome } from "./state.js"

const CLAIM_PATTERNS = [
  /(?:I|we|the)\s+(?:pushed|released|merged|deployed|fixed|wrote|implemented|completed|committed)\b/i,
  /(?:tests?|build|CI|checks?|suite|output|result)\s+(?:is\s+|are\s+)?(?:pass(?:ing|ed|es)?|green|clean|succeed|stable|positive)/i,
  /v\d+\.\d+\.\d+/,
  /\d+\s*(?:test|spec)s?\s*(?:pass|passing)/i,
  /(?:exit\s*code\s*0|0\s*errors|0\s*failures)/i,
]

export interface ClaimMatch {
  line: number
  text: string
  pattern: string
}

export interface ClaimVerificationResult {
  claims: ClaimMatch[]
  unsubstantiatedCount: number
  claimTag: string
}

export function extractClaimMatches(text: string): ClaimMatch[] {
  if (!text || typeof text !== "string") return []
  const claims: ClaimMatch[] = []
  const lines = String(text).split("\n")
  for (let i = 0; i < lines.length; i++) {
    for (const pat of CLAIM_PATTERNS) {
      if (pat.test(lines[i])) {
        claims.push({ line: i + 1, text: lines[i].trim().substring(0, 120), pattern: pat.source })
        break
      }
    }
  }
  return claims
}

function loadRecentCascadeRuns(vibeHome: string) {
  try {
    const cascadeFile = join(vibeHome, "cascade-audit", "cascade-audit.jsonl")
    if (!existsSync(cascadeFile)) return []
    const raw = readFileSync(cascadeFile, "utf-8")
    if (!raw || typeof raw !== "string") return []
    return raw.trim().split("\n").filter(Boolean).slice(-30).map(l => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  } catch {
    return []
  }
}

export function evaluateClaimVerification({
  text,
  vibeHome = getVibeOSHome(),
  sessionId = "",
  turnId = "",
  now = Date.now(),
  windowMs = 120000,
}: {
  text: string
  vibeHome?: string
  sessionId?: string
  turnId?: string
  now?: number
  windowMs?: number
}): ClaimVerificationResult {
  const claims = extractClaimMatches(text)
  if (claims.length === 0) return { claims, unsubstantiatedCount: 0, claimTag: "" }

  const cascadeRuns = loadRecentCascadeRuns(vibeHome)
  const sid = String(sessionId || "").trim()
  const tid = String(turnId || "").trim()
  const substantiated = cascadeRuns.some(cr => {
    const cTs = typeof cr === "object" && cr ? (cr._ts || "") : ""
    if (!cTs || Math.abs(new Date(cTs).getTime() - now) >= windowMs) return false
    if (sid && String(cr.sessionId || "").trim() !== sid) return false
    if (tid) {
      const entryTurnId = String(cr.turnId || "").trim()
      if (!entryTurnId || entryTurnId !== tid) return false
    }
    return cr.executed !== false
  })

  return {
    claims,
    unsubstantiatedCount: substantiated ? 0 : claims.length,
    claimTag: substantiated ? "✓" : `⚠${claims.length} verify`,
  }
}
