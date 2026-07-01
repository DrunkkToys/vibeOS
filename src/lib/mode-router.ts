// Mode Router — 10 modes, 4 tiers. Full type-safe hierarchy.
// Branded modes: user-selected strategy + tier pipeline.
// Runtime modes: classifier-selected behavior per query.
//
// NOTE: Mode/MODES/isMode below are the canonical 5-mode identity
// (vibemax|vibeqmax|vibeultrax|vibelitex|raw) that axis-bundle.ts orchestrates.
// BRANDED_MODES/RUNTIME_MODES/RAW_MODE below are being consolidated into this;
// see CLAUDE.md mode-axis-consolidation plan.
export type Mode = "vibemax" | "vibeqmax" | "vibeultrax" | "vibelitex" | "raw"
export const MODES: readonly Mode[] = ["vibemax", "vibeqmax", "vibeultrax", "vibelitex", "raw"]
export function isMode(v: unknown): v is Mode {
  return (MODES as readonly string[]).includes(String(v || "").toLowerCase())
}

export interface TierInfo {
  cost: number;
  desc: string;
}

export interface ModeEntry {
  id: string;
  index: number;
  name: string;
  icon: string;
  pipeline: string[];
  thinking: string;
  tdd: string;
  enforcement: string;
  flow: string;
  qualityVsBrain: number;
  costVsBrain: number;
  desc: string;
  default?: boolean;
  defaultRuntime?: boolean;
}

export const TIERS: Record<string, TierInfo> = {
  brain:  { cost: 0.002,    desc: "v4 Pro tier — max quality" },
  medium: { cost: 0.000182,  desc: "v4 Flash tier — balanced" },
  cheap:  { cost: 0,         desc: "Chat tier — free" },
  local:  { cost: 0,         desc: "Ollama local model" },
}

export const BRANDED_MODES: ModeEntry[] = [
  {
    id: "vibeultrax", index: 1, name: "VibeUltraX", icon: "\u{1F3C6}",
    pipeline: ["cheap", "medium", "brain"],
    thinking: "full", tdd: "quality", enforcement: "strict", flow: "strict",
    qualityVsBrain: 107, costVsBrain: 58, default: true,
    desc: "Default mode. 3-model debate: cheap proposes, medium reviews, brain refines.",
  },
  {
    id: "vibeqmax", index: 2, name: "VibeQMaX", icon: "\u{2B50}",
    pipeline: ["brain"],
    thinking: "full", tdd: "quality", enforcement: "strict", flow: "strict",
    qualityVsBrain: 100, costVsBrain: 50,
    desc: "Brain tier only. Same quality as Raw Brain at half cost.",
  },
  {
    id: "vibemax", index: 3, name: "VibeMaX", icon: "\u{26A1}",
    pipeline: ["medium"],
    thinking: "off", tdd: "lazy", enforcement: "relaxed", flow: "audit",
    qualityVsBrain: 75, costVsBrain: 18,
    desc: "Medium tier auto-escalate. Speed-first.",
  },
  {
    id: "vibelitex", index: 4, name: "VibeLiteX", icon: "\u{1F4A1}",
    pipeline: ["medium"],
    thinking: "brief", tdd: "lazy", enforcement: "normal", flow: "audit",
    qualityVsBrain: 65, costVsBrain: 20,
    desc: "Local fallback. Medium tier with enforcement. No API required.",
  },
]

export const RUNTIME_MODES: ModeEntry[] = [
  {
    id: "balanced", index: 4, name: "Balanced", icon: "\u{2696}\u{FE0F}",
    pipeline: ["medium"],
    thinking: "brief", tdd: "lazy", enforcement: "relaxed", flow: "audit",
    qualityVsBrain: 70, costVsBrain: 30, defaultRuntime: true,
    desc: "Default runtime. Auto-selects behavior per query.",
  },
  {
    id: "speed", index: 5, name: "Speed", icon: "\u{1F680}",
    pipeline: ["medium"],
    thinking: "off", tdd: "off", enforcement: "relaxed", flow: "off",
    qualityVsBrain: 55, costVsBrain: 32,
    desc: "Medium tier. Fast responses, no overhead.",
  },
  {
    id: "budget", index: 6, name: "Budget", icon: "\u{1F4B8}",
    pipeline: ["cheap"],
    thinking: "off", tdd: "off", enforcement: "off", flow: "off",
    qualityVsBrain: 40, costVsBrain: 100,
    desc: "Cheap tier only. Zero cost.",
  },
  {
    id: "quality", index: 7, name: "Quality", icon: "\u{1F4AF}",
    pipeline: ["brain"],
    thinking: "full", tdd: "quality", enforcement: "strict", flow: "strict",
    qualityVsBrain: 100, costVsBrain: 60,
    desc: "Brain tier with full thinking and enforcement.",
  },
  {
    id: "audit", index: 8, name: "Audit", icon: "\u{1F50D}",
    pipeline: ["brain"],
    thinking: "full", tdd: "quality", enforcement: "strict", flow: "strict",
    qualityVsBrain: 100, costVsBrain: 55,
    desc: "Brain tier security audit. OWASP validation.",
  },
  {
    id: "longrun", index: 6, name: "Longrun", icon: "\u{1F4C8}",
    pipeline: ["cheap"],
    thinking: "off", tdd: "off", enforcement: "off", flow: "off",
    qualityVsBrain: 15, costVsBrain: 100,
    desc: "Extended sessions. Cheap tier only.",
  },
  {
    id: "forensic", index: 7, name: "Forensic", icon: "\u{1F52C}",
    pipeline: ["brain"],
    thinking: "full", tdd: "quality", enforcement: "strict", flow: "strict",
    qualityVsBrain: 100, costVsBrain: 65,
    desc: "Deep analysis and web research. Full audit trail.",
  },
]

export const RAW_MODE: ModeEntry = {
  id: "raw", index: 10, name: "Raw Brain", icon: "\u{1F9E0}",
  pipeline: ["brain"],
  thinking: "full", tdd: "\u2014", enforcement: "\u2014", flow: "\u2014",
  qualityVsBrain: 100, costVsBrain: 0,
  desc: "Pure v4 Pro baseline. No vibeOS overhead.",
}

export const ALL_MODES: ModeEntry[] = [...BRANDED_MODES, ...RUNTIME_MODES, RAW_MODE]

export function getMode(id: string): ModeEntry {
  return ALL_MODES.find(m => m.id === id) ?? getDefault()
}

export function getDefault(): ModeEntry {
  return BRANDED_MODES.find(m => m.default)!
}

export function getDefaultRuntime(): ModeEntry {
  return RUNTIME_MODES.find(m => m.defaultRuntime)!
}

export function getBrandedModes(): ModeEntry[] { return BRANDED_MODES }
export function getRuntimeModes(): ModeEntry[] { return RUNTIME_MODES }

export function resolveCascadeSlot(pipeline: string[] = []): "brain" | "medium" | "cheap" {
  const normalized = Array.isArray(pipeline) ? pipeline.map((t) => String(t || "").toLowerCase()) : []
  if (normalized.includes("brain")) return "brain"
  if (normalized.includes("medium")) return "medium"
  return "cheap"
}

export function resolveTierModels(
  mode: ModeEntry,
  tierMap: Record<string, string>,
): { models: string[]; totalCost: number } {
  const models = mode.pipeline.map(t => tierMap[t] ?? t)
  const costs = mode.pipeline.map(t => TIERS[t]?.cost ?? 0)
  return { models, totalCost: costs.reduce((s, c) => s + c, 0) }
}
