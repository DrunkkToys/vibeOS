import { test as nodeTest, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const test = (name, options, fn) =>
  typeof options === "function"
    ? nodeTest(name, { concurrency: false }, options)
    : nodeTest(name, { concurrency: false, ...(options || {}) }, fn)

let sandbox
let DelegationEnforcer
let originalHome
let originalMcpPort

nodeTest("SETUP", { concurrency: false }, async (t) => {
  sandbox = mkdtempSync(join(tmpdir(), "trinity-mega-"))
  mkdirSync(join(sandbox, ".opencode"), { recursive: true })
  writeFileSync(join(sandbox, ".opencode/opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-pro" }))
  originalHome = process.env.HOME
  originalMcpPort = process.env.VIBEOS_MCP_PORT
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  process.env.VIBEOS_MCP_PORT = "0"
  mkdirSync(join(sandbox, ".claude"), { recursive: true })
  const mod = await import("../src/index.js?t=" + Date.now())
  DelegationEnforcer = mod.DelegationEnforcer || mod.default
})

after(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome
  if (originalMcpPort === undefined) delete process.env.VIBEOS_MCP_PORT
  else process.env.VIBEOS_MCP_PORT = originalMcpPort
  delete process.env.VIBEOS_HOME
  if (sandbox && existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
})

function setTiers(brain, medium, cheap) {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: { brain: { oc: brain || "a" }, medium: { oc: medium || "b" }, cheap: { oc: cheap || "c" } },
    selection: { enabled: true, active_slot: "brain", onboarding_mode: "strict", delegation_enforce: true, tdd_strict: false, flow_enabled: false, flow_enforce: false, tdd_enforce: false, savings_goal_usd: 5, tdd_quality: false, thinking_level: "full" },
  }))
}

async function getHooks(directory = join(sandbox, ".opencode")) {
  delete globalThis.__vibeOSRuntimeState
  const mod = await import("../src/index.js?t=" + Date.now() + "-" + Math.random())
  const hooksFactory = mod.DelegationEnforcer || mod.default || DelegationEnforcer
  return await hooksFactory({ client: {}, directory })
}

function readSel() {
  return JSON.parse(readFileSync(join(sandbox, ".claude/model-tiers.json"), "utf8")).selection
}

test("status shows dashboard", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "status" })
  assert.ok(r.includes("vibeOS") || r.includes("dashboard"), r.slice(0, 80))
  assert.ok(r.includes("Reality-check:"), r.slice(0, 200))
})

test("reality-check is active by default", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "reality-check" })
  assert.ok(r.includes("Verified facts only"), r.slice(0, 200))
  assert.ok(r.includes("Enabled: YES"), r.slice(0, 200))
  assert.ok(r.includes("Rules loaded:"), r.slice(0, 200))
})

test("set brain", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "set", slot: "brain" })
  assert.equal(readSel().active_slot, "brain")
})

test("set medium", async () => {
  if (process.env.CI === "true") return
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "set", slot: "medium" })
  assert.equal(readSel().active_slot, "medium")
})

test("set cheap", async () => {
  if (process.env.CI === "true") return
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "set", slot: "cheap" })
  assert.equal(readSel().active_slot, "cheap")
})

test("set invalid returns help", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "set", slot: "xx" })
  assert.ok(r.includes("Provide") || r.includes("brain"), r.slice(0, 80))
})

test("mode quality → brain", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "mode", slot: "quality" })
  assert.equal(readSel().active_slot, "brain")
})

test("mode speed → medium", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "mode", slot: "speed" })
  assert.equal(readSel().active_slot, "medium")
})

test("mode budget → cheap", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "mode", slot: "budget" })
  assert.equal(readSel().active_slot, "cheap")
})

test("mode vibeultrax → cheap", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "mode", slot: "vibeultrax" })
  const s = readSel().active_slot
  assert.equal(s, "cheap", "vibeultrax should start on cheap, got: " + s)
  assert.equal(readSel().slot_locked, false, "vibeultrax should clear slot lock so cheap can stay live")
})

test("mode vibeqmax → brain", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "mode", slot: "vibeqmax" })
  assert.equal(readSel().active_slot, "brain")
})

test("mode vibemax → medium", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "mode", slot: "vibemax" })
  assert.equal(readSel().active_slot, "medium")
})

test("mode invalid returns help", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "mode", slot: "garbage" })
  assert.ok(r.includes("Provide"), r.slice(0, 80))
})

test("mode without slot lists modes", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "mode" })
  assert.ok(r.includes("quality"), r.slice(0, 120))
})

