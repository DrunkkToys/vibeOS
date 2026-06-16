// @ts-nocheck
import { join } from "node:path"
import { writeFileSync } from "node:fs"

import { observeToolPattern as semanticObserve } from "../vibeOS-lib/semantic-observer.js"
import {
  frictionSessionKeys,
  routineSessionKeys,
  getSessionScratchpadDir,
  saveActiveJobForProject,
  currentProjectFingerprint,
  currentProjectName,
  _OC_SID,
  loadProjectState,
  saveProjectState,
  ensureProjectBucket,
  touchProjectBucket,
  updateState,
  roundUsd,
  getCurrentSessionId,
  WARN_DEDUPE_WINDOW_MS,
  _ledgerBuffer,
  _flushLedgerBuffer,
  LEDGER_BUFFER_MAX,
  _ledgerBufferTimer,
  setLedgerBufferTimer,
  LEDGER_BUFFER_FLUSH_MS,
  saveSessionCheckpoint,
} from "./state.js"

import {
  _pruneOldSessions,
} from "./pattern-helpers.js"

import { TRINITY_CHEAP, TRINITY_MEDIUM } from "./pricing.js"
import {
  topKeywords,
  noteTaskRoutingLearning,
} from "./turn-classify.js"

let activeJob = null

import { VERBOSE_LINE_RE, BULLET_PATTERNS, COMPRESS_RATIO, COMPRESS_THRESHOLD, MIN_KEPT_LINES_RATIO, extractBulletLines } from "./text-compress.js"

export { VERBOSE_LINE_RE, BULLET_PATTERNS, COMPRESS_RATIO, COMPRESS_THRESHOLD, MIN_KEPT_LINES_RATIO, extractBulletLines }

// ── setActiveJobFromTaskPrompt ───────────────────────────────────────

export function setActiveJobFromTaskPrompt(prompt) {
  if (!prompt || typeof prompt !== "string") return
  const p = prompt.trim()
  if (p.length < 24) return
  activeJob = {
    prompt: p.slice(0, 1200),
    keywords: topKeywords(p, 12),
    updatedAt: new Date().toISOString(),
  }
  saveActiveJobForProject(activeJob)
}

// ── Pattern helpers ──────────────────────────────────────────────────

