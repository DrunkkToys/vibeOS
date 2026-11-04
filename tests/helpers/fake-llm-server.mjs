// SPDX-License-Identifier: MIT
import { createServer } from "node:http"

export async function startFakeLlm({ reply = () => "ok" } = {}) {
  const requests = []
  const server = createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => { raw += c })
    req.on("end", () => {
      let body = {}
      try { body = JSON.parse(raw || "{}") } catch {}
      if (!req.url.includes("/chat/completions")) {
        res.writeHead(404).end()
        return
      }
      const text = String(reply(body) ?? "ok")
      requests.push({ model: body.model, stream: body.stream === true, messages: body.messages || [] })
      const usage = { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }
      if (body.stream !== true) {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ id: "fake", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage }))
        return
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
      const chunk = (choices, extra = {}) => `data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", created: 0, model: body.model, choices, ...extra })}\n\n`
      res.write(chunk([{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }]))
      res.write(chunk([{ index: 0, delta: {}, finish_reason: "stop" }], { usage }))
      res.end("data: [DONE]\n\n")
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
