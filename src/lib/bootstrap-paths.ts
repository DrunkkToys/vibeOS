import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { getVibeOSHome } from "./runtime-paths.js"

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function getTiersFile(): string {
  return join(getVibeOSHome(), "model-tiers.json")
}

export function getReportsDir(): string {
  return join(getVibeOSHome(), "reports")
}

export function getReportsIndex(): string {
  return join(getReportsDir(), "index.json")
}

export function getStateFile(): string {
  return join(getVibeOSHome(), "delegation-state.json")
}

export function getMcpRuntimeFile(): string {
  return join(getVibeOSHome(), "mcp-runtime.json")
}

// True if a process with this pid is currently alive. Used to detect a stale
// mcp-runtime.json left behind by a previous (now-dead) opencode process — the
// classic "dashboard points at a dead port" failure.
function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // ESRCH = no such process (dead). EPERM = exists but not ours (alive).
    return (err as NodeJS.ErrnoException)?.code === "EPERM"
  }
}

export function readPublishedMcpRuntime(): { baseUrl: string; port: number | null; updatedAt: string | null } | null {
  try {
    const runtimeFile = getMcpRuntimeFile()
    if (!existsSync(runtimeFile)) return null
    const runtime = safeJsonParse(readFileSync(runtimeFile, "utf-8")) as Record<string, unknown> | null
    // If the publishing process recorded a pid and that process is gone, the
    // port is dead — treat the runtime as stale so callers fall back instead of
    // hitting a long-dead MCP server.
    const pid = Number(runtime?.pid || 0)
    if (Number.isFinite(pid) && pid > 0 && !isProcessAlive(pid)) return null
    const baseUrl = String(runtime?.baseUrl || "").trim().replace(/\/$/, "")
    const port = Number(runtime?.port || 0)
    if (!baseUrl && !(Number.isFinite(port) && port > 0)) return null
    return {
      baseUrl: baseUrl || (Number.isFinite(port) && port > 0 ? `http://127.0.0.1:${port}` : ""),
      port: Number.isFinite(port) && port > 0 ? port : null,
      updatedAt: typeof runtime?.updatedAt === "string" ? runtime.updatedAt : null,
    }
  } catch {
    return null
  }
}

export function publishMcpRuntime(port: number, baseUrl: string): string | null {
  try {
    const resolvedPort = Number(port)
    if (!Number.isFinite(resolvedPort) || resolvedPort <= 0) return null
    const normalizedBase = String(baseUrl || `http://127.0.0.1:${resolvedPort}`).trim().replace(/\/$/, "")
    const file = getMcpRuntimeFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({
      port: resolvedPort,
      baseUrl: normalizedBase,
      pid: process.pid,
      updatedAt: new Date().toISOString(),
    }, null, 2) + "\n", "utf-8")
    return normalizedBase
  } catch {
    return null
  }
}
