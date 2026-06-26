import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { safeJsonParse, getOpenCodeHomes, getOpenCodeHome } from "./state.js"

type JsonRecord = Record<string, any>
type TrinityConfig = Record<string, { oc?: string }>

export const VIBE_TIER_AGENT_BY_SLOT: Record<string, string> = {
  cheap: "vibe-cheap",
  medium: "vibe-medium",
  brain: "vibe-brain",
}

export function tierAgentForSlot(slot: string | null): string | null {
  return VIBE_TIER_AGENT_BY_SLOT[String(slot || "").trim().toLowerCase()] || null
}

export function buildVibeTierAgent(slot: string, model: string, existing: JsonRecord = {}): JsonRecord {
  return {
    ...(existing && typeof existing === "object" ? existing : {}),
    description: `VibeUltraX ${slot} tier primary agent`,
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

export function collectOpenCodeConfigPaths(projectDir = ""): string[] {
  const candidates: string[] = []
  if (projectDir) {
    candidates.push(join(projectDir, "opencode.json"))
    candidates.push(join(projectDir, ".opencode", "opencode.json"))
  }
  for (const home of getOpenCodeHomes()) candidates.push(join(home, "opencode.json"))
  candidates.push(join(getOpenCodeHome(), "opencode.json"))
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

export function writeOpenCodeConfig(path: string, config: JsonRecord): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n")
}

export function installVibeTierAgentsInConfig(config: JsonRecord, trinity: TrinityConfig, activeSlot: string | null = null): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false
  config.$schema ||= "https://opencode.ai/config.json"
  config.agent = config.agent && typeof config.agent === "object" ? config.agent : {}
  let changed = false
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
  const agentName = tierAgentForSlot(activeSlot)
  if (agentName && config.agent[agentName] && config.default_agent !== agentName) {
    config.default_agent = agentName
    changed = true
  }
  return changed
}

export function installVibeTierAgents(projectDir = "", trinity: TrinityConfig, activeSlot: string | null = null): { changed: string[]; checked: string[] } {
  const changed: string[] = []
  const checked: string[] = []
  for (const path of collectOpenCodeConfigPaths(projectDir)) {
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
  const expectedAgent = tierAgentForSlot(slot)
  const modelOk = !!expectedModel && !!currentModel && String(currentModel).trim() === String(expectedModel).trim()
  const agentOk = !!expectedAgent && agent === expectedAgent
  return {
    slot,
    agent,
    expectedAgent,
    currentModel: String(currentModel || "").trim(),
    expectedModel: String(expectedModel || "").trim(),
    coherent: slot === "brain" && agentOk && modelOk,
  }
}
