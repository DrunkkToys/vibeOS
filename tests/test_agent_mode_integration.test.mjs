// SPDX-License-Identifier: MIT
// Integration test: agent_mode is regime-driven, not mode-driven
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const turn = await import("../src/lib/turn-classify.js?agent-test=" + Date.now())

// ── agent_mode: plan only for complex regimes ──
test("agent_mode: REFINING + low stress → plan", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "REFINING", latest_stress_multiplier: 0 },
    undefined, "budget"
  )
  assert.equal(cv.agent_mode, "plan")
})

test("agent_mode: CONVERGING + low stress → plan", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "CONVERGING", latest_stress_multiplier: 0 },
    undefined, "quality"
  )
  assert.equal(cv.agent_mode, "plan")
})

test("agent_mode: CLOSED + low stress → plan", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "CLOSED", latest_stress_multiplier: 0 },
    undefined, "quality"
  )
  assert.equal(cv.agent_mode, "plan")
})

// ── agent_mode: NOT plan for simple regimes ──
test("agent_mode: EXPLORING + low stress → undefined", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "EXPLORING", latest_stress_multiplier: 0 },
    undefined, "budget"
  )
  assert.equal(cv.agent_mode, undefined)
})

test("agent_mode: DIVERGENT + low stress → undefined", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "DIVERGENT", latest_stress_multiplier: 0 },
    undefined, "budget"
  )
  assert.equal(cv.agent_mode, undefined)
})

test("agent_mode: INIT + low stress → undefined", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "INIT", latest_stress_multiplier: 0 },
    undefined, "budget"
  )
  assert.equal(cv.agent_mode, undefined)
})

test("agent_mode: LOOPING + low stress → undefined", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "LOOPING", latest_stress_multiplier: 0 },
    undefined, "speed"
  )
  assert.equal(cv.agent_mode, undefined)
})

// ── agent_mode: stress > 1.5 blocks plan ──
test("agent_mode: REFINING + high stress → undefined", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "REFINING", latest_stress_multiplier: 1.8 },
    undefined, "quality"
  )
  assert.equal(cv.agent_mode, undefined)
})

test("agent_mode: CONVERGING + high stress → undefined", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "CONVERGING", latest_stress_multiplier: 1.8 },
    undefined, "quality"
  )
  assert.equal(cv.agent_mode, undefined)
})

// ── Full chain: QA query should NOT trigger plan ──
test("full chain: 'hi' → INIT → agent_mode undefined", () => {
  const regime = turn.classifyTurnSimple("hi")
  const mode = turn.autoSelectMode(regime, 0)
  const cv = turn.computeControlVector(
    { sub_regime: regime, latest_stress_multiplier: 0 },
    undefined, mode
  )
  assert.equal(cv.agent_mode, undefined)
})

test("full chain: 'fix production bug' → REFINING → agent_mode plan", () => {
  const regime = turn.classifyTurnSimple("fix this production bug")
  const mode = turn.autoSelectMode(regime, 0)
  const cv = turn.computeControlVector(
    { sub_regime: regime, latest_stress_multiplier: 0 },
    undefined, mode
  )
  assert.equal(cv.agent_mode, "plan")
})

test("syncControlSettings restores the previous OpenCode agent after plan mode ends", async () => {
  const home = mkdtempSync(join(tmpdir(), "vib-agent-"))
  const prevHome = process.env.HOME
  process.env.HOME = home
  try {
    mkdirSync(join(home, ".config/opencode"), { recursive: true })
    mkdirSync(join(home, ".claude"), { recursive: true })
    writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({ default_agent: "build" }, null, 2))
    writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({ selection: { previous_default_agent: "build" } }, null, 2))

    const moduleUrl = pathToFileURL(join(process.cwd(), "src/lib/hooks/chat-transform.js")).href
    const script = `
      const mod = await import(${JSON.stringify(moduleUrl)} + "?restore=" + Date.now());
      mod.syncControlSettings({ agent_mode: "plan" });
      mod.syncControlSettings({});
      const fs = await import("node:fs");
      const path = await import("node:path");
      const home = process.env.HOME;
      const oc = JSON.parse(fs.readFileSync(path.join(home, ".config/opencode/opencode.json"), "utf8"));
      const tiers = JSON.parse(fs.readFileSync(path.join(home, ".claude/model-tiers.json"), "utf8"));
      console.log(JSON.stringify({ agent: oc.default_agent, restore: tiers.selection.previous_default_agent }));
    `
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    }).trim())
    assert.equal(result.agent, "build")
    assert.equal(result.restore, null)
  } finally {
    process.env.HOME = prevHome
  }
})

test("syncControlSettings drops stuck full thinking when the vector cools down", async () => {
  const home = mkdtempSync(join(tmpdir(), "vib-thinking-"))
  const prevHome = process.env.HOME
  process.env.HOME = home
  try {
    mkdirSync(join(home, ".claude"), { recursive: true })
    writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({ selection: { thinking_level: "full" } }, null, 2))

    const moduleUrl = pathToFileURL(join(process.cwd(), "src/lib/hooks/chat-transform.js")).href
    const script = `
      const mod = await import(${JSON.stringify(moduleUrl)} + "?thinking=" + Date.now());
      mod.syncControlSettings({ thinking_mode: "off" });
      const fs = await import("node:fs");
      const path = await import("node:path");
      const home = process.env.HOME;
      const tiers = JSON.parse(fs.readFileSync(path.join(home, ".claude/model-tiers.json"), "utf8"));
      console.log(JSON.stringify({ thinking: tiers.selection.thinking_level }));
    `
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    }).trim())
    assert.equal(result.thinking, "off")
  } finally {
    process.env.HOME = prevHome
  }
})

// ── Verify other CV fields unaffected ──
test("CV: enforcement_mode still present", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "EXPLORING", latest_stress_multiplier: 0 },
    undefined, "budget"
  )
  assert.ok(cv.enforcement_mode)
  assert.ok(cv.flow_mode)
  assert.ok(cv.tdd_mode)
  assert.ok(cv.tier_bias)
})

test("CV: optimization_mode still present", () => {
  const cv = turn.computeControlVector(
    { sub_regime: "REFINING", latest_stress_multiplier: 0 },
    undefined, "budget"
  )
  assert.ok(cv.optimization_mode)
})
