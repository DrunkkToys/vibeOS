// SPDX-License-Identifier: MIT
// Contract: syncControlSettings() must sync tdd_quality from the control vector's
// tdd_mode, and must compare tdd_mode against the values it can actually take
// ("quality" | "lazy", per mode-table.ts's ModeEntry.tdd field -- never the
// literal string "strict", which no mode ever produces).
//
// Live-reproduced bug: after switching modes (raw -> vibeultrax), the footer's
// selection state had tdd_strict=false AND tdd_quality=false even though
// vibeultrax's own mode-table entry declares tdd: "quality". Root cause:
// syncControlSettings only ever wrote tdd_enforce/tdd_strict, comparing
// `cv.tdd_mode === "strict"` -- a value tdd_mode never holds -- so tdd_strict was
// always wrongly false for "quality" mode, and tdd_quality was never written at
// all, so whatever stale value it had (e.g. false, from a previous "raw" mode
// switch that disables TDD) persisted forever. This silently disabled the TDD
// quality-assertion feature (real per-language assertions instead of bare TODOs)
// for any user whose selection state had tdd_quality=false at some point.

import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function seedSandbox(prefix, initialSelection) {
  const sandbox = mkdtempSync(join(tmpdir(), prefix))
  const vibeHome = join(sandbox, ".claude")
  mkdirSync(vibeHome, { recursive: true })
  mkdirSync(join(sandbox, ".opencode"), { recursive: true })
  writeFileSync(join(vibeHome, "model-tiers.json"), JSON.stringify({
    selection: { enabled: true, active_slot: "brain", ...initialSelection },
    trinity: {
      cheap: { oc: "opencode/big-pickle", cc: "opencode/big-pickle" },
      medium: { oc: "opencode-go/deepseek-v4-flash", cc: "opencode-go/deepseek-v4-flash" },
      brain: { oc: "opencode-go/mimo-v2.5", cc: "opencode-go/mimo-v2.5" },
    },
  }))
  writeFileSync(join(vibeHome, "delegation-state.json"), JSON.stringify({ sessions: {}, lifetime: {} }))
  writeFileSync(join(vibeHome, "blackbox-state.json"), JSON.stringify({ sessions: {} }))
  return { sandbox, vibeHome }
}

test("syncControlSettings: tdd_mode=quality re-enables tdd_quality even if it was previously disabled", async () => {
  // Simulate the live bug: a prior "raw" mode switch (tdd: "—") left tdd_quality
  // and tdd_strict both false on disk before this turn's sync runs.
  const { vibeHome } = seedSandbox("vibeos-tdd-quality-sync-a-", { tdd_quality: false, tdd_strict: false })
  const prevVibeHome = process.env.VIBEOS_HOME
  const prevHome = process.env.HOME
  process.env.VIBEOS_HOME = vibeHome
  process.env.HOME = vibeHome
  after(() => {
    process.env.VIBEOS_HOME = prevVibeHome !== undefined ? prevVibeHome : ""
    process.env.HOME = prevHome !== undefined ? prevHome : ""
  })

  const { syncControlSettings } = await import("../src/lib/hooks/chat-transform.js")
  const { loadSelection } = await import("../src/lib/state.js")

  const controlVector = {
    optimization_mode: "vibeqmax",
    tier_bias: "brain",
    selected_slot: "brain",
    enforcement_mode: "strict",
    flow_mode: "strict",
    tdd_mode: "quality",
    thinking_mode: "full",
    route_path: ["brain"],
    pipeline_root: ["brain"],
    cascade_root: ["brain"],
  }

  syncControlSettings(controlVector, { authoritative: true, persistOptimizationMode: false })

  const sel = loadSelection()
  assert.equal(sel.tdd_quality, true, `tdd_mode="quality" must sync tdd_quality=true, got: ${sel.tdd_quality}`)
  assert.equal(sel.tdd_strict, true, `tdd_mode="quality" must sync tdd_strict=true, got: ${sel.tdd_strict}`)
})

test("syncControlSettings: tdd_mode=lazy disables both tdd_strict and tdd_quality", async () => {
  const { vibeHome } = seedSandbox("vibeos-tdd-quality-sync-b-", { tdd_quality: true, tdd_strict: true })
  const prevVibeHome = process.env.VIBEOS_HOME
  const prevHome = process.env.HOME
  process.env.VIBEOS_HOME = vibeHome
  process.env.HOME = vibeHome
  after(() => {
    process.env.VIBEOS_HOME = prevVibeHome !== undefined ? prevVibeHome : ""
    process.env.HOME = prevHome !== undefined ? prevHome : ""
  })

  const { syncControlSettings } = await import("../src/lib/hooks/chat-transform.js")
  const { loadSelection } = await import("../src/lib/state.js")

  const controlVector = {
    optimization_mode: "vibemax",
    tier_bias: "medium",
    selected_slot: "medium",
    enforcement_mode: "relaxed",
    flow_mode: "audit",
    tdd_mode: "lazy",
    thinking_mode: "off",
    route_path: ["medium"],
    pipeline_root: ["medium"],
    cascade_root: ["medium"],
  }

  syncControlSettings(controlVector, { authoritative: true, persistOptimizationMode: false })

  const sel = loadSelection()
  assert.equal(sel.tdd_strict, false, `tdd_mode="lazy" must sync tdd_strict=false, got: ${sel.tdd_strict}`)
  assert.equal(sel.tdd_quality, false, `tdd_mode="lazy" must sync tdd_quality=false, got: ${sel.tdd_quality}`)
})
