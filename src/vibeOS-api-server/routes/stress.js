import { scoreStress, getStressLevel, buildStressFooter } from "../lib/stress.js"

export async function stressRoutes(fastify) {
  fastify.post("/api/v1/stress/score", async (request, reply) => {
    const { text } = request.body || {}
    if (!text) {
      return reply.code(400).send({ error: "text is required" })
    }
    const score = scoreStress(text)
    const level = getStressLevel(score)
    const footer = buildStressFooter(score)
    return { score, level: level.level, gauge: level.gauge, directive: level.directive, footer }
  })

  fastify.post("/api/v1/stress/level", async (request, reply) => {
    const { score } = request.body || {}
    if (score === undefined || score === null) {
      return reply.code(400).send({ error: "score is required" })
    }
    const level = getStressLevel(Number(score))
    return level
  })
}