test("enable toggles on", async () => {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: { brain: { oc: "x" }, medium: { oc: "x" }, cheap: { oc: "x" } },
    selection: { enabled: false },
  }))
  await (await getHooks()).tool.trinity.execute({ action: "enable" })
  assert.equal(readSel().enabled, true)
})

test("disable toggles off", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "disable" })
  assert.equal(readSel().enabled, false)
})

test("enforce on", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "enforce", slot: "on" })
  assert.equal(readSel().delegation_enforce, true)
})

test("enforce off returns response (mandatory)", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "enforce", slot: "off" })
  assert.ok(r.includes("mandatory") || r.includes("cannot") || r.includes("OFF"), "enforce off msg: " + r.slice(0,80))
})

test("flow on", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "flow", slot: "on" })
  assert.equal(readSel().flow_enabled, true)
})

test("flow off", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "flow", slot: "off" })
  assert.equal(readSel().flow_enabled, false)
})

test("flow enforce on", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "flow", slot: "enforce", level: "on" })
  assert.equal(readSel().flow_enforce, true)
})

test("tdd on", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "tdd", slot: "on" })
  assert.equal(readSel().tdd_enforce, true)
})

test("tdd off", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "tdd", slot: "off" })
  assert.equal(readSel().tdd_enforce, false)
})

test("tdd strict on", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "tdd", slot: "strict", level: "on" })
  assert.equal(readSel().tdd_strict, true)
})

test("tdd quality on", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "tdd", slot: "quality", level: "on" })
  assert.equal(readSel().tdd_quality, true)
})

test("lock on/off no crash", async () => {
  setTiers()
  const h = await getHooks()
  const r1 = await h.tool.trinity.execute({ action: "lock", slot: "on" })
  const r2 = await h.tool.trinity.execute({ action: "lock", slot: "off" })
  assert.ok(r1.length > 0 && r2.length > 0)
})

test("thinking full", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "thinking", slot: "full" })
  assert.ok(r.includes("full") || r.includes("thinking"), r.slice(0, 80))
})

test("thinking brief", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "thinking", slot: "brief" })
  assert.ok(r.includes("brief") || r.includes("thinking"), r.slice(0, 80))
})

test("blackbox status", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "blackbox", slot: "status" })
  assert.ok(typeof r === "string")
})

test("diagnose runs", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "diagnose" })
  assert.ok(r.includes("vibeOS") || r.includes("config"), r.slice(0, 80))
})

test("help lists commands", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "help" })
  assert.ok(r.includes("set") && r.includes("mode"), r.slice(0, 120))
})

test("rebuild survives", async () => {
  setTiers()
  try {
    const r = await (await getHooks()).tool.trinity.execute({ action: "rebuild" })
    assert.ok(typeof r === "string")
  } catch (e) {
    assert.ok(!!e.message)
  }
})

test("rebuild preserves manual trinity slots and only refreshes auto slots", async () => {
  setTiers("legacy-brain", "legacy-medium", "legacy-cheap")
  const tiersPath = join(sandbox, ".claude/model-tiers.json")
  const tiers = JSON.parse(readFileSync(tiersPath, "utf8"))
  tiers.trinity.medium.manual = true
  tiers.trinity.cheap.manual = true
  tiers.selection.selected_model = "deepseek/deepseek-v4-pro"
  tiers.selection.executed_model = "deepseek/deepseek-v4-pro"
  writeFileSync(tiersPath, JSON.stringify(tiers, null, 2) + "\n")

  const ocPath = join(sandbox, ".opencode/opencode.json")
  writeFileSync(ocPath, JSON.stringify({
    model: "deepseek/deepseek-v4-pro",
    provider: {
      deepseek: {
        models: {
          "deepseek-v4-pro": { name: "DeepSeek V4 Pro" },
          "deepseek-v4-flash": { name: "DeepSeek V4 Flash" },
          "deepseek-chat": { name: "DeepSeek Chat" },
        },
      },
    },
  }, null, 2))

  const result = await (await getHooks()).tool.trinity.execute({ action: "rebuild" })
  assert.ok(typeof result === "string" && result.length > 0, "rebuild should return a status string")

  const after = JSON.parse(readFileSync(tiersPath, "utf8"))
  assert.equal(after.trinity.medium.manual, true, "manual medium slot should survive rebuild")
  assert.equal(after.trinity.cheap.manual, true, "manual cheap slot should survive rebuild")
  assert.equal(after.trinity.medium.oc, "legacy-medium", "manual medium slot should not be replaced")
  assert.equal(after.trinity.cheap.oc, "legacy-cheap", "manual cheap slot should not be replaced")
  assert.ok(after.trinity.brain.oc, "brain slot should still be populated after rebuild")
  assert.equal(after.selection.selected_model, undefined, "shadow selected_model should not survive rebuild")
  assert.equal(after.selection.executed_model, undefined, "shadow executed_model should not survive rebuild")
})

