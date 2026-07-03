// SPDX-License-Identifier: MIT
// @ts-nocheck

import { createHash } from "node:crypto"
import { DEFAULT_TEMPLATE, TEMPLATE_LIBRARY as TEMPLATE_LIBRARY_SOURCE, normalizeSessionTemplate as normalizeSessionTemplateSource, resolveSessionTemplateDefinition as resolveSessionTemplateDefinitionSource } from "./templates.js"
import { getSessionCacheSavings, getSessionDelegationSavings } from "./session-savings.js"

export const TEMPLATE_LIBRARY = TEMPLATE_LIBRARY_SOURCE
export const normalizeSessionTemplate = normalizeSessionTemplateSource
export const resolveSessionTemplateDefinition = resolveSessionTemplateDefinitionSource

type AnyObject = Record<string, any>

type SessionNote = {
  id: string
  text: string
  created_at: string
}

type SessionHistoryEntry = {
  version: number
  action: string
  at: string
  payload: AnyObject | null
  snapshot: AnyObject
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
  version: number
  history: SessionHistoryEntry[]
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

function normalizeSessionSnapshot(raw: AnyObject | null | undefined, sessionId = "unknown"): Omit<SessionOrchestration, "history"> {
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
    version: Number(current.version || 1) || 1,
  }
}

function normalizeHistory(raw: AnyObject | null | undefined, sessionId = "unknown"): SessionHistoryEntry[] {
  return asArray(raw)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null
      const snapshotRaw = entry.snapshot || entry.state || entry.orchestration || null
      const snapshot = normalizeSessionSnapshot(snapshotRaw, sessionId)
      return {
        version: Number(entry.version || snapshot.version || 1) || 1,
        action: typeof entry.action === "string" && entry.action.trim() ? entry.action.trim() : "unknown",
        at: typeof entry.at === "string" && entry.at.trim() ? entry.at.trim() : new Date().toISOString(),
        payload: entry.payload && typeof entry.payload === "object" ? entry.payload : null,
        snapshot,
      }
    })
    .filter(Boolean)
}

function sanitizePayload(payload: AnyObject): AnyObject {
  const next: AnyObject = {}
  for (const [key, value] of Object.entries(payload || {})) {
    if (key === "history" || key === "snapshot" || key === "state" || key === "orchestration") continue
    next[key] = value
  }
  return next
}

function cloneSnapshot(session: Omit<SessionOrchestration, "history">): Omit<SessionOrchestration, "history"> {
  return {
    session_id: session.session_id,
    status: session.status,
    locked: session.locked,
    archived: session.archived,
    tags: [...session.tags],
    notes: [...session.notes],
    lifecycle: { ...session.lifecycle },
    template: session.template ? { ...session.template } : null,
    version: session.version,
  }
}

function diffStrings(left: string[], right: string[]): { added: string[]; removed: string[] } {
  return {
    added: right.filter((item) => !left.includes(item)),
    removed: left.filter((item) => !right.includes(item)),
  }
}

function extractSessionPlan(blackbox: AnyObject | null | undefined, sessionId: string): AnyObject | null {
  const session = blackbox?.sessions?.[sessionId] || null
  if (!session || typeof session !== "object") return null
  return session?.orchestration_plan || session?.cv?.orchestration_plan || session?.plan || null
}

export function normalizeSessionOrchestration(raw: AnyObject | null | undefined, sessionId = "unknown"): SessionOrchestration {
  const current = raw && typeof raw === "object" ? raw : {}
  const snapshot = normalizeSessionSnapshot(current, sessionId)
  const history = normalizeHistory(current.history, snapshot.session_id).slice(-20)
  const version = Number(current.version || snapshot.version || history.at(-1)?.version || 1) || 1
  return {
    ...snapshot,
    version,
    history,
  }
}

