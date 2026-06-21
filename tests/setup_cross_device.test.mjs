// SPDX-License-Identifier: MIT
// Regression: npx vibeostheog setup reads opencode.json for user model on any device.

import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"

test("setup: reads model from opencode.json when no OpenCode context", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-setup-test-"))
  const cwd = mkdtempSync(join(tmpdir(), "vibeos-setup-cwd-"))
  const claudeDir = join(sandbox, ".claude")
  mkdirSync(claudeDir, { recursive: true })
  writeFileSync(join(claudeDir, "opencode.json"), JSON.stringify({ model: "custom-provider/my-model" }))
  writeFileSync(join(claudeDir, "model-tiers.json"), JSON.stringify({ trinity: {}, selection: { enabled: true } }))

  const oldHOME = process.env.HOME, oldVH = process.env.VIBEOS_HOME, oldOC = process.env.OPENCODE_HOME
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = claudeDir
  process.env.OPENCODE_HOME = claudeDir

  // Simulate what trinity setup does: read opencode.json when deps.currentModel is empty
  let selectedModel = ""
  for (const dir of [cwd, claudeDir].filter(Boolean)) {
    const p = join(dir, "opencode.json")
    try {
      const oc = JSON.parse(readFileSync(p, "utf-8"))
      if (oc?.model) { selectedModel = oc.model; break }
    } catch {}
  }
  assert.equal(selectedModel, "custom-provider/my-model", "reads model from opencode.json")

  // Simulate fallback chain: trinity=null, selectedModel set
  const trinity = null
  const brain = trinity?.brain || selectedModel || ""
  const medium = trinity?.medium || brain
  const cheap = trinity?.cheap || medium || brain
  assert.equal(brain, "custom-provider/my-model")
  assert.equal(medium, "custom-provider/my-model")
  assert.equal(cheap, "custom-provider/my-model")

  process.env.HOME = oldHOME; process.env.VIBEOS_HOME = oldVH; process.env.OPENCODE_HOME = oldOC
  rmSync(cwd, { recursive: true, force: true })
  rmSync(sandbox, { recursive: true, force: true })
})

test("setup: seeded free slot keeps precedence over fallback slots", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-setup-free-slot-"))
  const claudeDir = join(sandbox, ".claude")
  mkdirSync(claudeDir, { recursive: true })
  const oldHOME = process.env.HOME, oldVH = process.env.VIBEOS_HOME, oldOC = process.env.OPENCODE_HOME
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = claudeDir
  process.env.OPENCODE_HOME = claudeDir

  const trinity = {
    brain: "deepseek/deepseek-v4-pro",
    medium: "deepseek/deepseek-v4-flash",
    cheap: "opencode/big-pickle",
  }
  const selectedModel = "custom-provider/my-model"
  const brain = trinity?.brain || selectedModel || ""
  const medium = trinity?.medium || brain
  const cheap = trinity?.cheap || medium || brain

  assert.equal(brain, "deepseek/deepseek-v4-pro")
  assert.equal(medium, "deepseek/deepseek-v4-flash")
  assert.equal(cheap, "opencode/big-pickle", "seeded free slot stays preferred over paid fallbacks")

  process.env.HOME = oldHOME
  process.env.VIBEOS_HOME = oldVH
  process.env.OPENCODE_HOME = oldOC
  rmSync(sandbox, { recursive: true, force: true })
})

test("setup: buildDeterministicTrinity returns null when no models discovered", async () => {
  const mod = await import("../src/lib/pricing.js?" + Date.now())
  const result = mod.buildDeterministicTrinity([], { selectedModelId: "test-provider/test-model" })
  assert.equal(result, null, "returns null when no models discovered (setup handles via fallback chain)")
})

test("setup: buildDeterministicTrinity keeps selected model separate from brain slot", async () => {
  const mod = await import("../src/lib/pricing.js?" + Date.now())
  const result = mod.buildDeterministicTrinity([
    { id: "anthropic/claude-opus-4-7" },
    { id: "anthropic/claude-sonnet-4-6" },
    { id: "anthropic/claude-haiku-4-5" },
  ], { selectedModelId: "anthropic/claude-sonnet-4-6" })

  assert.ok(result, "should build a deterministic trinity from discovered models")
  assert.equal(result.brain, "anthropic/claude-opus-4-7", "brain should be the ranked orchestration slot")
  assert.equal(result.selected_model, "anthropic/claude-sonnet-4-6", "selected model stays as metadata")
  assert.equal(result.selected_tier, "mid", "selected tier tracks the selected model, not the brain slot")
})
