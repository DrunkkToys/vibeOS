// SPDX-License-Identifier: MIT
// Contract tests: installVibeTierAgentsInConfig produces correct agent structure.

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const TRINITY = {
  cheap: { oc: "opencode/big-pickle" },
  medium: { oc: "opencode-go/deepseek-v4-flash" },
  brain: { oc: "opencode-go/mimo-v2.5" },
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "runtime-config-test-"))
  const oldVibe = process.env.VIBEOS_HOME
  process.env.VIBEOS_HOME = join(dir, "vibeos")
  mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
  writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
    trinity: TRINITY,
    selection: { active_slot: "cheap", optimization_mode: "vibeultrax" },
  }))
  return {
    dir,
    cleanup() { rmSync(dir, { recursive: true, force: true }); process.env.VIBEOS_HOME = oldVibe },
  }
}

test("installVibeTierAgentsInConfig: returns false for null/array", async () => {
  const { installVibeTierAgentsInConfig } = await import("../src/lib/runtime-config.js")
  assert.equal(installVibeTierAgentsInConfig(null, TRINITY), false)
  assert.equal(installVibeTierAgentsInConfig([], TRINITY), false)
  assert.equal(installVibeTierAgentsInConfig(undefined, TRINITY), false)
})

test("installVibeTierAgentsInConfig: creates vibe primary + 3 subagents on empty config", async () => {
  const { installVibeTierAgentsInConfig } = await import("../src/lib/runtime-config.js")
  const cfg = {}
  const changed = installVibeTierAgentsInConfig(cfg, TRINITY)
  assert.equal(changed, true, "should report changed")
  assert.equal(cfg.default_agent, "vibe", "default_agent must be vibe")
  const agents = cfg.agent
  assert.ok(agents, "agent field must exist")
  // Primary agent
  const primary = agents["vibe"]
  assert.ok(primary, "vibe primary agent must exist")
  assert.equal(primary.mode, "primary", "primary agent mode must be primary")
  assert.equal(primary.model, undefined, "primary agent must NOT have a model")
  assert.equal(primary.description, "VibeUltraX primary agent")
  // Tier agents
  for (const [slot, model] of [["cheap", "opencode/big-pickle"], ["medium", "opencode-go/deepseek-v4-flash"], ["brain", "opencode-go/mimo-v2.5"]]) {
    const name = `vibe-${slot}`
    const agent = agents[name]
    assert.ok(agent, `${name} must exist`)
    assert.equal(agent.mode, "subagent", `${name} mode must be subagent`)
    assert.equal(agent.model, model, `${name} model must match trinity config`)
    assert.ok(agent.description.startsWith(`VibeUltraX ${slot}`), `${name} description must mention slot`)
  }
})

test("installVibeTierAgentsInConfig: preserves native build default_agent", async () => {
  const { installVibeTierAgentsInConfig } = await import("../src/lib/runtime-config.js")
  const cfg = { default_agent: "build" }
  const changed = installVibeTierAgentsInConfig(cfg, TRINITY)
  assert.equal(changed, true, "should install missing vibe agents")
  assert.equal(cfg.default_agent, "build", "native OpenCode build selector must be preserved")
  assert.ok(cfg.agent.vibe, "vibe primary agent must still be installed")
})

test("installVibeTierAgentsInConfig: preserves native plan default_agent", async () => {
  const { installVibeTierAgentsInConfig } = await import("../src/lib/runtime-config.js")
  const cfg = { default_agent: "plan" }
  const changed = installVibeTierAgentsInConfig(cfg, TRINITY)
  assert.equal(changed, true, "should install missing vibe agents")
  assert.equal(cfg.default_agent, "plan", "native OpenCode plan selector must be preserved")
  assert.ok(cfg.agent.vibe, "vibe primary agent must still be installed")
})

