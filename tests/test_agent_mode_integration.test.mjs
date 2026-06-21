// SPDX-License-Identifier: MIT
// Integration test: agent_mode is regime-driven, not mode-driven
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import { _OC_SID } from "../src/lib/state.js"

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

test.skip("syncControlSettings restores the previous OpenCode agent after plan mode ends and clears followup pause", async () => {
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
      process.exit(0);
    `
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      timeout: 20000,
      cwd: process.cwd(),
      env: { ...process.env, VIBEOS_FAST_CI: "1", VIBEOS_API_DISABLED: "1", VIBEOS_OPENCODE_HOME: join(home, ".config/opencode"), HOME: home, VIBEOS_HOME: join(home, ".claude") },
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

test.skip("syncControlSettings restores a stuck startup plan agent from the latest OpenCode backup", async () => {
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
      process.exit(0);
    `
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      timeout: 20000,
      cwd: process.cwd(),
      env: { ...process.env, VIBEOS_FAST_CI: "1", VIBEOS_API_DISABLED: "1", VIBEOS_OPENCODE_HOME: join(home, ".config/opencode"), HOME: home, VIBEOS_HOME: join(home, ".claude") },
      encoding: "utf8",
    }).trim())
    assert.equal(result.agent, "auto")
  } finally {
    process.env.HOME = prevHome
    process.env.VIBEOS_HOME = prevVibeHome
    process.env.VIBEOS_OPENCODE_HOME = prevOCHome
  }
})

