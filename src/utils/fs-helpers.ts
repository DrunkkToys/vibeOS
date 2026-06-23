import { existsSync, mkdirSync, readFileSync } from "node:fs"

// ── Directory helper ─────────────────────────────────────────────────
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true })
}

// ── JSON file reader (safe parse + corruption handling) ─────────────
export function readJsonFile<T = unknown>(filePath: string, fallback: T | null = null): T | null {
  try {
    if (!existsSync(filePath)) return fallback
    const raw = readFileSync(filePath, "utf-8")
    return safeJsonParse<T>(raw) ?? fallback
  } catch {
    return fallback
  }
}

// ── JSONC-tolerant JSON.parse ────────────────────────────────────────
export function safeJsonParse<T = unknown>(raw: string): T | null {
  if (raw == null || raw === "") return null
  try {
    return JSON.parse(raw)
  } catch {}

  let cleaned = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1")
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}
