// @ts-nocheck
import { currentTier, currentModel } from "../state.js"
import { _refreshModel } from "../pricing.js"
import { resolveTierIcon } from "./shared-footer.js"

let directory = ""

export const setShellDirectory = (dir) => { directory = dir || "" }

export const onShellEnv = async (_input, output) => {
  try {
    _refreshModel(directory || process.cwd())
    if (!output) output = {}
    output.env ??= {}
    output.env.OPENCODE_MODEL_TIER = currentTier || "unknown"
    output.env.OPENCODE_MODEL = currentModel || "unknown"
    const shellTier = currentTier === "high" ? "brain" : currentTier === "mid" ? "medium" : currentTier === "budget" ? "cheap" : currentTier === "free" ? "free" : currentTier || "unknown"
    output.env.VIBEOS_SHELL_BADGE = `${resolveTierIcon(shellTier)} ${shellTier} | ${currentModel || "unknown"}`
  } catch (e) { console.error("[vibeOS] shell.env error:", e) }
}
