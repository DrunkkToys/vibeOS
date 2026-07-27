// SPDX-License-Identifier: MIT
// @ts-nocheck
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

import { getCurrentSessionId, getVibeOSHome } from "./state.js"
import { loadTurnTruth } from "./turn-ledger.js"
import { appendJsonlWithRotation } from "../utils/fs-helpers.js"

export type SessionHealthRisk = "low" | "moderate" | "high"
export type ClaimEvidenceStatus = "supported" | "unsupported" | "contradicted" | "not_applicable"
export type MetaWorkSignalKind =
  | "status_loop"
  | "audit_loop"
  | "mode_churn"
  | "cascade_confirmation_loop"
  | "subagent_churn"
  | "high_burn_low_change"
  | "verification_gap"
  | "inspection_loop"

export interface ClaimMatch {
  line: number
  text: string
  pattern: string
}

export interface ClaimEvidenceResult {
  status: ClaimEvidenceStatus
  claims: ClaimMatch[]
  matchedEvidence: string[]
  missingEvidence: string[]
  contradictedBy: string[]
  reason: string
  claimTag: string
  unsubstantiatedCount: number
}

export interface SessionHealthSignal {
  kind: MetaWorkSignalKind
  score: number
  summary: string
}

export interface SessionHealthSnapshot {
  sessionId: string
  projectFingerprint: string
  updatedAt: string
  risk: SessionHealthRisk
  score: number
  decisiveProgress: boolean
  loopSignals: SessionHealthSignal[]
  recommendedAction: string
  metaWorkDrift: boolean
  stopDoing?: string
  implementationRatio: number
  inspectionRatio: number
  claimEvidence: ClaimEvidenceResult
}

const CLAIM_PATTERNS = [
  /(?:I|we|the)\s+(?:pushed|released|merged|deployed|fixed|wrote|implemented|completed|committed)\b/i,
  /(?:tests?|build|CI|checks?|suite|output|result)\s+(?:is\s+|are\s+)?(?:pass(?:ing|ed|es)?|green|clean|succeed|stable|positive)/i,
  /(?:done|finished|complete)/i,
  /(?:fixed|resolved|solved)/i,
  /(?:works|working|validated|verified)/i,
  /(?:exit\s*code\s*0|0\s*errors|0\s*failures)/i,
]

const META_WORK_PATTERNS: Array<{ kind: MetaWorkSignalKind; re: RegExp; summary: string }> = [
  { kind: "status_loop", re: /\b(status|signals|report|check live state|full status|verify state)\b/i, summary: "Repeated status/report work instead of task progress." },
  { kind: "audit_loop", re: /\b(audit|forensic|deep state|runtime state|inspection|diagnostic)\b/i, summary: "Repeated audit work without moving the task forward." },
  { kind: "mode_churn", re: /\b(mode|slot|vibeultrax|cheap|medium|brain)\b/i, summary: "Repeated mode/slot switching or confirmation." },
  { kind: "cascade_confirmation_loop", re: /\b(cascade|delegation|route_path|requires_delegation)\b/i, summary: "Repeated cascade/delegation confirmation without a new outcome." },
  { kind: "verification_gap", re: /\b(fixed|done|working|validated|verified)\b/i, summary: "Completion language appears without strong verification evidence." },
]

const DIAGNOSTIC_REQUEST_RE = /\b(status|signals|report|audit|diagnos|inspect|forensic|dashboard|mode|cascade|runtime state|reality[- ]check)\b/i
const VERIFICATION_TOOL_RE = /\b(test|build|typecheck|lint|ci|verify|check)\b/i
const IMPLEMENTATION_TOOLS = new Set(["write", "edit", "multiedit", "notebookedit"])
const INSPECTION_TOOLS = new Set(["read", "bash", "grep", "glob", "skill", "vibe", "report-list", "report-read", "report-save", "webfetch"])

function getOpenCodeDbPath(): string {
  return process.env.OPENCODE_DB_PATH || join(homedir(), ".local", "share", "opencode", "opencode.db")
}

function sqlString(value: string): string {
  return `'${String(value || "").replace(/'/g, "''")}'`
}

