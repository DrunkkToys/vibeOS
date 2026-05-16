// Simulation test: clean first installation → auto-create model-tiers.json
// Mirrors what happens when theSaver is installed fresh on opencode desktop.
//
// Run: node --test tests/test_first_install_autoconfig.mjs

import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"

let sandbox

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "first-install-test-"))
  mkdirSync(join(sandbox, ".claude", "scratch"), { recursive: true })
  mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
  process.env.HOME = sandbox
})

after(() => rmSync(sandbox, { recursive: true, force: true }))

async function loadPlugin() {
  return await import("../src/index.js?t=" + Date.now())
}

// ──────────────────────────────────────────────────────────────────────

test("first install: auto-creates model-tiers.json from opencode desktop provider models", async () => {
  // Step 1: Simulate opencode desktop with 3 models in the dropdown
  const opencodeConfigPath = join(sandbox, ".config", "opencode", "opencode.json")
  writeFileSync(opencodeConfigPath, JSON.stringify({
    provider: {
      deepseek: {
        key: "sk-fake-test-key",
        models: {
          "deepseek-v4-pro":    { name: "DeepSeek V4 Pro" },
          "deepseek-v4-flash":  { name: "DeepSeek V4 Flash" },
          "deepseek-chat":      { name: "DeepSeek Chat" }
        }
      }
    }
  }, null, 2))

  // Step 2: Simulate project opencode.json pointing to brain model
  const projectDir = join(sandbox, "my-test-project")
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, "opencode.json"), JSON.stringify({
    model: "deepseek/deepseek-v4-pro"
  }, null, 2))

  // Step 3: Ensure model-tiers.json does NOT exist (clean first install)
  const tiersFile = join(sandbox, ".claude", "model-tiers.json")
  assert.ok(!existsSync(tiersFile), "model-tiers.json must NOT exist before test")

  // Step 4: Load plugin — triggers auto-config
  const { DelegationEnforcer } = await loadPlugin()
  const hooks = await DelegationEnforcer({ client: {}, directory: projectDir })

  // Step 5: Verify model-tiers.json was AUTO-CREATED
  await new Promise(r => setTimeout(r, 200)) // brief settle for sync writes
  assert.ok(existsSync(tiersFile), "model-tiers.json SHOULD be auto-created")

  const tiers = JSON.parse(readFileSync(tiersFile, "utf-8"))
  console.log("  Auto-created model-tiers.json:", JSON.stringify(tiers, null, 2))

  // Step 6: Verify contents match opencode dropdown models
  assert.ok(tiers.trinity, "trinity key must exist")
  assert.ok(tiers.selection, "selection key must exist")
  assert.equal(tiers.selection.active_slot, "brain", "active slot defaults to brain")
  assert.equal(tiers.selection.enabled, true, "enabled defaults to true")

  // Brain = the highest-tier detected model (v4-pro)
  assert.ok(tiers.trinity.brain, "brain slot must be populated")
  assert.ok(tiers.trinity.brain.oc, "brain oc must be set")
  assert.ok(!tiers.trinity.brain.oc.includes("placeholder"), "brain must NOT be a placeholder")
  console.log("  brain slot:", tiers.trinity.brain.oc)

  // Medium = mid-tier or fallback
  assert.ok(tiers.trinity.medium, "medium slot must be populated")
  assert.ok(tiers.trinity.medium.oc, "medium oc must be set")
  console.log("  medium slot:", tiers.trinity.medium.oc)

  // Cheap = cheapest detected model
  assert.ok(tiers.trinity.cheap, "cheap slot must be populated")
  assert.ok(tiers.trinity.cheap.oc, "cheap oc must be set")
  console.log("  cheap slot:", tiers.trinity.cheap.oc)

  // Step 7: Verify shell.env reports the correct tier
  const envOut = { env: {} }
  await hooks["shell.env"]({}, envOut)
  assert.equal(envOut.env.OPENCODE_MODEL_TIER, "high", "brain model must be high tier")
  assert.equal(envOut.env.OPENCODE_MODEL, "deepseek/deepseek-v4-pro", "model must match project config")
})

