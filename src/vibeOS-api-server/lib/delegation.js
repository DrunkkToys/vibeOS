const WARN_ON_DIRECT = new Set(["write", "edit", "notebookedit"])
const SOFT_QUOTA = new Set(["bash", "webfetch", "websearch"])

const SAVE_EST = {
  WRITE_EDIT: 0.0006,
  SOFT_QUOTA: 0.0003,
  CONTEXT7: 0.0006,
  OPUS_DISABLE: 0.03,
}

const MODEL_USD_PER_TURN = {
  "anthropic/claude-opus-4-7": 0.033,
  "anthropic/claude-opus-4-5": 0.033,
  "anthropic/claude-sonnet-4-6": 0.0066,
  "anthropic/claude-sonnet-4-5": 0.0066,
  "anthropic/claude-3-5-sonnet": 0.0066,
  "anthropic/claude-3-5-sonnet-20241022": 0.0066,
  "anthropic/claude-3-5-sonnet-20240620": 0.0066,
  "anthropic/claude-3-7-sonnet": 0.0066,
  "anthropic/claude-3-7-sonnet-20250219": 0.0066,
  "anthropic/claude-3-opus": 0.03,
  "anthropic/claude-3-opus-20240229": 0.03,
  "anthropic/claude-3-haiku": 0.0006,
  "anthropic/claude-3-5-haiku": 0.0016,
  "google/gemini-2.5-pro": 0.0035,
  "google/gemini-2.5-flash": 0.00075,
  "google/gemini-2.0-flash": 0.0002,
  "google/gemini-pro-1.5": 0.0035,
  "deepseek/deepseek-chat": 0,
  "deepseek/deepseek-v3": 0,
  "deepseek/deepseek-v4-pro": 0.002,
  "deepseek/deepseek-v4-flash": 0,
  "openai/gpt-5": 0.02,
  "openai/gpt-4o": 0.005,
  "openai/gpt-4o-mini": 0.0003,
  "openai/o1": 0.03,
  "openai/o3": 0.02,
  "openai/o4-mini": 0.0022,
  "mistral/mistral-large-2": 0.004,
  "mistral/codestral-2501": 0.001,
  "x-ai/grok-3": 0.006,
  "x-ai/grok-3-mini": 0.0006,
  "qwen/qwen3-235b-a22b": 0.0004,
  "qwen/qwen3-30b-a3b": 0.0001,
}

const TURN_BLEND_INPUT_TOKENS = 0.000003
const TURN_BLEND_OUTPUT_TOKENS = 0.000012

function normalizeModelId(model) {
  if (!model) return ""
  const s = String(model).toLowerCase().trim()
  return s.replace(/^openrouter\//, "").replace(/^anthropic\//, "anthropic/").replace(/^google\//, "google/").replace(/^deepseek\//, "deepseek/").replace(/^openai\//, "openai/").replace(/^mistral\//, "mistral/").replace(/^x-ai\//, "x-ai/").replace(/^qwen\//, "qwen/")
}

function modelCostPerTurn(model, dynamicCache = {}) {
  if (!model) return 0
  const dyn = dynamicCostFor(model, dynamicCache)
  if (dyn != null) return dyn
  const key = normalizeModelId(model)
  if (Object.prototype.hasOwnProperty.call(MODEL_USD_PER_TURN, key)) return MODEL_USD_PER_TURN[key]
  for (const [k, v] of Object.entries(MODEL_USD_PER_TURN)) {
    if (key.startsWith(k) && /-\d+$/.test(k) && key.charAt(k.length) === "-") return v
  }
  return null
}

function dynamicCostFor(model, dynamicCache = {}) {
  const key = normalizeModelId(model)
  if (Object.prototype.hasOwnProperty.call(dynamicCache, key)) return dynamicCache[key]
  for (const [k, v] of Object.entries(dynamicCache)) {
    if (key === k) return v
    if (key.startsWith(k) && /-\d+$/.test(k) && key.charAt(k.length) === "-") return v
  }
  return null
}

function parseOpenRouterTurnCost(modelRow) {
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

function checkDelegation(tool, tier, model, prompt, dynamicCache = {}) {
  const toolLower = String(tool || "").toLowerCase()

  if (!WARN_ON_DIRECT.has(toolLower)) {
    return { blocked: false, reason: null, savings: 0 }
  }

  if (tier !== "high") {
    return { blocked: false, reason: null, savings: 0 }
  }

  const cost = modelCostPerTurn(model, dynamicCache) ?? SAVE_EST.WRITE_EDIT
  const savings = cost > 0 ? cost : SAVE_EST.WRITE_EDIT

  return {
    blocked: true,
    reason: `Direct ${tool} blocked on Brain tier. Delegate via Task or switch tier.`,
    savings: savings,
    redirect_path: toolLower === "write" ? `/tmp/vibeos-enforcement-blocked-${Date.now()}` : null,
    old_string_replacement: (toolLower === "edit" || toolLower === "notebookedit") ? `__THE_SAVER_ENFORCEMENT_BLOCK_${Date.now()}__` : null,
  }
}

function checkSoftQuota(tool, currentCount, limit = 5) {
  const toolLower = String(tool || "").toLowerCase()
  if (!SOFT_QUOTA.has(toolLower)) return { warned: false }
  if (currentCount >= limit) {
    return {
      warned: true,
      message: `Soft quota reached for ${tool} (${currentCount}/${limit}). Consider delegating.`,
      savings: SAVE_EST.SOFT_QUOTA,
    }
  }
  return { warned: false }
}

export {
  WARN_ON_DIRECT,
  SOFT_QUOTA,
  SAVE_EST,
  MODEL_USD_PER_TURN,
  normalizeModelId,
  modelCostPerTurn,
  dynamicCostFor,
  parseOpenRouterTurnCost,
  checkDelegation,
  checkSoftQuota,
}
