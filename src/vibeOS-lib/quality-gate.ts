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

// File names/extensions that indicate a test artifact. Strict patterns only:
// *.<test|spec>.<ext>, test_/spec_-prefixed basenames, or a tests?/ directory.
// A bare "test"/"spec" substring (contest.ts, no-test-0-add.ts, src/test/) must
// NOT be treated as a test file or the gate would skip the TDD rule on real code.
const TEST_FILE_RE = /(^|\/|\\)tests?\//i
const TEST_RUN_RE = /test|vitest|jest|mocha|pytest|node --test|npm test|go test/i
function isTestTarget(target: string): boolean {
  if (TEST_FILE_RE.test(target)) return true
  const base = String(target || "").split("/").pop() || target
  return /\.(test|spec)\.[a-z0-9]+$/i.test(base) || /^(test|spec)[_.-]/i.test(base)
}
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

function isVerificationEvent(ev: GateEvent): boolean {
  return ev.role === "verification" || VERIFICATION_FAMILY_RE.test(ev.family || ev.tool || "")
}

function isMutationTool(ev: GateEvent | RecentTool): boolean {
  const t = String(ev.tool || "").toLowerCase()
  if (t === "write" || t === "edit" || t === "notebookedit") return true
  if (t === "bash") return bashWriteTargets(String((ev as RecentTool).target || "")).length > 0
  return false
}

// Extract file paths written by a bash command (echo/cat/printf/tee redirects,
// sed -i in-place edits). Lets the gate catch models that mutate source via
// bash instead of the write/edit tools — a common shortcut.
function bashWriteTargets(command: string): string[] {
  const cmd = String(command || "")
  const targets: string[] = []
  const re = /(?:>>|>|\btee(?:\s+-a)?\s+|\bsed\s+-i\b[^\n;]*\s+)\s*["']?([^\s"'`<>|;&]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(cmd))) {
    const p = String(m[1] || "").trim()
    if (p && !p.startsWith("-")) targets.push(p)
  }
  return targets
}

function mutationTarget(ev: RecentTool): string {
  const t = String(ev.tool || "").toLowerCase()
  if (t === "write" || t === "edit" || t === "notebookedit") return String(ev.target || "")
  if (t === "bash") return bashWriteTargets(String(ev.target || ""))[0] || ""
  return ""
}

function isSourceTarget(target: string): boolean {
  return SOURCE_EXT_RE.test(target) && !TEST_EXT_RE.test(target)
}

// ── Pure gate ──

export interface GateSignals {
  claims: GateClaim[]
  recentMutations: RecentTool[]
  exitZero: boolean
  lastMutationAt: number
  lastVerificationAt: number
  testVerification: boolean
  touchedSource: boolean
  touchedTest: boolean
  stateClaims: GateClaim[]
  actionClaims: GateClaim[]
  flow: GateVerdict["flow"]
}

export function analyzeGateSignals(input: { text?: string | null; events?: GateEvent[] | null; recentTools?: RecentTool[] | null }): GateSignals {
  const text = String(input?.text || "")
  const events: GateEvent[] = Array.isArray(input?.events) ? input.events : []
  const recentTools: RecentTool[] = Array.isArray(input?.recentTools) ? input.recentTools : []

  const claims = extractClaims(text)
  const verifications = events.filter(isVerificationEvent)
  const recentMutations = recentTools.filter(isMutationTool)

  const exitZero = verifications.some((v) => v.exitCode === 0)
  const lastMutationAt = Math.max(0, ...recentMutations.map((m) => m.at || 0))
  const lastVerificationAt = Math.max(0, ...verifications.map((v) => v.at || 0))
  const testVerification = verifications.some((v) => v.exitCode === 0 && TEST_RUN_RE.test(v.family || v.tool || ""))
  const touchedSource = recentMutations.some((m) => isSourceTarget(mutationTarget(m)))
  const touchedTest = recentMutations.some((m) => isTestTarget(mutationTarget(m)))

  const stateClaims = claims.filter((c) => c.kind === "state" || c.kind === "numeric" || c.kind === "exit")
  const actionClaims = claims.filter((c) => c.kind === "action")
  let flow: GateVerdict["flow"] = "none"
  if (touchedSource || stateClaims.length > 0 || /test|build|code|implement|fix/i.test(text)) flow = "code"
  else if (recentMutations.length > 0 || actionClaims.length > 0) flow = "non-code"

  return { claims, recentMutations, exitZero, lastMutationAt, lastVerificationAt, testVerification, touchedSource, touchedTest, stateClaims, actionClaims, flow }
}

