// @ts-nocheck

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, rmSync } from "node:fs"
import { join } from "node:path"
import { withFileLock, safeJsonParse, currentProjectFingerprint as liveProjectFingerprint, currentProjectName as liveProjectName, getCurrentSessionId, _handleStateCorruption, loadProjectState, saveProjectState, touchProjectBucket, getVibeOSHome } from "./state.js"
import { getOcSessionId } from "./runtime-state.js"

// Report data:
//   meta: { id, project, fingerprint, type, created, sessionId }
//   summary: string
//   findings: [{ severity, topic, detail }]
//   metrics: { [key]: number }
//   narrative: string (markdown)
//   tags: string[]
//   status: "pending" | "completed" | "failed" | "partial"
//   task_description: string
//   outcome_verified: boolean
function getReportsDir() {
  return join(getVibeOSHome(), "reports")
}

function getReportsIndexPath() {
  return join(getReportsDir(), "index.json")
}

export const REPORTS_DIR = getReportsDir()
export const REPORTS_INDEX = getReportsIndexPath()

export let currentProjectFingerprint = ""
export let currentProjectName = ""
export let currentSessionId = ""

export function setReportingContext({ fingerprint, projectName, sessionId }: { fingerprint?: string; projectName?: string; sessionId?: string } = {}) {
  if (fingerprint !== undefined) currentProjectFingerprint = fingerprint
  if (projectName !== undefined) currentProjectName = projectName
  if (sessionId !== undefined) currentSessionId = sessionId
}

function readJsonOrEmpty(filePath) {
  try {
    if (!existsSync(filePath)) return {}
    const st = statSync(filePath)
    if (st.size > 10485760) {
      _handleStateCorruption(filePath)
      return {}
    }
    return safeJsonParse(readFileSync(filePath, "utf-8"))
  } catch { _handleStateCorruption(filePath); return {} }
}

export function reportsIndex() {
  const idx = readJsonOrEmpty(getReportsIndexPath())
  if (!idx || !Array.isArray(idx.reports)) return { reports: [] }
  return idx
}

export function saveReportsIndex(idx) {
  try {
    const reportsIndexPath = getReportsIndexPath()
    const reportsDir = getReportsDir()
    withFileLock(reportsIndexPath, () => {
      mkdirSync(reportsDir, { recursive: true })
      writeFileSync(reportsIndexPath, JSON.stringify(idx, null, 2) + "\n")
    })
  } catch (err) {
    console.error(`[vibeOS] reports index write failed: ${err.message}`)
  }
}

export function generateReportId(type, fp) {
  const ts = new Date().toISOString().replace(/[:-]/g, "").replace(/\..+/, "")
  const rnd = Math.random().toString(36).slice(2, 6)
  return `${ts}-${(fp || "unknown").slice(0, 6)}-${type}-${rnd}`
}

// Dedup: skip save if last report of same type has identical summary within 5 min
const _reportDedupWindow = new Map()

function _wouldBeDuplicate(type, summary, scope) {
  if (typeof summary !== "string") return false
  const key = `${getVibeOSHome()}::${type || ""}::${String(scope || "unknown")}::${summary}`
  const last = _reportDedupWindow.get(key)
  if (last && (Date.now() - last) < 5 * 60 * 1000) return true
  _reportDedupWindow.set(key, Date.now())
  if (_reportDedupWindow.size > 200) {
    const oldest = [..._reportDedupWindow.entries()].sort((a, b) => a[1] - b[1])[0]
    if (oldest) _reportDedupWindow.delete(oldest[0])
  }
  return false
}

// Prune old reports: delete >90d, keep max 200
function _pruneReports() {
  try {
    const idx = reportsIndex()
    const now = Date.now()
    const keep = []
    for (const r of idx.reports) {
      const created = new Date(r.created).getTime()
      if (isNaN(created)) continue
      // >90d: delete
      if (now - created > 90 * 24 * 3600 * 1000) {
        try { rmSync(join(getReportsDir(), `${r.id}.json`)) } catch {}
        continue
      }
      keep.push(r)
    }
    // Keep max 200 (newest)
    const sorted = keep.sort((a, b) => b.created.localeCompare(a.created))
    const pruned = sorted.slice(0, 200)
    const dropped = sorted.slice(200)
    if (pruned.length !== idx.reports.length) {
      for (const r of dropped) {
        try { rmSync(join(getReportsDir(), `${r.id}.json`)) } catch {}
      }
      idx.reports = pruned
      saveReportsIndex(idx)
      console.warn(`[vibeOS] reports pruned: ${idx.reports.length} kept (from ${keep.length}), ${dropped.length} over-cap files deleted`)
    }
  } catch (err) {
    console.error(`[vibeOS] reports prune failed: ${err.message}`)
  }
}

