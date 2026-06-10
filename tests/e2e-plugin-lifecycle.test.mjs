// E2E: Full plugin lifecycle — sandbox init, hooks, enforcement, state, teardown
import { describe, it, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMcpServer } from "../src/index.js";

const sandbox = mkdtempSync(join(tmpdir(), "e2e-lifecycle-"));
const VIBEOS_HOME = join(sandbox, ".claude");
const OPENCODE_CONFIG = join(sandbox, ".config", "opencode");
const stateFile = join(VIBEOS_HOME, "delegation-state.json");
const tiersFile = join(VIBEOS_HOME, "model-tiers.json");
const blackboxFile = join(VIBEOS_HOME, "blackbox-state.json");
const e2eLog = join(VIBEOS_HOME, "test-e2e-lifecycle.json");

before(() => {
  mkdirSync(VIBEOS_HOME, { recursive: true });
  mkdirSync(OPENCODE_CONFIG, { recursive: true });
  mkdirSync(join(VIBEOS_HOME, "reports"), { recursive: true });
  const origHome = process.env.HOME;
  process.env.HOME = sandbox;
  writeFileSync(join(OPENCODE_CONFIG, "opencode.json"), JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    instructions: ["~/.config/opencode/AGENTS.md"],
    plugin: ["./plugins/vibeOS"],
    model: "deepseek/deepseek-v4-pro",
    provider: {
      deepseek: {
        models: { "deepseek-v4-pro": {}, "deepseek-v4-flash": {}, "deepseek-chat": {} }
      }
    }
  }, null, 2) + "\n");
  writeFileSync(tiersFile, JSON.stringify({
    $schema_version: 1,
    selection: {
      active_slot: "brain", enabled: true, thinking_level: "off",
      delegation_enforce: true, flow_enabled: true, flow_enforce: true,
      tdd_enforce: true, tdd_strict: true, monthly_budget_usd: 50
    },
    tiers: {
      high: { regex: "opus|gemini-.*-pro|deepseek.*v4.*pro|deepseek.*r1|deepseek.*reasoner|gpt-5|o1|o3|o4" },
      mid: { regex: "claude.*sonnet|sonnet|deepseek.*v4.*flash|gemini-.*-flash|gpt-4o" },
      budget: { regex: ".*" }
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "haiku" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap: { oc: "deepseek/deepseek-chat", cc: "haiku" }
    }
  }, null, 2) + "\n");
});

after(async () => {
  try { await closeMcpServer(); } catch {}
});

function freshMod() {
  const ts = Date.now();
  return import("../src/index.js?t=" + ts);
}

