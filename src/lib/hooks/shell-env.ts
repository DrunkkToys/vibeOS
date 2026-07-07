// @ts-nocheck
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { currentTier, currentModel } from "../state.js"
import { VIBEOS_API_TOKEN } from "../api-client.js"
import { loadSelection } from "../selection-manager.js"
import { resolveTrinityDisplayModel, classify, _refreshModel } from "../pricing.js"
import { getVibeOSHome, safeJsonParse } from "../state.js"
import { resolveTierIcon } from "./footer.js"

let directory = ""

export const setShellDirectory = (dir) => { directory = dir || "" }

export const onShellEnv = async (_input, output) => {
  try {
    _refreshModel(directory)
    const sel = loadSelection()
    const slot = sel?.active_slot || "brain"
    const tiersPath = join(getVibeOSHome(), "model-tiers.json")
    const tiers = existsSync(tiersPath) ? safeJsonParse(readFileSync(tiersPath, "utf-8")) : null
    const slotModel = slot === "brain" ? tiers?.trinity?.brain?.oc : slot === "medium" ? tiers?.trinity?.medium?.oc : slot === "cheap" ? tiers?.trinity?.cheap?.oc : ""
    const displayModel = slotModel
      || resolveTrinityDisplayModel(directory, slot, "", currentModel)
      || currentModel
      || (slot === "cheap" ? "opencode/big-pickle" : "")
    if (!output) output = {}
    output.env ??= {}
    const slotTier = slot === "brain" ? "high" : slot === "medium" ? "mid" : slot === "cheap" ? "budget" : ""
    const shellTier = slotTier || (displayModel ? classify(displayModel) : currentTier || "unknown")
    const shellSlot = shellTier === "high" ? "brain" : shellTier === "mid" ? "medium" : shellTier === "budget" ? "cheap" : shellTier === "free" ? "free" : shellTier || "unknown"
    output.env.OPENCODE_MODEL_TIER = shellTier || "unknown"
    output.env.OPENCODE_MODEL = displayModel || "unknown"
    output.env.VIBEOS_SHELL_BADGE = `${resolveTierIcon(shellSlot)} ${shellSlot} | ${displayModel || "unknown"}`
    output.env.VIBEOS_API_TOKEN = VIBEOS_API_TOKEN || ""
    output.env.VIBEOS_HOME = getVibeOSHome()
  } catch (e) { console.error("[vibeOS] shell.env error:", e) }
}
