// SPDX-License-Identifier: MIT
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { computeDifficulty } from "../vibeOS-lib/ml-router.js"
import { getVibeOSHome } from "./state.js"
import { safeJsonParse } from "../utils/fs-helpers.js"

type Slot = "cheap" | "medium" | "brain"
const LADDER: Slot[] = ["cheap", "medium", "brain"]
const TEST_COMMAND = /(^|[\s;&|(])(pytest|py\.test|tox|jest|vitest|mocha|rspec|phpunit|(npm|pnpm|yarn|bun)( run)? test|node --test|go test|cargo test|mvn test|gradle test|make test|python3? -m (pytest|unittest))(\s|$)/
type CascadeSession = { level: number; lastTest: "pass" | "fail" | null }

export function routerOnlyEnabled(): boolean {
  return process.env.VIBEOS_ROUTER_ONLY !== "0"
}

export function cascadeEnabled(): boolean {
  return process.env.VIBEOS_CASCADE === "1"
}

export function isTestCommand(command: string): boolean {
  const c = String(command || "").trim()
  if (/^(grep|rg|cat|ls|find|echo)\b/.test(c)) return false
  return TEST_COMMAND.test(c)
}

export function clearlyTrivial(text: string): boolean {
  const d = computeDifficulty(text)
  return d.level === "simple" && d.confidence >= 0.85
}

type UserMessage = { model?: { providerID?: string; modelID?: string } } | null | undefined

export function routeUserMessage(sessionID: string | undefined, message: UserMessage, parts: unknown): void {
  if (!sessionID || !message || !message.model || !Array.isArray(parts)) return
  const text = parts
    .filter((p) => p?.type === "text" && typeof p?.text === "string" && !p?.synthetic)
    .map((p) => p.text)
    .join("\n")
    .trim()
  if (!text) return
  let slot: Slot = "cheap"
  if (cascadeEnabled()) {
    const states = readCascade()
    const cur = states[sessionID] || { level: 0, lastTest: null }
    const level = Math.min(cur.lastTest === "fail" ? cur.level + 1 : cur.level, LADDER.length - 1)
    states[sessionID] = { level, lastTest: null }
    writeCascade(states)
    slot = LADDER[level]
  } else if (!clearlyTrivial(text)) return
  const full = slotModel(slot)
  const i = full.indexOf("/")
  if (i <= 0) return
  message.model = { ...message.model, providerID: full.slice(0, i), modelID: full.slice(i + 1) }
}

export function recordToolResult(sessionID: string | undefined, tool: unknown, args: unknown, metadata: unknown): void {
  if (!cascadeEnabled() || !sessionID || tool !== "bash") return
  const command = String((args as { command?: unknown })?.command || "")
  const exit = (metadata as { exit?: unknown })?.exit
  if (typeof exit !== "number" || !isTestCommand(command)) return
  const states = readCascade()
  const cur = states[sessionID] || { level: 0, lastTest: null }
  states[sessionID] = { ...cur, lastTest: exit === 0 ? "pass" : "fail" }
  writeCascade(states)
}

function cascadeFile(): string {
  return join(getVibeOSHome(), "cascade-state.json")
}

function readCascade(): Record<string, CascadeSession> {
  try {
    const file = cascadeFile()
    if (!existsSync(file)) return {}
    const data = safeJsonParse(readFileSync(file, "utf-8"))
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, CascadeSession>) : {}
  } catch {
    return {}
  }
}

function writeCascade(states: Record<string, CascadeSession>): void {
  try {
    const file = cascadeFile()
    mkdirSync(getVibeOSHome(), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(states))
    renameSync(tmp, file)
  } catch {}
}

function slotModel(slot: Slot): string {
  try {
    const file = join(getVibeOSHome(), "model-tiers.json")
    if (!existsSync(file)) return ""
    const tiers = safeJsonParse(readFileSync(file, "utf-8")) as { trinity?: Record<string, { oc?: string }> } | null
    return String(tiers?.trinity?.[slot]?.oc || "").trim()
  } catch {
    return ""
  }
}
