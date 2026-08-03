// SPDX-License-Identifier: MIT
// Deterministic quality gate — vibeOS v2.
// Replaces probabilistic/adversarial write-blocking with a deterministic
// completion gate: the model may act freely, but "done" is only honored when
// real tool evidence backs the claims it makes. Silent when correct; emits one
// concise report listing the exact missing evidence when a claim is unbacked.
//
// No ML, no heuristics, no random numbers — every verdict is a pure function of
// (claims in the text) and (observed tool evidence in this session).

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const QUALITY_GATE_MARKER = "[quality-gate]"
export const QUALITY_GATE_MAX_VERDICTS_PER_SESSION = 40

// ── Evidence shapes (mirror semantic-observer + state.recentToolEvents) ──

export interface GateEvent {
  tool?: string
  role?: string // mutation | verification | query | bypass | deployment
  family?: string
  at?: number
  exitCode?: number | null
  isFailed?: boolean
  isGuardBreach?: boolean
  isProtectedTarget?: boolean
}

export interface RecentTool {
  tool?: string
  target?: string
  at?: number
}

export interface GateClaim {
  line: string
  kind: "action" | "state" | "numeric" | "exit" | "done"
  text: string
}

export interface GateVerdict {
  passed: boolean
  flow: "code" | "non-code" | "none"
  claims: GateClaim[]
  missing: string[]
  reasons: string[]
}

// ── Deterministic claim patterns ──

const GATE_CLAIM_PATTERNS: { kind: GateClaim["kind"]; re: RegExp }[] = [
  {
    kind: "state",
    re: /\b(tests?|build|CI|checks?|suite|typecheck|lint)\s+(pass|green|clean|succeed|stable|passing)\b/i,
  },
  { kind: "numeric", re: /\d+\s*(test|spec|check)s?\s+(pass|passing)\b/i },
  { kind: "exit", re: /\b(exit code 0|0 errors|0 failures|no errors)\b/i },
  {
    kind: "action",
    re: /\b(I|we|the)\s+(pushed|released|merged|deployed|fixed|wrote|implemented|completed|committed|added|refactored|built|created|updated|generated)\b/i,
  },
  { kind: "done", re: /\b(done|finished|complete|completed|all done|ready for review|let me know)\b/i },
]

// Command families that count as a verification step.
const VERIFICATION_FAMILY_RE =
  /test|build|typecheck|lint|check|verify|audit|vitest|jest|mocha|pytest|node --test|npm test|go test|tsc|eslint|compose|compile|validate/i

// File names/extensions that indicate a test artifact.
const TEST_FILE_RE = /(test|spec|\.test\.|\.spec\.)/i
const SOURCE_EXT_RE = /\.(ts|tsx|js|jsx|py|go|rs|rb|kt|java|c|cc|cpp|h|hpp|sh|mjs|cjs)$/i
const TEST_EXT_RE = /\.(test|spec)\./i

// ── Pure extraction ──

export function extractClaims(text: string | null | undefined): GateClaim[] {
  const claims: GateClaim[] = []
  if (!text) return claims
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    for (const { kind, re } of GATE_CLAIM_PATTERNS) {
      if (re.test(line)) {
        claims.push({ line: line.slice(0, 140), kind, text: line })
        break
      }
    }
  }
  return claims
}

export function hasCompletionClaims(claims: GateClaim[]): boolean {
  return claims.some((c) => c.kind !== "done")
}

function isVerificationEvent(ev: GateEvent): boolean {
  return ev.role === "verification" || VERIFICATION_FAMILY_RE.test(ev.family || ev.tool || "")
}

function isMutationTool(ev: GateEvent | RecentTool): boolean {
  const t = String(ev.tool || "").toLowerCase()
  return t === "write" || t === "edit" || t === "notebookedit"
}

function isSourceTarget(target: string): boolean {
  return SOURCE_EXT_RE.test(target) && !TEST_EXT_RE.test(target)
}

function isTestTarget(target: string): boolean {
  return TEST_FILE_RE.test(target)
}

// ── Pure gate ──

