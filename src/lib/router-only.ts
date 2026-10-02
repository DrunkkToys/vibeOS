// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { computeDifficulty } from "../vibeOS-lib/ml-router.js"
import { getVibeOSHome } from "./state.js"
import { safeJsonParse } from "../utils/fs-helpers.js"

type Slot = "cheap" | "medium" | "brain"

export function routerOnlyEnabled(): boolean {
  return process.env.VIBEOS_ROUTER_ONLY === "1"
}

export function slotForText(text: string): Slot {
  return computeDifficulty(text).suggestedTier
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
  const full = slotModel(slotForText(text))
  const i = full.indexOf("/")
  if (i <= 0) return
  message.model = { ...message.model, providerID: full.slice(0, i), modelID: full.slice(i + 1) }
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
