import { checkDelegation, checkSoftQuota, modelCostPerTurn, normalizeModelId } from "../lib/delegation.js"

export async function delegationRoutes(fastify) {
  fastify.post("/api/v1/delegate/check", async (request, reply) => {
    const { tool, tier, model, prompt, dynamic_cache } = request.body || {}
    if (!tool || !tier) {
      return reply.code(400).send({ error: "tool and tier are required" })
    }
    const result = checkDelegation(tool, tier, model, prompt, dynamic_cache || {})
    return result
  })

  fastify.post("/api/v1/delegate/soft-quota", async (request, reply) => {
    const { tool, current_count, limit } = request.body || {}
    if (!tool) {
      return reply.code(400).send({ error: "tool is required" })
    }
    const result = checkSoftQuota(tool, current_count || 0, limit)
    return result
  })

  fastify.post("/api/v1/delegation/cost", async (request, reply) => {
    const { model, dynamic_cache } = request.body || {}
    if (!model) {
      return reply.code(400).send({ error: "model is required" })
    }
    const cost = modelCostPerTurn(model, dynamic_cache || {})
    return { model: normalizeModelId(model), cost_per_turn: cost }
  })
}
