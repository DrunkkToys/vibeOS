// @ts-nocheck
// Session scratchpad cache: per-session tool-output caching, hit detection,
// and decadence pruning. Split out of state.ts (Phase D file-size cleanup).
//
// IMPORTANT: does not import VIBEOS_HOME/SCRATCHPAD_*/_OC_SID as snapshotted
// `let` bindings from state.ts. Several tests re-import state.js with a
// cache-busting query (`state.js?iso=...`) to force a fresh top-level
// evaluation with a new VIBEOS_HOME; a plain (non-busted) import of this file
// from state.ts would otherwise resolve to a second, separate, permanently
// stale module instance. getVibeOSHome()/getOcSessionId() are stateless
// (read process.env / globalThis fresh on every call), so path/session
// values are computed fresh here instead, matching that behavior exactly.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, readdirSync, rmSync, copyFileSync, renameSync } from "node:fs"
import { join, dirname } from "node:path"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { safeJsonParse } from "../../utils/fs-helpers.js"
import { getVibeOSHome } from "../runtime-paths.js"
import { getOcSessionId } from "../runtime-state.js"
import {
  TOOL_NAME_NORMALIZE,
  SCRATCHPAD_TOOLS,
  stableJson,
  _readHead,
} from "../state.js"

const SCRATCHPAD_SESSION_TTL_MS = 48 * 60 * 60 * 1000
const SCRATCHPAD_MAX_AGE_SEC = Number(process.env.CLAUDE_SCRATCHPAD_MAX_AGE_SEC || 86400)
const MAX_SCRATCHPAD_FILES = 1000
const MAX_SCRATCHPAD_BYTES = 10 * 1024 * 1024
const MAX_SESSION_SCRATCHPAD_FILES = 200
const MAX_SESSION_SCRATCHPAD_BYTES = 2 * 1024 * 1024
const MAX_PTR_CANDIDATES = 50
const SUMMARY_HEAD_TRUNCATE = 500
const DECADENCE_FRESH_MS = 5 * 60 * 1000
const DECADENCE_COLD_MS = 24 * 60 * 60 * 1000
const DECADENCE_EXPIRE_MS = 48 * 60 * 60 * 1000
const DECADENCE_THROTTLE_MS = 60 * 1000

let _sessionCacheCleaned = false
let prunedThisProcess = false
let _lastDecadenceRun = 0

function getScratchpadRoot(): string { return join(getVibeOSHome(), "scratch") }
function getScratchpadGlobalDir(): string { return join(getScratchpadRoot(), "by-hash") }
function getScratchpadSessionsDir(): string { return join(getScratchpadRoot(), "sessions") }

export function getSessionRoot(): string { return join(getScratchpadSessionsDir(), getOcSessionId()) }
export function getSessionScratchpadDir(): string { return join(getSessionRoot(), "by-hash") }
export function getSessionIndexPath(): string { return join(getSessionRoot(), "index.jsonl") }
export function getGlobalIndexPath(): string { return join(getScratchpadRoot(), "index.jsonl") }
export function ensureSessionScratchpadDirs(): boolean {
  try {
    mkdirSync(getSessionScratchpadDir(), { recursive: true })
    return true
  } catch { return false }
}

export function safeCopyIntoSession(hash: string, fromPath: string, targetScratchpadDir: string = getSessionScratchpadDir()): void {
  try {
    mkdirSync(targetScratchpadDir, { recursive: true })
    const sessionPath = join(targetScratchpadDir, `${hash}.txt`)
    if (!existsSync(sessionPath)) {
      copyFileSync(fromPath, sessionPath)
      const globalSummary = join(getScratchpadGlobalDir(), `${hash}.summary.txt`)
      const sessionSummary = join(targetScratchpadDir, `${hash}.summary.txt`)
      if (existsSync(globalSummary) && !existsSync(sessionSummary)) {
        copyFileSync(globalSummary, sessionSummary)
      }
    }
  } catch {}
}

export function cleanupCurrentSessionScratchpad(): void {
  if (_sessionCacheCleaned) return
  _sessionCacheCleaned = true
  try {
    rmSync(getSessionRoot(), { recursive: true, force: true })
  } catch {}
}

export function indexAppend(hash: string, tool: string, size: number, extra?: unknown): void {
  try {
    const entryObj: unknown = {
      ts: new Date().toISOString(),
      hash, tool, size,
      pid: process.pid || 0,
      session: getOcSessionId(),
      source: "opencode",
      ...extra,
    }
    const entry = JSON.stringify(entryObj) + "\n"
    const globalIndex = getGlobalIndexPath()
    const sessionIndex = getSessionIndexPath()
    mkdirSync(dirname(globalIndex), { recursive: true })
    mkdirSync(dirname(sessionIndex), { recursive: true })
    appendFileSync(globalIndex, entry)
    appendFileSync(sessionIndex, entry)
  } catch (err) {
    console.error(`[vibeOS] index write failed: ${err.message}`)
  }
}

