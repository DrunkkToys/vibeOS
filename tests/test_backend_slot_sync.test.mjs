// SPDX-License-Identifier: MIT
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-backend-sync-"))
mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(join(sandbox, ".opencode"), { recursive: true })
mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })

const prevVibeHome = process.env.VIBEOS_HOME
const prevHome = process.env.HOME
process.env.VIBEOS_HOME = join(sandbox, ".claude")
process.env.HOME = sandbox

writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({
  model: "deepseek/v4-pro",
  plugin: ["vibeOS"],
}))

after(() => {
  try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
  try { process.env.HOME = prevHome } catch {}
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})

test("backend-authoritative sync applies cheap slot even with stale lock", async () => {
  writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: "brain",
      slot_locked: true,
      optimization_mode: "vibeultrax",
      active_pipeline: JSON.stringify(["brain"]),
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-flash" },
      medium: { oc: "opencode-go/mimo-v2.5" },
      cheap: { oc: "opencode/big-pickle" },
    },
  }))

  const { syncControlSettings } = await import("../src/lib/hooks/chat-transform.js?backend-sync=" + Date.now())
  const result = syncControlSettings({
    optimization_mode: "vibeultrax",
    tier_bias: "cheap",
    pipeline_root: ["cheap"],
    enforcement_mode: "strict",
    flow_mode: "strict",
    tdd_mode: "quality",
    thinking_mode: "full",
  }, {
    authoritative: true,
    backendDecision: {
      source: "backend",
      requested_mode: "vibeultrax",
      requested_slot: "cheap",
    },
  })

  const sel = JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf-8")).selection
  assert.strictEqual(sel.active_slot, "cheap")
  assert.strictEqual(sel.vector_changed_slot, "cheap")
  assert.deepStrictEqual(JSON.parse(sel.active_pipeline), ["cheap"])
  assert.strictEqual(result.applied_slot, "cheap")
  assert.strictEqual(result.applied_mode, "vibeultrax")
  assert.deepStrictEqual(result.applied_pipeline, ["cheap"])

  const { _appendFooter } = await import("../src/lib/hooks/footer.js?backend-sync=" + Date.now())
  const message = { text: "This is a long enough response to trigger the footer and verify the applied backend slot is what the user sees." }
  await _appendFooter({ args: { model: "deepseek/v4-pro" } }, message)
  assert.ok(message.text.includes("⚡ cheap"), "footer should show the applied cheap slot: " + message.text.slice(-160))
})

test("blackboxState sends the applied slot ack payload", async () => {
  let captured = null
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => { body += chunk.toString() })
    req.on("end", () => {
      captured = { method: req.method, url: req.url, body: body ? JSON.parse(body) : null }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
    })
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const { VibeOSApiClient } = await import("../src/lib/api-client.js?backend-sync=" + Date.now())
  const client = new VibeOSApiClient({ baseUrl, apiToken: "vos_" + "a".repeat(64) })
  await client.blackboxState("sid-123", {
    applied_slot: "cheap",
    applied_mode: "vibeultrax",
    applied_pipeline: ["cheap", "medium"],
    requested_mode: "vibeultrax",
    requested_slot: "cheap",
  })

  await new Promise((resolve) => server.close(resolve))
  assert.ok(captured)
  assert.strictEqual(captured.method, "POST")
  assert.strictEqual(captured.url, "/api/v1/blackbox/state")
  assert.strictEqual(captured.body.session_id, "sid-123")
  assert.strictEqual(captured.body.applied_slot, "cheap")
  assert.strictEqual(captured.body.applied_mode, "vibeultrax")
  assert.deepStrictEqual(captured.body.applied_pipeline, ["cheap", "medium"])
  assert.strictEqual(captured.body.requested_mode, "vibeultrax")
  assert.strictEqual(captured.body.requested_slot, "cheap")
})