test("installVibeTierAgentsInConfig: idempotent output — already-correct config stays same", async () => {
  const { installVibeTierAgentsInConfig } = await import("../src/lib/runtime-config.js")
  const input = { default_agent: "vibe", agent: { vibe: { description: "VibeUltraX primary agent", mode: "primary" }, "vibe-cheap": { description: "VibeUltraX cheap tier subagent", mode: "subagent", model: "opencode/big-pickle" }, "vibe-medium": { description: "VibeUltraX medium tier subagent", mode: "subagent", model: "opencode-go/deepseek-v4-flash" }, "vibe-brain": { description: "VibeUltraX brain tier subagent", mode: "subagent", model: "opencode-go/mimo-v2.5" } } }
  const cfg = JSON.parse(JSON.stringify(input))
  installVibeTierAgentsInConfig(cfg, TRINITY)
  assert.equal(cfg.default_agent, "vibe")
  assert.equal(cfg.agent["vibe"].mode, "primary")
  assert.equal(cfg.agent["vibe-cheap"].mode, "subagent")
  assert.equal(cfg.agent["vibe-cheap"].model, "opencode/big-pickle")
})

test("installVibeTierAgentsInConfig: fixes agents with mode: primary instead of subagent", async () => {
  const { installVibeTierAgentsInConfig } = await import("../src/lib/runtime-config.js")
  const cfg = {
    default_agent: "vibe-cheap",
    agent: {
      "vibe-cheap": { model: "opencode/big-pickle", mode: "primary" },
      "vibe-medium": { model: "opencode-go/deepseek-v4-flash", mode: "primary" },
      "vibe-brain": { model: "opencode-go/mimo-v2.5", mode: "primary" },
    },
  }
  const changed = installVibeTierAgentsInConfig(cfg, TRINITY)
  assert.equal(changed, true, "broken config must report changed")
  assert.equal(cfg.default_agent, "vibe", "default_agent must be fixed to vibe")
  assert.ok(cfg.agent["vibe"], "vibe primary agent must be created")
  assert.equal(cfg.agent["vibe"].mode, "primary", "vibe agent must be primary")
  assert.equal(cfg.agent["vibe"].model, undefined, "vibe agent must NOT have model")
  for (const slot of ["cheap", "medium", "brain"]) {
    const name = `vibe-${slot}`
    assert.equal(cfg.agent[name].mode, "subagent", `${name} mode must be fixed to subagent`)
  }
})

test("installVibeTierAgentsInConfig: fixes stale default_agent", async () => {
  const { installVibeTierAgentsInConfig } = await import("../src/lib/runtime-config.js")
  const cfg = { default_agent: "claude" }
  const changed = installVibeTierAgentsInConfig(cfg, TRINITY)
  assert.equal(changed, true, "stale default_agent must be fixed")
  assert.equal(cfg.default_agent, "vibe")
})

test("installVibeTierAgentsInConfig: preserves existing agent permissions", async () => {
  const { installVibeTierAgentsInConfig } = await import("../src/lib/runtime-config.js")
  const cfg = { agent: { "vibe-cheap": { permission: { custom_tool: "allow" } } } }
  installVibeTierAgentsInConfig(cfg, TRINITY)
  const agent = cfg.agent["vibe-cheap"]
  assert.ok(agent.permission.read, "should have default read permission")
  assert.equal(agent.permission.custom_tool, "allow", "should preserve existing custom permission")
})

test("buildVibePrimaryAgent: never has model key", async () => {
  const { buildVibePrimaryAgent } = await import("../src/lib/runtime-config.js")
  const withModel = buildVibePrimaryAgent({ model: "deepseek/deepseek-v4-flash" })
  assert.equal(withModel.model, undefined, "model must be stripped even when passed in existing")
  const without = buildVibePrimaryAgent({})
  assert.equal(without.model, undefined, "model must be absent")
})

test("buildVibeTierAgent: always has subagent mode and model", async () => {
  const { buildVibeTierAgent } = await import("../src/lib/runtime-config.js")
  const agent = buildVibeTierAgent("cheap", "opencode/big-pickle")
  assert.equal(agent.mode, "subagent")
  assert.equal(agent.model, "opencode/big-pickle")
  assert.equal(agent.description, "VibeUltraX cheap tier subagent")
})

