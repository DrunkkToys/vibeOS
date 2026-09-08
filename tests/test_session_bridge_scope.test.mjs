// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// syncControlSettings referenced `userText`, which has no binding in its scope.
// The file carries // @ts-nocheck and eslint has no no-undef rule, so tsc and
// lint both passed on an undefined identifier. It threw a ReferenceError on
// every turn the control vector moved the slot -- exactly the turns a bridge
// exists to record -- and the catch turned it into a log line the console guard
// then swallowed. A 5-turn benchmark hit it 40 times in silence.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function withSandbox() {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-bridge-scope-"))
  const old = { HOME: process.env.HOME, VIBEOS_HOME: process.env.VIBEOS_HOME }
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  mkdirSync(process.env.VIBEOS_HOME, { recursive: true })
  mkdirSync(join(sandbox, ".opencode"), { recursive: true })
  writeFileSync(join(sandbox, ".opencode", "opencode.json"), JSON.stringify({ plugin: ["vibeOS"] }, null, 2))
  writeFileSync(join(process.env.VIBEOS_HOME, "model-tiers.json"), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: "cheap",
      slot_locked: false,
      optimization_mode: "vibeultrax",
      active_pipeline: ["cheap", "medium", "brain"],
    },
    trinity: {
      cheap: { oc: "opencode/big-pickle" },
      medium: { oc: "opencode-go/mimo-v2.5" },
      brain: { oc: "deepseek/deepseek-v4-flash" },
    },
  }, null, 2))
  return {
    sandbox,
    cleanup() {
      if (old.HOME === undefined) delete process.env.HOME; else process.env.HOME = old.HOME
      if (old.VIBEOS_HOME === undefined) delete process.env.VIBEOS_HOME; else process.env.VIBEOS_HOME = old.VIBEOS_HOME
      rmSync(sandbox, { recursive: true, force: true })
    },
  }
}

const movesSlot = {
  optimization_mode: "vibeultrax",
  tier_bias: "cheap",
  selected_slot: "brain",
  selected_model: "deepseek/deepseek-v4-flash",
  route_path: ["cheap", "medium", "brain"],
  cascade_root: ["cheap", "medium", "brain"],
}

test("a slot-moving turn records a session bridge instead of throwing", async () => {
  const ctx = withSandbox()
  try {
    const mod = await import("../src/lib/hooks/chat-transform.js?bridge-scope=" + Date.now())
    mod.syncControlSettings(movesSlot, { authoritative: true, directory: ctx.sandbox })

    const bridges = join(process.env.VIBEOS_HOME, ".session-bridges.jsonl")
    assert.ok(existsSync(bridges), "the slot moved, so a bridge row must exist")
    const rows = readFileSync(bridges, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    assert.ok(rows.length >= 1, "at least one bridge row")
    assert.equal(rows[rows.length - 1].to_tier || rows[rows.length - 1].toTier, "brain")
  } finally {
    ctx.cleanup()
  }
})

test("recording the bridge reports no error", async () => {
  const ctx = withSandbox()
  // Patch AFTER import: flow-enforcer installs its console.error guard at import
  // time, and a spy installed first would sit underneath it and never be called.
  const mod = await import("../src/lib/hooks/chat-transform.js?bridge-err=" + Date.now())
  const original = console.error
  const seen = []
  console.error = (...args) => { seen.push(args.map(String).join(" ")) }
  try {
    mod.syncControlSettings(movesSlot, { authoritative: true, directory: ctx.sandbox })
  } finally {
    console.error = original
    ctx.cleanup()
  }
  const bridgeErrors = seen.filter((line) => line.includes("failed to record session bridge"))
  assert.deepEqual(bridgeErrors, [], "the bridge must not fail")
  assert.deepEqual(
    seen.filter((line) => /is not defined/.test(line)),
    [],
    "no unbound identifier may reach this path",
  )
})