test("syncControlSettings does not overwrite a pre-outage optimization mode with vibelitex fallback", async () => {
  const home = mkdtempSync(join(tmpdir(), "vib-opt-fallback-"))
  try {
    const script = `
      import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
      import { join } from "node:path";
      import { tmpdir } from "node:os";
      const home = ${JSON.stringify(home)};
      process.env.HOME = home;
      process.env.VIBEOS_HOME = join(home, ".claude");
      process.env.VIBEOS_OPENCODE_HOME = join(home, ".config/opencode");
      process.env.VIBEOS_API_URL = "http://127.0.0.1:1";
      process.env.VIBEOS_API_TOKEN = "vos_" + "a".repeat(64);
      mkdirSync(join(home, ".config/opencode"), { recursive: true });
      mkdirSync(join(home, ".claude"), { recursive: true });
      writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({ model: "opus-4" }, null, 2));
      writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({
        selection: {
          enabled: true,
          active_slot: "brain",
          optimization_mode: "quality",
          delegation_enforce: true,
          onboarding_mode: "strict",
        },
        trinity: {
          brain: { oc: "opus-4", cc: "deepseek-reasoner" },
          medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
          cheap: { oc: "deepseek/deepseek-chat", cc: "haiku" },
        },
      }, null, 2));
      const prevFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.endsWith("/health")) throw new Error("simulated outage");
        throw new Error("unexpected fetch " + u);
      };
      const api = await import("./src/lib/api-client.js");
      const mod = await import("./src/lib/hooks/chat-transform.js");
      const beforeFallback = await api.remoteCall("health", [], () => "fallback");
      const fallbackActive = api.isApiFallback();
      mod.syncControlSettings({
        enforcement_mode: "normal",
        flow_mode: "audit",
        tdd_mode: "lazy",
        thinking_mode: "brief",
        tier_bias: "medium",
        optimization_mode: "vibelitex",
      });
      const tiersAfterFallback = JSON.parse(readFileSync(join(home, ".claude/model-tiers.json"), "utf8"));
      api.setApiToken("vos_" + "b".repeat(64));
      const afterReset = api.isApiFallback();
      mod.syncControlSettings({
        enforcement_mode: "strict",
        flow_mode: "strict",
        tdd_mode: "strict",
        thinking_mode: "full",
        tier_bias: "brain",
        optimization_mode: "quality",
      });
      const tiersAfterRecovery = JSON.parse(readFileSync(join(home, ".claude/model-tiers.json"), "utf8"));
      globalThis.fetch = prevFetch;
      process.stdout.write(JSON.stringify({
        beforeFallback,
        fallbackActive,
        afterReset,
        tiersAfterFallback,
        tiersAfterRecovery,
      }));
      process.exit(0);
    `;
    const raw = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      timeout: 20000,
      env: { ...process.env, VIBEOS_FAST_CI: "1", VIBEOS_API_DISABLED: "1", VIBEOS_OPENCODE_HOME: join(home, ".config/opencode"), HOME: home, VIBEOS_HOME: join(home, ".claude") },
      encoding: "utf8",
    }).trim()
    const result = JSON.parse(raw)
    assert.equal(result.beforeFallback, "fallback", "dead API should return the fallback payload")
    assert.equal(result.fallbackActive, true, "API must be in fallback for the regression path")
    assert.equal(result.tiersAfterFallback.selection.optimization_mode, "quality", "fallback must not overwrite the pre-outage mode")
    assert.equal(result.afterReset, false, "fallback clears after token reset")
    assert.equal(result.tiersAfterRecovery.selection.optimization_mode, "quality", "recovered session should still resolve back to the pre-outage mode")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("syncControlSettings restores a stuck vibelitex optimization mode back to the prior mode after reconnect", async () => {
  const home = mkdtempSync(join(tmpdir(), "vib-opt-restore-"))
  try {
    const script = `
      import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
      import { join } from "node:path";
      const home = ${JSON.stringify(home)};
      process.env.HOME = home;
      process.env.VIBEOS_HOME = join(home, ".claude");
      process.env.VIBEOS_OPENCODE_HOME = join(home, ".config/opencode");
      process.env.VIBEOS_API_URL = "https://api.example.invalid";
      process.env.VIBEOS_API_TOKEN = "vos_" + "b".repeat(64);
      mkdirSync(join(home, ".config/opencode"), { recursive: true });
      mkdirSync(join(home, ".claude"), { recursive: true });
      writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({ model: "opus-4" }, null, 2));
      writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({
        selection: {
          enabled: true,
          active_slot: "brain",
          optimization_mode: "vibelitex",
          previous_optimization_mode: "quality",
          delegation_enforce: true,
          onboarding_mode: "strict",
        },
        trinity: {
          brain: { oc: "opus-4", cc: "deepseek-reasoner" },
          medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
          cheap: { oc: "deepseek/deepseek-chat", cc: "haiku" },
        },
      }, null, 2));
      writeFileSync(join(home, ".claude/blackbox-state.json"), JSON.stringify({
        enabled: true,
        sessions: {
          ${JSON.stringify(_OC_SID)}: { optimization_mode: "vibelitex" },
        },
      }, null, 2));
      const api = await import("./src/lib/api-client.js");
      const mod = await import("./src/lib/hooks/chat-transform.js");
      const turn = await import("./src/lib/turn-classify.js");
      api.setApiToken("vos_" + "c".repeat(64));
      mod.syncControlSettings({
        enforcement_mode: "strict",
        flow_mode: "strict",
        tdd_mode: "strict",
        thinking_mode: "full",
        tier_bias: "brain",
        optimization_mode: "quality",
      });
      const tiers = JSON.parse(readFileSync(join(home, ".claude/model-tiers.json"), "utf8"));
      process.stdout.write(JSON.stringify({
        fallback: api.isApiFallback(),
        resolved_optimization_mode: turn.loadOptimizationMode(),
        optimization_mode: tiers.selection.optimization_mode,
        previous_optimization_mode: tiers.selection.previous_optimization_mode ?? null,
      }));
      process.exit(0);
    `;
    const raw = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      timeout: 20000,
      env: { ...process.env, VIBEOS_FAST_CI: "1", VIBEOS_API_DISABLED: "1", VIBEOS_OPENCODE_HOME: join(home, ".config/opencode"), HOME: home, VIBEOS_HOME: join(home, ".claude") },
      encoding: "utf8",
    }).trim()
    const result = JSON.parse(raw)
    assert.equal(result.fallback, false, "reconnect should clear API fallback")
    assert.equal(result.resolved_optimization_mode, "quality", "stuck vibelitex should resolve back to the previous optimization mode for the live footer")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("loadOptimizationMode recovers vibelitex from live brain tier after boot", { timeout: 70000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "vib-opt-live-"))
  try {
    const script = `
      import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
      import { join } from "node:path";
      const home = ${JSON.stringify(home)};
      process.env.HOME = home;
      process.env.VIBEOS_HOME = join(home, ".claude");
      process.env.VIBEOS_OPENCODE_HOME = join(home, ".config/opencode");
      mkdirSync(join(home, ".config/opencode"), { recursive: true });
      mkdirSync(join(home, ".claude"), { recursive: true });
      writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({
        model: "opus-4",
      }, null, 2));
      writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({
        selection: {
          enabled: true,
          active_slot: "brain",
          optimization_mode: "vibelitex",
          delegation_enforce: true,
          onboarding_mode: "strict",
        },
        trinity: {
          brain: { oc: "opus-4", cc: "deepseek-reasoner" },
          medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
          cheap: { oc: "deepseek/deepseek-chat", cc: "haiku" },
        },
      }, null, 2));
      mkdirSync(join(home, "proj"), { recursive: true });
      const mod = await import("./src/index.js");
      const hooks = await mod.DelegationEnforcer({ client: {}, directory: ${JSON.stringify(join(home, "proj"))} });
      const turn = await import("./src/lib/turn-classify.js");
      const resolved = turn.loadOptimizationMode();
      const tiers = JSON.parse(readFileSync(join(home, ".claude/model-tiers.json"), "utf8"));
      const out = { text: "This assistant response is long enough to trigger the footer after a reconnect." };
      await hooks["experimental.text.complete"]({ messageID: "live-vibelitex-recovery" }, out);
      process.stdout.write(JSON.stringify({
        resolved,
        persisted: tiers.selection.optimization_mode,
        footer: out.text,
      }));
      process.exit(0);
    `;
    const raw = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      timeout: 10000,
      env: { ...process.env, VIBEOS_FAST_CI: "1", VIBEOS_API_DISABLED: "1", VIBEOS_OPENCODE_HOME: join(home, ".config/opencode"), HOME: home, VIBEOS_HOME: join(home, ".claude") },
      encoding: "utf8",
    }).trim()
    const result = JSON.parse(raw)
    assert.equal(result.resolved, "quality", "live brain tier should recover the mode from vibelitex")
    assert.equal(result.persisted, "quality", "recovered mode should be written back to selection state")
    assert.ok(!String(result.footer || "").includes("vibelitex"), "footer should not display stale vibelitex after recovery")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("mergeRemoteControlVector preserves local agent_mode over remote control vector", async () => {
  const moduleUrl = pathToFileURL(join(process.cwd(), "dist-ts/lib/hooks/chat-transform.js")).href
  const mod = await import(moduleUrl + "?merge-agent=" + Date.now())
  const merged = mod.mergeRemoteControlVector(
    { enforcement_mode: "normal", flow_mode: "normal", tier_bias: "cheap", optimization_mode: "budget" },
    { agent_mode: "plan", tier_bias: "brain", optimization_mode: "quality", enforcement_mode: "strict", flow_mode: "strict", tdd_mode: "strict", thinking_mode: "full" }
  )
  assert.equal(merged.agent_mode, "plan")
  assert.equal(merged.tier_bias, "brain")
  assert.equal(merged.optimization_mode, "quality")
})

test.skip("syncControlSettings drops stuck full thinking when the vector cools down", async () => {
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
      process.exit(0);
    `
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      timeout: 20000,
      cwd: process.cwd(),
      env: { ...process.env, VIBEOS_FAST_CI: "1", VIBEOS_API_DISABLED: "1", VIBEOS_OPENCODE_HOME: join(home, ".config/opencode"), HOME: home, VIBEOS_HOME: join(home, ".claude") },
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
      process.exit(0);
    `
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      timeout: 20000,
      cwd: process.cwd(),
      env: { ...process.env, VIBEOS_FAST_CI: "1", VIBEOS_API_DISABLED: "1", VIBEOS_OPENCODE_HOME: join(home, ".config/opencode"), HOME: home, VIBEOS_HOME: join(home, ".claude") },
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
  const prevFetch = globalThis.fetch
  process.env.HOME = home
  process.env.VIBEOS_HOME = join(home, ".claude")
  process.env.VIBEOS_OPENCODE_HOME = join(home, ".config/opencode")
  try {
    mkdirSync(join(home, ".local/share/opencode"), { recursive: true })
    mkdirSync(join(home, ".claude"), { recursive: true })
    writeFileSync(join(home, ".local/share/opencode/auth.json"), JSON.stringify({ deepseek: { key: "test-key" } }, null, 2))
    writeFileSync(join(home, ".claude/credit-snapshot.json"), JSON.stringify({ total: 0, providers: [], ts: Date.now() }, null, 2))

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        balance_infos: [{ currency: "USD", total_balance: "120.00" }],
      }),
    })

    const moduleUrl = pathToFileURL(join(process.cwd(), "dist-ts/lib/credit-api.js")).href
    const mod = await import(moduleUrl + "?credit=" + Date.now())
    const value = await mod.refreshCreditSnapshot()
    assert.ok(value >= 100)
  } finally {
    process.env.HOME = prevHome
    process.env.VIBEOS_HOME = prevVibeHome
    process.env.VIBEOS_OPENCODE_HOME = prevOCHome
    globalThis.fetch = prevFetch
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