// Live-reproduced on a real dev machine: applySlot() deliberately writes ONLY
// the unwatched model-tiers.json (rewriting opencode.json mid-turn aborts the
// active turn), with its own comment saying tier agents are meant to be
// "installed once at setup / vibe rebuild" -- but the rebuild handler never
// actually called installVibeTierAgents. opencode.json's vibe-cheap/medium/
// brain agent bindings could permanently drift from the real trinity slots,
// and cheapFirstDegraded/crossProvider stayed true forever because the fix
// this plugin itself tells users to run ("vibe rebuild") never closed the gap.
test("rebuild syncs opencode.json's tier-agent model bindings to the final trinity", async () => {
  setTiers("legacy-brain", "legacy-medium", "legacy-cheap")
  const ocPath = join(sandbox, ".opencode/opencode.json")
  writeFileSync(ocPath, JSON.stringify({
    model: "deepseek/deepseek-v4-pro",
    agent: {
      "vibe-cheap": { model: "some/stale-cheap-model" },
      "vibe-medium": { model: "some/stale-medium-model" },
      "vibe-brain": { model: "some/stale-brain-model" },
    },
    provider: {
      deepseek: {
        models: {
          "deepseek-v4-pro": { name: "DeepSeek V4 Pro" },
          "deepseek-v4-flash": { name: "DeepSeek V4 Flash" },
          "deepseek-chat": { name: "DeepSeek Chat" },
        },
      },
    },
  }, null, 2))

  await (await getHooks()).tool.trinity.execute({ action: "rebuild" })

  const tiersPath = join(sandbox, ".claude/model-tiers.json")
  const finalTrinity = JSON.parse(readFileSync(tiersPath, "utf8")).trinity
  const afterOc = JSON.parse(readFileSync(ocPath, "utf8"))
  assert.equal(afterOc.agent["vibe-cheap"].model, finalTrinity.cheap.oc, "vibe-cheap agent must match the final cheap trinity slot after rebuild")
  assert.equal(afterOc.agent["vibe-medium"].model, finalTrinity.medium.oc, "vibe-medium agent must match the final medium trinity slot after rebuild")
  assert.equal(afterOc.agent["vibe-brain"].model, finalTrinity.brain.oc, "vibe-brain agent must match the final brain trinity slot after rebuild")
})

// Live-reproduced on a real dev machine: a rebuild that ran while only a
// single-provider model pool was visible (buildDeterministicTrinity scopes
// candidates to one provider) collapsed brain/medium/cheap to the same
// model id. Because keepExistingTrinitySlot only checks "is this existing
// value non-empty and non-placeholder" -- not "is the existing trinity
// degenerate" -- every later rebuild kept re-preserving the collapsed
// single-model trinity forever, even once a richer multi-provider model
// pool became available. `vibe rebuild`, the exact fix this plugin tells
// users to run for the resulting cross-provider warning, could never
// self-heal.
test("rebuild self-heals a collapsed single-model trinity once multi-provider models are available", async () => {
  setTiers("opencode/big-pickle", "opencode/big-pickle", "opencode/big-pickle")
  const ocPath = join(sandbox, ".opencode/opencode.json")
  writeFileSync(ocPath, JSON.stringify({
    model: "opencode/big-pickle",
    provider: {
      opencode: { models: { "big-pickle": { name: "Big Pickle" } } },
      deepseek: { models: { "deepseek-v4-flash": { name: "DeepSeek V4 Flash" } } },
      "opencode-go": { models: { "mimo-v2.5": { name: "Mimo v2.5" } } },
    },
  }, null, 2))

  await (await getHooks()).tool.trinity.execute({ action: "rebuild" })

  const tiersPath = join(sandbox, ".claude/model-tiers.json")
  const finalTrinity = JSON.parse(readFileSync(tiersPath, "utf8")).trinity
  const ids = [finalTrinity.brain.oc, finalTrinity.medium.oc, finalTrinity.cheap.oc]
  assert.notEqual(ids[0], ids[1], "brain and medium must not collapse to the same model when other providers are available")
  assert.notEqual(ids[1], ids[2], "medium and cheap must not collapse to the same model when other providers are available")
})

