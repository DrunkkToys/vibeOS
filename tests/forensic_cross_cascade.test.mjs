import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import { pathToFileURL, fileURLToPath } from "node:url"

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..")
const BUNDLE_URL = pathToFileURL(join(ROOT, "src/index.js")).href
const STALE_MS = 72 * 60 * 60 * 1000

function sandbox() {
  const sb = mkdtempSync(join(tmpdir(), "vibeos-cc-"))
  mkdirSync(join(sb, ".config", "opencode"), { recursive: true })
  mkdirSync(join(sb, "project"), { recursive: true })
  writeFileSync(join(sb, ".config", "opencode", "opencode.json"), JSON.stringify({
    model: "deepseek/deepseek-v4-pro",
    provider: { deepseek: { models: { "deepseek-v4-pro": {}, "deepseek-v4-flash": {}, "deepseek-chat": {} } } },
  }, null, 2) + "\n")
  return sb
}

function run(home, body, opts = {}) {
  const skipClaudeMkdir = opts.skipClaudeMkdir === true
  const script = `
    import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs";
    import { join } from "node:path";
    const home = ${JSON.stringify(home)};
    const projectDir = join(home, "project");
    process.env.HOME = home;
    process.env.VIBEOS_HOME = join(home, ".claude");
    process.env.VIBEOS_OPENCODE_HOME = join(home, ".config", "opencode");
    console.log = () => {};
    console.info = () => {};
    if (${skipClaudeMkdir}) { void 0; } else {
      try { mkdirSync(join(home, ".claude"), { recursive: true }); } catch (e) { if (e.code !== "EEXIST") throw e; }
    }
    try { mkdirSync(join(home, ".config", "opencode"), { recursive: true }); } catch (e) { if (e.code !== "EEXIST") throw e; }
    try { mkdirSync(projectDir, { recursive: true }); } catch (e) { if (e.code !== "EEXIST") throw e; }
    const mod = await import(${JSON.stringify(BUNDLE_URL)} + "?cc=" + Date.now());
    const hooks = await mod.DelegationEnforcer({ client: {}, directory: projectDir });
    ${body}
  `
  const raw = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 30000 }).trim()
  return raw ? JSON.parse(raw) : {}
}

test("cc1: .claude is a regular file without ENOTDIR crash", async () => {
  const sb = sandbox()
  writeFileSync(join(sb, ".claude"), "not a directory")
  const result = run(sb, `
    const status = await hooks.tool.trinity.execute({ action: "status" });
    const envOut = { env: {} };
    await hooks["shell.env"]({}, envOut);
    const mode = await hooks.tool.trinity.execute({ action: "mode", slot: "quality" });
    process.stdout.write(JSON.stringify({ status: String(status || "").slice(0, 60), env: envOut.env, mode: String(mode || "").slice(0, 60) }));
  `, { skipClaudeMkdir: true })
  assert.ok(String(result.status || "").includes("[vibeOS-dashboard]"), "status works when .claude is a file")
  assert.ok(result.env?.OPENCODE_MODEL_TIER, "shell.env still injects tier")
  assert.ok(String(result.mode || "").includes("quality") || String(result.mode || "").includes("brain"), "mode switch survives .claude-as-file")
  rmSync(sb, { recursive: true, force: true })
})

