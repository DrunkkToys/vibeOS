// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { remoteCall } from "./api-client.js"
import { getVibeOSHome } from "./state.js"

export type DashboardProjectionKind = "status" | "savings" | "sessions" | "current_session"

export type DashboardMutation = {
  mutation_id: string
  sequence: number
  mutation_type: string
  session_id: string | null
  timestamp: string
  install_id: string
  workspace_id: string
  payload: Record<string, unknown>
}

type DashboardBridgeCache = {
  status?: unknown
  savings?: unknown
  sessions?: unknown
  current_session?: unknown
  updated_at?: string | null
}

type DashboardBridgeState = {
  sequence: number
  install_id: string
  workspace_id: string
  cache: DashboardBridgeCache
  pending: DashboardMutation[]
}

const DASHBOARD_BRIDGE_FILE = ".dashboard-bridge.json"

function bridgeFile(): string {
  return join(getVibeOSHome(), DASHBOARD_BRIDGE_FILE)
}

function workspaceId(): string {
  const cwd = String(process.cwd() || "").trim() || "unknown-workspace"
  return createHash("sha1").update(cwd).digest("hex")
}

function defaultState(): DashboardBridgeState {
  return {
    sequence: 0,
    install_id: randomUUID(),
    workspace_id: workspaceId(),
    cache: {
      updated_at: null,
    },
    pending: [],
  }
}

function loadBridgeState(): DashboardBridgeState {
  try {
    const file = bridgeFile()
    if (!existsSync(file)) return defaultState()
    const parsed = JSON.parse(readFileSync(file, "utf8"))
    if (!parsed || typeof parsed !== "object") return defaultState()
    return {
      sequence: Number(parsed.sequence || 0) || 0,
      install_id: String(parsed.install_id || randomUUID()),
      workspace_id: String(parsed.workspace_id || workspaceId()),
      cache: parsed.cache && typeof parsed.cache === "object" ? parsed.cache : {},
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
    }
  } catch {
    return defaultState()
  }
}

function saveBridgeState(state: DashboardBridgeState): void {
  try {
    const file = bridgeFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(state, null, 2), "utf8")
  } catch {}
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function sessionIdOf(value: unknown): string {
  const candidate = value && typeof value === "object"
    ? (value as Record<string, unknown>).session_id ?? (value as Record<string, unknown>).id
    : ""
  return String(candidate || "").trim()
}

function updateSessionList(listPayload: unknown, entry: unknown): unknown {
  if (!listPayload || typeof listPayload !== "object") return listPayload
  const list = Array.isArray((listPayload as Record<string, unknown>).sessions)
    ? clone((listPayload as Record<string, unknown>).sessions as unknown[])
    : []
  const sid = sessionIdOf(entry)
  if (!sid) return listPayload
  const idx = list.findIndex((item) => sessionIdOf(item) === sid)
  if (idx >= 0) list[idx] = entry
  else list.unshift(entry)
  return {
    ...(listPayload as Record<string, unknown>),
    sessions: list,
    total_sessions: list.length,
  }
}

function foldPending(state: DashboardBridgeState): DashboardBridgeCache {
  const cache = clone(state.cache || {})
  for (const mutation of state.pending) {
    const payload = mutation?.payload || {}
    if (mutation.mutation_type === "projection.refresh") {
      if ("status" in payload) cache.status = clone(payload.status)
      if ("savings" in payload) cache.savings = clone(payload.savings)
      if ("sessions" in payload) cache.sessions = clone(payload.sessions)
      if ("current_session" in payload) cache.current_session = clone(payload.current_session)
      cache.updated_at = String(payload.updated_at || mutation.timestamp || new Date().toISOString())
      continue
    }
    if (payload && typeof payload === "object") {
      if ("session" in payload && payload.session) {
        cache.current_session = {
          ...(cache.current_session && typeof cache.current_session === "object" ? cache.current_session as Record<string, unknown> : {}),
          session: clone(payload.session),
        }
      }
      if ("session_list_entry" in payload && payload.session_list_entry) {
        cache.sessions = updateSessionList(cache.sessions, clone(payload.session_list_entry))
      }
    }
  }
  return cache
}

function persist(state: DashboardBridgeState): DashboardBridgeState {
  saveBridgeState(state)
  return state
}

export function primeDashboardBridgeCache(snapshot: Record<string, unknown>): void {
  const state = loadBridgeState()
  state.cache = {
    ...state.cache,
    ...clone(snapshot),
    updated_at: new Date().toISOString(),
  }
  persist(state)
}