// ── Scratchpad hit detection ─────────────────────────────────────────
export const scratchpadHitsSeen = new Set<string>()

export function scanRecentScratchpad(dir: string, titleCase: string, maxScan: number = 2000): unknown {
  try {
    if (!existsSync(dir)) return null
    const entries = readdirSync(dir)
    const ptrFiles = entries.filter(e => e.endsWith(".ptr"))
    const ptrCandidates: Array<{ ptrPath: string, mtimeMs: number }> = []
    for (const pf of ptrFiles) {
      if (ptrCandidates.length >= MAX_PTR_CANDIDATES) break
      try {
        const st = statSync(join(dir, pf))
        ptrCandidates.push({ ptrPath: join(dir, pf), mtimeMs: st.mtimeMs })
      } catch {}
    }
    ptrCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
    let scanned = 0
    for (const { ptrPath } of ptrCandidates) {
      if (scanned++ >= maxScan) break
      try {
        const ptrData = safeJsonParse(readFileSync(ptrPath, "utf-8"))
        if (!ptrData?.contentHash) continue
        const ptrTool = typeof ptrData.tool === "string" ? (TOOL_NAME_NORMALIZE[ptrData.tool] || ptrData.tool) : null
        if (titleCase && ptrTool && ptrTool !== titleCase) continue
        const contentHash = String(ptrData.contentHash)
        const f = join(dir, `${contentHash}.txt`)
        if (!existsSync(f)) continue
        const st = statSync(f)
        const ageSec = (Date.now() - st.mtimeMs) / 1000
        if (ageSec > SCRATCHPAD_MAX_AGE_SEC) continue
        const sumPath = join(dir, `${contentHash}.summary.txt`)
        return { hash: contentHash, fullPath: f, sizeBytes: st.size, ageSec: Math.round(ageSec), summaryPath: existsSync(sumPath) ? sumPath : null }
      } catch {}
    }
    return null
  } catch {
    return null
  }
}

export function getScratchpadHit(toolLower: string, args: unknown, baseDir: string | null = null): unknown {
  if (!SCRATCHPAD_TOOLS.has(toolLower)) return null
  const titleCase = TOOL_NAME_NORMALIZE[toolLower]
  const inputJson = stableJson(args ?? {})
  const hash = createHash("sha256").update(`${titleCase}\n${inputJson}\n`).digest("hex").slice(0, 16)
  const sessionDir = baseDir || getSessionScratchpadDir()
  const sessionPath = join(sessionDir, `${hash}.txt`)
  let fullPath = existsSync(sessionPath) ? sessionPath : null
  if (!fullPath) {
    // Try pointer files (created by compressToolOutputs mapping input hash -> content hash)
    const ptrSessionPath = join(sessionDir, `${hash}.ptr`)
    const ptrPath = existsSync(ptrSessionPath) ? ptrSessionPath : null
    let resolvedHash = hash
    if (ptrPath) {
      try {
        const ptrData = safeJsonParse(readFileSync(ptrPath, "utf-8"))
        if (ptrData?.contentHash) {
          resolvedHash = ptrData.contentHash
          const rSessionPath = join(sessionDir, `${resolvedHash}.txt`)
          fullPath = existsSync(rSessionPath) ? rSessionPath : null
        }
      } catch {}
    }
    if (!fullPath) return null
  }
  try {
    const st = statSync(fullPath)
    const ageSec = (Date.now() - st.mtimeMs) / 1000
    if (ageSec > SCRATCHPAD_MAX_AGE_SEC) return null
    const summaryPath = join(sessionDir, `${hash}.summary.txt`)
    const finalSummary = existsSync(summaryPath) ? summaryPath : null
    return {
      hash, fullPath, sizeBytes: st.size, ageSec: Math.round(ageSec),
      summaryPath: finalSummary,
    }
  } catch { return null }
}

export function recordScratchpadObservation(toolLower: string, args: unknown, fileSize: number, meta: unknown = {}): void {
  if (!SCRATCHPAD_TOOLS.has(toolLower)) return
  try {
    const titleCase = TOOL_NAME_NORMALIZE[toolLower]
    const inputJson = stableJson(args ?? {})
    const hash = createHash("sha256").update(`${titleCase}\n${inputJson}\n`).digest("hex").slice(0, 16)
    const dedupeKey = `${toolLower}:${hash}`
    if (scratchpadHitsSeen.has(dedupeKey)) return
    scratchpadHitsSeen.add(dedupeKey)
    indexAppend(hash, toolLower, fileSize, { ...meta, input: inputJson.slice(0, 200) })
  } catch {}
}

