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
import { upsertProjectPattern } from "./pattern-store.js"

import { TRINITY_CHEAP, TRINITY_MEDIUM } from "./pricing.js"
import {
  topKeywords,
  noteTaskRoutingLearning,
} from "./cascade.js"

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
    upsertProjectPattern(kind, key, summary, { ...meta, fingerprint: currentProjectFingerprint, projectName: currentProjectName || "" })
  } catch (err) {
    console.error(`[vibeOS] pattern learner write failed: ${err.message}`)
  }
}

function _recordFrictionPattern(key, summary, meta = {}) {
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

function _recordRoutinePattern(key, summary, meta = {}) {
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
    updateState((s: unknown) => {
      const sid = _OC_SID
      const nowIso = new Date().toISOString()
      s.sessions ??= {}
      const ses = s.sessions[sid] || {}
      if (!ses.started) ses.started = nowIso
      if (!ses.session_started_at) ses.session_started_at = ses.started
      if (!Array.isArray(ses.stress_history)) ses.stress_history = []
      ses.stress_history.push({ ts: new Date().toISOString(), score, level })
      if (ses.stress_history.length > 100) ses.stress_history = ses.stress_history.slice(-50)
      const scores = ses.stress_history.map((h: unknown) => h.score)
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
        const nowIso = new Date().toISOString()
        s.sessions[sid] = { started: nowIso, session_started_at: nowIso, total_savings_usd: 0, cache_savings_usd: 0, project_name: "", warns: [], cache_hits: [], seenWarnKeys: {} }
        if (currentProjectFingerprint) {
          s.sessions[sid].project_fingerprint = currentProjectFingerprint
        }
        if (currentProjectName) {
          s.sessions[sid].project_name = currentProjectName
        }
      }
      const ses = s.sessions[sid]
      // Other writers (e.g. saveBlackboxVector/Outcome) can create s.sessions[sid]
      // with a partial shape before recordSaving ever runs. Without this guard,
      // ses.warns.length below throws on undefined, and that throw gets retried
      // by withFileLock's inner busy-loop for its full timeout, three times over
      // (via updateState's outer retry) — silently burning ~6s and never persisting.
      ses.warns ??= []
      ses.cache_hits ??= []

      if (reason && firstWord) {
        const now = Date.now()
        const warnKey = `${_OC_SID}:${firstWord}`
        ses.seenWarnKeys ??= {}
        let deduped = false
        for (let i = ses.warns.length - 1; i >= 0 && !deduped; i--) {
          const w = ses.warns[i]
          if (w?.key === warnKey && (now - w.ts) < WARN_DEDUPE_WINDOW_MS) {
            w.count = (w.count || 1) + 1
            w.est_savings_usd = roundUsd(Number(w.est_savings_usd || 0) + saveEst)
            w.saveEst = roundUsd(Number(w.saveEst || 0) + saveEst)
            ses.total_savings_usd = roundUsd(Number(ses.total_savings_usd || 0) + saveEst)
            s.lifetime.total_savings_usd = roundUsd(Number(s.lifetime.total_savings_usd || 0) + saveEst)
            deduped = true
          }
        }
        if (!deduped) {
          ses.total_savings_usd = roundUsd(Number(ses.total_savings_usd || 0) + saveEst)
          s.lifetime.total_savings_usd = roundUsd(Number(s.lifetime.total_savings_usd || 0) + saveEst)
          s.lifetime.warn_count = (s.lifetime.warn_count || 0) + 1
          ses.warns.push({ key: warnKey, reason, saveEst, est_savings_usd: saveEst, firstWord, ts: now, count: 1, tool })
        }
        if (!ses.seenWarnKeys[warnKey]) {
          ses.seenWarnKeys[warnKey] = true
          try { noteTaskRoutingLearning(firstWord, TRINITY_CHEAP || TRINITY_MEDIUM || "unknown", `observed:${tool}`) } catch {}
        }
      }

      const cap = 30
      if (ses.warns.length > cap) {
        ses.warns = ses.warns.slice(-cap)
        const keys = Object.keys(ses.seenWarnKeys || {})
        if (keys.length > cap * 2) {
          ses.seenWarnKeys = Object.fromEntries(keys.slice(-cap * 2).map(k => [k, true]))
        }
      }

      try {
        const sd = getSessionScratchpadDir()
        if (sd) {
          const sp = join(sd, "delegation-state-hint.txt")
          try { writeFileSync(sp, JSON.stringify({ sid, total_savings: s.lifetime.total_savings_usd, last_reason: reason }), "utf8") } catch {}
        }
      } catch {}

      ses.last_reason = reason
      ses.last_save_est = saveEst
      s.last_updated = new Date().toISOString()

      _pruneOldSessions(s)
    })

    // Buffer ledger entry
    const projectFingerprint = typeof meta?.projectFingerprint === "string" && meta.projectFingerprint.trim()
      ? meta.projectFingerprint.trim()
      : currentProjectFingerprint || ""
    const projectName = typeof meta?.projectName === "string" && meta.projectName.trim()
      ? meta.projectName.trim()
      : currentProjectName || ""
    const sessionId = typeof meta?.sessionId === "string" && meta.sessionId.trim()
      ? meta.sessionId.trim()
      : getCurrentSessionId() || _OC_SID
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      usd: saveEst,
      sid: _OC_SID,
      tool,
      reason,
      saveEst,
      fgp: projectFingerprint,
    })
    _ledgerBuffer.push(entry)
    try {
      if (projectFingerprint) {
        const pstate = loadProjectState()
        touchProjectBucket(pstate, projectFingerprint, {
          sessionId,
          projectName,
          topic: tool || reason || "saving",
        })
        saveProjectState(pstate)
      }
    } catch {}
    if (_ledgerBuffer.length >= LEDGER_BUFFER_MAX) _flushLedgerBuffer()
    else if (!_ledgerBufferTimer) setLedgerBufferTimer(setTimeout(_flushLedgerBuffer, LEDGER_BUFFER_FLUSH_MS))

    return saveEst
  } catch {
    try { saveSessionCheckpoint() } catch {}
    return 0
  }
}

async function getApiClient() {
  try {
    const api = await import("../lib/api-client.js")
    return api.getApiClient?.() || null
  } catch { return null }
}
export { compressText } from "./text-compress.js"
