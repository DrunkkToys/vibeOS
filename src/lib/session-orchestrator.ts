// SPDX-License-Identifier: MIT
// @ts-nocheck

import { createHash } from "node:crypto"
import { DEFAULT_TEMPLATE, TEMPLATE_LIBRARY as TEMPLATE_LIBRARY_SOURCE, normalizeSessionTemplate as normalizeSessionTemplateSource, resolveSessionTemplateDefinition as resolveSessionTemplateDefinitionSource } from "./templates.js"

export const TEMPLATE_LIBRARY = TEMPLATE_LIBRARY_SOURCE
export const normalizeSessionTemplate = normalizeSessionTemplateSource
export const resolveSessionTemplateDefinition = resolveSessionTemplateDefinitionSource

type AnyObject = Record<string, any>

type SessionNote = {
  id: string
  text: string
  created_at: string
}

type SessionLifecycle = {
  started_at: string | null
  paused_at: string | null
  resumed_at: string | null
  archived_at: string | null
  checked_out_at: string | null
}

export type SessionOrchestration = {
  session_id: string
  status: string
  locked: boolean
  archived: boolean
  tags: string[]
  notes: SessionNote[]
  lifecycle: SessionLifecycle
  template: ReturnType<typeof normalizeSessionTemplate> | null
}

function digest(text: string): string {
  return createHash("sha1").update(String(text || "")).digest("hex").slice(0, 12)
}

function asArray(v: any): any[] {
  return Array.isArray(v) ? v : []
}

function uniqueStrings(v: any): string[] {
  const out: string[] = []
  const source = typeof v === "string" ? v.split(",") : asArray(v)
  for (const item of source) {
    const text = String(item || "").trim()
    if (text && !out.includes(text)) out.push(text)
  }
  return out
}

function normalizeNotes(v: any): SessionNote[] {
  return asArray(v)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null
      const text = String(entry.text || entry.note || "").trim()
      if (!text) return null
      const created_at = typeof entry.created_at === "string"
        ? entry.created_at
        : typeof entry.createdAt === "string"
          ? entry.createdAt
          : new Date().toISOString()
      return {
        id: String(entry.id || digest(`${created_at}:${text}`)),
        text,
        created_at,
      }
    })
    .filter(Boolean)
}

function normalizeLifecycle(raw: AnyObject): SessionLifecycle {
  return {
    started_at: typeof raw.started_at === "string" ? raw.started_at : typeof raw.startedAt === "string" ? raw.startedAt : null,
    paused_at: typeof raw.paused_at === "string" ? raw.paused_at : typeof raw.pausedAt === "string" ? raw.pausedAt : null,
    resumed_at: typeof raw.resumed_at === "string" ? raw.resumed_at : typeof raw.resumedAt === "string" ? raw.resumedAt : null,
    archived_at: typeof raw.archived_at === "string" ? raw.archived_at : typeof raw.archivedAt === "string" ? raw.archivedAt : null,
    checked_out_at: typeof raw.checked_out_at === "string" ? raw.checked_out_at : typeof raw.checkedOutAt === "string" ? raw.checkedOutAt : null,
  }
}

export function normalizeSessionOrchestration(raw: AnyObject | null | undefined, sessionId = "unknown"): SessionOrchestration {
  const current = raw && typeof raw === "object" ? raw : {}
  const template = normalizeSessionTemplate(current.template || current.tdd_template || null, current.template?.base_template_id || DEFAULT_TEMPLATE)
  return {
    session_id: String(current.session_id || sessionId || "unknown"),
    status: typeof current.status === "string" && current.status.trim() ? current.status.trim() : "active",
    locked: Boolean(current.locked ?? current.lock ?? false),
    archived: Boolean(current.archived ?? false),
    tags: uniqueStrings(current.tags),
    notes: normalizeNotes(current.notes),
    lifecycle: normalizeLifecycle(current.lifecycle || current),
    template,
  }
}