test("tierAgentForSlot: maps correctly", async () => {
  const { tierAgentForSlot } = await import("../src/lib/runtime-config.js")
  assert.equal(tierAgentForSlot("cheap"), "vibe-cheap")
  assert.equal(tierAgentForSlot("medium"), "vibe-medium")
  assert.equal(tierAgentForSlot("brain"), "vibe-brain")
  assert.equal(tierAgentForSlot(null), null)
  assert.equal(tierAgentForSlot("invalid"), null)
})

test("runtimeTierCoherence: detects coherent config", async () => {
  const s = sandbox()
  try {
    const cfgPath = join(s.dir, "opencode.json")
    const cfg = {
      default_agent: "vibe",
      agent: {
        vibe: { mode: "primary" },
        "vibe-cheap": { mode: "subagent", model: "opencode/big-pickle", description: "VibeUltraX cheap tier subagent" },
        "vibe-medium": { mode: "subagent", model: "opencode-go/deepseek-v4-flash", description: "VibeUltraX medium tier subagent" },
        "vibe-brain": { mode: "subagent", model: "opencode-go/mimo-v2.5", description: "VibeUltraX brain tier subagent" },
      },
    }
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
    const { runtimeTierCoherence } = await import("../src/lib/runtime-config.js")
    const result = runtimeTierCoherence(s.dir, "cheap", "opencode/big-pickle", "opencode/big-pickle")
    assert.equal(result.coherent, true, "coherent config must report coherent: true")
    assert.equal(result.agent, "vibe")
    assert.equal(result.expectedAgent, "build|plan|vibe")
    assert.equal(result.degraded, false, "coherent config must not be degraded")
  } finally { s.cleanup() }
})

test("runtimeTierCoherence: detects degraded (missing agents)", async () => {
  const s = sandbox()
  try {
    const { runtimeTierCoherence } = await import("../src/lib/runtime-config.js")
    const result = runtimeTierCoherence(s.dir, "cheap", "", "opencode/big-pickle")
    assert.equal(result.coherent, false, "degraded config must NOT be coherent")
  } finally { s.cleanup() }
})

test("resolveOpenCodeHomes: returns .opencode and .config/opencode when HOME set", async () => {
  const cb = `?t=${Date.now()}`
  const { resolveOpenCodeHomes } = await import(`../src/lib/runtime-paths.js${cb}`)
  const oldHome = process.env.HOME
  const oldXdg = process.env.XDG_CONFIG_HOME
  process.env.HOME = "/tmp/test-home"
  delete process.env.XDG_CONFIG_HOME
  try {
    const homes = resolveOpenCodeHomes()
    if (homes.length < 2) {
      console.log("DEBUG homes:", homes)
      console.log("DEBUG HOME:", process.env.HOME)
      console.log("DEBUG XDG:", process.env.XDG_CONFIG_HOME)
    }
    assert.ok(homes.length >= 2, `should return at least 2 homes, got ${homes.length}: ${JSON.stringify(homes)}`)
    assert.ok(homes.some(h => h.endsWith(".opencode")), `should include .opencode`)
    assert.ok(homes.some(h => h.endsWith("opencode") && !h.endsWith(".opencode")), `should include config/opencode`)
  } finally {
    process.env.HOME = oldHome
    if (oldXdg) process.env.XDG_CONFIG_HOME = oldXdg
    else delete process.env.XDG_CONFIG_HOME
  }
})

test("resolveOpenCodeHomes: respects VIBEOS_OPENCODE_HOME override", async () => {
  const { resolveOpenCodeHomes } = await import("../src/lib/runtime-paths.js")
  const oldOverride = process.env.VIBEOS_OPENCODE_HOME
  process.env.VIBEOS_OPENCODE_HOME = "/custom/home"
  try {
    const homes = resolveOpenCodeHomes()
    assert.equal(homes.length, 1)
    assert.equal(homes[0], "/custom/home")
  } finally {
    if (oldOverride !== undefined) process.env.VIBEOS_OPENCODE_HOME = oldOverride
    else delete process.env.VIBEOS_OPENCODE_HOME
  }
})
