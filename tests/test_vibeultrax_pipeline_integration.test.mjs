import test from "node:test"
import assert from "node:assert"
import { writeFileSync, readFileSync, mkdirSync, existsSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"

let _pluginModule = null

async function loadPlugin() {
  if (_pluginModule) return _pluginModule
  const candidatePaths = [
    join(process.cwd(), "dist", "vibeOS.js"),
    "/Users/drunkktoys/Desktop/theSaver-oc/dist/vibeOS.js",
  ]
  for (const p of candidatePaths) {
    if (existsSync(p)) {
      _pluginModule = await import(p)
      return _pluginModule
    }
  }
  throw new Error("Cannot find dist/vibeOS.js")
}

async function loadMlRouter() {
  try { return await import("../src/vibeOS-lib/ml-router.js") }
  catch {
    return await import("/Users/drunkktoys/Desktop/theSaver-oc/src/vibeOS-lib/ml-router.js")
  }
}

function isolatedSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "vib-"))
  return dir
}

test("loadSelection returns active_pipeline and optimization_mode", async (t) => {
  const dir = isolatedSandbox()
  const prevHome = process.env.HOME
  process.env.HOME = dir
  try {
    const claudeDir = join(dir, ".claude")
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(join(claudeDir, "model-tiers.json"), JSON.stringify({
      trinity: { brain: { oc: "openai/gpt-4.1" }, medium: { oc: "openai/gpt-4.1-mini" }, cheap: { oc: "openai/gpt-4.1-nano" } },
      selection: { enabled: true, active_slot: "brain", delegation_enforce: true, optimization_mode: "vibeultrax", active_pipeline: ["local", "medium", "brain"] },
    }, null, 2))
    writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "openai/gpt-4.1" }))
    const mod = await loadPlugin()
    await mod.DelegationEnforcer({ client: { model: "openai/gpt-4.1" }, directory: dir })
    const tiersRaw = readFileSync(join(claudeDir, "model-tiers.json"), "utf8")
    const tiers = JSON.parse(tiersRaw)
    const sel = tiers.selection
    assert.ok(Array.isArray(sel.active_pipeline), "active_pipeline must be array")
    assert.ok(sel.active_pipeline.length === 3, "active_pipeline must have 3 elements")
    assert.equal(sel.optimization_mode, "vibeultrax")
  } finally {
    process.env.HOME = prevHome
  }
})

test("cross-session mode persistence", async (t) => {
  const dir = isolatedSandbox()
  const prevHome = process.env.HOME
  process.env.HOME = dir
  try {
    const claudeDir = join(dir, ".claude")
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(join(claudeDir, "model-tiers.json"), JSON.stringify({
      trinity: { brain: { oc: "openai/gpt-4.1" }, medium: { oc: "openai/gpt-4.1-mini" }, cheap: { oc: "openai/gpt-4.1-nano" } },
      selection: { enabled: true, active_slot: "brain", delegation_enforce: true, optimization_mode: "vibeultrax" },
    }, null, 2))
    writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "openai/gpt-4.1" }))
    const mod = await loadPlugin()
    const hooks = await mod.DelegationEnforcer({ client: { model: "openai/gpt-4.1" }, directory: dir })
    const output = { text: "mode persist test" }
    await hooks["experimental.text.complete"]({ messageID: "cross-" + randomUUID().slice(0, 6) }, output)
    const tiersRaw = readFileSync(join(claudeDir, "model-tiers.json"), "utf8")
    const tiers = JSON.parse(tiersRaw)
    assert.equal(tiers.selection.optimization_mode, "vibeultrax")
  } finally {
    process.env.HOME = prevHome
  }
})

test("footer brand is VibeUltraX when vibeultrax mode active", async (t) => {
  const dir = isolatedSandbox()
  const prevHome = process.env.HOME
  process.env.HOME = dir
  try {
    const claudeDir = join(dir, ".claude")
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(join(claudeDir, "model-tiers.json"), JSON.stringify({
      trinity: { brain: { oc: "anthropic/claude-opus-4.5" }, medium: { oc: "anthropic/claude-sonnet-4.5" }, cheap: { oc: "anthropic/claude-haiku-4.5" } },
      selection: { enabled: true, active_slot: "brain", delegation_enforce: true, optimization_mode: "vibeultrax", active_pipeline: ["local", "medium", "brain"] },
    }, null, 2))
    writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4.5" }))
    const mod = await loadPlugin()
    const hooks = await mod.DelegationEnforcer({ client: { model: "anthropic/claude-opus-4.5" }, directory: dir })
    const output = { text: "Brand check with enough content to trigger the live footer and surface the active mode, slot, and savings line in the rendered output for VibeUltraX." }
    await hooks["experimental.text.complete"]({ messageID: "brand-" + randomUUID().slice(0, 6) }, output)
    const captured = output.text || ""
    assert.ok(captured.includes("VibeUltraX"), "footer must contain VibeUltraX brand")
  } finally {
    process.env.HOME = prevHome
  }
})

