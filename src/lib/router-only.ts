// SPDX-License-Identifier: MIT
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { computeDifficulty } from "../vibeOS-lib/ml-router.js"
import { getVibeOSHome } from "./state.js"
import { safeJsonParse } from "../utils/fs-helpers.js"
import { loadSelection, loadSessionSlot, writeSelection, writeSessionSlot } from "./selection-manager.js"

type Slot = "cheap" | "medium" | "brain"
const LADDER: Slot[] = ["cheap", "medium", "brain"]
const TEST_COMMAND = /(^|[\s;&|(])(pytest|py\.test|tox|jest|vitest|mocha|rspec|phpunit|(npm|pnpm|yarn|bun)( run)? test|node --test|go test|cargo test|mvn test|gradle test|make test|python3? -m (pytest|unittest))(\s|$)/
const FAILURE_OUTPUT = /Traceback \(most recent call last\)|^\s*FAILED\b|\bFAILED \(|\b\d+ (failed|failures?)\b|\b[A-Z]\w*(Error|Exception): |:\d+(:\d+)?: (fatal )?error:|make(\[\d+\])?: \*\*\*|undefined reference to|Segmentation fault|\b(tests?|build) failed\b|\bstill (failing|fails|broken|not working)\b/im
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

export function reportsFailure(text: string): boolean {
  return FAILURE_OUTPUT.test(String(text || ""))
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
    const prior = states[sessionID]
    const cur = prior || { level: 0, lastTest: null }
    const failed = cur.lastTest === "fail" || (!!prior && reportsFailure(text))
    const level = Math.min(failed ? cur.level + 1 : cur.level, LADDER.length - 1)
    states[sessionID] = { level, lastTest: null }
    writeCascade(states)
    slot = LADDER[level]
  } else if (!clearlyTrivial(text)) return
  const full = slotModel(slot)
  const i = full.indexOf("/")
  if (i <= 0) return
  message.model = { ...message.model, providerID: full.slice(0, i), modelID: full.slice(i + 1) }
}

export function routeUltraXUserMessage(sessionID: string | undefined, message: UserMessage, parts: unknown): Slot | null {
  if (!sessionID || !message || !message.model || !Array.isArray(parts)) return null
  const sel = loadSelection() || {}
  if (String(sel.optimization_mode || "").trim().toLowerCase() !== "vibeultrax") return null
  if (sel.slot_locked === true) return null
  const pinned = sel.axis_overrides && typeof sel.axis_overrides === "object" ? sel.axis_overrides.tier : null
  if (LADDER.includes(pinned)) return null
  const text = parts
    .filter((p) => p?.type === "text" && typeof p?.text === "string" && !p?.synthetic)
    .map((p) => p.text)
    .join("\n")
    .trim()
  if (!text) return null
  const d = computeDifficulty(text)
  let rank = d.confidence >= 0.6 && d.level !== "moderate" ? LADDER.indexOf(d.suggestedTier) : 0
  const prior = LADDER.indexOf(loadSessionSlot(sessionID) as Slot)
  if (prior >= 0 && reportsFailure(text)) rank = Math.max(rank, Math.min(prior + 1, LADDER.length - 1))
  let slot: Slot | null = null
  for (let r = Math.max(rank, 0); r < LADDER.length && !slot; r++) if (slotModel(LADDER[r]).indexOf("/") > 0) slot = LADDER[r]
  if (!slot) return null
  const full = slotModel(slot)
  const i = full.indexOf("/")
  message.model = { ...message.model, providerID: full.slice(0, i), modelID: full.slice(i + 1) }
  writeSessionSlot(sessionID, slot)
  writeSelection("active_slot", slot)
  return slot
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
