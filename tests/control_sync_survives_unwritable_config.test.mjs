// SPDX-License-Identifier: MIT
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-syncguard-"))
const prevHome = process.env.HOME
const prevVibeHome = process.env.VIBEOS_HOME

process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".vibeos")
mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
  selection: {
    enabled: true,
    active_slot: "cheap",
    entry_slot: "cheap",
    worker_slot: "cheap",
    optimization_mode: "vibeultrax",
    active_pipeline: ["cheap", "medium", "brain"],
    axis_overrides: { tier: "brain" },
  },
  trinity: {
    brain: { oc: "prov/brain-model" },
    medium: { oc: "prov/medium-model" },
    cheap: { oc: "prov/cheap-model" },
  },
}))

const runtimeConfig = await import("../src/lib/runtime-config.js")
const chatTransform = await import("../src/lib/hooks/chat-transform.js")

test("filesystem root is never treated as a project config location", () => {
  // The desktop app's server process runs with cwd "/", so the per-turn project
  // directory fell back to "/" and every config write targeted "/opencode.json"
  // -> EROFS on macOS.
  const paths = runtimeConfig.collectOpenCodeConfigPaths("/", { includeGlobalHomes: false })
  assert.deepEqual(paths, [], JSON.stringify(paths))
})

test("an unwritable config path cannot abort the caller", () => {
  assert.doesNotThrow(() => {
    runtimeConfig.installVibeTierAgents("/", { cheap: { oc: "a/b" }, medium: { oc: "a/c" }, brain: { oc: "a/d" } }, null, { includeGlobalHomes: false })
  })
})

test("control sync still applies routing when the tier-agent install fails", () => {
  // Regression: installVibeTierAgents threw EROFS inside syncControlSettings, the
  // catch returned the previous state, and the backend's tier decision was
  // silently discarded on EVERY live turn.
  const result = chatTransform.syncControlSettings({
    optimization_mode: "vibeultrax",
    selected_slot: "medium",
    tier_bias: "cheap",
  }, { persistOptimizationMode: true, authoritative: true, directory: "/" })
  assert.ok(result, "syncControlSettings returned nothing")
  const tiers = JSON.parse(readFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), "utf8"))
  assert.equal(tiers.selection.entry_slot, "brain", JSON.stringify(tiers.selection))
  assert.equal(tiers.selection.worker_slot, "brain", JSON.stringify(tiers.selection))
})

test("cleanup", async () => {
  try {
    const stateModule = await import("../src/lib/state.js")
    stateModule._flushLedgerBuffer()
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevVibeHome === undefined) delete process.env.VIBEOS_HOME
    else process.env.VIBEOS_HOME = prevVibeHome
  } finally {
    if (existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
  }
})
