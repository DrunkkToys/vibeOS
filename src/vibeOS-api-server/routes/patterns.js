import { PatternStore } from "../lib/patterns.js"

const stores = new Map()

function getStore(sessionId = "default") {
  if (!stores.has(sessionId)) {
    stores.set(sessionId, new PatternStore())
  }
  return stores.get(sessionId)
}

export async function patternRoutes(fastify) {
  fastify.post("/api/v1/patterns/observe", async (request, reply) => {
    const { session_id, tool_name, input, output, directory } = request.body || {}
    if (!tool_name) {
      return reply.code(400).send({ error: "tool_name is required" })
    }
    const store = getStore(session_id)
    const patterns = store.observeToolEvent(tool_name, input, output, directory)
    return { patterns_detected: patterns.length, patterns }
  })

  fastify.post("/api/v1/patterns/record", async (request, reply) => {
    const { session_id, kind, key, summary, meta } = request.body || {}
    if (!kind || !key || !summary) {
      return reply.code(400).send({ error: "kind, key, and summary are required" })
    }
    const store = getStore(session_id)
    const pattern = store.recordPattern(kind, key, summary, meta || {})
    return pattern
  })

  fastify.get("/api/v1/patterns/query", async (request, reply) => {
    const { session_id, kind } = request.query || {}
    const store = getStore(session_id)
    const patterns = store.getPatterns(kind || null)
    return { patterns, count: patterns.length }
  })

  fastify.get("/api/v1/patterns/exploratory-words", async (request, reply) => {
    const { session_id } = request.query || {}
    const store = getStore(session_id)
    const words = store.getLearnedExploratoryWords()
    return { words }
  })

  fastify.post("/api/v1/patterns/clear", async (request, reply) => {
    const { session_id } = request.body || {}
    const store = getStore(session_id)
    store.clear()
    return { ok: true }
  })
}
