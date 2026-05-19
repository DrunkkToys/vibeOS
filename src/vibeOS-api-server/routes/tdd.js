import { extractExports, inferFunctionParams, inferTypeFromName, buildTestSkeleton } from "../lib/tdd.js"

export async function tddRoutes(fastify) {
  fastify.post("/api/v1/tdd/exports", async (request, reply) => {
    const { source_content, ext } = request.body || {}
    if (!source_content || !ext) {
      return reply.code(400).send({ error: "source_content and ext are required" })
    }
    const exports = extractExports(source_content, ext)
    return { exports, count: exports.length }
  })

  fastify.post("/api/v1/tdd/params", async (request, reply) => {
    const { source_content, func_name } = request.body || {}
    if (!source_content || !func_name) {
      return reply.code(400).send({ error: "source_content and func_name are required" })
    }
    const params = inferFunctionParams(source_content, func_name)
    return { func_name, params }
  })

  fastify.post("/api/v1/tdd/infer-type", async (request, reply) => {
    const { param_name, default_value } = request.body || {}
    if (!param_name) {
      return reply.code(400).send({ error: "param_name is required" })
    }
    const type = inferTypeFromName(param_name, default_value)
    return { param_name, inferred_type: type }
  })

  fastify.post("/api/v1/tdd/skeleton", async (request, reply) => {
    const { language, file_name, exports, options } = request.body || {}
    if (!language || !file_name || !exports) {
      return reply.code(400).send({ error: "language, file_name, and exports are required" })
    }
    const skeleton = buildTestSkeleton(language, file_name, exports, options || {})
    return { skeleton, language, file_name }
  })
}