test("guard creates project docs on first run", async () => {
  const projectDir = join(sandbox, "guard-project")
  mkdirSync(projectDir, { recursive: true })
  const hooks = await getHooks(projectDir)
  const r = await hooks.tool.trinity.execute({ action: "guard" }, { directory: projectDir })
  assert.ok(r.includes("Created") || r.includes("already exist"), r.slice(0, 120))
  assert.ok(existsSync(join(projectDir, "AGENTS.md")), "guard should create AGENTS.md")
  assert.ok(existsSync(join(projectDir, "README.md")), "guard should create README.md")
})

test("todo, todo-done, and todo-sync cover the native todo bridge", async () => {
  setTiers()
  const hooks = await getHooks()
  // loadTodos() is scoped by the module-level currentProjectFingerprint, which
  // persists across tests in this file (state.js is a shared singleton across
  // getHooks()'s cache-busted index.js reloads -- only index.js is re-imported
  // fresh, not state.js). Clear it explicitly so this test's fixture (written
  // without a projectFingerprint, predating project-scoped todos) is visible
  // regardless of what an earlier test in this file left behind.
  const state = await import("../src/lib/state.js")
  state.setCurrentProjectFingerprint("")
  const todosPath = join(sandbox, ".claude/todos.json")
  writeFileSync(todosPath, JSON.stringify([
    {
      id: "todo-1",
      content: "Fix report context mismatch",
      status: "pending",
      filePath: "src/lib/reporting.ts",
      priority: "high",
      source: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ], null, 2))

  const list = await hooks.tool.trinity.execute({ action: "todo" })
  assert.ok(list.includes("Fix report context mismatch"), list.slice(0, 120))

  const done = await hooks.tool.trinity.execute({ action: "todo-done", slot: "todo-1" })
  assert.ok(done.includes("marked done"), done.slice(0, 120))

  const saved = JSON.parse(readFileSync(todosPath, "utf8"))
  assert.equal(saved[0].status, "done", "todo-done should persist completed status")

  const flowQueuePath = join(sandbox, ".claude/.flow-todo-queue.jsonl")
  writeFileSync(flowQueuePath, JSON.stringify({
    at: new Date().toISOString(),
    filePath: "src/lib/hooks/tool-execute.ts",
    todos: [{ type: "FIXME", text: "cover cascade command bridge" }],
  }) + "\n")

  const synced = await hooks.tool.trinity.execute({ action: "todo-sync" })
  assert.ok(synced.includes("Synced"), synced.slice(0, 120))

  const syncedTodos = JSON.parse(readFileSync(todosPath, "utf8"))
  assert.ok(
    syncedTodos.some((t) => t.content.includes("cover cascade command bridge") && t.source === "flow"),
    "todo-sync should bridge flow TODOs into the native todo list",
  )
})

test("api-token and api-bootstrap-token persist and invalidate local auth state", async () => {
  setTiers()
  const prevChannel = process.env.VIBEOS_BUILD_CHANNEL
  process.env.VIBEOS_BUILD_CHANNEL = "beta"
  const hooks = await getHooks()

  const token = "vos_" + "a".repeat(64)
  const setResult = await hooks.tool.trinity.execute({ action: "api-token", token })
  assert.ok(setResult.includes("updated"), setResult.slice(0, 120))

  const envProd = readFileSync(join(sandbox, ".claude/.env.production"), "utf8")
  assert.ok(envProd.includes("VIBEOS_API_TOKEN="), "api-token should persist to .env.production")

  const invalidateResult = await hooks.tool.trinity.execute({ action: "api-token", token: "invalidate" })
  assert.ok(invalidateResult.includes("invalidated"), invalidateResult.slice(0, 120))
  const envProdAfter = readFileSync(join(sandbox, ".claude/.env.production"), "utf8")
  assert.ok(!envProdAfter.includes("VIBEOS_API_TOKEN="), "invalidate should remove token from .env.production")

  const bootstrap = "vos_" + "b".repeat(64)
  const bootstrapResult = await hooks.tool.trinity.execute({ action: "api-bootstrap-token", token: bootstrap })
  assert.ok(bootstrapResult.includes("bootstrap token"), bootstrapResult.slice(0, 120))
  assert.ok(existsSync(join(sandbox, ".claude/.env.alpha")), "bootstrap token should persist to .env.alpha")

  if (prevChannel === undefined) delete process.env.VIBEOS_BUILD_CHANNEL
  else process.env.VIBEOS_BUILD_CHANNEL = prevChannel
})
