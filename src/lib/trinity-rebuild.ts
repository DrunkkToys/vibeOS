// @ts-nocheck
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync } from "node:fs"
import { join, dirname } from "node:path"
import { OPENCODE_HOME } from "./state.js"
import { modelCostPerTurn, normalizeModelId, _parseOpenRouterTurnCost, _writeDynamicPricingCache, HIGH_TIER_RE, MID_TIER_RE } from "./pricing.js"

function getOpenCodeHome() {
  return process.env.VIBEOS_OPENCODE_HOME || join(process.env.HOME || "", ".config", "opencode")
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw)
  } catch {}

  let cleaned = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1")
  try {
    return JSON.parse(cleaned)
  } catch (e) {
    throw e
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

function normalizeProviderModels(providerName, models) {
  const out = []
  if (!models || typeof models !== "object") return out
  for (const rawId of Object.keys(models)) {
    const id = String(rawId || "").trim()
    if (!id) continue
    out.push(id.includes("/") ? id : providerName + "/" + id)
  }
  return out
}

function resolveProviderModel(modelId, providers) {
  const raw = String(modelId || "").trim()
  if (!raw) return null
  const normalized = normalizeModelId(raw)
  const entries = Object.entries(providers || {})
  for (const [providerName, providerCfg] of entries) {
    const ids = normalizeProviderModels(providerName, providerCfg?.models)
    for (const id of ids) {
      const bare = String(id || "").includes("/") ? String(id).split("/").slice(1).join("/") : String(id)
      if (normalizeModelId(id) === normalized || normalizeModelId(bare) === normalized) {
        return { providerName, providerCfg, id }
      }
    }
  }
  const prefix = raw.includes("/") ? raw.split("/")[0] : ""
  if (prefix && providers?.[prefix]) {
    return { providerName: prefix, providerCfg: providers[prefix], id: raw }
  }
  return null
}

function providerApiBaseURL(providerName, providerCfg) {
  const options = providerCfg?.options || {}
  const baseURL = String(options?.baseURL || options?.baseUrl || providerCfg?.baseURL || providerCfg?.baseUrl || providerCfg?.url || "").trim()
  if (baseURL) return baseURL.replace(/\/+$/, "")
  if (providerName === "deepseek") return "https://api.deepseek.com/v1"
  if (providerName === "openrouter") return "https://openrouter.ai/api/v1"
  if (providerName === "google") return "https://generativelanguage.googleapis.com/v1beta"
  return ""
}

function providerApiKey(providerName, providerCfg, auth) {
  const options = providerCfg?.options || {}
  const direct = String(options?.apiKey || providerCfg?.apiKey || providerCfg?.key || "").trim()
  if (direct) return direct
  const scoped = String(auth?.[providerName]?.key || "").trim()
  if (scoped) return scoped
  return ""
}

function _parseModelsDevTurnCost(modelRow) {
  const cost = modelRow?.cost || modelRow?.pricing || {}
  const input = Number(cost?.input ?? cost?.prompt ?? cost?.request)
  const output = Number(cost?.output ?? cost?.completion ?? cost?.response)
  if (Number.isFinite(input) && Number.isFinite(output)) {
    return (input * 700 + output * 300) / 1_000_000
  }
  const single = Number(cost?.price ?? cost?.total ?? cost?.usd ?? cost?.turn_usd)
  if (Number.isFinite(single)) return single
  return null
}

export function _extractModelsDevPricingMap(payload, wantedIds = null) {
  const wanted = wantedIds instanceof Set ? wantedIds : null
  const out = {}
  if (!payload || typeof payload !== "object") return out

  const providerEntries = []
  if (payload.providers && typeof payload.providers === "object") {
    if (Array.isArray(payload.providers)) {
      for (const provider of payload.providers) {
        if (!provider || typeof provider !== "object") continue
        const providerName = String(provider.id || provider.name || provider.provider || "").trim()
        if (!providerName) continue
        providerEntries.push([providerName, provider])
      }
    } else {
      providerEntries.push(...Object.entries(payload.providers))
    }
  } else {
    for (const [providerName, provider] of Object.entries(payload)) {
      if (!provider || typeof provider !== "object") continue
      if (!provider.models || typeof provider.models !== "object") continue
      providerEntries.push([providerName, provider])
    }
  }

  for (const [providerName, provider] of providerEntries) {
    const models = provider?.models
    if (!models || typeof models !== "object") continue
    for (const [rawId, modelRow] of Object.entries(models)) {
      const raw = String(rawId || "").trim()
      if (!raw) continue
      const fullId = raw.includes("/") ? raw : `${providerName}/${raw}`
      const normalized = normalizeModelId(fullId)
      if (wanted && !wanted.has(normalized) && !wanted.has(fullId) && !wanted.has(raw)) continue
      const cost = _parseModelsDevTurnCost(modelRow)
      if (cost != null && Number.isFinite(cost)) {
        out[normalized] = cost
      }
    }
  }

  return out
}

export function collectConfiguredProviderModels(providers) {
  const all = []
  const seen = new Set()
  for (const [providerName, cfg] of Object.entries(providers || {})) {
    const ids = normalizeProviderModels(providerName, cfg?.models)
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      all.push({ id, provider: providerName, cost: _modelCost(id), tier: _modelTier(id) })
    }
  }
  return all
}