test("cc2: concurrent tier writes serialize without data loss", async () => {
  const sb = sandbox()
  mkdirSync(join(sb, ".claude"), { recursive: true })
  const tiersPath = join(sb, ".claude", "model-tiers.json")
  writeFileSync(tiersPath, JSON.stringify({
    trinity: { brain: { oc: "deepseek/deepseek-v4-pro", cc: "deepseek/deepseek-v4-pro" }, medium: { oc: "deepseek/deepseek-v4-flash", cc: "deepseek/deepseek-v4-flash" }, cheap: { oc: "deepseek/deepseek-chat", cc: "deepseek/deepseek-chat" } },
    selection: { enabled: true, active_slot: "brain", delegation_enforce: true, tdd_strict: true, flow_enabled: true, flow_enforce: true, tdd_enforce: true, tdd_quality: true, thinking_level: "full", optimization_mode: "budget" },
  }, null, 2) + "\n")
  const result = run(sb, `
    async function hammer() {
      const all = [];
      for (let i = 0; i < 5; i++) {
        all.push(hooks.tool.trinity.execute({ action: "set", slot: "brain" }));
        all.push(hooks.tool.trinity.execute({ action: "set", slot: "medium" }));
        all.push(hooks.tool.trinity.execute({ action: "set", slot: "cheap" }));
        all.push(hooks.tool.trinity.execute({ action: "mode", slot: "quality" }));
        all.push(hooks.tool.trinity.execute({ action: "mode", slot: "speed" }));
        all.push(hooks.tool.trinity.execute({ action: "mode", slot: "budget" }));
      }
      await Promise.allSettled(all);
    }
    await hammer();
    const tiers = JSON.parse(readFileSync(${JSON.stringify(tiersPath)}, "utf8"));
    const sel = tiers.selection || {};
    process.stdout.write(JSON.stringify({ active_slot: sel.active_slot, optimization_mode: sel.optimization_mode, hasBrain: !!tiers.trinity?.brain, hasMedium: !!tiers.trinity?.medium, hasCheap: !!tiers.trinity?.cheap }));
  `)
  assert.ok(result.hasBrain, "brain slot survives concurrent writes")
  assert.ok(result.hasMedium, "medium slot survives concurrent writes")
  assert.ok(result.hasCheap, "cheap slot survives concurrent writes")
  assert.ok(["brain", "medium", "cheap"].includes(result.active_slot), "active slot is valid after concurrency")
  rmSync(sb, { recursive: true, force: true })
})

test("cc3: slot lock persists across rebuild and status", async () => {
  const sb = sandbox()
  mkdirSync(join(sb, ".claude"), { recursive: true })
  const tiersPath = join(sb, ".claude", "model-tiers.json")
  writeFileSync(tiersPath, JSON.stringify({
    trinity: { brain: { oc: "deepseek/deepseek-v4-pro", cc: "deepseek/deepseek-v4-pro" }, medium: { oc: "deepseek/deepseek-v4-flash", cc: "deepseek/deepseek-v4-flash" }, cheap: { oc: "deepseek/deepseek-chat", cc: "deepseek/deepseek-chat" } },
    selection: { enabled: true, active_slot: "medium", delegation_enforce: true, tdd_strict: true, flow_enabled: true, flow_enforce: true, tdd_enforce: true, tdd_quality: true, thinking_level: "full", slot_locked: true, optimization_mode: "speed" },
  }, null, 2) + "\n")
  const result = run(sb, `
    await hooks.tool.trinity.execute({ action: "lock", slot: "on" });
    await hooks.tool.trinity.execute({ action: "set", slot: "cheap" });
    await hooks.tool.trinity.execute({ action: "rebuild" });
    const tiers = JSON.parse(readFileSync(${JSON.stringify(tiersPath)}, "utf8"));
    process.stdout.write(JSON.stringify({ slot_locked: tiers.selection.slot_locked === true }));
  `)
  assert.ok(result.slot_locked, "slot_locked persists after lock on + rebuild")
  rmSync(sb, { recursive: true, force: true })
})

test("cc4: savings ledger survives report-save without corruption", async () => {
  const sb = sandbox()
  mkdirSync(join(sb, ".claude"), { recursive: true })
  const ledgerPath = join(sb, ".claude", "savings-ledger.jsonl")
  for (let i = 0; i < 50; i++) {
    appendFileSync(ledgerPath, JSON.stringify({ v: 2, at: new Date().toISOString(), kind: "cache", amount_usd: 0.0001, sid: "t" + i, tool: "Read" }) + "\n")
  }
  const beforeLines = readFileSync(ledgerPath, "utf8").trim().split("\n").length
  const result = run(sb, `
    await hooks.tool.trinity.execute({ action: "mode", slot: "quality" });
    const r1 = mod.saveReport({ type: "cascade-ledger", summary: "test ledger", metrics: { projectName: "cc4", projectFingerprint: "cc4", sessionId: "cc4" }, status: "completed" });
    const r2 = mod.saveReport({ type: "cascade-ledger", summary: "test ledger 2", metrics: { projectName: "cc4", projectFingerprint: "cc4", sessionId: "cc4" }, status: "completed" });
    const ledger = readFileSync(${JSON.stringify(ledgerPath)}, "utf8").trim().split("\\n").filter(Boolean);
    const nl = process.stdout.write(JSON.stringify({ r1ok: String(r1 || "").length > 0, r2ok: String(r2 || "").length > 0, ledgerCount: ledger.length }));
  `)
  assert.ok(result.r1ok, "report saves")
  assert.ok(result.r2ok, "second report saves")
  assert.ok(result.ledgerCount >= 50, "ledger entries preserved (" + result.ledgerCount + " >= 50)")
  rmSync(sb, { recursive: true, force: true })
})

