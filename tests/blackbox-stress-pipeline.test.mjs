// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>

import test, { after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-blackbox-cascade-"))
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")
process.env.VIBEOS_OPENCODE_HOME = join(sandbox, ".config", "opencode")

mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
mkdirSync(join(sandbox, ".claude", "scratch"), { recursive: true })

writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
  trinity: {
    brain: { oc: "deepseek/deepseek-v4-pro" },
    medium: { oc: "deepseek/deepseek-v4-flash" },
    cheap: { oc: "deepseek/deepseek-chat" },
  },
  selection: {
    enabled: true,
    active_slot: "brain",
    active_pipeline: ["local", "medium", "brain"],
    delegation_enforce: true,
    flow_enabled: true,
    tdd_enforce: true,
    optimization_mode: "budget",
  },
}, null, 2))

writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({
  model: "deepseek/deepseek-v4-pro",
  provider: {
    deepseek: {
      models: {
        "deepseek-v4-pro": {},
        "deepseek-v4-flash": {},
        "deepseek-chat": {},
      },
    },
  },
}, null, 2))

const cacheBust = `?blackbox_cascade=${Date.now()}`
const mod = await import("../src/index.js" + cacheBust)
const state = await import("../src/lib/state.js")
const mlRouter = await import("../src/vibeOS-lib/ml-router.js" + cacheBust)
const vibeultrax = await import("../src/vibeOS-lib/blackbox/vibeultrax.js" + cacheBust)

const testCase = (name, fn) => test(name, { concurrency: false }, fn)

after(() => {
  try { state._flushLedgerBuffer?.() } catch {}
  try { state.setLedgerBufferTimer?.(null) } catch {}
  try { mod.closeMcpServer?.() } catch {}
})

function cloneGraph(graph) {
  return JSON.parse(JSON.stringify(graph))
}

function restoreGraph(graph, snapshot) {
  for (const key of Object.keys(graph)) delete graph[key]
  Object.assign(graph, snapshot)
}

function primeBrain(projectDir) {
  mod.applySlot("brain", projectDir)
  mod.setCurrentModel("deepseek/deepseek-v4-pro")
  mod.setCurrentTier("high")
}

testCase("real cascade: task hook routes simple prompts to cheap and moderate prompts to medium", async () => {
  const projectDir = join(sandbox, "task-project")
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-pro" }, null, 2))

  const hooks = await mod.DelegationEnforcer({ client: {}, directory: projectDir })
  if (!hooks["tool.execute.before"]) return

  primeBrain(projectDir)

  const simplePrompt = "check build status"
  assert.equal(mlRouter.computeDifficulty(simplePrompt).level, "simple")
  const simpleArgs = { model: null, modelID: null, modelId: null, prompt: simplePrompt }
  await hooks["tool.execute.before"]({ tool: "task" }, { args: simpleArgs })
  assert.equal(simpleArgs.model, "deepseek/deepseek-chat")
  assert.equal(simpleArgs.modelID, "deepseek/deepseek-chat")
  assert.equal(simpleArgs.modelId, "deepseek/deepseek-chat")

  primeBrain(projectDir)

  const mediumPrompt = "implement a distributed auth pipeline with database migration and integration tests"
  assert.equal(mlRouter.computeDifficulty(mediumPrompt).level, "moderate")
  const mediumArgs = { model: null, modelID: null, modelId: null, prompt: mediumPrompt }
  await hooks["tool.execute.before"]({ tool: "task" }, { args: mediumArgs })
  assert.equal(mediumArgs.model, "deepseek/deepseek-v4-flash")
  assert.equal(mediumArgs.modelID, "deepseek/deepseek-v4-flash")
  assert.equal(mediumArgs.modelId, "deepseek/deepseek-v4-flash")
})

testCase("real cascade: learned graph switches vibeultrax into the deep three-stage pipeline", async () => {
  const graph = state._mlGraph
  const snapshot = cloneGraph(graph)
  try {
    const firstWord = "orchestrate"
    mlRouter.addRouteEdge(graph, firstWord, "deepseek/deepseek-v4-pro", "brain", true)
    mlRouter.addRouteEdge(graph, firstWord, "deepseek/deepseek-v4-pro", "brain", true)
    mlRouter.addRouteEdge(graph, firstWord, "deepseek/deepseek-v4-pro", "brain", true)
    mlRouter.addRouteEdge(graph, firstWord, "deepseek/deepseek-v4-flash", "medium", false)

    const result = vibeultrax.vibeultraxPipeline({
      user_text: "orchestrate login validation and rollback-safe deployment",
    })

    assert.equal(result.source_strategy, "learned")
    assert.equal(result.learned_model, "deepseek/deepseek-v4-pro")
    assert.equal(result.learned_tier, "brain")
    assert.equal(result.profile, "deep")
    assert.equal(result.cascade_depth, 3)
    assert.equal(result.pipeline.join(","), "local,medium,brain")
  } finally {
    restoreGraph(graph, snapshot)
  }
})