// ── Scratchpad decadence pruning ──────────────────────────────────────────
export function _pruneScratchpadDir(targetDir: string, opts: { maxFiles?: number, maxBytes?: number, rotate?: boolean } = {}): { dataFiles: number, totalBytes: number, deleted: number, rotated: number } {
  const { maxFiles = MAX_SCRATCHPAD_FILES, maxBytes = MAX_SCRATCHPAD_BYTES, rotate = true } = opts
  const now = Date.now()
  if (!existsSync(targetDir)) return { dataFiles: 0, totalBytes: 0, deleted: 0, rotated: 0 }
  const entries = readdirSync(targetDir)
  let dataFiles = 0; let totalBytes = 0; let deleted = 0; let rotated = 0
  for (const entry of entries) {
    if (entry.endsWith(".meta.json") || entry.endsWith(".summary.txt")) continue
    const fullPath = join(targetDir, entry)
    let st: unknown
    try { st = statSync(fullPath) } catch { continue }
    const age = now - st.mtimeMs
    const hash = entry.replace(/\.txt$/, "")
    if (age > DECADENCE_EXPIRE_MS) {
      try { rmSync(fullPath) } catch {}
      const meta = join(targetDir, hash + ".meta.json")
      if (existsSync(meta)) try { rmSync(meta) } catch {}
      const summary = join(targetDir, hash + ".summary.txt")
      if (existsSync(summary)) try { rmSync(summary) } catch {}
      deleted++; continue
    }
    dataFiles++; totalBytes += st.size
    if (!rotate) continue
    if (age > DECADENCE_COLD_MS) {
      const summaryPath = join(targetDir, hash + ".summary.txt")
      if (!existsSync(summaryPath)) try {
        const content = readFileSync(fullPath, "utf-8")
        writeFileSync(summaryPath, content.slice(0, 200).replace(/\n+/g, " ").trim() + (content.length > 200 ? "…" : ""))
      } catch {}
      const head = _readHead(fullPath)
      if (!head.includes("[cold-storage]")) try {
        writeFileSync(fullPath, `[cold-storage] ${st.size}B original → ${hash}.summary.txt`)
        rotated++
      } catch {}
      continue
    }
    if (age > DECADENCE_FRESH_MS && st.size > 1024) {
      const summaryPath = join(targetDir, hash + ".summary.txt")
      if (!existsSync(summaryPath)) try {
        const content = readFileSync(fullPath, "utf-8")
        writeFileSync(summaryPath, content.slice(0, SUMMARY_HEAD_TRUNCATE).replace(/\n+/g, " ").trim() + (content.length > SUMMARY_HEAD_TRUNCATE ? "…" : ""))
      } catch {}
      const head = _readHead(fullPath)
      if (!head.includes("[warm-storage]") && !head.includes("[cold-storage]")) try {
        writeFileSync(fullPath, `[warm-storage] ${st.size}B original at ${hash}.summary.txt`)
        rotated++
      } catch {}
    }
  }
  if (dataFiles > maxFiles || totalBytes > maxBytes) {
    const kept = []
    for (const entry of entries) {
      if (entry.endsWith(".meta.json") || entry.endsWith(".summary.txt")) continue
      const fullPath = join(targetDir, entry)
      try {
        const st = statSync(fullPath)
        if (!st.isFile()) continue
        const head = _readHead(fullPath)
        if (head.includes("[cold-storage]") || head.includes("[warm-storage]")) continue
        kept.push({ entry, fullPath, mtime: st.mtimeMs, size: st.size })
      } catch {}
    }
    kept.sort((a, b) => b.mtime - a.mtime)
    while ((kept.length > maxFiles || kept.reduce((s, e) => s + e.size, 0) > maxBytes) && kept.length > 0) {
      const victim = kept.pop()
      if (!victim) break
      try { rmSync(victim.fullPath) } catch {}
      const hash = victim.entry.replace(/\.txt$/, "")
      const meta = join(targetDir, hash + ".meta.json")
      if (existsSync(meta)) try { rmSync(meta) } catch {}
      const summary = join(targetDir, hash + ".summary.txt")
      if (existsSync(summary)) try { rmSync(summary) } catch {}
      deleted++
      dataFiles--
      totalBytes -= victim.size
    }
  }
  return { dataFiles, totalBytes, deleted, rotated }
}

