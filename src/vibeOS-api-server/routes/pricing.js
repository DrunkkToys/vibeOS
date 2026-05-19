import { parseOpenRouterTurnCost, modelCostPerTurn, normalizeModelId, MODEL_USD_PER_TURN } from "../lib/delegation.js"

const pricingCache = new Map()
let lastFetch = 0
const CACHE_TTL = 10 * 60 * 1000

export async function pricingRoutes(fastify) {
  fastify.post("/api/v1/pricing/fetch", async (request, reply) => {
    const { openrouter_key, force } = request.body || {}

    const now = Date.now()
    if (!force && pricingCache.size > 0 && (now - lastFetch) < CACHE_TTL) {
      return { cached: true, models: Object.fromEntries(pricingCache), count: pricingCache.size }
    }

    if (!openrouter_key) {
      return reply.code(400).send({ error: "openrouter_key is required for live fetch" })
    }

    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: "Bearer " + openrouter_key },
        signal: AbortSignal.timeout(10000),
      })

      if (!res.ok) {
        return reply.code(res.status).send({ error: "openrouter api error", status: res.status })
      }

      const body = await res.json()
      const list = body?.data || []
      const pricingMap = {}

      for (const m of list) {
        const dynTurnCost = parseOpenRouterTurnCost(m)
        if (dynTurnCost != null && Number.isFinite(dynTurnCost)) {
          const rawId = m.id || ""
          pricingMap[normalizeModelId(rawId)] = dynTurnCost
          pricingCache.set(normalizeModelId(rawId), dynTurnCost)
        }
      }

      lastFetch = now
      return { cached: false, models: pricingMap, count: Object.keys(pricingMap).length }
    } catch (err) {
      return reply.code(502).send({ error: "failed to fetch pricing", message: err.message })
    }
  })

  fastify.post("/api/v1/pricing/lookup", async (request, reply) => {
    const { model } = request.body || {}
    if (!model) {
      return reply.code(400).send({ error: "model is required" })
    }
    const cost = modelCostPerTurn(model, Object.fromEntries(pricingCache))
    return { model: normalizeModelId(model), cost_per_turn: cost ?? null, in_cache: pricingCache.has(normalizeModelId(model)) }
  })

  fastify.get("/api/v1/pricing/static", async (request, reply) => {
    return { models: MODEL_USD_PER_TURN, count: Object.keys(MODEL_USD_PER_TURN).length }
  })
}