function runSqlJson(query: string): any[] {
  const db = getOpenCodeDbPath()
  if (!existsSync(db)) return []
  try {
    const raw = execFileSync("sqlite3", ["-json", db, query], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Live-reproduced: `vibe rebuild` seeds its model-discovery provider from
// opencode.json's static agent.build.model / top-level model fields -- both
// were completely empty on a real dev machine (the live model is chosen
// entirely at runtime via the chat dropdown, never written to that static
// config), so rebuild fell back to an in-memory currentModel cache that is
// empty until a real chat turn has run. Rebuilding as the very first message
// of a session therefore had no live-model context at all and silently fell
// through to whichever provider happened to be first in the discovered
// models list (openrouter, unrelated to the deepseek models actually
// reachable and in use) -- and those candidates then failed their reachability
// probes. This queries OpenCode's own session DB for the most recently used
// real provider/model, the same authoritative source getSessionDbFacts uses,
// so rebuild can seed its provider from what is ACTUALLY running.
export function getLiveOpenCodeModel(): { provider: string; model: string } | null {
  const rows = runSqlJson(`
    select json_extract(data,'$.providerID') as provider, json_extract(data,'$.modelID') as model
    from message
    where json_extract(data,'$.role')='assistant'
      and json_extract(data,'$.providerID') is not null
      and json_extract(data,'$.modelID') is not null
    order by time_created desc
    limit 1;
  `)
  const row = rows[0]
  const provider = String(row?.provider || "").trim()
  const model = String(row?.model || "").trim()
  if (!provider || !model) return null
  return { provider, model }
}

function getSessionDbFacts(sessionId: string): Record<string, any> {
  if (!sessionId) return {}
  const sid = sqlString(sessionId)
  const summaryRows = runSqlJson(`
    select
      count(case when json_extract(data,'$.type')='reasoning' then 1 end) as reasoning_parts,
      count(case when json_extract(data,'$.type')='tool' then 1 end) as tool_parts,
      count(case when json_extract(data,'$.type')='text' then 1 end) as text_parts,
      count(case when json_extract(data,'$.type')='patch' then 1 end) as patch_parts
    from part
    where session_id=${sid};
  `)
  const toolRows = runSqlJson(`
    select lower(coalesce(json_extract(data,'$.tool'), '')) as tool, count(*) as count
    from part
    where session_id=${sid} and json_extract(data,'$.type')='tool'
    group by lower(coalesce(json_extract(data,'$.tool'), ''));
  `)
  const sessionRows = runSqlJson(`
    select
      title,
      directory,
      cost,
      tokens_input,
      tokens_output
    from session
    where id=${sid}
    limit 1;
  `)
  const recentTextRows = runSqlJson(`
    select
      json_extract(data,'$.type') as typ,
      coalesce(json_extract(data,'$.text'),'') as text
    from part
    where session_id=${sid}
      and json_extract(data,'$.type') in ('reasoning','text')
    order by time_created desc
    limit 12;
  `)
  const summary = summaryRows[0] || {}
  const tools: Record<string, number> = {}
  for (const row of toolRows) {
    const key = String(row.tool || "").trim()
    if (!key) continue
    tools[key] = Number(row.count || 0)
  }
  return {
    ...summary,
    ...sessionRows[0],
    tools,
    recentTexts: recentTextRows.map((row) => String(row.text || "")).filter(Boolean),
  }
}

function readJsonLines(file: string): any[] {
  try {
    if (!existsSync(file)) return []
    return readFileSync(file, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) } catch { return null }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function getSessionEventLog(sessionId: string, vibeHome = getVibeOSHome()): any[] {
  return readJsonLines(join(vibeHome, "session-events", `${sessionId}.jsonl`))
}

function getCascadeAuditEntries(vibeHome = getVibeOSHome()): any[] {
  return readJsonLines(join(vibeHome, "cascade-audit", "cascade-audit.jsonl")).slice(-40)
}

export function extractClaimMatches(text: string): ClaimMatch[] {
  if (!text || typeof text !== "string") return []
  const lines = String(text).split("\n")
  const claims: ClaimMatch[] = []
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

function detectContradiction(assistantText: string, prevAssistantTexts: string[] = []): boolean {
  const pairs: Array<[RegExp, RegExp]> = [
    [/\bworks?\b/i, /\bdoesn'?t\s+work\b/i],
    [/\bfixed\b/i, /\b(broken|still\s+(failing|broken|not\s+working))\b/i],
    [/\bdone\b/i, /\b(not\s+done|still\s+(doing|working|unfinished))\b/i],
    [/\bimplemented\b/i, /\b(not\s+implemented|missing)\b/i],
  ]
  for (const prev of prevAssistantTexts) {
    for (const [positive, negative] of pairs) {
      if ((positive.test(prev) && negative.test(assistantText)) || (negative.test(prev) && positive.test(assistantText))) {
        return true
      }
    }
  }
  return false
}

function verificationEvidenceFromEvents(events: any[]): string[] {
  const evidence = new Set<string>()
  for (const event of events) {
    if (event?.kind === "footer-error") continue
    const family = String(event?.family || "")
    if (event?.exitCode === 0 && VERIFICATION_TOOL_RE.test(family)) evidence.add(`verification:${family}`)
    const line = String(event?.footer_line || "")
    if (/\| ✓/.test(line)) evidence.add("footer:verified")
  }
  return [...evidence]
}

function implementationEvidenceFromTruth(sessionId: string): string[] {
  const truth = loadTurnTruth(sessionId, 80)
  const evidence = new Set<string>()
  for (const turn of truth) {
    const finalized = turn?.finalized || {}
    if (Number(finalized?.cascadeDepth || 0) > 0) evidence.add("turn-ledger:cascade")
    if (String(finalized?.rewardOutcome || "") === "positive") evidence.add("turn-ledger:positive-outcome")
  }
  return [...evidence]
}

export function evaluateClaimEvidence(input: {
  text: string
  vibeHome?: string
  sessionId?: string
  turnId?: string
  userText?: string
  prevAssistantTexts?: string[]
  now?: number
  windowMs?: number
}): ClaimEvidenceResult {
  const {
    text,
    vibeHome = getVibeOSHome(),
    sessionId = getCurrentSessionId(),
    turnId = "",
    userText = "",
    prevAssistantTexts = [],
    now = Date.now(),
    windowMs = 120000,
  } = input || {}

  const claims = extractClaimMatches(text)
  if (claims.length === 0) {
    return {
      status: "not_applicable",
      claims: [],
      matchedEvidence: [],
      missingEvidence: [],
      contradictedBy: [],
      reason: "",
      claimTag: "",
      unsubstantiatedCount: 0,
    }
  }

  const cascadeRuns = getCascadeAuditEntries(vibeHome)
  const events = getSessionEventLog(sessionId, vibeHome)
  const dbFacts = getSessionDbFacts(sessionId)
  const matchedEvidence = new Set<string>()
  const missingEvidence = new Set<string>()
  const contradictedBy = new Set<string>()

  if (Number(dbFacts.patch_parts || 0) > 0) matchedEvidence.add("patches")
  for (const item of verificationEvidenceFromEvents(events)) matchedEvidence.add(item)
  for (const item of implementationEvidenceFromTruth(sessionId)) matchedEvidence.add(item)

  const hasCascadeEvidence = cascadeRuns.some((run) => {
    const ts = run?._ts ? new Date(run._ts).getTime() : 0
    if (!ts || Math.abs(ts - now) >= windowMs) return false
    if (sessionId && String(run.sessionId || "").trim() !== String(sessionId || "").trim()) return false
    if (turnId) {
      const runTurn = String(run.turnId || "").trim()
      if (runTurn && runTurn !== turnId) return false
    }
    // Live-reproduced: a chat-params routing entry (source: "chat-params") writes to
    // this same file on every turn but never sets `executed` at all. `!== false` let
    // that routine per-turn write count as "evidence" for ANY claim -- including a
    // zero-tool-call fabrication ("the bug is fixed") that happened to land within
    // the window. Only an explicit executed:true (a real ml/backend/task routing
    // decision) counts as proof something ran.
    return run.executed === true
  })
  if (hasCascadeEvidence) matchedEvidence.add("runtime:cascade-audit")

  if (!matchedEvidence.has("patches")) missingEvidence.add("code changes")
  if (![...matchedEvidence].some((item) => item.startsWith("verification:") || item === "footer:verified")) missingEvidence.add("verification result")

  if (/doesn.?t work|still broken|not working|failed|wrong/i.test(String(userText || ""))) {
    contradictedBy.add("user follow-up reported failure")
  }
  if (detectContradiction(text, prevAssistantTexts)) {
    contradictedBy.add("assistant contradicted prior answer")
  }

  let status: ClaimEvidenceStatus = "unsupported"
  if (contradictedBy.size > 0) status = "contradicted"
  else if (hasCascadeEvidence) status = "supported"
  else if (matchedEvidence.size > 0 && !missingEvidence.has("verification result")) status = "supported"

  const reason =
    status === "supported"
      ? "Claim is backed by concrete implementation or verification evidence."
      : status === "contradicted"
        ? "Claim conflicts with newer evidence."
        : "Claim is not backed by enough implementation or verification evidence."

  return {
    status,
    claims,
    matchedEvidence: [...matchedEvidence],
    missingEvidence: [...missingEvidence],
    contradictedBy: [...contradictedBy],
    reason,
    // A contradiction is a much stronger signal than a merely-unverified claim
    // and must render distinctly -- previously both got the same generic
    // "⚠N verify" tag, so a user could never tell "not checked yet" apart
    // from "caught contradicting itself" just by reading the footer.
    claimTag: status === "supported" ? "✓ evidence" : status === "contradicted" ? "⚠ contradiction" : `⚠${claims.length} verify`,
    unsubstantiatedCount: status === "supported" ? 0 : claims.length,
  }
}

function tallyTools(tools: Record<string, number>): { implementation: number; inspection: number; meta: number; total: number } {
  let implementation = 0
  let inspection = 0
  let meta = 0
  let total = 0
  for (const [tool, countRaw] of Object.entries(tools || {})) {
    const count = Number(countRaw || 0)
    total += count
    if (IMPLEMENTATION_TOOLS.has(tool)) implementation += count
    if (INSPECTION_TOOLS.has(tool)) inspection += count
    if (tool === "task" || tool === "todowrite" || tool === "vibe" || tool.startsWith("report")) meta += count
  }
  return { implementation, inspection, meta, total }
}

function requestedDiagnostics(userText: string): boolean {
  return DIAGNOSTIC_REQUEST_RE.test(String(userText || ""))
}

function pushSignal(signals: SessionHealthSignal[], kind: MetaWorkSignalKind, score: number, summary: string): void {
  signals.push({ kind, score, summary })
}

function summarizeLatestText(dbFacts: Record<string, any>, assistantText: string, userText: string): string {
  return [
    String(dbFacts?.title || ""),
    ...(Array.isArray(dbFacts?.recentTexts) ? dbFacts.recentTexts : []),
    String(assistantText || ""),
    String(userText || ""),
  ].filter(Boolean).join(" ")
}

export function getSessionHealthSnapshot(input: {
  sessionId?: string
  projectFingerprint?: string
  userText?: string
  assistantText?: string
  vibeHome?: string
  prevAssistantTexts?: string[]
  turnId?: string
} = {}): SessionHealthSnapshot {
  const sessionId = String(input.sessionId || getCurrentSessionId() || "").trim()
  const projectFingerprint = String(input.projectFingerprint || "").trim()
  const userText = String(input.userText || "")
  const assistantText = String(input.assistantText || "")
  const vibeHome = input.vibeHome || getVibeOSHome()
  const prevAssistantTexts = Array.isArray(input.prevAssistantTexts) ? input.prevAssistantTexts : []

  const claimEvidence = evaluateClaimEvidence({
    text: assistantText,
    vibeHome,
    sessionId,
    turnId: input.turnId || "",
    userText,
    prevAssistantTexts,
  })
  const dbFacts = sessionId ? getSessionDbFacts(sessionId) : {}
  const events = sessionId ? getSessionEventLog(sessionId, vibeHome) : []
  const truth = sessionId ? loadTurnTruth(sessionId, 80) : []
  const { implementation, inspection, meta, total } = tallyTools(dbFacts.tools || {})
  const implementationRatio = total > 0 ? implementation / total : 0
  const inspectionRatio = total > 0 ? inspection / total : 0
  const decisiveProgress = Number(dbFacts.patch_parts || 0) > 0 || truth.some((turn) => String(turn?.finalized?.rewardOutcome || "") === "positive")
  const signals: SessionHealthSignal[] = []
  const combinedText = summarizeLatestText(dbFacts, assistantText, userText)
  const diagnosticsRequested = requestedDiagnostics(userText)

  for (const entry of META_WORK_PATTERNS) {
    if (entry.re.test(combinedText)) {
      pushSignal(signals, entry.kind, 12, entry.summary)
    }
  }
  if (inspectionRatio >= 0.7 && !decisiveProgress) {
    pushSignal(signals, "inspection_loop", 22, "Session is dominated by inspection with no decisive state change.")
  }
  if (Number(dbFacts.tool_parts || 0) >= 12 && Number(dbFacts.patch_parts || 0) === 0 && !decisiveProgress) {
    pushSignal(signals, "high_burn_low_change", 26, "Tool activity is high but no meaningful implementation change is visible.")
  }
  if (Number((dbFacts.tools || {}).task || 0) >= 2) {
    pushSignal(signals, "subagent_churn", 16, "Multiple subagent hops were used without clear progress evidence.")
  }
  if (claimEvidence.status === "unsupported") {
    pushSignal(signals, "verification_gap", 14, "Completion language is not backed by verification evidence.")
  }
  if (claimEvidence.status === "contradicted") {
    pushSignal(signals, "verification_gap", 24, "Completion language is contradicted by newer evidence.")
  }

  let score = signals.reduce((sum, signal) => sum + signal.score, 0)
  if (decisiveProgress) score = Math.max(0, score - 18)
  if (implementationRatio >= 0.25) score = Math.max(0, score - 8)
  if (diagnosticsRequested) score = Math.max(0, score - 10)
  if (Number(dbFacts.tokens_input || 0) + Number(dbFacts.tokens_output || 0) > 1_500_000 && !decisiveProgress) score += 12

  const risk: SessionHealthRisk = score >= 45 ? "high" : score >= 20 ? "moderate" : "low"
  const metaWorkDrift = !diagnosticsRequested && signals.some((signal) =>
    ["status_loop", "audit_loop", "mode_churn", "cascade_confirmation_loop"].includes(signal.kind),
  )

  const topKinds = signals.map((signal) => signal.kind)
  let recommendedAction = "Continue with the next decisive implementation or verification step."
  let stopDoing = ""
  if (metaWorkDrift || topKinds.includes("inspection_loop")) {
    recommendedAction = "Stop re-checking vibeOS state and either implement the next change, run one targeted verification, or conclude with evidence."
    stopDoing = "Stop repeating status/audit/cascade checks without a new code or runtime change."
  } else if (claimEvidence.status === "unsupported") {
    recommendedAction = "Back the completion claim with one concrete verification step or tone the claim down to findings only."
    stopDoing = "Do not say fixed/verified/working until the relevant check has run."
  } else if (claimEvidence.status === "contradicted") {
    recommendedAction = "Acknowledge the contradiction, inspect the failing evidence once, and switch from claim language to diagnosis."
    stopDoing = "Stop repeating the success claim while newer evidence says otherwise."
  }

  const snapshot: SessionHealthSnapshot = {
    sessionId,
    projectFingerprint,
    updatedAt: new Date().toISOString(),
    risk,
    score,
    decisiveProgress,
    loopSignals: signals.sort((a, b) => b.score - a.score),
    recommendedAction,
    metaWorkDrift,
    stopDoing,
    implementationRatio,
    inspectionRatio,
    claimEvidence,
  }
  queueMicrotask(() => { try { persistSessionHealthSnapshot(snapshot, vibeHome) } catch {} })
  return snapshot
}

function persistSessionHealthSnapshot(snapshot: SessionHealthSnapshot, vibeHome = getVibeOSHome()): void {
  try {
    mkdirSync(vibeHome, { recursive: true })
    appendJsonlWithRotation(join(vibeHome, "session-health.jsonl"), JSON.stringify(snapshot) + "\n")
  } catch {}
}

export function getLatestSessionHealthSnapshot(sessionId = getCurrentSessionId(), vibeHome = getVibeOSHome()): SessionHealthSnapshot | null {
  try {
    const rows = readJsonLines(join(vibeHome, "session-health.jsonl"))
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i]?.sessionId || "") === String(sessionId || "")) return rows[i] as SessionHealthSnapshot
    }
  } catch {}
  return null
}

export function detectMetaWorkDrift(input: {
  sessionId?: string
  projectFingerprint?: string
  userText?: string
  assistantText?: string
} = {}): boolean {
  return getSessionHealthSnapshot(input).metaWorkDrift
}
