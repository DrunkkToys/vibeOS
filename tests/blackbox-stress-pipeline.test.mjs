// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>

import test, { after } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-blackbox-cascade-"))
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")
process.env.VIBEOS_OPENCODE_HOME = join(sandbox, ".config", "opencode")

mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
mkdirSync(join(sandbox, ".claude", "scratch"), { recursive: true })
writeFileSync(join(sandbox, ".claude", "global-learning.json"), JSON.stringify({}, null, 2))

writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
  trinity: {
    brain: { oc: "deepseek/deepseek-v4-pro" },
    medium: { oc: "deepseek/deepseek-v4-flash" },
    cheap: { oc: "deepseek/deepseek-chat" },
  },
  selection: {
    enabled: true,
    active_slot: "brain",
    active_pipeline: ["cheap", "medium", "brain"],
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ""
    req.on("data", (chunk) => { raw += String(chunk || "") })
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on("error", reject)
  })
}

const backend = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1")
  if (req.method === "POST" && url.pathname === "/api/v1/route/model") {
    const body = await readBody(req)
    const prompt = String(body?.prompt || "")
    res.setHeader("Content-Type", "application/json")
    if (/remote[- ]target/i.test(prompt)) {
      res.end(JSON.stringify({
        target: "deepseek/deepseek-v4-pro",
        confidence: 0.98,
        reason: "remote override",
      }))
      return
    }
    res.end(JSON.stringify({
      target: null,
      confidence: /implement|compare|analyze/i.test(prompt) ? 0.3 : 0.1,
      reason: "allow local cascade",
    }))
    return
  }
  if (req.method === "POST" && url.pathname === "/api/v1/delegate/check") {
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ blocked: true, savings: 0.031, reason: "fixture" }))
    return
  }
  if (req.method === "GET" && url.pathname === "/health") {
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ status: "ok", version: "fixture" }))
    return
  }
  res.statusCode = 404
  res.end("not found")
})

const backendPort = await new Promise((resolve, reject) => {
  backend.once("error", reject)
  backend.listen(0, "127.0.0.1", () => {
    const address = backend.address()
    resolve(typeof address === "object" && address ? address.port : 0)
  })
})
process.env.VIBEOS_API_URL = `http://127.0.0.1:${backendPort}`
process.env.VIBEOS_API_TOKEN = "vos_aabbccdd001122334455667788990011223344556677889900aabbccddeeff00"

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
  try { backend.close() } catch {}
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

function readGlobalLearning() {
  return readJson(join(sandbox, ".claude", "global-learning.json"))
}

function readActiveJobs() {
  return readJson(join(sandbox, ".claude", "active-jobs.json"))
}

async function routeTaskPrompt(hooks, prompt) {
  const args = { model: null, modelID: null, modelId: null, prompt }
  await hooks["tool.execute.before"]({ tool: "task" }, { args })
  return args
}

testCase("real cascade: task hook routes simple prompts to cheap and moderate prompts to medium", async () => {
  const projectDir = join(sandbox, "task-project")
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-pro" }, null, 2))

  const hooks = await mod.DelegationEnforcer({ client: {}, directory: projectDir })
  if (!hooks["tool.execute.before"]) return

  primeBrain(projectDir)

  const simplePrompt = "check build status quickly please"
  assert.equal(mlRouter.computeDifficulty(simplePrompt).level, "simple")
  const simpleArgs = await routeTaskPrompt(hooks, simplePrompt)
  assert.equal(simpleArgs.model, "deepseek/deepseek-chat")
  assert.equal(simpleArgs.modelID, "deepseek/deepseek-chat")
  assert.equal(simpleArgs.modelId, "deepseek/deepseek-chat")
  const simpleJobs = readActiveJobs()
  const simpleJob = Object.values(simpleJobs)[0]
  assert.equal(typeof simpleJob?.prompt === "string" && simpleJob.prompt.includes("check build status"), true)
  const cheapLearning = readGlobalLearning()
  assert.equal(cheapLearning.task_first_words?.check?.cheap >= 1, true)

  await hooks["tool.execute.after"]({ tool: "task" }, { result: "done" })
  assert.equal(Object.values(readActiveJobs())[0]?.prompt?.includes("check build status"), true)

  primeBrain(projectDir)

  const mediumPrompt = "implement a distributed auth pipeline with database migration and integration tests"
  assert.equal(mlRouter.computeDifficulty(mediumPrompt).level, "moderate")
  const mediumArgs = await routeTaskPrompt(hooks, mediumPrompt)
  assert.equal(mediumArgs.model, "deepseek/deepseek-v4-flash")
  assert.equal(mediumArgs.modelID, "deepseek/deepseek-v4-flash")
  assert.equal(mediumArgs.modelId, "deepseek/deepseek-v4-flash")
  const mediumJobs = readActiveJobs()
  const mediumJob = Object.values(mediumJobs)[0]
  assert.equal(typeof mediumJob?.prompt === "string" && mediumJob.prompt.includes("distributed auth pipeline"), true)
  const mediumLearning = readGlobalLearning()
  assert.equal(mediumLearning.task_first_words?.implement?.medium >= 1, true)

  await hooks["tool.execute.after"]({ tool: "task" }, { result: "done" })
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
    assert.equal(result.pipeline.join(","), "cheap,medium,brain")
  } finally {
    restoreGraph(graph, snapshot)
  }
})

testCase("real cascade edge cases: remote route targets win and blank prompts preserve prior job state", async () => {
  const projectDir = join(sandbox, "edge-project")
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-pro" }, null, 2))

  const hooks = await mod.DelegationEnforcer({ client: {}, directory: projectDir })
  if (!hooks["tool.execute.before"]) return

  primeBrain(projectDir)

  const remoteArgs = await routeTaskPrompt(hooks, "check build status remote target")
  assert.equal(remoteArgs.model, "deepseek/deepseek-v4-pro")
  assert.equal(remoteArgs.modelID, "deepseek/deepseek-v4-pro")
  const afterRemoteJobs = readActiveJobs()
  const afterRemoteLearning = readGlobalLearning()
  const activeJobId = Object.keys(afterRemoteJobs).find((id) => afterRemoteJobs[id]?.status === "active") || ""

  await hooks["tool.execute.after"]({ tool: "task" }, { result: "done" })

  const blankArgs = await routeTaskPrompt(hooks, "")
  assert.equal(blankArgs.model, "deepseek/deepseek-v4-flash")
  assert.equal(blankArgs.modelID, "deepseek/deepseek-v4-flash")
  const afterBlankJobs = readActiveJobs()
  assert.equal(Object.keys(afterBlankJobs).length, Object.keys(afterRemoteJobs).length)
  assert.equal(afterBlankJobs[activeJobId]?.prompt, afterRemoteJobs[activeJobId]?.prompt)
  assert.deepEqual(readGlobalLearning(), afterRemoteLearning)
})