export function applySessionAction(current: SessionOrchestration | null | undefined, action: string, payload: AnyObject = {}): SessionOrchestration {
  const now = new Date().toISOString()
  const base = normalizeSessionOrchestration(current, current?.session_id || payload.session_id || "unknown")
  const next: SessionOrchestration = {
    ...base,
    lifecycle: { ...base.lifecycle },
    notes: [...base.notes],
    tags: [...base.tags],
    template: base.template ? { ...base.template } : null,
  }

  switch (String(action || "").toLowerCase()) {
    case "start":
      next.status = "active"
      next.archived = false
      next.lifecycle.started_at = next.lifecycle.started_at || now
      next.lifecycle.resumed_at = now
      next.lifecycle.paused_at = null
      next.lifecycle.archived_at = null
      break
    case "pause":
      next.status = "paused"
      next.lifecycle.paused_at = now
      break
    case "resume":
      next.status = "active"
      next.lifecycle.resumed_at = now
      next.lifecycle.paused_at = null
      next.archived = false
      break
    case "lock":
      next.locked = true
      break
    case "unlock":
      next.locked = false
      break
    case "archive":
      next.status = "archived"
      next.archived = true
      next.lifecycle.archived_at = now
      break
    case "checkout":
      next.status = "checked_out"
      next.lifecycle.checked_out_at = now
      break
    case "annotate": {
      const text = String(payload.note || payload.text || payload.body || "").trim()
      if (text) {
        next.notes = [
          ...next.notes,
          { id: digest(`${now}:${text}`), text, created_at: now },
        ].slice(-50)
      }
      break
    }
    case "retag": {
      const tags = uniqueStrings(payload.tags || (payload.tag ? [payload.tag] : []))
      if (payload.replace === true) next.tags = tags
      else next.tags = uniqueStrings([...next.tags, ...tags])
      break
    }
    case "set-template":
      next.template = normalizeSessionTemplate(payload.template || payload, payload.template_id || payload.base_template_id || DEFAULT_TEMPLATE)
      if (next.template) {
        next.template.active = true
        next.template.revision = Number(next.template.revision || 1) + (payload.bumpRevision === false ? 0 : 1)
        next.template.updated_at = now
        next.template.signature = `${next.template.id}:${next.template.revision}:${digest(next.template.body)}`
      }
      break
    default:
      break
  }

  return next
}

export function resolveSessionTemplateOrDefault(template: any): ReturnType<typeof resolveSessionTemplateDefinition> {
  return resolveSessionTemplateDefinition(template || null)
}

function pickSessionMetrics(session: AnyObject, metrics: AnyObject = {}): AnyObject {
  const notes = normalizeNotes(session?.orchestration?.notes || [])
  const tags = uniqueStrings(session?.orchestration?.tags || [])
  return {
    cost_usd: Number(session?.cost_usd ?? 0) || 0,
    started: session?.started || session?.session_started_at || null,
    status: session?.orchestration?.status || "active",
    locked: Boolean(session?.orchestration?.locked),
    archived: Boolean(session?.orchestration?.archived),
    notes_count: notes.length,
    tags,
    template_id: session?.orchestration?.template?.id || DEFAULT_TEMPLATE,
    template_label: session?.orchestration?.template?.label || "Save",
    template_signature: session?.orchestration?.template?.signature || null,
    delegation_savings_usd: Number(metrics?.sesTasks ?? session?.total_savings_usd ?? 0) || 0,
    cache_savings_usd: Number(session?.cache_savings_usd ?? 0) || 0,
    duration_seconds: Number(metrics?.sesDuration ?? session?.duration_seconds ?? 0) || 0,
  }
}

function recommendationForSession(session: AnyObject, currentSession = false): string {
  if (!session) return currentSession ? "Open the active session" : "Select a session"
  if (session.archived) return "Archived: review notes or reopen"
  if (session.status === "paused") return "Resume the session"
  if (session.locked) return "Unlock to continue editing"
  if (!session.template?.body) return "Apply a TDD template"
  if ((session.notes_count || 0) === 0) return "Add a note"
  return currentSession ? "Continue with the next step" : "Review session details"
}

function sortSessions(items: any[]): any[] {
  return [...items].sort((a, b) => {
    if (a.is_current && !b.is_current) return -1
    if (!a.is_current && b.is_current) return 1
    const aTime = a.started_at ? Date.parse(a.started_at) : 0
    const bTime = b.started_at ? Date.parse(b.started_at) : 0
    return bTime - aTime
  })
}

export function buildSessionListItem(sessionId: string, session: AnyObject, metrics: AnyObject = {}, isCurrent = false): AnyObject {
  const orchestration = normalizeSessionOrchestration(session?.orchestration || {}, sessionId)
  const sessionMetrics = pickSessionMetrics(session, metrics)
  return {
    session_id: sessionId,
    is_current: isCurrent,
    started_at: sessionMetrics.started,
    cost_usd: sessionMetrics.cost_usd,
    delegation_savings_usd: sessionMetrics.delegation_savings_usd,
    cache_savings_usd: sessionMetrics.cache_savings_usd,
    status: orchestration.status,
    locked: orchestration.locked,
    archived: orchestration.archived,
    tags: orchestration.tags,
    notes_count: sessionMetrics.notes_count,
    template_label: sessionMetrics.template_label,
    template_signature: sessionMetrics.template_signature,
    recommendation: recommendationForSession({ ...sessionMetrics, ...orchestration }, isCurrent),
  }
}

