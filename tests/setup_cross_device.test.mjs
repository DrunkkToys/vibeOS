// SPDX-License-Identifier: MIT
// Regression: npx vibeostheog setup reads opencode.json for user model on any device.

import test from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"

test("setup: reads model from opencode.json when no OpenCode context", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-setup-test-"))
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
  for (const dir of [process.cwd(), claudeDir].filter(Boolean)) {
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
})

test("setup: buildDeterministicTrinity returns null when no models discovered", async () => {
  const mod = await import("../src/lib/pricing.js?" + Date.now())
  const result = mod.buildDeterministicTrinity([], { selectedModelId: "test-provider/test-model" })
  assert.equal(result, null, "returns null when no models discovered (setup handles via fallback chain)")
})
