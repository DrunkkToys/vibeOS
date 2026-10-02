// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { computeDifficulty } from "../vibeOS-lib/ml-router.js"
import { getVibeOSHome } from "./state.js"
import { safeJsonParse } from "../utils/fs-helpers.js"

type Slot = "cheap" | "medium" | "brain"

const _sessionSlot = new Map<string, Slot>()

export function routerOnlyEnabled(): boolean {
  return process.env.VIBEOS_ROUTER_ONLY === "1"
}

export function slotForText(text: string): Slot {
  return computeDifficulty(text).suggestedTier
}

export function noteUserMessage(sessionID: string | undefined, parts: unknown): void {
  if (!sessionID || !Array.isArray(parts)) return
  const text = parts
    .filter((p) => p?.type === "text" && typeof p?.text === "string" && !p?.synthetic)
    .map((p) => p.text)
    .join("\n")
    .trim()
  if (!text) return
  _sessionSlot.set(sessionID, slotForText(text))
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

type InputModel = { providerID?: string; modelID?: string; id?: string } | null | undefined
type ParamsOutput = { options?: Record<string, unknown> } | null | undefined

export function applyRoute(sessionID: string | undefined, inputModel: InputModel, output: ParamsOutput): void {
  if (!sessionID || !output) return
  const slot = _sessionSlot.get(sessionID)
  if (!slot) return
  const full = slotModel(slot)
  const i = full.indexOf("/")
  if (i <= 0) return
  const provider = full.slice(0, i)
  const modelID = full.slice(i + 1)
  if (String(inputModel?.providerID || "") !== provider) return
  if (String(inputModel?.modelID || inputModel?.id || "") === modelID) return
  output.options = output.options || {}
  output.options.model = modelID
}
