// SPDX-License-Identifier: MIT
// Contract: the BE/ML routing decision reaches production routing in EVERY mode,
// not only vibeultrax.
//
// Three defects this pins down:
//   1. entry_slot / worker_slot / selected_slot / worker_model / selected_subagent
//      / requires_delegation each had exactly ONE writer, inside `if (isUltraX)`.
//      Leaving vibeultrax froze all six, and tool-execute routes every Task off
//      worker_slot -- so subagent routing in every other mode read stale
//      vibeultrax values.
//   2. The ML difficulty adjustment is gated on
//      `cascadeRoot.includes(suggestedTier) && suggestedTier !== regimeSlot`.
//      Every mode except vibeultrax declares a single-slot pipeline, so both
//      conditions could never hold together and the ML engine was inert.
//   3. resolveCascadeRouteDecision had zero call sites, was tree-shaken out of
//      dist/vibeOS.js, and was still asserted by six suites as the production
//      route resolver.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const DIST = (p) => pathToFileURL(join(process.cwd(), "dist-ts", p)).href

// Seeds a sandbox whose selection state is mid-vibeultrax, then runs one
// syncControlSettings turn with the supplied control vector and returns the
// resulting selection.
function syncTurn(seedSelection, cv) {
  const home = mkdtempSync(join(tmpdir(), "vib-mlroute-"))
  mkdirSync(join(home, ".config/opencode"), { recursive: true })
  mkdirSync(join(home, ".claude"), { recursive: true })
  writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({ default_agent: "vibe" }, null, 2))
  writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({
    trinity: {
      cheap: { oc: "testprov/lightning-v2" },
      medium: { oc: "testprov/flash-v2" },
      brain: { oc: "testprov/ultra-v2" },
    },
    selection: seedSelection,
  }, null, 2))

  const script = `
    const fs = await import("node:fs");
    const path = await import("node:path");
    const q = "?mlroute=" + Date.now();
    // No cache-buster: chat-transform's own relative pricing import resolves to
    // the bare URL, so slot state must be seeded on that same module instance.
    const pricing = await import(${JSON.stringify(DIST("lib/pricing.js"))});
    pricing.loadTrinitySlotsFromTiersFile();
    const mod = await import(${JSON.stringify(DIST("lib/hooks/chat-transform.js"))} + q);
    mod.syncControlSettings(${JSON.stringify(cv)}, { persistOptimizationMode: true, authoritative: true });
    const tiers = JSON.parse(fs.readFileSync(path.join(process.env.VIBEOS_HOME, "model-tiers.json"), "utf8"));
    console.log(JSON.stringify(tiers.selection));
    process.exit(0);
  `
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    timeout: 20000,
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      VIBEOS_FAST_CI: "1",
      HOME: home,
      VIBEOS_HOME: join(home, ".claude"),
      VIBEOS_OPENCODE_HOME: join(home, ".config/opencode"),
    },
  }).trim())
}

const ULTRAX_SEED = {
  enabled: true,
  optimization_mode: "vibeultrax",
  active_pipeline: ["cheap", "medium", "brain"],
  active_slot: "cheap",
  entry_slot: "cheap",
  worker_slot: "brain",
  selected_slot: "brain",
  worker_model: "testprov/ultra-v2",
  selected_subagent: "vibe-brain",
  requires_delegation: true,
}

// ── Defect 1: slot state must not freeze when the mode leaves vibeultrax ──

test("leaving vibeultrax refreshes entry_slot instead of freezing the ultrax value", () => {
  const sel = syncTurn({ ...ULTRAX_SEED }, {
    optimization_mode: "vibemax",
    selected_slot: "medium",
    tier_bias: "medium",
  })
  assert.equal(sel.entry_slot, "medium", "entry_slot must track the current mode, not the last vibeultrax turn")
})

test("leaving vibeultrax refreshes worker_slot, which is what Task routing reads", () => {
  const sel = syncTurn({ ...ULTRAX_SEED }, {
    optimization_mode: "vibemax",
    selected_slot: "medium",
    tier_bias: "medium",
  })
  assert.equal(sel.worker_slot, "medium", "tool-execute routes every Task off worker_slot")
  assert.equal(sel.selected_slot, "medium")
})

test("leaving vibeultrax clears the ultrax delegation contract", () => {
  const sel = syncTurn({ ...ULTRAX_SEED }, {
    optimization_mode: "vibemax",
    selected_slot: "medium",
    tier_bias: "medium",
  })
  assert.equal(sel.requires_delegation, false, "only vibeultrax delegates; the orchestrator runs at tier elsewhere")
  assert.equal(sel.selected_subagent, null, "a stale vibe-brain subagent must not survive the mode switch")
})

