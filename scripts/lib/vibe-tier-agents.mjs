import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

export const VIBE_TIER_AGENT_BY_SLOT = {
  cheap: "vibe-cheap",
  medium: "vibe-medium",
  brain: "vibe-brain",
}

function readJson(path) {
  if (!existsSync(path)) return {}
  try {
    const raw = readFileSync(path, "utf8")
    const cleaned = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
    const parsed = JSON.parse(cleaned)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n")
  renameSync(tmp, path)
}

function readTiers(home = homedir()) {
  return readJson(join(process.env.VIBEOS_HOME || join(home, ".claude"), "model-tiers.json"))
}

function tierAgent(slot, model, existing = {}) {
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

export function installVibeTierAgentsInConfig(config, tiers = readTiers()) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false
  const trinity = tiers?.trinity || {}
  const activeSlot = String(tiers?.selection?.active_slot || "").trim().toLowerCase()
  config.$schema ||= "https://opencode.ai/config.json"
  config.agent = config.agent && typeof config.agent === "object" ? config.agent : {}
  let changed = false
  for (const slot of ["cheap", "medium", "brain"]) {
    const model = String(trinity?.[slot]?.oc || "").trim()
    const name = VIBE_TIER_AGENT_BY_SLOT[slot]
    if (!model || !name) continue
    const existing = config.agent[name]
    const next = tierAgent(slot, model, existing)
    if (JSON.stringify(existing || null) !== JSON.stringify(next)) {
      config.agent[name] = next
      changed = true
    }
  }
  const defaultAgent = VIBE_TIER_AGENT_BY_SLOT[activeSlot]
  if (defaultAgent && config.agent?.[defaultAgent] && config.default_agent !== defaultAgent) {
    config.default_agent = defaultAgent
    changed = true
  }
  return changed
}

export function installVibeTierAgentsForHomes(homes, { home = homedir() } = {}) {
  const tiers = readTiers(home)
  const changed = []
  for (const target of homes) {
    const configPath = join(target, "opencode.json")
    const config = readJson(configPath)
    if (installVibeTierAgentsInConfig(config, tiers) || !existsSync(configPath)) {
      writeJson(configPath, config)
      changed.push(configPath)
    }
  }
  return changed
}
