// SPDX-License-Identifier: MIT
//
// The per-turn difficulty verdict must never escape the mode's envelope.
//
// resolved_tier is applied to the control vector as the authoritative slot for the
// turn. While it was never actually being written that override was dead code, so
// nothing caught that it was applied raw. Once a verdict started arriving, a trivial
// prompt scoring "cheap" dragged vibeqmax -- whose envelope is ["brain"] -- onto the
// cheap model: observed live as active_slot=cheap and worker_model=<cheap model> on an
// arm configured brain-only. The envelope is a hard bound; a verdict outside it is
// clamped to the nearest member, never applied as-is.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { clampVerdictToEnvelope } = await import("../src/lib/hooks/chat-transform.js")

test("a verdict outside the envelope is clamped to the nearest member", () => {
  assert.equal(clampVerdictToEnvelope("cheap", ["brain"]), "brain")
  assert.equal(clampVerdictToEnvelope("medium", ["brain"]), "brain")
  assert.equal(clampVerdictToEnvelope("brain", ["cheap"]), "cheap")
  assert.equal(clampVerdictToEnvelope("brain", ["cheap", "medium"]), "medium")
  assert.equal(clampVerdictToEnvelope("cheap", ["medium", "brain"]), "medium")
})

test("a verdict inside the envelope passes through untouched", () => {
  const full = ["cheap", "medium", "brain"]
  assert.equal(clampVerdictToEnvelope("cheap", full), "cheap")
  assert.equal(clampVerdictToEnvelope("medium", full), "medium")
  assert.equal(clampVerdictToEnvelope("brain", full), "brain")
})

test("an absent or unusable verdict yields null, and never invents a slot", () => {
  assert.equal(clampVerdictToEnvelope(null, ["cheap", "brain"]), null)
  assert.equal(clampVerdictToEnvelope(undefined, ["cheap", "brain"]), null)
  assert.equal(clampVerdictToEnvelope("", ["cheap", "brain"]), null)
  assert.equal(clampVerdictToEnvelope("nonsense", ["cheap", "brain"]), null)
  // An empty envelope is not a licence to pick a slot.
  assert.equal(clampVerdictToEnvelope("brain", []), null)
  assert.equal(clampVerdictToEnvelope("brain", null), null)
})

// End-to-end: this is the shape the live regression took. A brain-only mode given a
// prompt that scores "cheap" must still run on brain.
test("a cheap verdict cannot pull a brain-only mode onto the cheap model", async () => {
  const home = mkdtempSync(join(tmpdir(), "vibe-envelope-"))
  process.env.VIBEOS_HOME = home
  process.env.VIBEOS_AGENT_GATE = "off"
  process.env.VIBEOS_API_URL = "http://127.0.0.1:1"
  mkdirSync(join(home, "session-events"), { recursive: true })
  writeFileSync(join(home, "model-tiers.json"), JSON.stringify({
    trinity: { cheap: { oc: "t/cheap-m" }, medium: { oc: "t/medium-m" }, brain: { oc: "t/brain-m" } },
    selection: {
      enabled: true, optimization_mode: "vibeqmax", requested_optimization_mode: "vibeqmax",
      active_pipeline: ["brain"], active_slot: "brain", entry_slot: "brain",
      slot_locked: false, axis_overrides: {},
    },
  }))
  const pricing = await import("../src/lib/pricing.js")
  pricing.loadTrinitySlotsFromTiersFile?.()
  const ct = await import("../src/lib/hooks/chat-transform.js")

  // Short and mechanical, so the difficulty scorer returns "cheap".
  const trivial = "read marker.txt and write done.txt"
  const messages = [{ info: { role: "user" }, role: "user", parts: [{ type: "text", text: trivial }] }]
  await ct.onMessagesTransform({ sessionID: "envelope-1" }, { messages })
  await ct.onSystemTransform({ sessionID: "envelope-1" }, { system: ["You are a coding agent."] })

  const sel = JSON.parse(readFileSync(join(home, "model-tiers.json"), "utf8")).selection
  assert.equal(sel.active_slot, "brain", `brain-only mode was pulled onto ${sel.active_slot}`)
  assert.equal(sel.worker_slot, "brain", `brain-only mode delegated to ${sel.worker_slot}`)
  assert.notEqual(sel.worker_model, "t/cheap-m", "brain-only mode must not route work to the cheap model")
})
