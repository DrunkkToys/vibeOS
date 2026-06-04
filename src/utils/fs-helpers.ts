import { existsSync, mkdirSync, readFileSync } from "node:fs"

// ── Directory helper ─────────────────────────────────────────────────
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true })
}

// ── JSON file reader (safe parse + corruption handling) ─────────────
export function readJsonFile(filePath: string, fallback: any = null): any {
  try {
    if (!existsSync(filePath)) return fallback
    const raw = readFileSync(filePath, "utf-8")
    return safeJsonParse(raw) ?? fallback
  } catch {
    return fallback
  }
}

// ── JSONC-tolerant JSON.parse ────────────────────────────────────────
export function safeJsonParse(raw: string): any {
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
