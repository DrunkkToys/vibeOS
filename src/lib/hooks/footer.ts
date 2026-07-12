// DOC: Auto-merged from footer.ts, shared-footer.ts, session-bridge.ts
// @ts-nocheck
// SPDX-License-Identifier: MIT

// ── Imports ──

import { createHash } from "node:crypto"
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { classify, _refreshModel, readConfig, readLiveOpenCodeModel, TRINITY_BRAIN, TRINITY_MEDIUM, TRINITY_CHEAP, shortModelName, formatUsd, resolveCurrentExecution, modelDisplayName, getPendingLiveSwitch } from "../pricing.js"
import { latestUserIntent } from "./chat-transform.js"
import { scoreStress, resolveEnforcementMode, detectOutcomeSignal, getBlackboxTracker, syncOutcomeToApi, classifyTurnSimple, autoSelectMode, loadOptimizationMode, computeControlVector, getLatestBlackboxLoopMsg, getLatestBlackboxPivotMsg, getLatestBlackboxState, BRANDED_MODES, RUNTIME_MODES, MODE_TABLE, normalizeLegacyMode } from "../cascade.js"
import { saveReport } from "../reporting.js"
import { currentModel, currentTier, currentProjectFingerprint, currentProjectName, getCurrentSessionId, _modelLocked, _blackboxEnabled, loadBlackboxState, recordLiveSessionSnapshot, getVibeOSHome, readLifetimeSavings, getLatestCacheEvent, readFullState, _OC_SID, removeJobRecord, saveJobRecord, updateSessionOrchestration, getActiveJobForProject, loadSelection, loadSessionOrchestration, _cacheDb } from "../state.js"
import { loadSessionSlot } from "../selection-manager.js"
import { remoteCall, isApiConnected, isApiFallback } from "../api-client.js"
import { getSessionCacheSavings } from "../session-savings.js"
import { computeReward } from "../../vibeOS-lib/reward-engine.js"
import { detectLaziness } from "../../vibeOS-lib/laziness-detector.js"
import { evaluateClaimEvidence, getSessionHealthSnapshot } from "../session-health.js"
import { getLatestTurnTruth, recordTurnFinalize } from "../turn-ledger.js"
import { extractRecentCacheOutputs } from "../../vibeOS-lib/smart-cache.js"
import { computeDifficulty } from "../../vibeOS-lib/ml-router.js"

// ── Footer Line Types (from shared-footer) ──

export interface FooterLineInput {
  activeSlot: string
  sessionSlot?: string
  workerSlot?: string
  providerLabel: string
  modelName: string
  savingsTotal?: number
  ltTotal?: number
  ltTrend?: string
  vibeBrand: string
  optMode: string
  flashIcon: string
  enfTags: string[]
  subRegime?: string
  stressGauge?: string
  cascadeIcon?: string
  cascadeLabel?: string
  claimTag?: string
  rewardTag?: string
  alertTag?: string
}

const REGIME_TAG: Record<string, string> = {
  INIT: "Starting",
  DIVERGENT: "Off-track",
  EXPLORING: "Exploring",
  REFINING: "Refining",
  IMPLEMENTING: "Building",
  RESEARCH: "Researching",
  REVIEWING: "Reviewing",
  DESIGNING: "Designing",
  CONVERGING: "Converging",
  CLOSED: "Closed",
  LOOPING: "Looping",
  AUDIT: "Auditing",
  FORENSIC: "Deep dive",
}

const REGIME_ICON: Record<string, string> = {
  INIT: "◌",
  DIVERGENT: "⇄",
  EXPLORING: "⌕",
  REFINING: "✎",
  IMPLEMENTING: "⚙",
  RESEARCH: "⌁",
  REVIEWING: "✓",
  DESIGNING: "◫",
  CONVERGING: "⟲",
  CLOSED: "◆",
  LOOPING: "↻",
  AUDIT: "☑",
  FORENSIC: "⟁",
}

const BRAND_MAP: Record<string, string> = {
  ...Object.fromEntries(Object.entries(MODE_TABLE).flatMap(([, mode]) => {
    const aliases = [mode.id]
    if (mode.id === "vibelitex") aliases.push("litex")
    return aliases.map((alias) => [alias, mode.name])
  })),
  ...Object.fromEntries(RUNTIME_MODES.map(m => [m.id, m.name])),
}

const TIER_ICON: Record<string, string> = {
  brain: "\u{1F9E0}",
  medium: "\u25D0",
  cheap: "\u26A1",
  free: "\u{1F381}",
}

// ── Footer Formatters (from shared-footer) ──

export function resolveBrand(optMode: string, _activeSlot: string): string {
  const raw = String(optMode || "").trim().toLowerCase()
  if (!raw || raw === "auto") return "vibeOS"
  if (raw === "raw") return MODE_TABLE.raw.name
  const isKnownMode = BRANDED_MODES.some((mode) => mode.id === raw) || RUNTIME_MODES.some((mode) => mode.id === raw)
  const isKnownAlias = raw === "litex"
  if (!isKnownMode && !isKnownAlias) return "vibeOS"
  try {
    const canonical = normalizeLegacyMode(raw)
    return MODE_TABLE[canonical]?.name || "vibeOS"
  } catch {
    return "vibeOS"
  }
}

export function resolveTierIcon(slot: string): string {
  return TIER_ICON[slot] || "\u26A1"
}

export type CascadeTier = "cheap" | "medium" | "brain"

export interface CascadeTierResolution {
  tier: CascadeTier
  depth: number
  source: "route" | "model"
}

interface CascadeTierSessionState {
  route_path?: unknown
  pipeline_root?: unknown
  cascade_depth?: unknown
}

function _asTier(value: unknown): CascadeTier | null {
  return value === "cheap" || value === "medium" || value === "brain" ? value : null
}

export function resolveActiveCascadeTier(opts: {
  liveSession?: CascadeTierSessionState
  diskSession?: CascadeTierSessionState
  legacyDepth?: number
  liveModel?: string
  trinityCheap?: string
  trinityMedium?: string
  trinityBrain?: string
  classify?: (model: string) => string
}): CascadeTierResolution {
  for (const session of [opts.liveSession, opts.diskSession]) {
    const routePath = Array.isArray(session?.route_path) ? (session!.route_path as unknown[]) : []
    const tier = routePath.length ? _asTier(routePath[routePath.length - 1]) : null
    if (tier) return { tier, depth: routePath.length, source: "route" }
  }
  for (const session of [opts.liveSession, opts.diskSession]) {
    const pipelineRoot = Array.isArray(session?.pipeline_root) ? (session!.pipeline_root as unknown[]) : []
    const depth = Number(session?.cascade_depth) || 0
    if (pipelineRoot.length && depth > 0) {
      const tier = _asTier(pipelineRoot[Math.min(depth, pipelineRoot.length) - 1])
      if (tier) return { tier, depth, source: "route" }
    }
  }
  const legacyDepth = opts.legacyDepth !== undefined && opts.legacyDepth !== null && Number.isFinite(Number(opts.legacyDepth))
    ? Number(opts.legacyDepth)
    : null
  const m = opts.liveModel || ""
  if (opts.trinityCheap && m === opts.trinityCheap) return { tier: "cheap", depth: legacyDepth ?? 1, source: "model" }
  if (opts.trinityMedium && m === opts.trinityMedium) return { tier: "medium", depth: legacyDepth ?? 2, source: "model" }
  if (opts.trinityBrain && m === opts.trinityBrain) return { tier: "brain", depth: legacyDepth ?? 3, source: "model" }
  const c = String((opts.classify ? opts.classify(m) : "") || "").toLowerCase()
  const tier: CascadeTier = c === "high" || c === "brain" ? "brain" : c === "mid" || c === "medium" ? "medium" : "cheap"
  return { tier, depth: legacyDepth ?? (tier === "brain" ? 3 : tier === "medium" ? 2 : 1), source: "model" }
}