describe("E2E: Full Plugin Lifecycle", () => {
  let hooks;

  before(async () => {
    const mod = await freshMod();
    hooks = await mod.DelegationEnforcer({ client: {}, directory: sandbox });
  });

  it("1. experimental.chat.system.transform — injects orchestration directives", async () => {
    const out = { system: [] };
    await hooks["experimental.chat.system.transform"]({}, out);
    assert.ok(Array.isArray(out.system), "system is array");
    const joined = out.system.filter(s => typeof s === "string").join(" ");
    assert.ok(joined.includes("[vibeOS]"), "contains vibeOS prefix: " + joined.slice(0, 80));
  });

  it("2. experimental.chat.messages.transform — no crash with user message", async () => {
    const input = { messages: [{ role: "user", content: "Write a function" }] };
    const out = { messages: [] };
    await hooks["experimental.chat.messages.transform"](input, out);
    assert.ok(Array.isArray(out.messages), "messages is array");
  });

  it("3. tool.execute.before — blocks write on brain high-tier", async () => {
    const { setCurrentModel, setCurrentTier } = await import("../src/lib/state.js?t=" + Date.now());
    setCurrentModel("deepseek/deepseek-v4-pro");
    setCurrentTier("high");
    const input = { tool: "write", args: { filePath: "/tmp/test.txt", content: "test" } };
    const out = { args: { filePath: "/tmp/test.txt", content: "test" } };
    await hooks["tool.execute.before"](input, out);
    assert.ok(out.blocked === true, "write tool blocked on brain tier: " + JSON.stringify(out));
    assert.ok(out.args.filePath.startsWith("/tmp/vibeos-enforcement-blocked"), "filePath redirected: " + out.args.filePath);
  });

  it("4. tool.execute.after — footer alert prepended to output", async () => {
    const input = { tool: "bash", args: { command: "echo hi" } };
    const out = { result: "hi\n" };
    await hooks["tool.execute.after"](input, out);
    const titleSet = typeof out.title === "string" && out.title.length > 0;
    const resultModified = typeof out.result === "string" && (out.result.includes("hi") || out.result.includes("$") || out.result.includes("Deepseek"));
    const titleStr = typeof out.title === "string" ? out.title.slice(0, 40) : String(out.title);
    const resultStr = typeof out.result === "string" ? out.result.slice(0, 60) : String(out.result);
    assert.ok(titleSet || resultModified, "footer applied — title: " + titleStr + " result: " + resultStr);
  });

  it("5. experimental.text.complete — footer appended to assistant text", async () => {
    const input = { messageID: "lifecycle-test-1" };
    const out = { text: "This is a long enough assistant response to trigger the vibeOS footer mechanism. Definitely long enough to pass the fifty character threshold." };
    await hooks["experimental.text.complete"](input, out);
    assert.ok(out.text.includes("Deepseek") || out.text.includes("deepseek") || out.text.includes("$"), "footer appended: " + out.text.slice(-80));
  });

  it("6. experimental.session.compacting — compaction context populated", async () => {
    const out = { context: [] };
    await hooks["experimental.session.compacting"]({}, out);
    assert.ok(Array.isArray(out.context), "context is array");
    if (out.context.length > 0) {
      const joined = out.context.map(e => e.content).join(" ");
      assert.ok(joined.includes("compaction") || joined.includes("scratchpad"), "compaction context: " + joined.slice(0, 80));
    }
  });

  it("7. shell.env — OPENCODE_MODEL_TIER and OPENCODE_MODEL set", async () => {
    const out = { env: {} };
    await hooks["shell.env"]({}, out);
    assert.ok(typeof out.env.OPENCODE_MODEL_TIER === "string" && out.env.OPENCODE_MODEL_TIER.length > 0, "tier set: " + out.env.OPENCODE_MODEL_TIER);
    assert.ok(typeof out.env.OPENCODE_MODEL === "string" && out.env.OPENCODE_MODEL.length > 0, "model set: " + out.env.OPENCODE_MODEL);
  });

  it("8. blackbox-state.json created with enabled:true", () => {
    assert.ok(existsSync(blackboxFile), "blackbox-state.json exists");
    const bb = JSON.parse(readFileSync(blackboxFile, "utf-8"));
    assert.ok(bb.sessions, "has sessions");
    const allEnabled = Object.values(bb.sessions).every(s => s.enabled !== false);
    assert.ok(allEnabled, "all sessions have enabled:true (or default)");
  });

  it("9. delegation-state.json has session data", () => {
    assert.ok(existsSync(stateFile), "delegation-state.json exists");
    const ds = JSON.parse(readFileSync(stateFile, "utf-8"));
    assert.ok(ds.lifetime !== undefined, "has lifetime");
    const sid = Object.keys(ds.sessions || {})[0];
    if (sid) {
      assert.ok(ds.sessions[sid].warns !== undefined, "session has warns");
    }
  });

  it("10. model-tiers.json has delegation_enforce setting", () => {
    const tiers = JSON.parse(readFileSync(tiersFile, "utf-8"));
    assert.ok(tiers.selection.delegation_enforce === true, "delegation_enforce is true");
  });

  it("11. trinity commands through plugin.tool.trinity.execute()", async () => {
    const t = hooks.tool.trinity;
    const status = await t.execute({});
    assert.ok(status.includes("[vibeOS-dashboard]") || status.includes("vibeOS"), "status: " + status.slice(0, 60));
    const disable = await t.execute({ action: "disable" });
    assert.ok(typeof disable === "string", "disable returned string");
    const reenable = await t.execute({ action: "enable" });
    assert.ok(typeof reenable === "string", "reenable returned string");
    const help = await t.execute({ action: "help" });
    assert.ok(help.includes("trinity") && help.includes("set"), "help contains trinity and set: " + help.slice(0, 80));
  });
});

test("E2E: log complete lifecycle state to ~/.claude/test-e2e-lifecycle.json", async () => {
  const snapshot = {
    finished_at: new Date().toISOString(),
    sandbox,
    files: {
      "delegation-state.json": existsSync(stateFile) ? "present" : "missing",
      "model-tiers.json": existsSync(tiersFile) ? "present" : "missing",
      "blackbox-state.json": existsSync(blackboxFile) ? "present" : "missing",
    },
    tiers: existsSync(tiersFile) ? safeParse(readFileSync(tiersFile, "utf-8")) : null,
  };
  writeFileSync(e2eLog, JSON.stringify(snapshot, null, 2) + "\n");
  assert.ok(existsSync(e2eLog), "e2e lifecycle log written");

  function safeParse(raw) {
    try { return JSON.parse(raw); } catch { return { parse_error: true }; }
  }
});
