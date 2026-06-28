import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"
import { safeJsonParse, getOpenCodeHomes, getOpenCodeHome, getVibeOSHome } from "./state.js"

type JsonRecord = Record<string, any>
type TrinityConfig = Record<string, { oc?: string }>

export const VIBE_PRIMARY_AGENT = "vibe"
export const VIBE_TIER_AGENT_BY_SLOT: Record<string, string> = {
  cheap: "vibe-cheap",
  medium: "vibe-medium",
  brain: "vibe-brain",
}

export function tierAgentForSlot(slot: string | null): string | null {
  return VIBE_TIER_AGENT_BY_SLOT[String(slot || "").trim().toLowerCase()] || null
}

export function buildVibePrimaryAgent(model: string, existing: JsonRecord = {}): JsonRecord {
  return {
    ...(existing && typeof existing === "object" ? existing : {}),
    description: "VibeUltraX primary agent",
    mode: "primary",
    model,
    permission: {
      read: "allow",
      edit: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      bash: "allow",
      task: "allow",
      webfetch: "allow",
      websearch: "allow",
      ...(existing?.permission && typeof existing.permission === "object" ? existing.permission : {}),
    },
  }
}

export function buildVibeTierAgent(slot: string, model: string, existing: JsonRecord = {}): JsonRecord {
  return {
    ...(existing && typeof existing === "object" ? existing : {}),
    description: `VibeUltraX ${slot} tier subagent`,
    mode: "subagent",
    model,
    permission: {
      read: "allow",
      edit: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      bash: "allow",
      task: "allow",
      webfetch: "allow",
      websearch: "allow",
      ...(existing?.permission && typeof existing.permission === "object" ? existing.permission : {}),
    },
  }
}

export function collectOpenCodeConfigPaths(projectDir = "", options: { includeGlobalHomes?: boolean } = {}): string[] {
  const { includeGlobalHomes = true } = options
  const candidates: string[] = []
  if (projectDir) {
    candidates.push(join(projectDir, "opencode.json"))
    candidates.push(join(projectDir, ".opencode", "opencode.json"))
  }
  if (includeGlobalHomes) {
    for (const home of getOpenCodeHomes()) candidates.push(join(home, "opencode.json"))
    candidates.push(join(getOpenCodeHome(), "opencode.json"))
  }
  const seen = new Set<string>()
  return candidates.filter((path) => {
    if (!path || seen.has(path)) return false
    seen.add(path)
    return true
  })
}

export function readOpenCodeConfig(path: string): JsonRecord {
  if (!existsSync(path)) return {}
  const parsed = safeJsonParse(readFileSync(path, "utf-8"))
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
}

// Atomic write (tmp + rename) — this file is read live by other plugin instances
// (a project can be loaded both globally and per-project in the same OpenCode
// process) and, on the desktop app, by the renderer's own config reader. A plain
// writeFileSync leaves a window where a concurrent reader sees a truncated/partial
// JSON file; renaming a fully-written temp file into place is atomic on the same
// filesystem, matching the convention used everywhere else in this codebase
// (see TIERS_FILE/state writes in pricing.ts and state.ts).
export function writeOpenCodeConfig(path: string, config: JsonRecord): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n")
  renameSync(tmp, path)
}

export function installVibeTierAgentsInConfig(config: JsonRecord, trinity: TrinityConfig, activeSlot: string | null = null): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false
  config.$schema ||= "https://opencode.ai/config.json"
  config.agent = config.agent && typeof config.agent === "object" ? config.agent : {}
  let changed = false
  const primaryModel = String(trinity?.cheap?.oc || "").trim()
  if (primaryModel) {
    const existing = config.agent[VIBE_PRIMARY_AGENT]
    const next = buildVibePrimaryAgent(primaryModel, existing)
    if (JSON.stringify(existing || null) !== JSON.stringify(next)) {
      config.agent[VIBE_PRIMARY_AGENT] = next
      changed = true
    }
    if (config.default_agent !== VIBE_PRIMARY_AGENT) {
      config.default_agent = VIBE_PRIMARY_AGENT
      changed = true
    }
  }
  for (const slot of ["cheap", "medium", "brain"]) {
    const model = String(trinity?.[slot]?.oc || "").trim()
    const name = tierAgentForSlot(slot)
    if (!model || !name) continue
    const existing = config.agent[name]
    const next = buildVibeTierAgent(slot, model, existing)
    if (JSON.stringify(existing || null) !== JSON.stringify(next)) {
      config.agent[name] = next
      changed = true
    }
  }
  return changed
}

export function installVibeTierAgents(projectDir = "", trinity: TrinityConfig, activeSlot: string | null = null, options: { includeGlobalHomes?: boolean } = {}): { changed: string[]; checked: string[] } {
  const changed: string[] = []
  const checked: string[] = []
  for (const path of collectOpenCodeConfigPaths(projectDir, options)) {
    checked.push(path)
    const config = readOpenCodeConfig(path)
    if (!config || typeof config !== "object") continue
    if (installVibeTierAgentsInConfig(config, trinity, activeSlot)) {
      writeOpenCodeConfig(path, config)
      changed.push(path)
    } else if (!existsSync(path)) {
      writeOpenCodeConfig(path, config)
      changed.push(path)
    }
  }
  return { changed, checked }
}

export function readDefaultAgent(projectDir = ""): string {
  for (const path of collectOpenCodeConfigPaths(projectDir)) {
    try {
      const config = readOpenCodeConfig(path)
      const value = String(config?.default_agent || "").trim()
      if (value) return value
    } catch {}
  }
  return ""
}

export function runtimeTierCoherence(projectDir = "", activeSlot = "", currentModel = "", expectedModel = ""): JsonRecord {
  const slot = String(activeSlot || "").trim().toLowerCase()
  const agent = readDefaultAgent(projectDir)
  const expectedAgent = VIBE_PRIMARY_AGENT
  const modelOk = !!expectedModel && !!currentModel && String(currentModel).trim() === String(expectedModel).trim()
  const configPath = collectOpenCodeConfigPaths(projectDir).find((path) => existsSync(path)) || ""
  const config = configPath ? readOpenCodeConfig(configPath) : {}
  const primaryAgent = config.agent && typeof config.agent === "object" ? config.agent[VIBE_PRIMARY_AGENT] : null
  const tiersPath = join(getVibeOSHome(), "model-tiers.json")
  const tiers = existsSync(tiersPath) ? (safeJsonParse(readFileSync(tiersPath, "utf-8")) as JsonRecord) : {}
  const primaryExpectedModel = String(tiers?.trinity?.cheap?.oc || "").trim()
  const tierAgentOk = ["cheap", "medium", "brain"].every((tier) => {
    const name = tierAgentForSlot(tier)
    const model = String((config?.agent && config.agent[name] && config.agent[name].model) || "").trim()
    const expectedTierModel = String(tiers?.trinity?.[tier]?.oc || "").trim()
    return !!name && !!model && !!expectedTierModel && model === expectedTierModel && config?.agent?.[name]?.mode === "subagent"
  })
  const primaryOk = !!primaryAgent && primaryAgent.mode === "primary" && (!primaryExpectedModel || String(primaryAgent.model || "").trim() === primaryExpectedModel)
  const agentOk = agent === expectedAgent && primaryOk
  return {
    slot,
    agent,
    expectedAgent,
    currentModel: String(currentModel || "").trim(),
    expectedModel: String(expectedModel || "").trim(),
    coherent: slot === "brain" && agentOk && modelOk && tierAgentOk,
  }
}
