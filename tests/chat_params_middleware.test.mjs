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

test("tier mismatch (same provider) → override sets the MODEL ID within that provider", async () => {
  setup("cheap", "openrouter/mid-model") // active_slot=cheap but turn bound to mid → redirect
  const { onChatParams, resolveIntendedModel } = await fresh()
  const r = resolveIntendedModel(sandbox, { providerID: "openrouter", modelID: "mid-model" })
  assert.equal(r.can_apply, true)
  assert.equal(r.modelID, "cheap-model")
  assert.equal(r.cheap_first_primary_miss, false)
  const output = { options: {} }
  await onChatParams({ _directory: sandbox, model: { providerID: "openrouter", modelID: "mid-model" } }, output)
  // Provider is fixed by OpenCode; we set ONLY the model id (no provider prefix), else the
  // provider rejects it — LIVE-PROVEN: "opencode/big-pickle is not a valid model ID".
  assert.equal(output.options.model, "cheap-model", "model id only, within the resolved provider")
})

test("cross-provider cheap-first miss is flagged and not injected", async () => {
  // The TIER is the source of truth, but the platform fixes the provider. Injecting a
  // foreign-provider model id errors and fails the turn, so we log and pass through.
  writeFileSync(TIERS, JSON.stringify({
    trinity: {
      cheap: { oc: "opencode-go/mimo-v2.5" },
      medium: { oc: "deepseek/deepseek-v4-flash" },
      brain: { oc: "deepseek/deepseek-v4-pro" },
    },
    selection: { enabled: true, active_slot: "cheap", entry_slot: "cheap", selected_slot: "brain", optimization_mode: "vibeultrax", selected_subagent: "vibe-brain", requires_delegation: true },
  }))
  writeFileSync(OC, JSON.stringify({ model: "deepseek/deepseek-v4-flash" }))
  const { onChatParams, resolveIntendedModel } = await fresh()
  const r = resolveIntendedModel(sandbox, { providerID: "deepseek", modelID: "deepseek-v4-flash" })
  assert.equal(r.cross_provider, true)
  assert.equal(r.cheap_first_primary_miss, true, "vibeultrax cheap entry on a foreign provider must be flagged as degraded")
  assert.equal(r.can_apply, false, "cannot switch providers via this hook")
  const output = { options: {}, headers: {} }
  await onChatParams({ _directory: sandbox, model: { providerID: "deepseek", modelID: "deepseek-v4-flash" } }, output)
  assert.equal(output.options.model, undefined, "no foreign-provider id injected — the turn is left intact")
  assert.equal(output.headers["x-vibeos-cheap-first"], "degraded")
  assert.equal(output.headers["x-vibeos-selected-subagent"], "vibe-brain")
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
  assert.equal(output.headers["x-vibeos-model"], "big-brain", "header carries the intended tier model id")
})
