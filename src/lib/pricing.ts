// @ts-nocheck
export let TRINITY_BRAIN: string | null = null
export let TRINITY_MEDIUM: string | null = null
export let TRINITY_CHEAP: string | null = null
export function setTrinityBrain(v: string | null) { TRINITY_BRAIN = v }
export function setTrinityMedium(v: string | null) { TRINITY_MEDIUM = v }
export function setTrinityCheap(v: string | null) { TRINITY_CHEAP = v }
export function _resetTrinitySlotsForTest(): void {
  TRINITY_BRAIN = null
  TRINITY_MEDIUM = null
  TRINITY_CHEAP = null
}
/**
 * SPDX-License-Identifier: MIT
 * SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
 *
 * vibeOS pricing module — extracted from src/index.ts
 *
 * Contains: model cost lookup, tier classification, dynamic pricing,
 * context7 detection, per-turn cost estimation, and slot management.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, copyFileSync, renameSync, openSync, closeSync, rmSync, readdirSync } from "node:fs"
import { join, dirname, basename, resolve } from "node:path"
import { homedir, tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { currentModel, currentTier, setCurrentModel, setCurrentTier, safeJsonParse, HIGH_TIER_RE, MID_TIER_RE, loadTierRegexes, _modelLocked, VIBEOS_HOME, OPENCODE_HOME, getCurrentSessionId, withFileLock, _handleStateCorruption, getOpenCodeHome } from "./state.js"
import { loadSelection as loadSel, DFLT_SEL } from "./selection-manager.js"

export { HIGH_TIER_RE, MID_TIER_RE, loadTierRegexes }

const USER_HOME = (() => { try { return homedir() } catch { return tmpdir() } })()
const DEFAULT_TRINITY_SLOTS = ["brain", "medium", "cheap"]
export const LABEL_MODES = ["Fast", "Balanced", "High Quality", "Cheap"]
const DEBUG_INTERNALS = process.env.VIBEOS_DEBUG_INTERNALS === "1"

function getVibeOSHome() {
  return process.env.VIBEOS_HOME || join(process.env.HOME || homedir(), ".claude")
}
function getOpenCodeDesktopHome() {
  return process.env.VIBEOS_OPENCODE_DESKTOP_HOME || join(process.env.HOME || homedir(), "Library", "Application Support", "ai.opencode.desktop")
}

const TIERS_FILE = join(getVibeOSHome(), "model-tiers.json")

// ── State paths ─────────────────────────────────────────────────────
// ── File locking ────────────────────────────────────────────────────
function _lockPathFor(filePath) {
  const hash = createHash("sha1").update(String(filePath || "")).digest("hex")
  return join(getVibeOSHome(), ".vibeOS-locks", `${hash}.lock`)
}

function withFileLock(filePath, fn, opts = {}) {
  const staleMs = Number(opts.staleMs || 30_000)
  const timeoutMs = Number(opts.timeoutMs || 2_000)
  const lockPath = _lockPathFor(filePath)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      mkdirSync(join(getVibeOSHome(), ".vibeOS-locks"), { recursive: true })
      const fd = openSync(lockPath, "wx")
      try { writeFileSync(fd, `${process.pid}\n${Date.now()}\n`) } catch {}
      try {
        return fn()
      } finally {
        try { closeSync(fd) } catch {}
        try { rmSync(lockPath, { force: true }) } catch {}
      }
    } catch (err) {
      try {
        if (existsSync(lockPath)) {
          const age = Date.now() - statSync(lockPath).mtimeMs
          if (age > staleMs) {
            try { rmSync(lockPath, { force: true }) } catch {}
          }
        }
      } catch {}
    }
  }
  throw new Error(`[vibeOS] lock not acquired for ${filePath} after ${timeoutMs}ms`)
}

// ── Tier classification ─────────────────────────────────────────────
export let _autoReportCount = 0

export function classify(m) {
  const s = String(m || "").toLowerCase()
  const bare = s.includes("/") ? s.split("/").slice(1).join("/") : s
  const normalized = s.replace(/-free$/i, "")
  const bareNormalized = bare.replace(/-free$/i, "")
  if (HIGH_TIER_RE.test(s)) return "high"
  if (MID_TIER_RE.test(s))  return "mid"
  if (HIGH_TIER_RE.test(bare)) return "high"
  if (MID_TIER_RE.test(bare)) return "mid"
  if (/(?:opus|pro|reasoner|v4-pro)/i.test(normalized) || /(?:opus|pro|reasoner|v4-pro)/i.test(bareNormalized)) return "high"
  if (/(?:flash|sonnet|haiku|mimo|qwen|glm|mini)/i.test(normalized) || /(?:flash|sonnet|haiku|mimo|qwen|glm|mini)/i.test(bareNormalized)) return "mid"
  return "budget"
}

// Map a model ID to a human-readable label with tier icon.
// Provider prefix is stripped before matching (everything before last "/").
export function modelToSlotLabel(modelId: string, effectiveTier?: string) {
  const tier = effectiveTier ?? classify(modelId)
  const icon = tier === "high" ? "🧠" : tier === "mid" ? "◐" : "⚡"
  return `[${icon} ${tier.charAt(0).toUpperCase() + tier.slice(1)}]`
}

export function getModelProvider(modelId: string) {
  const raw = String(modelId || "").trim()
  if (!raw) return ""
  const idx = raw.indexOf("/")
  return idx > 0 ? raw.slice(0, idx) : ""
}

export function formatProviderName(providerName: string) {
  const raw = String(providerName || "").trim()
  if (!raw) return "Unknown"
  if (raw === "openai") return "OpenAI"
  if (raw === "openrouter") return "OpenRouter"
  if (raw === "anthropic") return "Anthropic"
  if (raw === "google") return "Google"
  if (raw === "opencode-go") return "OpenCode Go"
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

export function formatQualityName(quality: string) {
  const raw = String(quality || "").trim().toLowerCase()
  if (raw === "brain" || raw === "high") return "Brain"
  if (raw === "medium" || raw === "mid") return "Medium"
  if (raw === "cheap" || raw === "budget") return "Cheap"
  if (raw === "free") return "Free"
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Unknown"
}

export function resolveExecutionIdentity(modelId: string, directory = "") {
  const raw = String(modelId || "").trim()
  const resolved = resolveDisplayModelId(raw, directory) || raw
  const provider = getModelProvider(resolved) || getModelProvider(raw) || ""
  const normalized = normalizeModelId(resolved || raw)
  const quality = isModelFree(resolved || raw)
    ? "free"
    : classify(resolved || raw) === "high"
      ? "brain"
      : classify(resolved || raw) === "mid"
        ? "medium"
        : "cheap"
  return {
    provider,
    provider_label: formatProviderName(provider),
    quality,
    quality_label: formatQualityName(quality),
    model: resolved || raw,
    model_label: shortModelName(resolved || raw),
  }
}

export function resolveTrinityDisplayModel(directory = "", activeSlot = "", liveModel = "", currentModelId = "") {
  const slot = String(activeSlot || "").trim()
  const slotModel = slot === "brain" ? (TRINITY_BRAIN || "")
    : slot === "medium" ? (TRINITY_MEDIUM || "")
      : slot === "cheap" ? (TRINITY_CHEAP || "")
        : ""
  const raw = [slotModel, liveModel, currentModelId].map((value) => String(value || "").trim()).find(Boolean) || ""
  return resolveDisplayModelId(raw, directory) || raw
}

export function _providerOfModel(modelId: string, fallbackProvider = "") {
  const provider = getModelProvider(modelId)
  return provider || String(fallbackProvider || "").trim()
}

export function _sortByQualityDesc(models: any[] = []) {
  return [...models].sort((a, b) => {
    const ar = classify(a?.id) === "high" ? 3 : classify(a?.id) === "mid" ? 2 : 1
    const br = classify(b?.id) === "high" ? 3 : classify(b?.id) === "mid" ? 2 : 1
    if (br !== ar) return br - ar
    const ac = Number(a?.cost ?? 0)
    const bc = Number(b?.cost ?? 0)
    if (bc !== ac) return bc - ac
    return String(a?.id || "").localeCompare(String(b?.id || ""))
  })
}

export function _sortByCostAsc(models: any[] = []) {
  return [...models].sort((a, b) => {
    const af = isModelFree(a?.id) ? 0 : 1
    const bf = isModelFree(b?.id) ? 0 : 1
    if (af !== bf) return af - bf
    const ac = Number(a?.cost ?? 0)
    const bc = Number(b?.cost ?? 0)
    if (ac !== bc) return ac - bc
    const ar = classify(a?.id) === "high" ? 3 : classify(a?.id) === "mid" ? 2 : 1
    const br = classify(b?.id) === "high" ? 3 : classify(b?.id) === "mid" ? 2 : 1
    if (ar !== br) return ar - br
    return String(a?.id || "").localeCompare(String(b?.id || ""))
  })
}

export function buildDeterministicTrinity(models: any[], options: {
  selectedModelId?: string
  provider?: string
} = {}) {
  const list = Array.isArray(models) ? models.filter((m) => m && typeof m === "object" && String(m.id || "").trim()) : []
  if (list.length === 0) return null

  const selectedModelId = String(options.selectedModelId || "").trim()
  const providerHint = String(options.provider || "").trim()
  const selectedModel = selectedModelId
    ? list.find((m) => m.id === selectedModelId || normalizeModelId(m.id) === normalizeModelId(selectedModelId)) || null
    : null
  const provider = _providerOfModel(selectedModel?.id || selectedModelId, providerHint)
    || _providerOfModel(list[0]?.id || "", providerHint)
  const providerModels = list.filter((m) => _providerOfModel(m.id, provider) === provider)
  const scoped = providerModels.length > 0 ? providerModels : list
  const qualityRanked = _sortByQualityDesc(scoped)
  const costRanked = _sortByCostAsc(scoped)

  // brain = user's selected model (always)
  const brain = selectedModel || qualityRanked[0] || costRanked[0] || scoped[0] || list[0]
  // medium = next best quality from same provider
  const medium = qualityRanked.find((m) => m.id !== brain?.id) || brain
  // cheap = free model (preferred), else cheapest
  const freeModel = scoped.find((m) => isModelFree(m.id))
  const cheap = freeModel || costRanked[0] || medium

  const brainClass = isModelFree(brain?.id) ? "free" : classify(brain?.id)

  return {
    provider,
    selected_tier: brainClass,
    selected_model: brain?.id || selectedModelId || "",
    brain: brain?.id || "",
    medium: medium?.id || "",
    cheap: cheap?.id || "",
    label_modes: [...LABEL_MODES],
  }
}

export function shortModelName(modelId) {
  const raw = String(modelId || "").trim()
  if (!raw) return "unknown"
  const parts = raw.split("/")
  return parts[parts.length - 1] || raw
}

const MODEL_DISPLAY_PREFIXES = /^(deepseek|claude|gemini|gpt|davinci|llama|qwq|qwen)-/i

export function modelDisplayName(modelId) {
  const short = shortModelName(modelId)
  const isFree = short.endsWith("-free")
  const base = isFree ? short.slice(0, -5) : short
  const cleaned = base.replace(MODEL_DISPLAY_PREFIXES, "")
  if (!cleaned) return short
  const display = cleaned
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
  return isFree ? `${display} Free` : display
}

export function trendDisplay(sesTrend) {
  const t = sesTrend === "up" || sesTrend === "down" ? sesTrend : "stable"
  const icon = t === "up" ? "↑" : t === "down" ? "↓" : "→"
  return `${icon} ${t}`
}

// ── Savings estimates ───────────────────────────────────────────────
// Estimated USD saved per 1M cached input tokens (miss_price - cache_hit_price).
// DeepSeek v4-pro: $0.14 - $0.0028 = $0.1372. General heuristic ~$0.10 across providers.
const CACHE_SAVED_PER_1M_INPUT_TOKENS = 0.10
// Approximate bytes per token for JSON/text content (varies 3-6, use 4 as safe estimate).
const BYTES_PER_TOKEN = 4
// Average tokens per turn for cost estimation heuristic.
const AVG_TOKENS_PER_TURN = 375

export function parseOpenRouterInputPer1M(modelRow) {
  const p = modelRow?.pricing || {}
  const inTok = Number(p.prompt ?? p.input ?? p.request)
  if (Number.isFinite(inTok) && inTok > 0) {
    return Math.round(inTok * 1_000_000 * 10000) / 10000
  }
  return null
}

export function cacheSavePer1MInputTokens(model) {
  if (!model) return CACHE_SAVED_PER_1M_INPUT_TOKENS
  if (isModelFree(model)) return 0
  const rawKey = String(model || "")
  const key = normalizeModelId(model)
  const rawNoPrefix = rawKey.includes("/") ? rawKey.split("/")[rawKey.split("/").length - 1] : rawKey
  try {
    const cache = _loadDynamicPricingCache()
    for (const candidate of [rawKey, key, rawNoPrefix]) {
      const entry = cache[candidate]
      const rate = parseOpenRouterInputPer1M(entry)
      if (rate !== null) return rate
    }
    for (const [ck, cv] of Object.entries(cache)) {
      if (ck.endsWith("/" + rawNoPrefix)) {
        const rate = parseOpenRouterInputPer1M(cv)
        if (rate !== null) return rate
      }
    }
  } catch {}
  for (const candidate of [rawKey, key, rawNoPrefix]) {
    const known = MODEL_PRICING_PER_1M[candidate]
    if (known && Number.isFinite(known.input)) return known.input
  }
  const turnCost = modelCostPerTurn(model)
  if (Number.isFinite(turnCost) && turnCost > 0) {
    return Math.round(turnCost * AVG_TOKENS_PER_TURN * 100) / 100
  }
  return CACHE_SAVED_PER_1M_INPUT_TOKENS
}

export function roundUsd(v, precision = 6) {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n)) return 0
  const f = 10 ** precision
  return Math.round(n * f) / f
}

export function formatUsd(v) {
  const n = Number(v ?? 0)
  if (!Number.isFinite(n) || n === 0) return "0.00"
  const abs = Math.abs(n)
  if (abs >= 0.01) return n.toFixed(2)
  if (abs >= 0.001) return n.toFixed(3)
  return n.toFixed(4)
}

// ── Free model exceptions ───────────────────────────────────────────
// Models with negligible per-turn cost (less than 2e-5 USD/turn).
// These skip enforcement entirely to avoid noise.
// deepseek-chat is free with a DeepSeek API token — priced at $1e-12 (near-zero).
const FREE_MODEL_TURN_USD = 1e-10
const FREE_MODELS = new Set([
// OpenCode Zen free models
  "opencode/big-pickle",
  "opencode/big-pickle-free",
  "opencode/nemotron-3-ultra-free",
  // Normalized variants (after opencode/ prefix stripped)
  "big-pickle",
  "big-pickle-free",
  "nemotron-3-ultra-free",
])

// Actual input / output pricing per 1M tokens, sourced from provider API pages
// and OpenRouter /api/v1/models. Format: USD per 1 million tokens.
// Entries with provider/ prefix = OpenRouter route; without prefix = native provider.
const MODEL_PRICING_PER_1M = {
  // ── Anthropic (native + OpenRouter) ─────────────────────
  "anthropic/claude-opus-4-8-fast":     { input: 10.0,  output: 50.0  },
  "anthropic/claude-opus-4-8":          { input: 5.0,   output: 25.0  },
  "anthropic/claude-opus-4-7-fast":     { input: 30.0,  output: 150.0 },
  "anthropic/claude-opus-4-7":          { input: 5.0,   output: 25.0  },
  "anthropic/claude-opus-4-6-fast":     { input: 30.0,  output: 150.0 },
  "anthropic/claude-opus-4-6":          { input: 5.0,   output: 25.0  },
  "anthropic/claude-opus-4-5":          { input: 5.0,   output: 25.0  },
  "anthropic/claude-opus-4.1":          { input: 15.0,  output: 75.0  },
  "anthropic/claude-opus-4":            { input: 15.0,  output: 75.0  },
  "anthropic/claude-sonnet-4-6":        { input: 3.0,   output: 15.0  },
  "anthropic/claude-sonnet-4-5":        { input: 3.0,   output: 15.0  },
  "anthropic/claude-sonnet-4":          { input: 3.0,   output: 15.0  },
  "anthropic/claude-haiku-4-5":         { input: 1.0,   output: 5.0   },
  "anthropic/claude-3.5-haiku":         { input: 0.80,  output: 4.0   },
  "anthropic/claude-3-haiku":           { input: 0.25,  output: 1.25  },
  "haiku":                              { input: 0.80,  output: 4.0   },
  // ── DeepSeek (native — free for chat, paid for pro/flash/r1) ──
  "deepseek-chat":                      { input: 0,     output: 0     }, // native → free
  "deepseek-reasoner":                  { input: 0.55,  output: 2.19  }, // native r1
  // ── DeepSeek (OpenRouter route) ────────────────────────
  "deepseek/deepseek-v4-pro":           { input: 0.435, output: 0.870 },
  "deepseek/deepseek-v4-flash":         { input: 0.098, output: 0.197 },
  "deepseek/deepseek-chat":             { input: 0.229, output: 0.914 },
  "deepseek/deepseek-v3.2":             { input: 0.252, output: 0.378 },
  "deepseek/deepseek-v3.2-exp":         { input: 0.270, output: 0.410 },
  "deepseek/deepseek-chat-v3.1":        { input: 0.210, output: 0.790 },
  "deepseek/deepseek-chat-v3-0324":     { input: 0.200, output: 0.770 },
  "deepseek/deepseek-v3.1-terminus":    { input: 0.270, output: 0.950 },
  "deepseek/deepseek-r1-0528":          { input: 0.500, output: 2.150 },
  "deepseek/deepseek-r1":               { input: 0.700, output: 2.500 },
  "deepseek/deepseek-r1-distill-qwen-32b": { input: 0.290, output: 0.290 },
  "deepseek/deepseek-r1-distill-llama-70b": { input: 0.70, output: 0.80 },
  "deepseek/deepseek-v3":               { input: 0.252, output: 0.378 },
  "deepseek/haiku":                     { input: 0.80,  output: 4.0   },
  // ── Google Gemini (OpenRouter route) ──────────────────
  "google/gemini-2.5-pro":              { input: 1.25,  output: 10.0  },
  "google/gemini-2.5-flash":            { input: 0.30,  output: 2.50  },
  "google/gemini-2.5-flash-lite":       { input: 0.10,  output: 0.40  },
  "google/gemini-2.0-flash-001":        { input: 0.10,  output: 0.40  },
  "google/gemini-2.0-flash-lite-001":   { input: 0.075, output: 0.30  },
  "google/gemma-4-31b-it":              { input: 0.12,  output: 0.37  },
  "google/gemma-4-26b-a4b-it":          { input: 0.06,  output: 0.33  },
  // ── OpenAI (OpenRouter route) ─────────────────────────
  "openai/gpt-5.5-pro":                 { input: 30.0,  output: 180.0 },
  "openai/gpt-5.5":                     { input: 5.0,   output: 30.0  },
  "openai/gpt-5.4-pro":                 { input: 30.0,  output: 180.0 },
  "openai/gpt-5.4":                     { input: 2.50,  output: 15.0  },
  "openai/gpt-5.4-mini":                { input: 0.75,  output: 4.50  },
  "openai/gpt-5.4-nano":                { input: 0.20,  output: 1.25  },
  "openai/gpt-5.3-chat":                { input: 1.75,  output: 14.0  },
  "openai/gpt-5.3-codex":               { input: 1.75,  output: 14.0  },
  "openai/gpt-5.2":                     { input: 1.75,  output: 14.0  },
  "openai/gpt-5.2-pro":                 { input: 21.0,  output: 168.0 },
  "openai/gpt-5.1":                     { input: 1.25,  output: 10.0  },
  "openai/gpt-5":                       { input: 1.25,  output: 10.0  },
  "openai/gpt-5-mini":                  { input: 0.25,  output: 2.00  },
  "openai/gpt-5-nano":                  { input: 0.05,  output: 0.40  },
  "openai/gpt-4o":                      { input: 2.50,  output: 10.0  },
  "openai/gpt-4o-mini":                 { input: 0.15,  output: 0.60  },
  "openai/gpt-4.1":                     { input: 2.00,  output: 8.00  },
  "openai/gpt-4.1-mini":                { input: 0.40,  output: 1.60  },
  "openai/gpt-4.1-nano":                { input: 0.10,  output: 0.40  },
  "openai/o4-mini":                     { input: 1.10,  output: 4.40  },
  "openai/o4-mini-high":                { input: 1.10,  output: 4.40  },
  "openai/o3-pro":                      { input: 20.0,  output: 80.0  },
  "openai/o3":                          { input: 2.00,  output: 8.00  },
  "openai/o3-mini":                     { input: 1.10,  output: 4.40  },
  "openai/o1-pro":                      { input: 150.0, output: 600.0 },
  "openai/o1":                          { input: 15.0,  output: 60.0  },
  "openai/gpt-4-turbo":                 { input: 10.0,  output: 30.0  },
  "openai/gpt-4":                       { input: 30.0,  output: 60.0  },
  "openai/gpt-3.5-turbo":               { input: 0.50,  output: 1.50  },
  // ── Mistral (OpenRouter route) ────────────────────────
  "mistralai/mistral-medium-3-5":       { input: 1.50,  output: 7.50  },
  "mistralai/mistral-large-2512":       { input: 0.50,  output: 1.50  },
  "mistralai/mistral-small-2603":       { input: 0.15,  output: 0.60  },
  "mistralai/mistral-nemo":             { input: 0.02,  output: 0.03  },
  // ── OpenCode Go ─────────────────────────────
  "opencode-go/glm-5.1":                { input: 1.40,  output: 4.40  },
  "opencode-go/glm-5":                  { input: 1.00,  output: 3.20  },
  "opencode-go/kimi-k2.6":              { input: 0.95,  output: 4.00  },
  "opencode-go/kimi-k2.5":              { input: 0.60,  output: 3.00  },
  "opencode-go/mimo-v2.5":              { input: 0.14,  output: 0.28  },
  "opencode-go/mimo-v2.5-pro":          { input: 1.74,  output: 3.48  },
  "opencode-go/minimax-m3":             { input: 0.60,  output: 2.40  },
  "opencode-go/minimax-m2.7":           { input: 0.30,  output: 1.20  },
  "opencode-go/minimax-m2.5":           { input: 0.30,  output: 1.20  },
  "opencode-go/qwen3.7-max":            { input: 2.50,  output: 7.50  },
  "opencode-go/qwen3.7-plus":           { input: 0.40,  output: 1.60  },
  "opencode-go/qwen3.6-plus":           { input: 0.50,  output: 3.00  },
  // ── OpenCode Zen (bare model names, opencode/ prefix stripped) ──
  "minimax-m2.7":                       { input: 0.30,  output: 1.20  },
  "minimax-m2.5":                       { input: 0.30,  output: 1.20  },
  "glm-5.1":                            { input: 1.40,  output: 4.40  },
  "glm-5":                              { input: 1.00,  output: 3.20  },
  "kimi-k2.5":                          { input: 0.60,  output: 3.00  },
  "kimi-k2.6":                          { input: 0.95,  output: 4.00  },
  "qwen3.7-max":                        { input: 2.50,  output: 7.50  },
  "qwen3.7-plus":                       { input: 0.40,  output: 1.60  },
  "qwen3.6-plus":                       { input: 0.50,  output: 3.00  },
  "qwen3.5-plus":                       { input: 0.20,  output: 1.20  },
  "deepseek-v4-flash":                  { input: 0.14,  output: 0.28  },
  "grok-build-0.1":                     { input: 1.00,  output: 2.00  },
  "claude-opus-4-8":                    { input: 5.00,  output: 25.00 },
  "claude-opus-4-7":                    { input: 5.00,  output: 25.00 },
  "claude-opus-4-6":                    { input: 5.00,  output: 25.00 },
  "claude-opus-4-5":                    { input: 5.00,  output: 25.00 },
  "claude-opus-4-1":                    { input: 15.00, output: 75.00 },
  "claude-sonnet-4-6":                  { input: 3.00,  output: 15.00 },
  "claude-sonnet-4-5":                  { input: 3.00,  output: 15.00 },
  "claude-sonnet-4":                    { input: 3.00,  output: 15.00 },
  "claude-haiku-4-5":                   { input: 1.00,  output: 5.00  },
  "gemini-3.5-flash":                   { input: 1.50,  output: 9.00  },
  "gemini-3.1-pro":                     { input: 2.00,  output: 12.00 },
  "gemini-3-flash":                     { input: 0.50,  output: 3.00  },
  "gpt-5.5":                            { input: 5.00,  output: 30.00 },
  "gpt-5.5-pro":                        { input: 30.00, output: 180.00},
  "gpt-5.4":                            { input: 2.50,  output: 15.00 },
  "gpt-5.4-pro":                        { input: 30.00, output: 180.00},
  "gpt-5.4-mini":                       { input: 0.75,  output: 4.50  },
  "gpt-5.4-nano":                       { input: 0.20,  output: 1.25  },
  "gpt-5.3-codex-spark":                { input: 1.75,  output: 14.00 },
  "gpt-5.3-codex":                      { input: 1.75,  output: 14.00 },
  "gpt-5.2":                            { input: 1.75,  output: 14.00 },
  "gpt-5.2-codex":                      { input: 1.75,  output: 14.00 },
  "gpt-5.1":                            { input: 1.07,  output: 8.50  },
  "gpt-5.1-codex":                      { input: 1.07,  output: 8.50  },
  "gpt-5.1-codex-max":                  { input: 1.25,  output: 10.00 },
  "gpt-5.1-codex-mini":                 { input: 0.25,  output: 2.00  },
  "gpt-5":                              { input: 1.07,  output: 8.50  },
  "gpt-5-codex":                        { input: 1.07,  output: 8.50  },
  "gpt-5-nano":                         { input: 0.05,  output: 0.40  },
}

// Approximate USD per typical ~1 K-token turn (blended input+output).
// Blend: 700 input + 300 output tokens per turn (line 272-273).
// Sources: provider API pricing pages, OpenRouter /api/v1/models.
// Add entries as new models appear; unknown models fall back to SAVE_EST constants.
// ── Auto-updated by scripts/sync-pricing.mjs before each release ──
const MODEL_USD_PER_TURN = {
  // ── Anthropic (Claude Code direct API) ─────────────────────
  "anthropic/claude-opus-4-7":            0.033,
  "anthropic/claude-opus-4-5":            0.033,
  "anthropic/claude-sonnet-4-6":          0.0066,
  "anthropic/claude-sonnet-4-5":          0.0066,
  "anthropic/claude-haiku-4-5":           0.0022,
  "anthropic/claude-haiku-4-5-20251001":  0.0022,
  "haiku":                                0.0022,
  // ── DeepSeek (OC platform + OpenRouter) ──────────────────
  "deepseek/deepseek-v4-pro":             0.00057,
  "deepseek/deepseek-v4-flash": 0.000182,
  "deepseek/deepseek-chat":               0.000000000001,
  "deepseek-chat":                        0.000000000001,
  "deepseek/deepseek-v3":                 0.000182,
  "deepseek/deepseek-r1":                 0.00124,
  "deepseek/deepseek-reasoner":           0.000182,
  "deepseek/haiku":                       0.0022,
  // ── Google Gemini ────────────────────────────────────────
  "google/gemini-2.5-pro":                0.0039,
  "google/gemini-2.5-flash":              0.00096,
  "google/gemini-2.0-flash":              0.00019,
  "google/gemini-3-pro-preview":          0.005,
  "google/gemini-3-1-pro-preview":        0.005,
  "google/gemini-3-pro":                  0.005,
  "google/gemini-3-1-pro":                0.005,
  "google/gemini-3-pro-image-preview":    0.005,
  "google/gemini-3-flash-preview":        0.00125,
  "google/gemini-3-5-flash-preview":      0.00125,
  "google/gemini-3-flash":                0.00125,
  "google/gemini-3-5-flash":              0.00125,
  // ── OpenAI ───────────────────────────────────────────────
  "openai/gpt-4o":                        0.00475,
  "openai/gpt-4.1":                       0.0038,
  "openai/gpt-4o-mini":                   0.00029,
  "openai/gpt-4.1-mini":                  0.00019,
  "openai/o3":                            0.0038,
  "openai/o4-mini":                       0.0021,
  // ── OpenCode Go ─────────────────────────────
  "opencode-go/glm-5.1":                 0.00230,
  "opencode-go/glm-5":                   0.00166,
  "opencode-go/kimi-k2.6":               0.00187,
  "opencode-go/kimi-k2.5":               0.00132,
  "opencode-go/mimo-v2.5":               0.000182,
  "opencode-go/mimo-v2.5-pro":           0.00226,
  "opencode-go/minimax-m3":              0.00114,
  "opencode-go/minimax-m2.7":            0.00057,
  "opencode-go/minimax-m2.5":            0.00057,
  "opencode-go/qwen3.7-max":             0.00400,
  "opencode-go/qwen3.7-plus":            0.00076,
  "opencode-go/qwen3.6-plus":            0.00125,
  // ── OpenCode Zen (bare model names, opencode/ prefix stripped by normalizeModelId) ──
  "minimax-m2.7":                        0.00057,
  "minimax-m2.5":                        0.00057,
  "glm-5.1":                             0.00230,
  "glm-5":                               0.00166,
  "kimi-k2.5":                           0.00132,
  "kimi-k2.6":                           0.00187,
  "qwen3.7-max":                         0.00400,
  "qwen3.7-plus":                        0.00076,
  "qwen3.6-plus":                        0.00125,
  "qwen3.5-plus":                        0.00050,
  "deepseek-v4-flash":                   0.000182,
  "grok-build-0.1":                      0.00130,
  "claude-opus-4-8":                     0.01100,
  "claude-opus-4-7":                     0.01100,
  "claude-opus-4-6":                     0.01100,
  "claude-opus-4-5":                     0.01100,
  "claude-opus-4-1":                     0.03300,
  "claude-sonnet-4-6":                   0.00660,
  "claude-sonnet-4-5":                   0.00660,
  "claude-sonnet-4":                     0.00660,
  "claude-haiku-4-5":                    0.00220,
  "gemini-3.5-flash":                    0.00375,
  "gemini-3.1-pro":                      0.00500,
  "gemini-3-flash":                      0.00125,
  "gpt-5.5":                             0.01250,
  "gpt-5.5-pro":                         0.07500,
  "gpt-5.4":                             0.00625,
  "gpt-5.4-pro":                         0.07500,
  "gpt-5.4-mini":                        0.00188,
  "gpt-5.4-nano":                        0.00052,
  "gpt-5.3-codex-spark":                 0.00543,
  "gpt-5.3-codex":                       0.00543,
  "gpt-5.2":                             0.00543,
  "gpt-5.2-codex":                       0.00543,
  "gpt-5.1":                             0.00330,
  "gpt-5.1-codex":                       0.00330,
  "gpt-5.1-codex-max":                   0.00388,
  "gpt-5.1-codex-mini":                  0.00078,
  "gpt-5":                               0.00330,
  "gpt-5-codex":                         0.00330,
  "gpt-5-nano":                          0.00016,
}
let _pricingOverridesCache = null
let _pricingOverridesLoadedAt = 0
let _pricingOverridesHome = ""

const TURN_BLEND_INPUT_TOKENS = 700
const TURN_BLEND_OUTPUT_TOKENS = 300
let _dynamicPricingCache = null
let _dynamicPricingCacheLoadedAt = 0
let _dynamicPricingCacheHome = ""

function _loadDynamicPricingCache() {
  const home = getVibeOSHome()
  const now = Date.now()
  if (_dynamicPricingCache && _dynamicPricingCacheHome === home && (now - _dynamicPricingCacheLoadedAt) < 10_000) return _dynamicPricingCache
  _dynamicPricingCacheLoadedAt = now
  _dynamicPricingCacheHome = home
  const PRICING_CACHE_FILE = join(home, "model-pricing-cache.json")
  try {
    if (!existsSync(PRICING_CACHE_FILE)) return {}
    const st = statSync(PRICING_CACHE_FILE)
    if (st.size > 10485760) { _handleStateCorruption(PRICING_CACHE_FILE); _dynamicPricingCache = {}; return {} }
    const raw = safeJsonParse(readFileSync(PRICING_CACHE_FILE, "utf-8"))
    const map = raw?.models && typeof raw.models === "object" ? raw.models : {}
    _dynamicPricingCache = map
  } catch {
    _handleStateCorruption(PRICING_CACHE_FILE)
    _dynamicPricingCache = {}
  }
  return _dynamicPricingCache
}

function _dynamicCostFor(model) {
  const key = normalizeModelId(model)
  const cache = _loadDynamicPricingCache()
  const map = _getNormalizedCostMap()
  if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key]
  for (const [k, v] of Object.entries(cache)) {
    if (key === k) return v
    if (key.startsWith(k) && /-\d+$/.test(k) && key.charAt(k.length) === "-") return v
  }
  return null
}

export function _parseOpenRouterTurnCost(modelRow) {
  const p = modelRow?.pricing || {}
  const inTok = Number(p.prompt ?? p.input ?? p.request)
  const outTok = Number(p.completion ?? p.output ?? p.response)
  if (Number.isFinite(inTok) && Number.isFinite(outTok)) {
    return inTok * TURN_BLEND_INPUT_TOKENS + outTok * TURN_BLEND_OUTPUT_TOKENS
  }
  const oneTok = Number(p.price ?? p.total ?? p.input ?? p.output)
  if (Number.isFinite(oneTok)) return oneTok * 1000
  return null
}

export function _writeDynamicPricingCache(modelsMap) {
  if (!modelsMap || typeof modelsMap !== "object") return
  const PRICING_CACHE_FILE = join(getVibeOSHome(), "model-pricing-cache.json")
  try {
    withFileLock(PRICING_CACHE_FILE, () => {
      mkdirSync(dirname(PRICING_CACHE_FILE), { recursive: true })
      let merged = {}
      try {
        if (existsSync(PRICING_CACHE_FILE)) {
          const raw = safeJsonParse(readFileSync(PRICING_CACHE_FILE, "utf-8"))
          const existing = raw?.models && typeof raw.models === "object" ? raw.models : {}
          merged = { ...existing }
        }
      } catch {}
      merged = { ...merged, ...modelsMap }
      const tmp = PRICING_CACHE_FILE + ".tmp"
      writeFileSync(tmp, JSON.stringify({
        ts: Date.now(),
        source: "dynamic-model-pricing",
        models: merged,
      }, null, 2) + "\n")
      renameSync(tmp, PRICING_CACHE_FILE)
    })
    _dynamicPricingCache = { ..._loadDynamicPricingCache(), ...modelsMap }
    _dynamicPricingCacheLoadedAt = Date.now()
  } catch {}
}

// Strip routing prefixes (openrouter/, opencode/) and normalize version dots
// so "openrouter/anthropic/claude-sonnet-4.6" → "anthropic/claude-sonnet-4-6"
export function normalizeModelId(model) {
  let m = String(model || "").toLowerCase()
  if (m.startsWith("openrouter/")) m = m.slice("openrouter/".length)
  if (m.startsWith("opencode/"))   m = m.slice("opencode/".length)
  m = m.replace(/(\d)\.(\d)/g, "$1-$2")  // 4.6 → 4-6
  return m
}

let _modelCostMapNormalized = null
function _getNormalizedCostMap() {
  if (_modelCostMapNormalized) return _modelCostMapNormalized
  _modelCostMapNormalized = {}
  for (const [k, v] of Object.entries(MODEL_USD_PER_TURN)) {
    const kd = k.replace(/(\d)\.(\d)/g, "$1-$2")
    _modelCostMapNormalized[kd] = v
    _modelCostMapNormalized[k] = v
  }
  return _modelCostMapNormalized
}

function _loadPricingOverrides() {
  const home = getVibeOSHome()
  const now = Date.now()
  if (_pricingOverridesCache && _pricingOverridesHome === home && (now - _pricingOverridesLoadedAt) < 10_000) return _pricingOverridesCache
  _pricingOverridesLoadedAt = now
  _pricingOverridesHome = home
  try {
    const tiersFile = join(home, "model-tiers.json")
    if (!existsSync(tiersFile)) return {}
    const st = statSync(tiersFile)
    if (st.size > 10485760) { _handleStateCorruption(tiersFile); _pricingOverridesCache = {}; return {} }
    const raw = safeJsonParse(readFileSync(tiersFile, "utf-8"))
    const models = raw?.pricing?.models && typeof raw.pricing.models === "object" ? raw.pricing.models : {}
    const out = {}
    for (const [key, value] of Object.entries(models)) {
      let cost = null
      if (typeof value === "number") {
        cost = value
      } else if (value && typeof value === "object") {
        const candidate = value.turn_usd ?? value.cost_per_turn ?? value.usd_per_turn ?? value.usd ?? value.cost
        const n = Number(candidate)
        if (Number.isFinite(n)) cost = n
      }
      if (!Number.isFinite(cost)) continue
      const rawKey = String(key || "").trim()
      if (!rawKey) continue
      const normalized = normalizeModelId(rawKey)
      out[rawKey] = cost
      out[normalized] = cost
      const bare = rawKey.includes("/") ? rawKey.split("/").pop() : rawKey
      if (bare) out[bare] = cost
    }
    _pricingOverridesCache = out
  } catch {
    _handleStateCorruption(join(home, "model-tiers.json"))
    _pricingOverridesCache = {}
  }
  return _pricingOverridesCache
}

export function modelCostPerTurn(model) {
  if (!model) return 0
  const dyn = _dynamicCostFor(model)
  if (dyn != null) return dyn
  const key = normalizeModelId(model)
  if (key.endsWith("-free")) return FREE_MODEL_TURN_USD
  const overrides = _loadPricingOverrides()
  if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key]
  if (Object.prototype.hasOwnProperty.call(overrides, model)) return overrides[model]
  const bare = String(model || "").includes("/") ? String(model).split("/").pop() : String(model || "")
  if (bare && Object.prototype.hasOwnProperty.call(overrides, bare)) return overrides[bare]
  const map = _getNormalizedCostMap()
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key]
  // Prefix match for versioned model IDs (e.g. "claude-opus-4-7-20251001")
  for (const [k, v] of Object.entries(map)) {
    if (key.startsWith(k) && /-\d+$/.test(k) && key.charAt(k.length) === "-") return v
  }
  // Fallback: derive blended turn cost from MODEL_PRICING_PER_1M input/output rates
  for (const candidate of [model, key, bare]) {
    const pricing = MODEL_PRICING_PER_1M[candidate]
    if (pricing && Number.isFinite(pricing.input) && Number.isFinite(pricing.output)) {
      const blended = (pricing.input * 700 + pricing.output * 300) / 1_000_000
      return Number.isFinite(blended) ? blended : FREE_MODEL_TURN_USD
    }
  }
  console.error(`[vibeOS] modelCostPerTurn: unknown model '${model}' (normalized: '${key}') — add to MODEL_USD_PER_TURN`)
  // Fallback by tier: use median cost of all known models in the same tier
  const tier = classify(model)
  const TIER_FALLBACK = { high: 0.01175, mid: 0.00660, budget: 0.00144 }
  return TIER_FALLBACK[tier] ?? 0.00144
}

export function isModelFree(model) {
  if (!model || typeof model !== "string") return false
  if (/-free$/i.test(normalizeModelId(model)) || /-free$/i.test(model)) return true
  if (FREE_MODELS.has(model)) return true
  if (FREE_MODELS.has(normalizeModelId(model))) return true
  const cost = modelCostPerTurn(model)
  return cost <= FREE_MODEL_TURN_USD
}

// Context7 detection — scan known config files for the string "context7".
// Cheap (one-time at module load); falsy → docs nudge stays dormant.
const CONTEXT7_CONFIG_FILES = [
  join(getVibeOSHome(), "settings.json"),
  join(getVibeOSHome(), ".claude.json"),
  join(getOpenCodeHome(), "opencode.json"),
  join(process.cwd(), "opencode.json"),
]
function _scanOpenCodeConfigs(baseDir) {
  try {
    if (!existsSync(baseDir)) return
    for (const entry of readdirSync(baseDir)) {
      if (!entry.endsWith(".json")) continue
      const full = join(baseDir, entry)
      if (existsSync(full) && /context7/i.test(readFileSync(full, "utf-8"))) return true
    }
  } catch {}
  return false
}
function _context7InPath() {
  try {
    const pathDirs = (process.env.PATH || "").split(":")
    for (const dir of pathDirs) {
      if (!dir) continue
      try {
        if (existsSync(join(dir, "context7"))) return true
        if (existsSync(join(dir, "context7.cmd"))) return true
      } catch {}
    }
  } catch {}
  return false
}
function _context7InNpmCache() {
  try {
    const npxDir = join(USER_HOME, ".npm/_npx")
    if (!existsSync(npxDir)) return false
    for (const hashDir of readdirSync(npxDir)) {
      const ctxDir = join(npxDir, hashDir, "node_modules", "context7")
      try {
        if (existsSync(join(ctxDir, "package.json"))) return true
      } catch {}
    }
  } catch {}
  return false
}
export function detectContext7(files = CONTEXT7_CONFIG_FILES) {
  if (process.env.CLAUDE_CONTEXT7_AVAILABLE) return true
  for (const f of files) {
    try {
      if (existsSync(f) && /context7/i.test(readFileSync(f, "utf-8"))) return true
    } catch {}
  }
  // Scan ~/.config/opencode/ for any JSON configs with context7 (MCP configs, etc.)
  if (_scanOpenCodeConfigs(getOpenCodeHome())) return true
  if (_context7InPath()) return true
  if (_context7InNpmCache()) return true
  return false
}

const DOCS_TARGET_RE = /(docs\.|docs\.python\.org|readthedocs|developer\.mozilla|\/api\/|\/reference\/|\/guide\/|npmjs\.com\/package\/|pypi\.org\/project\/|crates\.io\/crates\/|pkg\.go\.dev|api-docs|\/javadoc\/)/i
export function isDocsTarget(s) {
  return typeof s === "string" && DOCS_TARGET_RE.test(s)
}

// Per-process dedup so the same docs URL doesn't nudge twice.
const context7Seen = new Set()


export function readConfig(dir) {
  try {
    const configs = []
    const projectCfg = readOpenCodeConfigObject(dir)
    if (projectCfg && typeof projectCfg === "object") configs.push(projectCfg)
    const homeDir = getOpenCodeHome()
    if (dir !== homeDir) {
      const homeCfg = readOpenCodeConfigObject(homeDir)
      if (homeCfg && typeof homeCfg === "object") configs.push(homeCfg)
    }
    const workspaceModel = readWorkspaceSessionModel(dir)
    if (workspaceModel) return resolveConfiguredModelId(workspaceModel, configs) || workspaceModel
    const selectedCfg = configs[0] || {}
    const selectedModel = selectedCfg?.agent?.build?.model || selectedCfg?.model || ""
    return resolveConfiguredModelId(selectedModel, configs) || selectedModel
  } catch { return "" }
}

function readWorkspaceSessionModel(directory = "") {
  const sid = readLatestOpenCodeSessionId(directory)
  if (!sid) return ""
  const roots = [getOpenCodeDesktopHome(), getOpenCodeHome()]
  for (const root of roots) {
    try {
      if (!existsSync(root) || !statSync(root).isDirectory()) continue
      const files = readdirSync(root)
        .filter((name) => /^opencode\.workspace\..*\.dat$/i.test(name))
        .map((name) => join(root, name))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
      for (const file of files) {
        try {
          const raw = readFileSync(file, "utf-8")
          if (!raw.includes(sid) || !raw.includes("workspace:model-selection")) continue
          const match = raw.match(/"workspace:model-selection"\s*:\s*"((?:\\.|[^"\\])*)"/s)
          if (!match) continue
          const decoded = JSON.parse(`"${match[1]}"`)
          const parsed = safeJsonParse(decoded)
          const session = parsed?.session?.[sid]
          const providerID = String(session?.model?.providerID || "").trim()
          const modelID = String(session?.model?.modelID || "").trim()
          if (providerID && modelID) return `${providerID}/${modelID}`
          if (modelID) return modelID
        } catch {}
      }
    } catch {}
  }
  return ""
}

export function clearWorkspaceFollowupPauseForSession(sessionId = ""): boolean {
  let changed = false
  const sid = String(sessionId || "").trim()
  const latestSid = String(readLatestOpenCodeSessionId() || "").trim()
  const candidates = [...new Set([sid, latestSid].filter(Boolean))]
  if (candidates.length === 0) return false
  const roots = [getOpenCodeDesktopHome(), getOpenCodeHome()]
  for (const root of roots) {
    try {
      if (!existsSync(root) || !statSync(root).isDirectory()) continue
      const files = readdirSync(root)
        .filter((name) => /^opencode\.workspace\..*\.dat$/i.test(name))
        .map((name) => join(root, name))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
      for (const file of files) {
        try {
          const outer = safeJsonParse(readFileSync(file, "utf-8"))
          const followupRaw = outer?.["workspace:followup"]
          const followup = typeof followupRaw === "string" ? safeJsonParse(followupRaw) : followupRaw
          if (!followup || typeof followup !== "object" || !followup.paused) continue
          let touched = false
          for (const candidate of candidates) {
            if (followup.paused[candidate]) {
              delete followup.paused[candidate]
              touched = true
            }
          }
          if (!touched) continue
          outer["workspace:followup"] = JSON.stringify(followup)
          writeFileSync(file, JSON.stringify(outer, null, 2) + "\n")
          changed = true
        } catch {}
      }
    } catch {}
  }
  return changed
}

function readLatestOpenCodeSessionId(directory = "") {
  try {
    const globalPath = join(getOpenCodeDesktopHome(), "opencode.global.dat")
    if (!existsSync(globalPath)) return ""
    const st = statSync(globalPath)
    if (!st.isFile() || st.size > 10485760) return ""
    const raw = safeJsonParse(readFileSync(globalPath, "utf-8"))
    const notifications = typeof raw?.notification === "string"
      ? safeJsonParse(raw.notification)
      : raw?.notification
    const list = Array.isArray(notifications?.list) ? notifications.list : []
    const targetDir = directory ? resolve(directory) : ""
    const rows = list.filter((entry) => {
      const entryDir = String(entry?.directory || "").trim()
      const session = String(entry?.session || "").trim()
      if (!entryDir || !session) return false
      if (!targetDir) return true
      try { return resolve(entryDir) === targetDir } catch { return entryDir === targetDir }
    })
    rows.sort((a, b) => Number(b?.time || 0) - Number(a?.time || 0))
    return String(rows[0]?.session || "").trim()
  } catch {
    return ""
  }
}

function parseJsonc(raw) {
  const noBlockComments = String(raw || "").replace(/\/\*[\s\S]*?\*\//g, "")
  const noLineComments = noBlockComments.replace(/(^|\s)\/\/.*$/gm, "$1")
  const noTrailingCommas = noLineComments.replace(/,\s*([}\]])/g, "$1")
  return safeJsonParse(noTrailingCommas)
}

function readOpenCodeConfigObject(dir) {
  const jsonPath = join(dir, "opencode.json")
  const jsoncPath = join(dir, "opencode.jsonc")
  if (existsSync(jsonPath)) {
    return safeJsonParse(readFileSync(jsonPath, "utf-8"))
  }
  if (existsSync(jsoncPath)) {
    return parseJsonc(readFileSync(jsoncPath, "utf-8"))
  }
  return {}
}

function collectConfiguredProviderModelsFromConfig(cfg) {
  const out = []
  const providers = (cfg && typeof cfg === "object") ? (cfg?.provider || {}) : {}
  for (const [providerName, providerCfg] of Object.entries(providers)) {
    const models = providerCfg?.models || {}
    for (const rawId of Object.keys(models)) {
      const id = String(rawId || "").trim()
      if (!id) continue
      out.push(id.includes("/") ? id : `${providerName}/${id}`)
    }
  }
  return out
}

function resolveConfiguredModelId(model, configs = []) {
  const raw = String(model || "").trim()
  if (!raw) return ""
  if (raw.includes("/")) return raw
  const normalized = normalizeModelId(raw)
  const matches = new Set()
  for (const cfg of configs) {
    for (const id of collectConfiguredProviderModelsFromConfig(cfg)) {
      const bare = String(id || "").includes("/") ? String(id).split("/").pop() : id
      if (normalizeModelId(id) === normalized || normalizeModelId(bare) === normalized) matches.add(id)
    }
  }
  if (matches.size === 0) {
    // No exact match — try suffix/prefix match against bare model names
    for (const cfg of configs) {
      for (const id of collectConfiguredProviderModelsFromConfig(cfg)) {
        const bare = String(id || "").includes("/") ? String(id).split("/").pop() : id
        const nb = normalizeModelId(bare)
        if (nb.includes(normalized) || normalized.includes(nb)) matches.add(id)
      }
    }
  }
  if (matches.size === 0) return ""
  if (matches.size === 1) return [...matches][0]
  const qualified = [...matches].find(m => m.includes("/"))
  return qualified || raw
}

export function resolveDisplayModelId(model, directory = "") {
  const raw = String(model || "").trim()
  if (!raw) return ""
  if (raw.includes("/")) return raw
  const configs = []
  const projectCfg = readOpenCodeConfigObject(directory)
  if (projectCfg && typeof projectCfg === "object") configs.push(projectCfg)
  const homeDir = getOpenCodeHome()
  const homeCfg = readOpenCodeConfigObject(homeDir)
  if (homeCfg && typeof homeCfg === "object") configs.push(homeCfg)
  return resolveConfiguredModelId(raw, configs)
}

function _setTrinitySlotsFromTiers(tiersData) {
  const brain = String(tiersData?.trinity?.brain?.oc || "").trim()
  const medium = String(tiersData?.trinity?.medium?.oc || "").trim()
  const cheap = String(tiersData?.trinity?.cheap?.oc || "").trim()
  setTrinityBrain(brain && !PLACEHOLDER_RE.test(brain) ? brain : null)
  setTrinityMedium(medium && !PLACEHOLDER_RE.test(medium) ? medium : null)
  setTrinityCheap(cheap && !PLACEHOLDER_RE.test(cheap) ? cheap : null)
  return { brain: TRINITY_BRAIN, medium: TRINITY_MEDIUM, cheap: TRINITY_CHEAP }
}

export function loadTrinitySlotsFromTiersFile() {
  try {
    const TIERS_FILE = join(getVibeOSHome(), "model-tiers.json")
    if (!existsSync(TIERS_FILE)) return false
    const st = statSync(TIERS_FILE)
    if (st.size > 10485760) {
      _handleStateCorruption(TIERS_FILE)
      return false
    }
    const tiersData = safeJsonParse(readFileSync(TIERS_FILE, "utf-8")) || {}
    _setTrinitySlotsFromTiers(tiersData)
    return true
  } catch {
    return false
  }
}

// Refresh currentModel/currentTier from disk config.
// Called per-hook so trinity slot changes take effect without restart.
export const PLACEHOLDER_RE = /^[^/]+\/[a-z-]+-model$/i
// Test-only exports for regression coverage
export function _resolveConfiguredModelId(model, configs = []) { return resolveConfiguredModelId(model, configs) }
export function _collectConfiguredProviderModelsFromConfig(cfg) { return collectConfiguredProviderModelsFromConfig(cfg) }
export function getTrinitySlotOrder(tiersData = null) {
  const configured = Array.isArray(tiersData?.selection?.slot_order)
    ? tiersData.selection.slot_order
    : null
  const valid = (configured || [])
    .map((slot) => String(slot || "").trim())
    .filter(Boolean)
  return valid.length > 0 ? valid : DEFAULT_TRINITY_SLOTS
}
export function _refreshModel(directory) {
  try {
    const TIERS_FILE = join(getVibeOSHome(), "model-tiers.json")
    const sel = loadSel()
    if (!sel.enabled) return
    const tiersData = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
    _setTrinitySlotsFromTiers(tiersData)
    const slotOrder = getTrinitySlotOrder(tiersData)
    const activeSlot = slotOrder.includes(sel.active_slot) ? sel.active_slot : (slotOrder[0] || "brain")
    const slotOcModel = String(tiersData?.trinity?.[activeSlot]?.oc || "").trim()
    const cfgModel = readConfig(directory) || readConfig(getOpenCodeHome()) || process?.env?.OPENCODE_MODEL || ""
    // Skip placeholder models (e.g. "provider/high-tier-model") — use auto-detected model instead
    if (slotOcModel && PLACEHOLDER_RE.test(slotOcModel)) {
      if (DEBUG_INTERNALS) console.error(`[vibeOS] placeholder model detected in ${activeSlot} slot — skipping, will auto-detect`)
    }
    if (slotOcModel && !PLACEHOLDER_RE.test(slotOcModel)) {
      const resolvedModel = slotOcModel
      if (resolvedModel) {
        // Always derive tier from the active slot so footer/env reflect slot changes,
        // even when multiple slots point to the same model ID or a free model rotates.
        const nextTier = activeSlot === (slotOrder[0] || "brain")
          ? "high"
          : activeSlot === (slotOrder[1] || "medium")
            ? "mid"
            : activeSlot === (slotOrder[2] || "cheap")
              ? "budget"
              : classify(resolvedModel)
        const modelChanged = currentModel !== resolvedModel
        const tierChanged = currentTier !== nextTier
        if (modelChanged || tierChanged) {
          const oldModel = currentModel
          const oldTier = currentTier
          setCurrentModel(resolvedModel)
          setCurrentTier(nextTier)
          if (DEBUG_INTERNALS) console.error(`[vibeOS] model refresh: ${oldModel}(${oldTier}) → ${currentModel}(${currentTier}) (slot=${activeSlot})`)
        }
      }
    }
    // If no model from tiers and no existing currentModel, try to auto-detect
    if (!currentModel) {
      const detected = cfgModel
      if (detected) {
        setCurrentModel(detected)
        setCurrentTier(classify(detected))
        if (DEBUG_INTERNALS) console.error(`[vibeOS] auto-detected model: ${currentModel} (tier=${currentTier})`)
      }
    }
    // Reconcile with the directory's opencode.json config only when the
    // selected trinity slot is missing or placeholder-like. Existing trinity
    // slots are treated as authoritative so user-defined brain/medium/cheap
    // choices survive restarts and reinstall/repair cycles.
    if (!(_modelLocked || sel.slot_locked === true) && !slotOcModel) {
      const activeIsManual = tiersData?.trinity?.[activeSlot]?.manual === true
      const currentSlotModel = activeIsManual ? "" : slotOcModel
      if (!currentSlotModel && !currentModel) {
        const cfgModel = readConfig(directory) || readConfig(getOpenCodeHome()) || ""
        if (cfgModel && cfgModel.includes("/") && cfgModel !== currentModel) {
          const oldModel = currentModel
          const oldTier = currentTier
          setCurrentModel(cfgModel)
          setCurrentTier(classify(cfgModel))
          if (DEBUG_INTERNALS) console.error(`[vibeOS] model refresh (config fallback): ${oldModel}(${oldTier}) → ${currentModel}(${currentTier})`)
          try {
            if (existsSync(TIERS_FILE)) {
              withFileLock(TIERS_FILE, () => {
                const t = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
                for (const s of getTrinitySlotOrder(t)) {
                  if (t?.trinity?.[s]?.oc === cfgModel) {
                    t.selection.active_slot = s
                    const _tmp = TIERS_FILE + ".tmp." + Date.now() + "." + Math.random().toString(36).slice(2, 8)
                    writeFileSync(_tmp, JSON.stringify(t, null, 2) + "\n", "utf-8")
                    renameSync(_tmp, TIERS_FILE)
                    if (DEBUG_INTERNALS) console.error(`[vibeOS] model refresh (config fallback): synced active_slot → ${s}`)
                    break
                  }
                }
              })
            }
          } catch {}
        }
      }
    }
  } catch {}
}

export function applySlot(slot: string, projectDir = "") {
  try {
    const TIERS_FILE = join(getVibeOSHome(), "model-tiers.json")
    return withFileLock(TIERS_FILE, () => {
      const j = safeJsonParse(readFileSync(TIERS_FILE, "utf-8"))
      const ocModel = j?.trinity?.[slot]?.oc
      if (!ocModel) return { ok: false, reason: `slot '${slot}' has no oc model` }
      j.selection.active_slot = slot
      const _tmp = TIERS_FILE + ".tmp." + Date.now()
      writeFileSync(_tmp, JSON.stringify(j, null, 2) + "\n", "utf-8")
      renameSync(_tmp, TIERS_FILE)
      // Prefer project-local config to avoid mutating global provider/dropdown config.
      const dir = projectDir || process.cwd()
      const localOcConfig = join(dir, "opencode.json")
      const ocConfig = existsSync(localOcConfig)
        ? localOcConfig
        : join(getOpenCodeHome(), "opencode.json")
      if (existsSync(ocConfig)) {
        const oc = safeJsonParse(readFileSync(ocConfig, "utf-8"))
        oc.model = ocModel
        writeFileSync(ocConfig, JSON.stringify(oc, null, 2) + "\n")
      }
      _refreshModel(dir)
      return { ok: true, ocModel }
    })
  } catch (err) {
    return { ok: false, reason: err.message }
  }
}
