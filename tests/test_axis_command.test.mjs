// SPDX-License-Identifier: MIT
// Phase 5: vibe axis command contract tests
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = new URL("..", import.meta.url).pathname
const prevVibeHome = process.env.VIBEOS_HOME
let sandbox = null

function ensureSandbox() {
  if (!sandbox) {
    sandbox = mkdtempSync(join(tmpdir(), "vibeos-axis-test-"))
    mkdirSync(join(sandbox, ".claude"), { recursive: true })
    process.env.VIBEOS_HOME = join(sandbox, ".claude")
  }
}

function writeTiers(sel = {}) {
  ensureSandbox()
  const path = join(sandbox, ".claude", "model-tiers.json")
  writeFileSync(path, JSON.stringify({
    trinity: { brain: { oc: "brain-m" }, medium: { oc: "medium-m" }, cheap: { oc: "cheap-m" } },
    selection: { enabled: true, active_slot: "brain", axis_overrides: {}, ...sel },
  }))
}

function readSel() {
  const path = join(sandbox, ".claude", "model-tiers.json")
  return JSON.parse(readFileSync(path, "utf8")).selection
}

test("axis: loadAxisOverrides returns empty object with no overrides", async () => {
  ensureSandbox()
  writeTiers()
  const { loadAxisOverrides } = await import(join(root, "src/lib/selection-manager.js?ax1=" + Date.now()))
  const overrides = loadAxisOverrides()
  assert.deepEqual(overrides, {})
})

test("axis: writeAxisOverride persists to model-tiers.json", async () => {
  ensureSandbox()
  writeTiers()
  const { writeAxisOverride, loadAxisOverrides } = await import(join(root, "src/lib/selection-manager.js?ax2=" + Date.now()))
  const ok = writeAxisOverride("thinking", "full")
  assert.ok(ok, "writeAxisOverride should return true")
  const overrides = loadAxisOverrides()
  assert.equal(overrides.thinking, "full")
})

test("axis: clearAxisOverrides removes all overrides", async () => {
  ensureSandbox()
  writeTiers({ axis_overrides: { thinking: "full", enforcement: "strict" } })
  const { clearAxisOverrides, loadAxisOverrides } = await import(join(root, "src/lib/selection-manager.js?ax3=" + Date.now()))
  const ok = clearAxisOverrides()
  assert.ok(ok)
  const overrides = loadAxisOverrides()
  assert.deepEqual(overrides, {})
})

test("axis: multiple overrides survive round-trip", async () => {
  ensureSandbox()
  writeTiers()
  const { writeAxisOverride, loadAxisOverrides } = await import(join(root, "src/lib/selection-manager.js?ax4=" + Date.now()))
  writeAxisOverride("flow", "strict")
  writeAxisOverride("websearch", "encouraged")
  const overrides = loadAxisOverrides()
  assert.equal(overrides.flow, "strict")
  assert.equal(overrides.websearch, "encouraged")
})

after(() => {
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
  sandbox = null
  if (prevVibeHome) process.env.VIBEOS_HOME = prevVibeHome
})
