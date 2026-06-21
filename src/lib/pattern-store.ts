// @ts-nocheck

import { ensureProjectBucket, touchProjectBucket, loadProjectState, saveProjectState, getCurrentSessionId, currentProjectFingerprint, currentProjectName } from "./state.js"

export function upsertProjectPattern(kind, key, summary, meta = {}) {
  const fingerprint = String(meta?.fingerprint || currentProjectFingerprint || "").trim()
  if (!fingerprint || fingerprint === "unknown" || !key || !summary) return null

  const pstate = loadProjectState()
  const bucket = ensureProjectBucket(pstate, fingerprint)
  bucket.userPatterns ??= { friction: {}, routines: {} }
  bucket.userPatterns.friction ??= {}
  bucket.userPatterns.routines ??= {}

  const target = kind === "routine" ? bucket.userPatterns.routines : bucket.userPatterns.friction
  const now = new Date().toISOString()
  const row = target[key] || { kind, summary, count: 0, sessions: [], firstSeen: now, lastSeen: null }

  row.kind = kind
  row.summary = summary
  row.count = Number(row.count || 0) + 1
  row.sessions = [...new Set([...(row.sessions || []), ...(meta?.sessions || [getCurrentSessionId()])])].slice(-10)
  row.lastSeen = now

  if (meta?.family) row.family = meta.family
  if (meta?.path) row.path = meta.path

  target[key] = row
  touchProjectBucket(pstate, fingerprint, {
    sessionId: meta?.sessionId || getCurrentSessionId(),
    projectName: meta?.projectName || currentProjectName || "",
    topic: key,
  })

  const entries = Object.entries(target)
  if (entries.length > 50) {
    entries.sort((a, b) => String(b[1]?.lastSeen || "").localeCompare(String(a[1]?.lastSeen || "")))
    const kept = Object.fromEntries(entries.slice(0, 50))
    for (const k of Object.keys(target)) delete target[k]
    Object.assign(target, kept)
  }

  bucket.lastSeen = now
  saveProjectState(pstate)
  return row
}