// Auto-parse findings (string → array) for callers that pass plain text directly to saveReport
function _parseFindings(v) {
  if (Array.isArray(v)) return v
  if (typeof v !== "string" || !v.trim()) return []
  try { return JSON.parse(v) } catch {}
  const result = []
  for (const line of v.split("\n").map(l => l.trim()).filter(Boolean)) {
    const m = line.match(/^(warn|info|hint)\s*:\s*(.+?)\s*:\s*(.+)/i)
    if (m) result.push({ severity: m[1].toLowerCase(), topic: m[2].trim(), detail: m[3].trim() })
    else result.push({ severity: "info", topic: "Note", detail: line })
  }
  return result
}

function _parseMetrics(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) return v
  if (typeof v !== "string" || !v.trim()) return {}
  try { return JSON.parse(v) } catch {}
  const result = {}
  for (const line of v.split("\n").map(l => l.trim()).filter(Boolean)) {
    const m = line.match(/^([\w-]+)\s*=\s*([\d.]+)/)
    if (m) result[m[1]] = parseFloat(m[2])
  }
  return result
}

function _normalizeReportMetrics(metrics: Record<string, unknown>): Record<string, unknown> {
  const out = { ...(metrics || {}) }
  const sessionCost = Number(out.sessionCost ?? out.session_cost ?? out.cost_usd ?? out.session_cost_usd ?? NaN)
  if (Number.isFinite(sessionCost) && typeof out.sessionCost !== "number") out.sessionCost = sessionCost

  const taskDelegationCount = Number(out.taskDelegationCount ?? out.tasksDelegated ?? out.sesTaskDelegations ?? out.task_delegation_count ?? NaN)
  if (Number.isFinite(taskDelegationCount) && typeof out.taskDelegationCount !== "number") out.taskDelegationCount = taskDelegationCount
  if (Number.isFinite(taskDelegationCount) && typeof out.tasksDelegated !== "number") out.tasksDelegated = taskDelegationCount

  const delegationSavingsUsd = Number(out.delegationSavingsUsd ?? out.delegation_savings_usd ?? out.sesTasks ?? out.total_savings_usd ?? NaN)
  if (Number.isFinite(delegationSavingsUsd) && typeof out.delegationSavingsUsd !== "number") out.delegationSavingsUsd = delegationSavingsUsd

  return out
}

function _textHasProductionClaim(text) {
  const lower = String(text || "").toLowerCase()
  return (
    /\bproduction[-\s]?ready\b/.test(lower) ||
    /\bread(y|ied) for production\b/.test(lower) ||
    /\bworked in production\b/.test(lower) ||
    /\bworks in production\b/.test(lower) ||
    /\bshipped to production\b/.test(lower) ||
    /\bdeployed to production\b/.test(lower) ||
    /\bproduction claim\b/.test(lower) ||
    /\bproduction proof\b/.test(lower) ||
    /\bproduction verified\b/.test(lower) ||
    /\bin production\b/.test(lower) && /\b(worked|works|verified|proven|proved|shipped|deployed|confirmed|validated|fixed|passed)\b/.test(lower)
  )
}

function _productionEvidenceKind(metricsObject, tags = []) {
  const reportId = String(metricsObject?.reportId || metricsObject?.report_id || "").trim()
  if (reportId && reportId !== "unknown") return "report"

  const sessionId = String(metricsObject?.sessionId || metricsObject?.session_id || "").trim()
  if (sessionId && sessionId !== "unknown") return "session"

  if (metricsObject?.liveArtifact === true || metricsObject?.productionArtifact === true) return "artifact"

  const tagList = Array.isArray(tags) ? tags.map((tag) => String(tag || "").toLowerCase()) : []
  if (tagList.includes("live") || tagList.includes("session") || tagList.includes("production")) return "tag"

  return null
}

export function verifyProductionClaim({ summary = "", narrative = "", tags = [], metrics = {}, outcome_verified = false } = {}) {
  const claimDetected = _textHasProductionClaim(summary) || _textHasProductionClaim(narrative) || (Array.isArray(tags) && tags.some((tag) => _textHasProductionClaim(tag)))
  const metricsObject = metrics && typeof metrics === "object" && !Array.isArray(metrics) ? metrics : {}
  const evidence = _productionEvidenceKind(metricsObject, tags)
  const verified = claimDetected ? Boolean(evidence) : Boolean(outcome_verified)
  return {
    claimDetected,
    evidence,
    verified,
    note: claimDetected
      ? (evidence ? `production claim backed by ${evidence} evidence` : "production claims require a live session/report artifact")
      : null,
  }
}

