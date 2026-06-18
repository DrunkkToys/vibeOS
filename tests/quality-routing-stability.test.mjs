// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function makeSandbox() {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-quality-routing-"))
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  process.env.VIBEOS_OPENCODE_HOME = join(sandbox, ".config", "opencode")

  mkdirSync(join(sandbox, ".claude"), { recursive: true })
  mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
  mkdirSync(join(sandbox, ".claude", "scratch"), { recursive: true })

  writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({
    model: "deepseek/deepseek-v4-flash",
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

  writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: "brain",
      optimization_mode: "quality",
      delegation_enforce: true,
      flow_enabled: true,
      flow_enforce: true,
      tdd_enforce: true,
      tdd_strict: true,
      tdd_quality: true,
      thinking_level: "full",
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "deepseek/deepseek-v4-pro", manual: true },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "deepseek/deepseek-v4-flash", manual: true },
      cheap: { oc: "deepseek/deepseek-chat", cc: "deepseek/deepseek-chat", manual: true },
    },
  }, null, 2))

  writeFileSync(join(sandbox, ".claude", "blackbox-state.json"), JSON.stringify({
    enabled: true,
    sessions: {},
  }, null, 2))

  return sandbox
}

test("quality-routing: bootstrap preserves quality-capable live selection", async () => {
  const sandbox = makeSandbox()
  const turn = await import("../src/lib/turn-classify.js?quality-routing=" + Date.now())

  const result = turn.bootstrapOptimizationSession()
  const loaded = turn.loadOptimizationMode()
  const state = JSON.parse(readFileSync(join(sandbox, ".claude", "blackbox-state.json"), "utf-8"))
  const sid = Object.keys(state.sessions || {})[0]
  const session = sid ? state.sessions[sid] : null

  assert.equal(result.mode, "quality")
  assert.equal(result.slot, "brain")
  assert.equal(loaded, "quality")
  assert.equal(session?.optimization_mode, "quality")
  assert.equal(session?.active_slot, "brain")
})