export function resolveRegimeIcon(subRegime: string): string {
  return REGIME_ICON[String(subRegime || "").toUpperCase()] || "◦"
}

export function formatModeLabel(optMode: string): string {
  const normalized = String(optMode || "").toLowerCase()
  if (!normalized) return ""
  if (normalized === "vibemax") return "VibeMaX"
  if (normalized === "vibelitex" || normalized === "litex") return "VibeLiteX"
  if (normalized === "vibeqmax") return "VibeQMaX"
  if (normalized === "vibeultrax") return "VibeUltraX"
  if (normalized === "speed") return "Speed"
  if (normalized === "longrun") return "Longrun"
  if (normalized === "audit") return "Audit"
  if (normalized === "forensic") return "Forensic"
  if (normalized === "balanced") return "Balanced"
  if (normalized === "budget") return "Budget"
  if (normalized === "quality") return "Quality"
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export function formatEnforcementPulse(enfTags: string[]): string {
  const tags = new Set(enfTags || [])
  const parts: string[] = []

  if (tags.has("[Q&A]")) {
    parts.push("quiet mode")
  } else {
    if (tags.has("[ENF ON]") || tags.has("[STRICT]")) parts.push("guarded")
    if (tags.has("[FLOW ON]")) parts.push("flow steady")
    if (tags.has("[TDD ON]")) parts.push("tests live")
  }

  if (tags.has("[LOCK ON]")) parts.push("locked")

  return parts.join(" · ")
}

export function trendGlyph(trend?: string): string {
  if (trend === "up") return "↗"
  if (trend === "down") return "↘"
  return "→"
}

export function formatSavingsPulse(amountUsd: number, trend?: string): string {
  const amount = Number(amountUsd || 0)
  if (!Number.isFinite(amount) || amount <= 0) return ""
  const arrow = trendGlyph(trend)
  return `$${amount.toFixed(2)} saved${arrow !== "→" ? ` ${arrow}` : ""}`
}

export function formatCascadePulse(cascadeIcon?: string, cascadeLabel?: string): string {
  const icon = String(cascadeIcon || "").trim()
  const label = String(cascadeLabel || "").trim()
  if (!icon && !label) return ""
  return [icon, label].filter(Boolean).join(" ")
}

export function formatStressGauge(stress: unknown): string {
  const value = Number(stress)
  if (!Number.isFinite(value)) return ""
  const clamped = Math.max(0, Math.min(1, value))
  if (clamped > 0.85) return "█"
  if (clamped > 0.7) return "▆"
  if (clamped > 0.5) return "▅"
  if (clamped > 0.3) return "▃"
  if (clamped > 0.1) return "▂"
  return "▁"
}

export function resolveFooterState(partial?: Partial<FooterLineInput> | null): FooterLineInput {
  const p = partial && typeof partial === "object" ? partial : {}
  const savingsTotalNum = Number(p.savingsTotal ?? p.ltTotal)
  return {
    activeSlot: typeof p.activeSlot === "string" && p.activeSlot ? p.activeSlot : "cheap",
    sessionSlot: p.sessionSlot,
    workerSlot: p.workerSlot,
    providerLabel: typeof p.providerLabel === "string" && p.providerLabel ? p.providerLabel : "Unknown",
    modelName: typeof p.modelName === "string" && p.modelName ? p.modelName : "unknown",
    savingsTotal: Number.isFinite(savingsTotalNum) ? savingsTotalNum : 0,
    ltTotal: Number.isFinite(savingsTotalNum) ? savingsTotalNum : 0,
    ltTrend: p.ltTrend,
    vibeBrand: typeof p.vibeBrand === "string" ? p.vibeBrand : "",
    optMode: typeof p.optMode === "string" ? p.optMode : "",
    flashIcon: typeof p.flashIcon === "string" ? p.flashIcon : "",
    enfTags: Array.isArray(p.enfTags) ? p.enfTags : [],
    subRegime: p.subRegime,
    stressGauge: p.stressGauge,
    cascadeIcon: p.cascadeIcon,
    cascadeLabel: p.cascadeLabel,
    claimTag: p.claimTag,
    rewardTag: p.rewardTag,
    alertTag: p.alertTag,
  }
}

export function buildResilientFooterLine(partial?: Partial<FooterLineInput> | null): string {
  const state = resolveFooterState(partial)
  if (!state.vibeBrand) {
    state.vibeBrand = resolveBrand(state.optMode, state.activeSlot)
  }
  try {
    return buildFooterLine(state)
  } catch {
    const cascade = formatCascadePulse(state.cascadeIcon, state.cascadeLabel)
    const alert = state.alertTag ? ` | ${state.alertTag}` : ""
    const cascadePart = cascade ? ` | ${cascade}` : ""
    return `— ${resolveTierIcon(state.activeSlot)} ${state.activeSlot} | ${state.providerLabel} | ${state.modelName} | VIBE${cascadePart} | ${state.vibeBrand || "vibeOS"}${alert} —`
  }
}

export function buildEnforcementTags(opts: {
  delegationEnforce: boolean
  flowEnforce: boolean
  tddEnforce: boolean
  bbMode: string
  modelLocked: boolean
  quietIntent?: boolean
}): string[] {
  const tags: string[] = []
  if (opts.quietIntent || opts.bbMode === "relaxed") {
    tags.push("[Q&A]")
  } else {
    if (opts.delegationEnforce) tags.push("[ENF ON]")
    if (opts.flowEnforce) tags.push("[FLOW ON]")
    if (opts.tddEnforce) tags.push("[TDD ON]")
    if (opts.bbMode === "strict") tags.push("[STRICT]")
  }
  if (opts.modelLocked) tags.push("[LOCK ON]")
  return tags
}

export function buildFooterAlert(opts: {
  apiDegraded?: boolean
  apiSlow?: boolean
  liveModel?: string
  expectedModel?: string
  lastModelError?: string
  pendingLiveModel?: string
} | null = {}): string {
  opts = opts || {}
  const alerts: string[] = []
  if (opts.apiSlow) alerts.push("⚠ api slow")
  if (opts.apiDegraded && String(opts.lastModelError || "").trim()) alerts.push("⚠ api degraded")
  const expectedToCompare = opts.pendingLiveModel || opts.expectedModel
  if (opts.liveModel && expectedToCompare && opts.liveModel !== expectedToCompare) {
    if (opts.pendingLiveModel) {
      alerts.push("⚠ switch pending")
    } else {
      alerts.push("⚠ model drift")
    }
  }
  const err = String(opts.lastModelError || "")
  if (err && (err.includes("EHOSTUNREACH") || err.includes("ENOTFOUND") || err.includes("ETIMEDOUT"))) {
    alerts.push("⚠ model unreachable")
  }
  return alerts.join(" · ")
}

export function buildFooterLine(input: FooterLineInput): string {
  const { activeSlot, providerLabel, modelName, ltTrend, vibeBrand, optMode, flashIcon, enfTags, subRegime } = input
  const savingsTotal = Number.isFinite(Number(input.savingsTotal ?? input.ltTotal)) ? Number(input.savingsTotal ?? input.ltTotal) : 0

  const tierIcon = resolveTierIcon(activeSlot)
  const regimeTag = subRegime ? REGIME_TAG[subRegime] || subRegime.slice(0, 4) : null
  const regimeIcon = subRegime ? resolveRegimeIcon(subRegime) : null
  const modeLabel = formatModeLabel(optMode)
  const workerSuffix = input.workerSlot ? ` [${input.workerSlot}]` : ""
  let line = `\u2014 ${tierIcon} ${activeSlot} | ${providerLabel} | ${modelName}${workerSuffix}${regimeTag ? ` \u25B6 ${regimeIcon} ${regimeTag}` : ""}`

  if (savingsTotal > 0) {
    const savingsPulse = formatSavingsPulse(savingsTotal, ltTrend)
    if (savingsPulse) line += ` | ${savingsPulse}`
  } else {
    line += " | VIBE"
  }

  if (vibeBrand) {
    line += ` | ${vibeBrand}${flashIcon}`
  } else if (flashIcon.trim()) {
    line += ` | ${flashIcon.trim()}`
  }

  const cascadePulse = formatCascadePulse(input.cascadeIcon, input.cascadeLabel)
  if (cascadePulse) {
    line += ` | ${cascadePulse}`
  }

  const enforcementPulse = formatEnforcementPulse(enfTags)
  if (enforcementPulse) {
    line += ` | ${enforcementPulse}`
  }

  if (input.alertTag) {
    line += ` | ${input.alertTag}`
  }

  if (input.stressGauge) {
    line += ` | ${input.stressGauge}`
  }

  if (input.claimTag) {
    line += ` | ${input.claimTag}`
  }

  if (input.rewardTag) {
    line += ` | ${input.rewardTag}`
  }

  line += " \u2014"

  return line
}

// ── Session Bridge (from session-bridge) ──

function compactText(value: unknown, max = 900): string {
  const text = String(value || "").trim()
  if (!text) return ""
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function normalizePipeline(pipeline: unknown): string[] {
  return Array.isArray(pipeline)
    ? pipeline.map((tier) => String(tier || "").trim()).filter(Boolean)
    : []
}

function computeSessionBridgeKey(input: {
  sessionId?: string
  fromModel?: string
  fromTier?: string
  toModel?: string
  toTier?: string
  reason?: string
  prompt?: string
  userText?: string
  activePipeline?: unknown
  projectFingerprint?: string
  projectName?: string
  sourceStrategy?: string
} = {}): string {
  const sessionId = String(input.sessionId || getCurrentSessionId() || _OC_SID || "unknown").trim() || "unknown"
  const fromModel = String(input.fromModel || "").trim()
  const fromTier = String(input.fromTier || "").trim()
  const toModel = String(input.toModel || "").trim()
  const toTier = String(input.toTier || "").trim()
  const reason = String(input.reason || "cascade handoff").trim()
  const prompt = compactText(input.prompt || "")
  const pipelineRoot = normalizePipeline(input.activePipeline)
  const projectFingerprint = String(input.projectFingerprint || currentProjectFingerprint || "").trim()
  const projectName = String(input.projectName || currentProjectName || "").trim()
  const sourceStrategy = String(input.sourceStrategy || "").trim()
  return createHash("sha1").update([
    sessionId,
    fromModel,
    fromTier,
    toModel,
    toTier,
    reason,
    prompt,
    pipelineRoot.join(","),
    projectFingerprint,
    projectName,
    sourceStrategy,
  ].join("|")).digest("hex").slice(0, 16)
}

function hasRecordedSessionBridge(sessionId: string, bridgeKey: string, bridgeId: string): boolean {
  try {
    const orchestration = loadSessionOrchestration(sessionId)
    const history = Array.isArray(orchestration?.history) ? orchestration.history : []
    return history.some((entry: unknown) => {
      const actions = Array.isArray(entry?.payload?.actions) ? entry.payload.actions : []
      return actions.some((action: unknown) => {
        const payload = action?.payload && typeof action.payload === "object" ? action.payload : {}
        const note = String(payload.note || "").trim()
        const tags = Array.isArray(payload.tags) ? payload.tags.map((tag: unknown) => String(tag || "").trim()) : []
        return note.includes(`bridge_key=${bridgeKey}`) || tags.includes(`bridge_key:${bridgeKey}`) || tags.includes(`bridge:${bridgeId}`)
      })
    })
  } catch {
    return false
  }
}

function summarizeSelection(selection: unknown): Record<string, unknown> {
  const sel = selection && typeof selection === "object" ? selection : {}
  return {
    enabled: sel.enabled !== false,
    active_slot: sel.active_slot || null,
    slot_locked: Boolean(sel.slot_locked),
    optimization_mode: sel.optimization_mode || null,
    thinking_level: sel.thinking_level || "off",
    flow_enabled: sel.flow_enabled !== false,
    flow_enforce: Boolean(sel.flow_enforce),
    delegation_enforce: sel.delegation_enforce !== false,
    tdd_enforce: Boolean(sel.tdd_enforce),
    tdd_strict: Boolean(sel.tdd_strict),
    tdd_quality: sel.tdd_quality !== false,
    requested_optimization_mode: sel.requested_optimization_mode || null,
    previous_default_agent: sel.previous_default_agent || null,
    previous_optimization_mode: sel.previous_optimization_mode || null,
  }
}

function summarizeOrchestration(orchestration: unknown): Record<string, unknown> {
  const orch = orchestration && typeof orchestration === "object" ? orchestration : {}
  const notes = Array.isArray(orch.notes) ? orch.notes : []
  const history = Array.isArray(orch.history) ? orch.history : []
  const lastNote = notes.at(-1)
  const lastHistory = history.at(-1)
  return {
    status: orch.status || "active",
    locked: Boolean(orch.locked),
    archived: Boolean(orch.archived),
    version: Number(orch.version || 1) || 1,
    tags: Array.isArray(orch.tags) ? orch.tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [],
    notes_count: notes.length,
    last_note: lastNote?.text || null,
    last_action: lastHistory?.action || null,
    template_id: orch.template?.id || null,
    template_label: orch.template?.label || null,
    template_signature: orch.template?.signature || null,
  }
}

function summarizeCache(cacheDb: unknown): Record<string, unknown> {
  const db = cacheDb && typeof cacheDb === "object" ? cacheDb : {}
  const entries = Array.isArray(db.entries) ? db.entries : []
  const stats = db.stats && typeof db.stats === "object" ? db.stats : {}
  const toolStats = Object.values(stats).slice(0, 6).map((stat: unknown) => ({
    tool: stat?.tool || null,
    hits: Number(stat?.hits || 0),
    total: Number(stat?.total || 0),
    hitRate: Number(stat?.hitRate || 0),
    bytesSaved: Number(stat?.bytesSaved || 0),
  }))
  return {
    entries: entries.length,
    tool_stats: toolStats,
    recent_outputs: extractRecentCacheOutputs(db, 5),
  }
}

export function buildSessionBridge(input: {
  sessionId?: string
  turnId?: string
  fromModel?: string
  fromTier?: string
  toModel?: string
  toTier?: string
  reason?: string
  prompt?: string
  userText?: string
  activePipeline?: unknown
  projectFingerprint?: string
  projectName?: string
  sourceStrategy?: string
  routeDecision?: unknown
} = {}) {
  const sessionId = String(input.sessionId || getCurrentSessionId() || _OC_SID || "unknown").trim() || "unknown"
  const fromModel = String(input.fromModel || "").trim()
  const fromTier = String(input.fromTier || "").trim()
  const toModel = String(input.toModel || "").trim()
  const toTier = String(input.toTier || "").trim()
  const reason = String(input.reason || "cascade handoff").trim()
  const prompt = compactText(input.prompt || input.userText || "")
  const pipelineRoot = normalizePipeline(input.activePipeline)
  const projectFingerprint = String(input.projectFingerprint || currentProjectFingerprint || "").trim()
  const projectName = String(input.projectName || currentProjectName || "").trim()
  const activeJob = getActiveJobForProject(projectFingerprint)
  const activeJobPrompt = compactText(activeJob?.prompt || activeJob?.text || "")
  const selectionSnapshot = summarizeSelection(loadSelection())
  const orchestrationSnapshot = summarizeOrchestration(loadSessionOrchestration(sessionId))
  const cacheSnapshot = summarizeCache(_cacheDb)
  const carryForward = [prompt, activeJobPrompt].filter(Boolean).join("\n")
  const verifiedDifficulty = computeDifficulty(prompt)
  const routeDecisionSnapshot = input.routeDecision && typeof input.routeDecision === "object"
    ? input.routeDecision
    : {
        source: String(input.sourceStrategy || "local-cascade"),
        reason,
        from_tier: fromTier || null,
        from_model: fromModel || null,
        to_tier: toTier || null,
        to_model: toModel || null,
        verified: true,
      }
  const createdAt = new Date().toISOString()
  const bridgeId = createHash("sha1").update([
    sessionId,
    fromModel,
    fromTier,
    toModel,
    toTier,
    reason,
    createdAt,
  ].join("|")).digest("hex").slice(0, 16)
  const bridgeKey = computeSessionBridgeKey(input)

  const promptPrefix = [
    "[session bridge]",
    `bridge_id=${bridgeId}`,
    `source_session=${sessionId}`,
    `from=${fromTier || "unknown"}:${fromModel || "unset"}`,
    `to=${toTier || "unknown"}:${toModel || "unset"}`,
    `reason=${reason}`,
    pipelineRoot.length > 0 ? `pipeline=${pipelineRoot.join(" -> ")}` : null,
    input.sourceStrategy ? `source_strategy=${input.sourceStrategy}` : null,
    `selection=${JSON.stringify(selectionSnapshot)}`,
    `orchestration=${JSON.stringify(orchestrationSnapshot)}`,
    `cache=${JSON.stringify(cacheSnapshot)}`,
    carryForward ? `carry_forward=${carryForward}` : null,
    "",
  ].filter(Boolean).join("\n")

  const auditNote = [
    `bridge ${fromTier || "?"}->${toTier || "?"}`,
    `${fromModel || "unset"} -> ${toModel || "unset"}`,
    reason,
  ].join(" | ")

  const tags = [
    `bridge:${bridgeId}`,
    `bridge:${toTier || "unknown"}`,
    `model:${toModel || "unset"}`,
    ...pipelineRoot.map((tier) => `pipeline:${tier}`),
  ]

  return {
    bridge_id: bridgeId,
    bridge_key: bridgeKey,
    session_id: sessionId,
    turn_id: String(input.turnId || "").trim() || null,
    created_at: createdAt,
    from_model: fromModel,
    from_tier: fromTier,
    to_model: toModel,
    to_tier: toTier,
    reason,
    project_fingerprint: projectFingerprint,
    project_name: projectName,
    pipeline_root: pipelineRoot,
    source_strategy: String(input.sourceStrategy || "").trim() || null,
    route_decision: routeDecisionSnapshot,
    verified_difficulty: {
      score: verifiedDifficulty.score,
      level: verifiedDifficulty.level,
      confidence: verifiedDifficulty.confidence,
      suggested_tier: verifiedDifficulty.suggestedTier,
    },
    selection: selectionSnapshot,
    orchestration: orchestrationSnapshot,
    cache: cacheSnapshot,
    active_job: activeJob || null,
    carry_forward: carryForward,
    prompt_prefix: promptPrefix,
    audit_note: auditNote,
    tags,
  }
}

export function recordSessionBridge(bridge: unknown): boolean {
  if (!bridge || typeof bridge !== "object") return false
  const sessionId = String(bridge.session_id || getCurrentSessionId() || _OC_SID || "unknown").trim()
  if (!sessionId) return false
  const bridgeKey = String(bridge.bridge_key || bridge.bridge_id || sessionId).trim()
  if (!bridgeKey) return false
  const bridgeId = String(bridge.bridge_id || "").trim()
  if (bridgeId && hasRecordedSessionBridge(sessionId, bridgeKey, bridgeId)) return false
  try {
    updateSessionOrchestration(sessionId, "batch", {
      actions: [
        { action: "annotate", payload: { note: `bridge_key=${bridgeKey} ${bridge.audit_note || "session bridge"}` } },
        { action: "retag", payload: { tags: Array.isArray(bridge.tags) ? ["bridge_key:" + bridgeKey, ...bridge.tags] : ["bridge_key:" + bridgeKey], replace: false } },
      ],
      bridge,
    })
  } catch {}
  try {
    saveJobRecord(bridge.bridge_id || sessionId, {
      kind: "session-bridge",
      status: "completed",
      completedAt: new Date().toISOString(),
      ...bridge,
    })
  } catch {}
  try { removeJobRecord(bridge.bridge_id || sessionId) } catch {}
  try {
    const dir = getVibeOSHome()
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, ".session-bridges.jsonl"), JSON.stringify({ _ts: new Date().toISOString(), ...bridge }) + "\n")
  } catch {}
  return true
}

