// @ts-nocheck
// Per-project memory (project-states.json): tech-stack detection, session/
// report/topic tracking, and pattern-learner promotion. Split out of
// state.ts (Phase D file-size cleanup).
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs"
import { join, dirname } from "node:path"
import { createHash } from "node:crypto"
import { safeJsonParse } from "../../utils/fs-helpers.js"
import { getVibeOSHome } from "../runtime-paths.js"
import { readJsonOrEmpty, withFileLock } from "../state.js"

export function projectFingerprint(dir: string): string {
  if (!dir) return "unknown"
  return createHash("sha256").update(dir).digest("hex").slice(0, 12)
}

export function loadProjectState(): unknown {
  const projectStateFile = join(getVibeOSHome(), "project-states.json")
  try {
    const state = readJsonOrEmpty(projectStateFile)
    if (state && typeof state === "object") {
      state.project_hashes ??= {}
      return state
    }
  } catch {}
  return { project_hashes: {} }
}

export function saveProjectState(state: unknown): void {
  const projectStateFile = join(getVibeOSHome(), "project-states.json")
  try {
    withFileLock(projectStateFile, () => {
      mkdirSync(dirname(projectStateFile), { recursive: true })
      const _tmp = projectStateFile + ".tmp." + Date.now()
      writeFileSync(_tmp, JSON.stringify(state, null, 2) + "\n", "utf-8")
      renameSync(_tmp, projectStateFile)
    })
  } catch (err) {
    console.error(`[vibeOS] project state write failed: ${err.message}`)
  }
}

// ── Tech stack detection ─────────────────────────────────────────────
export function detectTechStack(dir: string): string[] {
  const stacks: string[] = []
  try {
    const pkg = safeJsonParse(readFileSync(join(dir, "package.json"), "utf-8"))
    if (pkg) {
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript || existsSync(join(dir, "tsconfig.json"))) stacks.push("typescript")
      if (pkg.dependencies?.react || pkg.devDependencies?.react) stacks.push("react")
      stacks.push("javascript")
    }
  } catch {}
  try {
    if (existsSync(join(dir, "Cargo.toml"))) stacks.push("rust")
  } catch {}
  try {
    if (existsSync(join(dir, "go.mod"))) stacks.push("go")
  } catch {}
  try {
    if (existsSync(join(dir, "requirements.txt"))) stacks.push("python")
    if (existsSync(join(dir, "setup.py"))) stacks.push("python")
    if (existsSync(join(dir, "pyproject.toml"))) stacks.push("python")
  } catch {}
  return [...new Set(stacks)]
}

export function ensureProjectBucket(state: unknown, fp: string): unknown {
  state.project_hashes ??= {}
  if (!state.project_hashes[fp]) {
    state.project_hashes[fp] = {
      totalSessions: 0,
      researchChains: 0,
      context7Bypasses: 0,
      commonTopics: [],
      sessions: [],
      reports: [],
      updatedAt: null,
      lastSeen: null,
      techStack: detectTechStack(process.cwd()),
    }
  }
  return state.project_hashes[fp]
}

export function touchProjectBucket(state: unknown, fp: string, meta: { sessionId?: string; reportId?: string; topic?: string; projectName?: string } = {}): unknown {
  if (!fp || fp === "unknown") return null
  const bucket = ensureProjectBucket(state, fp)
  const now = new Date().toISOString()
  bucket.updatedAt = now
  bucket.lastSeen = now
  if (typeof meta.projectName === "string" && meta.projectName.trim()) {
    bucket.projectName = meta.projectName.trim()
  }
  if (typeof meta.sessionId === "string" && meta.sessionId.trim()) {
    bucket.sessions ??= []
    if (!bucket.sessions.includes(meta.sessionId)) {
      bucket.sessions.push(meta.sessionId)
      bucket.sessions = bucket.sessions.slice(-30)
      bucket.totalSessions = Number(bucket.totalSessions || 0) + 1
    }
    bucket.totalSessions = Math.max(Number(bucket.totalSessions || 0), bucket.sessions.length, 1)
  }
  if (typeof meta.reportId === "string" && meta.reportId.trim()) {
    bucket.reports ??= []
    if (!bucket.reports.includes(meta.reportId)) {
      bucket.reports.push(meta.reportId)
      bucket.reports = bucket.reports.slice(-50)
    }
  }
  if (typeof meta.topic === "string" && meta.topic.trim()) {
    bucket.commonTopics ??= []
    if (!bucket.commonTopics.includes(meta.topic)) {
      bucket.commonTopics.push(meta.topic)
      bucket.commonTopics = bucket.commonTopics.slice(-20)
    }
  }
  return bucket
}

// ── Pattern learning ─────────────────────────────────────────────────
export function promotedProjectPatterns(fp: string): unknown[] {
  try {
    const p = loadProjectState().project_hashes?.[fp]
    const out: unknown[] = []
    const collect = (rows: unknown, label: string) => {
      for (const row of Object.values(rows || {})) {
        const r = row as unknown
        const sessions = new Set(r?.sessions || [])
        const minSessions = label === "routine" ? 2 : 3
        if (sessions.size >= minSessions) out.push({ label, summary: r.summary, sessions: sessions.size, lastSeen: r.lastSeen || "" })
      }
    }
    collect(p?.userPatterns?.friction, "friction")
    collect(p?.userPatterns?.routines, "routine")
    out.sort((a, b) => b.sessions - a.sessions || String(b.lastSeen).localeCompare(String(a.lastSeen)))
    return out.slice(0, 3)
  } catch {
    return []
  }
}

export function projectPatternRows(fp: string): unknown[] {
  try {
    const p = loadProjectState().project_hashes?.[fp]
    const rows: unknown[] = []
    for (const [kind, label] of [["friction", "friction"], ["routines", "routine"]]) {
      for (const [key, row] of Object.entries(p?.userPatterns?.[kind] || {})) {
        const r = row as unknown
        const sessions = new Set(r?.sessions || [])
        rows.push({
          key,
          label,
          summary: r?.summary || key,
          count: Number(r?.count || 0),
          sessions: sessions.size,
          lastSeen: r?.lastSeen || "",
        })
      }
    }
    rows.sort((a, b) => b.sessions - a.sessions || b.count - a.count || String(b.lastSeen).localeCompare(String(a.lastSeen)))
    return rows
  } catch {
    return []
  }
}

export function clearProjectPatterns(fp: string): number {
  try {
    const pstate = loadProjectState()
    const bucket = pstate.project_hashes?.[fp]
    if (!bucket?.userPatterns) return 0
    const count = Object.keys(bucket.userPatterns.friction || {}).length + Object.keys(bucket.userPatterns.routines || {}).length
    bucket.userPatterns = { friction: {}, routines: {} }
    bucket.lastSeen = new Date().toISOString()
    saveProjectState(pstate)
    return count
  } catch (err) {
    console.error(`[vibeOS] pattern learner clear failed: ${err.message}`)
    return 0
  }
}