export function runDecadenceCycle(): void {
  const now = Date.now()
  if (now - _lastDecadenceRun < DECADENCE_THROTTLE_MS) return
  _lastDecadenceRun = now
  try {
    const sessionDir = getSessionScratchpadDir()
    _pruneScratchpadDir(sessionDir, { maxFiles: MAX_SESSION_SCRATCHPAD_FILES, maxBytes: MAX_SESSION_SCRATCHPAD_BYTES, rotate: true })
  } catch {}
}
export function applyDecadence() {
  const now = Date.now()
  if (now - _lastDecadenceRun >= DECADENCE_THROTTLE_MS) {
    _lastDecadenceRun = now
    try {
      const ses = _pruneScratchpadDir(getSessionScratchpadDir(), {
        maxFiles: MAX_SESSION_SCRATCHPAD_FILES,
        maxBytes: MAX_SESSION_SCRATCHPAD_BYTES,
        rotate: false,
      })
      if (ses.deleted > 0) {
        console.error(`[vibeOS] session-decadence: deleted=${ses.deleted} (${ses.dataFiles} files, ${Math.round(ses.totalBytes / 1024)}KB)`)
      }
    } catch (err) {
      console.error(`[vibeOS] session decadence error: ${err.message}`)
    }
    try {
      const glo = _pruneScratchpadDir(getScratchpadGlobalDir(), {
        maxFiles: MAX_SCRATCHPAD_FILES,
        maxBytes: MAX_SCRATCHPAD_BYTES,
        rotate: false,
      })
      if (glo.deleted > 0) {
        console.error(`[vibeOS] global-scratch-decadence: deleted=${glo.deleted} (${glo.dataFiles} files, ${Math.round(glo.totalBytes / 1024)}KB)`)
      }
    } catch (err) {
      console.error(`[vibeOS] global scratchpad decadence error: ${err.message}`)
    }
  }
}

// ── Cleanup stale session scratchpads ──────────────────────────────────────
export function cleanupStaleSessionScratchpads(): void {
  try {
    const sessionsDir = getScratchpadSessionsDir()
    if (!existsSync(sessionsDir)) return
    const dirs = readdirSync(sessionsDir)
    const now = Date.now()
    for (const d of dirs) {
      const full = join(sessionsDir, d)
      try {
        const st = statSync(full)
        if (now - st.mtimeMs > SCRATCHPAD_SESSION_TTL_MS) {
          rmSync(full, { recursive: true, force: true })
        }
      } catch {}
    }
  } catch {}
}

// ── Plugin scratchpad prune ───────────────────────────────────────────────
export function pruneScratchpadOnce(): void {
  if (prunedThisProcess) return
  prunedThisProcess = true
  try {
    const script = join(getVibeOSHome(), "hooks/scratchpad-prune.sh")
    if (existsSync(script)) {
      const child = spawn("bash", [script], { detached: true, stdio: "ignore" })
      child.unref()
    }
  } catch { /* prune is best-effort */ }
  cleanupStaleSessionScratchpads()
}

export { _sessionCacheCleaned, prunedThisProcess, _lastDecadenceRun }

// ── Scrapbook index ──────────────────────────────────────────────────
interface ScrapbookIndexEntry {
  hash: string
  tool: string
  size: number
  ts: string
  session?: string
  [key: string]: unknown
}

export function loadScrapbookIndex(): ScrapbookIndexEntry[] {
  try {
    const path = getGlobalIndexPath()
    if (!existsSync(path)) return []
    const raw = readFileSync(path, "utf-8")
    if (!raw.trim()) return []
    const entries: ScrapbookIndexEntry[] = []
    for (const line of raw.split("\n")) {
      const ln = line.trim()
      if (!ln) continue
      try {
        const rec = JSON.parse(ln)
        if (rec && typeof rec === "object" && rec.hash) entries.push(rec)
      } catch {}
    }
    return entries
  } catch { return [] }
}

export function saveScrapbookIndex(index: ScrapbookIndexEntry[]): void {
  try {
    const path = getGlobalIndexPath()
    mkdirSync(dirname(path), { recursive: true })
    const tmp = path + ".tmp"
    writeFileSync(tmp, index.map(e => JSON.stringify(e)).join("\n") + "\n")
    renameSync(tmp, path)
  } catch {}
}

function _scanScrubpadDir(dir: string): ScrapbookIndexEntry[] {
  const entries: ScrapbookIndexEntry[] = []
  try {
    if (!existsSync(dir)) return entries
    const files = readdirSync(dir).filter((f: string) => f.endsWith(".txt") && !f.endsWith(".summary.txt"))
    for (const f of files) {
      const hash = f.replace(/\.txt$/, "")
      const full = join(dir, f)
      try {
        const st = statSync(full)
        const head = _readHead(full)
        entries.push({ hash, tool: "unknown", size: st.size, ts: new Date(st.mtimeMs).toISOString(), head: head.slice(0, 100) })
      } catch {}
    }
  } catch {}
  return entries
}

export function rebuildScrapbookIndex(): ScrapbookIndexEntry[] {
  try {
    const sessionDir = getSessionScratchpadDir()
    const sessionEntries = _scanScrubpadDir(sessionDir)
    const index = Array.from(new Map(sessionEntries.map(e => [e.hash, e])).values())
    saveScrapbookIndex(index)
    return index
  } catch { return [] }
}