export function buildSessionDetail(sessionId: string, session: AnyObject, metrics: AnyObject = {}, blackbox: AnyObject = {}, selection: AnyObject = {}): AnyObject {
  const orchestration = normalizeSessionOrchestration(session?.orchestration || {}, sessionId)
  const sessionMetrics = pickSessionMetrics(session, metrics)
  const template = resolveSessionTemplateOrDefault(orchestration.template)
  const blackboxState = {
    enabled: Boolean(blackbox?.enabled),
    sub_regime: blackbox?.sub_regime || blackbox?.regime || "INIT",
    resolution: blackbox?.resolution || "unresolved",
    momentum: Number(blackbox?.momentum ?? 0) || 0,
    loop_count: Number(blackbox?.loopCount ?? blackbox?.loop_count ?? 0) || 0,
  }
  const summary = {
    title: sessionId === selection?.current_session_id ? "Active Session" : "Session Workspace",
    session_id: sessionId,
    status: orchestration.status,
    locked: orchestration.locked,
    archived: orchestration.archived,
    project_name: session?.project_name || session?.projectName || selection?.project_name || "Current project",
    project_fingerprint: session?.project_fingerprint || selection?.project_fingerprint || null,
    started_at: sessionMetrics.started,
    cost_usd: sessionMetrics.cost_usd,
    delegation_savings_usd: sessionMetrics.delegation_savings_usd,
    cache_savings_usd: sessionMetrics.cache_savings_usd,
    notes_count: orchestration.notes.length,
    tags: orchestration.tags,
    template,
    blackbox: blackboxState,
    recommendation: recommendationForSession({
      ...sessionMetrics,
      ...orchestration,
      template,
      notes_count: orchestration.notes.length,
    }, sessionId === selection?.current_session_id),
    notes: orchestration.notes,
    lifecycle: orchestration.lifecycle,
    orchestration,
  }
  return summary
}

export function buildDashboardHomeModel({
  currentSessionId,
  status = {},
  savings = {},
  todos = [],
  blackbox = {},
  sessions = {},
  metrics = {},
  templates = TEMPLATE_LIBRARY,
}: {
  currentSessionId: string
  status?: AnyObject
  savings?: AnyObject
  todos?: any[]
  blackbox?: AnyObject
  sessions?: AnyObject
  metrics?: AnyObject
  templates?: any[]
}) {
  const rows = Object.entries(sessions || {}).map(([sessionId, session]) => buildSessionListItem(
    sessionId,
    session as AnyObject,
    sessionId === currentSessionId ? metrics : {},
    sessionId === currentSessionId,
  ))
  const currentSession = buildSessionDetail(
    currentSessionId,
    sessions?.[currentSessionId] || {},
    metrics,
    blackbox,
    { ...status, current_session_id: currentSessionId },
  )
  const totalSavings = Number(savings?.lifetime?.delegation_usd || 0) + Number(savings?.lifetime?.cache_usd || 0)
  const currentSavings = Number(savings?.current_session?.delegation_usd || 0) + Number(savings?.current_session?.cache_usd || 0)
  const pendingTodos = asArray(todos).filter((todo) => todo?.status === "pending").length

  return {
    home: {
      title: "Executive Summary",
      subtitle: "vibeOS session orchestrator",
      recommendation: currentSession.recommendation,
      cards: [
        { label: "Session", value: currentSession.session_id },
        { label: "Slot", value: status?.active_slot || "brain" },
        { label: "Mode", value: status?.optimization_mode || "auto" },
        { label: "Stress", value: blackbox?.sub_regime || "INIT" },
        { label: "Savings", value: `$${totalSavings.toFixed(2)}` },
        { label: "TODOs", value: String(pendingTodos) },
      ],
    },
    savings,
    todos,
    current_session: currentSession,
    sessions: sortSessions(rows),
    templates,
    session_actions: ["start", "pause", "resume", "lock", "unlock", "retag", "annotate", "checkout", "archive"],
    totals: {
      total_sessions: rows.length,
      total_savings_usd: totalSavings,
      current_session_savings_usd: currentSavings,
      pending_todos: pendingTodos,
    },
  }
}
