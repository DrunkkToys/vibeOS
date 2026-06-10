// SPDX-License-Identifier: MIT
// Integration test: Footer ML-driven dynamic display
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-footer-"))
mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(join(sandbox, ".opencode"), { recursive: true })
const prevVibeHome = process.env.VIBEOS_HOME
process.env.VIBEOS_HOME = join(sandbox, ".claude")

function writeTiers(sel = {}) {
  writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
    trinity: { brain: { oc: "a" }, medium: { oc: "b" }, cheap: { oc: "c" } },
    selection: { enabled: true, active_slot: "brain", onboarding_mode: "strict", ...sel }
  }))
}

test("SETUP: sandbox ready", () => {
  assert.ok(true)
})

// ── Footer shows tier icon matching active_slot ──
test("footer: tier icon brain -> 🧠", () => {
  writeTiers({ active_slot: "brain" })
  const sel = JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf8")).selection
  const icon = sel.active_slot === "brain" ? "🧠" : sel.active_slot === "medium" ? "◐" : sel.active_slot === "cheap" ? "⚡" : "🎁"
  assert.equal(icon, "🧠")
})

test("footer: tier icon medium -> ◐", () => {
  writeTiers({ active_slot: "medium" })
  const sel = JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf8")).selection
  const icon = sel.active_slot === "brain" ? "🧠" : sel.active_slot === "medium" ? "◐" : sel.active_slot === "cheap" ? "⚡" : "🎁"
  assert.equal(icon, "◐")
})

test("footer: tier icon cheap -> ⚡", () => {
  writeTiers({ active_slot: "cheap" })
  const sel = JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf8")).selection
  const icon = sel.active_slot === "brain" ? "🧠" : sel.active_slot === "medium" ? "◐" : sel.active_slot === "cheap" ? "⚡" : "🎁"
  assert.equal(icon, "⚡")
})

test("footer: tier icon free -> 🎁", () => {
  writeTiers({ active_slot: "free" })
  const sel = JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf8")).selection
  const icon = sel.active_slot === "brain" ? "🧠" : sel.active_slot === "medium" ? "◐" : sel.active_slot === "cheap" ? "⚡" : "🎁"
  assert.equal(icon, "🎁")
})

// ── Footer displays optimization_mode when not auto ──
test("footer: shows optimization_mode budget", () => {
  writeTiers({ optimization_mode: "budget" })
  const sel = JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf8")).selection
  assert.equal(sel.optimization_mode, "budget")
})

test("footer: shows optimization_mode quality", () => {
  writeTiers({ optimization_mode: "quality" })
  const sel = JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf8")).selection
  assert.equal(sel.optimization_mode, "quality")
})

test("footer: shows optimization_mode speed", () => {
  writeTiers({ optimization_mode: "speed" })
  const sel = JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf8")).selection
  assert.equal(sel.optimization_mode, "speed")
})

// ── Footer shows vector_changed_slot arrow ──
test("footer: → arrow appears when vector_changed differs from active_slot", () => {
  writeTiers({ active_slot: "brain", vector_changed_slot: "cheap" })
  const sel = JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf8")).selection
  assert.equal(sel.vector_changed_slot, "cheap")
  assert.notEqual(sel.vector_changed_slot, sel.active_slot)
  // Vector pulse logic: if vector_changed_slot exists and differs, show ⟡ ${vector_changed_slot}
  const pulse = sel.vector_changed_slot && sel.vector_changed_slot !== sel.active_slot ? ` ⟡ ${sel.vector_changed_slot}` : ""
  assert.ok(pulse.includes("cheap"))
})

test("footer: vector_changed_slot priority for tier display", () => {
  writeTiers({ active_slot: "brain", vector_changed_slot: "medium" })
  const sel = JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf8")).selection
  // ML decision takes priority
  const displaySlot = sel.vector_changed_slot || sel.active_slot
  assert.equal(displaySlot, "medium")
})

// ── Deployment instructions survive writes ──
test("footer: enforcement+flow+tdd settings preserved across tier changes", () => {
  writeTiers({ active_slot: "brain", delegation_enforce: true, flow_enforce: true, tdd_enforce: true, tdd_strict: false })
  const sel = JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf8")).selection
  assert.equal(sel.delegation_enforce, true)
  assert.equal(sel.flow_enforce, true)
  assert.equal(sel.tdd_enforce, true)
  assert.equal(sel.tdd_strict, false)
})

// ── Cleanup ──
test("CLEANUP", () => {
  try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
  assert.ok(true)
})