function applyCoreSessionAction(current: Omit<SessionOrchestration, "history">, action: string, payload: AnyObject, now: string): Omit<SessionOrchestration, "history"> {
  const next: Omit<SessionOrchestration, "history"> = {
    ...current,
    lifecycle: { ...current.lifecycle },
    notes: [...current.notes],
    tags: [...current.tags],
    template: current.template ? { ...current.template } : null,
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

export function applySessionAction(current: SessionOrchestration | null | undefined, action: string, payload: AnyObject = {}): SessionOrchestration {
  const now = new Date().toISOString()
  const base = normalizeSessionOrchestration(current, current?.session_id || payload.session_id || "unknown")
  const normalizedAction = String(action || "").toLowerCase()
  if (normalizedAction === "undo") {
    const last = [...base.history].pop()
    if (!last) return base
    return {
      ...cloneSnapshot(normalizeSessionOrchestration(last.snapshot, base.session_id)),
      version: last.version,
      history: base.history.slice(0, -1),
    }
  }

  if (normalizedAction === "batch") {
    const actions = normalizeBatchActions(payload.actions || payload.items || payload.batch || [])
    let next = base
    for (const entry of actions) {
      next = applyCoreSessionAction(next, entry.action, entry.payload, now)
    }
    return {
      ...next,
      version: base.version + 1,
      history: [...base.history, {
        version: base.version,
        action: "batch",
        at: now,
        payload: sanitizePayload({ actions }),
        snapshot: cloneSnapshot(base),
      }].slice(-20),
    }
  }

  const next = applyCoreSessionAction(base, normalizedAction, payload, now)
  if (!normalizedAction || normalizedAction === "noop") return { ...next, history: base.history, version: base.version }
  return {
    ...next,
    version: base.version + 1,
    history: [...base.history, {
      version: base.version,
      action: normalizedAction,
      at: now,
      payload: sanitizePayload(payload),
      snapshot: cloneSnapshot(base),
    }].slice(-20),
  }
}

export function resolveSessionTemplateOrDefault(template: any): ReturnType<typeof resolveSessionTemplateDefinition> {
  return resolveSessionTemplateDefinition(template || null)
}

type BatchAction = {
  action: string
  payload: AnyObject
}

function normalizeBatchActions(raw: any): BatchAction[] {
  return asArray(raw)
    .map((entry) => {
      if (!entry) return null
      if (typeof entry === "string") return { action: entry, payload: {} }
      if (typeof entry === "object") {
        const action = String(entry.action || entry.type || entry.name || "").trim()
        if (!action) return null
        const payload = entry.payload && typeof entry.payload === "object" ? entry.payload : entry
        return { action, payload }
      }
      return null
    })
    .filter(Boolean)
}

export function compareSessionOrchestrations(left: AnyObject | null | undefined, right: AnyObject | null | undefined): AnyObject {
  const a = normalizeSessionOrchestration(left, left?.session_id || "left")
  const b = normalizeSessionOrchestration(right, right?.session_id || "right")
  return {
    left: {
      session_id: a.session_id,
      version: a.version,
      status: a.status,
      locked: a.locked,
      archived: a.archived,
      notes_count: a.notes.length,
      template_signature: a.template?.signature || null,
      tags: a.tags,
    },
    right: {
      session_id: b.session_id,
      version: b.version,
      status: b.status,
      locked: b.locked,
      archived: b.archived,
      notes_count: b.notes.length,
      template_signature: b.template?.signature || null,
      tags: b.tags,
    },
    version_delta: b.version - a.version,
    status_changed: a.status !== b.status,
    lock_changed: a.locked !== b.locked,
    archive_changed: a.archived !== b.archived,
    notes_delta: b.notes.length - a.notes.length,
    tag_diff: diffStrings(a.tags, b.tags),
    template_changed: (a.template?.signature || null) !== (b.template?.signature || null),
    template_revision_delta: Number(b.template?.revision || 0) - Number(a.template?.revision || 0),
    lifecycle: {
      started_changed: a.lifecycle.started_at !== b.lifecycle.started_at,
      paused_changed: a.lifecycle.paused_at !== b.lifecycle.paused_at,
      resumed_changed: a.lifecycle.resumed_at !== b.lifecycle.resumed_at,
      archived_changed: a.lifecycle.archived_at !== b.lifecycle.archived_at,
      checked_out_changed: a.lifecycle.checked_out_at !== b.lifecycle.checked_out_at,
    },
  }
}

export function exportSessionOrchestration(session: AnyObject | null | undefined, sessionId = "unknown"): AnyObject {
  return normalizeSessionOrchestration(session, sessionId)
}

export function importSessionOrchestration(raw: AnyObject | null | undefined, sessionId = "unknown"): SessionOrchestration {
  return normalizeSessionOrchestration(raw, sessionId)
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
    delegation_savings_usd: getSessionDelegationSavings(session),
    cache_savings_usd: getSessionCacheSavings(session),
    duration_seconds: Number(metrics?.sesDuration ?? session?.duration_seconds ?? 0) || 0,
  }
}

function recommendationForSession(session: AnyObject, currentSession = false, blackbox?: AnyObject): string {
  if (!session) return currentSession ? "Open the active session" : "Select a session"
  if (session.archived) return "Archived: review notes or reopen"
  if (session.status === "paused") return "Resume the session"
  if (session.locked) return "Unlock to continue editing"
  const plan = extractSessionPlan(blackbox, String(session.session_id || ""))
  if (plan?.recommended_next_action) return String(plan.recommended_next_action)
  if (!session.template?.body) return "Apply a TDD template"
  if ((session.notes_count || 0) === 0) return "Add a note"
  const subRegime = blackbox?.sub_regime || blackbox?.regime
  if (subRegime === "LOOPING") return "Review loop intervention"
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

export function buildSessionListItem(sessionId: string, session: AnyObject, metrics: AnyObject = {}, isCurrent = false, blackbox: AnyObject = {}): AnyObject {
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
    recommendation: recommendationForSession({ ...sessionMetrics, ...orchestration, session_id: sessionId }, isCurrent, blackbox),
  }
}

export function buildSessionDetail(sessionId: string, session: AnyObject, metrics: AnyObject = {}, blackbox: AnyObject = {}, selection: AnyObject = {}): AnyObject {
  const orchestration = normalizeSessionOrchestration(session?.orchestration || {}, sessionId)
  const sessionMetrics = pickSessionMetrics(session, metrics)
  const template = resolveSessionTemplateOrDefault(orchestration.template)
  const plan = extractSessionPlan(blackbox, sessionId)
  const optimizationMode = String(
    session?.optimization_mode
    || session?.cv?.optimization_mode
    || selection?.optimization_mode
    || "auto",
  ).trim().toLowerCase() || "auto"
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
    version: orchestration.version,
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
    optimization_mode: optimizationMode,
    orchestration_plan: plan,
    blackbox: blackboxState,
    recommendation: recommendationForSession({
      ...sessionMetrics,
      ...orchestration,
      session_id: sessionId,
      template,
      notes_count: orchestration.notes.length,
    }, sessionId === selection?.current_session_id, blackbox),
    notes: orchestration.notes,
    history: orchestration.history,
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
  currentProjectName = "",
}: {
  currentSessionId: string
  status?: AnyObject
  savings?: AnyObject
  todos?: any[]
  blackbox?: AnyObject
  sessions?: AnyObject
  metrics?: AnyObject
  templates?: any[]
  currentProjectName?: string
}) {
  const rows = Object.entries(sessions || {}).map(([sessionId, session]) => buildSessionListItem(
    sessionId,
    session as AnyObject,
    sessionId === currentSessionId ? metrics : {},
    sessionId === currentSessionId,
    blackbox,
  ))
  const currentSession = buildSessionDetail(
    currentSessionId,
    sessions?.[currentSessionId] || {},
    metrics,
    blackbox,
    { ...status, current_session_id: currentSessionId, project_name: currentProjectName },
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
        { label: "Project", value: currentSession.project_name || "unknown" },
        { label: "Slot", value: status?.active_slot || "brain" },
        { label: "Mode", value: currentSession.optimization_mode || status?.optimization_mode || "auto" },
        { label: "Stress", value: blackbox?.sub_regime || "INIT" },
        { label: "Blackbox", value: currentSession.blackbox?.sub_regime || "INIT" },
        { label: "Savings", value: `$${totalSavings.toFixed(2)}` },
        { label: "TODOs", value: String(pendingTodos) },
      ],
    },
    savings,
    todos,
    current_session: currentSession,
    template_editor: {
      enabled: true,
      session_id: currentSession.session_id,
      template: currentSession.template,
      templates: asArray(templates).map((template) => normalizeSessionTemplate(template || null, template?.id || DEFAULT_TEMPLATE)).filter(Boolean),
      can_edit: true,
      can_version: true,
      version: currentSession.version,
      history: currentSession.history,
    },
    sessions: sortSessions(rows),
    templates,
    session_actions: ["start", "pause", "resume", "lock", "unlock", "retag", "annotate", "checkout", "archive", "undo", "batch"],
    totals: {
      total_sessions: rows.length,
      total_savings_usd: totalSavings,
      current_session_savings_usd: currentSavings,
      pending_todos: pendingTodos,
    },
  }
}
