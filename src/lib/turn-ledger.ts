// SPDX-License-Identifier: MIT
// Canonical live turn ledger. The footer, cascade audit substantiation, and
// route debugging must share one executed-turn truth instead of independently
// inferring state from blackbox/delegation/footer probes.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

import { getCurrentSessionId, getVibeOSHome } from "./state.js"

export interface TurnRouteSnapshot {
  selectedModel?: string | null
  selectedSlot?: string | null
  selectedSubagent?: string | null
  requiresDelegation?: boolean
  reason?: string
  source?: string
  routePath?: string[]
  cascadeRoot?: string[]
  cascadeDepth?: number
  backendTarget?: string | null
  backendExplicit?: boolean
  localConfidence?: number
  localScore?: number
  bridgeId?: string | null
  parentSessionId?: string | null
  childSessionId?: string | null
  status?: string | null
  contributedToFinalAnswer?: boolean
}

export interface TurnFinalizeSnapshot {
  finalVisibleModel?: string | null
  finalVisibleSlot?: string | null
  finalVisibleProvider?: string | null
  finalVisibleProviderLabel?: string | null
  finalVisibleModelName?: string | null
  footerLine?: string | null
  claimTag?: string | null
  rewardTag?: string | null
  rewardCredits?: number | null
  rewardOutcome?: string | null
  subRegime?: string | null
  enforcementMode?: string | null
  flowMode?: string | null
  tddMode?: string | null
  cascadeDepth?: number | null
}

export interface TurnTruth {
  turnId: string
  sessionId: string
  updatedAt: string
  promptHash?: string
  plannedRoute?: TurnRouteSnapshot | null
  executedRoute?: TurnRouteSnapshot | null
  finalized?: TurnFinalizeSnapshot | null
}

type TurnLedgerEvent =
  | {
    _ts: string
    kind: "turn.route"
    sessionId: string
    turnId: string
    promptHash: string
    plannedRoute?: TurnRouteSnapshot | null
    executedRoute?: TurnRouteSnapshot | null
  }
  | {
    _ts: string
    kind: "turn.finalize"
    sessionId: string
    turnId: string
    finalized: TurnFinalizeSnapshot
  }

function ledgerFile(): string {
  return join(getVibeOSHome(), "turn-ledger.jsonl")
}

function ensureLedgerDir(): void {
  mkdirSync(getVibeOSHome(), { recursive: true })
}

function normalizeRoute(route: unknown): TurnRouteSnapshot | null {
  if (!route || typeof route !== "object") return null
  const raw = route as Record<string, unknown>
  const next: TurnRouteSnapshot = {}
  for (const key of [
    "selectedModel", "selectedSlot", "selectedSubagent", "reason", "source",
    "backendTarget", "bridgeId", "parentSessionId", "childSessionId", "status",
  ] as const) {
    const value = raw[key]
    if (value === null || value === undefined || value === "") continue
    next[key] = String(value) as never
  }
  for (const key of ["requiresDelegation", "backendExplicit", "contributedToFinalAnswer"] as const) {
    if (typeof raw[key] === "boolean") {
      next[key] = Boolean(raw[key]) as never
    }
  }
  for (const key of ["cascadeDepth", "localConfidence", "localScore"] as const) {
    const num = Number(raw[key])
    if (Number.isFinite(num)) next[key] = num as never
  }
  const routePath = Array.isArray(raw.routePath) ? raw.routePath : Array.isArray(raw.route_path) ? raw.route_path : []
  if (routePath.length > 0) next.routePath = routePath.map((v: unknown) => String(v || "").trim()).filter(Boolean)
  const cascadeRoot = Array.isArray(raw.cascadeRoot) ? raw.cascadeRoot : Array.isArray(raw.cascade_root) ? raw.cascade_root : []
  if (cascadeRoot.length > 0) next.cascadeRoot = cascadeRoot.map((v: unknown) => String(v || "").trim()).filter(Boolean)
  return Object.keys(next).length > 0 ? next : null
}

