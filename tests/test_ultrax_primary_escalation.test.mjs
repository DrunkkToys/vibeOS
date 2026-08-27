// SPDX-License-Identifier: MIT
// VibeUltraX primary-turn escalation.
//
// The cascade envelope [cheap, medium, brain] only ever moved on the Task
// delegation path (tool-execute.ts gates the whole routing block on
// `t === "task"`). A vibeultrax session where the model does the work itself
// therefore ran every turn on the cheap entry slot: the live A/B rig recorded
// slots=["cheap"] across all 11 chat-params rows of a 5-turn session, which is
// the rig's own "cascade did not cascade" void condition.
//
// The per-turn difficulty verdict was already being computed and persisted as
// blackbox `resolved_tier`; nothing applied it to the primary. These tests pin
// the contract for the function that closes that gap.
import { test } from "node:test"
import assert from "node:assert/strict"

import { ultraXPrimarySlot } from "../src/lib/hooks/chat-transform.js"

const ENVELOPE = ["cheap", "medium", "brain"]

test("escalates the primary from the cheap entry when the turn is hard", () => {
  const sel = { optimization_mode: "vibeultrax", active_slot: "cheap" }
  assert.equal(ultraXPrimarySlot(sel, "brain", ENVELOPE), "brain")
})

test("de-escalates back down when the turn is trivial", () => {
  const sel = { optimization_mode: "vibeultrax", active_slot: "brain" }
  assert.equal(ultraXPrimarySlot(sel, "cheap", ENVELOPE), "cheap")
})

test("returns null when the verdict already matches the active slot", () => {
  const sel = { optimization_mode: "vibeultrax", active_slot: "cheap" }
  assert.equal(ultraXPrimarySlot(sel, "cheap", ENVELOPE), null)
})

test("clamps a verdict outside the envelope to the nearest member", () => {
  const sel = { optimization_mode: "vibeultrax", active_slot: "brain" }
  assert.equal(ultraXPrimarySlot(sel, "cheap", ["medium", "brain"]), "medium")
})

test("is inert outside vibeultrax — a single-slot mode never moves", () => {
  const sel = { optimization_mode: "vibeqmax", active_slot: "brain" }
  assert.equal(ultraXPrimarySlot(sel, "cheap", ["brain"]), null)
})

test("respects `vibe lock on` — a locked slot is frozen for the session", () => {
  const sel = { optimization_mode: "vibeultrax", active_slot: "cheap", slot_locked: true }
  assert.equal(ultraXPrimarySlot(sel, "brain", ENVELOPE), null)
})

test("respects an explicit `vibe axis tier <slot>` pin", () => {
  const sel = { optimization_mode: "vibeultrax", active_slot: "cheap", axis_overrides: { tier: "cheap" } }
  assert.equal(ultraXPrimarySlot(sel, "brain", ENVELOPE), null)
})

test("ignores a missing or unrecognised verdict rather than guessing", () => {
  const sel = { optimization_mode: "vibeultrax", active_slot: "cheap" }
  assert.equal(ultraXPrimarySlot(sel, "", ENVELOPE), null)
  assert.equal(ultraXPrimarySlot(sel, null, ENVELOPE), null)
  assert.equal(ultraXPrimarySlot(sel, "supergenius", ENVELOPE), null)
})

test("an empty envelope is a no-op, not an unbounded escalation", () => {
  const sel = { optimization_mode: "vibeultrax", active_slot: "cheap" }
  assert.equal(ultraXPrimarySlot(sel, "brain", []), null)
})

// ── Wiring ────────────────────────────────────────────────────────────
// The predicate above is only worth anything if syncControlSettings actually
// applies it. These drive the real hook against a sandboxed VIBEOS_HOME and
// assert on what lands in model-tiers.json — the file chat.params reads to
// pick the outbound model.
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after } from "node:test"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-ultrax-escalation-"))
mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
const prevVibeHome = process.env.VIBEOS_HOME
const prevHome = process.env.HOME
process.env.VIBEOS_HOME = join(sandbox, ".claude")
process.env.HOME = sandbox
writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({ model: "opencode/muse-spark", plugin: ["vibeOS"] }))

after(() => {
  try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
  try { process.env.HOME = prevHome } catch {}
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})

const TRINITY = {
  brain: { oc: "opencode/mimo-v2.5-free" },
  medium: { oc: "opencode/hy3-free" },
  cheap: { oc: "opencode/muse-spark-1.2-contributor-free" },
}

function seed(selection) {
  writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
    selection: {
      enabled: true,
      active_slot: "cheap",
      optimization_mode: "vibeultrax",
      active_pipeline: ["cheap", "medium", "brain"],
      ...selection,
    },
    trinity: TRINITY,
  }))
}

const CV = {
  optimization_mode: "vibeultrax",
  tier_bias: "cheap",
  pipeline_root: ["cheap", "medium", "brain"],
  enforcement_mode: "strict",
  flow_mode: "strict",
  tdd_mode: "quality",
  thinking_mode: "full",
}

function readSlot() {
  return JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf-8")).selection.active_slot
}

test("syncControlSettings moves the primary off cheap on a hard turn", async () => {
  seed({})
  const mod = await import("../src/lib/hooks/chat-transform.js?ultrax-wire=" + Date.now())
  mod.syncControlSettings({ ...CV, resolved_tier: "brain" }, { authoritative: true })
  assert.equal(readSlot(), "brain", "a brain verdict must reach active_slot, not stop at the envelope floor")
})

test("syncControlSettings leaves the primary on cheap with no verdict", async () => {
  seed({})
  const mod = await import("../src/lib/hooks/chat-transform.js?ultrax-wire=" + Date.now())
  mod.syncControlSettings({ ...CV }, { authoritative: true })
  assert.equal(readSlot(), "cheap", "no verdict must not invent an escalation")
})

test("syncControlSettings does not escalate a locked slot", async () => {
  seed({ slot_locked: true })
  const mod = await import("../src/lib/hooks/chat-transform.js?ultrax-wire=" + Date.now())
  mod.syncControlSettings({ ...CV, resolved_tier: "brain" }, {})
  assert.equal(readSlot(), "cheap", "`vibe lock on` must survive a hard turn")
})
