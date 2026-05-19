import { getDb } from "./db.js"

const MASTER_KEY = process.env.VIBEOS_API_MASTER_KEY

export function authMiddleware(fastify) {
  fastify.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/health") || request.url.startsWith("/favicon")) {
      return
    }

    if (request.url.startsWith("/admin/")) {
      const authHeader = request.headers["authorization"]
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "unauthorized", message: "Missing or invalid Authorization header" })
      }
      const providedKey = authHeader.slice(7)
      if (providedKey !== MASTER_KEY) {
        return reply.code(403).send({ error: "forbidden", message: "Invalid master key" })
      }
      return
    }

    if (request.url.startsWith("/api/v1/")) {
      const authHeader = request.headers["authorization"]
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "unauthorized", message: "Missing or invalid Authorization header" })
      }
      const providedToken = authHeader.slice(7)

      const db = getDb()
      const tokenRow = db.prepare(`
        SELECT t.id, t.token, t.seat_id, t.status, t.expires_at, t.label,
               s.status as seat_status
        FROM api_tokens t
        JOIN seats s ON t.seat_id = s.id
        WHERE t.token = ?
      `).get(providedToken)

      if (!tokenRow) {
        return reply.code(401).send({ error: "unauthorized", message: "Invalid API token" })
      }

      if (tokenRow.status === "revoked") {
        return reply.code(403).send({
          error: "forbidden",
          message: "API token has been revoked",
          code: "TOKEN_REVOKED"
        })
      }

      if (tokenRow.status === "expired") {
        return reply.code(403).send({
          error: "forbidden",
          message: "API token has expired",
          code: "TOKEN_EXPIRED"
        })
      }

      if (tokenRow.seat_status !== "active") {
        return reply.code(403).send({
          error: "forbidden",
          message: "License seat is not active. Contact support.",
          code: "SEAT_INACTIVE"
        })
      }

      if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
        db.prepare("UPDATE api_tokens SET status = 'expired', revoked_at = datetime('now') WHERE id = ?").run(tokenRow.id)
        return reply.code(403).send({
          error: "forbidden",
          message: "API token has expired",
          code: "TOKEN_EXPIRED"
        })
      }

      db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(tokenRow.id)

      request.tokenId = tokenRow.id
      request.seatId = tokenRow.seat_id
      request.tokenLabel = tokenRow.label
    }
  })
}