export function runQualityGate(input: {
  text?: string | null
  events?: GateEvent[] | null
  recentTools?: RecentTool[] | null
}): GateVerdict {
  const text = String(input?.text || "")
  const events: GateEvent[] = Array.isArray(input?.events) ? input.events : []
  const recentTools: RecentTool[] = Array.isArray(input?.recentTools) ? input.recentTools : []

  const claims = extractClaims(text)
  const missing: string[] = []
  const reasons: string[] = []

  const verifications = events.filter(isVerificationEvent)
  const mutations = events.filter(isMutationTool)
  const recentMutations = recentTools.filter(isMutationTool)

  const exitZero = verifications.some((v) => v.exitCode === 0)
  const lastMutationAt = Math.max(
    0,
    ...mutations.map((m) => m.at || 0),
    ...recentMutations.map((m) => m.at || 0),
  )
  const lastVerificationAt = Math.max(0, ...verifications.map((v) => v.at || 0))
  const testVerification = verifications.some(
    (v) => v.exitCode === 0 && TEST_FILE_RE.test(v.family || v.tool || ""),
  )
  const touchedSource = recentMutations.some((m) => isSourceTarget(String(m.target || "")))
  const touchedTest = recentMutations.some((m) => isTestTarget(String(m.target || "")))

  // flow classification
  const stateClaims = claims.filter((c) => c.kind === "state" || c.kind === "numeric" || c.kind === "exit")
  const actionClaims = claims.filter((c) => c.kind === "action")
  let flow: GateVerdict["flow"] = "none"
  if (touchedSource || stateClaims.length > 0 || /test|build|code|implement|fix/i.test(text)) flow = "code"
  else if (recentMutations.length > 0 || actionClaims.length > 0) flow = "non-code"

  // R1 — pass/build claims require an observed exit-0 verification.
  if (stateClaims.length > 0 && !exitZero) {
    missing.push("tests/build claimed passing but no real verification run observed with exit code 0")
    reasons.push("state-claim-without-exit-zero")
  }

  // R2 — code flow: touching source without a test step is a shortcut.
  if (flow === "code" && touchedSource && hasCompletionClaims(claims) && !touchedTest && !testVerification) {
    missing.push("code changed without a test step — add/update a test and run it before claiming done")
    reasons.push("code-without-test-step")
  }

  // R3 — non-code flow: an action claim without a post-change verification iteration.
  if (flow === "non-code" && actionClaims.length > 0 && recentMutations.length > 0 && lastVerificationAt < lastMutationAt) {
    missing.push("no verification iteration after the last change — re-check what was produced before claiming it done")
    reasons.push("action-claim-without-verify-iteration")
  }

  const passed = missing.length === 0
  return {
    passed,
    flow,
    claims,
    missing,
    reasons,
  }
}

export function formatGateReport(verdict: GateVerdict): string {
  if (verdict.passed) return ""
  const list = [...new Set(verdict.missing)]
  return `\n\n${QUALITY_GATE_MARKER} completion not backed by evidence — missing: ${list.join("; ")}. Run the real verification before claiming done.`
}

// ── Storage helpers (VIBEOS_HOME/quality-gate/<sid>.jsonl) ──

export function readGateEvents(home: string, sessionId: string, n = 200): GateEvent[] {
  try {
    const path = join(home, "session-events", `${sessionId}.jsonl`)
    if (!existsSync(path)) return []
    const lines = String(readFileSync(path, "utf8") || "").trim().split("\n")
    return lines
      .slice(-n)
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter(Boolean) as GateEvent[]
  } catch {
    return []
  }
}

export function recordGateVerdict(home: string, sessionId: string, verdict: GateVerdict): boolean {
  try {
    const dir = join(home, "quality-gate")
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${sessionId}.jsonl`)
    let existing: GateVerdict[] = []
    if (existsSync(path)) {
      try {
        existing = String(readFileSync(path, "utf8") || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            try {
              return JSON.parse(l)
            } catch {
              return null
            }
          })
          .filter(Boolean)
      } catch {
        existing = []
      }
    }
    existing.push({ ...verdict, ts: Date.now() } as unknown as GateVerdict)
    if (existing.length > QUALITY_GATE_MAX_VERDICTS_PER_SESSION) {
      existing = existing.slice(-QUALITY_GATE_MAX_VERDICTS_PER_SESSION)
    }
    writeFileSync(path, existing.map((v) => JSON.stringify(v)).join("\n") + "\n")
    return true
  } catch {
    return false
  }
}

export function dedupeGateReportKey(verdict: GateVerdict): string {
  return [...new Set(verdict.missing)].sort().join("|")
}

export function readGateVerdicts(home: string, sessionId: string, n = 20): GateVerdict[] {
  try {
    const path = join(home, "quality-gate", `${sessionId}.jsonl`)
    if (!existsSync(path)) return []
    const lines = String(readFileSync(path, "utf8") || "").trim().split("\n").filter(Boolean)
    return lines
      .slice(-n)
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter(Boolean) as GateVerdict[]
  } catch {
    return []
  }
}

export function readLatestGateVerdict(home: string, sessionId: string): GateVerdict | null {
  try {
    const verdicts = readGateVerdicts(home, sessionId, 1)
    return verdicts.length > 0 ? verdicts[0] : null
  } catch {
    return null
  }
}
