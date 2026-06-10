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

test("syncControlSettings restores the previous OpenCode agent after plan mode ends and clears followup pause", async () => {
  const home = mkdtempSync(join(tmpdir(), "vib-agent-"))
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  const prevOCHome = process.env.VIBEOS_OPENCODE_HOME
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")
  process.env.VIBEOS_OPENCODE_HOME = join(home, ".config/opencode")
  try {
    mkdirSync(join(home, ".config/opencode"), { recursive: true })
    mkdirSync(join(home, ".claude"), { recursive: true })
    writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({ default_agent: "build" }, null, 2))
    writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({ selection: { previous_default_agent: "build" } }, null, 2))

    const moduleUrl = pathToFileURL(join(process.cwd(), "dist-ts/lib/hooks/chat-transform.js")).href
    const script = `
      const fs = await import("node:fs");
      const path = await import("node:path");
      const mod = await import(${JSON.stringify(moduleUrl)} + "?restore=" + Date.now());
      mod.syncControlSettings({ agent_mode: "plan" });
      mod.syncControlSettings({});
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
    process.env.VIBEOS_HOME = prevVibeHome
    process.env.VIBEOS_OPENCODE_HOME = prevOCHome
  }
})

test("syncControlSettings restores a stuck startup plan agent from the latest OpenCode backup", async () => {
  const home = mkdtempSync(join(tmpdir(), "vib-agent-backup-"))
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  const prevOCHome = process.env.VIBEOS_OPENCODE_HOME
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")
  process.env.VIBEOS_OPENCODE_HOME = join(home, ".config/opencode")
  try {
    mkdirSync(join(home, ".config/opencode"), { recursive: true })
    mkdirSync(join(home, ".claude"), { recursive: true })
    writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({ default_agent: "plan" }, null, 2))
    writeFileSync(join(home, ".config/opencode/opencode.json.bak-restore-001"), JSON.stringify({ default_agent: "auto" }, null, 2))
    writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({ selection: {} }, null, 2))

    const moduleUrl = pathToFileURL(join(process.cwd(), "dist-ts/lib/hooks/chat-transform.js")).href
    const script = `
      const mod = await import(${JSON.stringify(moduleUrl)} + "?restore-backup=" + Date.now());
      mod.syncControlSettings({});
      const fs = await import("node:fs");
      const path = await import("node:path");
      const home = process.env.HOME;
      const oc = JSON.parse(fs.readFileSync(path.join(home, ".config/opencode/opencode.json"), "utf8"));
      console.log(JSON.stringify({ agent: oc.default_agent }));
    `
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    }).trim())
    assert.equal(result.agent, "auto")
  } finally {
    process.env.HOME = prevHome
    process.env.VIBEOS_HOME = prevVibeHome
    process.env.VIBEOS_OPENCODE_HOME = prevOCHome
  }
})

test("syncControlSettings drops stuck full thinking when the vector cools down", async () => {
  const home = mkdtempSync(join(tmpdir(), "vib-thinking-"))
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  const prevOCHome = process.env.VIBEOS_OPENCODE_HOME
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")
  process.env.VIBEOS_OPENCODE_HOME = join(home, ".config/opencode")
  try {
    mkdirSync(join(home, ".claude"), { recursive: true })
    writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({ selection: { thinking_level: "full" } }, null, 2))

    const moduleUrl = pathToFileURL(join(process.cwd(), "dist-ts/lib/hooks/chat-transform.js")).href
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
    process.env.VIBEOS_HOME = prevVibeHome
    process.env.VIBEOS_OPENCODE_HOME = prevOCHome
  }
})

test("applySlot leaves a paused desktop followup session alone while plan is active", async () => {
  const home = mkdtempSync(join(tmpdir(), "vib-followup-"))
  const prevHome = process.env.HOME
  process.env.HOME = home
  try {
    mkdirSync(join(home, ".config/opencode"), { recursive: true })
    mkdirSync(join(home, ".claude"), { recursive: true })
    mkdirSync(join(home, "Library/Application Support/ai.opencode.desktop"), { recursive: true })
    writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({ default_agent: "plan" }, null, 2))
    writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({
      selection: { active_slot: "medium" },
      trinity: { medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" } },
    }, null, 2))

    const moduleUrl = pathToFileURL(join(process.cwd(), "dist-ts/lib/pricing.js")).href
    const script = `
      const fs = await import("node:fs");
      const path = await import("node:path");
      const mod = await import(${JSON.stringify(moduleUrl)} + "?followup=" + Date.now());
      const state = await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "dist-ts/lib/state.js")).href)});
      const home = process.env.HOME;
      const sid = state._OC_SID;
      const desktopDir = path.join(home, "Library", "Application Support", "ai.opencode.desktop");
      const workspacePath = path.join(desktopDir, "opencode.workspace.test.dat");
      const outer = {
        "workspace:model-selection": JSON.stringify({
          session: { [sid]: { agent: "build", model: { providerID: "deepseek", modelID: "deepseek-v4-flash" }, variant: null } }
        }),
        "workspace:followup": JSON.stringify({
          items: {},
          failed: {},
          paused: { [sid]: true },
          edit: {}
        }),
      };
      fs.writeFileSync(workspacePath, JSON.stringify(outer, null, 2) + "\\n");
      mod.applySlot("medium");
      const updated = JSON.parse(fs.readFileSync(workspacePath, "utf8"));
      const followup = JSON.parse(updated["workspace:followup"]);
      console.log(JSON.stringify({ paused: Boolean(followup.paused?.[sid]) }));
    `
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    }).trim())
    assert.equal(result.paused, true)
  } finally {
    process.env.HOME = prevHome
  }
})

test("refreshCreditSnapshot updates stale low credits before the cheap fallback", async () => {
  const home = mkdtempSync(join(tmpdir(), "vib-credit-"))
  const prevHome = process.env.HOME
  const prevVibeHome = process.env.VIBEOS_HOME
  const prevOCHome = process.env.VIBEOS_OPENCODE_HOME
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")
  process.env.VIBEOS_OPENCODE_HOME = join(home, ".config/opencode")
  try {
    mkdirSync(join(home, ".local/share/opencode"), { recursive: true })
    mkdirSync(join(home, ".claude"), { recursive: true })
    writeFileSync(join(home, ".local/share/opencode/auth.json"), JSON.stringify({ deepseek: { key: "test-key" } }, null, 2))
    writeFileSync(join(home, ".claude/credit-snapshot.json"), JSON.stringify({ total: 0, providers: [], ts: Date.now() }, null, 2))

    const moduleUrl = pathToFileURL(join(process.cwd(), "dist-ts/lib/credit-api.js")).href
    const script = `
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          balance_infos: [{ currency: "USD", total_balance: "120.00" }]
        })
      });
      const mod = await import(${JSON.stringify(moduleUrl)} + "?credit=" + Date.now());
      const value = await mod.refreshCreditSnapshot();
      console.log(JSON.stringify({ value }));
    `
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    }).trim())
    assert.ok(result.value >= 100)
  } finally {
    process.env.HOME = prevHome
    process.env.VIBEOS_HOME = prevVibeHome
    process.env.VIBEOS_OPENCODE_HOME = prevOCHome
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
