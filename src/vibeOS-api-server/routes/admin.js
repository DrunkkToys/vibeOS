import { getDb } from "../lib/db.js"
import { randomBytes } from "node:crypto"

function generateToken() {
  return "vos_" + randomBytes(32).toString("hex")
}

export async function adminRoutes(fastify) {
  fastify.post("/admin/seats", async (request, reply) => {
    const { name, email } = request.body || {}
    if (!name) {
      return reply.code(400).send({ error: "name is required" })
    }
    const db = getDb()
    const result = db.prepare("INSERT INTO seats (name, email) VALUES (?, ?)").run(name, email || null)
    const seat = db.prepare("SELECT * FROM seats WHERE id = ?").get(result.lastInsertRowid)
    return { ok: true, seat }
  })

  fastify.get("/admin/seats", async (request, reply) => {
    const db = getDb()
    const seats = db.prepare("SELECT * FROM seats ORDER BY created_at DESC").all()
    return { seats, count: seats.length }
  })

  fastify.patch("/admin/seats/:id", async (request, reply) => {
    const { id } = request.params
    const { status } = request.body || {}
    if (!status || !["active", "suspended", "cancelled"].includes(status)) {
      return reply.code(400).send({ error: "valid status is required (active, suspended, cancelled)" })
    }
    const db = getDb()
    const result = db.prepare("UPDATE seats SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id)
    if (result.changes === 0) {
      return reply.code(404).send({ error: "seat not found" })
    }

    if (status !== "active") {
      db.prepare("UPDATE api_tokens SET status = 'revoked', revoked_at = datetime('now') WHERE seat_id = ? AND status = 'active'").run(id)
    }

    const seat = db.prepare("SELECT * FROM seats WHERE id = ?").get(id)
    return { ok: true, seat }
  })

  fastify.post("/admin/tokens", async (request, reply) => {
    const { seat_id, label, expires_at } = request.body || {}
    if (!seat_id) {
      return reply.code(400).send({ error: "seat_id is required" })
    }
    const db = getDb()
    const seat = db.prepare("SELECT * FROM seats WHERE id = ?").get(seat_id)
    if (!seat) {
      return reply.code(404).send({ error: "seat not found" })
    }

    const token = generateToken()
    const result = db.prepare(
      "INSERT INTO api_tokens (token, seat_id, label, expires_at) VALUES (?, ?, ?, ?)"
    ).run(token, seat_id, label || null, expires_at || null)

    const tokenRow = db.prepare("SELECT * FROM api_tokens WHERE id = ?").get(result.lastInsertRowid)
    return { ok: true, token: tokenRow }
  })

  fastify.get("/admin/tokens", async (request, reply) => {
    const db = getDb()
    const tokens = db.prepare(`
      SELECT t.*, s.name as seat_name, s.email as seat_email, s.status as seat_status
      FROM api_tokens t
      JOIN seats s ON t.seat_id = s.id
      ORDER BY t.created_at DESC
    `).all()
    return { tokens, count: tokens.length }
  })

  fastify.patch("/admin/tokens/:id", async (request, reply) => {
    const { id } = request.params
    const { status } = request.body || {}
    if (!status || !["active", "revoked", "expired"].includes(status)) {
      return reply.code(400).send({ error: "valid status is required (active, revoked, expired)" })
    }
    const db = getDb()
    const update = status === "revoked"
      ? "UPDATE api_tokens SET status = ?, revoked_at = datetime('now') WHERE id = ?"
      : "UPDATE api_tokens SET status = ? WHERE id = ?"
    const result = db.prepare(update).run(status, id)
    if (result.changes === 0) {
      return reply.code(404).send({ error: "token not found" })
    }
    const token = db.prepare("SELECT * FROM api_tokens WHERE id = ?").get(id)
    return { ok: true, token }
  })

  fastify.delete("/admin/tokens/:id", async (request, reply) => {
    const { id } = request.params
    const db = getDb()
    const result = db.prepare("DELETE FROM api_tokens WHERE id = ?").run(id)
    if (result.changes === 0) {
      return reply.code(404).send({ error: "token not found" })
    }
    return { ok: true, message: "token deleted" }
  })

  fastify.get("/admin/usage", async (request, reply) => {
    const { days = 30 } = request.query || {}
    const db = getDb()
    const usage = db.prepare(`
      SELECT
        t.token,
        t.label,
        s.name as seat_name,
        COUNT(*) as request_count,
        AVG(l.latency_ms) as avg_latency_ms,
        MIN(l.created_at) as first_used,
        MAX(l.created_at) as last_used
      FROM usage_log l
      JOIN api_tokens t ON l.token_id = t.id
      JOIN seats s ON t.seat_id = s.id
      WHERE l.created_at >= datetime('now', ?)
      GROUP BY t.id
      ORDER BY request_count DESC
    `, [`-${Number(days)} days`]).all()
    return { usage, count: usage.length, days: Number(days) }
  })
}