export function saveReport({ type = "manual", summary = "", findings = null, metrics = null, narrative = "", tags = [], fingerprint = null, status = "pending", task_description = "", outcome_verified = false }: { type?: string; summary?: string; findings?: unknown; metrics?: unknown; narrative?: string; tags?: unknown[]; fingerprint?: string | null; status?: string; task_description?: string; outcome_verified?: boolean } = {}) {
  // Auto-parse findings + metrics (supports array, JSON string, plain-text lines)
  const parsedFindings = _parseFindings(findings)
  const parsedMetrics = _normalizeReportMetrics(_parseMetrics(metrics))
  if (type === "session") {
    if (typeof parsedMetrics.sessionCost !== "number") parsedMetrics.sessionCost = 0
    if (typeof parsedMetrics.taskDelegationCount !== "number") parsedMetrics.taskDelegationCount = 0
    if (typeof parsedMetrics.tasksDelegated !== "number") parsedMetrics.tasksDelegated = parsedMetrics.taskDelegationCount
    if (typeof parsedMetrics.delegationSavingsUsd !== "number") parsedMetrics.delegationSavingsUsd = 0
  }
  const metricsObject = parsedMetrics && typeof parsedMetrics === "object" && !Array.isArray(parsedMetrics) ? parsedMetrics : {}
  const metricsSessionId = typeof metricsObject.sessionId === "string" && metricsObject.sessionId.trim() ? metricsObject.sessionId.trim() : ""
  const metricsProjectName = typeof metricsObject.projectName === "string" && metricsObject.projectName.trim() ? metricsObject.projectName.trim() : ""
  const metricsProjectFingerprint = typeof metricsObject.projectFingerprint === "string" && metricsObject.projectFingerprint.trim() ? metricsObject.projectFingerprint.trim() : ""
  const dedupScope = fingerprint || metricsProjectFingerprint || liveProjectFingerprint || currentProjectFingerprint || metricsProjectName || liveProjectName || currentProjectName || "unknown"

  // Dedup: skip if last same-type report has same summary within 5 min
  if (_wouldBeDuplicate(type, summary, dedupScope)) return null

  if (!currentProjectFingerprint && metricsProjectFingerprint) currentProjectFingerprint = metricsProjectFingerprint
  if (!currentProjectName && metricsProjectName) currentProjectName = metricsProjectName
  if (!currentSessionId && metricsSessionId) currentSessionId = metricsSessionId

  const liveSessionId = getCurrentSessionId() || getOcSessionId() || ""
  const fp = fingerprint || metricsProjectFingerprint || liveProjectFingerprint || currentProjectFingerprint || "unknown"
  const projectName = metricsProjectName || liveProjectName || currentProjectName || "unknown"
  const sessionId = metricsSessionId || liveSessionId || currentSessionId || "unknown"
  const productionVerification = verifyProductionClaim({
    summary,
    narrative,
    tags,
    metrics: metricsObject,
    outcome_verified,
  })
  const normalizedOutcomeVerified = productionVerification.claimDetected
    ? productionVerification.verified
    : Boolean(outcome_verified)
  const id = generateReportId(type, fp)
  const report = {
    meta: { id, project: projectName, fingerprint: fp, type, created: new Date().toISOString(), sessionId },
    summary, findings: parsedFindings, metrics: parsedMetrics, narrative, tags, status, task_description, outcome_verified: normalizedOutcomeVerified,
    verification: productionVerification.claimDetected ? {
      kind: "production",
      evidence: productionVerification.evidence,
      note: productionVerification.note,
      verified: productionVerification.verified,
    } : null,
  }
  try {
    const reportsIndexPath = getReportsIndexPath()
    const reportsDir = getReportsDir()
    withFileLock(reportsIndexPath, () => {
      mkdirSync(reportsDir, { recursive: true })
      writeFileSync(join(reportsDir, `${id}.json`), JSON.stringify(report, null, 2) + "\n")
      const idx = reportsIndex()
      const _sum = (summary || "").slice(0, 80)
      idx.reports.push({ id, type, project: report.meta.project, fingerprint: fp, created: report.meta.created, summary: _sum })
      writeFileSync(reportsIndexPath, JSON.stringify(idx, null, 2) + "\n")
    })
    try {
      if (fp && fp !== "unknown") {
        const pstate = loadProjectState()
        touchProjectBucket(pstate, fp, {
          sessionId,
          projectName: projectName || "",
          reportId: id,
          topic: type || "report",
        })
        saveProjectState(pstate)
      }
    } catch {}
  } catch (err) {
    console.error(`[vibeOS] report/index write failed: ${err.message}`)
    return null
  }
  // Opportunistic TTL prune (once per process ≈ every save)
  _pruneReports()
  return id
}

export function listReports({ type, project, hours = 168, fingerprint }: { type?: string; project?: string; hours?: number; fingerprint?: string } = {}) {
  const cutoff = Date.now() - hours * 3600 * 1000
  const idx = reportsIndex()
  return idx.reports.filter(r => {
    if (type && r.type !== type) return false
    if (project && r.project !== project) return false
    if (fingerprint && r.fingerprint !== fingerprint) return false
    const created = new Date(r.created).getTime()
    if (isNaN(created) || created < cutoff) return false
    return true
  }).sort((a, b) => b.created.localeCompare(a.created))
}

export function readReport(id) {
  if (!id) return null
  if (!/^[\w-]+$/.test(String(id))) return null
  const path = join(getReportsDir(), `${id}.json`)
  try {
    if (!existsSync(path)) return null
    return safeJsonParse(readFileSync(path, "utf-8"))
  } catch { return null }
}
