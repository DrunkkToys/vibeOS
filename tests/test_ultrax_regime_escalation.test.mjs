// SPDX-License-Identifier: MIT
//
// vibeultrax never reached the brain tier in sixteen A/B runs. The cause was
// measured, not guessed: computeDifficulty scores the five evtpipe turns at
// 0.284-0.379, so `level` is "moderate"/"simple" and `suggestedTier` is
// medium/cheap. It is written to blackbox `resolved_tier` every turn and read
// first by syncControlSettings' verdict chain, which caps the primary at medium
// -- the rig recorded ranModels=[cheap,medium] with brain never once running.
//
// `complex` needs score >= 0.55. A natural instruction of a few sentences cannot
// reach that: the score is built from prompt TEXT features (length, file
// mentions, error signals, action density), so "fix every remaining correctness
// defect in the library, add tests for each, run npm test" -- the hardest kind of
// agentic work -- scores 0.340.
//
// The regime is the stronger signal and is already computed: REGIME_AXIS_BASE
// maps IMPLEMENTING/REVIEWING/CONVERGING/RESEARCH/DESIGNING/LOOPING to brain and
// EXPLORING to cheap. For vibeultrax it was being discarded, because it rides on
// `tier_bias`, which normalizeBackendDecision pins to "cheap" as the entry floor
// and which the verdict chain therefore excludes by design. It is carried here as
// `regime_tier`, a field no normalizer clamps.
import test from "node:test"
import assert from "node:assert/strict"

const cascade = await import("../src/lib/cascade.js")
const { REGIME_AXIS_BASE, REGIME_CONTROL_TABLE } = cascade

test("the regime tier survives as regime_tier for every regime", () => {
  for (const [regime, bundle] of Object.entries(REGIME_AXIS_BASE)) {
    const row = REGIME_CONTROL_TABLE[regime]
    assert.ok(row, `${regime} missing from REGIME_CONTROL_TABLE`)
    assert.equal(row.regime_tier, bundle.tier, `${regime} must publish its tier as regime_tier`)
  }
})

test("the regimes the spec sends to brain actually say brain", () => {
  for (const regime of ["IMPLEMENTING", "RESEARCH", "REVIEWING", "DESIGNING", "CONVERGING", "LOOPING"]) {
    assert.equal(REGIME_CONTROL_TABLE[regime].regime_tier, "brain", `${regime} must resolve to brain`)
  }
})

// Without this, escalation is a one-way ratchet and vibeultrax saves nothing:
// every turn would end on brain and the mode becomes raw with extra latency.
test("the cheap regime still says cheap, so vibeultrax can de-escalate", () => {
  assert.equal(REGIME_CONTROL_TABLE.EXPLORING.regime_tier, "cheap")
  assert.equal(REGIME_CONTROL_TABLE.DIVERGENT.regime_tier, "medium")
})

// The entry-floor contract is deliberate and ~20 test files assert it. regime_tier
// is a separate channel, not a relaxation of that clamp: tier_bias must still carry
// the same value it always did. If this breaks, the change went in the wrong place.
test("tier_bias is untouched — regime_tier is an added channel, not a replacement", () => {
  for (const [regime, bundle] of Object.entries(REGIME_AXIS_BASE)) {
    assert.equal(REGIME_CONTROL_TABLE[regime].tier_bias, bundle.tier, `${regime} tier_bias changed`)
  }
})

// The verdict chain must let a brain regime beat the weak prompt-text estimate.
// resolved_tier="medium" is exactly what the evtpipe run produced on every turn.
test("a brain regime outranks a medium prompt-difficulty estimate", async () => {
  const mod = await import("../src/lib/hooks/chat-transform.js")
  const strongest = mod.strongestTierVerdict
  assert.equal(typeof strongest, "function", "strongestTierVerdict must be exported")
  assert.equal(strongest("medium", "brain"), "brain", "the regime must be able to escalate")
  assert.equal(strongest("brain", "cheap"), "brain", "a brain estimate must not be dragged down")
  assert.equal(strongest("cheap", "cheap"), "cheap", "agreement on cheap stays cheap")
  assert.equal(strongest(null, "brain"), "brain")
  assert.equal(strongest("medium", null), "medium")
  assert.equal(strongest(null, null), null, "no verdict must not invent an escalation")
  assert.equal(strongest("medium", "auto"), "medium", "auto is not a slot and carries no verdict")
})

// ── Wiring ────────────────────────────────────────────────────────────
// The precedence helper is only worth anything if syncControlSettings applies it.
// This drives the real hook against a sandboxed VIBEOS_HOME and asserts on what
// lands in model-tiers.json — the file chat.params reads to pick the outbound
// model. It reproduces the exact control vector the A/B rig recorded: a
// resolved_tier of "medium" from the prompt-text scorer, on a LOOPING regime
// (which dominated the observed run: 14-18 of ~20 control-history entries).
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after } from "node:test"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-regime-escalation-"))
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

function seed(selection = {}) {
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

const readSlot = () =>
  JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf-8")).selection.active_slot

test("a brain regime moves the primary even though the prompt scorer said medium", async () => {
  seed()
  const mod = await import("../src/lib/hooks/chat-transform.js?regime-wire=" + Date.now())
  mod.syncControlSettings(
    { ...CV, resolved_tier: "medium", regime_tier: "brain" },
    { authoritative: true },
  )
  assert.equal(readSlot(), "brain", "the regime verdict must reach the primary, not stop at medium")
})

test("an EXPLORING regime still de-escalates — vibeultrax must keep saving", async () => {
  seed({ active_slot: "brain" })
  const mod = await import("../src/lib/hooks/chat-transform.js?regime-wire=" + Date.now())
  mod.syncControlSettings(
    { ...CV, resolved_tier: "cheap", regime_tier: "cheap" },
    { authoritative: true },
  )
  assert.equal(readSlot(), "cheap", "a cheap regime must come back down")
})

test("`vibe lock on` still beats a brain regime", async () => {
  seed({ slot_locked: true })
  const mod = await import("../src/lib/hooks/chat-transform.js?regime-wire=" + Date.now())
  mod.syncControlSettings({ ...CV, resolved_tier: "medium", regime_tier: "brain" }, {})
  assert.equal(readSlot(), "cheap", "a locked slot must survive a hard regime")
})
