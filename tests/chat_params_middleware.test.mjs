// SPDX-License-Identifier: MIT
// chat.params / chat.headers middleware — the per-turn lever on the actual LLM request.
// Proves: model is parsed correctly, the override is applied to output.options only when
// the provider matches (no cross-provider switch), and a coherent turn is a no-op.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-chatparams-"))
mkdirSync(join(sandbox, ".claude"), { recursive: true })
process.env.VIBEOS_HOME = join(sandbox, ".claude")
process.env.OPENCODE_HOME = sandbox
const TIERS = join(sandbox, ".claude", "model-tiers.json")
const OC = join(sandbox, "opencode.json")

function setup(slot, ranModel) {
  writeFileSync(TIERS, JSON.stringify({
    trinity: {
      brain: { oc: "openrouter/big-brain" },
      medium: { oc: "openrouter/mid-model" },
      cheap: { oc: "openrouter/cheap-model" },
    },
    selection: { enabled: true, active_slot: slot },
  }))
  writeFileSync(OC, JSON.stringify({ model: ranModel, $schema: "x" }))
}

let q = 0
const fresh = () => import("../src/lib/hooks/chat-params.js?cp=" + (++q))

test("parseModelId splits provider/model (model keeps slashes)", async () => {
  const { parseModelId } = await fresh()
  assert.deepEqual(parseModelId("openrouter/anthropic/claude-3"), { providerID: "openrouter", modelID: "anthropic/claude-3" })
  assert.deepEqual(parseModelId("deepseek/deepseek-v4-flash"), { providerID: "deepseek", modelID: "deepseek-v4-flash" })
  assert.deepEqual(parseModelId("bare"), { providerID: "", modelID: "bare" })
})

test("tier mismatch (same provider) → override applies full intended id", async () => {
  setup("cheap", "openrouter/mid-model") // active_slot=cheap but turn bound to mid → redirect
  const { onChatParams, resolveIntendedModel } = await fresh()
  const r = resolveIntendedModel(sandbox, { providerID: "openrouter", modelID: "mid-model" })
  assert.equal(r.can_apply, true)
  assert.equal(r.intended_full, "openrouter/cheap-model")
  const output = { options: {} }
  await onChatParams({ _directory: sandbox, model: { providerID: "openrouter", modelID: "mid-model" } }, output)
  assert.equal(output.options.model, "openrouter/cheap-model", "redirected to the tier's full model id")
})

test("cross-provider tier (user-set) → still applies full provider/model id", async () => {
  // The TIER is the source of truth; we do not care which provider the user bound to it.
  writeFileSync(TIERS, JSON.stringify({
    trinity: { medium: { oc: "opencode-go/mimo-v2.5" } },
    selection: { enabled: true, active_slot: "medium" },
  }))
  writeFileSync(OC, JSON.stringify({ model: "deepseek/deepseek-v4-flash" }))
  const { onChatParams, resolveIntendedModel } = await fresh()
  const r = resolveIntendedModel(sandbox, { providerID: "deepseek", modelID: "deepseek-v4-flash" })
  assert.equal(r.cross_provider, true, "flagged for the log, but NOT refused")
  assert.equal(r.can_apply, true)
  const output = { options: {} }
  await onChatParams({ _directory: sandbox, model: { providerID: "deepseek", modelID: "deepseek-v4-flash" } }, output)
  assert.equal(output.options.model, "opencode-go/mimo-v2.5", "full provider/model id so the host can re-resolve the provider")
})

test("already-coherent turn is a no-op", async () => {
  setup("cheap", "openrouter/cheap-model")
  const { onChatParams, resolveIntendedModel } = await fresh()
  const r = resolveIntendedModel(sandbox, { providerID: "openrouter", modelID: "cheap-model" })
  assert.equal(r.already_correct, true)
  const output = { options: {} }
  await onChatParams({ _directory: sandbox, model: { providerID: "openrouter", modelID: "cheap-model" } }, output)
  assert.equal(output.options.model, undefined, "no needless override when already on the right model")
})

test("chat.headers mirrors the override with the full intended id", async () => {
  setup("brain", "openrouter/cheap-model")
  const { onChatHeaders } = await fresh()
  const output = { headers: {} }
  await onChatHeaders({ _directory: sandbox, model: { providerID: "openrouter", modelID: "cheap-model" } }, output)
  assert.equal(output.headers["x-vibeos-model"], "openrouter/big-brain", "header carries the intended tier model")
})