test("worker_model follows the refreshed slot", () => {
  const sel = syncTurn({ ...ULTRAX_SEED }, {
    optimization_mode: "vibemax",
    selected_slot: "medium",
    tier_bias: "medium",
  })
  assert.equal(sel.worker_model, "testprov/flash-v2")
})

test("vibeultrax itself is unchanged: cheap entry, escalated worker, delegation on", () => {
  const sel = syncTurn({ enabled: true, optimization_mode: "vibeultrax" }, {
    optimization_mode: "vibeultrax",
    selected_slot: "brain",
    tier_bias: "brain",
  })
  assert.equal(sel.entry_slot, "cheap", "vibeultrax orchestrates from cheap by design")
  assert.equal(sel.worker_slot, "brain")
  assert.equal(sel.requires_delegation, true)
  assert.equal(sel.selected_subagent, "vibe-brain")
})

// ── Defect 2: the ML envelope must span mode pipeline plus the live route ──

test("ML cascade root spans the mode pipeline and the live route path", async () => {
  const mod = await import("../src/lib/hooks/tool-execute.js")
  assert.equal(typeof mod.mlCascadeRoot, "function", "mlCascadeRoot must be exported for the ML gate")
  const root = mod.mlCascadeRoot({ active_pipeline: ["medium"], route_path: ["medium", "brain"] }, "brain")
  assert.deepEqual(root, ["medium", "brain"], "a backend escalation widens the envelope the ML may move within")
})

test("ML cascade root respects an explicit single-tier mode", async () => {
  const mod = await import("../src/lib/hooks/tool-execute.js")
  const root = mod.mlCascadeRoot({ active_pipeline: ["brain"], route_path: ["brain"] }, "brain")
  assert.deepEqual(root, ["brain"], "vibeqmax means brain only -- the ML must not de-escalate out of it")
})

test("ML cascade root keeps the full trinity in vibeultrax", async () => {
  const mod = await import("../src/lib/hooks/tool-execute.js")
  const root = mod.mlCascadeRoot({ active_pipeline: ["cheap", "medium", "brain"], route_path: ["cheap"] }, "cheap")
  assert.deepEqual(root, ["cheap", "medium", "brain"])
})

test("ML cascade root is slot-ranked, never raw insertion order", async () => {
  const mod = await import("../src/lib/hooks/tool-execute.js")
  const root = mod.mlCascadeRoot({ active_pipeline: ["brain"], route_path: ["cheap"] }, "cheap")
  assert.deepEqual(root, ["cheap", "brain"])
})

// ── Defect 3: the dead resolver is gone and the real path ships ──

test("resolveCascadeRouteDecision is gone -- it never shipped and never routed", async () => {
  const mod = await import("../src/lib/hooks/tool-execute.js")
  assert.equal(mod.resolveCascadeRouteDecision, undefined,
    "dead resolver: zero call sites, tree-shaken out of dist/vibeOS.js, superseded by the inline ML path")
})

test("the production ML routing path survives into the shipped bundle", () => {
  const bundle = readFileSync(join(process.cwd(), "dist/vibeOS.js"), "utf8")
  assert.ok(bundle.includes("computeDifficulty"), "the live ML difficulty engine must ship")
  assert.ok(bundle.includes("mlCascadeRoot"), "the ML envelope resolver must ship, not be tree-shaken like its predecessor")
})

// ── Defect 2b: a verdict outside the envelope is clamped, not discarded ──

test("clampSlotToEnvelope pulls an out-of-envelope verdict to the nearest allowed slot", async () => {
  const te = await import(DIST("lib/hooks/tool-execute.js"))
  // The reachable case: vibemax's envelope excludes cheap, and computeDifficulty
  // only ever suggests cheap or brain (medium arrives at level "moderate", which
  // the gate excludes). A membership test would drop this verdict entirely.
  assert.equal(te.clampSlotToEnvelope("cheap", ["medium", "brain"]), "medium")
  assert.equal(te.clampSlotToEnvelope("brain", ["cheap", "medium"]), "medium")
  // A member is returned unchanged.
  assert.equal(te.clampSlotToEnvelope("brain", ["cheap", "medium", "brain"]), "brain")
  // Single-slot envelopes clamp to themselves, so vibeqmax/vibelitex stay hard bounds.
  assert.equal(te.clampSlotToEnvelope("cheap", ["brain"]), "brain")
  assert.equal(te.clampSlotToEnvelope("brain", ["medium"]), "medium")
})

