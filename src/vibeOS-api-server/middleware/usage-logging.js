import { getDb } from "../lib/db.js"

export function usageLoggingMiddleware(fastify) {
  fastify.addHook("onResponse", async (request, reply) => {
    if (!request.tokenId || !request.url.startsWith("/api/v1/")) return

    try {
      const db = getDb()
      const duration = request.hrtime ? Math.round(request.hrtime()[1] / 1e6) : 0
      db.prepare(`
        INSERT INTO usage_log (token_id, endpoint, request_body, response_size, latency_ms)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        request.tokenId,
        request.url,
        request.body ? JSON.stringify(request.body).substring(0, 4096) : null,
        reply.getHeader("content-length") || 0,
        duration
      )
    } catch (err) {
      console.error("[vibeOS-api] usage logging error:", err.message)
    }
  })
}