// ── trinity rebuild helpers: discover, classify, probe ────────────────

const MODEL_RANK = { high: 3, mid: 2, budget: 1 }

function _loadOpenCodeProviders() {
  try {
    const merged = {}
    const dirs = [join(process.cwd(), "."), getOpenCodeHome()]
    for (const dir of dirs) {
      const cfg = readOpenCodeConfigObject(dir)
      const providers = cfg?.provider || {}
      for (const [providerName, providerCfg] of Object.entries(providers)) {
        if (!merged[providerName]) merged[providerName] = {}
        merged[providerName] = {
          ...merged[providerName],
          ...providerCfg,
          models: {
            ...(merged[providerName]?.models || {}),
            ...(providerCfg?.models || {}),
          },
        }
      }
    }
    return merged
  } catch { return {} }
}

function _modelCost(id) {
  if (!id) return 0
  const c = modelCostPerTurn(id)
  if (c != null) return c
  const stripped = String(id).includes("/") ? String(id).split("/").slice(1).join("/") : String(id)
  return modelCostPerTurn(stripped) ?? 0
}

function _modelTier(id) {
  if (!id) return "budget"
  const high = HIGH_TIER_RE?.test?.(id)
  if (high) return "high"
  const mid = MID_TIER_RE?.test?.(id)
  return mid ? "mid" : "budget"
}

export async function discoverAvailableModels(providers, auth) {
  const all = collectConfiguredProviderModels(providers)
  const seen = new Set(all.map((m) => m.id))
  const wantedIds = new Set(all.map((m) => normalizeModelId(m.id)))

  const pushIfNew = (id, provider) => {
    if (seen.has(id)) return
    seen.add(id)
    all.push({ id, provider, cost: _modelCost(id), tier: _modelTier(id) })
  }

  const mergePricing = (pricingMap) => {
    if (!pricingMap || typeof pricingMap !== "object") return
    const next = {}
    for (const [key, value] of Object.entries(pricingMap)) {
      if (!Number.isFinite(Number(value))) continue
      next[normalizeModelId(key)] = Number(value)
    }
    if (Object.keys(next).length > 0) _writeDynamicPricingCache(next)
  }

  if (auth.deepseek?.key) {
    try {
      const res = await fetch("https://api.deepseek.com/models", {
        headers: { Authorization: "Bearer " + auth.deepseek.key },
        signal: AbortSignal.timeout(4000),
      })
      if (res.ok) {
        const body = await res.json()
        const list = body?.data || body?.models || []
        for (const m of list) {
          const rawId = (typeof m === "string" ? m : m.id) || ""
          if (!rawId) continue
          const id = rawId.includes("/") ? rawId : "deepseek/" + rawId
          pushIfNew(id, "deepseek")
        }
      }
    } catch {}
  }

  if (auth.openrouter?.key) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: "Bearer " + auth.openrouter.key },
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const body = await res.json()
        const list = body?.data || []
        const pricingMap = {}
        for (const m of list) {
          const rawId = m.id
          if (!rawId) continue
          const dynTurnCost = _parseOpenRouterTurnCost(m)
          if (dynTurnCost != null && Number.isFinite(dynTurnCost)) {
            pricingMap[normalizeModelId(rawId)] = dynTurnCost
          }
          const id = "openrouter/" + rawId
          pushIfNew(id, "openrouter")
        }
        if (Object.keys(pricingMap).length > 0) _writeDynamicPricingCache(pricingMap)
      }
    } catch (e) {
      console.error("[vibeOS] OpenRouter probe failed:", e.message)
    }
  }

  const wantsModelsDev = Object.keys(providers || {}).some((name) => /^(google|opencode|qwen)$/i.test(name))
    || all.some((m) => /^(google|opencode|qwen)\//i.test(m.id))
  if (wantsModelsDev) {
    try {
      const res = await fetch("https://models.dev/api.json", {
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const body = await res.json()
        const pricingMap = _extractModelsDevPricingMap(body, wantedIds)
        mergePricing(pricingMap)
      }
    } catch (e) {
      console.error("[vibeOS] models.dev pricing probe failed:", e.message)
    }
  }

  return all
}

export function classifyAndRankModels(models) {
  if (!models || models.length === 0) return null

  const unique = []
  const seen = new Set()
  for (const m of models) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    unique.push({ ...m })
  }

  if (unique.length === 0) return null

  unique.sort((a, b) => {
    const ra = MODEL_RANK[a.tier] || 0
    const rb = MODEL_RANK[b.tier] || 0
    return rb !== ra ? rb - ra : b.cost - a.cost
  })

  const cheapest = [...unique].sort((a, b) => {
    return a.cost !== b.cost ? a.cost - b.cost : (MODEL_RANK[b.tier] || 0) - (MODEL_RANK[a.tier] || 0)
  })

  return {
    brain: unique[0],
    medium: unique.length > 1 ? unique[1] : unique[0],
    cheap: cheapest[0],
  }
}

