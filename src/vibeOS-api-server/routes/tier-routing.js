import { classify, routeModel, isExploratoryPrompt } from "../lib/tier-routing.js"

export async function tierRoutes(fastify) {
  fastify.post("/api/v1/route/model", async (request, reply) => {
    const { prompt, current_tier, trinity_cheap, trinity_medium, learned_exploratory, stress_score } = request.body || {}
    if (!prompt) {
      return reply.code(400).send({ error: "prompt is required" })
    }
    const result = routeModel(prompt, current_tier, trinity_cheap, trinity_medium, learned_exploratory || [], stress_score || 0)
    return result
  })

  fastify.post("/api/v1/tier/classify", async (request, reply) => {
    const { model, custom_regex } = request.body || {}
    if (!model) {
      return reply.code(400).send({ error: "model is required" })
    }
    const tier = classify(model, custom_regex)
    return { model, tier }
  })

  fastify.post("/api/v1/tier/exploratory", async (request, reply) => {
    const { prompt, learned_exploratory } = request.body || {}
    if (!prompt) {
      return reply.code(400).send({ error: "prompt is required" })
    }
    const result = isExploratoryPrompt(prompt, learned_exploratory || [])
    return result
  })
}