export function noteProjectPattern(kind, key, summary, meta = {}) {
  if (!currentProjectFingerprint || !key || !summary) return
  try {
    const pstate = loadProjectState()
    const bucket = ensureProjectBucket(pstate, currentProjectFingerprint)
    bucket.userPatterns ??= { friction: {}, routines: {} }
    bucket.userPatterns.friction ??= {}
    bucket.userPatterns.routines ??= {}
    const target = kind === "routine" ? bucket.userPatterns.routines : bucket.userPatterns.friction
    const now = new Date().toISOString()
    const row = target[key] || { kind, summary, count: 0, sessions: [], firstSeen: now, lastSeen: null }
    row.kind = kind
    row.summary = summary
    row.count = Number(row.count || 0) + 1
    row.sessions = [...new Set([...(row.sessions || []), getCurrentSessionId()])].slice(-10)
    row.lastSeen = now
    if (meta.family) row.family = meta.family
    if (meta.path) row.path = meta.path
    target[key] = row
    touchProjectBucket(pstate, currentProjectFingerprint, {
      sessionId: getCurrentSessionId(),
      projectName: currentProjectName || "",
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
  } catch (err) {
    console.error(`[vibeOS] pattern learner write failed: ${err.message}`)
  }
}

function recordFrictionPattern(key, summary, meta = {}) {
  const sessionKey = `friction:${key}`
  if (frictionSessionKeys.has(sessionKey)) return
  frictionSessionKeys.add(sessionKey)
  noteProjectPattern("friction", key, summary, meta)
  try {
    const client = getApiClient()
    if (client && _OC_SID) {
      client.patternsObserve(_OC_SID, meta?.family || meta?.path || "unknown", summary, key, currentProjectFingerprint || "")
        .catch(() => {})
    }
  } catch {}
}

function recordRoutinePattern(key, summary, meta = {}) {
  const sessionKey = `routine:${key}`
  if (routineSessionKeys.has(sessionKey)) return
  routineSessionKeys.add(sessionKey)
  noteProjectPattern("routine", key, summary, meta)
}

// ── Stress history persistence ───────────────────────────────────────

let _lastStressWrite = 0
const STRESS_WRITE_INTERVAL_MS = 15000

export function saveSessionStress(score: number, level: string): void {
  if (typeof score !== "number" || !isFinite(score)) return
  const now = Date.now()
  if (now - _lastStressWrite < STRESS_WRITE_INTERVAL_MS) return
  _lastStressWrite = now
  try {
    updateState((s: any) => {
      const sid = _OC_SID
      const ses = s.sessions?.[sid] || {}
      if (!Array.isArray(ses.stress_history)) ses.stress_history = []
      ses.stress_history.push({ ts: new Date().toISOString(), score, level })
      if (ses.stress_history.length > 100) ses.stress_history = ses.stress_history.slice(-50)
      const scores = ses.stress_history.map((h: any) => h.score)
      ses.maxSessionStress = Math.max(...scores)
      ses.avgSessionStress = scores.reduce((a: number, b: number) => a + b, 0) / scores.length
      s.sessions[sid] = ses
      return s
    })
  } catch {}
}

// ── observeToolPattern ───────────────────────────────────────────────

export function observeToolPattern(toolName, input = {}, output = {}, directory = "") {
  try {
    semanticObserve(toolName, input, output, directory)
  } catch (e) {
    console.error("[vibeOS] semantic observer error:", e)
  }
}

// ── recordSaving ──────────────────────────────────────────────────────

const MAX_SAVE_EST_PER_WARN = 5

export function recordSaving(tool, reason, saveEst, meta = {}) {
  try {
    if (!saveEst || saveEst <= 0) return 0
    if (saveEst > MAX_SAVE_EST_PER_WARN) saveEst = MAX_SAVE_EST_PER_WARN
    const firstWord = meta?.firstWord || tool || ""
    updateState((s) => {
      s.lifetime ??= { total_savings_usd: 0, cache_savings_usd: 0, missed_context7_usd: 0, session_count: 0, warn_count: 0 }
      s.sessions ??= {}
      const sid = _OC_SID
      if (!s.sessions[sid]) {
        s.sessions[sid] = { total_savings_usd: 0, cache_savings_usd: 0, project_name: "", warns: [], cache_hits: [], seenWarnKeys: {} }
        if (currentProjectFingerprint) {
          s.sessions[sid].project_fingerprint = currentProjectFingerprint
        }
        if (currentProjectName) {
          s.sessions[sid].project_name = currentProjectName
        }
      }
      const ses = s.sessions[sid]
      const warnKey = `${tool}:${reason}`
      const now = Date.now()
      if (!ses.seenWarnKeys) ses.seenWarnKeys = {}
      if (!ses.seenWarnKeys[warnKey]) {
        ses.total_savings_usd = (ses.total_savings_usd || 0) + saveEst
        s.lifetime.total_savings_usd = (s.lifetime.total_savings_usd || 0) + saveEst
        s.lifetime.warn_count = (s.lifetime.warn_count || 0) + 1
        ses.warns.push({ key: warnKey, reason, saveEst, est_savings_usd: saveEst, firstWord, ts: now, count: 1, tool })
      }
      if (!ses.seenWarnKeys[warnKey]) {
        ses.seenWarnKeys[warnKey] = true
        try { noteTaskRoutingLearning(firstWord, TRINITY_CHEAP || TRINITY_MEDIUM || "unknown", `observed:${tool}`) } catch {}
      }

      const cap = 30
      if (ses.warns.length > cap) {
        ses.warns = ses.warns.slice(-cap)
        const keys = Object.keys(ses.seenWarnKeys || {})
        if (keys.length > cap * 2) {
          ses.seenWarnKeys = Object.fromEntries(keys.slice(-cap * 2).map(k => [k, true]))
        }
      }
      return s
    })
  } catch { return 0 }

  try {
    const sid = getCurrentSessionId()
    const scratchDir = join(process.env.HOME || "", ".claude", "scratch", sid, "work")
    if (getSessionScratchpadDir && sid) {
      const target = getSessionScratchpadDir(sid)
      if (target) {
        const files = readDirSafe(target)
        if (files && files.length > 100) {
          const sorted = files.sort().slice(0, files.length - 80)
          for (const f of sorted) {
            try { rimrafSync(f) } catch {}
          }
        }
      }
    }
  } catch {}
}

function readDirSafe(p) {
  try { return readdirSync(p).map(f => join(p, f)) } catch { return [] }
}
import { readdirSync } from "node:fs"
function rimrafSync(p) {
  try { writeFileSync(p, "") } catch {}
}

export function compressText(text, level = "medium") {
  if (!text || typeof text !== "string") return text || ""
  if (text.length < 200) return text
  const lines = text.split("\n")
  if (lines.length < 6) return text
  const kept = [lines[0]]
  let c = 1
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]
    if (BULLET_PATTERNS.test(l)) { kept.push(l); c++ }
    else if (l.trim() && c / i < COMPRESS_RATIO && kept.length < lines.length * MIN_KEPT_LINES_RATIO) { kept.push(l); c++ }
  }
  while (kept.length < lines.length * MIN_KEPT_LINES_RATIO && kept.length < lines.length) kept.push(lines[kept.length])
  return kept.join("\n")
}


function getApiClient() {
  try {
    const api = require("../lib/api-client.js")
    return api.getApiClient?.() || null
  } catch { return null }
}
