import { compressToolOutput, COMPRESS_THRESHOLD } from "../lib/compression.js"

export async function compressionRoutes(fastify) {
  fastify.post("/api/v1/compress/context", async (request, reply) => {
    const { text, threshold } = request.body || {}
    if (!text) {
      return reply.code(400).send({ error: "text is required" })
    }
    const result = compressToolOutput(text, threshold || COMPRESS_THRESHOLD)
    return result
  })
}
