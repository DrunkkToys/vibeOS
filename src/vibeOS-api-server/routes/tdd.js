import { extractExports, inferFunctionParams, inferTypeFromName, buildTestSkeleton } from "../lib/tdd.js"

export async function tddRoutes(fastify) {
  fastify.post("/api/v1/tdd/exports", async (request, reply) => {
    try {
      const { source_content, ext } = request.body || {}
      if (!source_content || typeof source_content !== "string") {
        return reply.code(400).send({ error: "source_content is required and must be a string", code: "INVALID_INPUT" })
      }
      if (!ext || typeof ext !== "string") {
        return reply.code(400).send({ error: "ext is required and must be a string", code: "INVALID_INPUT" })
      }
      const exports = extractExports(source_content, ext)
      return { exports }
    } catch (err) {
      request.log.error(err, "tdd/exports error")
      return reply.code(500).send({ error: "Internal server error", code: "INTERNAL_ERROR" })
    }
  })

  fastify.post("/api/v1/tdd/params", async (request, reply) => {
    try {
      const { source_content, func_name } = request.body || {}
      if (!source_content || typeof source_content !== "string") {
        return reply.code(400).send({ error: "source_content is required and must be a string", code: "INVALID_INPUT" })
      }
      if (!func_name || typeof func_name !== "string") {
        return reply.code(400).send({ error: "func_name is required and must be a string", code: "INVALID_INPUT" })
      }
      const params = inferFunctionParams(source_content, func_name)
      return { params }
    } catch (err) {
      request.log.error(err, "tdd/params error")
      return reply.code(500).send({ error: "Internal server error", code: "INTERNAL_ERROR" })
    }
  })

  fastify.post("/api/v1/tdd/infer-type", async (request, reply) => {
    try {
      const { param_name, default_value } = request.body || {}
      const type = inferTypeFromName(param_name, default_value)
      return { type }
    } catch (err) {
      request.log.error(err, "tdd/infer-type error")
      return reply.code(500).send({ error: "Internal server error", code: "INTERNAL_ERROR" })
    }
  })

  fastify.post("/api/v1/tdd/skeleton", async (request, reply) => {
    try {
      const { language, file_name, exports, options } = request.body || {}
      if (!exports || !Array.isArray(exports)) {
        return reply.code(400).send({ error: "exports is required and must be an array", code: "INVALID_INPUT" })
      }
      if (exports.length === 0) {
        return reply.code(400).send({ error: "exports array must not be empty", code: "INVALID_INPUT" })
      }
      if (!file_name || typeof file_name !== "string") {
        return reply.code(400).send({ error: "file_name is required and must be a string", code: "INVALID_INPUT" })
      }
      const result = buildTestSkeleton(language || "javascript", file_name, exports, options || {})
      return { skeleton: result }
    } catch (err) {
      request.log.error(err, "tdd/skeleton error")
      return reply.code(500).send({ error: "Internal server error", code: "INTERNAL_ERROR" })
    }
  })
}
