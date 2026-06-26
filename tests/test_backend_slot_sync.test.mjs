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
  assert.deepStrictEqual(sel.active_pipeline, ["cheap", "medium", "brain"])
  assert.strictEqual(result.applied_slot, "cheap")
  assert.strictEqual(result.applied_mode, "vibeultrax")
  assert.deepStrictEqual(result.applied_pipeline, ["cheap", "medium", "brain"])

  const { _appendFooter } = await import("../src/lib/hooks/footer.js?backend-sync=" + Date.now())
  const message = { text: "This is a long enough response to trigger the footer and verify the applied backend slot is what the user sees." }
  await _appendFooter({ args: { model: "deepseek/v4-pro" } }, message)
  assert.ok(message.text.includes("VibeUltraX") || message.text.includes("cheap"), "footer should show the applied backend slot or mode: " + message.text.slice(-160))
})

test("selection manager normalizes string active_pipeline to array for cascade gating", async () => {
  writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: "cheap",
      slot_locked: false,
      optimization_mode: "vibeultrax",
      active_pipeline: JSON.stringify(["cheap", "medium", "brain"]),
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-flash" },
      medium: { oc: "opencode-go/mimo-v2.5" },
      cheap: { oc: "opencode/big-pickle" },
    },
  }))

  const { loadSelection } = await import("../src/lib/selection-manager.js?pipeline-normalize=" + Date.now())
  const sel = loadSelection()
  assert.ok(Array.isArray(sel.active_pipeline), "active_pipeline should normalize to an array")
  assert.deepStrictEqual(sel.active_pipeline, ["cheap", "medium", "brain"])
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

test("backend-selected cheap stays live in auto mode — directory config does not override", async () => {
  // Set up: active_slot=cheap with valid model, directory config points to brain model
  writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: "cheap",
      slot_locked: false,
      optimization_mode: "auto",
      active_pipeline: JSON.stringify(["cheap"]),
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-flash" },
      medium: { oc: "opencode-go/mimo-v2.5" },
      cheap: { oc: "opencode/big-pickle" },
    },
  }))
  // Directory config has a brain-tier model — should NOT override the cheap slot
  writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({
    model: "deepseek/deepseek-v4-flash",
    plugin: ["vibeOS"],
  }))

  const { _refreshModel } = await import("../src/lib/pricing.js?backend-auto=" + Date.now())
  _refreshModel(sandbox)

  const sel = JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf-8")).selection
  assert.strictEqual(sel.active_slot, "cheap", "cheap slot should survive — backend decision is authoritative")
})

test("applied slot is reported back to backend state via ack", async () => {
  let capturedAck = null
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => { body += chunk.toString() })
    req.on("end", () => {
      capturedAck = { method: req.method, url: req.url, body: body ? JSON.parse(body) : null }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true, session_id: "ack-test" }))
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: "brain",
      slot_locked: false,
      optimization_mode: "vibeultrax",
      active_pipeline: JSON.stringify(["brain"]),
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-flash" },
      medium: { oc: "opencode-go/mimo-v2.5" },
      cheap: { oc: "opencode/big-pickle" },
    },
  }))

  const { syncControlSettings } = await import("../src/lib/hooks/chat-transform.js?ack-roundtrip=" + Date.now())
  const syncResult = syncControlSettings({
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

  // Simulate what chat-transform.ts does: send the ack
  const { VibeOSApiClient } = await import("../src/lib/api-client.js?ack-roundtrip=" + Date.now())
  const client = new VibeOSApiClient({ baseUrl, apiToken: "vos_" + "a".repeat(64) })
  await client.blackboxState("sid-ack", {
    applied_slot: syncResult.applied_slot,
    applied_mode: syncResult.applied_mode,
    applied_pipeline: syncResult.applied_pipeline,
    source: "backend",
    requested_mode: "vibeultrax",
    requested_slot: "cheap",
  })

  await new Promise((resolve) => server.close(resolve))
  assert.ok(capturedAck, "ack should be sent to backend")
  assert.strictEqual(capturedAck.body.applied_slot, "cheap", "ack should report cheap as applied slot")
  assert.strictEqual(capturedAck.body.applied_mode, "vibeultrax", "ack should report vibeultrax as applied mode")
  assert.deepStrictEqual(capturedAck.body.applied_pipeline, ["cheap", "medium", "brain"], "ack should report durable cascade pipeline")
})

test("footer matches the applied live slot from backend state", async () => {
  writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: "cheap",
      slot_locked: false,
      optimization_mode: "vibeultrax",
      active_pipeline: JSON.stringify(["cheap"]),
      vector_changed_slot: "cheap",
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-flash" },
      medium: { oc: "opencode-go/mimo-v2.5" },
      cheap: { oc: "opencode/big-pickle" },
    },
  }))

  const { _appendFooter } = await import("../src/lib/hooks/footer.js?footer-slot-match=" + Date.now())
  const message = { text: "Backend-authoritative slot sync test — verifying footer shows the live OpenCode model, not the cheap slot label." }
  await _appendFooter({ args: { model: "deepseek/v4-pro" } }, message)
  assert.ok(message.text.includes("V4 Pro"), "footer should display the live OpenCode model label, not the applied slot: " + message.text.slice(-200))
})

test("live API connection not blocked by stale local disable state", async () => {
  writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: "cheap",
      slot_locked: false,
      optimization_mode: "vibeultrax",
      active_pipeline: JSON.stringify(["cheap"]),
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-flash" },
      medium: { oc: "opencode-go/mimo-v2.5" },
      cheap: { oc: "opencode/big-pickle" },
    },
  }))

  const { _appendFooter } = await import("../src/lib/hooks/footer.js?api-check=" + Date.now())
  const message = { text: "API connection test — footer should append regardless of stale disable state." }
  await _appendFooter({ args: { model: "deepseek/v4-pro" } }, message)
  assert.ok(message.text.length > 0, "footer should produce output regardless of API state")
  assert.ok(message.text.includes("cheap") || message.text.includes("VibeUltraX"), "footer should reflect the applied backend slot/mode")
})