export function loadLatestSessionBridge(projectFingerprint: string): unknown {
  const fp = String(projectFingerprint || "").trim()
  if (!fp) return null
  try {
    const file = join(getVibeOSHome(), ".session-bridges.jsonl")
    if (!existsSync(file)) return null
    const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i])
        if (entry && String(entry.project_fingerprint || "").trim() === fp) return entry
      } catch {}
    }
  } catch {}
  return null
}

// ── Footer Hook (from footer.ts) ──

const IS_CLI_RUNTIME = Boolean(process.stdout?.isTTY || process.stderr?.isTTY || process.stdin?.isTTY)
const IS_TEST_RUNTIME = process.env.VIBEOS_MCP_PORT === "0" || process.env.NODE_ENV === "test" || process.env.CI === "true"
const FOOTER_DEBUG_STDERR = process.env.VIBEOS_DEBUG_FOOTER === "1" || (!IS_CLI_RUNTIME && !IS_TEST_RUNTIME)

function footerDebug(...args: unknown[]) {
  if (FOOTER_DEBUG_STDERR) console.error(...args)
}

export function resetFooterRuntimeState(): void {
  _cachedAutoMode = null
  _cachedAutoModeTs = 0
  _cachedAutoModeSessionId = ""
  _cachedAutoModeHome = ""
  _cachedAutoModeKey = ""
  _prevOutputText = ""
  _autoReportCount = 0
  textCompletePainted.clear()
  _lastStrippedText = ""
}

