import { ResolutionTracker, SUB_REGIMES } from "../lib/blackbox.js"

const trackers = new Map()

export async function blackboxRoutes(fastify) {
  fastify.post("/api/v1/blackbox/analyze", async (request, reply) => {
    const { session_id, entry } = request.body || {}
    if (!entry) {
      return reply.code(400).send({ error: "entry is required" })
    }

    let tracker = trackers.get(session_id || "default")
    if (!tracker) {
      tracker = new ResolutionTracker()
      trackers.set(session_id || "default", tracker)
    }

    tracker.update(entry)
    return tracker.getState()
  })

  fastify.post("/api/v1/blackbox/state", async (request, reply) => {
    const { session_id } = request.body || {}
    const tracker = trackers.get(session_id || "default")
    if (!tracker) {
      return reply.code(404).send({ error: "no tracker found for session" })
    }
    return tracker.getState()
  })

  fastify.post("/api/v1/blackbox/reset", async (request, reply) => {
    const { session_id } = request.body || {}
    trackers.delete(session_id || "default")
    return { ok: true, message: "tracker reset" }
  })

  fastify.get("/api/v1/blackbox/regimes", async (request, reply) => {
    return { regimes: SUB_REGIMES }
  })
}