test("real cascade: task routing escalates from cheap to medium on complex prompts", async (t) => {
  const dir = isolatedSandbox()
  const prevHome = process.env.HOME
  process.env.HOME = dir
  try {
    const claudeDir = join(dir, ".claude")
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(join(claudeDir, "model-tiers.json"), JSON.stringify({
      trinity: {
        brain: { oc: "deepseek/deepseek-v4-pro" },
        medium: { oc: "deepseek/deepseek-v4-flash" },
        cheap: { oc: "deepseek/deepseek-chat" },
      },
      selection: {
        enabled: true,
        active_slot: "cheap",
        delegation_enforce: true,
        flow_enabled: true,
        tdd_enforce: false,
        optimization_mode: "budget",
        active_pipeline: ["local", "medium", "brain"],
      },
    }, null, 2))
    writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-chat" }))

    const mod = await loadPlugin()
    const hooks = await mod.DelegationEnforcer({ client: { model: "deepseek/deepseek-chat" }, directory: dir })

    const cheapTask = { model: null, prompt: "check status" }
    await hooks["tool.execute.before"]({ tool: "task" }, { args: cheapTask })
    assert.equal(cheapTask.model, "deepseek/deepseek-chat", "simple task should stay on the cheap model")

    const complexTask = {
      model: null,
      prompt: "implement a distributed microservice pipeline with database migration, retries, observability, and rollbacks",
    }
    await hooks["tool.execute.before"]({ tool: "task" }, { args: complexTask })
    assert.equal(complexTask.model, "deepseek/deepseek-v4-flash", "complex task should escalate to medium through the live cascade pipeline")
  } finally {
    process.env.HOME = prevHome
  }
})

test("footer drops redundant mode label", async (t) => {
  const dir = isolatedSandbox()
  const prevHome = process.env.HOME
  process.env.HOME = dir
  try {
    const claudeDir = join(dir, ".claude")
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(join(claudeDir, "model-tiers.json"), JSON.stringify({
      trinity: { brain: { oc: "anthropic/claude-opus-4.1" }, medium: { oc: "anthropic/claude-sonnet-4.1" }, cheap: { oc: "anthropic/claude-haiku-4.1" } },
      selection: { enabled: true, active_slot: "brain", delegation_enforce: true, optimization_mode: "vibeultrax", active_pipeline: ["local", "medium", "brain"] },
    }, null, 2))
    writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "anthropic/claude-opus-4.1" }))
    const mod = await loadPlugin()
    const hooks = await mod.DelegationEnforcer({ client: { model: "anthropic/claude-opus-4.1" }, directory: dir })
    const output = { text: "no label test" }
    await hooks["experimental.text.complete"]({ messageID: "nolabel-" + randomUUID().slice(0, 6) }, output)
    const text = output.text || ""
    assert.ok(!text.includes("VibeUltraX⚡ Quality"), "footer must NOT have 'Quality' after VibeUltraX brand")
  } finally {
    process.env.HOME = prevHome
  }
})

test("slot preservation — cross-provider model survives", async (t) => {
  const dir = isolatedSandbox()
  const prevHome = process.env.HOME
  process.env.HOME = dir
  try {
    const claudeDir = join(dir, ".claude")
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(join(claudeDir, "model-tiers.json"), JSON.stringify({
      trinity: { brain: { oc: "google/gemini-2.5-pro" }, medium: { oc: "opencode-go/mimo-v2.5" }, cheap: { oc: "google/gemini-2.5-flash" } },
      selection: { enabled: true, active_slot: "brain", delegation_enforce: true, selected_provider: "google", selected_model: "google/gemini-2.5-pro" },
    }, null, 2))
    writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "google/gemini-2.5-pro" }))
    const mod = await loadPlugin()
    const hooks = await mod.DelegationEnforcer({ client: { model: "google/gemini-2.5-pro" }, directory: dir })
    const output = { text: "slot test" }
    await hooks["experimental.text.complete"]({ messageID: "preserve-" + randomUUID().slice(0, 6) }, output)
    const tiersRaw = readFileSync(join(claudeDir, "model-tiers.json"), "utf8")
    const tiers = JSON.parse(tiersRaw)
    assert.equal(tiers.trinity.medium.oc, "opencode-go/mimo-v2.5")
    assert.ok(tiers.trinity.brain.oc.toLowerCase().includes("gemini"))
    assert.ok(tiers.trinity.cheap.oc.toLowerCase().includes("gemini"))
  } finally {
    process.env.HOME = prevHome
  }
})

test("cascadeDecide wired — ML router returns valid cascade", async (t) => {
  const mlRouter = await loadMlRouter()
  const diff = mlRouter.computeDifficulty("implement a distributed microservice pipeline")
  assert.ok(diff.level === "simple" || diff.level === "moderate" || diff.level === "complex")
  assert.ok(typeof diff.score === "number" && diff.score >= 0 && diff.score <= 1)
  const cascade = mlRouter.cascadeDecide(
    "implement a distributed microservice pipeline with database migration",
    0.001, 0.005, 0.02, 0.85
  )
  assert.ok(typeof cascade.useCheap === "boolean")
  assert.ok(typeof cascade.escalate === "boolean")
  assert.ok(cascade.confidence >= 0 && cascade.confidence <= 1)
  assert.ok(typeof cascade.reason === "string")
})
