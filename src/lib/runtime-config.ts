import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, rmSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { safeJsonParse } from "./state.js"
import { getOpenCodeHomes, getOpenCodeHome, getVibeOSHome } from "./runtime-paths.js"

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

export function buildVibePrimaryAgent(existing: JsonRecord = {}): JsonRecord {
  const next: JsonRecord = {
    ...(existing && typeof existing === "object" ? existing : {}),
    description: "VibeUltraX primary agent",
    mode: "primary",
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
  delete next.model
  return next
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

function isLegacyConfigJsonStub(config: unknown): config is JsonRecord {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false
  const keys = Object.keys(config)
  if (keys.length === 0) return false
  if (!keys.every((key) => key === "model" || key === "$schema" || key === "default_agent")) return false
  return typeof (config as JsonRecord).model === "string" && String((config as JsonRecord).model || "").trim().length > 0
}

// OpenCode (or another writer) can regenerate the legacy config.json stub on
// every turn. Without pruning, each cleanup would mint a new timestamped backup,
// leaving an unbounded pile of *.vibeos-bak-* files. Keep only the newest by
// removing prior backups of the same path before creating the next one.
function pruneStubBackups(path: string): void {
  try {
    const dir = dirname(path)
    const prefix = `${basename(path)}.vibeos-bak-`
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(prefix)) rmSync(join(dir, entry), { force: true })
    }
  } catch {}
}

export function cleanupLegacyOpenCodeConfigFiles(projectDir = "", options: { includeHome?: boolean } = {}): string[] {
  const { includeHome = true } = options
  const candidates = new Set<string>()
  if (projectDir) candidates.add(join(projectDir, "config.json"))
  if (includeHome) {
    const home = process.env.HOME || ""
    if (home) candidates.add(join(home, "config.json"))
    for (const opencodeHome of getOpenCodeHomes()) candidates.add(join(opencodeHome, "config.json"))
    candidates.add(join(getOpenCodeHome(), "config.json"))
  }

  const cleaned: string[] = []
  for (const path of candidates) {
    if (!path || !existsSync(path)) continue
    try {
      const parsed = safeJsonParse(readFileSync(path, "utf-8"))
      if (!isLegacyConfigJsonStub(parsed)) continue
      pruneStubBackups(path)
      const backup = `${path}.vibeos-bak-${Date.now()}`
      renameSync(path, backup)
      cleaned.push(backup)
    } catch {}
  }
  return cleaned
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
  const existingPrimary = config.agent[VIBE_PRIMARY_AGENT]
  const nextPrimary = buildVibePrimaryAgent(existingPrimary)
  if (JSON.stringify(existingPrimary || null) !== JSON.stringify(nextPrimary)) {
    config.agent[VIBE_PRIMARY_AGENT] = nextPrimary
    changed = true
  }
  if (config.default_agent !== VIBE_PRIMARY_AGENT) {
    config.default_agent = VIBE_PRIMARY_AGENT
    changed = true
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
  const selection = tiers?.selection && typeof tiers.selection === "object" ? tiers.selection : {}
  const optimizationMode = String(selection?.optimization_mode || "").trim().toLowerCase()
  const entrySlot = String(selection?.entry_slot || selection?.active_slot || slot || "").trim().toLowerCase() || null
  const workerSlot = String(selection?.worker_slot || selection?.selected_slot || "").trim().toLowerCase() || null
  const cheapExpectedModel = String(tiers?.trinity?.cheap?.oc || "").trim()
  const tierAgentOk = ["cheap", "medium", "brain"].every((tier) => {
    const name = tierAgentForSlot(tier)
    const model = String((config?.agent && config.agent[name] && config.agent[name].model) || "").trim()
    const expectedTierModel = String(tiers?.trinity?.[tier]?.oc || "").trim()
    return !!name && !!model && !!expectedTierModel && model === expectedTierModel && config?.agent?.[name]?.mode === "subagent"
  })
  const primaryOk = !!primaryAgent && primaryAgent.mode === "primary" && !String(primaryAgent?.model || "").trim()
  const agentOk = agent === expectedAgent && primaryOk
  const cheapFirstExpected = optimizationMode === "vibeultrax" && entrySlot === "cheap" && !!cheapExpectedModel
  const cheapFirstOk = !cheapFirstExpected || String(currentModel || "").trim() === cheapExpectedModel
  const degraded = cheapFirstExpected && !cheapFirstOk
  return {
    slot,
    entry_slot: entrySlot,
    worker_slot: workerSlot,
    optimization_mode: optimizationMode || null,
    agent,
    expectedAgent,
    currentModel: String(currentModel || "").trim(),
    expectedModel: String(expectedModel || "").trim(),
    cheapExpectedModel,
    cheap_first_expected: cheapFirstExpected,
    cheap_first_ok: cheapFirstOk,
    degraded,
    coherent: agentOk && tierAgentOk && (cheapFirstExpected ? cheapFirstOk : (slot === "brain" ? modelOk : true)),
  }
}