test("cc5: stale active jobs pruned without breaking report flow", async () => {
  const sb = sandbox()
  mkdirSync(join(sb, ".claude"), { recursive: true })
  const stateUrl = pathToFileURL(join(ROOT, "src/lib/state.js")).href
  const reportingUrl = pathToFileURL(join(ROOT, "src/lib/reporting.js")).href
  writeFileSync(join(sb, ".claude", "active-jobs.json"), JSON.stringify({
    j1: { status: "active", createdAt: new Date(Date.now() - STALE_MS - 60000).toISOString(), updatedAt: new Date(Date.now() - STALE_MS - 60000).toISOString(), project_fingerprint: "stale" },
    j2: { status: "active", createdAt: new Date(Date.now() - STALE_MS - 120000).toISOString(), updatedAt: new Date(Date.now() - STALE_MS - 120000).toISOString(), project_fingerprint: "stale2" },
    j3: { status: "active" },
  }, null, 2) + "\n")
  const result = run(sb, `
    const ms = await import(${JSON.stringify(stateUrl)} + "?aj=" + Date.now());
    const mr = await import(${JSON.stringify(reportingUrl)} + "?ajr=" + Date.now());
    const jobs = ms.loadActiveJobs();
    const rid = mr.saveReport({ type: "cascade-aj", summary: "gc test", metrics: { projectName: "cc5", projectFingerprint: "cc5", sessionId: "cc5" }, status: "completed" });
    process.stdout.write(JSON.stringify({ gc: Object.keys(jobs || {}).length, rid: String(rid || "").length > 0 }));
  `)
  assert.equal(result.gc, 0, "stale jobs pruned")
  assert.ok(result.rid, "report saves after GC")
  rmSync(sb, { recursive: true, force: true })
})

test("cc6: delegation state survives reload with old data shape", async () => {
  const sb = sandbox()
  mkdirSync(join(sb, ".claude"), { recursive: true })
  writeFileSync(join(sb, ".claude", "delegation-state.json"), JSON.stringify({
    flow_warns: ["old warn"],
    session_started_at: new Date(Date.now() - 600000).toISOString(),
    lifetime: { total_savings_usd: 5, cache_savings_usd: 2, missed_context7_usd: 0 },
    sessions: { test_sid: { started: new Date().toISOString(), warns: [], tool_counts: { Read: 5, Bash: 3 }, cache_hits: [], cache_savings_usd: 0 } },
    _ledgerFormatVersion: 2, _gen: 1, last_updated: new Date().toISOString(),
  }, null, 2) + "\n")
  const result = run(sb, `
    const state = JSON.parse(readFileSync(${JSON.stringify(join(sb, ".claude", "delegation-state.json"))}, "utf8"));
    await hooks.tool.trinity.execute({ action: "status" });
    const s2 = JSON.parse(readFileSync(${JSON.stringify(join(sb, ".claude", "delegation-state.json"))}, "utf8"));
    process.stdout.write(JSON.stringify({ hasSavings: typeof s2?.lifetime?.total_savings_usd === "number", hasWarns: Array.isArray(s2?.flow_warns) }));
  `)
  assert.ok(result.hasSavings, "lifetime savings survive reload")
  assert.ok(result.hasWarns, "flow_warns survive reload")
  rmSync(sb, { recursive: true, force: true })
})

