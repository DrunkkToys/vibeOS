// SPDX-License-Identifier: MIT
import test, { after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-ultrax-hold-"))
mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
const prevVibeHome = process.env.VIBEOS_HOME
const prevHome = process.env.HOME
process.env.VIBEOS_HOME = join(sandbox, ".claude")
process.env.HOME = sandbox
writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({ model: "opencode/cheap-free" }))

after(() => {
  process.env.VIBEOS_HOME = prevVibeHome
  process.env.HOME = prevHome
  rmSync(sandbox, { recursive: true, force: true })
})

writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
  selection: { enabled: true, active_slot: "cheap", optimization_mode: "vibeultrax", active_pipeline: ["cheap", "medium", "brain"] },
  trinity: { cheap: { oc: "opencode/cheap-free" }, medium: { oc: "opencode/medium-free" }, brain: { oc: "opencode/brain-free" } },
}))

const readSlot = () => JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf-8")).selection.active_slot

const CV = { optimization_mode: "vibeultrax", tier_bias: "cheap", pipeline_root: ["cheap", "medium", "brain"], resolved_tier: "medium" }

test("a vibeultrax escalation holds on the next step of the same turn instead of falling back to cheap", async () => {
  const mod = await import("../src/lib/hooks/chat-transform.js?hold=" + Date.now())
  mod.syncControlSettings(CV, { authoritative: true })
  assert.equal(readSlot(), "medium")
  mod.syncControlSettings(CV, { authoritative: true })
  assert.equal(readSlot(), "medium")
  mod.syncControlSettings(CV, { authoritative: true })
  assert.equal(readSlot(), "medium")
})

test("a coding regime alone does not move the vibeultrax primary off cheap", async () => {
  writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
    selection: { enabled: true, active_slot: "cheap", optimization_mode: "vibeultrax", active_pipeline: ["cheap", "medium", "brain"] },
    trinity: { cheap: { oc: "opencode/cheap-free" }, medium: { oc: "opencode/medium-free" }, brain: { oc: "opencode/brain-free" } },
  }))
  const mod = await import("../src/lib/hooks/chat-transform.js?regime=" + Date.now())
  mod.syncControlSettings({ ...CV, resolved_tier: "cheap", regime_tier: "brain" }, { authoritative: true })
  assert.equal(readSlot(), "cheap")
})