export function modelToCcAlias(modelId) {
  if (!modelId) return "haiku"
  let m = String(modelId).toLowerCase()
    .replace(/\./g, "-")
    .replace(/^(openrouter|opencode|deepseek|anthropic|google)\//, "")
  m = m.replace(/^(anthropic|google|openai|meta-llama|mistralai|qwen)\//, "")

  const map = {
    "deepseek-v4-pro": "deepseek-reasoner",
    "deepseek-v4-flash": "haiku",
    "deepseek-chat": "haiku",
    "deepseek-reasoner": "deepseek-reasoner",
    "deepseek-r1": "deepseek-reasoner",
    "sonnet": "sonnet",
    "claude-sonnet": "sonnet",
    "opus": "opus",
    "claude-opus": "opus",
    "haiku": "haiku",
    "claude-haiku": "haiku",
    "gemini": "sonnet",
    "gpt": "sonnet",
    "qwq": "sonnet",
  }

  if (map[m]) return map[m]
  if (m.length < 3) return "haiku"
  for (const [k, v] of Object.entries(map)) {
    if (!k || k.length < 3) continue
    if (m.startsWith(k) || k.startsWith(m)) return v
  }
  return "haiku"
}

export async function probeModel(modelId, auth, providers = null) {
  if (!modelId || !auth) return true

  const id = String(modelId || "")
  if (id.startsWith("opencode/")) return true

  const provider = resolveProviderModel(id, providers)
  const providerName = provider?.providerName || (id.includes("/") ? id.split("/")[0] : "")
  const providerCfg = provider?.providerCfg || providers?.[providerName] || {}
  const reqModel = provider?.id ? (provider.id.includes("/") ? provider.id.split("/").slice(1).join("/") : provider.id) : (id.includes("/") ? id.split("/").slice(1).join("/") : id)
  const apiKey = providerApiKey(providerName, providerCfg, auth)
  const baseURL = providerApiBaseURL(providerName, providerCfg)

  if (!providerName || !reqModel) {
    return true
  }

  if (!apiKey) {
    console.error("[vibeOS] probeModel: no API key for " + id)
    return false
  }
  if (!baseURL && providerName !== "google") {
    return true
  }

  try {
    const isGoogleDirect = providerName === "google" && !String(baseURL || "").includes("chat/completions")
    const apiUrl = isGoogleDirect
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(reqModel)}:generateContent?key=${encodeURIComponent(apiKey)}`
      : `${baseURL || providerApiBaseURL(providerName, providerCfg) || ""}/chat/completions`
    const headers = isGoogleDirect
      ? { "Content-Type": "application/json", "x-goog-api-key": apiKey }
      : {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      }
    const body = isGoogleDirect
      ? JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "ok" }] }],
        generationConfig: { maxOutputTokens: 1 },
      })
      : JSON.stringify({
        model: reqModel,
        messages: [{ role: "user", content: "ok" }],
        max_tokens: 1,
      })
    const res = await fetch(apiUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => "")
      console.error("[vibeOS] probeModel FAIL " + id + ": HTTP " + res.status + " " + errBody.slice(0, 200))
      return false
    }
    return true
  } catch (err) {
    console.error("[vibeOS] probeModel ERROR " + id + ": " + err.message)
    return false
  }
}
