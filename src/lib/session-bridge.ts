// SPDX-License-Identifier: MIT
// @ts-nocheck

import { createHash } from "node:crypto"

import { currentProjectFingerprint, currentProjectName, _OC_SID, getCurrentSessionId, saveJobRecord, updateSessionOrchestration, getActiveJobForProject } from "./state.js"

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

  const promptPrefix = [
    "[session bridge]",
    `bridge_id=${bridgeId}`,
    `source_session=${sessionId}`,
    `from=${fromTier || "unknown"}:${fromModel || "unset"}`,
    `to=${toTier || "unknown"}:${toModel || "unset"}`,
    `reason=${reason}`,
    pipelineRoot.length > 0 ? `pipeline=${pipelineRoot.join(" -> ")}` : null,
    input.sourceStrategy ? `source_strategy=${input.sourceStrategy}` : null,
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
  try {
    updateSessionOrchestration(sessionId, "batch", {
      actions: [
        { action: "annotate", payload: { note: bridge.audit_note || "session bridge" } },
        { action: "retag", payload: { tags: Array.isArray(bridge.tags) ? bridge.tags : [], replace: false } },
      ],
      bridge,
    })
  } catch {}
  try {
    saveJobRecord(bridge.bridge_id || sessionId, {
      kind: "session-bridge",
      status: "handoff",
      ...bridge,
    })
  } catch {}
  return true
}