test("clampSlotToEnvelope ignores an unrecognised verdict instead of clamping it to cheap", async () => {
  const te = await import(DIST("lib/hooks/tool-execute.js"))
  // _slotRank returns 0 for unknown slots, so a rank-based guard would have
  // clamped garbage to the bottom of the envelope.
  assert.equal(te.clampSlotToEnvelope("turbo", ["medium", "brain"]), null)
  assert.equal(te.clampSlotToEnvelope("", ["medium", "brain"]), null)
  assert.equal(te.clampSlotToEnvelope(null, ["medium", "brain"]), null)
  assert.equal(te.clampSlotToEnvelope("cheap", []), null)
})

test("clampSlotToEnvelope ships in the bundle", () => {
  const bundle = readFileSync(join(process.cwd(), "dist", "vibeOS.js"), "utf8")
  assert.ok(bundle.includes("clampSlotToEnvelope"),
    "the clamp must survive bundling, or the ML gate silently reverts to dropping verdicts")
})

// ── Defect 4: an explicit `vibe axis tier <slot>` pin is honoured offline by
// computeAxisBundle (cascade.ts) but was dropped on the authoritative API path.
// normalizeBackendDecision never consults axis_overrides, and syncControlSettings
// pins only enforcement/flow/tdd/thinking -- never tier. So the pin worked with
// the backend down and silently did nothing with it up, which is the normal case.

test("an explicit tier axis pin beats the backend slot on the authoritative path", () => {
  const sel = syncTurn({ ...ULTRAX_SEED, axis_overrides: { tier: "brain" } }, {
    optimization_mode: "vibemax",
    selected_slot: "cheap",
    tier_bias: "cheap",
  })
  assert.equal(sel.active_slot, "brain", "tier pin must drive the orchestrator slot")
  assert.equal(sel.entry_slot, "brain", "tier pin must drive the entry slot")
})

test("a tier axis pin also drives the worker slot Task routing reads", () => {
  const sel = syncTurn({ ...ULTRAX_SEED, axis_overrides: { tier: "medium" } }, {
    optimization_mode: "vibemax",
    selected_slot: "cheap",
    tier_bias: "cheap",
  })
  assert.equal(sel.worker_slot, "medium")
  assert.equal(sel.worker_model, "testprov/flash-v2", "worker model follows the pinned slot")
})

test("a tier pin overrides vibeultrax cheap-first entry too", () => {
  const sel = syncTurn({ ...ULTRAX_SEED, axis_overrides: { tier: "brain" } }, {
    optimization_mode: "vibeultrax",
    selected_slot: "brain",
    tier_bias: "cheap",
  })
  assert.equal(sel.entry_slot, "brain", "explicit user pin beats the cheap-first default")
})

test("no tier pin leaves vibeultrax cheap-first behaviour exactly as it was", () => {
  const sel = syncTurn({ ...ULTRAX_SEED, axis_overrides: {} }, {
    optimization_mode: "vibeultrax",
    selected_slot: "brain",
    tier_bias: "cheap",
  })
  assert.equal(sel.entry_slot, "cheap")
  assert.equal(sel.worker_slot, "brain")
})

test("an unrecognised tier axis value is ignored, not clamped to cheap", () => {
  const sel = syncTurn({ ...ULTRAX_SEED, axis_overrides: { tier: "auto" } }, {
    optimization_mode: "vibemax",
    selected_slot: "medium",
    tier_bias: "medium",
  })
  assert.equal(sel.entry_slot, "medium", "auto must fall through to the backend slot")
})

// ── Defect 5: worker_model was taken verbatim from the backend control vector.
// Observed live: the API returned selected_model "openrouter/openai/o1-pro" while
// the machine's brain slot was a different provider entirely. tool-execute routes
// Task delegation off worker_model, so an unconfigured, cross-provider id reaches
// the delegation call and the turn fails on "not a valid model ID".

test("a backend model outside the local trinity is clamped to the slot's model", () => {
  const sel = syncTurn({ ...ULTRAX_SEED }, {
    optimization_mode: "vibemax",
    selected_slot: "brain",
    tier_bias: "brain",
    selected_model: "openrouter/openai/o1-pro",
  })
  assert.equal(sel.worker_model, "testprov/ultra-v2", "must clamp to the configured brain model")
  assert.notEqual(sel.worker_model, "openrouter/openai/o1-pro")
})

test("a backend model that IS a configured trinity model is preserved", () => {
  const sel = syncTurn({ ...ULTRAX_SEED }, {
    optimization_mode: "vibemax",
    selected_slot: "medium",
    tier_bias: "medium",
    selected_model: "testprov/flash-v2",
  })
  assert.equal(sel.worker_model, "testprov/flash-v2")
})