export function enqueueDashboardMutation(input: {
  mutation_type: string
  session_id?: string | null
  payload?: Record<string, unknown>
  coalesceKey?: string | null
}): DashboardMutation {
  const state = loadBridgeState()
  state.sequence += 1
  const mutation: DashboardMutation = {
    mutation_id: `${state.workspace_id}:${state.sequence}:${randomUUID()}`,
    sequence: state.sequence,
    mutation_type: String(input.mutation_type || "unknown"),
    session_id: input.session_id == null ? null : String(input.session_id || "").trim() || null,
    timestamp: new Date().toISOString(),
    install_id: state.install_id,
    workspace_id: state.workspace_id,
    payload: clone(input.payload || {}),
  }
  const coalesceKey = String(input.coalesceKey || "").trim()
  if (coalesceKey) {
    const idx = state.pending.findIndex((item) =>
      item.mutation_type === mutation.mutation_type &&
      item.session_id === mutation.session_id &&
      String((item.payload || {})._coalesce_key || "") === coalesceKey,
    )
    if (idx >= 0) {
      mutation.payload._coalesce_key = coalesceKey
      state.pending[idx] = mutation
      persist(state)
      return mutation
    }
    mutation.payload._coalesce_key = coalesceKey
  }
  state.pending.push(mutation)
  persist(state)
  return mutation
}

export function queueDashboardProjectionRefresh(input: {
  session_id?: string | null
  status?: unknown
  savings?: unknown
  sessions?: unknown
  current_session?: unknown
}): DashboardMutation {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (input.status !== undefined) payload.status = input.status
  if (input.savings !== undefined) payload.savings = input.savings
  if (input.sessions !== undefined) payload.sessions = input.sessions
  if (input.current_session !== undefined) payload.current_session = input.current_session
  return enqueueDashboardMutation({
    mutation_type: "projection.refresh",
    session_id: input.session_id == null ? null : String(input.session_id || "").trim() || null,
    coalesceKey: "projection.refresh",
    payload,
  })
}

export function getDashboardBridgeProjection(kind: DashboardProjectionKind, fallback: unknown): unknown {
  const state = loadBridgeState()
  const cache = foldPending(state)
  const value = cache[kind]
  if (value !== undefined && value !== null) return clone(value)
  return clone(fallback)
}

export async function fetchDashboardProjection(kind: DashboardProjectionKind, fallback: unknown, sessionId = ""): Promise<unknown> {
  const state = loadBridgeState()
  const remoteMethod = kind === "status"
    ? "dashboardStatus"
    : kind === "savings"
      ? "dashboardSavings"
      : kind === "sessions"
        ? "dashboardSessions"
        : "dashboardCurrentSession"
  const remoteArgs = kind === "current_session" ? [sessionId] : []
  const result = await remoteCall(remoteMethod, remoteArgs, null)
  if (result != null) {
    state.cache[kind] = clone(result)
    state.cache.updated_at = new Date().toISOString()
    persist(state)
    return result
  }
  return getDashboardBridgeProjection(kind, fallback)
}

export async function flushDashboardMutationQueue(): Promise<{ flushed: number; pending: number }> {
  const state = loadBridgeState()
  if (!state.pending.length) return { flushed: 0, pending: 0 }
  const replay = await remoteCall("dashboardMutationsReplay", [{
    install_id: state.install_id,
    workspace_id: state.workspace_id,
    mutations: state.pending,
  }], null)
  if (!replay || typeof replay !== "object") return { flushed: 0, pending: state.pending.length }
  const acknowledged = new Set(Array.isArray((replay as Record<string, unknown>).acknowledged_ids)
    ? ((replay as Record<string, unknown>).acknowledged_ids as unknown[]).map((item) => String(item || ""))
    : [])
  if (!acknowledged.size) return { flushed: 0, pending: state.pending.length }
  state.pending = state.pending.filter((item) => !acknowledged.has(item.mutation_id))
  const projections = (replay as Record<string, unknown>).projections
  if (projections && typeof projections === "object") {
    state.cache = {
      ...state.cache,
      ...(clone(projections) as DashboardBridgeCache),
      updated_at: new Date().toISOString(),
    }
  }
  persist(state)
  return { flushed: acknowledged.size, pending: state.pending.length }
}

export function getDashboardBridgeBacklogCount(): number {
  return loadBridgeState().pending.length
}