let _cachedAutoMode = null
let _cachedAutoModeTs = 0
let _cachedAutoModeSessionId = ""
let _cachedAutoModeHome = ""
let _cachedAutoModeKey = ""
const AUTO_CACHE_TTL = 60000

const DEFAULT_REGIME_MAP = {
  LOOPING: "vibemax", DIVERGENT: "vibemax",
  EXPLORING: "vibemax", INIT: "vibemax",
  REFINING: "vibemax",
  CONVERGING: "quality", CLOSED: "quality",
}

function regimeToMode(regime, stress) {
  if (stress > 1.5) return "quality"
  return DEFAULT_REGIME_MAP[regime] || "vibemax"
}

async function apiAutoSelectMode(regime, stress) {
  const now = Date.now()
  const sessionId = getSessionId()
  const home = getVibeOSHome()
  const cacheKey = `${home}|${sessionId}|${String(regime || "")}|${String(stress || 0)}`
  if (
    _cachedAutoMode &&
    _cachedAutoModeHome === home &&
    _cachedAutoModeSessionId === sessionId &&
    _cachedAutoModeKey === cacheKey &&
    now - _cachedAutoModeTs < AUTO_CACHE_TTL
  ) return _cachedAutoMode
  try {
    const res = await remoteCall("blackboxSelectMode", [regime, stress], null)
    if (res?.mode) {
      _cachedAutoMode = res.mode
      _cachedAutoModeTs = now
      _cachedAutoModeSessionId = sessionId
      _cachedAutoModeHome = home
      _cachedAutoModeKey = cacheKey
      return res.mode
    }
  } catch (e) { footerDebug("[vibeOS] apiAutoSelectMode error:", e.message) }
  const fallback = regimeToMode(regime, stress)
  _cachedAutoMode = fallback
  _cachedAutoModeTs = now
  _cachedAutoModeSessionId = sessionId
  _cachedAutoModeHome = home
  _cachedAutoModeKey = cacheKey
  return fallback || "balanced"
}