function normalizeFinalize(finalized: unknown): TurnFinalizeSnapshot | null {
  if (!finalized || typeof finalized !== "object") return null
  const raw = finalized as Record<string, unknown>
  const next: TurnFinalizeSnapshot = {}
  for (const key of [
    "finalVisibleModel", "finalVisibleSlot", "finalVisibleProvider",
    "finalVisibleProviderLabel", "finalVisibleModelName", "footerLine",
    "claimTag", "rewardTag", "rewardOutcome", "subRegime",
    "enforcementMode", "flowMode", "tddMode",
  ] as const) {
    const value = raw[key]
    if (value === null || value === undefined || value === "") continue
    next[key] = String(value) as never
  }
  for (const key of ["rewardCredits", "cascadeDepth"] as const) {
    const num = Number(raw[key])
    if (Number.isFinite(num)) next[key] = num as never
  }
  return Object.keys(next).length > 0 ? next : null
}

export function buildTurnId(input: { sessionId?: string; prompt?: string; salt?: string | number } = {}): string {
  const sessionId = String(input.sessionId || getCurrentSessionId() || "unknown").trim() || "unknown"
  const prompt = String(input.prompt || "").trim()
  const salt = String(input.salt || Date.now())
  return createHash("sha1").update([sessionId, prompt, salt].join("|")).digest("hex").slice(0, 16)
}

export function recordTurnRoute(input: {
  sessionId?: string
  turnId?: string
  prompt?: string
  plannedRoute?: unknown
  executedRoute?: unknown
}): { sessionId: string; turnId: string } | null {
  const sessionId = String(input.sessionId || getCurrentSessionId() || "").trim()
  if (!sessionId) return null
  const turnId = String(input.turnId || buildTurnId({ sessionId, prompt: input.prompt })).trim()
  const promptHash = createHash("sha1").update(String(input.prompt || "")).digest("hex").slice(0, 12)
  const event: TurnLedgerEvent = {
    _ts: new Date().toISOString(),
    kind: "turn.route",
    sessionId,
    turnId,
    promptHash,
    plannedRoute: normalizeRoute(input.plannedRoute),
    executedRoute: normalizeRoute(input.executedRoute),
  }
  try {
    ensureLedgerDir()
    appendFileSync(ledgerFile(), JSON.stringify(event) + "\n")
  } catch {}
  return { sessionId, turnId }
}

export function recordTurnFinalize(input: {
  sessionId?: string
  turnId?: string
  finalized?: unknown
}): { sessionId: string; turnId: string } | null {
  const sessionId = String(input.sessionId || getCurrentSessionId() || "").trim()
  const turnId = String(input.turnId || "").trim()
  const finalized = normalizeFinalize(input.finalized)
  if (!sessionId || !turnId || !finalized) return null
  const event: TurnLedgerEvent = {
    _ts: new Date().toISOString(),
    kind: "turn.finalize",
    sessionId,
    turnId,
    finalized,
  }
  try {
    ensureLedgerDir()
    appendFileSync(ledgerFile(), JSON.stringify(event) + "\n")
  } catch {}
  return { sessionId, turnId }
}

export function loadTurnTruth(sessionId = getCurrentSessionId(), limit = 200): TurnTruth[] {
  const sid = String(sessionId || "").trim()
  if (!sid) return []
  try {
    const file = ledgerFile()
    if (!existsSync(file)) return []
    const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean)
    const events = lines.slice(-Math.max(1, limit)).map((line) => {
      try { return JSON.parse(line) as TurnLedgerEvent } catch { return null }
    }).filter((event): event is TurnLedgerEvent => Boolean(event && event.sessionId === sid))
    const map = new Map<string, TurnTruth>()
    for (const event of events) {
      const current = map.get(event.turnId) || {
        turnId: event.turnId,
        sessionId: sid,
        updatedAt: event._ts,
      }
      current.updatedAt = event._ts
      if (event.kind === "turn.route") {
        current.promptHash = event.promptHash
        if (event.plannedRoute) current.plannedRoute = event.plannedRoute
        if (event.executedRoute) current.executedRoute = event.executedRoute
      } else if (event.kind === "turn.finalize") {
        current.finalized = event.finalized
      }
      map.set(event.turnId, current)
    }
    return Array.from(map.values()).sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)))
  } catch {
    return []
  }
}

export function getLatestTurnTruth(sessionId = getCurrentSessionId()): TurnTruth | null {
  const turns = loadTurnTruth(sessionId, 400)
  return turns.length > 0 ? turns[turns.length - 1] : null
}
