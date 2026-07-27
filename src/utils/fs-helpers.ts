import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import { withFileLock } from "../lib/state.js"

// ── Directory helper ─────────────────────────────────────────────────
export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true })
}

// ── Append-only JSONL writer with line-count rotation ────────────────
// Appends `line` (or `lines`) to `filePath`, then trims the file down to
// the most recent `maxLines` whenever it grows past `checkEveryLines`
// appends since the last trim -- avoids unbounded on-disk growth for
// high-frequency logs (turn ledger, calibration buffer, loop audit,
// session health) without paying the read-whole-file cost on every write.
const _rotationCounters = new Map<string, number>()

export function appendJsonlWithRotation(
  filePath: string,
  lines: string | string[],
  maxLines = 5000,
  checkEveryLines = 200,
): void {
  ensureDir(filePath.slice(0, filePath.lastIndexOf("/")))
  const payload = Array.isArray(lines) ? lines.join("") : lines
  appendFileSync(filePath, payload)
  const count = (_rotationCounters.get(filePath) || 0) + 1
  if (count < checkEveryLines) {
    _rotationCounters.set(filePath, count)
    return
  }
  _rotationCounters.set(filePath, 0)
  try {
    withFileLock(filePath, () => {
      const raw = readFileSync(filePath, "utf-8")
      const allLines = raw.split("\n").filter(Boolean)
      if (allLines.length > maxLines) {
        const trimmed = allLines.slice(-maxLines).join("\n") + "\n"
        const tmp = filePath + ".tmp"
        writeFileSync(tmp, trimmed)
        renameSync(tmp, filePath)
      }
    }, { timeoutMs: 4000 })
  } catch {}
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