test("first install: falls back to deriving from current model when no provider models found", async () => {
  // Fresh sandbox
  const sb = mkdtempSync(join(tmpdir(), "first-install-fallback-"))
  mkdirSync(join(sb, ".claude", "scratch"), { recursive: true })
  mkdirSync(join(sb, ".config", "opencode"), { recursive: true })
  const prevHome = process.env.HOME
  process.env.HOME = sb

  try {
    // OpenCode config exists but has NO provider models
    writeFileSync(join(sb, ".config", "opencode", "opencode.json"), JSON.stringify({
      provider: {}
    }, null, 2))

    // Project config with a model
    const projectDir = join(sb, "fallback-project")
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, "opencode.json"), JSON.stringify({
      model: "openrouter/anthropic/claude-sonnet-4-6"
    }, null, 2))

    const tiersFile = join(sb, ".claude", "model-tiers.json")
    assert.ok(!existsSync(tiersFile), "model-tiers.json must NOT exist before test")

    const { DelegationEnforcer } = await loadPlugin()
    await DelegationEnforcer({ client: {}, directory: projectDir })

    await new Promise(r => setTimeout(r, 200))
    assert.ok(existsSync(tiersFile), "model-tiers.json SHOULD still be auto-created via fallback")

    const tiers = JSON.parse(readFileSync(tiersFile, "utf-8"))
    console.log("  Fallback auto-created:", JSON.stringify(tiers, null, 2))

    assert.ok(tiers.trinity.brain.oc.includes("claude-sonnet"), "brain should use current model")
    assert.ok(tiers.trinity.cheap.oc, "cheap must be populated")
    assert.ok(tiers.trinity.medium.oc, "medium must be populated")
  } finally {
    process.env.HOME = prevHome
    rmSync(sb, { recursive: true, force: true })
  }
})

test("first install: does NOT overwrite existing model-tiers.json with real models", async () => {
  const sb = mkdtempSync(join(tmpdir(), "first-install-keep"))
  mkdirSync(join(sb, ".claude", "scratch"), { recursive: true })
  mkdirSync(join(sb, ".config", "opencode"), { recursive: true })
  const prevHome = process.env.HOME
  process.env.HOME = sb

  try {
    // Pre-create model-tiers.json with real (non-placeholder) models
    const tiersFile = join(sb, ".claude", "model-tiers.json")
    const existing = {
      trinity: {
        brain:  { oc: "anthropic/claude-opus-4-7", cc: "opus" },
        medium: { oc: "anthropic/claude-sonnet-4-6", cc: "sonnet" },
        cheap:  { oc: "anthropic/claude-haiku-4-5", cc: "haiku" }
      },
      selection: { enabled: true, active_slot: "brain" }
    }
    writeFileSync(tiersFile, JSON.stringify(existing, null, 2))

    // OpenCode config with different models
    writeFileSync(join(sb, ".config", "opencode", "opencode.json"), JSON.stringify({
      provider: {
        deepseek: {
          key: "sk-fake",
          models: { "deepseek-v4-pro": {}, "deepseek-chat": {} }
        }
      }
    }, null, 2))

    const projectDir = join(sb, "existing-project")
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, "opencode.json"), JSON.stringify({
      model: "anthropic/claude-opus-4-7"
    }, null, 2))

    const { DelegationEnforcer } = await loadPlugin()
    await DelegationEnforcer({ client: {}, directory: projectDir })

    await new Promise(r => setTimeout(r, 200))
    const tiers = JSON.parse(readFileSync(tiersFile, "utf-8"))

    // Must NOT be overwritten — keep existing models
    assert.equal(tiers.trinity.brain.oc, "anthropic/claude-opus-4-7", "brain must be preserved")
    assert.equal(tiers.trinity.medium.oc, "anthropic/claude-sonnet-4-6", "medium must be preserved")
    assert.equal(tiers.trinity.cheap.oc, "anthropic/claude-haiku-4-5", "cheap must be preserved")
    console.log("  Preserved existing model-tiers.json unchanged")
  } finally {
    process.env.HOME = prevHome
    rmSync(sb, { recursive: true, force: true })
  }
})
