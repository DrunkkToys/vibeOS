import Fastify from "fastify"
import { initDb } from "./lib/db.js"
import { authMiddleware } from "./middleware/auth.js"
import { usageLoggingMiddleware } from "./middleware/usage-logging.js"
import { delegationRoutes } from "./routes/delegation.js"
import { tierRoutes } from "./routes/tier-routing.js"
import { stressRoutes } from "./routes/stress.js"
import { blackboxRoutes } from "./routes/blackbox.js"
import { tddRoutes } from "./routes/tdd.js"
import { patternRoutes } from "./routes/patterns.js"
import { pricingRoutes } from "./routes/pricing.js"
import { compressionRoutes } from "./routes/compression.js"
import { adminRoutes } from "./routes/admin.js"

const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || "0.0.0.0"

if (!process.env.VIBEOS_API_MASTER_KEY) {
  console.error("FATAL: VIBEOS_API_MASTER_KEY environment variable is required")
  process.exit(1)
}

const fastify = Fastify({
  logger: { level: process.env.NODE_ENV === "production" ? "info" : "debug" },
  bodyLimit: 10 * 1024 * 1024,
})

fastify.register(async (instance) => {
  authMiddleware(instance)
  usageLoggingMiddleware(instance)

  await delegationRoutes(instance)
  await tierRoutes(instance)
  await stressRoutes(instance)
  await blackboxRoutes(instance)
  await tddRoutes(instance)
  await patternRoutes(instance)
  await pricingRoutes(instance)
  await compressionRoutes(instance)
  await adminRoutes(instance)
})

fastify.get("/health", async () => {
  return { status: "ok", timestamp: new Date().toISOString(), version: "1.0.0" }
})

fastify.get("/favicon.ico", async (request, reply) => {
  reply.code(204).send()
})

fastify.setNotFoundHandler((request, reply) => {
  reply.code(404).send({ error: "not found", path: request.url })
})

fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error)
  reply.code(500).send({ error: "internal server error" })
})

async function start() {
  initDb()
  console.log("[vibeOS-api] Database initialized")

  try {
    await fastify.listen({ port: PORT, host: HOST })
    console.log(`[vibeOS-api] Server running on http://${HOST}:${PORT}`)
    console.log(`[vibeOS-api] Health check: http://${HOST}:${PORT}/health`)
    console.log(`[vibeOS-api] Admin endpoints require VIBEOS_API_MASTER_KEY`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()

export { fastify }