let _prevOutputText = ""
let _autoReportCount = 0
const textCompletePainted = new Map()
let _lastStrippedText = ""

function isGreetingLike(text) {
  const value = String(text || "").trim().toLowerCase()
  return value === "hi" || value === "hello" || value === "hey" || value === "yo" || /^hi[!.?\s]*$/.test(value) || /^hello[!.?\s]*$/.test(value) || /^hey[!.?\s]*$/.test(value)
}

function getSessionId() {
  return getCurrentSessionId()
}

function scoreTaskQuality(outputText, promptText) {
  if (typeof outputText !== "string" || outputText.length === 0) return 0
  if (typeof promptText !== "string") promptText = ""

  let score = 50
  if (promptText.length > 0 && outputText.length > promptText.length * 0.5) score += 10
  if (outputText.length < 50) score -= 20
  if (/error|failed|unable|cannot|could not/i.test(outputText)) score -= 10
  if (/TODO|FIXME|placeholder/i.test(outputText) && outputText.length < 200) score -= 15
  const codeBlocks = (outputText.match(/```/g) || []).length
  if (codeBlocks >= 2) score += 10
  if (outputText.length > 500) score += 10
  if (outputText.length > 1000) score += 5

  return Math.max(0, Math.min(100, score))
}

function readRewardSignals() {
  try {
    const state = loadBlackboxState()
    const session = state?.sessions?.[getSessionId()] || {}
    const policy = session?.mode_policy || {}
    return {
      stableStreak: Math.max(0, Number(policy.stable_streak || 0)),
      problemStreak: Math.max(0, Number(policy.problem_streak || 0)),
    }
  } catch {
    return { stableStreak: 0, problemStreak: 0 }
  }
}

function buildRewardInput({
  finalOutcome,
  assistantText,
  userText,
  prevAssistantTexts,
  savingsUsd,
  isBrainTier,
  sessionId,
  turnId,
  projectFingerprint,
  cacheHit = false,
  cacheMiss = false,
}) {
  const lazinessResult = detectLaziness({
    assistantText,
    writeEditCount: 0,
    isBrainTier,
  })
  const claimStatus = evaluateClaimEvidence({
    text: assistantText,
    sessionId,
    turnId,
    userText,
    prevAssistantTexts,
  })
  const health = getSessionHealthSnapshot({
    sessionId,
    projectFingerprint,
    userText,
    assistantText,
    prevAssistantTexts,
    turnId,
  })
  return {
    outcome: finalOutcome,
    claims: claimStatus.status !== "supported" ? claimStatus.claims : [],
    laziness: lazinessResult,
    savingsUsd,
    contradictionDetected: claimStatus.status === "contradicted",
    metaWorkDrift: health.metaWorkDrift,
    cacheHit,
    cacheMiss,
  }
}

let _footerCacheText = ""
let _footerCacheTs = 0

function recordFooterProbe(input: {
  hook: string
  builder: string
  providerLabel?: string
  provider?: string
  modelId?: string
  modelName?: string
  activeSlot?: string
  sessionSlot?: string
  mode?: string
  messageID?: string | null
  footerLine?: string
}) {
  try {
    const sid = getSessionId()
    if (!sid) return
    const dir = join(getVibeOSHome(), "session-events")
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, `${sid}.jsonl`), JSON.stringify({
      ts: new Date().toISOString(),
      kind: "footer-probe",
      hook: input.hook,
      builder: input.builder,
      provider_label: input.providerLabel || "",
      provider: input.provider || "",
      model_id: input.modelId || "",
      model_name: input.modelName || "",
      active_slot: input.activeSlot || "",
      session_slot: input.sessionSlot || "",
      mode: input.mode || "",
      message_id: input.messageID || null,
      footer_line: input.footerLine || "",
    }) + "\n")
  } catch {}
}

function recordFooterError(input: { stage: string; message: string; stack?: string; hook?: string }) {
  try {
    const sid = getSessionId()
    if (!sid) return
    const dir = join(getVibeOSHome(), "session-events")
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, `${sid}.jsonl`), JSON.stringify({
      ts: new Date().toISOString(),
      kind: "footer-error",
      hook: input.hook || "",
      stage: input.stage || "unknown",
      message: input.message || "",
      stack: (input.stack || "").split("\n").slice(0, 4).join(" | "),
    }) + "\n")
  } catch {}
}


// ── Footer Helpers (module-level) ──

function _payload(obj) {
  if (obj?.message && typeof obj.message === "object") return obj.message
  return obj
}

function _extractText(obj) {
  const payload = _payload(obj)
  if (typeof payload?.text === "string") return payload.text
  if (typeof payload?.result === "string") return payload.result
  if (typeof payload?.content === "string") return payload.content
  if (Array.isArray(payload?.content)) return payload.content.filter(p => p?.type === "text").map(p => p.text).filter(Boolean).join("\n")
  if (Array.isArray(payload?.parts)) return payload.parts.filter(p => p?.type === "text").map(p => p.text).filter(Boolean).join("\n")
  return ""
}

function _setFooter(obj, text) {
  const target = _payload(obj)
  if (typeof target?.text === "string") target.text = text
  else if (typeof target?.result === "string") target.result = text
  else if (typeof target?.content === "string") target.content = text
  else if (Array.isArray(target?.content)) {
    const textParts = target.content.filter(p => p?.type === "text")
    if (textParts.length > 0) textParts[textParts.length - 1].text = text
    else target.content.push({ type: "text", text })
  } else if (Array.isArray(target?.parts)) {
    const textParts = target.parts.filter(p => p?.type === "text")
    if (textParts.length > 0) textParts[textParts.length - 1].text = text
    else target.parts.push({ type: "text", text })
  } else target.text = text
}

// ── Footer Display State Resolution (Single Source of Truth) ──
// Reads subsystem state. Does NOT mutate setCurrentModel/setCurrentTier.
// Those mutations belong in tool-execute.ts and pricing.ts.

async function resolveFooterDisplayState(
  directory: string,
  text: string,
  hookModel = "",
  lastModelError?: string,
  hookName = "experimental.text.complete",
): Promise<any> {
  _refreshModel(directory)
  let _footerStress = 0
  const quietIntent = isGreetingLike(latestUserIntent || "")
  if (latestUserIntent) _footerStress = scoreStress(latestUserIntent)
  let liveBlackboxState = quietIntent ? null : getLatestBlackboxState()
  const diskBlackboxState = quietIntent ? null : loadBlackboxState()
  try {
    const liveCascadeDepth = Number(
      liveBlackboxState?.control_vector?.cascade_depth ??
      liveBlackboxState?.cascade_depth ??
      0,
    ) || 0
    const diskCascadeDepth = Number(
      _cascadeRouteLen ??
      diskBlackboxState?.control_vector?.cascade_depth ??
      diskBlackboxState?.cascade_depth ??
      0,
    ) || 0
    if (
      diskBlackboxState &&
      (
        !liveBlackboxState ||
        diskCascadeDepth > liveCascadeDepth ||
        (diskBlackboxState?.sub_regime && !liveBlackboxState?.sub_regime)
      )
    ) {
      liveBlackboxState = diskBlackboxState
    }
  } catch {}
  let liveModelSetting = readLiveOpenCodeModel(directory) || ""
  if (hookModel) liveModelSetting = hookModel
  const sid = getSessionId()
  const { ltTasks, ltCache, ltCost, _count, sesTasks, sesEdit, sesCredit, sesC7, sesQuota, sesTaskDelegations, _sesDuration, _sesRatePerHour, sesTrend, _sesToolBreakdown, sesModelTurns, _quality_avg } = readLifetimeSavings()
  const { _stableStreak, _problemStreak } = readRewardSignals()

  const latestTurnTruth = getLatestTurnTruth(sid)
  const latestExecutedRoute = latestTurnTruth?.executedRoute || null
  const latestRouteDrivesVisibleAnswer = latestExecutedRoute?.contributedToFinalAnswer === true
  const latestFinalized = latestTurnTruth?.finalized || null
  const turnTruthSlot = (latestRouteDrivesVisibleAnswer ? latestExecutedRoute?.selectedSlot : "") || latestFinalized?.finalVisibleSlot || ""
  const sessionSlot = turnTruthSlot || loadBlackboxState()?.sessions?.[sid]?.active_slot || loadSessionSlot(sid)
  const slot = loadSelection().active_slot || sessionSlot || "brain"
  const brainModel = slot === "brain" ? (TRINITY_BRAIN || currentModel) : slot === "medium" ? (TRINITY_MEDIUM || currentModel) : (TRINITY_CHEAP || currentModel || "")
  const _cacheEvt = getLatestCacheEvent(sid)
  const _perTurnCacheDelta = _cacheEvt.hit ? _cacheEvt.est_savings_usd : 0
  const _cacheMiss = !_cacheEvt.hit
  let liveModel = liveModelSetting
  if (!liveModel) {
    liveModel = readConfig(directory) || readConfig(join(process.env.HOME || "", ".config", "opencode")) || process?.env?.OPENCODE_MODEL || ""
  }
  const displayModel = latestFinalized?.finalVisibleModel || (latestRouteDrivesVisibleAnswer ? latestExecutedRoute?.selectedModel : "") || liveModelSetting || liveModel || currentModel || ""
  const resolvedModel = displayModel || liveModelSetting || liveModel || currentModel || ""
  const backendMode = String(
    loadSelection().requested_optimization_mode ||
    loadSelection().optimization_mode ||
    loadOptimizationMode() ||
    liveBlackboxState?.optimization_mode ||
    "",
  ).trim().toLowerCase()
  const displayMode = backendMode || (quietIntent
    ? regimeToMode("INIT", _footerStress)
    : (isApiConnected()
      ? await apiAutoSelectMode(liveBlackboxState?.sub_regime || classifyTurnSimple(latestUserIntent || ""), _footerStress)
      : autoSelectMode(liveBlackboxState?.sub_regime || classifyTurnSimple(latestUserIntent || ""), _footerStress)))
  const ultraLiveModel = displayModel || liveModel || currentModel || TRINITY_CHEAP || TRINITY_MEDIUM || TRINITY_BRAIN || ""
  const ultraCascadeResolution = resolveActiveCascadeTier({
    liveSession: liveBlackboxState?.sessions?.[sid],
    diskSession: diskBlackboxState?.sessions?.[sid],
    legacyDepth: liveBlackboxState?.control_vector?.cascade_depth ?? liveBlackboxState?.cascade_depth
      ?? diskBlackboxState?.control_vector?.cascade_depth ?? diskBlackboxState?.cascade_depth ?? 0,
    liveModel: ultraLiveModel,
    trinityCheap: TRINITY_CHEAP,
    trinityMedium: TRINITY_MEDIUM,
    trinityBrain: TRINITY_BRAIN,
    classify,
  })
  const ultraResolvedTier = ultraCascadeResolution.tier
  const ultraCascadeDepth = latestRouteDrivesVisibleAnswer && Array.isArray(latestExecutedRoute?.routePath) && latestExecutedRoute.routePath.length
    ? latestExecutedRoute.routePath.length
    : (latestFinalized?.cascadeDepth ?? ultraCascadeResolution.depth) || 0
  const cascadeModel = (ultraCascadeResolution.source === "route" && ultraResolvedTier === "brain" ? TRINITY_BRAIN
    : ultraCascadeResolution.source === "route" && ultraResolvedTier === "medium" ? TRINITY_MEDIUM
    : null)
    || displayModel
    || (ultraResolvedTier === "brain" ? TRINITY_BRAIN : ultraResolvedTier === "medium" ? TRINITY_MEDIUM : TRINITY_CHEAP)
    || ""
  const execution = resolveCurrentExecution({
    directory,
    activeSlot: displayMode === "vibeultrax" ? ultraResolvedTier : slot || "brain",
    currentModel,
    liveModel: displayMode === "vibeultrax" ? cascadeModel : (displayModel || liveModel || currentModel || ""),
    tiersData: {
      trinity: {
        brain: { oc: TRINITY_BRAIN || currentModel },
        medium: { oc: TRINITY_MEDIUM || currentModel },
        cheap: { oc: TRINITY_CHEAP || currentModel },
      },
    },
  })
  const selNowFooter = loadSelection()
  const normalizedIntent = classifyTurnSimple(latestUserIntent || "")
  const currentSubRegime = quietIntent ? "INIT" : (liveBlackboxState?.sub_regime || normalizedIntent)
  const bbMode = resolveEnforcementMode()
  const CODING_REGIMES = new Set(["REFINING", "IMPLEMENTING", "CONVERGING", "REVIEWING"])
  const enfTags = buildEnforcementTags({
    delegationEnforce: selNowFooter.delegation_enforce,
    flowEnforce: selNowFooter.flow_enforce,
    tddEnforce: selNowFooter.tdd_enforce && CODING_REGIMES.has(currentSubRegime),
    bbMode,
    modelLocked: _modelLocked,
    quietIntent: isGreetingLike(latestUserIntent || ""),
  })
  const prevAssistantTexts = typeof _prevAssistantTexts !== "undefined" && Array.isArray(_prevAssistantTexts) ? _prevAssistantTexts : []
  const claimStatus = evaluateClaimEvidence({
    text,
    vibeHome: getVibeOSHome(),
    sessionId: sid,
    turnId: latestTurnTruth?.turnId || "",
    userText: latestUserIntent || "",
    prevAssistantTexts,
  })
  const sessionHealth = getSessionHealthSnapshot({
    sessionId: sid,
    projectFingerprint: currentProjectFingerprint || "",
    userText: latestUserIntent || "",
    assistantText: text,
    prevAssistantTexts,
    turnId: latestTurnTruth?.turnId || "",
  })
  const claimTag = claimStatus.claimTag || ""
  const ltTotal = ltTasks + ltCache
  const sessionCacheSavings = getSessionCacheSavings(readFullState()?.sessions?.[sid] || {})
  const sessionTotal = Number(sesTasks || 0) + Number(sessionCacheSavings || 0)
  const footerSavingsTotal = sessionTotal > 0 ? sessionTotal : ltTotal
  const activeSlot = turnTruthSlot || ultraResolvedTier
  const flashIcon = isApiConnected() ? " \u26A1" : ""
  const rawMode = displayMode
  const cv = computeControlVector({ sub_regime: currentSubRegime, latest_stress_multiplier: _footerStress, user_text: latestUserIntent || "" }, undefined, rawMode)
  const SUPPRESS_SYNC_MODES = new Set(["quality", "auto"])
  const isSuppressedMode = SUPPRESS_SYNC_MODES.has(String(displayMode || "").toLowerCase())
  const vibeBrand = isSuppressedMode ? "vibeOS" : resolveBrand(displayMode, activeSlot)
  const XP_SHOW_REGIMES = new Set(["CONVERGING", "CLOSED", "REVIEWING"])
  let _rewardTag = ""
  let _rewardOutcome = null
  let _rewardCredits = 0
  let _rewardBreakdown = null

  if (_blackboxEnabled) {
    try {
      const prevText = _prevOutputText
      if (prevText) {
        const outcome = detectOutcomeSignal(prevText)
        const regime = liveBlackboxState?.sub_regime || classifyTurnSimple(latestUserIntent || "")
        const stress = _footerStress
        const isLooping = String(regime || "").toUpperCase() === "LOOPING"
        const isStressed = Number(stress || 0) > 0.3
        const passiveNegative = (isLooping && isStressed) && !outcome ? "negative" : null
        const finalOutcome = outcome || passiveNegative
        if (finalOutcome) {
          _rewardOutcome = finalOutcome
          const tracker = getBlackboxTracker()
          tracker.recordOutcome(finalOutcome)
          try { syncOutcomeToApi(finalOutcome) } catch {}
          try {
            const rewardInput = buildRewardInput({
              finalOutcome,
              assistantText: prevText,
              userText: latestUserIntent || "",
              prevAssistantTexts,
              savingsUsd: _perTurnCacheDelta,
              isBrainTier: String(currentTier || "").toLowerCase() === "high",
              sessionId: sid,
              turnId: latestTurnTruth?.turnId || "",
              projectFingerprint: currentProjectFingerprint || "",
              cacheHit: _cacheEvt.hit,
              cacheMiss: _cacheMiss,
            })
            const rewardResult = computeReward(rewardInput)
            _rewardCredits = rewardResult.credits
            _rewardBreakdown = rewardResult.breakdown
            if (rewardResult.credits !== 0) {
              const suppressPositive = rewardResult.credits > 0 && !XP_SHOW_REGIMES.has(String(currentSubRegime || "").toUpperCase())
              if (!suppressPositive) {
                _rewardTag = rewardResult.credits > 0 ? `+${rewardResult.credits} XP` : `${rewardResult.credits} XP`
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  const _expectedModel = slot === "brain" ? TRINITY_BRAIN : slot === "medium" ? TRINITY_MEDIUM : TRINITY_CHEAP
  const _cascadeTierModels = new Set([TRINITY_CHEAP, TRINITY_MEDIUM, TRINITY_BRAIN].filter(Boolean))
  const _expectedForAlert = displayMode === "vibeultrax" && liveModelSetting && _cascadeTierModels.has(liveModelSetting)
    ? liveModelSetting
    : _expectedModel
  let _alertTag = ""
  try {
    const pendingSwitch = getPendingLiveSwitch()
    _alertTag = buildFooterAlert({
      apiDegraded: isApiFallback(),
      apiSlow: false,
      liveModel: liveModelSetting || undefined,
      expectedModel: _expectedForAlert || undefined,
      lastModelError,
      pendingLiveModel: pendingSwitch?.model || undefined,
    })
    if (!_alertTag && sessionHealth.risk !== "low" && sessionHealth.metaWorkDrift) {
      _alertTag = "\u21BB recover"
    }
  } catch {}

  const TIER_RANK: Record<string, number> = { cheap: 0, medium: 1, brain: 2 }
  const sessionRank = TIER_RANK[sessionSlot || ""] ?? -1
  const activeRankVal = TIER_RANK[activeSlot || ""] ?? -1
  const showDowngrade = Boolean(sessionSlot && sessionSlot !== activeSlot && sessionRank > activeRankVal)
  const downgradeWorkerSlot = showDowngrade ? `\u2193 ${sessionSlot}` : undefined

  return {
    activeSlot,
    sessionSlot,
    workerSlot: downgradeWorkerSlot,
    providerLabel: execution.provider_label,
    modelName: modelDisplayName(execution.model),
    savingsTotal: footerSavingsTotal,
    ltTrend: sesTrend,
    vibeBrand,
    optMode: isSuppressedMode ? "" : displayMode,
    flashIcon,
    enfTags,
    subRegime: currentSubRegime,
    stressGauge: formatStressGauge(_footerStress),
    cascadeIcon: ultraCascadeDepth >= 3 ? "\u25B8\u25B8\u25B8" : ultraCascadeDepth >= 2 ? "\u25B8\u25B8" : ultraCascadeDepth >= 1 ? "\u25B8" : "",
    cascadeLabel: "",
    rewardTag: _rewardTag || undefined,
    alertTag: _alertTag || undefined,
    sid, messageID: null, execution, liveModelSetting, resolvedModel, displayMode,
    displayModel, currentSubRegime, _footerStress, liveBlackboxState, diskBlackboxState,
    latestTurnTruth, latestExecutedRoute, turnTruthSlot, slot, brainModel, _cacheEvt,
    _perTurnCacheDelta, _cacheMiss, cv, isSuppressedMode, _rewardOutcome, _rewardCredits,
    _rewardBreakdown, claimTag: claimTag || "", downgradeWorkerSlot,
    cascadeDepthForIcon: Number(ultraCascadeDepth) || 0, footerSavingsTotal, sesTrend,
    ltTotal, ltCost, ltCache, sesTasks, sesEdit, sesCredit, sesC7, sesQuota,
    sesTaskDelegations, sesModelTurns, claimStatus, sessionHealth, stripped: "",
  }
}

// ── Gutted _appendFooter (thin orchestrator) ──

async function _appendFooter(input, output, directory, lastModelError?: string, hookName = "experimental.text.complete") {
  _refreshModel(directory)
  let _footerStage = "init"
  try {
    const text = _extractText(output)
    if (!text) return

    _footerStage = "resolve"
    const hookModel = String(input?.args?.model || input?.model || output?.args?.model || "").trim()
    const state = await resolveFooterDisplayState(directory, text, hookModel, lastModelError, hookName)
    state.messageID =
      input?.messageID ||
        input?.messageId ||
        input?.message?.id ||
        output?.messageID ||
        output?.messageId ||
        output?.message?.id ||
        null

    const footerSuffix = /\n\n\u2014 [^\n]+\u2014\s*$/
    const hasExistingFooter = footerSuffix.test(text)
    const stripped = hasExistingFooter ? text.replace(footerSuffix, "").trimEnd() : text
    state.stripped = stripped

    // Update _prevOutputText for next turn's reward detection
    const prevText = _prevOutputText
    _prevOutputText = text

    // Re-detect reward if text changed
    if (_blackboxEnabled && _prevOutputText && prevText && _prevOutputText !== prevText) {
      try {
        const rewardText = _prevOutputText
        const rewardOutcome = detectOutcomeSignal(rewardText)
        const rewardRegime = state.liveBlackboxState?.sub_regime || classifyTurnSimple(latestUserIntent || "")
        const rewardStress = state._footerStress
        const rewardPassiveNegative = (String(rewardRegime || "").toUpperCase() === "LOOPING" && Number(rewardStress || 0) > 0.3 && !rewardOutcome) ? "negative" : null
        const finalRewardOutcome = rewardOutcome || rewardPassiveNegative
        if (finalRewardOutcome) {
          state._rewardOutcome = finalRewardOutcome
          const tracker = getBlackboxTracker()
          tracker.recordOutcome(finalRewardOutcome)
          try { syncOutcomeToApi(finalRewardOutcome) } catch {}
          const rewardResult = computeReward(buildRewardInput({
            finalOutcome: finalRewardOutcome,
            assistantText: rewardText,
            userText: latestUserIntent || "",
            prevAssistantTexts: typeof _prevAssistantTexts !== "undefined" && Array.isArray(_prevAssistantTexts) ? _prevAssistantTexts : [],
            savingsUsd: state._perTurnCacheDelta,
            isBrainTier: String(currentTier || "").toLowerCase() === "high",
            sessionId: state.sid,
            turnId: state.latestTurnTruth?.turnId || "",
            projectFingerprint: currentProjectFingerprint || "",
            cacheHit: state._cacheEvt.hit,
            cacheMiss: state._cacheMiss,
          }))
          state._rewardCredits = rewardResult.credits
          state._rewardBreakdown = rewardResult.breakdown
          if (rewardResult.credits !== 0) {
            const XP_SHOW_REGIMES = new Set(["CONVERGING", "CLOSED", "REVIEWING"])
            const suppressPositive = rewardResult.credits > 0 && !XP_SHOW_REGIMES.has(String(state.currentSubRegime || "").toUpperCase())
            if (!suppressPositive) {
              state.rewardTag = rewardResult.credits > 0 ? `+${rewardResult.credits} XP` : `${rewardResult.credits} XP`
            }
          }
        }
      } catch {}
    }

    // Auto-report every 5th call
    _autoReportCount = (_autoReportCount || 0) + 1
    if (_autoReportCount % 5 === 0) {
      try {
        saveReport({
          type: "session",
          summary: "Session cost: $" + formatUsd(state.ltCost) + " | cache saved: $" + formatUsd(state.ltCache) + " | delegation saved: $" + formatUsd(Number(state.sesTasks || 0)) + " | task delegations: " + Number(state.sesTaskDelegations || 0),
          metrics: {
            sessionId: state.sid,
            projectFingerprint: currentProjectFingerprint || "unknown",
            projectName: currentProjectName || "unknown",
            sessionCost: state.ltCost,
            cacheSavings: state.ltCache,
            delegationSavingsUsd: state.sesTasks,
            taskDelegationCount: state.sesTaskDelegations,
            tasksDelegated: state.sesTaskDelegations,
            model: state.resolvedModel || currentModel,
            slot: loadSelection().active_slot || "unknown",
            editSavings: state.sesEdit,
            creditSavings: state.sesCredit,
            context7Savings: state.sesC7,
            quotaSavings: state.sesQuota,
          },
          tags: ["auto", "cost"],
        })
      } catch (e) { footerDebug("[vibeOS] auto-report:", e.message) }
    }

    _footerStage = "build"
    const vibeLine = buildFooterLine(state)
    recordFooterProbe({
      hook: hookName,
      builder: "rich",
      providerLabel: state.execution.provider_label,
      provider: state.execution.provider,
      modelId: state.execution.model,
      modelName: modelDisplayName(state.execution.model),
      activeSlot: state.activeSlot,
      sessionSlot: state.sessionSlot,
      mode: state.displayMode,
      messageID: state.messageID,
      footerLine: vibeLine,
    })
    if (stripped === _lastStrippedText && !state.claimTag) return
    if (state.messageID && textCompletePainted.has(state.messageID)) {
      const paintedLen = textCompletePainted.get(state.messageID)
      if (stripped.length <= paintedLen && !state.claimTag) return
    }
    _footerStage = "snapshot"
    try {
      recordLiveSessionSnapshot({
        sessionId: state.sid,
        projectFingerprint: currentProjectFingerprint || "",
        projectName: currentProjectName || "",
        outcome: state._rewardOutcome,
        rewardCredits: state._rewardCredits,
        rewardBreakdown: state._rewardBreakdown,
        savingsUsd: state._perTurnCacheDelta,
        footerLine: vibeLine,
        control: state.cv,
        subRegime: state.currentSubRegime,
        resolutionState: state._rewardOutcome === "positive" ? "working" : state._rewardOutcome === "negative" ? "needs_attention" : (state.liveBlackboxState?.resolution_state || state.liveBlackboxState?.resolution || "unresolved"),
        resolutionReason: state._rewardOutcome ? (state._rewardOutcome === "positive" ? "positive outcome" : "negative outcome") : "no outcome yet",
        nextAction: state._rewardOutcome === "negative"
          ? (getLatestBlackboxLoopMsg() || getLatestBlackboxPivotMsg() || (Array.isArray(state.cv?.directives) ? state.cv.directives[0] : "") || "")
          : (state.sessionHealth.recommendedAction || getLatestBlackboxPivotMsg() || (Array.isArray(state.cv?.directives) ? state.cv.directives[0] : "") || ""),
        loopInterventionLevel: state.liveBlackboxState?.loop_intervention_level || state.cv?.loop_intervention_level || "none",
        pivotDetected: Boolean(state.liveBlackboxState?.pivot_detected || state.sessionHealth.metaWorkDrift),
        stress: state._footerStress,
        source: "footer",
      })
    } catch (innerErr) {
      console.error("[vibeOS] footer recordLiveSessionSnapshot error:", innerErr?.message || innerErr)
    }
    _footerStage = "finalize"
    try {
      if (state.latestTurnTruth?.turnId) {
        recordTurnFinalize({
          sessionId: state.sid,
          turnId: state.latestTurnTruth.turnId,
          finalized: {
            finalVisibleModel: state.execution.model,
            finalVisibleSlot: state.activeSlot,
            finalVisibleProvider: state.execution.provider,
            finalVisibleProviderLabel: state.execution.provider_label,
            finalVisibleModelName: modelDisplayName(state.execution.model),
            footerLine: vibeLine,
            claimTag: state.claimTag || "",
            rewardTag: state.rewardTag || "",
            rewardCredits: state._rewardCredits,
            rewardOutcome: state._rewardOutcome || "",
            subRegime: state.currentSubRegime,
            enforcementMode: state.cv?.enforcement_mode || "",
            flowMode: state.cv?.flow_mode || "",
            tddMode: state.cv?.tdd_mode || "",
            cascadeDepth: state.cascadeDepthForIcon,
          },
        })
      }
    } catch (turnLedgerErr) {
      console.error("[vibeOS] footer turn ledger error:", turnLedgerErr?.message || turnLedgerErr)
    }
    const footerText = stripped + `\n\n${vibeLine}`
    _footerCacheText = `\n\n${vibeLine}`
    _footerCacheTs = Date.now()
    _setFooter(output, footerText)
    _lastStrippedText = stripped

    if (!process.stdout?.isTTY) {
      console.error(`\n${vibeLine} \u2014`)
    }

    if (state.messageID) textCompletePainted.set(state.messageID, stripped.length)
    if (textCompletePainted.size > 500) {
      const it = textCompletePainted.keys()
      for (let i = 0; i < 100; i++) textCompletePainted.delete(it.next().value)
    }
  } catch (err) {
    footerDebug(`[vibeOS] footer failed at stage=${_footerStage}: ${err?.message}`)
    recordFooterError({ stage: _footerStage, message: String(err?.message || err), stack: String(err?.stack || ""), hook: hookName })
  }
}

function didTextCompletePainted(messageID: string): boolean {
  return textCompletePainted.has(messageID)
}

// ── Exports ──

export { _appendFooter, scoreTaskQuality, readRewardSignals, buildRewardInput, didTextCompletePainted }