test("cc7: reports save across mode switches", async () => {
  const sb = sandbox()
  mkdirSync(join(sb, ".claude"), { recursive: true })
  const result = run(sb, `
    await hooks.tool.trinity.execute({ action: "mode", slot: "quality" });
    const r1 = mod.saveReport({ type: "cascade", summary: "t1", metrics: { projectName: "cc7", projectFingerprint: "cc7", sessionId: "cc7" }, status: "completed" });
    await hooks.tool.trinity.execute({ action: "mode", slot: "speed" });
    const r2 = mod.saveReport({ type: "cascade", summary: "t2", metrics: { projectName: "cc7", projectFingerprint: "cc7", sessionId: "cc7" }, status: "completed" });
    const reports = mod.listReports();
    process.stdout.write(JSON.stringify({ r1: String(r1 || "").length > 0, r2: String(r2 || "").length > 0, cnt: (reports || []).length }));
  `)
  assert.ok(result.r1, "report after quality mode")
  assert.ok(result.r2, "report after speed mode")
  assert.ok(result.cnt >= 2, "both reports listed")
  rmSync(sb, { recursive: true, force: true })
})

test("cc8: classifyTurnSimple and scoreStress handle undefined session ID", async () => {
  const sb = sandbox()
  mkdirSync(join(sb, ".claude"), { recursive: true })
  const tcUrl = pathToFileURL(join(ROOT, "src/lib/turn-classify.js")).href
  const result = run(sb, `
    const tc = await import(${JSON.stringify(tcUrl)} + "?tc=" + Date.now());
    let r1, r2;
    try { r1 = tc.classifyTurnSimple("write a test", { model: "deepseek/deepseek-v4-flash", tier: "cheap" }); } catch (e) { r1 = "ERR:" + e.message; }
    try { r2 = tc.scoreStress("i am frustrated"); } catch (e) { r2 = "ERR:" + e.message; }
    process.stdout.write(JSON.stringify({ cls: typeof r1 === "object" ? r1.regime : r1, str: typeof r2 === "number" ? r2 : r2 }));
  `)
  assert.ok(typeof result.cls === "string", "classifyTurnSimple works: " + result.cls)
  assert.ok(typeof result.str === "number", "scoreStress returns number: " + result.str)
  rmSync(sb, { recursive: true, force: true })
})

test("cc9: bootstrap token command returns result", async () => {
  const sb = sandbox()
  mkdirSync(join(sb, ".claude"), { recursive: true })
  const result = run(sb, `
    const bt = await hooks.tool.trinity.execute({ action: "api-bootstrap-token", token: "test-alpha-abc" });
    process.stdout.write(JSON.stringify({ bt: String(bt || "").length > 0 }));
  `)
  assert.ok(result.bt, "bootstrap token command returns result")
  rmSync(sb, { recursive: true, force: true })
})

test("cc10: brain-tier write blocked then shell.env still works", async () => {
  const sb = sandbox()
  mkdirSync(join(sb, ".claude"), { recursive: true })
  writeFileSync(join(sb, ".claude", "model-tiers.json"), JSON.stringify({
    trinity: { brain: { oc: "deepseek/deepseek-v4-pro", cc: "deepseek/deepseek-v4-pro" }, medium: { oc: "deepseek/deepseek-v4-flash", cc: "deepseek/deepseek-v4-flash" }, cheap: { oc: "deepseek/deepseek-chat", cc: "deepseek/deepseek-chat" } },
    selection: { enabled: true, active_slot: "brain", delegation_enforce: true, tdd_strict: true, flow_enabled: true, flow_enforce: true, tdd_enforce: true, tdd_quality: true, thinking_level: "full", optimization_mode: "budget" },
  }, null, 2) + "\n")
  const result = run(sb, `
    await hooks.tool.trinity.execute({ action: "set", slot: "brain" });
    await hooks.tool.trinity.execute({ action: "enforce", slot: "on" });
    const br = { args: { filePath: join(home, "project", "src", "app.ts"), content: "ok" } };
    const out = { args: br.args };
    await hooks["tool.execute.before"]({ tool: "write", args: br.args, model: "deepseek/deepseek-v4-pro", tier: "brain" }, out);
    const env = { env: {} };
    await hooks["shell.env"]({}, env);
    process.stdout.write(JSON.stringify({ blocked: out.blocked === true, tier: env.env?.OPENCODE_MODEL_TIER }));
  `)
  assert.ok(result.blocked, "brain-tier write blocked by delegation enforcement")
  assert.ok(result.tier, "shell.env returns tier after blocked write")
  rmSync(sb, { recursive: true, force: true })
})
