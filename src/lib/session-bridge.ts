// SPDX-License-Identifier: MIT
// @ts-nocheck

import { createHash } from "node:crypto"

import { currentProjectFingerprint, currentProjectName, _OC_SID, getCurrentSessionId, removeJobRecord, saveJobRecord, updateSessionOrchestration, getActiveJobForProject, loadSelection, loadSessionOrchestration, _cacheDb } from "./state.js"
import { extractRecentCacheOutputs } from "../vibeOS-lib/smart-cache.js"

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
    return history.some((entry: any) => {
      const actions = Array.isArray(entry?.payload?.actions) ? entry.payload.actions : []
      return actions.some((action: any) => {
        const payload = action?.payload && typeof action.payload === "object" ? action.payload : {}
        const note = String(payload.note || "").trim()
        const tags = Array.isArray(payload.tags) ? payload.tags.map((tag: any) => String(tag || "").trim()) : []
        return note.includes(`bridge_key=${bridgeKey}`) || tags.includes(`bridge_key:${bridgeKey}`) || tags.includes(`bridge:${bridgeId}`)
      })
    })
  } catch {
    return false
  }
}

function summarizeSelection(selection: any): Record<string, unknown> {
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

function summarizeOrchestration(orchestration: any): Record<string, unknown> {
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

function summarizeCache(cacheDb: any): Record<string, unknown> {
  const db = cacheDb && typeof cacheDb === "object" ? cacheDb : {}
  const entries = Array.isArray(db.entries) ? db.entries : []
  const stats = db.stats && typeof db.stats === "object" ? db.stats : {}
  const toolStats = Object.values(stats).slice(0, 6).map((stat: any) => ({
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

export function recordSessionBridge(bridge: any): boolean {
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
  return true
}