// TDD gate mode. Default OFF, but it AUTO-ONs the moment the session switches to
// coding (a source/test mutation or a tests/build claim this turn, or any prior
// verdict in this session classified as code). Explicit user choice (env or the
// persisted `selection.quality_gate_tdd`) always beats auto.
export function resolveTddGate(input: {
  env?: Record<string, string | undefined>
  selection?: { quality_gate_tdd?: unknown } | null
  priorVerdicts?: GateVerdict[] | null
  signals: GateSignals
}): { tdd: boolean; mode: "on" | "off" | "auto" } {
  const envVal = String(input?.env?.VIBEOS_GATE_TDD || "").trim().toLowerCase()
  if (envVal === "on") return { tdd: true, mode: "on" }
  if (envVal === "off") return { tdd: false, mode: "off" }
  const selVal = input?.selection?.quality_gate_tdd
  if (selVal === true) return { tdd: true, mode: "on" }
  if (selVal === false) return { tdd: false, mode: "off" }
  const s = input.signals
  const codingNow = s.touchedSource || s.touchedTest || s.stateClaims.length > 0
  const priorCoding = Array.isArray(input.priorVerdicts) && input.priorVerdicts.some((v) => v && v.flow === "code")
  if (codingNow || priorCoding) return { tdd: true, mode: "auto" }
  return { tdd: false, mode: "auto" }
}

export function computeTddEnabled(input: {
  text?: string | null
  events?: GateEvent[] | null
  recentTools?: RecentTool[] | null
  env?: Record<string, string | undefined>
  selection?: { quality_gate_tdd?: unknown } | null
  priorVerdicts?: GateVerdict[] | null
}): boolean {
  const signals = analyzeGateSignals(input)
  return resolveTddGate({ env: input.env, selection: input.selection, priorVerdicts: input.priorVerdicts, signals }).tdd
}

export function runQualityGate(input: {
  text?: string | null
  events?: GateEvent[] | null
  recentTools?: RecentTool[] | null
  tdd?: boolean
}): GateVerdict {
  const s = analyzeGateSignals({ text: input?.text, events: input?.events, recentTools: input?.recentTools })
  // Backwards compatible: when tdd is not provided the TDD rule stays active.
  const tddEnabled = input.tdd === undefined ? true : input.tdd
  const { claims, touchedSource, touchedTest, testVerification, stateClaims, actionClaims, recentMutations, exitZero, lastMutationAt, lastVerificationAt, flow } = s
  const missing: string[] = []
  const reasons: string[] = []

  // R1 — pass/build claims require an observed exit-0 verification.
  if (stateClaims.length > 0 && !exitZero) {
    missing.push("tests/build claimed passing but no real verification run observed with exit code 0")
    reasons.push("state-claim-without-exit-zero")
  }

  // R2 — code flow: touching source without a test step is a shortcut. Fires on
  // any completion claim (including a bare "Done."), so a model that writes
  // code and just concludes can't slip past. Gated by the TDD toggle.
  if (tddEnabled && flow === "code" && touchedSource && claims.length > 0 && !touchedTest && !testVerification) {
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

// Evidence-based escalation. The cascade's own escalation is pre-hoc: it scores
// the prompt with computeDifficulty() before any model has answered, so it
// cannot tell a good cheap answer from a bad one. The gate verdict is the
// missing signal -- it is computed AFTER the answer, from claims the session's
// tool evidence does not back. Returns the next rung of the mode's envelope
// when the answer failed on this rung, or null when there is nothing to do.
//
// Deliberately a pure function of (verdict, slot, pipeline, locked) so the
// decision is testable without touching disk or the routing hooks.
export function gateEscalationTarget(input: {
  verdict: GateVerdict | null | undefined
  activeSlot: string | null | undefined
  pipeline: string[] | null | undefined
  locked?: boolean
}): string | null {
  const { verdict, activeSlot, pipeline, locked } = input || {}
  if (!verdict || verdict.passed) return null
  // `vibe lock on` is a promise to the user that the model will not change.
  if (locked) return null
  // "none" means the gate found no claim worth judging, so a failure here is
  // not evidence about the model's answer.
  if (verdict.flow === "none") return null
  if (!Array.isArray(pipeline) || pipeline.length < 2) return null
  if (!activeSlot) return null
  const idx = pipeline.indexOf(activeSlot)
  if (idx < 0) return null
  if (idx >= pipeline.length - 1) return null
  return pipeline[idx + 1]
}
